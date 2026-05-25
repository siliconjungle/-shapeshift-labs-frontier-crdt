import { cloneJson } from '@shapeshift-labs/frontier/clone';
import type {
  CrdtBranch,
  CrdtBranchMergeKind,
  CrdtBranchMergeOptions,
  CrdtBranchMergePreview,
  CrdtBranchOptions,
  CrdtBranchStatus,
  CrdtDocument,
  CrdtForkOptions,
  CrdtHistoryEntry,
  CrdtHistoryOptions,
  CrdtHistoryVisitor,
  CrdtOperation,
  CrdtOperationId,
  CrdtSnapshot,
  CrdtSnapshotOptions,
  CrdtVersion,
  CrdtVersionInfo,
  CrdtVersionInfoOptions,
  CrdtVersionMark,
  CrdtVersionMarkOptions,
  CrdtVersionRelation
} from './types.js';

export type {
  CrdtBranch,
  CrdtBranchMergeKind,
  CrdtBranchMergeOptions,
  CrdtBranchMergePreview,
  CrdtBranchOptions,
  CrdtBranchStatus,
  CrdtForkOptions,
  CrdtHistoryEntry,
  CrdtHistoryOptions,
  CrdtHistoryVisitor,
  CrdtSnapshot,
  CrdtSnapshotOptions,
  CrdtVersion,
  CrdtVersionInfo,
  CrdtVersionInfoOptions,
  CrdtVersionMark,
  CrdtVersionMarkOptions,
  CrdtVersionRelation
} from './types.js';

export function createCrdtBranch(source: CrdtDocument, options?: CrdtBranchOptions): CrdtBranch {
  return new FrontierCrdtBranch(source, options);
}

class FrontierCrdtBranch implements CrdtBranch {
  readonly name: string;
  readonly doc: CrdtDocument;
  readonly baseVersion: CrdtVersion | null;

  constructor(source: CrdtDocument, options?: CrdtBranchOptions) {
    this.name = options && options.name ? options.name : 'branch';
    const hasExplicitBase = options !== undefined && Object.prototype.hasOwnProperty.call(options, 'baseVersion');
    this.baseVersion = hasExplicitBase
      ? cloneCrdtVersion(options ? options.baseVersion ?? null : null)
      : source.getHeads().slice();
    const forkOptions: CrdtForkOptions = {
      actorId: options && options.actorId,
      profile: options && options.profile
    };
    this.doc = hasExplicitBase
      ? source.checkout(options ? options.baseVersion ?? null : null, forkOptions)
      : source.fork(forkOptions);
  }

  getBaseVersion(): CrdtVersion | null {
    return cloneCrdtVersion(this.baseVersion);
  }

  getVersion(): CrdtVersion {
    return this.doc.getVersion();
  }

  getStatus(): CrdtBranchStatus {
    const version = this.getVersion();
    const info = this.doc.inspectVersion(version);
    const changeCount = this.changesFromBase().length;
    const relationToBase = this.baseVersion === null
      ? changeCount === 0 ? 'equal' : 'after'
      : this.doc.compareVersions(version, this.baseVersion);
    return {
      name: this.name,
      baseVersion: this.getBaseVersion(),
      version,
      relationToBase,
      changeCount,
      heads: info.heads,
      stateVector: info.stateVector
    };
  }

  inspectBase(options?: CrdtVersionInfoOptions): CrdtVersionInfo {
    return this.doc.inspectVersion(branchBaseReadVersion(this.baseVersion), options);
  }

  inspectVersion(version?: CrdtVersion | null, options?: CrdtVersionInfoOptions): CrdtVersionInfo {
    return this.doc.inspectVersion(version, options);
  }

  compareVersions(left?: CrdtVersion | null, right?: CrdtVersion | null): CrdtVersionRelation {
    return this.doc.compareVersions(left, right);
  }

  snapshot(options?: CrdtSnapshotOptions): CrdtSnapshot {
    return this.doc.snapshot(options);
  }

  snapshotBase(options?: CrdtSnapshotOptions): CrdtSnapshot {
    return this.doc.snapshot({
      ...(options || {}),
      from: null,
      version: branchBaseReadVersion(this.baseVersion)
    });
  }

  snapshotFromBase(options?: CrdtSnapshotOptions): CrdtSnapshot {
    return this.doc.snapshot({
      ...(options || {}),
      from: this.getBaseVersion()
    });
  }

  checkoutBase(options?: CrdtForkOptions): CrdtDocument {
    return this.doc.checkout(branchBaseReadVersion(this.baseVersion), options);
  }

  checkout(version?: CrdtVersion | null, options?: CrdtForkOptions): CrdtDocument {
    return this.doc.checkout(version, options);
  }

  fork(options?: CrdtBranchOptions): CrdtBranch {
    return createCrdtBranch(this.doc, options);
  }

  viewBase() {
    return this.doc.viewAt(branchBaseReadVersion(this.baseVersion));
  }

  viewAt(version?: CrdtVersion | null) {
    return this.doc.viewAt(version);
  }

  exportChangesSince(version?: CrdtVersion | null): Uint8Array {
    return this.doc.exportChangesSince(version);
  }

  exportChangesBetween(fromVersion?: CrdtVersion | null, toVersion?: CrdtVersion | null): Uint8Array {
    return this.doc.exportChangesBetween(fromVersion, toVersion);
  }

  exportChangesFromBase(): Uint8Array {
    return this.doc.exportChangesSince(this.baseVersion);
  }

  changesSince(version?: CrdtVersion | null): CrdtOperation[] {
    return this.doc.changesSince(version);
  }

  changesBetween(fromVersion?: CrdtVersion | null, toVersion?: CrdtVersion | null): CrdtOperation[] {
    return this.doc.changesBetween(fromVersion, toVersion);
  }

  changesFromBase(): CrdtOperation[] {
    return this.doc.changesSince(this.baseVersion);
  }

  getHistory(options?: CrdtHistoryOptions): CrdtHistoryEntry[] {
    return this.doc.getHistory(options);
  }

  forEachHistory(callback: CrdtHistoryVisitor, options?: CrdtHistoryOptions): void {
    this.doc.forEachHistory(callback, options);
  }

  getCommitMetadata(version?: CrdtVersion | CrdtOperationId | null) {
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

  viewMark(name: string) {
    return this.doc.viewMark(name);
  }

  checkoutMark(name: string, options?: CrdtForkOptions): CrdtDocument {
    return this.doc.checkoutMark(name, options);
  }

  snapshotMark(name: string, options?: CrdtSnapshotOptions): CrdtSnapshot {
    return this.doc.snapshotMark(name, options);
  }

  previewMergeFrom(source: CrdtDocument | CrdtBranch): CrdtBranchMergePreview {
    return createBranchMergePreview(source, this);
  }

  previewMergeInto(target: CrdtDocument | CrdtBranch): CrdtBranchMergePreview {
    return createBranchMergePreview(this, target);
  }

  mergeFrom(source: CrdtDocument | CrdtBranch, options?: CrdtBranchMergeOptions) {
    const sourceDoc = isCrdtBranch(source) ? source.doc : source;
    const stateVector = options && Object.prototype.hasOwnProperty.call(options, 'stateVector')
      ? options.stateVector ?? null
      : this.doc.getStateVector();
    return this.doc.applySnapshot(sourceDoc.snapshot({ from: stateVector }));
  }

  mergeInto(target: CrdtDocument | CrdtBranch, options?: CrdtBranchMergeOptions) {
    const targetDoc = isCrdtBranch(target) ? target.doc : target;
    const stateVector = options && Object.prototype.hasOwnProperty.call(options, 'stateVector')
      ? options.stateVector ?? null
      : targetDoc.getStateVector();
    return targetDoc.applySnapshot(this.doc.snapshot({ from: stateVector }));
  }
}

function isCrdtBranch(value: CrdtDocument | CrdtBranch): value is CrdtBranch {
  return 'doc' in value && 'mergeFrom' in value;
}

function createBranchMergePreview(
  source: CrdtDocument | CrdtBranch,
  target: CrdtDocument | CrdtBranch
): CrdtBranchMergePreview {
  const sourceIsBranch = isCrdtBranch(source);
  const sourceDoc = sourceIsBranch ? source.doc : source;
  const targetDoc = isCrdtBranch(target) ? target.doc : target;
  const targetStateVector = targetDoc.getStateVector();
  const sourceStateVector = sourceDoc.getStateVector();
  const sourceChanges = sourceDoc.changesSince(targetStateVector);
  const targetChanges = targetDoc.changesSince(sourceStateVector);
  const snapshot = sourceDoc.snapshot({ from: targetStateVector });
  return {
    kind: classifyBranchMerge(sourceChanges.length, targetChanges.length),
    sourceName: sourceIsBranch ? source.name : undefined,
    baseVersion: sourceIsBranch ? cloneCrdtVersion(source.getBaseVersion()) : null,
    sourceVersion: sourceDoc.getVersion(),
    targetVersion: targetDoc.getVersion(),
    sourceChangeCount: sourceChanges.length,
    targetChangeCount: targetChanges.length,
    updateBytes: snapshot.update.byteLength,
    metadataCount: snapshot.metadata === undefined ? 0 : snapshot.metadata.length,
    snapshot
  };
}

function classifyBranchMerge(sourceChangeCount: number, targetChangeCount: number): CrdtBranchMergeKind {
  if (sourceChangeCount === 0) return 'already-merged';
  return targetChangeCount === 0 ? 'fast-forward' : 'merge';
}

function branchBaseReadVersion(version: CrdtVersion | null): CrdtVersion {
  return version === null ? {} : cloneCrdtVersion(version) as CrdtVersion;
}

function cloneCrdtVersion(version: CrdtVersion | null): CrdtVersion | null {
  return version === null ? null : cloneJson(version as any) as CrdtVersion;
}
