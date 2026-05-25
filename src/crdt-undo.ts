import { diff } from '@shapeshift-labs/frontier/diff';
import { cloneJson } from '@shapeshift-labs/frontier/clone';
import {
  OP_ARRAY_SPLICE,
  OP_REMOVE,
  OP_SET,
  OP_STRING_SPLICE
} from '@shapeshift-labs/frontier/constants';
import { getPath } from '@shapeshift-labs/frontier/pointer';
import type {
  CrdtCommitResult,
  CrdtDocument,
  CrdtTransaction,
  CrdtUndoActionOptions,
  CrdtUndoCaptureOptions,
  CrdtUndoManager,
  CrdtUndoManagerOptions,
  CrdtUndoStackEntry,
  CrdtVersion,
  JsonObject,
  JsonPath,
  JsonValue,
  Patch,
  PatchOperation
} from './types.js';

export type {
  CrdtUndoActionOptions,
  CrdtUndoCaptureOptions,
  CrdtUndoManager,
  CrdtUndoManagerOptions,
  CrdtUndoStackEntry
} from './types.js';

export function createCrdtUndoManager(doc: CrdtDocument, options?: CrdtUndoManagerOptions): CrdtUndoManager {
  return new FrontierCrdtUndoManager(doc, options);
}

class FrontierCrdtUndoManager implements CrdtUndoManager {
  readonly doc: CrdtDocument;
  private readonly maxStack: number;
  private readonly trackedOrigins: Set<string> | null;
  private readonly ignoredOrigins: Set<string>;
  private readonly captureTimeoutMs: number;
  private readonly shouldCapture: ((entry: CrdtUndoStackEntry) => boolean) | undefined;
  private readonly onUndo: ((entry: CrdtUndoStackEntry) => void) | undefined;
  private readonly onRedo: ((entry: CrdtUndoStackEntry) => void) | undefined;
  private readonly undoStack: CrdtUndoStackEntry[] = [];
  private readonly redoStack: CrdtUndoStackEntry[] = [];
  private forceCaptureBoundary = false;

  constructor(doc: CrdtDocument, options?: CrdtUndoManagerOptions) {
    this.doc = doc;
    const maxStack = options && options.maxStack !== undefined ? options.maxStack : 100;
    if (!Number.isSafeInteger(maxStack) || maxStack < 1) throw new RangeError('undo maxStack must be a positive safe integer');
    this.maxStack = maxStack;
    this.trackedOrigins = options && options.trackedOrigins !== undefined ? new Set(options.trackedOrigins) : null;
    this.ignoredOrigins = new Set(options && options.ignoredOrigins !== undefined ? options.ignoredOrigins : []);
    const captureTimeoutMs = options && options.captureTimeoutMs !== undefined ? options.captureTimeoutMs : 0;
    if (!Number.isFinite(captureTimeoutMs) || captureTimeoutMs < 0) throw new RangeError('undo captureTimeoutMs must be a non-negative finite number');
    this.captureTimeoutMs = captureTimeoutMs;
    this.shouldCapture = options && options.shouldCapture;
    this.onUndo = options && options.onUndo;
    this.onRedo = options && options.onRedo;
  }

  canUndo(): boolean {
    return this.undoStack.length !== 0;
  }

  canRedo(): boolean {
    return this.redoStack.length !== 0;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.forceCaptureBoundary = false;
  }

  stopCapturing(): void {
    this.forceCaptureBoundary = true;
  }

  capture<T>(callback: () => T, options?: CrdtUndoCaptureOptions): T {
    const before = this.doc.toJSON();
    const beforeVersion = this.doc.getVersion();
    const result = callback();
    const after = this.doc.toJSON();
    const afterVersion = this.doc.getVersion();
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      const now = Date.now();
      const entry: CrdtUndoStackEntry = {
        before,
        after,
        beforeVersion,
        afterVersion,
        origin: options && options.origin,
        metadata: options && options.metadata !== undefined ? cloneJson(options.metadata) : undefined,
        createdAt: now,
        updatedAt: now,
        changeCount: 1
      };
      if (this.shouldTrack(entry) && (this.shouldCapture === undefined || this.shouldCapture(cloneUndoEntry(entry)))) {
        this.pushUndo(entry, options !== undefined ? options.merge : undefined);
      }
      this.redoStack.length = 0;
    }
    return result;
  }

  undo(options?: CrdtUndoActionOptions): CrdtCommitResult {
    const selected = selectUndoEntry(this.undoStack, options);
    if (selected === undefined) return this.doc.change(() => {});
    const entry = selected.entry;
    const patch = diff(entry.after, entry.before);
    assertUndoReplayIsCurrent(this.doc, entry.afterVersion, entry.after, patch, 'undo');
    this.undoStack.splice(selected.index, 1);
    const result = applySnapshotPatchAsCrdt(this.doc, entry.after, entry.before, patch);
    const redoEntry = cloneUndoEntry(entry);
    redoEntry.undoVersion = result.heads;
    this.redoStack[this.redoStack.length] = redoEntry;
    if (this.onUndo !== undefined) this.onUndo(cloneUndoEntry(redoEntry));
    return result;
  }

  redo(options?: CrdtUndoActionOptions): CrdtCommitResult {
    const selected = selectUndoEntry(this.redoStack, options);
    if (selected === undefined) return this.doc.change(() => {});
    const entry = selected.entry;
    const patch = diff(entry.before, entry.after);
    assertUndoReplayIsCurrent(this.doc, entry.undoVersion || entry.beforeVersion, entry.before, patch, 'redo');
    this.redoStack.splice(selected.index, 1);
    const result = applySnapshotPatchAsCrdt(this.doc, entry.before, entry.after, patch);
    const undoEntry = cloneUndoEntry(entry);
    undoEntry.afterVersion = result.heads;
    undoEntry.undoVersion = undefined;
    this.undoStack[this.undoStack.length] = undoEntry;
    if (this.onRedo !== undefined) this.onRedo(cloneUndoEntry(undoEntry));
    return result;
  }

  getUndoStack(): CrdtUndoStackEntry[] {
    return this.undoStack.map(cloneUndoEntry);
  }

  getRedoStack(): CrdtUndoStackEntry[] {
    return this.redoStack.map(cloneUndoEntry);
  }

  private shouldTrack(entry: CrdtUndoStackEntry): boolean {
    if (entry.origin !== undefined && this.ignoredOrigins.has(entry.origin)) return false;
    if (this.trackedOrigins === null) return true;
    return entry.origin !== undefined && this.trackedOrigins.has(entry.origin);
  }

  private pushUndo(entry: CrdtUndoStackEntry, merge?: boolean | 'auto'): void {
    const previous = this.forceCaptureBoundary ? undefined : this.undoStack[this.undoStack.length - 1];
    this.forceCaptureBoundary = false;
    if (previous !== undefined && this.shouldMerge(previous, entry, merge)) {
      previous.after = cloneJson(entry.after);
      previous.afterVersion = cloneCrdtVersion(entry.afterVersion);
      previous.undoVersion = undefined;
      previous.updatedAt = entry.updatedAt;
      previous.changeCount += entry.changeCount;
      previous.metadata = mergeMetadata(previous.metadata, entry.metadata);
      return;
    }
    this.undoStack[this.undoStack.length] = cloneUndoEntry(entry);
    if (this.undoStack.length > this.maxStack) this.undoStack.shift();
  }

  private shouldMerge(previous: CrdtUndoStackEntry, entry: CrdtUndoStackEntry, merge?: boolean | 'auto'): boolean {
    if (merge === false) return false;
    if (previous.origin !== entry.origin) return false;
    if (merge === true) return true;
    return this.captureTimeoutMs > 0 && entry.createdAt - previous.updatedAt <= this.captureTimeoutMs;
  }
}

function selectUndoEntry(
  stack: CrdtUndoStackEntry[],
  options?: CrdtUndoActionOptions
): { entry: CrdtUndoStackEntry; index: number } | undefined {
  if (stack.length === 0) return undefined;
  if (options === undefined || (options.origin === undefined && options.predicate === undefined)) {
    return { entry: stack[stack.length - 1], index: stack.length - 1 };
  }
  for (let i = stack.length - 1; i >= 0; i--) {
    const entry = stack[i];
    if (options.origin !== undefined && entry.origin !== options.origin) continue;
    if (options.predicate !== undefined && !options.predicate(cloneUndoEntry(entry))) continue;
    return { entry, index: i };
  }
  return undefined;
}

function applySnapshotPatchAsCrdt(
  doc: CrdtDocument,
  source: JsonValue,
  target: JsonValue,
  patch = diff(source, target)
): CrdtCommitResult {
  if (patch.length === 0) return doc.change(() => {});
  if (!patchCanReplayAsCrdtIntents(source, patch)) return doc.set('', cloneJson(target));
  return doc.change((tx) => {
    for (let i = 0, length = patch.length; i < length; i++) {
      applyPatchOperationAsCrdtIntent(tx, source, patch[i]);
    }
  });
}

function patchCanReplayAsCrdtIntents(source: JsonValue, patch: Patch): boolean {
  for (let i = 0, length = patch.length; i < length; i++) {
    const op = patch[i];
    if (op[0] === OP_SET || op[0] === OP_REMOVE) continue;
    if (op[0] === OP_STRING_SPLICE && typeof getPath(source, op[1]) === 'string') continue;
    if (op[0] === OP_ARRAY_SPLICE && Array.isArray(getPath(source, op[1]))) continue;
    return false;
  }
  return true;
}

function applyPatchOperationAsCrdtIntent(tx: CrdtTransaction, source: JsonValue, op: PatchOperation): void {
  if (op[0] === OP_SET) {
    tx.set(op[1], cloneJson(op[2]));
  } else if (op[0] === OP_REMOVE) {
    tx.delete(op[1]);
  } else if (op[0] === OP_STRING_SPLICE) {
    const current = getPath(source, op[1]);
    const text = typeof current === 'string' ? current : '';
    const index = codePointLength(text.slice(0, op[2]));
    tx.text(op[1]).splice(index, codePointLength(text.slice(op[2], op[2] + op[3])), op[4]);
  } else if (op[0] === OP_ARRAY_SPLICE) {
    const current = getPath(source, op[1]);
    if (!Array.isArray(current)) return;
    if (op[3] !== 0) tx.list(op[1]).delete(op[2], op[3]);
    if (op[4].length !== 0) tx.list(op[1]).insert(op[2], cloneJson(op[4]));
  }
}

function assertUndoReplayIsCurrent(
  doc: CrdtDocument,
  baseVersion: CrdtVersion | undefined,
  source: JsonValue,
  patch: Patch,
  action: 'undo' | 'redo'
): void {
  if (baseVersion === undefined || patch.length === 0 || sameCrdtVersion(doc.getVersion(), baseVersion)) return;
  if (JSON.stringify(doc.toJSON()) === JSON.stringify(source)) return;
  const advanced = doc.changesSince(baseVersion);
  if (advanced.length === 0) return;
  const replayPaths = patchCanReplayAsCrdtIntents(source, patch)
    ? patch.map((op) => op[1])
    : [[]];
  for (let i = 0, opCount = advanced.length; i < opCount; i++) {
    const advancedPath = advanced[i].path;
    for (let j = 0, pathCount = replayPaths.length; j < pathCount; j++) {
      if (pathsOverlap(advancedPath, replayPaths[j])) {
        throw new Error(`cannot ${action} CRDT entry because the document changed at an overlapping path`);
      }
    }
  }
}

function pathsOverlap(left: JsonPath, right: JsonPath): boolean {
  const length = Math.min(left.length, right.length);
  for (let i = 0; i < length; i++) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

function sameCrdtVersion(left: CrdtVersion, right: CrdtVersion): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    const leftHeads = left.slice().sort();
    const rightHeads = right.slice().sort();
    for (let i = 0; i < leftHeads.length; i++) {
      if (leftHeads[i] !== rightHeads[i]) return false;
    }
    return true;
  }
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  for (let i = 0; i < leftKeys.length; i++) {
    const key = leftKeys[i];
    if (key !== rightKeys[i] || left[key] !== right[key]) return false;
  }
  return true;
}

function cloneCrdtVersion(version: CrdtVersion | undefined): CrdtVersion | undefined {
  if (version === undefined) return undefined;
  if (Array.isArray(version)) return version.slice();
  const out: Record<string, number> = {};
  for (const key in version) out[key] = version[key];
  return out;
}

function cloneUndoEntry(entry: CrdtUndoStackEntry): CrdtUndoStackEntry {
  return {
    before: cloneJson(entry.before),
    after: cloneJson(entry.after),
    beforeVersion: cloneCrdtVersion(entry.beforeVersion),
    afterVersion: cloneCrdtVersion(entry.afterVersion),
    undoVersion: cloneCrdtVersion(entry.undoVersion),
    origin: entry.origin,
    metadata: entry.metadata === undefined ? undefined : cloneJson(entry.metadata),
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    changeCount: entry.changeCount
  };
}

function mergeMetadata(left: JsonObject | undefined, right: JsonObject | undefined): JsonObject | undefined {
  if (left === undefined) return right === undefined ? undefined : cloneJson(right);
  if (right === undefined) return cloneJson(left);
  return { ...cloneJson(left), ...cloneJson(right) };
}

function codePointLength(value: string): number {
  return value.length < 2 ? value.length : Array.from(value).length;
}
