/** JSON primitive values supported by the core diff and patch APIs. */
export type JsonPrimitive = null | boolean | number | string;

/** Any JSON-shaped value accepted by the public API. */
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;

/** A plain JSON object. Runtime validation accepts plain and null-prototype objects. */
export interface JsonObject {
  [key: string]: JsonValue;
}

export type JsonRecord = JsonObject;

/** A JSON array. */
export interface JsonArray extends Array<JsonValue> {}

export type PathSegment = string | number;

/** Array-form JSON path used by compact patch operations. */
export type JsonPath = PathSegment[];

export type ObjectKey = string | number;

/** Trusted cache/equality token returned by version or fingerprint producers. */
export type CacheToken = string | number | boolean | symbol | bigint | object;
export type Token = CacheToken;

/** Compact patch operation tuple. Prefer helpers over constructing these manually. */
export type PatchOperation =
  | [0, JsonPath, JsonValue]
  | [1, JsonPath]
  | [2, JsonPath, number]
  | [3, JsonPath, JsonValue[]]
  | [4, JsonPath, JsonObject]
  | [5, JsonPath, number, number, string]
  | [6, JsonPath, number, number, JsonValue[]]
  | [7, JsonPath, number, number]
  | [8, JsonPath, number, number, number]
  | [9, JsonPath, number[], JsonValue[]]
  | [10, JsonPath, number[], JsonObject[]]
  | [11, JsonPath, number[], number[], JsonValue[]]
  | [12, JsonPath, number[], JsonPath[], JsonValue[]]
  | [13, JsonPath, JsonPrimitive[]]
  | [14, JsonPath, number, string, string, JsonPrimitive[], JsonPrimitive[]];

/** Compact patch format emitted by diff() and consumed by applyPatch(). */
export type Patch = PatchOperation[];

export type CrdtActorId = string;
export type CrdtOperationId = string;

/** Compact state-vector summary used to request only CRDT operations a peer is missing. */
export interface CrdtStateVector {
  [actorId: string]: number;
}

export type CrdtStateVectorInput = CrdtStateVector | ArrayBuffer | ArrayBufferView | string;

export type CrdtStateVectorFormat = 'object' | 'json' | 'base64url';

export interface CrdtStateVectorConvertOptions {
  /** Output representation. `json` returns deterministic JSON bytes; `base64url` returns URL/header-safe text. */
  format?: CrdtStateVectorFormat;
}

export type CrdtOperation =
  | {
      type: 'set';
      id: CrdtOperationId;
      actor: CrdtActorId;
      seq: number;
      deps: CrdtOperationId[];
      path: JsonPath;
      value: JsonValue;
    }
  | {
      type: 'del';
      id: CrdtOperationId;
      actor: CrdtActorId;
      seq: number;
      deps: CrdtOperationId[];
      path: JsonPath;
    }
  | {
      type: 'mapSetRun';
      id: CrdtOperationId;
      actor: CrdtActorId;
      seq: number;
      deps: CrdtOperationId[];
      path: JsonPath;
      keys: string[];
      values: JsonValue[];
      count: number;
    }
  | {
      type: 'counter';
      id: CrdtOperationId;
      actor: CrdtActorId;
      seq: number;
      deps: CrdtOperationId[];
      path: JsonPath;
      delta: number;
    }
  | {
      type: 'binarySet';
      id: CrdtOperationId;
      actor: CrdtActorId;
      seq: number;
      deps: CrdtOperationId[];
      path: JsonPath;
      bytes: string;
    }
  | {
      type: 'treeCreate';
      id: CrdtOperationId;
      actor: CrdtActorId;
      seq: number;
      deps: CrdtOperationId[];
      path: JsonPath;
      nodeId: string;
      parent: string | null;
      after: string | null;
      value: JsonValue;
    }
  | {
      type: 'treeMove';
      id: CrdtOperationId;
      actor: CrdtActorId;
      seq: number;
      deps: CrdtOperationId[];
      path: JsonPath;
      nodeId: string;
      parent: string | null;
      after: string | null;
    }
  | {
      type: 'treeSet';
      id: CrdtOperationId;
      actor: CrdtActorId;
      seq: number;
      deps: CrdtOperationId[];
      path: JsonPath;
      nodeId: string;
      value: JsonValue;
    }
  | {
      type: 'treeDel';
      id: CrdtOperationId;
      actor: CrdtActorId;
      seq: number;
      deps: CrdtOperationId[];
      path: JsonPath;
      nodeId: string;
    }
  | {
      type: 'listInsert';
      id: CrdtOperationId;
      actor: CrdtActorId;
      seq: number;
      deps: CrdtOperationId[];
      path: JsonPath;
      after: string | null;
      values: JsonValue[];
    }
  | {
      type: 'listRun';
      id: CrdtOperationId;
      actor: CrdtActorId;
      seq: number;
      deps: CrdtOperationId[];
      path: JsonPath;
      after: string | null;
      values: JsonValue[];
      count: number;
    }
  | {
      type: 'listDel';
      id: CrdtOperationId;
      actor: CrdtActorId;
      seq: number;
      deps: CrdtOperationId[];
      path: JsonPath;
      elems: string[];
    }
  | {
      type: 'textInsert';
      id: CrdtOperationId;
      actor: CrdtActorId;
      seq: number;
      deps: CrdtOperationId[];
      path: JsonPath;
      after: string | null;
      text: string;
    }
  | {
      type: 'textRun';
      id: CrdtOperationId;
      actor: CrdtActorId;
      seq: number;
      deps: CrdtOperationId[];
      path: JsonPath;
      after: string | null;
      text: string;
      count: number;
    }
  | {
      type: 'textDel';
      id: CrdtOperationId;
      actor: CrdtActorId;
      seq: number;
      deps: CrdtOperationId[];
      path: JsonPath;
      elems: string[];
    }
  | {
      type: 'textDelRange';
      id: CrdtOperationId;
      actor: CrdtActorId;
      seq: number;
      deps: CrdtOperationId[];
      path: JsonPath;
      start: string;
      count: number;
      span: 'index' | 'seq';
    };

/** Native Frontier CRDT update. It is idempotent and can be applied in any order. */
export interface CrdtUpdate {
  actor: CrdtActorId;
  seq: number;
  deps: CrdtOperationId[];
  ops: CrdtOperation[];
  metadata?: JsonObject;
  metadataEntries?: CrdtCommitMetadataEntry[];
}

export type CrdtUpdateInput = ArrayBuffer | ArrayBufferView | CrdtUpdate;

export type CrdtUpdateStateVectorInput = CrdtStateVector | CrdtUpdateInput | readonly CrdtUpdateInput[];

export interface CrdtUpdateActorRange {
  actor: CrdtActorId;
  /** First actor sequence number represented by this contiguous range. */
  start: number;
  /** Last actor sequence number represented by this contiguous range. */
  end: number;
}

export interface CrdtUpdateInfo {
  /** Number of encoded bytes when the input was byte-backed, otherwise the size after encoding the update. */
  byteLength: number;

  /** Update envelope actor. Individual operations can still contain other actors. */
  actor: CrdtActorId;

  /** Update envelope sequence. */
  seq: number;

  /** Update envelope dependencies. */
  deps: CrdtOperationId[];

  /** Number of operation records in the update, before expanding run operations. */
  opCount: number;

  /** Number of logical actor/sequence operations represented after run expansion. */
  logicalOpCount: number;

  /** Actors represented by operation records in this update. */
  actors: CrdtActorId[];

  /** Causal heads of the operations in this update. */
  heads: CrdtOperationId[];

  /** Contiguous actor/sequence ranges represented by this update. */
  ranges: CrdtUpdateActorRange[];

  /** Lower actor/sequence boundary implied by the represented ranges. */
  fromStateVector: CrdtStateVector;

  /** Upper actor/sequence boundary implied by the represented ranges, even when the ranges are not a full prefix. */
  toStateVector: CrdtStateVector;

  /** Contiguous state-vector prefix represented by this update's operation ranges. */
  stateVector: CrdtStateVector;

  /** Optional update-envelope metadata. */
  metadata?: JsonObject;

  /** Durable commit metadata entries carried by compacted/merged updates. */
  metadataEntries?: CrdtCommitMetadataEntry[];
}

export type CrdtUpdateFormat = 'auto' | 'json' | 'object' | 'base64url';

export interface CrdtUpdateConvertOptions {
  /** Output representation. `auto` uses Frontier's compact codec; `json` forces JSON; `base64url` returns text. */
  format?: CrdtUpdateFormat;

  /** Optional learned CRDT profile used when `format` is `auto` or `base64url`. */
  profile?: CrdtProfile | null;
}

export interface CrdtUpdateObfuscateOptions {
  /** Output representation. `auto` uses Frontier's compact update codec; `json` forces a JSON envelope. */
  format?: 'auto' | 'json';

  /** Keep durable commit metadata unchanged. Defaults to false. */
  preserveMetadata?: boolean;
}

export type CrdtUpdatePathFilterMode = 'subtree' | 'exact';

export interface CrdtUpdateFilterOptions {
  /** Return only operations newer than this contiguous actor coverage. */
  stateVector?: CrdtStateVector | null;

  /** Return only operations authored by these actors. */
  actors?: readonly CrdtActorId[];

  /** Return only operation records whose causal head id is included. */
  heads?: readonly CrdtOperationId[];

  /** Return only operation records under these JSON paths. Defaults to subtree matching. */
  paths?: readonly JsonPath[];

  /** Path matching mode for `paths`. Defaults to `subtree`. */
  pathMode?: CrdtUpdatePathFilterMode;

  /** Return only these operation record types. */
  operationTypes?: readonly CrdtOperation['type'][];
}

export interface CrdtChangeOptions {
  /** Optional durable metadata for this local CRDT change. Metadata is replicated in JSON update envelopes. */
  metadata?: JsonObject;
}

export type CrdtVersion = CrdtStateVector | CrdtOperationId[];

export type CrdtVersionRelation = 'equal' | 'before' | 'after' | 'concurrent';

export type CrdtFrameEvaluationMode = 'version' | 'paths';

export interface CrdtFramePathEntry {
  path: JsonPath;
  exists: boolean;
  value?: JsonValue;
  valueCaptured?: boolean;
}

export interface CrdtFrameReference {
  version: CrdtVersion;
  heads: CrdtOperationId[];
  stateVector: CrdtStateVector;
  paths?: CrdtFramePathEntry[];
  mark?: string;
  metadata?: JsonObject;
}

export interface CrdtFrameCaptureOptions {
  version?: CrdtVersion | null;
  mark?: string;
  paths?: readonly WatchPath[];
  includeValues?: boolean;
  maxPaths?: number;
  metadata?: JsonObject;
}

export interface CrdtFrameEvaluationOptions {
  mode?: CrdtFrameEvaluationMode;
  paths?: readonly WatchPath[];
}

export interface CrdtFrameEvaluation {
  ok: boolean;
  relation: CrdtVersionRelation;
  mode: CrdtFrameEvaluationMode;
  checkedPaths: JsonPath[];
  changedPaths: JsonPath[];
  conflictingPaths: JsonPath[];
  reason?: 'equal' | 'version-changed' | 'future-version' | 'path-overlap' | 'path-value-changed';
}

export interface CrdtForkOptions {
  /** Actor id for the forked document. Omit to create a fresh local actor id. */
  actorId?: CrdtActorId;

  /** Profile to load into the fork. Defaults to the source document profile. */
  profile?: CrdtProfile | null;
}

export interface CrdtCursorOptions {
  /** Cursor association. Negative binds after the previous character; non-negative binds before the next character. */
  assoc?: -1 | 1 | number;
}

export interface CrdtTextCursor {
  type: 'text';
  path: JsonPath;
  /** Stable visible text element id when one is available. */
  anchor: string | null;
  /** How the anchor is interpreted when resolving the cursor in a changed document. */
  side: 'before' | 'after' | 'start' | 'end';
  /** Original association requested by the caller. */
  assoc: -1 | 1;
  /** Bounded visible code-point index at creation time, used as a fallback if the anchor was deleted. */
  index: number;
}

export interface CrdtResolvedCursor {
  path: JsonPath;
  index: number;
  assoc: -1 | 1;
  /** False when resolution had to fall back because the stable anchor is no longer visible. */
  found: boolean;
}

export interface CrdtSelectionOptions {
  anchorAssoc?: -1 | 1 | number;
  focusAssoc?: -1 | 1 | number;
}

export interface CrdtTextSelection {
  type: 'text-selection';
  anchor: CrdtTextCursor;
  focus: CrdtTextCursor;
}

export interface CrdtResolvedSelection {
  path: JsonPath;
  anchor: number;
  focus: number;
  found: boolean;
}

export interface CrdtPresenceState {
  actorId: CrdtActorId;
  clock: number;
  value: JsonObject | null;
}

export interface CrdtPresenceUpdate {
  actorId: CrdtActorId;
  clock: number;
  value: JsonObject | null;
}

export type CrdtPresenceUpdateInput =
  | ArrayBuffer
  | ArrayBufferView
  | string
  | CrdtPresenceUpdate
  | readonly CrdtPresenceUpdate[];

export interface CrdtAwarenessOptions {
  actorId?: CrdtActorId;
}

export interface CrdtAwareness {
  readonly actorId: CrdtActorId;
  getLocalState(): CrdtPresenceState | null;
  setLocalState(value: JsonObject | null): CrdtPresenceUpdate;
  clearLocalState(): CrdtPresenceUpdate;
  applyUpdate(update: ArrayBuffer | ArrayBufferView | string | CrdtPresenceUpdate): CrdtPresenceState | null;
  applyUpdates(update: CrdtPresenceUpdateInput): Array<CrdtPresenceState | null>;
  get(actorId: CrdtActorId): CrdtPresenceState | null;
  getStates(): CrdtPresenceState[];
  encodeUpdate(update: CrdtPresenceUpdate): Uint8Array;
  encodeStates(actorIds?: readonly CrdtActorId[]): Uint8Array;
}

/** Portable CRDT profile with learned operation/workload shape hints. */
export interface CrdtProfile {
  /** Profile format version. */
  version?: 1;

  /** CRDT runtime settings that can be saved and reloaded with the profile. */
  settings?: CrdtProfileSettings;

  /** Shared planning choices for CRDT codecs and text storage. */
  plans?: ProfilePlans;

  /** Learned per-path text workload profiles. */
  text?: CrdtTextProfile[];

  /** Learned document/update workload profiles that guide CRDT update codec selection. */
  workloads?: CrdtWorkloadProfile[];
}

export interface CrdtProfileSettings {
  /** Enable lightweight CRDT workload learning. Defaults to true for CRDT documents. */
  adaptive?: boolean;
}

export interface CrdtTextProfile {
  /** Text CRDT path this profile applies to. */
  path: JsonPath;

  /** Recognized workload family. */
  workload: 'positional-text';

  /** Preferred local text path for this workload. */
  strategy?: 'direct-splice' | 'batch-splice';

  /** Average visible-position edits per local transaction. */
  averageBatchSize?: number;

  /** Largest visible-position edit batch observed for this path. */
  maxBatchSize?: number;

  /** Number of local text transactions observed while learning. */
  transactions?: number;

  /** Number of visible-position edits observed while learning. */
  operations?: number;

  /** Learned threshold for enabling the visible-position route index. */
  routeIndexThreshold?: number;
}

export type CrdtUpdateCodecStrategy = 'auto' | 'json' | 'binary' | 'columnar-text';

export type CrdtWorkloadFamily =
  | 'text-heavy'
  | 'grid-like'
  | 'tree-move-heavy'
  | 'rich-text-mark-heavy'
  | 'sparse-actor'
  | 'mixed';

export interface CrdtWorkloadProfile {
  /** Recognized document/update workload family. */
  workload: CrdtWorkloadFamily;

  /** Preferred update codec for this workload. */
  update?: CrdtUpdateCodecStrategy;

  /** Local or integrated updates observed while learning this workload. */
  updates?: number;

  /** Logical CRDT operations observed while learning this workload. */
  operations?: number;

  /** Distinct actor ids observed in the learned sample. */
  actors?: number;

  /** Hot operation paths sampled for the workload. */
  paths?: JsonPath[];

  /** Optional shape counters used for diagnostics and benchmark notes. */
  textOps?: number;
  setOps?: number;
  treeOps?: number;
  richTextOps?: number;
  sparseActorGaps?: number;
}

export type CrdtConflictValueType = 'set' | 'delete' | 'binary';

export interface CrdtConflictValue {
  /** Operation id for this concurrent register value. */
  id: CrdtOperationId;

  /** Replica that produced this value. */
  actor: CrdtActorId;

  /** Actor-local sequence number for this value. */
  seq: number;

  /** Operation dependencies recorded when this value was created. */
  deps: CrdtOperationId[];

  /** Register value kind. Deletes are represented as tombstones. */
  type: CrdtConflictValueType;

  /** The affected register path. */
  path: JsonPath;

  /** True when this is Frontier's deterministic visible winner. */
  selected: boolean;

  /** True when this value is a delete tombstone. */
  deleted: boolean;

  /** JSON value for set/binary values. Omitted for delete tombstones. */
  value?: JsonValue;

  /** Optional durable commit metadata associated with this operation head. */
  metadata?: JsonObject;
}

export interface CrdtConflict {
  /** Register path with multiple concurrent maximal values. */
  path: JsonPath;

  /** Frontier's deterministic visible winner. Also present in values. */
  winner: CrdtConflictValue;

  /** Non-winning concurrent values. */
  losers: CrdtConflictValue[];

  /** All concurrent maximal values, winner first. */
  values: CrdtConflictValue[];
}

export interface CrdtConflictSummary {
  /** Register path with multiple concurrent maximal values. */
  path: JsonPath;

  /** Operation id selected by Frontier's deterministic visible register rule. */
  selectedId: CrdtOperationId;

  /** Number of concurrent maximal values at this path. */
  valueCount: number;

  /** Number of non-winning concurrent values at this path. */
  loserCount: number;

  /** True when at least one concurrent value is a delete tombstone. */
  hasDelete: boolean;

  /** Actors that currently contribute concurrent maximal values, sorted for stable UI output. */
  actors: CrdtActorId[];
}

export type CrdtConflictResolution =
  | CrdtConflictValue
  | { type: 'operation'; id: CrdtOperationId }
  | { type: 'value'; value: JsonValue }
  | { type: 'delete' };

export interface CrdtConflictResolutionOptions extends CrdtChangeOptions {}

/** Result of a local CRDT commit or remote update integration. */
export interface CrdtCommitResult {
  /** Encoded native CRDT update for peers or storage. */
  update: Uint8Array;

  /** Frontier patch from the previous materialized JSON view to the current one. */
  viewPatch: Patch;

  /** Current causal heads after the commit/update. */
  heads: CrdtOperationId[];

  /** Current state vector after the commit/update. */
  stateVector: CrdtStateVector;

  /** Optional commit metadata attached to this CRDT update. */
  metadata?: JsonObject;
}

/** Options for createCrdtDocument(). */
export interface CrdtDocumentOptions {
  /** Stable replica identifier. If omitted, a random local actor id is generated. */
  actorId?: CrdtActorId;

  /** Optional initial JSON value represented as a first local set operation. */
  initial?: JsonValue;

  /** Enable lightweight CRDT workload learning. Defaults to true. */
  adaptive?: boolean;

  /** Optional CRDT profile used to seed text/list workload choices. */
  profile?: CrdtProfile | null;
}

/** Options for createCrdtStateEngine(). */
export interface CrdtStateEngineOptions extends CrdtDocumentOptions {
  /** Options passed to the embedded patch-native state engine. */
  state?: StateEngineOptions;
}

export interface CrdtListHandle {
  /** Insert one JSON value or a run of JSON values at a visible list index. */
  insert(index: number, values: JsonValue | JsonValue[]): CrdtCommitResult;

  /** Delete visible list elements by index. Concurrent deletes are idempotent. */
  delete(index: number, count?: number): CrdtCommitResult;

  /** Move visible list elements within this list as one local CRDT update. */
  move(fromIndex: number, toIndex: number, count?: number): CrdtCommitResult;
}

export interface CrdtMapHandle {
  /** Set a field below this map/object path. */
  set(key: string | number, value: JsonValue): CrdtCommitResult;

  /** Delete a field below this map/object path. */
  delete(key: string | number): CrdtCommitResult;

  /** Inspect concurrent same-field register values for one child key. */
  getConflict(key: string | number): CrdtConflict | undefined;

  /** Return lightweight UI metadata for one child-key conflict. */
  getConflictSummary(key: string | number): CrdtConflictSummary | undefined;

  /** Inspect direct child-key register conflicts below this map path. */
  getConflicts(): CrdtConflict[];

  /** Return lightweight UI metadata for direct child-key conflicts below this map path. */
  getConflictSummaries(): CrdtConflictSummary[];

  /** Resolve a direct child-key register conflict with a chosen value or tombstone. */
  resolveConflict(
    key: string | number,
    resolution: CrdtConflictResolution,
    options?: CrdtConflictResolutionOptions
  ): CrdtCommitResult;

  /** Nested map/register helper below one field. */
  map(key: string | number): CrdtMapHandle;

  /** Nested numeric CRDT counter below one field. */
  counter(key: string | number): CrdtCounterHandle;

  /** Nested byte value helper below one field. */
  binary(key: string | number): CrdtBinaryHandle;

  /** Nested ordered list CRDT below one field. */
  list(key: string | number): CrdtListHandle;

  /** Nested ordered text CRDT below one field. */
  text(key: string | number): CrdtTextHandle;

  /** Nested movable document tree below one field. */
  tree(key: string | number): CrdtTreeHandle;

  /** Nested XML/document-fragment helper below one field. */
  xml(key: string | number): CrdtXmlHandle;
}

export interface CrdtCounterHandle {
  /** Add an integer delta to this CRDT counter. */
  increment(delta?: number): CrdtCommitResult;

  /** Subtract an integer delta from this CRDT counter. */
  decrement(delta?: number): CrdtCommitResult;
}

export interface CrdtBinaryJsonValue {
  $frontierBinary: string;
}

export interface CrdtBinaryHandle {
  /** Store a byte array at this path. The JSON view uses a portable tagged object. */
  set(value: ArrayBuffer | ArrayBufferView): CrdtCommitResult;

  /** Return the current byte array at this path, if present. */
  get(): Uint8Array | undefined;

  /** Delete the byte value at this path. */
  delete(): CrdtCommitResult;
}

export interface CrdtTreeNode {
  id: string;
  parent: string | null;
  index: number;
  value: JsonValue;
  children: CrdtTreeNode[];
}

export interface CrdtTreeCreateResult extends CrdtCommitResult {
  id: string;
}

export interface CrdtTreeHandle {
  /** Return the current nested tree view at this path. */
  value(): CrdtTreeNode[];

  /** Create a node under a parent, or at the root when parentId is null/omitted. */
  createNode(parentId?: string | null, value?: JsonValue, index?: number): CrdtTreeCreateResult;

  /** Move an existing node under a new parent/root and sibling index. */
  move(nodeId: string, parentId?: string | null, index?: number): CrdtCommitResult;

  /** Replace one node's JSON value without moving its children. */
  setValue(nodeId: string, value: JsonValue): CrdtCommitResult;

  /** Delete one node and its visible descendants. */
  delete(nodeId: string): CrdtCommitResult;
}

export type CrdtXmlNode =
  | { type: 'element'; name: string; attributes?: JsonObject; children?: CrdtXmlNode[] }
  | { type: 'text'; text: string };

export interface CrdtXmlHandle {
  /** Return the current XML/document-fragment tree. */
  value(): CrdtXmlNode[];

  /** Serialize the current XML/document-fragment tree. */
  toString(): string;

  /** Create an element node. */
  insertElement(parentId: string | null, index: number, name: string, attributes?: JsonObject): CrdtTreeCreateResult;

  /** Create a text node. */
  insertText(parentId: string | null, index: number, text: string): CrdtTreeCreateResult;

  /** Move an XML node. */
  move(nodeId: string, parentId?: string | null, index?: number): CrdtCommitResult;

  /** Delete an XML node and its descendants. */
  delete(nodeId: string): CrdtCommitResult;

  /** Set or replace one element attribute. */
  setAttribute(nodeId: string, key: string, value: JsonValue): CrdtCommitResult;

  /** Remove one element attribute. */
  removeAttribute(nodeId: string, key: string): CrdtCommitResult;
}

export interface CrdtTextSplice {
  index: number;
  deleteCount: number;
  insert: string;
  /** Optional trusted producer-provided code-point length for insert. */
  insertLength?: number;
}

export type CrdtTextSpliceTuple = readonly [
  index: number,
  deleteCount: number,
  insert: string,
  insertLength?: number
];

export type CrdtTextSpliceInput = CrdtTextSplice | CrdtTextSpliceTuple;

export interface CrdtTextHandle {
  /** Insert text at a visible code-point index. */
  insert(index: number, text: string): CrdtCommitResult;

  /** Delete text by visible code-point range. Concurrent deletes are idempotent. */
  delete(index: number, count?: number): CrdtCommitResult;

  /** Replace a visible code-point range with text in one local transaction step. */
  splice(index: number, deleteCount: number, insert: string): CrdtCommitResult;

  /** Apply several visible text replacements as one local transaction. */
  spliceBatch(splices: readonly CrdtTextSpliceInput[]): CrdtCommitResult;

  /** Apply positional text replacements from parallel columns. */
  spliceColumnBatch(
    indexes: ArrayLike<number>,
    deleteCounts: ArrayLike<number>,
    inserts: ArrayLike<string>,
    insertLengths?: ArrayLike<number>
  ): CrdtCommitResult;
}

export interface CrdtRichTextSpan {
  /** Stable mark identifier used for deterministic same-key conflict ordering. */
  id?: string;
  start: number;
  end: number;
  attributes: JsonObject;
  /** Stable CRDT text range. When present it is resolved before materializing spans. */
  range?: CrdtTextSelection;
  /** How inserts at the mark boundaries inherit this mark. Defaults to `after`. */
  expand?: CrdtRichTextExpand;
}

export type CrdtRichTextExpand = 'after' | 'before' | 'none' | 'both';

export interface CrdtRichTextFormatOptions {
  /**
   * Mark boundary expansion policy, following the rich-text convention used by
   * Loro/Peritext-style text CRDTs. `after` makes bold-like marks grow at the
   * end boundary, `none` is useful for links/comments, and `both`/`before`
   * are available for editor-specific policies.
   */
  expand?: CrdtRichTextExpand;
  /** Optional stable ID for deterministic tests or editor-owned mark identity. */
  id?: string;
}

export interface CrdtRichTextEmbed {
  index: number;
  value: JsonObject;
  attributes?: JsonObject;
}

export interface CrdtRichTextBlock {
  index: number;
  attributes: JsonObject;
}

export interface CrdtRichTextValue {
  text: string;
  spans?: CrdtRichTextSpan[];
  embeds?: CrdtRichTextEmbed[];
  blocks?: CrdtRichTextBlock[];
}

export type CrdtRichTextDeltaOp =
  | { insert: string | JsonObject; attributes?: JsonObject }
  | { retain: number; attributes?: JsonObject | null }
  | { delete: number };

export type CrdtRichTextDelta = CrdtRichTextDeltaOp[];

export interface CrdtRichTextHandle {
  /** Return the current rich-text object at this path. */
  value(): CrdtRichTextValue;

  /** Return the current plain text, including embed placeholders. */
  getText(): string;

  /** Return inline formatting spans, sorted and compacted by visible text position. */
  getSpans(): CrdtRichTextSpan[];

  /** Return embeds, sorted by visible text position. */
  getEmbeds(): CrdtRichTextEmbed[];

  /** Return block markers, sorted by visible text position. */
  getBlocks(): CrdtRichTextBlock[];

  /** Return the merged inline attributes active at one visible text position. */
  getAttributes(index: number): JsonObject | undefined;

  /** Export a Quill Delta-shaped sequence of insert operations. */
  toDelta(): CrdtRichTextDelta;

  /** Create a stable cursor relative to this rich-text object's visible text. */
  createCursor(index: number, options?: CrdtCursorOptions): CrdtTextCursor;

  /** Resolve a stable rich-text cursor against this document. */
  resolveCursor(cursor: CrdtTextCursor): CrdtResolvedCursor;

  /** Create a stable selection relative to this rich-text object's visible text. */
  createSelection(anchor: number, focus: number, options?: CrdtSelectionOptions): CrdtTextSelection;

  /** Resolve a stable rich-text selection against this document. */
  resolveSelection(selection: CrdtTextSelection): CrdtResolvedSelection;

  /** Replace the current rich-text object from Delta insert operations. */
  fromDelta(delta: readonly CrdtRichTextDeltaOp[]): CrdtCommitResult;

  /** Apply Delta insert/retain/delete operations to the current rich-text object. */
  applyDelta(delta: readonly CrdtRichTextDeltaOp[]): CrdtCommitResult;

  /** Insert plain text with optional marks. */
  insert(index: number, text: string, attributes?: JsonObject): CrdtCommitResult;

  /** Insert one embed. Embeds occupy one visible text position. */
  insertEmbed(index: number, value: JsonObject, attributes?: JsonObject): CrdtCommitResult;

  /** Delete visible rich-text positions. */
  delete(index: number, count?: number): CrdtCommitResult;

  /** Add formatting attributes to a visible range. */
  format(index: number, length: number, attributes: JsonObject, options?: CrdtRichTextFormatOptions): CrdtCommitResult;

  /** Remove formatting attributes from a visible range. Omit keys to remove all active marks there. */
  clearFormat(index: number, length: number, keys?: readonly string[]): CrdtCommitResult;

  /** Replace the embed payload and optional attributes at a visible embed position. */
  updateEmbed(index: number, value: JsonObject, attributes?: JsonObject): CrdtCommitResult;

  /** Add or replace block-level attributes at a visible text position. */
  formatBlock(index: number, attributes: JsonObject): CrdtCommitResult;

  /** Remove a block-level marker at a visible text position. */
  clearBlock(index: number): CrdtCommitResult;
}

export interface CrdtUndoCaptureOptions {
  origin?: string;
  metadata?: JsonObject;
  /** Merge this capture into the previous compatible capture. Defaults to auto when captureTimeoutMs is configured. */
  merge?: boolean | 'auto';
}

export interface CrdtUndoStackEntry {
  before: JsonValue;
  after: JsonValue;
  /** Document version before the captured edit group. */
  beforeVersion?: CrdtVersion;
  /** Document version after the captured edit group. */
  afterVersion?: CrdtVersion;
  /** Document version produced by undoing this entry. Used as the redo base. */
  undoVersion?: CrdtVersion;
  origin?: string;
  metadata?: JsonObject;
  createdAt: number;
  updatedAt: number;
  changeCount: number;
}

export interface CrdtUndoActionOptions {
  /** Undo/redo the latest stack entry from this origin instead of the latest entry overall. */
  origin?: string;

  /** Select a stack entry programmatically. Receives a cloned immutable-style entry. */
  predicate?: (entry: CrdtUndoStackEntry) => boolean;
}

export interface CrdtUndoManagerOptions {
  maxStack?: number;
  /** Only captures whose origin is in this set are tracked. If omitted, all non-ignored origins are tracked. */
  trackedOrigins?: readonly string[];
  /** Captures whose origin is in this set are ignored. */
  ignoredOrigins?: readonly string[];
  /** Auto-merge adjacent captures with the same origin within this many milliseconds. */
  captureTimeoutMs?: number;
  /** Last chance hook for deciding whether a completed capture should enter the undo stack. */
  shouldCapture?: (entry: CrdtUndoStackEntry) => boolean;
  onUndo?: (entry: CrdtUndoStackEntry) => void;
  onRedo?: (entry: CrdtUndoStackEntry) => void;
}

export interface CrdtUndoManager {
  readonly doc: CrdtDocument;
  canUndo(): boolean;
  canRedo(): boolean;
  clear(): void;
  /** Prevent the next capture from merging into the previous capture group. */
  stopCapturing(): void;
  capture<T>(callback: () => T, options?: CrdtUndoCaptureOptions): T;
  undo(options?: CrdtUndoActionOptions): CrdtCommitResult;
  redo(options?: CrdtUndoActionOptions): CrdtCommitResult;
  getUndoStack(): CrdtUndoStackEntry[];
  getRedoStack(): CrdtUndoStackEntry[];
}

export interface CrdtHistoryOptions {
  /** Optional lower bound for traversal. Omit or pass null to start from the beginning. */
  from?: CrdtVersion | null;

  /** Optional upper bound for traversal. Omit or pass null to include the current document. */
  to?: CrdtVersion | null;

  includeOps?: boolean;
  includeMetadata?: boolean;
}

export interface CrdtHistoryEntry {
  actor: CrdtActorId;
  startSeq: number;
  endSeq: number;
  count: number;
  heads: CrdtOperationId[];
  stateVector: CrdtStateVector;
  metadata?: JsonObject;
  ops?: CrdtOperation[];
}

export type CrdtHistoryVisitor = (entry: CrdtHistoryEntry, index: number) => boolean | void;

export interface CrdtCommitMetadataEntry {
  head: CrdtOperationId;
  metadata: JsonObject;
}

export interface CrdtSnapshotOptions {
  /** Optional lower bound. When set, the snapshot update is a delta from this version. */
  from?: CrdtVersion | null;

  /** Snapshot version. Omit or pass null to snapshot current heads. */
  version?: CrdtVersion | null;

  /** Include durable commit metadata for operations in this snapshot. Defaults to true. */
  includeMetadata?: boolean;

  /** Include the materialized JSON view at this snapshot version. Defaults to false. */
  includeView?: boolean;
}

export interface CrdtSnapshot {
  /** Lower bound used to create this snapshot update, when it is a delta snapshot. */
  baseVersion?: CrdtVersion | null;

  /** Version represented by the snapshot. */
  version: CrdtVersion;

  /** Causal heads represented by this snapshot update payload. */
  heads: CrdtOperationId[];

  /** Contiguous actor coverage represented by this snapshot update payload. */
  stateVector: CrdtStateVector;

  update: Uint8Array;
  metadata?: CrdtCommitMetadataEntry[];
  view?: JsonValue;
}

export interface CrdtVersionInfoOptions {
  includeMetadata?: boolean;
  includeHistory?: boolean;
  includeView?: boolean;
  includeUpdate?: boolean;
}

export interface CrdtVersionInfo {
  version: CrdtVersion;
  heads: CrdtOperationId[];
  stateVector: CrdtStateVector;
  metadata?: JsonObject;
  history?: CrdtHistoryEntry[];
  view?: JsonValue;
  update?: Uint8Array;
}

export interface CrdtVersionMarkOptions {
  /** Version to mark. Omit or pass null to mark the current document heads. */
  version?: CrdtVersion | null;

  /** Local application metadata for this named version mark. It is not part of CRDT updates. */
  metadata?: JsonObject;
}

export interface CrdtVersionMark {
  name: string;
  version: CrdtVersion;
  heads: CrdtOperationId[];
  stateVector: CrdtStateVector;
  metadata?: JsonObject;
}

export interface CrdtBranchOptions extends CrdtForkOptions {
  name?: string;
  baseVersion?: CrdtVersion | null;
}

export interface CrdtBranchMergeOptions {
  stateVector?: CrdtStateVector | null;
}

export type CrdtBranchMergeKind = 'already-merged' | 'fast-forward' | 'merge';

export interface CrdtBranchStatus {
  name: string;
  baseVersion: CrdtVersion | null;
  version: CrdtVersion;
  relationToBase: CrdtVersionRelation;
  changeCount: number;
  heads: CrdtOperationId[];
  stateVector: CrdtStateVector;
}

export interface CrdtBranchMergePreview {
  kind: CrdtBranchMergeKind;
  sourceName?: string;
  baseVersion: CrdtVersion | null;
  sourceVersion: CrdtVersion;
  targetVersion: CrdtVersion;
  sourceChangeCount: number;
  targetChangeCount: number;
  updateBytes: number;
  metadataCount: number;
  snapshot: CrdtSnapshot;
}

export interface CrdtBranch {
  readonly name: string;
  readonly doc: CrdtDocument;
  readonly baseVersion: CrdtVersion | null;
  getBaseVersion(): CrdtVersion | null;
  getVersion(): CrdtVersion;
  getStatus(): CrdtBranchStatus;
  inspectBase(options?: CrdtVersionInfoOptions): CrdtVersionInfo;
  inspectVersion(version?: CrdtVersion | null, options?: CrdtVersionInfoOptions): CrdtVersionInfo;
  compareVersions(left?: CrdtVersion | null, right?: CrdtVersion | null): CrdtVersionRelation;
  snapshot(options?: CrdtSnapshotOptions): CrdtSnapshot;
  snapshotBase(options?: CrdtSnapshotOptions): CrdtSnapshot;
  snapshotFromBase(options?: CrdtSnapshotOptions): CrdtSnapshot;
  checkoutBase(options?: CrdtForkOptions): CrdtDocument;
  checkout(version?: CrdtVersion | null, options?: CrdtForkOptions): CrdtDocument;
  fork(options?: CrdtBranchOptions): CrdtBranch;
  viewBase(): JsonValue;
  viewAt(version?: CrdtVersion | null): JsonValue;
  exportChangesSince(version?: CrdtVersion | null): Uint8Array;
  exportChangesBetween(fromVersion?: CrdtVersion | null, toVersion?: CrdtVersion | null): Uint8Array;
  exportChangesFromBase(): Uint8Array;
  changesSince(version?: CrdtVersion | null): CrdtOperation[];
  changesBetween(fromVersion?: CrdtVersion | null, toVersion?: CrdtVersion | null): CrdtOperation[];
  changesFromBase(): CrdtOperation[];
  getHistory(options?: CrdtHistoryOptions): CrdtHistoryEntry[];
  forEachHistory(callback: CrdtHistoryVisitor, options?: CrdtHistoryOptions): void;
  getCommitMetadata(version?: CrdtVersion | CrdtOperationId | null): JsonObject | undefined;
  markVersion(name: string, options?: CrdtVersionMarkOptions): CrdtVersionMark;
  getVersionMark(name: string): CrdtVersionMark | undefined;
  listVersionMarks(): CrdtVersionMark[];
  deleteVersionMark(name: string): boolean;
  viewMark(name: string): JsonValue;
  checkoutMark(name: string, options?: CrdtForkOptions): CrdtDocument;
  snapshotMark(name: string, options?: CrdtSnapshotOptions): CrdtSnapshot;
  previewMergeFrom(source: CrdtDocument | CrdtBranch): CrdtBranchMergePreview;
  previewMergeInto(target: CrdtDocument | CrdtBranch): CrdtBranchMergePreview;
  mergeFrom(source: CrdtDocument | CrdtBranch, options?: CrdtBranchMergeOptions): CrdtCommitResult;
  mergeInto(target: CrdtDocument | CrdtBranch, options?: CrdtBranchMergeOptions): CrdtCommitResult;
}

/** Batch local CRDT operations into one update and one Frontier view patch. */
export interface CrdtTransaction {
  set(path: WatchPath, value: JsonValue): this;
  delete(path: WatchPath): this;
  getConflict(path: WatchPath): CrdtConflict | undefined;
  getConflictSummary(path: WatchPath): CrdtConflictSummary | undefined;
  getConflicts(path?: WatchPath): CrdtConflict[];
  getConflictSummaries(path?: WatchPath): CrdtConflictSummary[];
  resolveConflict(path: WatchPath, resolution: CrdtConflictResolution): this;
  map(path: WatchPath): CrdtMapHandle;
  counter(path: WatchPath): CrdtCounterHandle;
  binary(path: WatchPath): CrdtBinaryHandle;
  list(path: WatchPath): CrdtListHandle;
  text(path: WatchPath): CrdtTextHandle;
  tree(path: WatchPath): CrdtTreeHandle;
  xml(path: WatchPath): CrdtXmlHandle;
}

/** Native operation-set CRDT document with Frontier materialized-view patches. */
export interface CrdtDocument {
  readonly actorId: CrdtActorId;

  /** Clone and return the current materialized JSON view. */
  toJSON(): JsonValue;

  /** Return current causal heads. */
  getHeads(): CrdtOperationId[];

  /** Return the current checkout/version frontier. Equivalent to a cloned getHeads(). */
  getVersion(): CrdtVersion;

  /** Return a state vector suitable for requesting a peer diff. */
  getStateVector(): CrdtStateVector;

  /** Batch several local edits into one native update. */
  change(callback: (tx: CrdtTransaction) => void, options?: CrdtChangeOptions): CrdtCommitResult;

  /** Set a JSON value by path using a deterministic LWW register. */
  set(path: WatchPath, value: JsonValue): CrdtCommitResult;

  /** Delete a JSON value by path using a deterministic LWW register tombstone. */
  delete(path: WatchPath): CrdtCommitResult;

  /** LWW map/register helper below a path. */
  map(path: WatchPath): CrdtMapHandle;

  /** Inspect concurrent register values at one exact path. */
  getConflict(path: WatchPath): CrdtConflict | undefined;

  /** Return lightweight UI metadata for one exact-path register conflict. */
  getConflictSummary(path: WatchPath): CrdtConflictSummary | undefined;

  /** Inspect register conflicts at or below a path. Omitting path scans the document. */
  getConflicts(path?: WatchPath): CrdtConflict[];

  /** Return lightweight UI metadata for register conflicts at or below a path. */
  getConflictSummaries(path?: WatchPath): CrdtConflictSummary[];

  /** Inspect concurrent register values at one exact path for a historical version. */
  getConflictAt(version: CrdtVersion, path: WatchPath): CrdtConflict | undefined;

  /** Return lightweight UI metadata for one exact-path historical register conflict. */
  getConflictSummaryAt(version: CrdtVersion, path: WatchPath): CrdtConflictSummary | undefined;

  /** Inspect register conflicts at or below a path for a historical version. */
  getConflictsAt(version: CrdtVersion, path?: WatchPath): CrdtConflict[];

  /** Return lightweight UI metadata for historical register conflicts at or below a path. */
  getConflictSummariesAt(version: CrdtVersion, path?: WatchPath): CrdtConflictSummary[];

  /** Resolve a register conflict with a chosen value or tombstone. */
  resolveConflict(
    path: WatchPath,
    resolution: CrdtConflictResolution,
    options?: CrdtConflictResolutionOptions
  ): CrdtCommitResult;

  /** Add-only/subtract-only numeric CRDT counter at a path. */
  counter(path: WatchPath): CrdtCounterHandle;

  /** Byte value at a path. The materialized JSON view uses a tagged object. */
  binary(path: WatchPath): CrdtBinaryHandle;

  /** Ordered list CRDT island at a path. */
  list(path: WatchPath): CrdtListHandle;

  /** Ordered text CRDT island at a path. */
  text(path: WatchPath): CrdtTextHandle;

  /** Movable document-tree CRDT at a path. */
  tree(path: WatchPath): CrdtTreeHandle;

  /** XML/document-fragment helper backed by the movable tree CRDT. */
  xml(path: WatchPath): CrdtXmlHandle;

  /**
   * Rich-text CRDT object at a path, stored as text plus mark/embed/block sidecars.
   * Sidecars are replicated as CRDT list entries, so disjoint concurrent marks can
   * merge, but overlapping rich-text semantic policy is still deterministic
   * last-writer-style attribute composition rather than a full editor schema.
   */
  richText(path: WatchPath): CrdtRichTextHandle;

  /** Integrate a native update. Duplicate updates produce an empty view patch. */
  applyUpdate(update: ArrayBuffer | ArrayBufferView | CrdtUpdate): CrdtCommitResult;

  /** Encode all operations missing from a peer state vector. */
  encodeStateAsUpdate(stateVector?: CrdtStateVector | null): Uint8Array;

  /** Alias for encodeStateAsUpdate(). */
  exportUpdate(stateVector?: CrdtStateVector | null): Uint8Array;

  /** Encode operations after a state-vector or head-frontier version. */
  exportChangesSince(version?: CrdtVersion | null): Uint8Array;

  /** Encode operations between two state-vector/head versions. */
  exportChangesBetween(fromVersion?: CrdtVersion | null, toVersion?: CrdtVersion | null): Uint8Array;

  /** Return operation objects after a state-vector or head-frontier version. */
  changesSince(version?: CrdtVersion | null): CrdtOperation[];

  /** Return operation objects between two state-vector/head versions. */
  changesBetween(fromVersion?: CrdtVersion | null, toVersion?: CrdtVersion | null): CrdtOperation[];

  /** Return commit-like operation ranges for history inspection. */
  getHistory(options?: CrdtHistoryOptions): CrdtHistoryEntry[];

  /** Traverse commit-like operation ranges. Returning false stops traversal. */
  forEachHistory(callback: CrdtHistoryVisitor, options?: CrdtHistoryOptions): void;

  /** Return durable metadata attached to a head-frontier, state-vector version, or operation head. */
  getCommitMetadata(version?: CrdtVersion | CrdtOperationId | null): JsonObject | undefined;

  /** Create or replace a local named version mark. Marks are app metadata, not replicated CRDT ops. */
  markVersion(name: string, options?: CrdtVersionMarkOptions): CrdtVersionMark;

  /** Return a local named version mark. */
  getVersionMark(name: string): CrdtVersionMark | undefined;

  /** Return all local named version marks, sorted by name. */
  listVersionMarks(): CrdtVersionMark[];

  /** Delete a local named version mark. */
  deleteVersionMark(name: string): boolean;

  /** Materialize a read-only JSON view at a named version mark. */
  viewMark(name: string): JsonValue;

  /** Create a detached document at a named version mark. */
  checkoutMark(name: string, options?: CrdtForkOptions): CrdtDocument;

  /** Capture a replayable operation snapshot at a named version mark. */
  snapshotMark(name: string, options?: CrdtSnapshotOptions): CrdtSnapshot;

  /** Inspect heads/state-vector and optional metadata/history/view/update payloads for a version. */
  inspectVersion(version?: CrdtVersion | null, options?: CrdtVersionInfoOptions): CrdtVersionInfo;

  /** Compare two versions by operation-set inclusion from this document's log. */
  compareVersions(left?: CrdtVersion | null, right?: CrdtVersion | null): CrdtVersionRelation;

  /** Capture a bounded authored-state frame for validating later optimistic or branch-aware work. */
  captureFrame(options?: CrdtFrameCaptureOptions): CrdtFrameReference;

  /** Evaluate whether the current document is still valid for work authored against a frame. */
  evaluateFrame(frame: CrdtFrameReference, options?: CrdtFrameEvaluationOptions): CrdtFrameEvaluation;

  /** Capture a versioned, replayable operation snapshot with optional metadata/view payloads. */
  snapshot(options?: CrdtSnapshotOptions): CrdtSnapshot;

  /** Apply a snapshot update and import its metadata table. */
  applySnapshot(snapshot: CrdtSnapshot): CrdtCommitResult;

  /** Materialize a read-only JSON view at a state vector or causal heads. */
  viewAt(version?: CrdtVersion | null): JsonValue;

  /** Create a detached document at a state vector or causal heads. */
  checkout(version?: CrdtVersion | null, options?: CrdtForkOptions): CrdtDocument;

  /** Create a detached document at the current heads. */
  fork(options?: CrdtForkOptions): CrdtDocument;

  /** Create a stable text cursor at a visible code-point index. */
  createCursor(path: WatchPath, index: number, options?: CrdtCursorOptions): CrdtTextCursor;

  /** Resolve a stable text cursor against the current document view. */
  resolveCursor(cursor: CrdtTextCursor): CrdtResolvedCursor;

  /** Create a stable text selection from two visible code-point indexes. */
  createSelection(path: WatchPath, anchor: number, focus: number, options?: CrdtSelectionOptions): CrdtTextSelection;

  /** Resolve a stable text selection against the current document view. */
  resolveSelection(selection: CrdtTextSelection): CrdtResolvedSelection;

  /** Export learned CRDT workload hints. */
  getProfile(): CrdtProfile;

  /** Load CRDT workload hints. */
  loadProfile(profile?: CrdtProfile | null): void;
}

/** CRDT document wired directly to Frontier's patch-native state engine. */
export interface CrdtStateEngine extends CrdtDocument {
  /** Return the current state-engine source reference. */
  get(): JsonValue | undefined;

  /** Subscribe to CRDT view patches through the state engine router. */
  watch(path: WatchPath, callback: PatchWatchCallback): PatchSubscription;
  watch(path: WatchPath, fields: WatchPath[], callback: PatchWatchCallback): PatchSubscription;
  watch(options: WatchOptions, callback: PatchWatchCallback): PatchSubscription;

  /** Materialize an exact path or wildcard collection view from CRDT view patches. */
  view(path: WatchPath): DeltaView;
  view(options: DeltaViewOptions): DeltaView;

  /** Clear state-engine watchers and diff runtime caches. CRDT operations are retained. */
  clear(): void;
}

/** Runtime JSON validation options. */
export interface JsonValidationOptions {
  /**
   * Enforce the stricter interoperable JSON profile used by I-JSON/JCS-style
   * workflows. This rejects unpaired surrogate code units and Unicode
   * noncharacters in strings and keys, and rejects unsafe integer numbers.
   */
  ijson?: boolean;

  /** Reject strings or object keys containing unpaired surrogate code units. */
  rejectUnpairedSurrogates?: boolean;

  /** Reject strings or object keys containing Unicode noncharacters. */
  rejectNoncharacters?: boolean;

  /** Reject integer numbers outside the ECMAScript safe-integer range. */
  rejectUnsafeIntegers?: boolean;

  /** Optional maximum container depth. The root value is depth 0. */
  maxDepth?: number;
}

/** RFC8785/JCS-style canonical JSON serialization options. */
export interface CanonicalJsonOptions extends JsonValidationOptions {
  /** Validate the input before serializing. Defaults to true. */
  validate?: boolean;
}

export type UnicodeNormalizationForm = 'NFC' | 'NFD' | 'NFKC' | 'NFKD';
export type TextSegmentGranularity = 'grapheme' | 'word' | 'sentence';
export type TextLengthUnit = 'codeUnit' | 'codePoint' | 'grapheme';

/** Text segment with a UTF-16 code-unit start offset. */
export interface TextSegment {
  segment: string;
  index: number;
  isWordLike?: boolean;
}

/** Options for Intl.Segmenter-backed text segmentation helpers. */
export interface TextSegmentationOptions {
  /** Locale passed to Intl.Segmenter. Defaults to the runtime default locale. */
  locale?: string | string[];

  /** Segment granularity. Defaults to grapheme. */
  granularity?: TextSegmentGranularity;

  /** Boundary side used when converting an offset inside a segment. */
  assoc?: -1 | 1 | number;
}

export type KeyCompare = (left: string, right: string) => number;
export type TokenGetter<TValue extends JsonValue = JsonValue> = (value: TValue) => CacheToken | null | undefined;
export type ArrayKeyGetter<TValue extends JsonValue = JsonValue> = (
  value: TValue,
  index?: number,
  array?: TValue[]
) => ObjectKey | null | undefined;

/** Shared planning metadata carried by profiles across diff, equality, history, codec, state, and CRDT layers. */
export interface ProfilePlans {
  /** JSON diff planning choice. Schemas remain stored in `schema` / `schemas`; this records how they are intended to be used. */
  diff?: DiffProfilePlan;

  /** Equality planning choice used by engines before falling back to structural comparison. */
  equality?: EqualityProfilePlan;

  /** Patch-history planning choice used to prioritize history fast paths. */
  history?: HistoryProfilePlan;

  /** Encoding preferences for patch/history/CRDT update payloads. */
  codec?: CodecProfilePlan;

  /** State-engine routing and apply preferences. */
  state?: StateProfilePlan;

  /** CRDT operation/update planning preferences. */
  crdt?: CrdtProfilePlan;
}

export interface DiffProfilePlan {
  strategy?: 'structural' | 'schema' | 'adaptive-schema';
  schemaCount?: number;
  paths?: JsonPath[];
}

export interface EqualityProfilePlan {
  strategy?: 'fast-json' | 'schema' | 'token';
  token?: 'versionKey' | 'fingerprintKey';
  key?: ObjectKey;
}

export interface HistoryProfilePlan {
  strategy?: 'auto' | 'string-append' | 'row-object-assign' | 'object-assign' | 'scalar-object';
}

export interface CodecProfilePlan {
  patch?: 'auto' | 'json' | 'binary';
  history?: 'auto' | 'binary' | 'binary-columnar';
  crdt?: 'auto' | 'json' | 'binary' | 'columnar-text';
}

export interface StateProfilePlan {
  routing?: 'patch-router';
  apply?: 'owned-mutable' | 'immutable';
  watches?: number;
  exactWatches?: number;
  wildcardWatches?: number;
  fieldWatches?: number;
  rangeWatches?: number;
}

export interface CrdtProfilePlan {
  update?: 'auto' | 'json' | 'binary' | 'columnar-text';
  text?: 'chunked-ids' | 'native-piece';
}

/** Compact trusted dirty frontier for homogeneous array rows. */
export interface DirtyRowsFrontier {
  /** Path to the array containing dirty rows. */
  path: JsonPath;

  /** Dirty row indexes. Sorted ascending unlocks the fastest grouped path. */
  rows: ArrayLike<number>;

  /**
   * Relative field paths from each row. Omit fields when whole rows are dirty.
   * For example `{ path: ['bodies'], rows, fields: [['position', 'x']] }`.
   */
  fields?: JsonPath[];
}

/**
 * Stateless diff options.
 *
 * Default `diff()` is safe and structural. Options such as versions,
 * fingerprints, and dirty paths are trusted producer contracts that can skip
 * traversal when the caller can prove the metadata is correct.
 */
export interface DiffOptions<TValue extends JsonValue = JsonValue> {
  /** Validate inputs and generated patch data. Disabled by default for speed. */
  validate?: boolean;

  /** Emit a root replacement patch unless both inputs are the same reference. */
  strategy?: 'replace';

  /**
   * Optional patch-size keyframe threshold. When the generated patch has more
   * operations than this value, emit one root replacement instead.
   */
  maxPatchOperations?: number | null;

  /** Sort object keys lexically, or with a supplied comparator, for deterministic patch order. */
  stable?: boolean | KeyCompare;

  /** Legacy alias for stable lexical object-key ordering. */
  sortKeys?: boolean;

  /** Custom object-key comparator used by stable diffing. */
  keyCompare?: KeyCompare;

  /** Object key that exposes a trusted subtree version token. Matching non-null tokens skip traversal. */
  versionKey?: ObjectKey;

  /** Object key that exposes a trusted semantic fingerprint. Matching non-null tokens skip traversal. */
  fingerprintKey?: ObjectKey;

  /** Getter for trusted subtree version tokens. Matching non-null tokens skip traversal. */
  getVersion?: TokenGetter<TValue>;

  /** Getter for trusted semantic fingerprints. Matching non-null tokens skip traversal. */
  getFingerprint?: TokenGetter<TValue>;

  /**
   * Key or getter used to match object-array rows.
   * Pass false to disable keyed-array heuristics for this call.
   */
  arrayKey?: ObjectKey | ArrayKeyGetter<TValue> | boolean | null;

  /** Enable conservative automatic key detection for reordered object arrays. */
  autoArrayKey?: boolean;

  /** Optional row identity field candidates used before structural identity inference. */
  recordKeyCandidates?: ObjectKey[] | false | null;

  /** Getter used to match object-array rows. */
  getArrayKey?: ArrayKeyGetter<TValue>;

  /**
   * Trusted producer frontier. Include every changed region; array structural
   * edits must mark the array path itself. [] means no changes, while [[]]
   * requests a full diff.
   */
  dirtyPaths?: JsonPath[] | null;

  /**
   * Trusted compressed producer frontier for row-oriented arrays. This is a
   * compact equivalent of many dirtyPaths such as `['rows', i, 'field']`.
   */
  dirtyRows?: DirtyRowsFrontier[] | null;
}

/** Patch replay options. */
export interface ApplyOptions {
  /** Clone inserted/replaced JSON values before writing them into the target. */
  cloneValues?: boolean;
}

/** Binary or JSON patch codec options. */
export interface CodecOptions {
  /** Validate trusted patch data before encoding or decoding. */
  validate?: boolean;
}

/** Binary patch-history codec and replay options. */
export interface PatchHistoryCodecOptions extends CodecOptions {
  /**
   * Replay only the first N patches from a history stream. This enables point-in-time
   * materialization without decoding the complete history.
   */
  until?: number;
}

/** Streaming patch-history builder. It avoids materializing a `Patch[]` when a producer already has operation events. */
export interface PatchHistoryBuilder {
  /** Number of operation patches recorded so far. */
  readonly length: number;

  /** Add a compact patch to the stream. Non-specialized patches are preserved through the generic history codec. */
  addPatch(patch: Patch): this;

  /** Add a string splice operation as its own history patch. Same-path appends use the compact streaming mode. */
  stringSplice(path: JsonPath, start: number, deleteCount: number, insert: string): this;

  /** Convenience alias for `stringSplice(path, start, 0, insert)`. */
  appendString(path: JsonPath, start: number, insert: string): this;

  /** Encode all recorded operations. */
  finish(options?: PatchHistoryCodecOptions): Uint8Array;

  /** Clear all recorded operations and reuse the builder. */
  reset(): void;
}

/** Patch normalization options. */
export interface NormalizeOptions {
  /** Validate the incoming patch before normalization. */
  validate?: boolean;
}

/** JSON path and text-position mapping options. */
export interface MapPathOptions {
  /** Validate the compact patch before mapping. */
  validate?: boolean;

  /** How to report positions inside deleted ranges. */
  deleted?: 'null' | 'start' | 'end';

  /** Side preference for positions at insertion boundaries. */
  assoc?: -1 | 1 | number;
}

/** Field entry in an explicit or learned object schema. */
export type SchemaField = ObjectKey | NestedObjectSchemaField;

/** Nested object field inside a schema. Only listed nested fields are part of the optimized contract. */
export interface NestedObjectSchemaField {
  key: ObjectKey;
  type: 'object';
  fields: SchemaField[];
}

/** Trusted fixed-field object schema, optionally scoped to a path. */
export interface ObjectSchema {
  type: 'object';
  path?: JsonPath;
  fields: SchemaField[];
}

/** Trusted homogeneous record-array schema, optionally scoped to a path. */
export interface RecordArraySchema {
  type: 'array';
  path?: JsonPath;
  /** Same-position identity guard for row objects. */
  key?: ObjectKey;
  item: {
    type: 'object';
    /** Row identity field used by planned array-object diffs. */
    key?: ObjectKey;
    fields: SchemaField[];
  };
}

export type SingleSchema = ObjectSchema | RecordArraySchema;

/** Multiple path-local or root schemas. */
export interface MultiSchema {
  schemas: SingleSchema[];
}

export type Schema = SingleSchema | MultiSchema;

/** Portable engine configuration and learned shape metadata. */
export interface DiffProfile {
  /** Profile format version. This is not a data version or fingerprint. */
  version?: 1;

  /** Engine options that can be saved and reloaded with the profile. */
  settings?: EngineProfileSettings;

  /** Shared planning choices for diff, equality, history, codec, and state layers. */
  plans?: ProfilePlans;

  /** Single trusted schema shorthand. */
  schema?: SingleSchema;

  /** Multiple trusted or learned schemas. */
  schemas?: SingleSchema[];
}

/** Serializable subset of engine options that can travel in a profile. */
export interface EngineProfileSettings {
  /** Maximum number of cached fingerprint/version patch entries. */
  cacheSize?: number;

  /** Enable adaptive shape learning when the profile is loaded. */
  adaptive?: boolean;

  /** Number of observations required before an adaptive shape can specialize. Defaults to 1. */
  adaptiveThreshold?: number;

  /** Portable keyed-array setting. Function getters belong on EngineOptions, not profiles. */
  arrayKey?: ObjectKey | false | null;

  /** Enable conservative automatic key detection for reordered object arrays. */
  autoArrayKey?: boolean;

  /** Portable row identity field candidates used by automatic keyed-array/adaptive plans. */
  recordKeyCandidates?: ObjectKey[] | false | null;

  /** Portable root/container field hints for adaptive traversal. Structural discovery still scans other fields. */
  containerKeys?: ObjectKey[] | false | null;

  /** Stable lexical object-key ordering. Custom comparators belong on EngineOptions, not profiles. */
  stable?: boolean;

  /** Legacy alias for stable lexical object-key ordering. */
  sortKeys?: boolean;

  /** Portable patch-size keyframe threshold. */
  maxPatchOperations?: number | null;

  /** Portable subtree version key. Function getters belong on EngineOptions, not profiles. */
  versionKey?: ObjectKey;

  /** Portable semantic fingerprint key. Function getters belong on EngineOptions, not profiles. */
  fingerprintKey?: ObjectKey;
}

/** Stateful engine options. Explicit constructor options override profile settings. */
export interface EngineOptions<TValue extends JsonValue = JsonValue> extends DiffOptions<TValue> {
  /** Maximum number of cached fingerprint/version patch entries. */
  cacheSize?: number;

  /** Alias for cacheSize. */
  maxEntries?: number;

  /** Learn recognized repeated shapes from calls to engine.diff(). */
  adaptive?: boolean;

  /** Number of observations required before an adaptive shape can specialize. Defaults to 1. */
  adaptiveThreshold?: number;

  /** Trusted schema or schemas for planned shape-specific diffing. */
  schema?: Schema | null;

  /** Optional root/container field hints for adaptive traversal. Structural discovery still scans other fields. */
  containerKeys?: ObjectKey[] | false | null;

  /** Portable engine configuration and learned schema metadata. */
  profile?: DiffProfile | null;
}

/** Sample pair accepted by adaptive profile training. */
export type TrainingSample<TSource extends JsonValue = JsonValue, TTarget extends JsonValue = JsonValue> =
  | [TSource, TTarget]
  | { source: TSource; target: TTarget }
  | { before: TSource; after: TTarget };

/**
 * Stateful diff engine.
 *
 * Engines can cache fingerprint/version patch results, apply explicit schemas,
 * learn adaptive schemas, and export/import portable profiles. Plain `diff()`
 * remains stateless; use an engine only when you want this stateful behavior.
 */
export interface DiffEngine {
  /** Diff two JSON values using engine state and optional per-call overrides. */
  diff<TSource extends JsonValue, TTarget extends JsonValue>(
    source: TSource,
    target: TTarget,
    options?: DiffOptions<TSource | TTarget>
  ): Patch;

  /** Diff into a caller-owned reusable patch array. */
  diffInto<TSource extends JsonValue, TTarget extends JsonValue>(
    source: TSource,
    target: TTarget,
    patch: Patch,
    options?: DiffOptions<TSource | TTarget>
  ): Patch;

  /** Compare two JSON values using engine tokens, schema/adaptive plans, and the fast JSON fallback. */
  equals<TSource extends JsonValue, TTarget extends JsonValue>(
    source: TSource,
    target: TTarget,
    options?: DiffOptions<TSource | TTarget>
  ): boolean;

  /** Diff a sequence of states into a patch history using the same engine state. */
  diffHistory<TSource extends JsonValue, TTarget extends JsonValue>(
    initial: TSource,
    states: TTarget[],
    options?: DiffOptions<TSource | TTarget>
  ): Patch[];

  /** Encode a patch history with the engine's history codec. */
  encodeHistory(patches: Patch[], options?: PatchHistoryCodecOptions): Uint8Array;

  /** Decode a patch history encoded by encodeHistory() or encodePatchHistory(). */
  decodeHistory(bytes: ArrayBuffer | ArrayBufferView, options?: PatchHistoryCodecOptions): Patch[];

  /** Replay a patch history with history-level fast paths. */
  applyHistory(source: JsonValue, patches: Patch[], options?: PatchHistoryCodecOptions): JsonValue;

  /** Apply an encoded patch history directly when the codec has a materialization fast path. */
  applyEncodedHistory(source: JsonValue, bytes: ArrayBuffer | ArrayBufferView, options?: PatchHistoryCodecOptions): JsonValue;

  /** Create a streaming history builder for operation producers that can bypass `Patch[]` materialization. */
  createHistoryBuilder(): PatchHistoryBuilder;

  /** Clear runtime caches and adaptive observations. Loaded profiles and explicit options remain configured. */
  clear(): void;

  /** Pre-warm adaptive schemas from representative samples and return the resulting profile. */
  train(samples: TrainingSample[]): DiffProfile;

  /** Export portable engine settings and learned schemas. */
  getProfile(): DiffProfile;

  /** Load a portable profile. Explicit constructor options still take precedence. */
  loadProfile(profile?: DiffProfile | null): void;
}

/** Path accepted by patch-native subscription APIs. Strings may be JSON Pointers or simple relative field paths. */
export type WatchPath = string | JsonPath;

/** Callback invoked with the source patch operations relevant to a subscription. */
export type PatchWatchCallback = (patch: Patch) => void;

/** Subscription handle returned by watch APIs. */
export interface PatchSubscription {
  /** True until unsubscribe() is called or the owning router is cleared. */
  readonly active: boolean;

  /** Stop receiving routed patches. Safe to call more than once. */
  unsubscribe(): void;
}

/** Path watch options. `fields` are relative to `path` and are indexed as path + field. */
export interface WatchOptions {
  /** Watched path. `*` path segments are treated as wildcards. Defaults to the root path. */
  path?: WatchPath;

  /** Optional relative field paths below `path`. */
  fields?: WatchPath[];

  /**
   * Optional numeric wildcard bounds for compact region dependencies.
   *
   * The first `*` segment is treated as the row/item index. A second `*` segment,
   * when present, is treated as a column/cell index. Bounds are inclusive.
   */
  range?: WatchRange;
}

/** Numeric range bounds for wildcard path subscriptions. */
export interface WatchRange {
  /** First wildcard start, inclusive. Alias for rowStart/startRow. Defaults to 0. */
  start?: number;

  /** First wildcard end, inclusive. Alias for rowEnd/endRow. Defaults to Number.MAX_SAFE_INTEGER. */
  end?: number;

  /** First wildcard start, inclusive. */
  rowStart?: number;

  /** First wildcard end, inclusive. */
  rowEnd?: number;

  /** First wildcard start, inclusive. */
  startRow?: number;

  /** First wildcard end, inclusive. */
  endRow?: number;

  /** Second wildcard start, inclusive. */
  columnStart?: number;

  /** Second wildcard end, inclusive. */
  columnEnd?: number;

  /** Second wildcard start, inclusive. */
  startColumn?: number;

  /** Second wildcard end, inclusive. */
  endColumn?: number;
}

/** Patch-native interest index. It routes source patch operations to matching subscribers. */
export interface PatchRouter {
  /** Number of active subscriptions. */
  readonly size: number;

  /** Subscribe to a path, optionally narrowed by relative fields. */
  watch(path: WatchPath, callback: PatchWatchCallback): PatchSubscription;
  watch(path: WatchPath, fields: WatchPath[], callback: PatchWatchCallback): PatchSubscription;
  watch(options: WatchOptions, callback: PatchWatchCallback): PatchSubscription;

  /** Route a compact patch to matching watchers and return the number of callbacks invoked. */
  route(patch: Patch): number;

  /** Remove every watcher and clear pending delivery state. */
  clear(): void;
}

/** Options for createStateEngine(). */
export interface StateEngineOptions {
  /** Options passed to the underlying diff engine used by commit(). */
  diff?: EngineOptions;
}

/** Maintained derived value that emits patches to its own value. */
export interface DeltaView {
  /** Current materialized value. */
  value(): JsonValue | undefined;

  /** Subscribe to patches that update this view value. */
  onPatch(callback: PatchWatchCallback): PatchSubscription;

  /** Rebuild the view from the current source state and emit a patch if it changed. */
  refresh(): Patch;

  /** Detach this view from the source engine and remove view subscribers. */
  dispose(): void;
}

/** Maintained collection view options. */
export interface DeltaViewOptions extends WatchOptions {
  /** Row identity used when materializing wildcard collection views as an object map. */
  keyBy?: ObjectKey | ((value: JsonValue, key: ObjectKey) => ObjectKey | null | undefined);

  /** Keep only matching rows or exact-path values. */
  include?: (value: JsonValue, key: ObjectKey) => boolean;

  /** Project source rows or exact-path values into the maintained view value. */
  project?: (value: JsonValue, key: ObjectKey) => JsonValue;
}

/** Owned-state wrapper around diff(), patch routing, and materialized views. */
export interface StateEngine {
  /** Return the current source state reference. */
  get(): JsonValue | undefined;

  /** Subscribe to source patches. */
  watch(path: WatchPath, callback: PatchWatchCallback): PatchSubscription;
  watch(path: WatchPath, fields: WatchPath[], callback: PatchWatchCallback): PatchSubscription;
  watch(options: WatchOptions, callback: PatchWatchCallback): PatchSubscription;

  /** Diff from the current state to next, update the current reference, route the patch, and return it. */
  commit(next: JsonValue, options?: DiffOptions): Patch;

  /** Alias for commit(). */
  set(next: JsonValue, options?: DiffOptions): Patch;

  /** Apply and route a caller-supplied patch. */
  commitPatch(patch: Patch): JsonValue | undefined;

  /** Materialize an exact path or wildcard collection view that emits patches to its own value. */
  view(path: WatchPath): DeltaView;
  view(options: DeltaViewOptions): DeltaView;

  /** Compare the current state with a candidate value through the embedded diff engine. */
  equals(next: JsonValue, options?: DiffOptions): boolean;

  /** Pre-warm the embedded adaptive diff engine and return its portable profile. */
  train(samples: TrainingSample[]): DiffProfile;

  /** Export the embedded diff engine profile. */
  getProfile(): DiffProfile;

  /** Load an embedded diff engine profile. */
  loadProfile(profile?: DiffProfile | null): void;

  /** Clear source watchers and diff-engine runtime state. */
  clear(): void;
}

/** RFC6902 JSON Patch operation. */
export type JsonPatchOperation =
  | { op: 'add' | 'replace' | 'test'; path: string; value: JsonValue }
  | { op: 'remove'; path: string }
  | { op: 'copy' | 'move'; from: string; path: string };

/** RFC6902 JSON Patch document. */
export type JsonPatch = JsonPatchOperation[];

/** JSON string position anchored at an array-form path. */
export interface TextPosition {
  path: JsonPath;
  offset: number;
}
