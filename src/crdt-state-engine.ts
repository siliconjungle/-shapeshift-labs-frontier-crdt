import { createCrdtDocument } from './crdt.js';
import { getCachedPointerPath } from '@shapeshift-labs/frontier/pointer';
import { createStateEngine } from '@shapeshift-labs/frontier-state';
import type {
  CrdtBinaryHandle,
  CrdtChangeOptions,
  CrdtCommitResult,
  CrdtConflict,
  CrdtConflictResolution,
  CrdtConflictResolutionOptions,
  CrdtConflictSummary,
  CrdtCounterHandle,
  CrdtCursorOptions,
  CrdtDocument,
  CrdtDocumentOptions,
  CrdtForkOptions,
  CrdtFrameCaptureOptions,
  CrdtFrameEvaluation,
  CrdtFrameEvaluationOptions,
  CrdtFrameReference,
  CrdtHistoryEntry,
  CrdtHistoryOptions,
  CrdtHistoryVisitor,
  CrdtListHandle,
  CrdtMapHandle,
  CrdtOperation,
  CrdtOperationId,
  CrdtProfile,
  CrdtResolvedCursor,
  CrdtResolvedSelection,
  CrdtRichTextHandle,
  CrdtSelectionOptions,
  CrdtSnapshot,
  CrdtSnapshotOptions,
  CrdtStateEngine,
  CrdtStateEngineOptions,
  CrdtStateVector,
  CrdtTextCursor,
  CrdtTextHandle,
  CrdtTextSelection,
  CrdtTransaction,
  CrdtTreeHandle,
  CrdtUpdate,
  CrdtVersion,
  CrdtVersionInfo,
  CrdtVersionInfoOptions,
  CrdtVersionMark,
  CrdtVersionMarkOptions,
  CrdtVersionRelation,
  CrdtXmlHandle,
  DeltaView,
  DeltaViewOptions,
  JsonObject,
  JsonPath,
  JsonValue,
  PatchSubscription,
  PatchWatchCallback,
  StateEngine,
  WatchOptions,
  WatchPath
} from './types.js';

const pathKeyCache = new WeakMap<JsonPath, string>();

export function createCrdtStateEngine(options?: CrdtStateEngineOptions): CrdtStateEngine {
  return new FrontierCrdtStateEngine(options);
}

class FrontierCrdtStateEngine implements CrdtStateEngine {
  private readonly doc: CrdtDocument;
  private readonly state: StateEngine;
  private readonly mapHandleCache = new Map<string, CrdtMapHandle>();
  private readonly counterHandleCache = new Map<string, CrdtCounterHandle>();
  private readonly binaryHandleCache = new Map<string, CrdtBinaryHandle>();
  private readonly listHandleCache = new Map<string, CrdtListHandle>();
  private readonly textHandleCache = new Map<string, CrdtTextHandle>();
  private readonly treeHandleCache = new Map<string, CrdtTreeHandle>();
  private readonly xmlHandleCache = new Map<string, CrdtXmlHandle>();
  private readonly richTextHandleCache = new Map<string, CrdtRichTextHandle>();

  constructor(options?: CrdtStateEngineOptions) {
    this.doc = createCrdtDocument(options as CrdtDocumentOptions | undefined);
    this.state = createStateEngine(this.doc.toJSON(), (options && options.state) as any) as any;
  }

  get actorId(): string {
    return this.doc.actorId;
  }

  toJSON(): JsonValue {
    return this.doc.toJSON();
  }

  get(): JsonValue | undefined {
    return this.state.get();
  }

  getHeads(): string[] {
    return this.doc.getHeads();
  }

  getVersion(): CrdtVersion {
    return this.doc.getVersion();
  }

  getStateVector(): CrdtStateVector {
    return this.doc.getStateVector();
  }

  change(callback: (tx: CrdtTransaction) => void, options?: CrdtChangeOptions): CrdtCommitResult {
    return this.publish(this.doc.change(callback, options));
  }

  set(path: WatchPath, value: JsonValue): CrdtCommitResult {
    return this.publish(this.doc.set(path, value));
  }

  delete(path: WatchPath): CrdtCommitResult {
    return this.publish(this.doc.delete(path));
  }

  getConflict(path: WatchPath): CrdtConflict | undefined {
    return this.doc.getConflict(path);
  }

  getConflictSummary(path: WatchPath): CrdtConflictSummary | undefined {
    return this.doc.getConflictSummary(path);
  }

  getConflicts(path?: WatchPath): CrdtConflict[] {
    return this.doc.getConflicts(path);
  }

  getConflictSummaries(path?: WatchPath): CrdtConflictSummary[] {
    return this.doc.getConflictSummaries(path);
  }

  getConflictAt(version: CrdtVersion, path: WatchPath): CrdtConflict | undefined {
    return this.doc.getConflictAt(version, path);
  }

  getConflictSummaryAt(version: CrdtVersion, path: WatchPath): CrdtConflictSummary | undefined {
    return this.doc.getConflictSummaryAt(version, path);
  }

  getConflictsAt(version: CrdtVersion, path?: WatchPath): CrdtConflict[] {
    return this.doc.getConflictsAt(version, path);
  }

  getConflictSummariesAt(version: CrdtVersion, path?: WatchPath): CrdtConflictSummary[] {
    return this.doc.getConflictSummariesAt(version, path);
  }

  resolveConflict(
    path: WatchPath,
    resolution: CrdtConflictResolution,
    options?: CrdtConflictResolutionOptions
  ): CrdtCommitResult {
    return this.publish(this.doc.resolveConflict(path, resolution, options));
  }

  map(path: WatchPath): CrdtMapHandle {
    const key = watchPathCacheKey(path);
    const cached = this.mapHandleCache.get(key);
    if (cached !== undefined) return cached;
    const handle = this.doc.map(path);
    const normalized = normalizeCrdtPath(path);
    const wrapped = {
      set: (field, value) => this.publish(handle.set(field, value)),
      delete: (field) => this.publish(handle.delete(field)),
      getConflict: (field) => handle.getConflict(field),
      getConflictSummary: (field) => handle.getConflictSummary(field),
      getConflicts: () => handle.getConflicts(),
      getConflictSummaries: () => handle.getConflictSummaries(),
      resolveConflict: (field, resolution, options) => this.publish(handle.resolveConflict(field, resolution, options)),
      map: (field) => this.map(appendPathSegment(normalized, field)),
      counter: (field) => this.counter(appendPathSegment(normalized, field)),
      binary: (field) => this.binary(appendPathSegment(normalized, field)),
      list: (field) => this.list(appendPathSegment(normalized, field)),
      text: (field) => this.text(appendPathSegment(normalized, field)),
      tree: (field) => this.tree(appendPathSegment(normalized, field)),
      xml: (field) => this.xml(appendPathSegment(normalized, field))
    };
    this.mapHandleCache.set(key, wrapped);
    return wrapped;
  }

  counter(path: WatchPath): CrdtCounterHandle {
    const key = watchPathCacheKey(path);
    const cached = this.counterHandleCache.get(key);
    if (cached !== undefined) return cached;
    const handle = this.doc.counter(path);
    const wrapped = {
      increment: (delta) => this.publish(handle.increment(delta)),
      decrement: (delta) => this.publish(handle.decrement(delta))
    };
    this.counterHandleCache.set(key, wrapped);
    return wrapped;
  }

  binary(path: WatchPath): CrdtBinaryHandle {
    const key = watchPathCacheKey(path);
    const cached = this.binaryHandleCache.get(key);
    if (cached !== undefined) return cached;
    const handle = this.doc.binary(path);
    const wrapped = {
      set: (value) => this.publish(handle.set(value)),
      get: () => handle.get(),
      delete: () => this.publish(handle.delete())
    };
    this.binaryHandleCache.set(key, wrapped);
    return wrapped;
  }

  list(path: WatchPath): CrdtListHandle {
    const key = watchPathCacheKey(path);
    const cached = this.listHandleCache.get(key);
    if (cached !== undefined) return cached;
    const handle = this.doc.list(path);
    const wrapped = {
      insert: (index, values) => this.publish(handle.insert(index, values)),
      delete: (index, count) => this.publish(handle.delete(index, count)),
      move: (fromIndex, toIndex, count) => this.publish(handle.move(fromIndex, toIndex, count))
    };
    this.listHandleCache.set(key, wrapped);
    return wrapped;
  }

  text(path: WatchPath): CrdtTextHandle {
    const key = watchPathCacheKey(path);
    const cached = this.textHandleCache.get(key);
    if (cached !== undefined) return cached;
    const handle = this.doc.text(path);
    const wrapped = {
      insert: (index, text) => this.publish(handle.insert(index, text)),
      delete: (index, count) => this.publish(handle.delete(index, count)),
      splice: (index, deleteCount, insert) => this.publish(handle.splice(index, deleteCount, insert)),
      spliceBatch: (splices) => this.publish(handle.spliceBatch(splices)),
      spliceColumnBatch: (indexes, deleteCounts, inserts, insertLengths) =>
        this.publish(handle.spliceColumnBatch(indexes, deleteCounts, inserts, insertLengths))
    };
    this.textHandleCache.set(key, wrapped);
    return wrapped;
  }

  tree(path: WatchPath): CrdtTreeHandle {
    const key = watchPathCacheKey(path);
    const cached = this.treeHandleCache.get(key);
    if (cached !== undefined) return cached;
    const handle = this.doc.tree(path);
    const wrapped: CrdtTreeHandle = {
      value: () => handle.value(),
      createNode: (parentId, value, index) => {
        const result = handle.createNode(parentId, value, index);
        this.publish(result);
        return result;
      },
      move: (nodeId, parentId, index) => this.publish(handle.move(nodeId, parentId, index)),
      setValue: (nodeId, value) => this.publish(handle.setValue(nodeId, value)),
      delete: (nodeId) => this.publish(handle.delete(nodeId))
    };
    this.treeHandleCache.set(key, wrapped);
    return wrapped;
  }

  xml(path: WatchPath): CrdtXmlHandle {
    const key = watchPathCacheKey(path);
    const cached = this.xmlHandleCache.get(key);
    if (cached !== undefined) return cached;
    const handle = this.doc.xml(path);
    const wrapped: CrdtXmlHandle = {
      value: () => handle.value(),
      toString: () => handle.toString(),
      insertElement: (parentId, index, name, attributes) => {
        const result = handle.insertElement(parentId, index, name, attributes);
        this.publish(result);
        return result;
      },
      insertText: (parentId, index, text) => {
        const result = handle.insertText(parentId, index, text);
        this.publish(result);
        return result;
      },
      move: (nodeId, parentId, index) => this.publish(handle.move(nodeId, parentId, index)),
      delete: (nodeId) => this.publish(handle.delete(nodeId)),
      setAttribute: (nodeId, field, value) => this.publish(handle.setAttribute(nodeId, field, value)),
      removeAttribute: (nodeId, field) => this.publish(handle.removeAttribute(nodeId, field))
    };
    this.xmlHandleCache.set(key, wrapped);
    return wrapped;
  }

  richText(path: WatchPath): CrdtRichTextHandle {
    const key = watchPathCacheKey(path);
    const cached = this.richTextHandleCache.get(key);
    if (cached !== undefined) return cached;
    const handle = this.doc.richText(path);
    const wrapped: CrdtRichTextHandle = {
      value: () => handle.value(),
      getText: () => handle.getText(),
      getSpans: () => handle.getSpans(),
      getEmbeds: () => handle.getEmbeds(),
      getBlocks: () => handle.getBlocks(),
      getAttributes: (index) => handle.getAttributes(index),
      toDelta: () => handle.toDelta(),
      createCursor: (index, options) => handle.createCursor(index, options),
      resolveCursor: (cursor) => handle.resolveCursor(cursor),
      createSelection: (anchor, focus, options) => handle.createSelection(anchor, focus, options),
      resolveSelection: (selection) => handle.resolveSelection(selection),
      fromDelta: (delta) => this.publish(handle.fromDelta(delta)),
      applyDelta: (delta) => this.publish(handle.applyDelta(delta)),
      insert: (index, text, attributes) => this.publish(handle.insert(index, text, attributes)),
      insertEmbed: (index, value, attributes) => this.publish(handle.insertEmbed(index, value, attributes)),
      delete: (index, count) => this.publish(handle.delete(index, count)),
      format: (index, length, attributes, options) => this.publish(handle.format(index, length, attributes, options)),
      clearFormat: (index, length, keys) => this.publish(handle.clearFormat(index, length, keys)),
      updateEmbed: (index, value, attributes) => this.publish(handle.updateEmbed(index, value, attributes)),
      formatBlock: (index, attributes) => this.publish(handle.formatBlock(index, attributes)),
      clearBlock: (index) => this.publish(handle.clearBlock(index))
    };
    this.richTextHandleCache.set(key, wrapped);
    return wrapped;
  }

  applyUpdate(update: ArrayBuffer | ArrayBufferView | CrdtUpdate): CrdtCommitResult {
    return this.publish(this.doc.applyUpdate(update));
  }

  encodeStateAsUpdate(stateVector?: CrdtStateVector | null): Uint8Array {
    return this.doc.encodeStateAsUpdate(stateVector);
  }

  exportUpdate(stateVector?: CrdtStateVector | null): Uint8Array {
    return this.doc.exportUpdate(stateVector);
  }

  exportChangesSince(version?: CrdtVersion | null): Uint8Array {
    return this.doc.exportChangesSince(version);
  }

  exportChangesBetween(fromVersion?: CrdtVersion | null, toVersion?: CrdtVersion | null): Uint8Array {
    return this.doc.exportChangesBetween(fromVersion, toVersion);
  }

  changesSince(version?: CrdtVersion | null): CrdtOperation[] {
    return this.doc.changesSince(version);
  }

  changesBetween(fromVersion?: CrdtVersion | null, toVersion?: CrdtVersion | null): CrdtOperation[] {
    return this.doc.changesBetween(fromVersion, toVersion);
  }

  getHistory(options?: CrdtHistoryOptions): CrdtHistoryEntry[] {
    return this.doc.getHistory(options);
  }

  forEachHistory(callback: CrdtHistoryVisitor, options?: CrdtHistoryOptions): void {
    this.doc.forEachHistory(callback, options);
  }

  getCommitMetadata(version?: CrdtVersion | CrdtOperationId | null): JsonObject | undefined {
    return this.doc.getCommitMetadata(version);
  }

  markVersion(name: string, options?: CrdtVersionMarkOptions): CrdtVersionMark {
    return this.doc.markVersion(name, options);
  }

  getVersionMark(name: string): CrdtVersionMark | undefined {
    return this.doc.getVersionMark(name);
  }

  listVersionMarks(): CrdtVersionMark[] {
    return this.doc.listVersionMarks();
  }

  deleteVersionMark(name: string): boolean {
    return this.doc.deleteVersionMark(name);
  }

  viewMark(name: string): JsonValue {
    return this.doc.viewMark(name);
  }

  checkoutMark(name: string, options?: CrdtForkOptions): CrdtDocument {
    return this.doc.checkoutMark(name, options);
  }

  snapshotMark(name: string, options?: CrdtSnapshotOptions): CrdtSnapshot {
    return this.doc.snapshotMark(name, options);
  }

  inspectVersion(version?: CrdtVersion | null, options?: CrdtVersionInfoOptions): CrdtVersionInfo {
    return this.doc.inspectVersion(version, options);
  }

  compareVersions(left?: CrdtVersion | null, right?: CrdtVersion | null): CrdtVersionRelation {
    return this.doc.compareVersions(left, right);
  }

  captureFrame(options?: CrdtFrameCaptureOptions): CrdtFrameReference {
    return this.doc.captureFrame(options);
  }

  evaluateFrame(frame: CrdtFrameReference, options?: CrdtFrameEvaluationOptions): CrdtFrameEvaluation {
    return this.doc.evaluateFrame(frame, options);
  }

  snapshot(options?: CrdtSnapshotOptions): CrdtSnapshot {
    return this.doc.snapshot(options);
  }

  applySnapshot(snapshot: CrdtSnapshot): CrdtCommitResult {
    return this.publish(this.doc.applySnapshot(snapshot));
  }

  viewAt(version?: CrdtVersion | null): JsonValue {
    return this.doc.viewAt(version);
  }

  checkout(version?: CrdtVersion | null, options?: CrdtForkOptions): CrdtDocument {
    return this.doc.checkout(version, options);
  }

  fork(options?: CrdtForkOptions): CrdtDocument {
    return this.doc.fork(options);
  }

  createCursor(path: WatchPath, index: number, options?: CrdtCursorOptions): CrdtTextCursor {
    return this.doc.createCursor(path, index, options);
  }

  resolveCursor(cursor: CrdtTextCursor): CrdtResolvedCursor {
    return this.doc.resolveCursor(cursor);
  }

  createSelection(path: WatchPath, anchor: number, focus: number, options?: CrdtSelectionOptions): CrdtTextSelection {
    return this.doc.createSelection(path, anchor, focus, options);
  }

  resolveSelection(selection: CrdtTextSelection): CrdtResolvedSelection {
    return this.doc.resolveSelection(selection);
  }

  getProfile(): CrdtProfile {
    return this.doc.getProfile();
  }

  loadProfile(profile?: CrdtProfile | null): void {
    this.doc.loadProfile(profile);
  }

  watch(path: WatchPath, callback: PatchWatchCallback): PatchSubscription;
  watch(path: WatchPath, fields: WatchPath[], callback: PatchWatchCallback): PatchSubscription;
  watch(options: WatchOptions, callback: PatchWatchCallback): PatchSubscription;
  watch(pathOrOptions: WatchPath | WatchOptions, fieldsOrCallback: WatchPath[] | PatchWatchCallback, callback?: PatchWatchCallback): PatchSubscription {
    return this.state.watch(pathOrOptions as any, fieldsOrCallback as any, callback as any);
  }

  view(path: WatchPath): DeltaView;
  view(options: DeltaViewOptions): DeltaView;
  view(pathOrOptions: WatchPath | DeltaViewOptions): DeltaView {
    return this.state.view(pathOrOptions as any);
  }

  clear(): void {
    this.state.clear();
  }

  private publish(result: CrdtCommitResult): CrdtCommitResult {
    if (result.viewPatch.length !== 0) this.state.commitPatch(result.viewPatch);
    return result;
  }
}

function appendPathSegment(path: JsonPath, segment: string | number): JsonPath {
  if (path.length === 0) return [segment];
  if (path.length === 1) return [path[0], segment];
  const next = new Array(path.length + 1);
  for (let i = 0, length = path.length; i < length; i++) next[i] = path[i];
  next[path.length] = segment;
  return next;
}

function normalizeCrdtPath(path: WatchPath): JsonPath {
  if (Array.isArray(path)) return path.slice();
  return getCachedPointerPath(path).slice();
}

function watchPathCacheKey(path: WatchPath): string {
  return typeof path === 'string' ? 'p:' + path : 'a:' + pathKey(path);
}

function pathKey(path: JsonPath): string {
  const cached = pathKeyCache.get(path);
  if (cached !== undefined) return cached;
  const key = JSON.stringify(path);
  pathKeyCache.set(path, key);
  return key;
}
