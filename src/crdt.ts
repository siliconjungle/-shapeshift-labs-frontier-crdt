import { applyPatch } from '@shapeshift-labs/frontier/apply';
import { cloneJson } from '@shapeshift-labs/frontier/clone';
import { CrdtBinaryReader, CrdtBinaryWriter } from './crdt-binary.js';
import {
  readBinaryJsonValueCore,
  readBinaryPathWithOptions,
  writeBinaryJsonValueCore,
  writeBinaryPathWithOptions,
  type BinaryJsonValueCodecOptions,
  type BinaryPathCodecOptions
} from '@shapeshift-labs/frontier-codec/binary-core';
import {
  operationIdMatchesActorSeq,
  parseOperationId,
  parseTextElementId,
  textElementIdMatchesActorSeqZero,
  textElementIdMatchesRange,
  tryParseOperationId,
  type TextElementIdParts
} from './crdt-ids.js';
import {
  OP_ARRAY_ASSIGN,
  OP_ARRAY_SPLICE,
  OP_ARRAY_TUPLE_ASSIGN,
  OP_ASSIGN,
  OP_REMOVE,
  OP_SET,
  OP_STRING_SPLICE
} from '@shapeshift-labs/frontier/constants';
import { diff } from '@shapeshift-labs/frontier/diff';
import { ChunkedTextValue, VisiblePositionIndex } from './crdt-text-value.js';
import { ChunkedStringSequence, NativeTextPieceSequence } from './crdt-text-sequence.js';
import { createCrdtRichTextHandle } from './crdt-richtext.js';
import { setOwnValue } from './object.js';
import { getCachedPointerPath } from '@shapeshift-labs/frontier/pointer';
import {
  createCrdtProfilePlansSnapshot,
  readProfilePlans
} from '@shapeshift-labs/frontier-engine/profile';
import type {
  CrdtActorId,
  CrdtChangeOptions,
  CrdtBinaryHandle,
  CrdtCommitMetadataEntry,
  CrdtCommitResult,
  CrdtConflict,
  CrdtConflictResolution,
  CrdtConflictResolutionOptions,
  CrdtConflictSummary,
  CrdtConflictValue,
  CrdtCounterHandle,
  CrdtCursorOptions,
  CrdtDocument,
  CrdtDocumentOptions,
  CrdtForkOptions,
  CrdtHistoryEntry,
  CrdtHistoryOptions,
  CrdtHistoryVisitor,
  CrdtListHandle,
  CrdtMapHandle,
  CrdtOperation,
  CrdtOperationId,
  CrdtProfile,
  CrdtRichTextHandle,
  CrdtResolvedCursor,
  CrdtResolvedSelection,
  CrdtSelectionOptions,
  CrdtSnapshot,
  CrdtSnapshotOptions,
  CrdtStateVector,
  CrdtStateEngine,
  CrdtStateEngineOptions,
  CrdtTextCursor,
  CrdtTextHandle,
  CrdtTextProfile,
  CrdtTextSelection,
  CrdtTextSplice,
  CrdtTextSpliceInput,
  CrdtTextSpliceTuple,
  CrdtTreeCreateResult,
  CrdtTreeHandle,
  CrdtTreeNode,
  CrdtTransaction,
  CrdtUpdate,
  CrdtVersion,
  CrdtVersionInfo,
  CrdtVersionInfoOptions,
  CrdtVersionMark,
  CrdtVersionMarkOptions,
  CrdtVersionRelation,
  CrdtXmlHandle,
  CrdtXmlNode,
  DeltaView,
  DeltaViewOptions,
  JsonObject,
  JsonPath,
  JsonValue,
  Patch,
  PatchSubscription,
  PatchWatchCallback,
  ProfilePlans,
  StateEngine,
  WatchOptions,
  WatchPath
} from './types.js';

export { applyCrdtViewPatch } from './crdt-view.js';

const CRDT_UPDATE_MAGIC = 'frontier-crdt-update';
const CRDT_UPDATE_MAGIC_JSON = JSON.stringify(CRDT_UPDATE_MAGIC);
const CRDT_UPDATE_VERSION = 1;
const CRDT_BINARY_MAGIC_0 = 0x46; // F
const CRDT_BINARY_MAGIC_1 = 0x43; // C
const CRDT_BINARY_MAGIC_2 = 0x55; // U
const CRDT_BINARY_VERSION = 2;
const CRDT_BINARY_TINY_TEXT_INSERT = 0xff;
const CRDT_BINARY_SINGLE_OP = 0xfe;
const CRDT_BINARY_POSITIONAL_TEXT_LOG = 0xfd;
const CRDT_BINARY_COMPRESSED_POSITIONAL_TEXT_LOG = 0xfc;
const CRDT_BINARY_COLUMNAR_POSITIONAL_TEXT_LOG = 0xfb;
const CRDT_BINARY_COMPRESSED_COLUMNAR_POSITIONAL_TEXT_LOG = 0xfa;
const CRDT_BINARY_MINI_TEXT_INSERT = 0xf9;
const CRDT_BINARY_MINI_TEXT_REMOTE_INSERT = 0xf8;
const CRDT_BINARY_PACKED_COLUMNAR_POSITIONAL_TEXT_LOG = 0xf7;
const CRDT_BINARY_COMPRESSED_PACKED_COLUMNAR_POSITIONAL_TEXT_LOG = 0xf6;
const CRDT_BINARY_PACKED_MINI_ACTOR_COLUMNAR_POSITIONAL_TEXT_LOG = 0xf5;
const CRDT_BINARY_COMPRESSED_PACKED_MINI_ACTOR_COLUMNAR_POSITIONAL_TEXT_LOG = 0xf4;
const CRDT_BINARY_PACKED_COLUMNAR_POSITIONAL_TEXT_LOG_SEGMENT = 0xf3;
const CRDT_BINARY_COMPRESSED_PACKED_COLUMNAR_POSITIONAL_TEXT_LOG_SEGMENT = 0xf2;
const CRDT_BINARY_PACKED_MINI_ACTOR_COLUMNAR_POSITIONAL_TEXT_LOG_SEGMENT = 0xf1;
const CRDT_BINARY_COMPRESSED_PACKED_MINI_ACTOR_COLUMNAR_POSITIONAL_TEXT_LOG_SEGMENT = 0xf0;
const CRDT_BINARY_MINI_MAP_SET_INT_MIN = 0x80;
const CRDT_BINARY_MINI_MAP_SET_INT_MAX = 0x9f;
const CRDT_BINARY_MINI_TEXT_PAIR_INSERT_MIN = 0xa0;
const CRDT_BINARY_MINI_TEXT_PAIR_INSERT_MAX = 0xbf;
const CRDT_BINARY_MINI_TEXT_APPEND_INSERT_MIN = 0xc0;
const CRDT_BINARY_MINI_TEXT_APPEND_INSERT_MAX = 0xdf;
const CRDT_PROFILE_VERSION = 1;
const CRDT_TEXT_PROFILE_MIN_TRANSACTIONS = 8;
const CRDT_TEXT_PROFILE_DEFAULT_ROUTE_INDEX_THRESHOLD = 4096;
const CRDT_POSITIONAL_TEXT_COMPRESSION_MIN_BYTES = 4096;
const CRDT_TEXT_PROFILE_BATCH_ROUTE_INDEX_THRESHOLD = 4096;
const CRDT_TEXT_PROFILE_BATCH_MIN = 1.05;
const CRDT_TEXT_BATCH_DELETE_RANGE_MIN = Number.MAX_SAFE_INTEGER;
const CRDT_BINARY_PATH_OPTIONS: BinaryPathCodecOptions = {
  numberTag: 1,
  stringTag: 0,
  signedNumbers: true,
  errorMessage: 'invalid binary CRDT path segment'
};
const CRDT_BINARY_JSON_VALUE_OPTIONS: BinaryJsonValueCodecOptions = {
  allowNegativeZeroInteger: true,
  errorMessage: 'invalid binary CRDT JSON value'
};
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const trustedDecodedUpdates = new WeakSet<CrdtUpdate>();
const trustedEncodedUpdates = new WeakMap<ArrayBufferView, CrdtUpdate>();
const pathKeyCache = new WeakMap<JsonPath, string>();
const scheduledTextCandidateCache = new WeakMap<CrdtOperation[], Map<number, CrdtScheduledTextEncodingCandidate | null>>();
const EMPTY_UPDATE_BYTES = new Uint8Array(0);
const EMPTY_TRANSACTION_VIEW_PATCH: Patch = [];
const EMPTY_TRANSACTION_HEADS: string[] = [];
const EMPTY_TRANSACTION_STATE_VECTOR: CrdtStateVector = {};
const EMPTY_TRANSACTION_RESULT: CrdtCommitResult = {
  update: EMPTY_UPDATE_BYTES,
  viewPatch: EMPTY_TRANSACTION_VIEW_PATCH,
  heads: EMPTY_TRANSACTION_HEADS,
  stateVector: EMPTY_TRANSACTION_STATE_VECTOR
};
const CRDT_BINARY_JSON_KEY = '$frontierBinary';
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const CRDT_PATH_SHAPE_CONST_NUMBER = 0;
const CRDT_PATH_SHAPE_CONST_STRING = 1;
const CRDT_PATH_SHAPE_VAR_NUMBER = 2;
const CRDT_PATH_SHAPE_VAR_STRING = 3;
const CRDT_INT_COLUMN_RAW = 0;
const CRDT_INT_COLUMN_ARITHMETIC = 1;
const CRDT_INT_COLUMN_DELTA = 2;
const CRDT_INT_COLUMN_RLE = 3;
const CRDT_INT_COLUMN_PERIODIC = 4;
const CRDT_PATH_SHAPE_RUN_MIN = 4;
const CRDT_PATH_SHAPE_BINARY_PREFERRED_MIN = 16;
const CRDT_INT_COLUMN_MAX_PERIOD = 1024;
const CRDT_ACTOR_SCHEDULE_TEXT_RUN_MIN = 16;
const CRDT_ACTOR_SCHEDULE_MAX_PATTERN = 64;
const CRDT_ACTOR_GRAMMAR_TEXT_RUN_MIN = 32;
const CRDT_ACTOR_GRAMMAR_MAX_RULES = 64;
const CRDT_ACTOR_GRAMMAR_MIN_PAIR_COUNT = 3;
const CRDT_ACTOR_GRAMMAR_MIN_SAVINGS = 8;
const CRDT_SCHEDULED_TEXT_CANDIDATE_MIN_SAVINGS = 8;
const CRDT_TEXT_SCHEDULE_DEPS_RAW = 0;
const CRDT_TEXT_SCHEDULE_DEPS_CHAIN = 1;
const CRDT_TEXT_SCHEDULE_DEPS_SAME = 2;
const CRDT_TEXT_SCHEDULE_AFTER_RAW = 0;
const CRDT_TEXT_SCHEDULE_AFTER_CHAIN = 1;
const CRDT_TEXT_SCHEDULE_AFTER_NULL = 2;
const CRDT_TEXT_SCHEDULE_TEXT_RAW = 0;
const CRDT_TEXT_SCHEDULE_TEXT_JOINED = 1;
const CRDT_TEXT_SCHEDULE_TEXT_REPEATED = 2;

type CrdtTextProfilePlan = {
  path: JsonPath;
  workload: 'positional-text';
  strategy: 'direct-splice' | 'batch-splice';
  averageBatchSize: number;
  maxBatchSize: number;
  transactions: number;
  operations: number;
  routeIndexThreshold: number;
};

type CrdtTextProfileStats = {
  path: JsonPath;
  transactions: number;
  operations: number;
  maxBatchSize: number;
  insertOnly: number;
  deleteOnly: number;
  replace: number;
  totalInsertCodePoints: number;
  totalDeleteCount: number;
};

type CrdtAdaptiveProfileState = {
  enabled: boolean;
  plans: ProfilePlans | undefined;
  textProfiles: Map<string, CrdtTextProfilePlan>;
  textStats: Map<string, CrdtTextProfileStats>;
};

type CrdtTextDeleteOperation =
  | Extract<CrdtOperation, { type: 'textDel' }>
  | Extract<CrdtOperation, { type: 'textDelRange' }>;

type TextDeleteRangePayload = {
  start: string;
  count: number;
  span: 'index' | 'seq';
};

type TextDeleteOperationPayload =
  | { type: 'textDel'; elems: string[]; count: number }
  | { type: 'textDelRange'; range: TextDeleteRangePayload; count: number };

interface TextSequence {
  length: number;
  at(index: number): string | null;
  tail(): string | null;
  clone(): TextSequence;
  indexOf(value: string): number;
  slice(index: number, count: number): string[];
  deleteSlice(index: number, count: number): string[];
  toArray(): string[];
  insertCreated(index: number, op: CrdtOperation, count: number): void;
  delete(index: number, count: number): void;
  textDeleteRangePayload(index: number, count: number): TextDeleteRangePayload | null;
  textDeleteRangeEquals(index: number, op: Extract<CrdtOperation, { type: 'textDelRange' }>): boolean;
  setPositionIndexThreshold(threshold: number): void;
}

type CrdtActorSchedule = {
  count: number;
  actors: string[];
  startSeqs: number[];
  pattern: number[];
};

type CrdtActorGrammarSchedule = {
  count: number;
  actors: string[];
  startSeqs: number[];
  rules: Array<[number, number]>;
  symbols: number[];
};

type CrdtScheduledTextEncodingCandidate = {
  originalEnd: number;
  ops: CrdtOperation[];
  byteLength: number;
} & (
  | { kind: 'cycle'; schedule: CrdtActorSchedule }
  | { kind: 'grammar'; schedule: CrdtActorGrammarSchedule }
);

interface NativePositionalTextLog {
  actor: string;
  path: JsonPath;
  key: string;
  initialText: string;
  baseSequence: NativeTextPieceSequence | null;
  createdText: boolean;
  initialCodeUnitAligned: boolean;
  firstSeq: number;
  firstDeps: string[];
  previousIndex: number;
  length: number;
  appendOnly: boolean;
  materializedText: string | null;
  tags: number[];
  positionDeltas: number[];
  counts: number[];
  texts: string[];
}

interface NativeColumnarTextLogUpdate {
  actor: string;
  seq: number;
  firstSeq: number;
  firstDeps: string[];
  log?: NativePositionalTextLog;
  segment?: NativeColumnarTextLogSegment;
}

interface NativeColumnarTextLogSegment {
  path: JsonPath;
  key: string;
  tags: number[];
  positionDeltas: number[];
  counts: number[];
  texts: string[];
}

type TextElementIdRange =
  | { kind: 'index'; actor: string; seq: number; startIndex: number; count: number }
  | { kind: 'seq'; actor: string; startSeq: number; count: number };

type NativeTextPiece = {
  actor: string;
  seq: number;
  index: number;
  length: number;
  span: 'index' | 'seq';
};

type TreeRecord = {
  id: string;
  parent: string | null;
  after: string | null;
  value: JsonValue;
  create: CrdtOperation;
  move: CrdtOperation;
  valueOp: CrdtOperation;
  deleteOp?: CrdtOperation;
};

export function createCrdtDocument(options?: CrdtDocumentOptions): CrdtDocument {
  return new FrontierCrdtDocument(options);
}

export function createCrdtDocumentFromSnapshot(
  snapshot: CrdtSnapshot,
  options?: CrdtDocumentOptions
): CrdtDocument {
  const doc = new FrontierCrdtDocument(options);
  doc.applySnapshot(snapshot);
  return doc;
}

export function encodeCrdtCursor(cursor: CrdtTextCursor): string {
  validateCrdtTextCursor(cursor);
  return JSON.stringify(cursor);
}

export function decodeCrdtCursor(encoded: string): CrdtTextCursor {
  const cursor = JSON.parse(encoded) as unknown;
  validateCrdtTextCursor(cursor);
  return cloneCrdtTextCursor(cursor);
}

export function encodeCrdtSelection(selection: CrdtTextSelection): string {
  validateCrdtTextSelection(selection);
  return JSON.stringify(selection);
}

export function decodeCrdtSelection(encoded: string): CrdtTextSelection {
  const selection = JSON.parse(encoded) as unknown;
  validateCrdtTextSelection(selection);
  return cloneCrdtTextSelection(selection);
}

export function encodeCrdtVersion(version: CrdtVersion): string {
  validateCrdtVersion(version);
  return JSON.stringify(version);
}

export function decodeCrdtVersion(encoded: string): CrdtVersion {
  const version = JSON.parse(encoded) as unknown;
  validateCrdtVersion(version);
  return cloneCrdtVersion(version);
}

export function encodeCrdtUpdate(update: CrdtUpdate): Uint8Array {
  if (update.ops.length === 0 && update.metadata === undefined && update.metadataEntries === undefined) return EMPTY_UPDATE_BYTES;
  if (update.metadata !== undefined || update.metadataEntries !== undefined) {
    return markEncodedUpdateIfTrusted(encodeJsonCrdtUpdate(update), update);
  }
  if (update.ops.length >= 16) {
    const positionalText = encodePositionedTextLogUpdate(update);
    if (positionalText !== null) return markEncodedUpdateIfTrusted(positionalText, update);
  }
  const miniAppendTextInsert = encodeMiniBinaryTextAppendInsertUpdate(update);
  if (miniAppendTextInsert !== null) return markEncodedUpdateIfTrusted(miniAppendTextInsert, update);
  const miniPairTextInsert = encodeMiniBinaryTextPairInsertUpdate(update);
  if (miniPairTextInsert !== null) return markEncodedUpdateIfTrusted(miniPairTextInsert, update);
  const miniTextInsert = encodeMiniBinaryTextInsertUpdate(update);
  if (miniTextInsert !== null) return markEncodedUpdateIfTrusted(miniTextInsert, update);
  const miniRemoteTextInsert = encodeMiniBinaryTextRemoteInsertUpdate(update);
  if (miniRemoteTextInsert !== null) return markEncodedUpdateIfTrusted(miniRemoteTextInsert, update);
  const tinyTextInsert = encodeTinyBinaryTextInsertUpdate(update);
  if (tinyTextInsert !== null) return markEncodedUpdateIfTrusted(tinyTextInsert, update);
  const miniMapSet = encodeMiniBinaryMapSetIntUpdate(update);
  if (miniMapSet !== null) return markEncodedUpdateIfTrusted(miniMapSet, update);
  const singleOp = encodeSingleBinaryCrdtUpdate(update);
  if (singleOp !== null) return markEncodedUpdateIfTrusted(singleOp, update);
  if (shouldPreferBinaryCrdtUpdate(update.ops) && (update.ops.length >= 16 || hasSpanningOperation(update.ops))) {
    return markEncodedUpdateIfTrusted(encodeBinaryCrdtUpdate(update), update);
  }
  const json = encodeJsonCrdtUpdate(update);
  if (update.ops.length < 16) return markEncodedUpdateIfTrusted(json, update);
  const binary = encodeBinaryCrdtUpdate(update);
  return markEncodedUpdateIfTrusted(binary.byteLength * 10 < json.byteLength * 9 ? binary : json, update);
}

function encodeTrustedCrdtUpdate(update: CrdtUpdate): Uint8Array {
  const bytes = encodeCrdtUpdate(update);
  return markEncodedUpdate(bytes, updateNeedsTrustedClone(update) ? cloneCrdtUpdateForTrust(update) : update);
}

function updateNeedsTrustedClone(update: CrdtUpdate): boolean {
  if (update.metadata !== undefined) return true;
  if (update.metadataEntries !== undefined) return true;
  for (let i = 0, length = update.ops.length; i < length; i++) {
    if (isSpanningOperation(update.ops[i])) return true;
  }
  return false;
}

function cloneCrdtUpdateForTrust(update: CrdtUpdate): CrdtUpdate {
  const ops = new Array<CrdtOperation>(update.ops.length);
  for (let i = 0, length = update.ops.length; i < length; i++) ops[i] = cloneCrdtOperationForTrust(update.ops[i]);
  return {
    actor: update.actor,
    seq: update.seq,
    deps: update.deps.slice(),
    ops,
    metadata: update.metadata === undefined ? undefined : cloneJson(update.metadata),
    metadataEntries: cloneCommitMetadataEntries(update.metadataEntries)
  };
}

function cloneCrdtOperationForTrust(op: CrdtOperation): CrdtOperation {
  if (op.type === 'set') return { ...op, path: op.path.slice() };
  if (op.type === 'del') return { ...op, path: op.path.slice() };
  if (op.type === 'binarySet') return { ...op, path: op.path.slice() };
  if (op.type === 'treeCreate') return { ...op, path: op.path.slice(), value: cloneJson(op.value) };
  if (op.type === 'treeSet') return { ...op, path: op.path.slice(), value: cloneJson(op.value) };
  if (op.type === 'treeMove') return { ...op, path: op.path.slice() };
  if (op.type === 'treeDel') return { ...op, path: op.path.slice() };
  if (op.type === 'listInsert') return { ...op, path: op.path.slice(), values: op.values.slice() };
  if (op.type === 'listRun') return { ...op, path: op.path.slice(), values: op.values.slice() };
  if (op.type === 'listDel') return { ...op, path: op.path.slice(), elems: op.elems.slice() };
  if (op.type === 'textDel') return { ...op, path: op.path.slice(), elems: op.elems.slice() };
  if (op.type === 'mapSetRun') return { ...op, path: op.path.slice(), keys: op.keys.slice(), values: op.values.slice() };
  return { ...op, path: op.path.slice() };
}

function hasSpanningOperation(ops: CrdtOperation[]): boolean {
  for (let i = 0, length = ops.length; i < length; i++) {
    if (isSpanningOperation(ops[i]) && operationSeqSpan(ops[i]) >= 16) return true;
  }
  return false;
}

function shouldPreferBinaryCrdtUpdate(ops: CrdtOperation[]): boolean {
  for (let i = 0, length = ops.length; i < length; i++) {
    if (isSpanningOperation(ops[i]) && operationSeqSpan(ops[i]) >= 16) return true;
    const scheduledTextCandidate = createOptimizedScheduledTextEncodingCandidate(ops, i);
    if (scheduledTextCandidate !== null) return true;
    const textRunEnd = textInsertRunEnd(ops, i);
    if (textRunEnd - i >= 16) return true;
    const listRunEnd = listInsertRunEnd(ops, i);
    if (listRunEnd - i >= 16) return true;
    const mapRunEnd = mapSetRunEnd(ops, i);
    if (mapRunEnd - i >= 16) return true;
    const pathShapeRunEnd = pathShapeSetRunEnd(ops, i);
    if (pathShapeRunEnd - i >= CRDT_PATH_SHAPE_BINARY_PREFERRED_MIN) return true;
  }
  return false;
}

function encodeJsonCrdtUpdate(update: CrdtUpdate): Uint8Array {
  if (update.metadata !== undefined || update.metadataEntries !== undefined) {
    return textEncoder.encode(JSON.stringify({
      magic: CRDT_UPDATE_MAGIC,
      version: CRDT_UPDATE_VERSION,
      actor: update.actor,
      seq: update.seq,
      deps: update.deps,
      ops: update.ops,
      metadata: update.metadata,
      metadataEntries: update.metadataEntries
    }));
  }
  if (update.ops.length === 1) {
    const single = encodeSingleJsonCrdtUpdate(update);
    if (single !== null) return single;
  }
  const ops = update.ops.length === 0
    ? []
    : update.ops.length === 1
      ? [encodeCompactOperation(update.ops[0], update.actor)]
      : encodeCompactOperations(update.ops, update.actor);
  const payload = [
    CRDT_UPDATE_MAGIC,
    CRDT_UPDATE_VERSION,
    update.actor,
    update.seq,
    update.deps,
    ops
  ];
  return textEncoder.encode(JSON.stringify(payload));
}

function encodeSingleJsonCrdtUpdate(update: CrdtUpdate): Uint8Array | null {
  const op = update.ops[0];
  if (isSpanningOperation(op)) return null;
  if (op.actor !== update.actor) return null;
  return encodeSingleCompactJsonUpdate(JSON.stringify(update.actor), update.seq, update.deps, op, pathKey(op.path));
}

function encodeSingleCompactJsonUpdate(
  encodedActor: string,
  seq: number,
  deps: string[],
  op: CrdtOperation,
  encodedPath: string
): Uint8Array {
  const encodedDeps = stringifyStringArray(deps);
  const prefix = '[' +
    CRDT_UPDATE_MAGIC_JSON +
    ',' +
    CRDT_UPDATE_VERSION +
    ',' +
    encodedActor +
    ',' +
    seq +
    ',' +
    encodedDeps +
    ',[[';
  const common = op.seq + ',' + (op.deps === deps ? encodedDeps : stringifyStringArray(op.deps)) + ',' + encodedPath;
  let body: string;
  if (op.type === 'set') {
    body = '0,' + common + ',' + stringifyJsonValue(op.value);
  } else if (op.type === 'del') {
    body = '1,' + common;
  } else if (op.type === 'counter') {
    body = '17,' + common + ',' + op.delta;
  } else if (op.type === 'treeCreate') {
    body = '18,' + common + ',' + JSON.stringify(op.nodeId) + ',' + stringifyNullableString(op.parent) + ',' + stringifyNullableString(op.after) + ',' + stringifyJsonValue(op.value);
  } else if (op.type === 'treeMove') {
    body = '19,' + common + ',' + JSON.stringify(op.nodeId) + ',' + stringifyNullableString(op.parent) + ',' + stringifyNullableString(op.after);
  } else if (op.type === 'treeDel') {
    body = '20,' + common + ',' + JSON.stringify(op.nodeId);
  } else if (op.type === 'binarySet') {
    body = '21,' + common + ',' + JSON.stringify(op.bytes);
  } else if (op.type === 'treeSet') {
    body = '22,' + common + ',' + JSON.stringify(op.nodeId) + ',' + stringifyJsonValue(op.value);
  } else if (op.type === 'listInsert') {
    body = '2,' + common + ',' + stringifyNullableString(op.after) + ',' + JSON.stringify(op.values);
  } else if (op.type === 'listDel') {
    body = '3,' + common + ',' + stringifyStringArray(op.elems);
  } else if (op.type === 'textInsert') {
    body = '4,' + common + ',' + stringifyNullableString(op.after) + ',' + JSON.stringify(op.text);
  } else if (op.type === 'textDel') {
    body = '5,' + common + ',' + stringifyStringArray(op.elems);
  } else if (op.type === 'textDelRange') {
    body = '10,' + common + ',' + JSON.stringify(op.start) + ',' + op.count + ',' + textDeleteSpanCode(op.span);
  } else {
    throw new TypeError('text runs cannot be encoded as single-operation JSON updates');
  }
  return textEncoder.encode(prefix + body + ']]]');
}

function encodeSingleCompactJsonTextInsert(
  encodedActor: string,
  seq: number,
  deps: string[],
  op: Extract<CrdtOperation, { type: 'textInsert' }>,
  encodedPath: string
): Uint8Array {
  const encodedDeps = stringifyStringArray(deps);
  return textEncoder.encode(
    '[' +
      CRDT_UPDATE_MAGIC_JSON +
      ',' +
      CRDT_UPDATE_VERSION +
      ',' +
      encodedActor +
      ',' +
      seq +
      ',' +
      encodedDeps +
      ',[[4,' +
      op.seq +
      ',' +
      encodedDeps +
      ',' +
      encodedPath +
      ',' +
      stringifyNullableString(op.after) +
      ',' +
      JSON.stringify(op.text) +
      ']]]'
  );
}

function stringifyJsonValue(value: JsonValue): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : JSON.stringify(value);
}

function stringifyNullableString(value: string | null): string {
  return value === null ? 'null' : JSON.stringify(value);
}

function stringifyStringArray(values: string[]): string {
  if (values.length === 0) return '[]';
  let out = '[' + JSON.stringify(values[0]);
  for (let i = 1, length = values.length; i < length; i++) out += ',' + JSON.stringify(values[i]);
  return out + ']';
}

export function decodeCrdtUpdate(bytes: ArrayBuffer | ArrayBufferView | CrdtUpdate): CrdtUpdate {
  if (isCrdtUpdate(bytes)) {
    if (bytes.metadataEntries !== undefined) validateCrdtCommitMetadataEntries(bytes.metadataEntries);
    return bytes;
  }
  if (!(bytes instanceof ArrayBuffer)) {
    const cached = trustedEncodedUpdates.get(bytes);
    if (cached !== undefined) return cached;
  }
  const view = bytes instanceof ArrayBuffer
    ? new Uint8Array(bytes)
    : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.byteLength === 0) {
    return markDecodedUpdate({ actor: '', seq: 0, deps: [], ops: [] });
  }
  if (isMiniBinaryCrdtUpdate(view)) return readMiniBinaryTextInsertUpdate(new CrdtBinaryReader(view));
  if (isBinaryCrdtUpdate(view)) return decodeBinaryCrdtUpdate(view);
  const payload = JSON.parse(textDecoder.decode(view));
  if (Array.isArray(payload)) {
    if (
      payload[0] !== CRDT_UPDATE_MAGIC ||
      payload[1] !== CRDT_UPDATE_VERSION ||
      typeof payload[2] !== 'string' ||
      !Number.isSafeInteger(payload[3]) ||
      !Array.isArray(payload[4]) ||
      !Array.isArray(payload[5])
    ) {
      throw new TypeError('invalid CRDT update');
    }
    return markDecodedUpdate({
      actor: payload[2],
      seq: payload[3],
      deps: payload[4],
      ops: decodeCompactOperations(payload[5], payload[2])
    });
  }
  if (
    payload !== null &&
    payload.magic === CRDT_UPDATE_MAGIC &&
    payload.version === CRDT_UPDATE_VERSION &&
    typeof payload.actor === 'string' &&
    Number.isSafeInteger(payload.seq) &&
    Array.isArray(payload.deps) &&
    Array.isArray(payload.ops)
  ) {
    const update: CrdtUpdate = {
      actor: payload.actor,
      seq: payload.seq,
      deps: payload.deps,
      ops: payload.ops
    };
    if (payload.metadata !== undefined) {
      if (!isJsonObject(payload.metadata)) throw new TypeError('invalid CRDT update metadata');
      update.metadata = cloneJson(payload.metadata);
    }
    if (payload.metadataEntries !== undefined) {
      validateCrdtCommitMetadataEntries(payload.metadataEntries);
      update.metadataEntries = cloneCommitMetadataEntries(payload.metadataEntries);
    }
    return markDecodedUpdate(update);
  }
  throw new TypeError('invalid CRDT update');
}

function markDecodedUpdate(update: CrdtUpdate): CrdtUpdate {
  trustedDecodedUpdates.add(update);
  return update;
}

function markEncodedUpdate(bytes: Uint8Array, update: CrdtUpdate): Uint8Array {
  trustedEncodedUpdates.set(bytes, markDecodedUpdate(update));
  return bytes;
}

function markEncodedUpdateIfTrusted(bytes: Uint8Array, update: CrdtUpdate): Uint8Array {
  if (trustedDecodedUpdates.has(update)) trustedEncodedUpdates.set(bytes, update);
  return bytes;
}

function getEncodedUpdateInput(update: ArrayBuffer | ArrayBufferView | CrdtUpdate): Uint8Array | null {
  if (isCrdtUpdate(update)) return null;
  if (update instanceof Uint8Array) return update;
  return update instanceof ArrayBuffer
    ? new Uint8Array(update)
    : new Uint8Array(update.buffer, update.byteOffset, update.byteLength);
}

function isBinaryCrdtUpdate(bytes: Uint8Array): boolean {
  return bytes.length >= 4 &&
    bytes[0] === CRDT_BINARY_MAGIC_0 &&
    bytes[1] === CRDT_BINARY_MAGIC_1 &&
    bytes[2] === CRDT_BINARY_MAGIC_2 &&
    bytes[3] === CRDT_BINARY_VERSION;
}

function isMiniBinaryCrdtUpdate(bytes: Uint8Array): boolean {
  return bytes.length !== 0 &&
    (bytes[0] === CRDT_BINARY_MINI_TEXT_INSERT ||
      bytes[0] === CRDT_BINARY_MINI_TEXT_REMOTE_INSERT ||
      (bytes[0] >= CRDT_BINARY_MINI_MAP_SET_INT_MIN && bytes[0] <= CRDT_BINARY_MINI_MAP_SET_INT_MAX) ||
      (bytes[0] >= CRDT_BINARY_MINI_TEXT_PAIR_INSERT_MIN && bytes[0] <= CRDT_BINARY_MINI_TEXT_PAIR_INSERT_MAX) ||
      (bytes[0] >= CRDT_BINARY_MINI_TEXT_APPEND_INSERT_MIN && bytes[0] <= CRDT_BINARY_MINI_TEXT_APPEND_INSERT_MAX));
}

function encodeBinaryCrdtUpdate(update: CrdtUpdate): Uint8Array {
  const writer = new CrdtBinaryWriter();
  writer.writeByte(CRDT_BINARY_MAGIC_0);
  writer.writeByte(CRDT_BINARY_MAGIC_1);
  writer.writeByte(CRDT_BINARY_MAGIC_2);
  writer.writeByte(CRDT_BINARY_VERSION);
  writer.writeString(update.actor);
  writer.writeVarint(update.seq);
  writeBinaryOperationIds(writer, update.deps);
  const recordCountOffset = writer.reserveFixedVarint();
  const recordCount = writeBinaryOperations(writer, update.ops);
  writer.patchFixedVarint(recordCountOffset, recordCount);
  return writer.finish();
}

function decodeBinaryCrdtUpdate(bytes: Uint8Array): CrdtUpdate {
  const reader = new CrdtBinaryReader(bytes);
  if (
    reader.readByte() !== CRDT_BINARY_MAGIC_0 ||
    reader.readByte() !== CRDT_BINARY_MAGIC_1 ||
    reader.readByte() !== CRDT_BINARY_MAGIC_2 ||
    reader.readByte() !== CRDT_BINARY_VERSION
  ) {
    throw new TypeError('invalid binary CRDT update');
  }
  if (reader.bytes[reader.offset] === CRDT_BINARY_TINY_TEXT_INSERT) {
    return readTinyBinaryTextInsertUpdate(reader);
  }
  if (reader.bytes[reader.offset] === CRDT_BINARY_SINGLE_OP) {
    return readSingleBinaryCrdtUpdate(reader);
  }
  if (reader.bytes[reader.offset] === CRDT_BINARY_COMPRESSED_POSITIONAL_TEXT_LOG) {
    return readCompressedPositionedTextLogUpdate(reader);
  }
  if (reader.bytes[reader.offset] === CRDT_BINARY_COMPRESSED_COLUMNAR_POSITIONAL_TEXT_LOG) {
    return readCompressedColumnarPositionedTextLogUpdate(reader);
  }
  if (reader.bytes[reader.offset] === CRDT_BINARY_COMPRESSED_PACKED_COLUMNAR_POSITIONAL_TEXT_LOG) {
    return readCompressedColumnarPositionedTextLogUpdate(reader);
  }
  if (reader.bytes[reader.offset] === CRDT_BINARY_COMPRESSED_PACKED_MINI_ACTOR_COLUMNAR_POSITIONAL_TEXT_LOG) {
    return readCompressedColumnarPositionedTextLogUpdate(reader);
  }
  if (reader.bytes[reader.offset] === CRDT_BINARY_COMPRESSED_PACKED_COLUMNAR_POSITIONAL_TEXT_LOG_SEGMENT) {
    return readCompressedColumnarPositionedTextLogUpdate(reader);
  }
  if (reader.bytes[reader.offset] === CRDT_BINARY_COMPRESSED_PACKED_MINI_ACTOR_COLUMNAR_POSITIONAL_TEXT_LOG_SEGMENT) {
    return readCompressedColumnarPositionedTextLogUpdate(reader);
  }
  if (reader.bytes[reader.offset] === CRDT_BINARY_COLUMNAR_POSITIONAL_TEXT_LOG) {
    return readColumnarPositionedTextLogUpdate(reader);
  }
  if (reader.bytes[reader.offset] === CRDT_BINARY_PACKED_COLUMNAR_POSITIONAL_TEXT_LOG) {
    return readColumnarPositionedTextLogUpdate(reader);
  }
  if (reader.bytes[reader.offset] === CRDT_BINARY_PACKED_MINI_ACTOR_COLUMNAR_POSITIONAL_TEXT_LOG) {
    return readColumnarPositionedTextLogUpdate(reader);
  }
  if (reader.bytes[reader.offset] === CRDT_BINARY_PACKED_COLUMNAR_POSITIONAL_TEXT_LOG_SEGMENT) {
    return readColumnarPositionedTextLogUpdate(reader);
  }
  if (reader.bytes[reader.offset] === CRDT_BINARY_PACKED_MINI_ACTOR_COLUMNAR_POSITIONAL_TEXT_LOG_SEGMENT) {
    return readColumnarPositionedTextLogUpdate(reader);
  }
  if (reader.bytes[reader.offset] === CRDT_BINARY_POSITIONAL_TEXT_LOG) {
    return readPositionedTextLogUpdate(reader);
  }
  const actor = reader.readString();
  const seq = reader.readVarint();
  const deps = readBinaryOperationIds(reader);
  const recordCount = reader.readVarint();
  const ops: CrdtOperation[] = [];
  for (let i = 0; i < recordCount; i++) readBinaryOperation(reader, ops);
  if (reader.offset !== bytes.length) throw new TypeError('unexpected trailing binary CRDT update data');
  return markDecodedUpdate({ actor, seq, deps, ops });
}

function encodePositionedTextLogUpdate(update: CrdtUpdate): Uint8Array | null {
  const first = update.ops[0];
  if (
    first === undefined ||
    !isTextSequenceOperation(first) ||
    first.actor !== update.actor ||
    first.seq !== 1 ||
    first.deps.length !== 0
  ) {
    return null;
  }
  const path = first.path;
  const actor = first.actor;
  const sequence = new NativeTextPieceSequence();
  const tags: number[] = [];
  const positionDeltas: number[] = [];
  const counts: number[] = [];
  const texts: string[] = [];
  let expectedSeq = first.seq;
  let expectedDeps = first.deps;
  let previousIndex = 0;

  for (let i = 0, length = update.ops.length; i < length; i++) {
    const op = update.ops[i];
    if (
      !isTextSequenceOperation(op) ||
      op.actor !== actor ||
      op.seq !== expectedSeq ||
      !samePath(op.path, path) ||
      !sameStringArray(op.deps, expectedDeps)
    ) {
      return null;
    }

    if (op.type === 'textInsert' || op.type === 'textRun') {
      const index = op.after === null ? 0 : sequence.indexOf(op.after) + 1;
      if (index < 0 || (op.after !== null && index === 0)) return null;
      const count = op.type === 'textRun' ? op.count : codePointLength(op.text);
      tags[tags.length] = op.type === 'textRun' ? 2 : 1;
      positionDeltas[positionDeltas.length] = index - previousIndex;
      counts[counts.length] = count;
      texts[texts.length] = op.text;
      sequence.insertCreated(index, op, count);
      previousIndex = index;
    } else if (isTextDeleteOperation(op)) {
      const range = sequenceTextDeleteRange(sequence, op);
      if (range === null) return null;
      tags[tags.length] = 3;
      positionDeltas[positionDeltas.length] = range.index - previousIndex;
      counts[counts.length] = range.count;
      sequence.delete(range.index, range.count);
      previousIndex = range.index;
    } else {
      return null;
    }

    expectedSeq = operationEndSeq(op) + 1;
    expectedDeps = [operationHeadId(op)];
  }

  return encodeColumnarPositionedTextLogUpdate(update, first, path, tags, positionDeltas, counts, texts);
}

function encodeColumnarPositionedTextLogUpdate(
  update: CrdtUpdate,
  first: CrdtOperation,
  path: JsonPath,
  tags: number[],
  positionDeltas: number[],
  counts: number[],
  texts: string[]
): Uint8Array {
  return encodeColumnarPositionedTextLogUpdateText(update, first, path, tags, positionDeltas, counts, texts.join(''));
}

function encodeColumnarPositionedTextLogUpdateText(
  update: CrdtUpdate,
  first: CrdtOperation,
  path: JsonPath,
  tags: number[],
  positionDeltas: number[],
  counts: number[],
  text: string,
  segment = false
): Uint8Array {
  let bestRaw = encodeColumnarPositionedTextLogUpdateMode(update, first, path, tags, positionDeltas, counts, text, 0, false, segment);
  const compressionCandidates: Uint8Array[] = [bestRaw];
  const candidateModes = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
  for (let i = 0, length = candidateModes.length; i < length; i++) {
    const candidate = encodeColumnarPositionedTextLogUpdateMode(update, first, path, tags, positionDeltas, counts, text, candidateModes[i], false, segment);
    if (candidate.byteLength < bestRaw.byteLength) bestRaw = candidate;
    insertSmallestBinaryCandidate(compressionCandidates, candidate, 8);
  }
  let best = bestRaw;
  for (let i = 0, length = compressionCandidates.length; i < length; i++) {
    const compressed = maybeCompressColumnarPositionedTextLogUpdate(compressionCandidates[i]);
    if (compressed.byteLength < best.byteLength) best = compressed;
  }
  return best;
}

function encodeColumnarPositionedTextLogUpdateMode(
  update: CrdtUpdate,
  first: CrdtOperation,
  path: JsonPath,
  tags: number[],
  positionDeltas: number[],
  counts: number[],
  text: string,
  columnMode: 0 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12,
  compress = true,
  segment = false
): Uint8Array {
  const packedHeader = canUsePackedColumnarTextHeader(update, first, tags.length);
  const packedActor = packedHeader ? packMiniActor(update.actor) : null;
  const writer = new CrdtBinaryWriter();
  writer.writeByte(CRDT_BINARY_MAGIC_0);
  writer.writeByte(CRDT_BINARY_MAGIC_1);
  writer.writeByte(CRDT_BINARY_MAGIC_2);
  writer.writeByte(CRDT_BINARY_VERSION);
  writer.writeByte(
    packedActor !== null
      ? segment
        ? CRDT_BINARY_PACKED_MINI_ACTOR_COLUMNAR_POSITIONAL_TEXT_LOG_SEGMENT
        : CRDT_BINARY_PACKED_MINI_ACTOR_COLUMNAR_POSITIONAL_TEXT_LOG
      : packedHeader
        ? segment
          ? CRDT_BINARY_PACKED_COLUMNAR_POSITIONAL_TEXT_LOG_SEGMENT
          : CRDT_BINARY_PACKED_COLUMNAR_POSITIONAL_TEXT_LOG
        : CRDT_BINARY_COLUMNAR_POSITIONAL_TEXT_LOG
  );
  if (packedActor !== null) {
    writer.writeByte(update.actor.length);
    writeRawBinaryBytes(writer, packedActor);
  } else {
    writer.writeString(update.actor);
  }
  if (packedHeader) {
    writer.writeVarint(first.seq);
    writeBinaryOperationIds(writer, first.deps);
  } else {
    writer.writeVarint(update.seq);
    writeBinaryOperationIds(writer, update.deps);
    writer.writeVarint(first.seq);
    writeBinaryOperationIds(writer, first.deps);
  }
  writeTinyTextPath(writer, path);
  writer.writeByte(columnMode);
  writer.writeVarint(tags.length);
  if (columnMode === 6 || columnMode === 7 || columnMode === 8 || columnMode === 9 || columnMode === 11 || columnMode === 12) {
    writeBinaryTextTagColumn(writer, tags);
  } else {
    writePackedTwoBitValues(writer, tags);
  }
  if (columnMode === 8 || columnMode === 9) {
    writeRleSignedVarintColumn(writer, positionDeltas);
  } else if (columnMode === 4 || columnMode === 5 || columnMode === 6 || columnMode === 7 || columnMode === 12) {
    writeTopValueSignedVarintColumn(writer, positionDeltas);
  } else if (columnMode === 2) {
    writeBinarySignedIntegerColumn(writer, positionDeltas);
  } else {
    for (let i = 0, length = positionDeltas.length; i < length; i++) writer.writeSignedVarint(positionDeltas[i]);
  }

  if (columnMode === 10 || columnMode === 11 || columnMode === 12) {
    writeNibbleVarintColumn(writer, counts);
  } else if (columnMode === 3 || columnMode === 5 || columnMode === 7 || columnMode === 8) {
    writeSparseOneVarintColumn(writer, counts);
  } else if (columnMode === 2) {
    writeBinarySignedIntegerColumn(writer, counts);
  } else {
    for (let i = 0, length = counts.length; i < length; i++) writer.writeVarint(counts[i]);
  }
  writer.writeString(text);
  const raw = writer.finish();
  return compress ? maybeCompressColumnarPositionedTextLogUpdate(raw) : raw;
}

function canUsePackedColumnarTextHeader(update: CrdtUpdate, first: CrdtOperation, count: number): boolean {
  if (count <= 0 || first.actor !== update.actor) return false;
  const lastSeq = first.seq + count - 1;
  return update.seq === lastSeq &&
    update.deps.length === 1 &&
    update.deps[0] === `${update.actor}:${lastSeq}`;
}

function insertSmallestBinaryCandidate(candidates: Uint8Array[], candidate: Uint8Array, limit: number): void {
  let index = candidates.length;
  while (index > 0 && candidate.byteLength < candidates[index - 1].byteLength) index--;
  candidates.splice(index, 0, candidate);
  if (candidates.length > limit) candidates.length = limit;
}

function maybeCompressColumnarPositionedTextLogUpdate(raw: Uint8Array): Uint8Array {
  if (raw.byteLength < CRDT_POSITIONAL_TEXT_COMPRESSION_MIN_BYTES) return raw;
  const body = raw.subarray(5);
  const compressed = compressCrdtLzBlock(body);
  const compressedHeaderBytes = 5 + varintByteLength(body.byteLength);
  if (compressed.byteLength + compressedHeaderBytes >= raw.byteLength) return raw;
  const compressedTag = raw[4] === CRDT_BINARY_PACKED_MINI_ACTOR_COLUMNAR_POSITIONAL_TEXT_LOG_SEGMENT
    ? CRDT_BINARY_COMPRESSED_PACKED_MINI_ACTOR_COLUMNAR_POSITIONAL_TEXT_LOG_SEGMENT
    : raw[4] === CRDT_BINARY_PACKED_COLUMNAR_POSITIONAL_TEXT_LOG_SEGMENT
      ? CRDT_BINARY_COMPRESSED_PACKED_COLUMNAR_POSITIONAL_TEXT_LOG_SEGMENT
      : raw[4] === CRDT_BINARY_PACKED_MINI_ACTOR_COLUMNAR_POSITIONAL_TEXT_LOG
    ? CRDT_BINARY_COMPRESSED_PACKED_MINI_ACTOR_COLUMNAR_POSITIONAL_TEXT_LOG
    : raw[4] === CRDT_BINARY_PACKED_COLUMNAR_POSITIONAL_TEXT_LOG
      ? CRDT_BINARY_COMPRESSED_PACKED_COLUMNAR_POSITIONAL_TEXT_LOG
      : CRDT_BINARY_COMPRESSED_COLUMNAR_POSITIONAL_TEXT_LOG;

  const writer = new CrdtBinaryWriter();
  writer.writeByte(CRDT_BINARY_MAGIC_0);
  writer.writeByte(CRDT_BINARY_MAGIC_1);
  writer.writeByte(CRDT_BINARY_MAGIC_2);
  writer.writeByte(CRDT_BINARY_VERSION);
  writer.writeByte(compressedTag);
  writer.writeVarint(body.byteLength);
  writeRawBinaryBytes(writer, compressed);
  return writer.finish();
}

function readCompressedColumnarPositionedTextLogUpdate(reader: CrdtBinaryReader): CrdtUpdate {
  const tag = reader.readByte();
  const rawBodyLength = reader.readVarint();
  const compressed = reader.bytes.subarray(reader.offset);
  reader.offset = reader.bytes.length;
  const body = decompressCrdtLzBlock(compressed, rawBodyLength);
  const raw = new Uint8Array(body.byteLength + 5);
  raw[0] = CRDT_BINARY_MAGIC_0;
  raw[1] = CRDT_BINARY_MAGIC_1;
  raw[2] = CRDT_BINARY_MAGIC_2;
  raw[3] = CRDT_BINARY_VERSION;
  raw[4] = tag === CRDT_BINARY_COMPRESSED_PACKED_COLUMNAR_POSITIONAL_TEXT_LOG
    ? CRDT_BINARY_PACKED_COLUMNAR_POSITIONAL_TEXT_LOG
    : tag === CRDT_BINARY_COMPRESSED_PACKED_MINI_ACTOR_COLUMNAR_POSITIONAL_TEXT_LOG
      ? CRDT_BINARY_PACKED_MINI_ACTOR_COLUMNAR_POSITIONAL_TEXT_LOG
      : tag === CRDT_BINARY_COMPRESSED_PACKED_COLUMNAR_POSITIONAL_TEXT_LOG_SEGMENT
        ? CRDT_BINARY_PACKED_COLUMNAR_POSITIONAL_TEXT_LOG_SEGMENT
        : tag === CRDT_BINARY_COMPRESSED_PACKED_MINI_ACTOR_COLUMNAR_POSITIONAL_TEXT_LOG_SEGMENT
          ? CRDT_BINARY_PACKED_MINI_ACTOR_COLUMNAR_POSITIONAL_TEXT_LOG_SEGMENT
      : CRDT_BINARY_COLUMNAR_POSITIONAL_TEXT_LOG;
  raw.set(body, 5);
  return decodeBinaryCrdtUpdate(raw);
}

function tryReadNativeColumnarPositionedTextLogUpdate(bytes: Uint8Array): NativeColumnarTextLogUpdate | null {
  if (!isBinaryCrdtUpdate(bytes) || bytes.byteLength < 5) return null;
  try {
    const tag = bytes[4];
    if (
      tag === CRDT_BINARY_COMPRESSED_COLUMNAR_POSITIONAL_TEXT_LOG ||
      tag === CRDT_BINARY_COMPRESSED_PACKED_COLUMNAR_POSITIONAL_TEXT_LOG ||
      tag === CRDT_BINARY_COMPRESSED_PACKED_MINI_ACTOR_COLUMNAR_POSITIONAL_TEXT_LOG ||
      tag === CRDT_BINARY_COMPRESSED_PACKED_COLUMNAR_POSITIONAL_TEXT_LOG_SEGMENT ||
      tag === CRDT_BINARY_COMPRESSED_PACKED_MINI_ACTOR_COLUMNAR_POSITIONAL_TEXT_LOG_SEGMENT
    ) {
      const reader = new CrdtBinaryReader(bytes);
      reader.offset = 5;
      const rawBodyLength = reader.readVarint();
      const compressed = reader.bytes.subarray(reader.offset);
      const body = decompressCrdtLzBlock(compressed, rawBodyLength);
      const raw = new Uint8Array(body.byteLength + 5);
      raw[0] = CRDT_BINARY_MAGIC_0;
      raw[1] = CRDT_BINARY_MAGIC_1;
      raw[2] = CRDT_BINARY_MAGIC_2;
      raw[3] = CRDT_BINARY_VERSION;
      raw[4] = tag === CRDT_BINARY_COMPRESSED_PACKED_COLUMNAR_POSITIONAL_TEXT_LOG
        ? CRDT_BINARY_PACKED_COLUMNAR_POSITIONAL_TEXT_LOG
        : tag === CRDT_BINARY_COMPRESSED_PACKED_MINI_ACTOR_COLUMNAR_POSITIONAL_TEXT_LOG
          ? CRDT_BINARY_PACKED_MINI_ACTOR_COLUMNAR_POSITIONAL_TEXT_LOG
          : tag === CRDT_BINARY_COMPRESSED_PACKED_COLUMNAR_POSITIONAL_TEXT_LOG_SEGMENT
            ? CRDT_BINARY_PACKED_COLUMNAR_POSITIONAL_TEXT_LOG_SEGMENT
            : tag === CRDT_BINARY_COMPRESSED_PACKED_MINI_ACTOR_COLUMNAR_POSITIONAL_TEXT_LOG_SEGMENT
              ? CRDT_BINARY_PACKED_MINI_ACTOR_COLUMNAR_POSITIONAL_TEXT_LOG_SEGMENT
          : CRDT_BINARY_COLUMNAR_POSITIONAL_TEXT_LOG;
      raw.set(body, 5);
      return readNativeColumnarPositionedTextLogUpdate(raw);
    }
    if (
      tag !== CRDT_BINARY_COLUMNAR_POSITIONAL_TEXT_LOG &&
      tag !== CRDT_BINARY_PACKED_COLUMNAR_POSITIONAL_TEXT_LOG &&
      tag !== CRDT_BINARY_PACKED_MINI_ACTOR_COLUMNAR_POSITIONAL_TEXT_LOG &&
      tag !== CRDT_BINARY_PACKED_COLUMNAR_POSITIONAL_TEXT_LOG_SEGMENT &&
      tag !== CRDT_BINARY_PACKED_MINI_ACTOR_COLUMNAR_POSITIONAL_TEXT_LOG_SEGMENT
    ) {
      return null;
    }
    return readNativeColumnarPositionedTextLogUpdate(bytes);
  } catch {
    return null;
  }
}

function isColumnarTextLogTag(tag: number): boolean {
  return tag === CRDT_BINARY_COLUMNAR_POSITIONAL_TEXT_LOG ||
    tag === CRDT_BINARY_PACKED_COLUMNAR_POSITIONAL_TEXT_LOG ||
    tag === CRDT_BINARY_PACKED_MINI_ACTOR_COLUMNAR_POSITIONAL_TEXT_LOG ||
    tag === CRDT_BINARY_PACKED_COLUMNAR_POSITIONAL_TEXT_LOG_SEGMENT ||
    tag === CRDT_BINARY_PACKED_MINI_ACTOR_COLUMNAR_POSITIONAL_TEXT_LOG_SEGMENT;
}

function isPackedColumnarTextLogTag(tag: number): boolean {
  return tag === CRDT_BINARY_PACKED_COLUMNAR_POSITIONAL_TEXT_LOG ||
    tag === CRDT_BINARY_PACKED_MINI_ACTOR_COLUMNAR_POSITIONAL_TEXT_LOG ||
    tag === CRDT_BINARY_PACKED_COLUMNAR_POSITIONAL_TEXT_LOG_SEGMENT ||
    tag === CRDT_BINARY_PACKED_MINI_ACTOR_COLUMNAR_POSITIONAL_TEXT_LOG_SEGMENT;
}

function isColumnarTextLogSegmentTag(tag: number): boolean {
  return tag === CRDT_BINARY_PACKED_COLUMNAR_POSITIONAL_TEXT_LOG_SEGMENT ||
    tag === CRDT_BINARY_PACKED_MINI_ACTOR_COLUMNAR_POSITIONAL_TEXT_LOG_SEGMENT;
}

function readColumnarTextLogActor(reader: CrdtBinaryReader, tag: number): string {
  if (
    tag !== CRDT_BINARY_PACKED_MINI_ACTOR_COLUMNAR_POSITIONAL_TEXT_LOG &&
    tag !== CRDT_BINARY_PACKED_MINI_ACTOR_COLUMNAR_POSITIONAL_TEXT_LOG_SEGMENT
  ) {
    return reader.readString();
  }
  const actorLength = reader.readByte();
  const actorBytes = Math.ceil((actorLength * 5) / 8);
  if (reader.offset + actorBytes > reader.bytes.length) throw new TypeError('unexpected end of packed CRDT text actor');
  const actor = unpackMiniActor(reader.bytes.subarray(reader.offset, reader.offset + actorBytes), actorLength);
  reader.offset += actorBytes;
  return actor;
}

function readNativeColumnarPositionedTextLogUpdate(bytes: Uint8Array): NativeColumnarTextLogUpdate | null {
  const reader = new CrdtBinaryReader(bytes);
  if (
    reader.readByte() !== CRDT_BINARY_MAGIC_0 ||
    reader.readByte() !== CRDT_BINARY_MAGIC_1 ||
    reader.readByte() !== CRDT_BINARY_MAGIC_2 ||
    reader.readByte() !== CRDT_BINARY_VERSION
  ) {
    return null;
  }
  const tag = reader.readByte();
  if (!isColumnarTextLogTag(tag)) return null;
  const packedHeader = isPackedColumnarTextLogTag(tag);
  const actor = readColumnarTextLogActor(reader, tag);
  let updateSeq = 0;
  let updateDeps: string[] = [];
  let firstSeq: number;
  if (packedHeader) {
    firstSeq = reader.readVarint();
  } else {
    updateSeq = reader.readVarint();
    updateDeps = readBinaryOperationIds(reader);
    firstSeq = reader.readVarint();
  }
  const firstDeps = readBinaryOperationIds(reader);
  const path = readTinyTextPath(reader);
  const columnMode = reader.readByte();
  if (![0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].includes(columnMode)) return null;
  const recordCount = reader.readVarint();
  if (packedHeader) {
    updateSeq = firstSeq + recordCount - 1;
    updateDeps = [`${actor}:${updateSeq}`];
  }
  if (recordCount <= 0 || updateSeq !== firstSeq + recordCount - 1) return null;
  if (updateDeps.length !== 1 || updateDeps[0] !== `${actor}:${updateSeq}`) return null;
  const tags = columnMode === 6 || columnMode === 7 || columnMode === 8 || columnMode === 9 || columnMode === 11 || columnMode === 12
    ? readBinaryTextTagColumn(reader, recordCount)
    : readPackedTwoBitValues(reader, recordCount);
  const positionDeltas = columnMode === 8 || columnMode === 9
    ? readRleSignedVarintColumn(reader, recordCount)
    : columnMode === 4 || columnMode === 5 || columnMode === 6 || columnMode === 7 || columnMode === 12
      ? readTopValueSignedVarintColumn(reader, recordCount)
      : columnMode === 2
        ? readBinarySignedIntegerColumn(reader, recordCount)
        : readPlainSignedVarintColumn(reader, recordCount);
  const counts = columnMode === 10 || columnMode === 11 || columnMode === 12
    ? readNibbleVarintColumn(reader, recordCount)
    : columnMode === 3 || columnMode === 5 || columnMode === 7 || columnMode === 8
      ? readSparseOneVarintColumn(reader, recordCount)
      : columnMode === 2
        ? readBinarySignedIntegerColumn(reader, recordCount)
        : readPlainVarintColumn(reader, recordCount);
  const text = reader.readString();
  if (reader.offset !== reader.bytes.length) return null;
  if (isColumnarTextLogSegmentTag(tag)) {
    const texts = splitColumnarTextLogTexts(tags, counts, text);
    if (texts === null) return null;
    return {
      actor,
      seq: updateSeq,
      firstSeq,
      firstDeps,
      segment: {
        path,
        key: sequenceCacheKey(path, 'text'),
        tags,
        positionDeltas,
        counts,
        texts
      }
    };
  }

  let previousIndex = 0;
  let textOffset = 0;
  let length = 0;
  let appendOnly = true;
  const texts: string[] = [];
  let materialized: ChunkedTextValue | null = null;
  for (let i = 0; i < recordCount; i++) {
    const tag = tags[i];
    if (tag !== 1 && tag !== 2 && tag !== 3) return null;
    const index = previousIndex + positionDeltas[i];
    const count = counts[i];
    if (!Number.isSafeInteger(index) || index < 0 || !Number.isSafeInteger(count) || count <= 0) return null;
    previousIndex = index;
    if (tag === 1 || tag === 2) {
      const priorTextOffset = textOffset;
      if (index > length) return null;
      const slice = sliceStringCodePoints(text, textOffset, count);
      if (slice.text.length === 0) return null;
      textOffset = slice.nextOffset;
      texts[texts.length] = slice.text;
      if (index !== length) {
        appendOnly = false;
        if (materialized === null) materialized = ChunkedTextValue.fromString(text.slice(0, priorTextOffset));
      }
      if (materialized !== null) materialized.insert(index, slice.text, count);
      length += count;
    } else {
      if (index + count > length) return null;
      appendOnly = false;
      if (materialized === null) materialized = ChunkedTextValue.fromString(text.slice(0, textOffset));
      materialized.delete(index, count);
      length -= count;
    }
  }
  if (textOffset !== text.length) return null;
  const materializedText = materialized === null ? text : materialized.toString();
  const key = sequenceCacheKey(path, 'text');
  return {
    actor,
    seq: updateSeq,
    firstSeq,
    firstDeps,
    log: {
      actor,
      path,
      key,
      initialText: '',
      baseSequence: null,
      createdText: true,
      initialCodeUnitAligned: false,
      firstSeq,
      firstDeps,
      previousIndex,
      length,
      appendOnly,
      materializedText,
      tags,
      positionDeltas,
      counts,
      texts
    }
  };
}

function readColumnarPositionedTextLogUpdate(reader: CrdtBinaryReader): CrdtUpdate {
  const tag = reader.readByte();
  if (!isColumnarTextLogTag(tag)) {
    throw new TypeError('invalid columnar CRDT text tag');
  }
  if (isColumnarTextLogSegmentTag(tag)) {
    throw new TypeError('columnar CRDT text segment requires document context');
  }
  const actor = readColumnarTextLogActor(reader, tag);
  const packedHeader = isPackedColumnarTextLogTag(tag);
  let updateSeq = 0;
  let updateDeps: string[] = [];
  let seq: number;
  if (packedHeader) {
    seq = reader.readVarint();
  } else {
    updateSeq = reader.readVarint();
    updateDeps = readBinaryOperationIds(reader);
    seq = reader.readVarint();
  }
  let deps = readBinaryOperationIds(reader);
  const path = readTinyTextPath(reader);
  const columnMode = reader.readByte();
  if (![0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].includes(columnMode)) throw new TypeError('invalid columnar CRDT text mode');
  const recordCount = reader.readVarint();
  if (packedHeader) {
    updateSeq = seq + recordCount - 1;
    updateDeps = [`${actor}:${updateSeq}`];
  }
  const tags = columnMode === 6 || columnMode === 7 || columnMode === 8 || columnMode === 9 || columnMode === 11 || columnMode === 12
    ? readBinaryTextTagColumn(reader, recordCount)
    : readPackedTwoBitValues(reader, recordCount);
  const positionDeltas = columnMode === 8 || columnMode === 9
    ? readRleSignedVarintColumn(reader, recordCount)
    : columnMode === 4 || columnMode === 5 || columnMode === 6 || columnMode === 7 || columnMode === 12
      ? readTopValueSignedVarintColumn(reader, recordCount)
      : columnMode === 2
        ? readBinarySignedIntegerColumn(reader, recordCount)
        : readPlainSignedVarintColumn(reader, recordCount);
  const counts = columnMode === 10 || columnMode === 11 || columnMode === 12
    ? readNibbleVarintColumn(reader, recordCount)
    : columnMode === 3 || columnMode === 5 || columnMode === 7 || columnMode === 8
      ? readSparseOneVarintColumn(reader, recordCount)
      : columnMode === 2
        ? readBinarySignedIntegerColumn(reader, recordCount)
      : readPlainVarintColumn(reader, recordCount);
  const text = reader.readString();
  const ops: CrdtOperation[] = [];
  const sequence = new NativeTextPieceSequence();
  let previousIndex = 0;
  let textOffset = 0;

  for (let i = 0; i < recordCount; i++) {
    const tag = tags[i];
    const index = previousIndex + positionDeltas[i];
    const count = counts[i];
    if (!Number.isSafeInteger(index) || index < 0) throw new TypeError('invalid columnar CRDT text index');
    if (!Number.isSafeInteger(count) || count <= 0) throw new TypeError('invalid columnar CRDT text count');
    previousIndex = index;
    const id = `${actor}:${seq}`;

    if (tag === 1 || tag === 2) {
      const slice = sliceStringCodePoints(text, textOffset, count);
      if (slice.text.length === 0) throw new TypeError('invalid columnar CRDT text insert');
      textOffset = slice.nextOffset;
      const after = index === 0 ? null : sequence.at(index - 1);
      if (index !== 0 && after === null) throw new TypeError('invalid columnar CRDT text insert index');
      const op: CrdtOperation = tag === 2
        ? { type: 'textRun', id, actor, seq, deps, path, after, text: slice.text, count }
        : { type: 'textInsert', id, actor, seq, deps, path, after, text: slice.text };
      ops[ops.length] = op;
      sequence.insertCreated(index, op, count);
      seq = operationEndSeq(op) + 1;
      deps = [operationHeadId(op)];
    } else if (tag === 3) {
      const payload = createTextDeleteOperationPayloadFromSequence(sequence, index, count);
      if (payload === null) throw new TypeError('invalid columnar CRDT text delete range');
      const op = payload.type === 'textDel'
        ? { type: 'textDel', id, actor, seq, deps, path, elems: payload.elems } as CrdtOperation
        : { type: 'textDelRange', id, actor, seq, deps, path, start: payload.range.start, count: payload.range.count, span: payload.range.span } as CrdtOperation;
      ops[ops.length] = op;
      sequence.delete(index, payload.count);
      seq = operationEndSeq(op) + 1;
      deps = [operationHeadId(op)];
    } else {
      throw new TypeError('unknown columnar CRDT text operation');
    }
  }

  if (textOffset !== text.length) throw new TypeError('unused columnar CRDT text content');
  if (reader.offset !== reader.bytes.length) throw new TypeError('unexpected trailing binary CRDT update data');
  return markDecodedUpdate({ actor, seq: updateSeq, deps: updateDeps, ops });
}

function splitColumnarTextLogTexts(tags: number[], counts: number[], text: string): string[] | null {
  const texts: string[] = [];
  let textOffset = 0;
  for (let i = 0, length = tags.length; i < length; i++) {
    const tag = tags[i];
    const count = counts[i];
    if (!Number.isSafeInteger(count) || count <= 0) return null;
    if (tag === 1 || tag === 2) {
      const slice = sliceStringCodePoints(text, textOffset, count);
      if (slice.text.length === 0) return null;
      textOffset = slice.nextOffset;
      texts[texts.length] = slice.text;
    } else if (tag !== 3) {
      return null;
    }
  }
  return textOffset === text.length ? texts : null;
}

function maybeCompressPositionedTextLogUpdate(raw: Uint8Array): Uint8Array {
  if (raw.byteLength < CRDT_POSITIONAL_TEXT_COMPRESSION_MIN_BYTES) return raw;
  const body = raw.subarray(5);
  const compressed = compressCrdtLzBlock(body);
  const compressedHeaderBytes = 5 + varintByteLength(body.byteLength);
  if (compressed.byteLength + compressedHeaderBytes >= raw.byteLength) return raw;

  const writer = new CrdtBinaryWriter();
  writer.writeByte(CRDT_BINARY_MAGIC_0);
  writer.writeByte(CRDT_BINARY_MAGIC_1);
  writer.writeByte(CRDT_BINARY_MAGIC_2);
  writer.writeByte(CRDT_BINARY_VERSION);
  writer.writeByte(CRDT_BINARY_COMPRESSED_POSITIONAL_TEXT_LOG);
  writer.writeVarint(body.byteLength);
  writeRawBinaryBytes(writer, compressed);
  return writer.finish();
}

function readCompressedPositionedTextLogUpdate(reader: CrdtBinaryReader): CrdtUpdate {
  reader.readByte();
  const rawBodyLength = reader.readVarint();
  const compressed = reader.bytes.subarray(reader.offset);
  reader.offset = reader.bytes.length;
  const body = decompressCrdtLzBlock(compressed, rawBodyLength);
  const raw = new Uint8Array(body.byteLength + 5);
  raw[0] = CRDT_BINARY_MAGIC_0;
  raw[1] = CRDT_BINARY_MAGIC_1;
  raw[2] = CRDT_BINARY_MAGIC_2;
  raw[3] = CRDT_BINARY_VERSION;
  raw[4] = CRDT_BINARY_POSITIONAL_TEXT_LOG;
  raw.set(body, 5);
  return decodeBinaryCrdtUpdate(raw);
}

function readPositionedTextLogUpdate(reader: CrdtBinaryReader): CrdtUpdate {
  reader.readByte();
  const actor = reader.readString();
  const updateSeq = reader.readVarint();
  const updateDeps = readBinaryOperationIds(reader);
  let seq = reader.readVarint();
  let deps = readBinaryOperationIds(reader);
  const path = readTinyTextPath(reader);
  const recordCount = reader.readVarint();
  const ops: CrdtOperation[] = [];
  const sequence = new NativeTextPieceSequence();
  let previousIndex = 0;

  for (let i = 0; i < recordCount; i++) {
    const tag = reader.readByte();
    const index = previousIndex + reader.readSignedVarint();
    if (!Number.isSafeInteger(index) || index < 0) throw new TypeError('invalid positioned CRDT text index');
    previousIndex = index;
    const id = `${actor}:${seq}`;

    if (tag === 1 || tag === 2) {
      const text = reader.readString();
      if (text.length === 0) throw new TypeError('invalid positioned CRDT text insert');
      const count = codePointLength(text);
      const after = index === 0 ? null : sequence.at(index - 1);
      if (index !== 0 && after === null) throw new TypeError('invalid positioned CRDT text insert index');
      const op: CrdtOperation = tag === 2
        ? { type: 'textRun', id, actor, seq, deps, path, after, text, count }
        : { type: 'textInsert', id, actor, seq, deps, path, after, text };
      ops[ops.length] = op;
      sequence.insertCreated(index, op, count);
      seq = operationEndSeq(op) + 1;
      deps = [operationHeadId(op)];
    } else if (tag === 3) {
      const count = reader.readVarint();
      const payload = createTextDeleteOperationPayloadFromSequence(sequence, index, count);
      if (payload === null) throw new TypeError('invalid positioned CRDT text delete range');
      const op = payload.type === 'textDel'
        ? { type: 'textDel', id, actor, seq, deps, path, elems: payload.elems } as CrdtOperation
        : { type: 'textDelRange', id, actor, seq, deps, path, start: payload.range.start, count: payload.range.count, span: payload.range.span } as CrdtOperation;
      ops[ops.length] = op;
      sequence.delete(index, payload.count);
      seq = operationEndSeq(op) + 1;
      deps = [operationHeadId(op)];
    } else {
      throw new TypeError('unknown positioned CRDT text operation');
    }
  }

  if (reader.offset !== reader.bytes.length) throw new TypeError('unexpected trailing binary CRDT update data');
  return markDecodedUpdate({ actor, seq: updateSeq, deps: updateDeps, ops });
}

function encodeTinyBinaryTextInsertUpdate(update: CrdtUpdate): Uint8Array | null {
  if (update.ops.length !== 1) return null;
  const op = update.ops[0];
  if (op.type !== 'textInsert' || op.actor !== update.actor || op.seq !== update.seq) return null;
  if (op.deps !== update.deps && !sameStringArray(op.deps, update.deps)) return null;

  const depsMode = tinyChainDepsMode(update.actor, update.seq, update.deps);
  if (depsMode === 0) return null;
  const afterMode = tinyTextAfterMode(update.actor, update.seq, op.after);
  if (afterMode === 0 && op.after !== null) return null;

  const writer = new CrdtBinaryWriter();
  writer.writeByte(CRDT_BINARY_MAGIC_0);
  writer.writeByte(CRDT_BINARY_MAGIC_1);
  writer.writeByte(CRDT_BINARY_MAGIC_2);
  writer.writeByte(CRDT_BINARY_VERSION);
  writer.writeByte(CRDT_BINARY_TINY_TEXT_INSERT);
  writer.writeString(update.actor);
  writer.writeVarint(update.seq);
  writer.writeByte(depsMode);
  writeTinyTextPath(writer, op.path);
  writer.writeByte(afterMode);
  writer.writeString(op.text);
  return writer.finish();
}

function encodeMiniBinaryTextInsertUpdate(update: CrdtUpdate): Uint8Array | null {
  if (update.ops.length !== 1) return null;
  const op = update.ops[0];
  if (op.type !== 'textInsert' || op.actor !== update.actor || op.seq !== update.seq) return null;
  if (op.deps !== update.deps && !sameStringArray(op.deps, update.deps)) return null;
  if (op.path.length !== 1 || op.path[0] !== 'text') return null;
  if (op.text.length !== 1) return null;
  const char = op.text.charCodeAt(0);
  if (char > 0x7f) return null;

  let flags = 0;
  if (update.deps.length === 0) {
    if (update.seq !== 1) return null;
  } else if (update.seq > 1 && update.deps.length === 1 && operationIdMatchesActorSeq(update.deps[0], update.actor, update.seq - 1)) {
    flags |= 1;
  } else {
    return null;
  }

  if (op.after === null) {
    // Null anchor is encoded by a cleared bit.
  } else if (update.seq > 1 && textElementIdMatchesActorSeqZero(op.after, update.actor, update.seq - 1)) {
    flags |= 2;
  } else {
    return null;
  }

  const packedActor = packMiniActor(update.actor);
  if (packedActor === null) return null;
  const writer = new CrdtBinaryWriter();
  writer.writeByte(CRDT_BINARY_MINI_TEXT_INSERT);
  writer.writeByte(update.actor.length);
  for (let i = 0, length = packedActor.length; i < length; i++) writer.writeByte(packedActor[i]);
  writer.writeVarint(update.seq);
  writer.writeByte(flags);
  writer.writeByte(char);
  return writer.finish();
}

function encodeMiniBinaryTextAppendInsertUpdate(update: CrdtUpdate): Uint8Array | null {
  if (update.ops.length !== 1) return null;
  const op = update.ops[0];
  if (op.type !== 'textInsert' || op.actor !== update.actor || op.seq !== update.seq) return null;
  if (op.deps !== update.deps && !sameStringArray(op.deps, update.deps)) return null;
  if (op.path.length !== 1 || op.path[0] !== 'text') return null;
  if (op.text.length !== 1) return null;
  const char = op.text.charCodeAt(0);
  if (char > 0x7f) return null;
  if (update.actor.length < 1 || update.actor.length > 32) return null;

  if (update.seq === 1) {
    if (update.deps.length !== 0 || op.after !== null) return null;
  } else if (
    update.deps.length !== 1 ||
    !operationIdMatchesActorSeq(update.deps[0], update.actor, update.seq - 1) ||
    op.after === null ||
    !textElementIdMatchesActorSeqZero(op.after, update.actor, update.seq - 1)
  ) {
    return null;
  }

  const packedActor = packMiniActor(update.actor);
  if (packedActor === null) return null;
  const writer = new CrdtBinaryWriter();
  writer.writeByte(CRDT_BINARY_MINI_TEXT_APPEND_INSERT_MIN + update.actor.length - 1);
  for (let i = 0, length = packedActor.length; i < length; i++) writer.writeByte(packedActor[i]);
  writer.writeVarint(update.seq);
  writer.writeByte(char);
  return writer.finish();
}

function readMiniBinaryTextInsertUpdate(reader: CrdtBinaryReader): CrdtUpdate {
  const tag = reader.readByte();
  if (tag >= CRDT_BINARY_MINI_MAP_SET_INT_MIN && tag <= CRDT_BINARY_MINI_MAP_SET_INT_MAX) {
    return readMiniBinaryMapSetIntUpdate(reader, tag);
  }
  if (tag >= CRDT_BINARY_MINI_TEXT_PAIR_INSERT_MIN && tag <= CRDT_BINARY_MINI_TEXT_PAIR_INSERT_MAX) {
    return readMiniBinaryTextPairInsertUpdate(reader, tag);
  }
  if (tag >= CRDT_BINARY_MINI_TEXT_APPEND_INSERT_MIN && tag <= CRDT_BINARY_MINI_TEXT_APPEND_INSERT_MAX) {
    return readMiniBinaryTextAppendInsertUpdate(reader, tag);
  }
  if (tag === CRDT_BINARY_MINI_TEXT_REMOTE_INSERT) return readMiniBinaryTextRemoteInsertUpdate(reader);
  if (tag !== CRDT_BINARY_MINI_TEXT_INSERT) throw new TypeError('invalid mini CRDT text insert');
  const actorLength = reader.readByte();
  const actorBytes = Math.ceil((actorLength * 5) / 8);
  if (reader.offset + actorBytes > reader.bytes.length) throw new TypeError('unexpected end of mini CRDT actor');
  const actor = unpackMiniActor(reader.bytes.subarray(reader.offset, reader.offset + actorBytes), actorLength);
  reader.offset += actorBytes;
  const seq = reader.readVarint();
  const flags = reader.readByte();
  if ((flags & ~3) !== 0) throw new TypeError('invalid mini CRDT text flags');
  const char = reader.readByte();
  if (reader.offset !== reader.bytes.length) throw new TypeError('unexpected trailing mini CRDT update data');
  const deps = (flags & 1) === 0
    ? seq === 1 ? [] : (() => { throw new TypeError('invalid mini CRDT deps'); })()
    : seq > 1 ? [`${actor}:${seq - 1}`] : (() => { throw new TypeError('invalid mini CRDT deps'); })();
  const after = (flags & 2) === 0
    ? null
    : seq > 1 ? `${actor}:${seq - 1}/0` : (() => { throw new TypeError('invalid mini CRDT text anchor'); })();
  const id = `${actor}:${seq}`;
  return markDecodedUpdate({
    actor,
    seq,
    deps,
    ops: [{
      type: 'textInsert',
      id,
      actor,
      seq,
      deps,
      path: ['text'],
      after,
      text: String.fromCharCode(char)
    }]
  });
}

function readMiniBinaryTextAppendInsertUpdate(reader: CrdtBinaryReader, tag: number): CrdtUpdate {
  const actorLength = tag - CRDT_BINARY_MINI_TEXT_APPEND_INSERT_MIN + 1;
  const actorBytes = Math.ceil((actorLength * 5) / 8);
  if (reader.offset + actorBytes > reader.bytes.length) throw new TypeError('unexpected end of mini CRDT actor');
  const actor = unpackMiniActor(reader.bytes.subarray(reader.offset, reader.offset + actorBytes), actorLength);
  reader.offset += actorBytes;
  const seq = reader.readVarint();
  const char = reader.readByte();
  if (reader.offset !== reader.bytes.length) throw new TypeError('unexpected trailing mini CRDT append update data');
  const deps = seq === 1 ? [] : [`${actor}:${seq - 1}`];
  const after = seq === 1 ? null : `${actor}:${seq - 1}/0`;
  const id = `${actor}:${seq}`;
  return markDecodedUpdate({
    actor,
    seq,
    deps,
    ops: [{
      type: 'textInsert',
      id,
      actor,
      seq,
      deps,
      path: ['text'],
      after,
      text: String.fromCharCode(char)
    }]
  });
}

function encodeMiniBinaryMapSetIntUpdate(update: CrdtUpdate): Uint8Array | null {
  if (update.ops.length !== 1) return null;
  const op = update.ops[0];
  if (op.type !== 'set' || op.actor !== update.actor || op.seq !== update.seq) return null;
  if (op.deps !== update.deps && !sameStringArray(op.deps, update.deps)) return null;
  if (!Number.isSafeInteger(op.value as number) || typeof op.value !== 'number') return null;
  if (update.actor.length < 1 || update.actor.length > 32) return null;
  if (op.path.length !== 2 || op.path[0] !== 'kv' || typeof op.path[1] !== 'string') return null;
  const keyIndex = parseSingleBinaryNumericKey(op.path[1]);
  if (keyIndex < 0) return null;
  if (update.seq === 1) {
    if (update.deps.length !== 0) return null;
  } else if (update.deps.length !== 1 || update.deps[0] !== `${update.actor}:${update.seq - 1}`) {
    return null;
  }

  const packedActor = packMiniActor(update.actor);
  if (packedActor === null) return null;
  const writer = new CrdtBinaryWriter();
  writer.writeByte(CRDT_BINARY_MINI_MAP_SET_INT_MIN + update.actor.length - 1);
  for (let i = 0, length = packedActor.length; i < length; i++) writer.writeByte(packedActor[i]);
  writer.writeVarint(update.seq);
  writer.writeVarint(keyIndex);
  writer.writeSignedVarint(op.value);
  return writer.finish();
}

function readMiniBinaryMapSetIntUpdate(reader: CrdtBinaryReader, tag: number): CrdtUpdate {
  const actorLength = tag - CRDT_BINARY_MINI_MAP_SET_INT_MIN + 1;
  const actorBytes = Math.ceil((actorLength * 5) / 8);
  if (reader.offset + actorBytes > reader.bytes.length) throw new TypeError('unexpected end of mini CRDT actor');
  const actor = unpackMiniActor(reader.bytes.subarray(reader.offset, reader.offset + actorBytes), actorLength);
  reader.offset += actorBytes;
  const seq = reader.readVarint();
  const keyIndex = reader.readVarint();
  const value = reader.readSignedVarint();
  if (reader.offset !== reader.bytes.length) throw new TypeError('unexpected trailing mini CRDT map set update data');
  const deps = seq === 1 ? [] : [`${actor}:${seq - 1}`];
  const id = `${actor}:${seq}`;
  return markDecodedUpdate({
    actor,
    seq,
    deps,
    ops: [{
      type: 'set',
      id,
      actor,
      seq,
      deps,
      path: ['kv', 'k' + keyIndex],
      value
    }]
  });
}

function encodeMiniBinaryTextRemoteInsertUpdate(update: CrdtUpdate): Uint8Array | null {
  if (update.ops.length !== 1) return null;
  const op = update.ops[0];
  if (op.type !== 'textInsert' || op.actor !== update.actor || op.seq !== update.seq) return null;
  if (op.deps !== update.deps && !sameStringArray(op.deps, update.deps)) return null;
  if (op.path.length !== 1 || op.path[0] !== 'text') return null;
  if (op.text.length !== 1 || op.after === null || update.deps.length !== 1) return null;
  const char = op.text.charCodeAt(0);
  if (char > 0x7f) return null;
  if (!op.after.endsWith('/0')) return null;
  const after = tryParseOperationId(op.after.slice(0, -2));
  if (after === null || update.deps[0] !== `${after.actor}:${after.seq}` || after.actor === update.actor) return null;

  const packedActor = packMiniActor(update.actor);
  if (packedActor === null) return null;
  const commonPrefix = commonStringPrefixLength(update.actor, after.actor);
  const suffix = after.actor.slice(commonPrefix);
  if (commonPrefix > 63 || suffix.length === 0 || suffix.length > 15) return null;
  const packedSuffix = packMiniActor(suffix);
  if (packedSuffix === null) return null;

  const bytes = new Uint8Array(
    1 +
      1 +
      packedActor.byteLength +
      varintByteLength(update.seq) +
      1 +
      1 +
      packedSuffix.byteLength +
      varintByteLength(after.seq) +
      1
  );
  let offset = 0;
  bytes[offset++] = CRDT_BINARY_MINI_TEXT_REMOTE_INSERT;
  bytes[offset++] = update.actor.length;
  bytes.set(packedActor, offset);
  offset += packedActor.byteLength;
  offset = writeVarintBytes(bytes, offset, update.seq);
  bytes[offset++] = commonPrefix;
  bytes[offset++] = suffix.length;
  bytes.set(packedSuffix, offset);
  offset += packedSuffix.byteLength;
  offset = writeVarintBytes(bytes, offset, after.seq);
  bytes[offset] = char;
  return bytes;
}

function encodeMiniBinaryTextPairInsertUpdate(update: CrdtUpdate): Uint8Array | null {
  if (update.ops.length !== 1) return null;
  const op = update.ops[0];
  if (op.type !== 'textInsert' || op.actor !== update.actor || op.seq !== update.seq) return null;
  if (op.deps !== update.deps && !sameStringArray(op.deps, update.deps)) return null;
  if (op.path.length !== 1 || op.path[0] !== 'text') return null;
  if (op.text.length !== 1 || op.after === null || update.deps.length !== 1) return null;
  const char = op.text.charCodeAt(0);
  if (char > 0x7f) return null;
  if (update.actor.length < 1 || update.actor.length > 32 || !op.after.endsWith('/0')) return null;
  if (op.text !== update.actor[update.actor.length - 1]) return null;
  const after = tryParseOperationId(op.after.slice(0, -2));
  if (after === null || update.deps[0] !== `${after.actor}:${after.seq}` || after.actor === update.actor) return null;
  if (after.actor.length !== update.actor.length || after.actor.slice(0, -1) !== update.actor.slice(0, -1)) return null;
  const afterLast = miniActorCharCode(after.actor.charCodeAt(after.actor.length - 1));
  if (afterLast < 0) return null;
  let seqMode: number;
  if (after.seq === update.seq) {
    seqMode = 0;
  } else if (after.seq + 1 === update.seq) {
    seqMode = 1;
  } else {
    return null;
  }

  const packedActor = packMiniActor(update.actor);
  if (packedActor === null) return null;
  const bytes = new Uint8Array(1 + packedActor.byteLength + varintByteLength(update.seq) + 1);
  let offset = 0;
  bytes[offset++] = CRDT_BINARY_MINI_TEXT_PAIR_INSERT_MIN + update.actor.length - 1;
  bytes.set(packedActor, offset);
  offset += packedActor.byteLength;
  offset = writeVarintBytes(bytes, offset, update.seq);
  bytes[offset] = afterLast | (seqMode << 5);
  return bytes;
}

function readMiniBinaryTextRemoteInsertUpdate(reader: CrdtBinaryReader): CrdtUpdate {
  const actorLength = reader.readByte();
  const actorBytes = Math.ceil((actorLength * 5) / 8);
  if (reader.offset + actorBytes > reader.bytes.length) throw new TypeError('unexpected end of mini CRDT actor');
  const actor = unpackMiniActor(reader.bytes.subarray(reader.offset, reader.offset + actorBytes), actorLength);
  reader.offset += actorBytes;
  const seq = reader.readVarint();
  const commonPrefix = reader.readByte();
  const suffixLength = reader.readByte();
  const suffixBytes = Math.ceil((suffixLength * 5) / 8);
  if (commonPrefix > actor.length || suffixLength === 0 || reader.offset + suffixBytes > reader.bytes.length) {
    throw new TypeError('invalid mini CRDT remote actor');
  }
  const suffix = unpackMiniActor(reader.bytes.subarray(reader.offset, reader.offset + suffixBytes), suffixLength);
  reader.offset += suffixBytes;
  const afterActor = actor.slice(0, commonPrefix) + suffix;
  const afterSeq = reader.readVarint();
  const char = reader.readByte();
  if (reader.offset !== reader.bytes.length) throw new TypeError('unexpected trailing mini CRDT remote update data');
  const deps = [`${afterActor}:${afterSeq}`];
  const after = `${afterActor}:${afterSeq}/0`;
  const id = `${actor}:${seq}`;
  return markDecodedUpdate({
    actor,
    seq,
    deps,
    ops: [{
      type: 'textInsert',
      id,
      actor,
      seq,
      deps,
      path: ['text'],
      after,
      text: String.fromCharCode(char)
    }]
  });
}

function readMiniBinaryTextPairInsertUpdate(reader: CrdtBinaryReader, tag: number): CrdtUpdate {
  const actorLength = tag - CRDT_BINARY_MINI_TEXT_PAIR_INSERT_MIN + 1;
  const actorBytes = Math.ceil((actorLength * 5) / 8);
  if (reader.offset + actorBytes > reader.bytes.length) throw new TypeError('unexpected end of mini CRDT actor');
  const actor = unpackMiniActor(reader.bytes.subarray(reader.offset, reader.offset + actorBytes), actorLength);
  reader.offset += actorBytes;
  const seq = reader.readVarint();
  const packedAfter = reader.readByte();
  const seqMode = packedAfter >> 5;
  if (seqMode > 1) throw new TypeError('invalid mini CRDT pair sequence mode');
  const afterSeq = seqMode === 0 ? seq : seq - 1;
  if (afterSeq <= 0) throw new TypeError('invalid mini CRDT pair sequence');
  const afterActor = actor.slice(0, -1) + miniActorChar(packedAfter & 31);
  if (afterActor === actor) throw new TypeError('invalid mini CRDT pair actor');
  if (reader.offset !== reader.bytes.length) throw new TypeError('unexpected trailing mini CRDT pair update data');
  const deps = [`${afterActor}:${afterSeq}`];
  const after = `${afterActor}:${afterSeq}/0`;
  const text = actor[actor.length - 1];
  const id = `${actor}:${seq}`;
  return markDecodedUpdate({
    actor,
    seq,
    deps,
    ops: [{
      type: 'textInsert',
      id,
      actor,
      seq,
      deps,
      path: ['text'],
      after,
      text
    }]
  });
}

function commonStringPrefixLength(left: string, right: string): number {
  const length = left.length < right.length ? left.length : right.length;
  let i = 0;
  while (i < length && left.charCodeAt(i) === right.charCodeAt(i)) i++;
  return i;
}

function packMiniActor(actor: string): Uint8Array | null {
  const length = actor.length;
  if (length === 0 || length > 63) return null;
  if (length === 1) {
    const value = miniActorCharCode(actor.charCodeAt(0));
    if (value < 0) return null;
    const bytes = new Uint8Array(1);
    bytes[0] = value;
    return bytes;
  }
  if (length === 2) {
    const first = miniActorCharCode(actor.charCodeAt(0));
    const second = miniActorCharCode(actor.charCodeAt(1));
    if (first < 0 || second < 0) return null;
    const bytes = new Uint8Array(2);
    bytes[0] = first | ((second & 7) << 5);
    bytes[1] = second >> 3;
    return bytes;
  }
  const bytes = new Uint8Array(Math.ceil((length * 5) / 8));
  let bitOffset = 0;
  for (let i = 0; i < length; i++) {
    const value = miniActorCharCode(actor.charCodeAt(i));
    if (value < 0) return null;
    writePackedFiveBitValue(bytes, bitOffset, value);
    bitOffset += 5;
  }
  return bytes;
}

function unpackMiniActor(bytes: Uint8Array, length: number): string {
  if (length <= 0 || length > 63) throw new TypeError('invalid mini CRDT actor length');
  let actor = '';
  let bitOffset = 0;
  for (let i = 0; i < length; i++) {
    actor += miniActorChar(readPackedFiveBitValue(bytes, bitOffset));
    bitOffset += 5;
  }
  return actor;
}

function miniActorCharCode(code: number): number {
  if (code === 45) return 0;
  if (code >= 97 && code <= 122) return code - 96;
  if (code === 95) return 27;
  if (code >= 48 && code <= 51) return code - 20;
  return -1;
}

function miniActorChar(value: number): string {
  if (value === 0) return '-';
  if (value >= 1 && value <= 26) return String.fromCharCode(value + 96);
  if (value === 27) return '_';
  if (value >= 28 && value <= 31) return String.fromCharCode(value + 20);
  throw new TypeError('invalid mini CRDT actor character');
}

function writePackedFiveBitValue(bytes: Uint8Array, bitOffset: number, value: number): void {
  for (let bit = 0; bit < 5; bit++) {
    if ((value & (1 << bit)) === 0) continue;
    const absolute = bitOffset + bit;
    bytes[absolute >> 3] |= 1 << (absolute & 7);
  }
}

function readPackedFiveBitValue(bytes: Uint8Array, bitOffset: number): number {
  let value = 0;
  for (let bit = 0; bit < 5; bit++) {
    const absolute = bitOffset + bit;
    if ((bytes[absolute >> 3] & (1 << (absolute & 7))) !== 0) value |= 1 << bit;
  }
  return value;
}

function readTinyBinaryTextInsertUpdate(reader: CrdtBinaryReader): CrdtUpdate {
  reader.readByte();
  const actor = reader.readString();
  const seq = reader.readVarint();
  const depsMode = reader.readByte();
  const deps = readTinyChainDeps(actor, seq, depsMode);
  const path = readTinyTextPath(reader);
  const afterMode = reader.readByte();
  const after = readTinyTextAfter(actor, seq, afterMode);
  const text = reader.readString();
  if (reader.offset !== reader.bytes.length) throw new TypeError('unexpected trailing binary CRDT update data');
  const id = `${actor}:${seq}`;
  return markDecodedUpdate({
    actor,
    seq,
    deps,
    ops: [{
      type: 'textInsert',
      id,
      actor,
      seq,
      deps,
      path,
      after,
      text
    }]
  });
}

function tinyChainDepsMode(actor: string, seq: number, deps: string[]): number {
  if (deps.length === 0 && seq === 1) return 1;
  if (deps.length === 1 && operationIdMatchesActorSeq(deps[0], actor, seq - 1)) return 2;
  return 0;
}

function readTinyChainDeps(actor: string, seq: number, mode: number): string[] {
  if (mode === 1) return [];
  if (mode === 2 && seq > 1) return [`${actor}:${seq - 1}`];
  throw new TypeError('invalid tiny binary CRDT text deps');
}

function tinyTextAfterMode(actor: string, seq: number, after: string | null): number {
  if (after === null) return 1;
  if (seq > 1 && textElementIdMatchesActorSeqZero(after, actor, seq - 1)) return 2;
  return 0;
}

function readTinyTextAfter(actor: string, seq: number, mode: number): string | null {
  if (mode === 1) return null;
  if (mode === 2 && seq > 1) return `${actor}:${seq - 1}/0`;
  throw new TypeError('invalid tiny binary CRDT text after');
}

function writeTinyTextPath(writer: CrdtBinaryWriter, path: JsonPath): void {
  if (path.length === 1 && path[0] === 'text') {
    writer.writeByte(1);
  } else {
    writer.writeByte(0);
    writeBinaryPath(writer, path);
  }
}

function readTinyTextPath(reader: CrdtBinaryReader): JsonPath {
  const mode = reader.readByte();
  if (mode === 1) return ['text'];
  if (mode === 0) return readBinaryPath(reader);
  throw new TypeError('invalid tiny binary CRDT text path');
}

function sameStringArray(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0, length = left.length; i < length; i++) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

function encodeSingleBinaryCrdtUpdate(update: CrdtUpdate): Uint8Array | null {
  if (update.ops.length !== 1) return null;
  const op = update.ops[0];
  if (isSpanningOperation(op) || op.actor !== update.actor || op.seq !== update.seq) return null;
  if (op.deps !== update.deps && !sameStringArray(op.deps, update.deps)) return null;

  const tag = singleBinaryOperationTag(op);
  if (tag === -1) return null;

  const writer = new CrdtBinaryWriter();
  writer.writeByte(CRDT_BINARY_MAGIC_0);
  writer.writeByte(CRDT_BINARY_MAGIC_1);
  writer.writeByte(CRDT_BINARY_MAGIC_2);
  writer.writeByte(CRDT_BINARY_VERSION);
  writer.writeByte(CRDT_BINARY_SINGLE_OP);
  writer.writeString(update.actor);
  writer.writeVarint(update.seq);
  writeSingleBinaryDeps(writer, update.actor, update.seq, update.deps);
  writeSingleBinaryPath(writer, op.path);
  writer.writeByte(tag);

  if (op.type === 'set') {
    if (tag === 6) {
      writer.writeSignedVarint(op.value as number);
      return writer.finish();
    }
    writeSingleBinaryJsonValue(writer, op.value);
  } else if (op.type === 'del') {
    // No body.
  } else if (op.type === 'counter') {
    writer.writeSignedVarint(op.delta);
  } else if (op.type === 'treeCreate') {
    writer.writeString(op.nodeId);
    writeBinaryNullableString(writer, op.parent);
    writeBinaryNullableString(writer, op.after);
    writeSingleBinaryJsonValue(writer, op.value);
  } else if (op.type === 'treeMove') {
    writer.writeString(op.nodeId);
    writeBinaryNullableString(writer, op.parent);
    writeBinaryNullableString(writer, op.after);
  } else if (op.type === 'treeDel') {
    writer.writeString(op.nodeId);
  } else if (op.type === 'binarySet') {
    writeBinaryBytes(writer, base64ToBytes(op.bytes));
  } else if (op.type === 'treeSet') {
    writer.writeString(op.nodeId);
    writeSingleBinaryJsonValue(writer, op.value);
  } else if (op.type === 'listInsert') {
    writeSingleBinaryAfter(writer, update.actor, update.seq, update.deps, op.after);
    writer.writeVarint(op.values.length);
    for (let i = 0, length = op.values.length; i < length; i++) writeSingleBinaryJsonValue(writer, op.values[i]);
  } else if (op.type === 'listDel') {
    writeSingleBinaryElementIds(writer, op.elems);
  } else if (op.type === 'textInsert') {
    writeSingleBinaryAfter(writer, update.actor, update.seq, update.deps, op.after);
    writer.writeString(op.text);
  } else if (op.type === 'textDel') {
    writeSingleBinaryElementIds(writer, op.elems);
  } else {
    return null;
  }

  return writer.finish();
}

function readSingleBinaryCrdtUpdate(reader: CrdtBinaryReader): CrdtUpdate {
  reader.readByte();
  const actor = reader.readString();
  const seq = reader.readVarint();
  const deps = readSingleBinaryDeps(reader, actor, seq);
  const path = readSingleBinaryPath(reader);
  const tag = reader.readByte();
  const id = `${actor}:${seq}`;
  let op: CrdtOperation;

  if (tag === 0) {
    op = { type: 'set', id, actor, seq, deps, path, value: readSingleBinaryJsonValue(reader) };
  } else if (tag === 6) {
    op = { type: 'set', id, actor, seq, deps, path, value: reader.readSignedVarint() };
  } else if (tag === 1) {
    op = { type: 'del', id, actor, seq, deps, path };
  } else if (tag === 17) {
    op = { type: 'counter', id, actor, seq, deps, path, delta: reader.readSignedVarint() };
  } else if (tag === 18) {
    op = {
      type: 'treeCreate',
      id,
      actor,
      seq,
      deps,
      path,
      nodeId: reader.readString(),
      parent: readBinaryNullableString(reader),
      after: readBinaryNullableString(reader),
      value: readSingleBinaryJsonValue(reader)
    };
  } else if (tag === 19) {
    op = {
      type: 'treeMove',
      id,
      actor,
      seq,
      deps,
      path,
      nodeId: reader.readString(),
      parent: readBinaryNullableString(reader),
      after: readBinaryNullableString(reader)
    };
  } else if (tag === 20) {
    op = { type: 'treeDel', id, actor, seq, deps, path, nodeId: reader.readString() };
  } else if (tag === 21) {
    op = { type: 'binarySet', id, actor, seq, deps, path, bytes: bytesToBase64(readBinaryBytes(reader)) };
  } else if (tag === 22) {
    op = { type: 'treeSet', id, actor, seq, deps, path, nodeId: reader.readString(), value: readSingleBinaryJsonValue(reader) };
  } else if (tag === 2) {
    const after = readSingleBinaryAfter(reader, actor, seq, deps);
    const valueCount = reader.readVarint();
    const values = new Array<JsonValue>(valueCount);
    for (let i = 0; i < valueCount; i++) values[i] = readSingleBinaryJsonValue(reader);
    op = { type: 'listInsert', id, actor, seq, deps, path, after, values };
  } else if (tag === 3) {
    op = { type: 'listDel', id, actor, seq, deps, path, elems: readSingleBinaryElementIds(reader) };
  } else if (tag === 4) {
    op = { type: 'textInsert', id, actor, seq, deps, path, after: readSingleBinaryAfter(reader, actor, seq, deps), text: reader.readString() };
  } else if (tag === 5) {
    op = { type: 'textDel', id, actor, seq, deps, path, elems: readSingleBinaryElementIds(reader) };
  } else {
    throw new TypeError('invalid single-op binary CRDT tag');
  }

  if (reader.offset !== reader.bytes.length) throw new TypeError('unexpected trailing single-op binary CRDT update data');
  return markDecodedUpdate({ actor, seq, deps, ops: [op] });
}

function singleBinaryOperationTag(op: CrdtOperation): number {
  if (op.type === 'set') return typeof op.value === 'number' && Number.isSafeInteger(op.value) ? 6 : 0;
  if (op.type === 'del') return 1;
  if (op.type === 'counter') return 17;
  if (op.type === 'treeCreate') return 18;
  if (op.type === 'treeMove') return 19;
  if (op.type === 'treeDel') return 20;
  if (op.type === 'binarySet') return 21;
  if (op.type === 'treeSet') return 22;
  if (op.type === 'listInsert') return 2;
  if (op.type === 'listDel') return 3;
  if (op.type === 'textInsert') return 4;
  if (op.type === 'textDel') return 5;
  return -1;
}

function writeSingleBinaryDeps(writer: CrdtBinaryWriter, actor: string, seq: number, deps: string[]): void {
  if (deps.length === 0) {
    writer.writeByte(1);
    return;
  }
  if (seq > 1 && deps.length === 1 && operationIdMatchesActorSeq(deps[0], actor, seq - 1)) {
    writer.writeByte(2);
    return;
  }
  if (deps.length === 1) {
    writer.writeByte(3);
    writeSingleBinaryOperationId(writer, deps[0]);
    return;
  }
  writer.writeByte(0);
  writeBinaryOperationIds(writer, deps);
}

function readSingleBinaryDeps(reader: CrdtBinaryReader, actor: string, seq: number): string[] {
  const mode = reader.readByte();
  if (mode === 1) return [];
  if (mode === 2 && seq > 1) return [`${actor}:${seq - 1}`];
  if (mode === 3) return [readSingleBinaryOperationId(reader)];
  if (mode === 0) return readBinaryOperationIds(reader);
  throw new TypeError('invalid single-op binary CRDT deps');
}

function writeSingleBinaryAfter(
  writer: CrdtBinaryWriter,
  actor: string,
  seq: number,
  deps: string[],
  after: string | null
): void {
  if (after === null) {
    writer.writeByte(1);
    return;
  }
  if (seq > 1 && textElementIdMatchesActorSeqZero(after, actor, seq - 1)) {
    writer.writeByte(2);
    return;
  }
  if (deps.length === 1 && after === deps[0] + '/0') {
    writer.writeByte(3);
    return;
  }
  const parsed = parseTextElementId(after);
  if (parsed !== null) {
    writer.writeByte(4);
    writeSingleBinaryOperationRef(writer, parsed.actor, parsed.seq, parsed.index);
    return;
  }
  writer.writeByte(0);
  writer.writeString(after);
}

function readSingleBinaryAfter(reader: CrdtBinaryReader, actor: string, seq: number, deps: string[]): string | null {
  const mode = reader.readByte();
  if (mode === 1) return null;
  if (mode === 2 && seq > 1) return `${actor}:${seq - 1}/0`;
  if (mode === 3 && deps.length === 1) return deps[0] + '/0';
  if (mode === 4) return readSingleBinaryOperationRef(reader);
  if (mode === 0) return reader.readString();
  throw new TypeError('invalid single-op binary CRDT after');
}

function writeSingleBinaryElementIds(writer: CrdtBinaryWriter, ids: string[]): void {
  const ranges = createTextElementIdRanges(ids);
  if (ranges !== null) {
    writer.writeByte(2);
    writeBinaryTextElementIdRanges(writer, ranges);
    return;
  }
  if (ids.length === 1) {
    const parsed = parseTextElementId(ids[0]);
    if (parsed !== null) {
      writer.writeByte(1);
      writeSingleBinaryOperationRef(writer, parsed.actor, parsed.seq, parsed.index);
      return;
    }
  }
  writer.writeByte(0);
  writeBinaryStrings(writer, ids);
}

function readSingleBinaryElementIds(reader: CrdtBinaryReader): string[] {
  const mode = reader.readByte();
  if (mode === 1) return [readSingleBinaryOperationRef(reader)];
  if (mode === 2) return readBinaryTextElementIdRanges(reader);
  if (mode === 0) return readBinaryStrings(reader);
  throw new TypeError('invalid single-op binary CRDT element ids');
}

function writeSingleBinaryOperationId(writer: CrdtBinaryWriter, id: string): void {
  const parsed = parseOperationId(id);
  writer.writeString(parsed.actor);
  writer.writeVarint(parsed.seq);
}

function readSingleBinaryOperationId(reader: CrdtBinaryReader): string {
  return `${reader.readString()}:${reader.readVarint()}`;
}

function writeSingleBinaryOperationRef(writer: CrdtBinaryWriter, actor: string, seq: number, index: number): void {
  writer.writeString(actor);
  writer.writeVarint(seq);
  writer.writeVarint(index);
}

function readSingleBinaryOperationRef(reader: CrdtBinaryReader): string {
  return `${reader.readString()}:${reader.readVarint()}/${reader.readVarint()}`;
}

function createTextElementIdRanges(ids: string[]): TextElementIdRange[] | null {
  const ranges: TextElementIdRange[] = [];
  let offset = 0;
  while (offset < ids.length) {
    const first = parseTextElementId(ids[offset]);
    if (first === null) return null;

    let indexCount = 1;
    while (offset + indexCount < ids.length) {
      const next = parseTextElementId(ids[offset + indexCount]);
      if (
        next === null ||
        next.actor !== first.actor ||
        next.seq !== first.seq ||
        next.index !== first.index + indexCount
      ) {
        break;
      }
      indexCount++;
    }

    let seqCount = 1;
    if (first.index === 0) {
      while (offset + seqCount < ids.length) {
        const next = parseTextElementId(ids[offset + seqCount]);
        if (
          next === null ||
          next.actor !== first.actor ||
          next.index !== 0 ||
          next.seq !== first.seq + seqCount
        ) {
          break;
        }
        seqCount++;
      }
    }

    if (seqCount > indexCount) {
      ranges[ranges.length] = { kind: 'seq', actor: first.actor, startSeq: first.seq, count: seqCount };
      offset += seqCount;
    } else {
      ranges[ranges.length] = { kind: 'index', actor: first.actor, seq: first.seq, startIndex: first.index, count: indexCount };
      offset += indexCount;
    }
  }
  return ranges;
}

function writeBinaryTextElementIdRanges(writer: CrdtBinaryWriter, ranges: TextElementIdRange[]): void {
  writer.writeVarint(ranges.length);
  for (let i = 0, length = ranges.length; i < length; i++) {
    const range = ranges[i];
    if (range.kind === 'seq') {
      writer.writeByte(1);
      writer.writeString(range.actor);
      writer.writeVarint(range.startSeq);
      writer.writeVarint(range.count);
    } else {
      writer.writeByte(0);
      writer.writeString(range.actor);
      writer.writeVarint(range.seq);
      writer.writeVarint(range.startIndex);
      writer.writeVarint(range.count);
    }
  }
}

function readBinaryTextElementIdRanges(reader: CrdtBinaryReader): string[] {
  const rangeCount = reader.readVarint();
  const ranges = new Array<TextElementIdRange>(rangeCount);
  let valueCount = 0;
  for (let i = 0; i < rangeCount; i++) {
    const kind = reader.readByte();
    if (kind === 1) {
      const actor = reader.readString();
      const startSeq = reader.readVarint();
      const count = reader.readVarint();
      if (count <= 0) throw new TypeError('invalid binary CRDT text element seq range');
      ranges[i] = { kind: 'seq', actor, startSeq, count };
      valueCount += count;
    } else if (kind === 0) {
      const actor = reader.readString();
      const seq = reader.readVarint();
      const startIndex = reader.readVarint();
      const count = reader.readVarint();
      if (count <= 0) throw new TypeError('invalid binary CRDT text element index range');
      ranges[i] = { kind: 'index', actor, seq, startIndex, count };
      valueCount += count;
    } else {
      throw new TypeError('invalid binary CRDT text element range kind');
    }
  }

  const ids = new Array<string>(valueCount);
  let offset = 0;
  for (let i = 0; i < rangeCount; i++) {
    const range = ranges[i];
    if (range.kind === 'seq') {
      for (let j = 0; j < range.count; j++) ids[offset++] = `${range.actor}:${range.startSeq + j}/0`;
    } else {
      for (let j = 0; j < range.count; j++) ids[offset++] = `${range.actor}:${range.seq}/${range.startIndex + j}`;
    }
  }
  return ids;
}

function writeBinaryTextElementIdsWithFallback(writer: CrdtBinaryWriter, ids: string[]): void {
  const ranges = createTextElementIdRanges(ids);
  if (ranges !== null) {
    writer.writeByte(1);
    writeBinaryTextElementIdRanges(writer, ranges);
    return;
  }
  writer.writeByte(0);
  writeBinaryStrings(writer, ids);
}

function readBinaryTextElementIdsWithFallback(reader: CrdtBinaryReader): string[] {
  const mode = reader.readByte();
  if (mode === 1) return readBinaryTextElementIdRanges(reader);
  if (mode === 0) return readBinaryStrings(reader);
  throw new TypeError('invalid binary CRDT text element id mode');
}

function writeBinaryTextDeleteRangeStart(writer: CrdtBinaryWriter, id: string): void {
  const parsed = parseTextElementId(id);
  if (parsed !== null) {
    writer.writeByte(1);
    writeBinaryTextElementIdRef(writer, parsed);
    return;
  }
  writer.writeByte(0);
  writer.writeString(id);
}

function readBinaryTextDeleteRangeStart(reader: CrdtBinaryReader): string {
  const mode = reader.readByte();
  if (mode === 1) return readBinaryTextElementIdRef(reader);
  if (mode === 0) return reader.readString();
  throw new TypeError('invalid binary CRDT text delete range start mode');
}

function writeBinaryTextAnchor(writer: CrdtBinaryWriter, id: string | null): void {
  if (id === null) {
    writer.writeByte(0);
    return;
  }
  const parsed = parseTextElementId(id);
  if (parsed !== null) {
    writer.writeByte(1);
    writeBinaryTextElementIdRef(writer, parsed);
    return;
  }
  writer.writeByte(2);
  writer.writeString(id);
}

function readBinaryTextAnchor(reader: CrdtBinaryReader): string | null {
  const mode = reader.readByte();
  if (mode === 0) return null;
  if (mode === 1) return readBinaryTextElementIdRef(reader);
  if (mode === 2) return reader.readString();
  throw new TypeError('invalid binary CRDT text anchor mode');
}

function writeBinaryTextElementIdRef(writer: CrdtBinaryWriter, parsed: TextElementIdParts): void {
  writeSingleBinaryOperationRef(writer, parsed.actor, parsed.seq, parsed.index);
}

function readBinaryTextElementIdRef(reader: CrdtBinaryReader): string {
  return readSingleBinaryOperationRef(reader);
}

function writeSingleBinaryJsonValue(writer: CrdtBinaryWriter, value: JsonValue): void {
  const row = compactIdValueActiveRow(value);
  if (row !== null) {
    writer.writeByte(8);
    writer.writeString(row.prefix);
    writer.writeSignedVarint(row.value);
    writer.writeByte(row.active ? 1 : 0);
    return;
  }
  writeBinaryJsonValue(writer, value);
}

function readSingleBinaryJsonValue(reader: CrdtBinaryReader): JsonValue {
  if (reader.bytes[reader.offset] !== 8) return readBinaryJsonValue(reader);
  reader.readByte();
  const prefix = reader.readString();
  const value = reader.readSignedVarint();
  const activeByte = reader.readByte();
  if (activeByte > 1) throw new TypeError('invalid single-op binary CRDT compact row');
  return {
    id: prefix + String(value),
    value,
    active: activeByte === 1
  };
}

function compactIdValueActiveRow(value: JsonValue): { prefix: string; value: number; active: boolean } | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, JsonValue>;
  if (
    Object.keys(row).length !== 3 ||
    !Object.prototype.hasOwnProperty.call(row, 'id') ||
    !Object.prototype.hasOwnProperty.call(row, 'value') ||
    !Object.prototype.hasOwnProperty.call(row, 'active') ||
    typeof row.id !== 'string' ||
    typeof row.value !== 'number' ||
    !Number.isSafeInteger(row.value) ||
    typeof row.active !== 'boolean'
  ) {
    return null;
  }
  const parsed = splitNumericSuffix(row.id);
  if (parsed === null || parsed.number !== row.value) return null;
  return { prefix: parsed.prefix, value: row.value, active: row.active };
}

function writeSingleBinaryPath(writer: CrdtBinaryWriter, path: JsonPath): void {
  if (path.length === 1) {
    if (path[0] === 'text') {
      writer.writeByte(1);
      return;
    }
    if (path[0] === 'items') {
      writer.writeByte(2);
      return;
    }
  } else if (path.length === 2 && path[0] === 'kv' && typeof path[1] === 'string') {
    const keyIndex = parseSingleBinaryNumericKey(path[1]);
    if (keyIndex !== -1) {
      writer.writeByte(4);
      writer.writeVarint(keyIndex);
      return;
    }
    writer.writeByte(3);
    writer.writeString(path[1]);
    return;
  }
  writer.writeByte(0);
  writeBinaryPath(writer, path);
}

function readSingleBinaryPath(reader: CrdtBinaryReader): JsonPath {
  const mode = reader.readByte();
  if (mode === 1) return ['text'];
  if (mode === 2) return ['items'];
  if (mode === 3) return ['kv', reader.readString()];
  if (mode === 4) return ['kv', 'k' + reader.readVarint()];
  if (mode === 0) return readBinaryPath(reader);
  throw new TypeError('invalid single-op binary CRDT path');
}

function parseSingleBinaryNumericKey(value: string): number {
  if (value.length < 2 || value.charCodeAt(0) !== 0x6b) return -1;
  let number = 0;
  for (let i = 1, length = value.length; i < length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x30 || code > 0x39) return -1;
    number = number * 10 + code - 0x30;
  }
  return Number.isSafeInteger(number) ? number : -1;
}

function writeBinaryOperations(writer: CrdtBinaryWriter, ops: CrdtOperation[]): number {
  let count = 0;
  for (let i = 0, length = ops.length; i < length; i++) {
    const textChainEnd = textOperationChainRunEnd(ops, i);
    if (textChainEnd - i >= 4) {
      writeBinaryTextOperationChainRun(writer, ops, i, textChainEnd);
      count++;
      i = textChainEnd - 1;
      continue;
    }
    if (ops[i].type === 'textRun') {
      writeBinaryTextRunOperation(writer, ops[i] as Extract<CrdtOperation, { type: 'textRun' }>);
      count++;
      continue;
    }
    if (ops[i].type === 'listRun') {
      writeBinaryListRunOperation(writer, ops[i] as Extract<CrdtOperation, { type: 'listRun' }>);
      count++;
      continue;
    }
    if (ops[i].type === 'mapSetRun') {
      writeBinaryMapSetRunOperation(writer, ops[i] as Extract<CrdtOperation, { type: 'mapSetRun' }>);
      count++;
      continue;
    }
    const scheduledTextCandidate = createOptimizedScheduledTextEncodingCandidate(ops, i);
    if (scheduledTextCandidate !== null) {
      writeBinaryScheduledTextEncodingCandidate(writer, scheduledTextCandidate);
      count++;
      i = scheduledTextCandidate.originalEnd - 1;
      continue;
    }
    const textRunEnd = textInsertRunEnd(ops, i);
    if (textRunEnd - i >= 3) {
      writeBinaryTextRun(writer, ops, i, textRunEnd);
      count++;
      i = textRunEnd - 1;
      continue;
    }
    const listRunEnd = listInsertRunEnd(ops, i);
    if (listRunEnd - i >= 3) {
      writeBinaryListRun(writer, ops, i, listRunEnd);
      count++;
      i = listRunEnd - 1;
      continue;
    }
    const mapRunEnd = mapSetRunEnd(ops, i);
    if (mapRunEnd - i >= 3) {
      writeBinaryMapSetRun(writer, ops, i, mapRunEnd);
      count++;
      i = mapRunEnd - 1;
      continue;
    }
    const pathShapeRunEnd = pathShapeSetRunEnd(ops, i);
    if (pathShapeRunEnd - i >= CRDT_PATH_SHAPE_RUN_MIN) {
      writeBinaryPathShapeSetRun(writer, ops, i, pathShapeRunEnd);
      count++;
      i = pathShapeRunEnd - 1;
      continue;
    }
    writeBinaryOperation(writer, ops[i]);
    count++;
  }
  return count;
}

function writeBinaryOperation(writer: CrdtBinaryWriter, op: CrdtOperation): void {
  if (op.type === 'set') {
    writer.writeByte(0);
    writeBinaryOperationHeader(writer, op);
    writeBinaryJsonValue(writer, op.value);
  } else if (op.type === 'del') {
    writer.writeByte(1);
    writeBinaryOperationHeader(writer, op);
  } else if (op.type === 'counter') {
    writer.writeByte(17);
    writeBinaryOperationHeader(writer, op);
    writer.writeSignedVarint(op.delta);
  } else if (op.type === 'treeCreate') {
    writer.writeByte(18);
    writeBinaryOperationHeader(writer, op);
    writer.writeString(op.nodeId);
    writeBinaryNullableString(writer, op.parent);
    writeBinaryNullableString(writer, op.after);
    writeBinaryJsonValue(writer, op.value);
  } else if (op.type === 'treeMove') {
    writer.writeByte(19);
    writeBinaryOperationHeader(writer, op);
    writer.writeString(op.nodeId);
    writeBinaryNullableString(writer, op.parent);
    writeBinaryNullableString(writer, op.after);
  } else if (op.type === 'treeDel') {
    writer.writeByte(20);
    writeBinaryOperationHeader(writer, op);
    writer.writeString(op.nodeId);
  } else if (op.type === 'binarySet') {
    writer.writeByte(21);
    writeBinaryOperationHeader(writer, op);
    writeBinaryBytes(writer, base64ToBytes(op.bytes));
  } else if (op.type === 'treeSet') {
    writer.writeByte(22);
    writeBinaryOperationHeader(writer, op);
    writer.writeString(op.nodeId);
    writeBinaryJsonValue(writer, op.value);
  } else if (op.type === 'mapSetRun') {
    writeBinaryMapSetRunOperation(writer, op);
  } else if (op.type === 'listInsert') {
    writer.writeByte(2);
    writeBinaryOperationHeader(writer, op);
    writeBinaryNullableString(writer, op.after);
    writer.writeVarint(op.values.length);
    for (let i = 0, length = op.values.length; i < length; i++) writeBinaryJsonValue(writer, op.values[i]);
  } else if (op.type === 'listRun') {
    writeBinaryListRunOperation(writer, op);
  } else if (op.type === 'listDel') {
    writer.writeByte(3);
    writeBinaryOperationHeader(writer, op);
    writeBinaryStrings(writer, op.elems);
  } else if (op.type === 'textInsert') {
    writer.writeByte(4);
    writeBinaryOperationHeader(writer, op);
    writeBinaryNullableString(writer, op.after);
    writer.writeString(op.text);
  } else if (op.type === 'textDel') {
    const ranges = createTextElementIdRanges(op.elems);
    if (ranges !== null) {
      writer.writeByte(14);
      writeBinaryOperationHeader(writer, op);
      writeBinaryTextElementIdRanges(writer, ranges);
    } else {
      writer.writeByte(5);
      writeBinaryOperationHeader(writer, op);
      writeBinaryStrings(writer, op.elems);
    }
  } else if (op.type === 'textDelRange') {
    const parsedStart = parseTextElementId(op.start);
    if (parsedStart !== null) {
      writer.writeByte(15);
      writeBinaryOperationHeader(writer, op);
      writeBinaryTextElementIdRef(writer, parsedStart);
      writer.writeVarint(op.count);
      writer.writeByte(textDeleteSpanCode(op.span));
    } else {
      writer.writeByte(10);
      writeBinaryOperationHeader(writer, op);
      writer.writeString(op.start);
      writer.writeVarint(op.count);
      writer.writeByte(textDeleteSpanCode(op.span));
    }
  } else {
    writeBinaryTextRunOperation(writer, op);
  }
}

function writeBinaryOperationHeader(writer: CrdtBinaryWriter, op: CrdtOperation): void {
  writer.writeString(op.actor);
  writer.writeVarint(op.seq);
  writeBinaryOperationIds(writer, op.deps);
  writeBinaryPath(writer, op.path);
}

function writeBinaryTextRun(writer: CrdtBinaryWriter, ops: CrdtOperation[], start: number, end: number): void {
  const first = ops[start] as Extract<CrdtOperation, { type: 'textInsert' }>;
  writer.writeByte(6);
  writer.writeString(first.actor);
  writer.writeVarint(first.seq);
  writeBinaryOperationIds(writer, first.deps);
  writeBinaryPath(writer, first.path);
  writeBinaryNullableString(writer, first.after);
  const repeated = tryRepeatSingleCodePointTextRun(ops, start, end);
  if (repeated !== null) {
    writer.writeByte(2);
    writer.writeVarint(end - start);
    writer.writeString(repeated);
    return;
  }
  const joined = tryJoinSingleCodePointTextRun(ops, start, end);
  if (joined !== null) {
    writer.writeByte(0);
    writer.writeVarint(end - start);
    writer.writeString(joined);
  } else {
    writer.writeByte(1);
    writer.writeVarint(end - start);
    for (let i = start; i < end; i++) {
      writer.writeString((ops[i] as Extract<CrdtOperation, { type: 'textInsert' }>).text);
    }
  }
}

function writeBinaryTextRunOperation(writer: CrdtBinaryWriter, op: Extract<CrdtOperation, { type: 'textRun' }>): void {
  writer.writeByte(6);
  writer.writeString(op.actor);
  writer.writeVarint(op.seq);
  writeBinaryOperationIds(writer, op.deps);
  writeBinaryPath(writer, op.path);
  writeBinaryNullableString(writer, op.after);
  const repeated = tryRepeatSingleCodePointString(op.text, op.count);
  if (repeated !== null) {
    writer.writeByte(2);
    writer.writeVarint(op.count);
    writer.writeString(repeated);
    return;
  }
  writer.writeByte(0);
  writer.writeVarint(op.count);
  writer.writeString(op.text);
}

function writeBinaryListRun(writer: CrdtBinaryWriter, ops: CrdtOperation[], start: number, end: number): void {
  const first = ops[start] as Extract<CrdtOperation, { type: 'listInsert' }>;
  writer.writeByte(7);
  writer.writeString(first.actor);
  writer.writeVarint(first.seq);
  writeBinaryOperationIds(writer, first.deps);
  writeBinaryPath(writer, first.path);
  writeBinaryNullableString(writer, first.after);
  let allSingle = true;
  for (let i = start; i < end; i++) {
    if ((ops[i] as Extract<CrdtOperation, { type: 'listInsert' }>).values.length !== 1) {
      allSingle = false;
      break;
    }
  }
  const uniformKeys = allSingle ? getUniformListRunObjectKeys(ops, start, end) : null;
  if (uniformKeys !== null) {
    writer.writeByte(2);
    writer.writeVarint(end - start);
    writer.writeVarint(uniformKeys.length);
    for (let i = 0, length = uniformKeys.length; i < length; i++) writer.writeString(uniformKeys[i]);
    for (let keyIndex = 0, keyCount = uniformKeys.length; keyIndex < keyCount; keyIndex++) {
      const values = new Array<JsonValue>(end - start);
      const key = uniformKeys[keyIndex];
      for (let i = start; i < end; i++) {
        values[i - start] = ((ops[i] as Extract<CrdtOperation, { type: 'listInsert' }>).values[0] as Record<string, JsonValue>)[key];
      }
      writeBinaryJsonValueColumn(writer, values);
    }
    return;
  }
  writer.writeByte(allSingle ? 0 : 1);
  writer.writeVarint(end - start);
  for (let i = start; i < end; i++) {
    const values = (ops[i] as Extract<CrdtOperation, { type: 'listInsert' }>).values;
    if (!allSingle) writer.writeVarint(values.length);
    for (let j = 0, valueCount = values.length; j < valueCount; j++) writeBinaryJsonValue(writer, values[j]);
  }
}

function writeBinaryListRunOperation(writer: CrdtBinaryWriter, op: Extract<CrdtOperation, { type: 'listRun' }>): void {
  writer.writeByte(7);
  writer.writeString(op.actor);
  writer.writeVarint(op.seq);
  writeBinaryOperationIds(writer, op.deps);
  writeBinaryPath(writer, op.path);
  writeBinaryNullableString(writer, op.after);
  const uniformKeys = getUniformObjectValueKeys(op.values);
  if (uniformKeys !== null) {
    writer.writeByte(2);
    writer.writeVarint(op.count);
    writer.writeVarint(uniformKeys.length);
    for (let i = 0, length = uniformKeys.length; i < length; i++) writer.writeString(uniformKeys[i]);
    for (let keyIndex = 0, keyCount = uniformKeys.length; keyIndex < keyCount; keyIndex++) {
      const values = new Array<JsonValue>(op.count);
      const key = uniformKeys[keyIndex];
      for (let i = 0; i < op.count; i++) values[i] = (op.values[i] as Record<string, JsonValue>)[key];
      writeBinaryJsonValueColumn(writer, values);
    }
    return;
  }
  writer.writeByte(0);
  writer.writeVarint(op.count);
  for (let i = 0; i < op.count; i++) writeBinaryJsonValue(writer, op.values[i]);
}

function writeBinaryMapSetRun(writer: CrdtBinaryWriter, ops: CrdtOperation[], start: number, end: number): void {
  const first = ops[start] as Extract<CrdtOperation, { type: 'set' }>;
  writer.writeByte(9);
  writer.writeString(first.actor);
  writer.writeVarint(first.seq);
  writeBinaryOperationIds(writer, first.deps);
  writeBinaryPath(writer, first.path.slice(0, -1));
  const count = end - start;
  writer.writeVarint(count);
  const keys = new Array<string>(count);
  const values = new Array<JsonValue>(count);
  for (let i = start; i < end; i++) {
    const op = ops[i] as Extract<CrdtOperation, { type: 'set' }>;
    keys[i - start] = op.path[op.path.length - 1] as string;
    values[i - start] = op.value;
  }
  writeBinaryStringColumn(writer, keys);
  writeBinaryJsonValueColumn(writer, values);
}

function writeBinaryMapSetRunOperation(writer: CrdtBinaryWriter, op: Extract<CrdtOperation, { type: 'mapSetRun' }>): void {
  writer.writeByte(9);
  writer.writeString(op.actor);
  writer.writeVarint(op.seq);
  writeBinaryOperationIds(writer, op.deps);
  writeBinaryPath(writer, op.path);
  writer.writeVarint(op.count);
  writeBinaryStringColumn(writer, op.keys);
  writeBinaryJsonValueColumn(writer, op.values);
}

function writeBinaryPathShapeSetRun(writer: CrdtBinaryWriter, ops: CrdtOperation[], start: number, end: number): void {
  const first = ops[start] as Extract<CrdtOperation, { type: 'set' }>;
  const count = end - start;
  writer.writeByte(11);
  writer.writeString(first.actor);
  writer.writeVarint(first.seq);
  writeBinaryOperationIds(writer, first.deps);
  writer.writeVarint(count);
  writer.writeVarint(first.path.length);
  for (let segmentIndex = 0, pathLength = first.path.length; segmentIndex < pathLength; segmentIndex++) {
    const firstSegment = first.path[segmentIndex];
    let constant = true;
    for (let i = start + 1; i < end; i++) {
      const segment = (ops[i] as Extract<CrdtOperation, { type: 'set' }>).path[segmentIndex];
      if (segment !== firstSegment) {
        constant = false;
        break;
      }
    }
    if (typeof firstSegment === 'number') {
      if (constant) {
        writer.writeByte(CRDT_PATH_SHAPE_CONST_NUMBER);
        writer.writeSignedVarint(firstSegment);
      } else {
        const values = new Array<number>(count);
        for (let i = start; i < end; i++) values[i - start] = (ops[i] as Extract<CrdtOperation, { type: 'set' }>).path[segmentIndex] as number;
        writer.writeByte(CRDT_PATH_SHAPE_VAR_NUMBER);
        writeBinarySignedIntegerColumn(writer, values);
      }
    } else if (constant) {
      writer.writeByte(CRDT_PATH_SHAPE_CONST_STRING);
      writer.writeString(firstSegment);
    } else {
      const values = new Array<string>(count);
      for (let i = start; i < end; i++) values[i - start] = (ops[i] as Extract<CrdtOperation, { type: 'set' }>).path[segmentIndex] as string;
      writer.writeByte(CRDT_PATH_SHAPE_VAR_STRING);
      writeBinaryStringColumn(writer, values);
    }
  }
  const values = new Array<JsonValue>(count);
  for (let i = start; i < end; i++) values[i - start] = (ops[i] as Extract<CrdtOperation, { type: 'set' }>).value;
  writeBinaryJsonValueColumn(writer, values);
}

function writeBinaryTextOperationChainRun(writer: CrdtBinaryWriter, ops: CrdtOperation[], start: number, end: number): void {
  const first = ops[start];
  writer.writeByte(16);
  writer.writeString(first.actor);
  writer.writeVarint(first.seq);
  writeBinaryOperationIds(writer, first.deps);
  writeBinaryPath(writer, first.path);
  writer.writeVarint(end - start);
  for (let i = start; i < end; i++) {
    const op = ops[i];
    if (op.type === 'textInsert') {
      writer.writeByte(0);
      writeBinaryTextAnchor(writer, op.after);
      writer.writeString(op.text);
    } else if (op.type === 'textRun') {
      writer.writeByte(3);
      writeBinaryTextAnchor(writer, op.after);
      writer.writeVarint(op.count);
      writer.writeString(op.text);
    } else if (op.type === 'textDel') {
      writer.writeByte(1);
      writeBinaryTextElementIdsWithFallback(writer, op.elems);
    } else {
      const rangeOp = op as Extract<CrdtOperation, { type: 'textDelRange' }>;
      writer.writeByte(2);
      writeBinaryTextDeleteRangeStart(writer, rangeOp.start);
      writer.writeVarint(rangeOp.count);
      writer.writeByte(textDeleteSpanCode(rangeOp.span));
    }
  }
}

function readBinaryTextOperationChainRun(reader: CrdtBinaryReader, ops: CrdtOperation[]): void {
  const actor = reader.readString();
  let seq = reader.readVarint();
  let deps = readBinaryOperationIds(reader);
  const path = readBinaryPath(reader);
  const count = reader.readVarint();
  for (let i = 0; i < count; i++) {
    const tag = reader.readByte();
    const id = `${actor}:${seq}`;
    let op: CrdtOperation;
    if (tag === 0) {
      op = { type: 'textInsert', id, actor, seq, deps, path, after: readBinaryTextAnchor(reader), text: reader.readString() };
    } else if (tag === 3) {
      const after = readBinaryTextAnchor(reader);
      const runCount = reader.readVarint();
      if (runCount <= 0) throw new TypeError('invalid binary CRDT text operation chain run count');
      op = { type: 'textRun', id, actor, seq, deps, path, after, text: reader.readString(), count: runCount };
    } else if (tag === 1) {
      op = { type: 'textDel', id, actor, seq, deps, path, elems: readBinaryTextElementIdsWithFallback(reader) };
    } else if (tag === 2) {
      const start = readBinaryTextDeleteRangeStart(reader);
      const deleteCount = reader.readVarint();
      if (deleteCount <= 0) throw new TypeError('invalid binary CRDT text operation chain delete count');
      op = { type: 'textDelRange', id, actor, seq, deps, path, start, count: deleteCount, span: textDeleteSpanFromCode(reader.readByte()) };
    } else {
      throw new TypeError('invalid binary CRDT text operation chain tag');
    }
    ops[ops.length] = op;
    seq = operationEndSeq(op) + 1;
    deps = [operationHeadId(op)];
  }
}

function writeBinaryScheduledTextInsertRun(
  writer: CrdtBinaryWriter,
  ops: CrdtOperation[],
  start: number,
  end: number,
  schedule: CrdtActorSchedule
): void {
  const first = ops[start] as Extract<CrdtOperation, { type: 'textInsert' }>;
  writer.writeByte(12);
  writeBinaryActorSchedule(writer, schedule);
  writeBinaryPath(writer, first.path);
  writeBinaryScheduledTextValues(writer, ops, start, end);
  writeBinaryScheduledTextDeps(writer, ops, start, end);
  writeBinaryScheduledTextAfter(writer, ops, start, end);
}

function writeBinaryScheduledTextInsertGrammarRun(
  writer: CrdtBinaryWriter,
  ops: CrdtOperation[],
  start: number,
  end: number,
  schedule: CrdtActorGrammarSchedule
): void {
  const first = ops[start] as Extract<CrdtOperation, { type: 'textInsert' }>;
  writer.writeByte(13);
  writeBinaryActorGrammarSchedule(writer, schedule);
  writeBinaryPath(writer, first.path);
  writeBinaryScheduledTextValues(writer, ops, start, end);
  writeBinaryScheduledTextDeps(writer, ops, start, end);
  writeBinaryScheduledTextAfter(writer, ops, start, end);
}

function writeBinaryScheduledTextEncodingCandidate(
  writer: CrdtBinaryWriter,
  candidate: CrdtScheduledTextEncodingCandidate
): void {
  if (candidate.kind === 'cycle') {
    writeBinaryScheduledTextInsertRun(writer, candidate.ops, 0, candidate.ops.length, candidate.schedule);
  } else {
    writeBinaryScheduledTextInsertGrammarRun(writer, candidate.ops, 0, candidate.ops.length, candidate.schedule);
  }
}

function writeBinaryActorSchedule(writer: CrdtBinaryWriter, schedule: CrdtActorSchedule): void {
  writer.writeVarint(schedule.count);
  writer.writeVarint(schedule.actors.length);
  for (let i = 0, length = schedule.actors.length; i < length; i++) {
    writer.writeString(schedule.actors[i]);
    writer.writeVarint(schedule.startSeqs[i]);
  }
  writer.writeVarint(schedule.pattern.length);
  for (let i = 0, length = schedule.pattern.length; i < length; i++) writer.writeVarint(schedule.pattern[i]);
}

function writeBinaryActorGrammarSchedule(writer: CrdtBinaryWriter, schedule: CrdtActorGrammarSchedule): void {
  writer.writeVarint(schedule.count);
  writer.writeVarint(schedule.actors.length);
  for (let i = 0, length = schedule.actors.length; i < length; i++) {
    writer.writeString(schedule.actors[i]);
    writer.writeVarint(schedule.startSeqs[i]);
  }
  writer.writeVarint(schedule.rules.length);
  for (let i = 0, length = schedule.rules.length; i < length; i++) {
    writer.writeVarint(schedule.rules[i][0]);
    writer.writeVarint(schedule.rules[i][1]);
  }
  writer.writeVarint(schedule.symbols.length);
  for (let i = 0, length = schedule.symbols.length; i < length; i++) writer.writeVarint(schedule.symbols[i]);
}

function writeBinaryScheduledTextValues(writer: CrdtBinaryWriter, ops: CrdtOperation[], start: number, end: number): void {
  const repeated = tryRepeatSingleCodePointTextRun(ops, start, end);
  if (repeated !== null) {
    writer.writeByte(CRDT_TEXT_SCHEDULE_TEXT_REPEATED);
    writer.writeString(repeated);
    return;
  }
  const joined = tryJoinSingleCodePointTextRun(ops, start, end);
  if (joined !== null) {
    writer.writeByte(CRDT_TEXT_SCHEDULE_TEXT_JOINED);
    writer.writeString(joined);
    return;
  }
  writer.writeByte(CRDT_TEXT_SCHEDULE_TEXT_RAW);
  for (let i = start; i < end; i++) writer.writeString((ops[i] as Extract<CrdtOperation, { type: 'textInsert' }>).text);
}

function writeBinaryScheduledTextDeps(writer: CrdtBinaryWriter, ops: CrdtOperation[], start: number, end: number): void {
  if (scheduledTextDepsAreChain(ops, start, end)) {
    writer.writeByte(CRDT_TEXT_SCHEDULE_DEPS_CHAIN);
    writeBinaryOperationIds(writer, ops[start].deps);
    return;
  }
  if (scheduledTextDepsAreSame(ops, start, end)) {
    writer.writeByte(CRDT_TEXT_SCHEDULE_DEPS_SAME);
    writeBinaryOperationIds(writer, ops[start].deps);
    return;
  }
  writer.writeByte(CRDT_TEXT_SCHEDULE_DEPS_RAW);
  for (let i = start; i < end; i++) writeBinaryOperationIds(writer, ops[i].deps);
}

function writeBinaryScheduledTextAfter(writer: CrdtBinaryWriter, ops: CrdtOperation[], start: number, end: number): void {
  if (scheduledTextAfterIsChain(ops, start, end)) {
    writer.writeByte(CRDT_TEXT_SCHEDULE_AFTER_CHAIN);
    writeBinaryNullableString(writer, (ops[start] as Extract<CrdtOperation, { type: 'textInsert' }>).after);
    return;
  }
  if (scheduledTextAfterIsNull(ops, start, end)) {
    writer.writeByte(CRDT_TEXT_SCHEDULE_AFTER_NULL);
    return;
  }
  writer.writeByte(CRDT_TEXT_SCHEDULE_AFTER_RAW);
  for (let i = start; i < end; i++) writeBinaryNullableString(writer, (ops[i] as Extract<CrdtOperation, { type: 'textInsert' }>).after);
}

function readBinaryOperation(reader: CrdtBinaryReader, ops: CrdtOperation[]): void {
  const tag = reader.readByte();
  if (tag <= 5) {
    const header = readBinaryOperationHeader(reader);
    const id = `${header.actor}:${header.seq}`;
    if (tag === 0) {
      ops[ops.length] = { type: 'set', id, ...header, value: readBinaryJsonValue(reader) };
    } else if (tag === 1) {
      ops[ops.length] = { type: 'del', id, ...header };
    } else if (tag === 2) {
      const after = readBinaryNullableString(reader);
      const valueCount = reader.readVarint();
      const values = new Array<JsonValue>(valueCount);
      for (let i = 0; i < valueCount; i++) values[i] = readBinaryJsonValue(reader);
      ops[ops.length] = { type: 'listInsert', id, ...header, after, values };
    } else if (tag === 3) {
      ops[ops.length] = { type: 'listDel', id, ...header, elems: readBinaryStrings(reader) };
    } else if (tag === 4) {
      ops[ops.length] = { type: 'textInsert', id, ...header, after: readBinaryNullableString(reader), text: reader.readString() };
    } else {
      ops[ops.length] = { type: 'textDel', id, ...header, elems: readBinaryStrings(reader) };
    }
    return;
  }

  if (tag === 6) {
    readBinaryTextRun(reader, ops);
  } else if (tag === 7) {
    readBinaryListRun(reader, ops);
  } else if (tag === 8) {
    readBinaryMapSetRun(reader, ops);
  } else if (tag === 9) {
    readBinaryCompressedMapSetRun(reader, ops);
  } else if (tag === 10) {
    const header = readBinaryOperationHeader(reader);
    const id = `${header.actor}:${header.seq}`;
    const start = reader.readString();
    const count = reader.readVarint();
    if (count <= 0) throw new TypeError('invalid binary CRDT text delete range count');
    const span = textDeleteSpanFromCode(reader.readByte());
    ops[ops.length] = { type: 'textDelRange', id, ...header, start, count, span };
  } else if (tag === 11) {
    readBinaryPathShapeSetRun(reader, ops);
  } else if (tag === 12) {
    readBinaryScheduledTextInsertRun(reader, ops);
  } else if (tag === 13) {
    readBinaryScheduledTextInsertGrammarRun(reader, ops);
  } else if (tag === 14) {
    const header = readBinaryOperationHeader(reader);
    const id = `${header.actor}:${header.seq}`;
    ops[ops.length] = { type: 'textDel', id, ...header, elems: readBinaryTextElementIdRanges(reader) };
  } else if (tag === 15) {
    const header = readBinaryOperationHeader(reader);
    const id = `${header.actor}:${header.seq}`;
    const start = readBinaryTextElementIdRef(reader);
    const count = reader.readVarint();
    if (count <= 0) throw new TypeError('invalid binary CRDT text delete range count');
    const span = textDeleteSpanFromCode(reader.readByte());
    ops[ops.length] = { type: 'textDelRange', id, ...header, start, count, span };
  } else if (tag === 16) {
    readBinaryTextOperationChainRun(reader, ops);
  } else if (tag === 17) {
    const header = readBinaryOperationHeader(reader);
    const id = `${header.actor}:${header.seq}`;
    ops[ops.length] = { type: 'counter', id, ...header, delta: reader.readSignedVarint() };
  } else if (tag === 18) {
    const header = readBinaryOperationHeader(reader);
    const id = `${header.actor}:${header.seq}`;
    ops[ops.length] = {
      type: 'treeCreate',
      id,
      ...header,
      nodeId: reader.readString(),
      parent: readBinaryNullableString(reader),
      after: readBinaryNullableString(reader),
      value: readBinaryJsonValue(reader)
    };
  } else if (tag === 19) {
    const header = readBinaryOperationHeader(reader);
    const id = `${header.actor}:${header.seq}`;
    ops[ops.length] = {
      type: 'treeMove',
      id,
      ...header,
      nodeId: reader.readString(),
      parent: readBinaryNullableString(reader),
      after: readBinaryNullableString(reader)
    };
  } else if (tag === 20) {
    const header = readBinaryOperationHeader(reader);
    const id = `${header.actor}:${header.seq}`;
    ops[ops.length] = { type: 'treeDel', id, ...header, nodeId: reader.readString() };
  } else if (tag === 21) {
    const header = readBinaryOperationHeader(reader);
    const id = `${header.actor}:${header.seq}`;
    ops[ops.length] = { type: 'binarySet', id, ...header, bytes: bytesToBase64(readBinaryBytes(reader)) };
  } else if (tag === 22) {
    const header = readBinaryOperationHeader(reader);
    const id = `${header.actor}:${header.seq}`;
    ops[ops.length] = { type: 'treeSet', id, ...header, nodeId: reader.readString(), value: readBinaryJsonValue(reader) };
  } else {
    throw new TypeError('unknown binary CRDT operation tag');
  }
}

function readBinaryOperationHeader(reader: CrdtBinaryReader): {
  actor: string;
  seq: number;
  deps: string[];
  path: JsonPath;
} {
  return {
    actor: reader.readString(),
    seq: reader.readVarint(),
    deps: readBinaryOperationIds(reader),
    path: readBinaryPath(reader)
  };
}

function readBinaryTextRun(reader: CrdtBinaryReader, ops: CrdtOperation[]): void {
  const actor = reader.readString();
  const startSeq = reader.readVarint();
  const firstDeps = readBinaryOperationIds(reader);
  const path = readBinaryPath(reader);
  const firstAfter = readBinaryNullableString(reader);
  const mode = reader.readByte();
  const opCount = reader.readVarint();
  if (opCount === 0) return;
  if (mode === 0) {
    const text = reader.readString();
    const chars = stringCodePoints(text);
    if (chars.length !== opCount) throw new TypeError('invalid binary CRDT text run length');
    ops[ops.length] = { type: 'textRun', id: `${actor}:${startSeq}`, actor, seq: startSeq, deps: firstDeps, path, after: firstAfter, text, count: opCount };
  } else if (mode === 1) {
    const texts = new Array<string>(opCount);
    let allSingleCodePoint = true;
    for (let i = 0; i < opCount; i++) {
      const text = reader.readString();
      texts[i] = text;
      if (codePointLength(text) !== 1) allSingleCodePoint = false;
    }
    if (allSingleCodePoint) {
      ops[ops.length] = { type: 'textRun', id: `${actor}:${startSeq}`, actor, seq: startSeq, deps: firstDeps, path, after: firstAfter, text: texts.join(''), count: opCount };
    } else {
      appendExpandedTextInsertRun(ops, actor, startSeq, firstDeps, path, firstAfter, texts);
    }
  } else if (mode === 2) {
    const text = reader.readString();
    if (codePointLength(text) !== 1) throw new TypeError('invalid binary CRDT repeated text run item');
    ops[ops.length] = { type: 'textRun', id: `${actor}:${startSeq}`, actor, seq: startSeq, deps: firstDeps, path, after: firstAfter, text: text.repeat(opCount), count: opCount };
  } else {
    throw new TypeError('invalid binary CRDT text run mode');
  }
}

function readBinaryListRun(reader: CrdtBinaryReader, ops: CrdtOperation[]): void {
  const actor = reader.readString();
  const startSeq = reader.readVarint();
  const firstDeps = readBinaryOperationIds(reader);
  const path = readBinaryPath(reader);
  const firstAfter = readBinaryNullableString(reader);
  const mode = reader.readByte();
  const opCount = reader.readVarint();
  if (mode === 2) {
    const fieldCount = reader.readVarint();
    const keys = new Array<string>(fieldCount);
    for (let i = 0; i < fieldCount; i++) keys[i] = reader.readString();
    const columns = new Array<JsonValue[]>(fieldCount);
    for (let i = 0; i < fieldCount; i++) columns[i] = readBinaryJsonValueColumn(reader, opCount);
    const values = new Array<JsonValue>(opCount);
    for (let i = 0; i < opCount; i++) {
      const value: Record<string, JsonValue> = {};
      for (let keyIndex = 0; keyIndex < fieldCount; keyIndex++) value[keys[keyIndex]] = columns[keyIndex][i];
      values[i] = value;
    }
    if (opCount !== 0) ops[ops.length] = { type: 'listRun', id: `${actor}:${startSeq}`, actor, seq: startSeq, deps: firstDeps, path, after: firstAfter, values, count: opCount };
    return;
  }
  if (mode === 0) {
    const values = new Array<JsonValue>(opCount);
    for (let i = 0; i < opCount; i++) values[i] = readBinaryJsonValue(reader);
    if (opCount !== 0) ops[ops.length] = { type: 'listRun', id: `${actor}:${startSeq}`, actor, seq: startSeq, deps: firstDeps, path, after: firstAfter, values, count: opCount };
    return;
  }
  let after = firstAfter;
  for (let i = 0; i < opCount; i++) {
    const valueCount = reader.readVarint();
    if (valueCount <= 0) throw new TypeError('invalid binary CRDT list run count');
    const values = new Array<JsonValue>(valueCount);
    for (let j = 0; j < valueCount; j++) values[j] = readBinaryJsonValue(reader);
    const seq = startSeq + i;
    const id = `${actor}:${seq}`;
    const deps = i === 0 ? firstDeps : [`${actor}:${seq - 1}`];
    ops[ops.length] = { type: 'listInsert', id, actor, seq, deps, path, after, values };
    after = `${id}/${valueCount - 1}`;
  }
  if (mode !== 1) throw new TypeError('invalid binary CRDT list run mode');
}

function readBinaryMapSetRun(reader: CrdtBinaryReader, ops: CrdtOperation[]): void {
  const actor = reader.readString();
  const startSeq = reader.readVarint();
  const firstDeps = readBinaryOperationIds(reader);
  const parentPath = readBinaryPath(reader);
  const count = reader.readVarint();
  for (let i = 0; i < count; i++) {
    const seq = startSeq + i;
    const id = `${actor}:${seq}`;
    const deps = i === 0 ? firstDeps : [`${actor}:${seq - 1}`];
    const key = reader.readString();
    ops[ops.length] = {
      type: 'set',
      id,
      actor,
      seq,
      deps,
      path: parentPath.concat(key),
      value: readBinaryJsonValue(reader)
    };
  }
}

function readBinaryCompressedMapSetRun(reader: CrdtBinaryReader, ops: CrdtOperation[]): void {
  const actor = reader.readString();
  const startSeq = reader.readVarint();
  const firstDeps = readBinaryOperationIds(reader);
  const parentPath = readBinaryPath(reader);
  const count = reader.readVarint();
  const keys = readBinaryStringColumn(reader, count);
  const values = readBinaryJsonValueColumn(reader, count);
  if (count !== 0) ops[ops.length] = { type: 'mapSetRun', id: `${actor}:${startSeq}`, actor, seq: startSeq, deps: firstDeps, path: parentPath, keys, values, count };
}

function readBinaryPathShapeSetRun(reader: CrdtBinaryReader, ops: CrdtOperation[]): void {
  const actor = reader.readString();
  const startSeq = reader.readVarint();
  const firstDeps = readBinaryOperationIds(reader);
  const count = reader.readVarint();
  const pathLength = reader.readVarint();
  const constants = new Array<string | number | undefined>(pathLength);
  const columns = new Array<Array<string | number> | undefined>(pathLength);
  for (let segmentIndex = 0; segmentIndex < pathLength; segmentIndex++) {
    const mode = reader.readByte();
    if (mode === CRDT_PATH_SHAPE_CONST_NUMBER) {
      constants[segmentIndex] = reader.readSignedVarint();
    } else if (mode === CRDT_PATH_SHAPE_CONST_STRING) {
      constants[segmentIndex] = reader.readString();
    } else if (mode === CRDT_PATH_SHAPE_VAR_NUMBER) {
      columns[segmentIndex] = readBinarySignedIntegerColumn(reader, count);
    } else if (mode === CRDT_PATH_SHAPE_VAR_STRING) {
      columns[segmentIndex] = readBinaryStringColumn(reader, count);
    } else {
      throw new TypeError('invalid binary CRDT path-shape mode');
    }
  }
  const values = readBinaryJsonValueColumn(reader, count);
  for (let i = 0; i < count; i++) {
    const seq = startSeq + i;
    const id = `${actor}:${seq}`;
    const deps = i === 0 ? firstDeps : [`${actor}:${seq - 1}`];
    const path = new Array<string | number>(pathLength);
    for (let segmentIndex = 0; segmentIndex < pathLength; segmentIndex++) {
      const column = columns[segmentIndex];
      path[segmentIndex] = column === undefined ? constants[segmentIndex] as string | number : column[i];
    }
    ops[ops.length] = { type: 'set', id, actor, seq, deps, path, value: values[i] };
  }
}

function readBinaryScheduledTextInsertRun(reader: CrdtBinaryReader, ops: CrdtOperation[]): void {
  const schedule = readBinaryActorSchedule(reader);
  const path = readBinaryPath(reader);
  const texts = readBinaryScheduledTextValues(reader, schedule.count);
  const ids = new Array<string>(schedule.count);
  const actors = new Array<string>(schedule.count);
  const seqs = new Array<number>(schedule.count);
  const nextSeqs = schedule.startSeqs.slice();
  for (let i = 0; i < schedule.count; i++) {
    const actorIndex = schedule.pattern[i % schedule.pattern.length];
    if (actorIndex < 0 || actorIndex >= schedule.actors.length) throw new TypeError('invalid binary CRDT actor schedule index');
    const actor = schedule.actors[actorIndex];
    const seq = nextSeqs[actorIndex]++;
    actors[i] = actor;
    seqs[i] = seq;
    ids[i] = `${actor}:${seq}`;
  }
  const deps = readBinaryScheduledTextDeps(reader, ids, schedule.count);
  const afters = readBinaryScheduledTextAfter(reader, ids, texts);
  for (let i = 0; i < schedule.count; i++) {
    ops[ops.length] = {
      type: 'textInsert',
      id: ids[i],
      actor: actors[i],
      seq: seqs[i],
      deps: deps[i],
      path,
      after: afters[i],
      text: texts[i]
    };
  }
}

function readBinaryScheduledTextInsertGrammarRun(reader: CrdtBinaryReader, ops: CrdtOperation[]): void {
  const schedule = readBinaryActorGrammarSchedule(reader);
  const path = readBinaryPath(reader);
  const texts = readBinaryScheduledTextValues(reader, schedule.count);
  const actorIndexes = expandActorGrammarSchedule(schedule);
  const ids = new Array<string>(schedule.count);
  const actors = new Array<string>(schedule.count);
  const seqs = new Array<number>(schedule.count);
  const nextSeqs = schedule.startSeqs.slice();
  for (let i = 0; i < schedule.count; i++) {
    const actorIndex = actorIndexes[i];
    if (actorIndex < 0 || actorIndex >= schedule.actors.length) throw new TypeError('invalid binary CRDT actor grammar index');
    const actor = schedule.actors[actorIndex];
    const seq = nextSeqs[actorIndex]++;
    actors[i] = actor;
    seqs[i] = seq;
    ids[i] = `${actor}:${seq}`;
  }
  const deps = readBinaryScheduledTextDeps(reader, ids, schedule.count);
  const afters = readBinaryScheduledTextAfter(reader, ids, texts);
  for (let i = 0; i < schedule.count; i++) {
    ops[ops.length] = {
      type: 'textInsert',
      id: ids[i],
      actor: actors[i],
      seq: seqs[i],
      deps: deps[i],
      path,
      after: afters[i],
      text: texts[i]
    };
  }
}

function readBinaryActorSchedule(reader: CrdtBinaryReader): CrdtActorSchedule {
  const count = reader.readVarint();
  const actorCount = reader.readVarint();
  if (count === 0 || actorCount === 0) throw new TypeError('invalid binary CRDT actor schedule');
  const actors = new Array<string>(actorCount);
  const startSeqs = new Array<number>(actorCount);
  for (let i = 0; i < actorCount; i++) {
    actors[i] = reader.readString();
    startSeqs[i] = reader.readVarint();
    if (startSeqs[i] <= 0) throw new TypeError('invalid binary CRDT actor schedule seq');
  }
  const patternLength = reader.readVarint();
  if (patternLength === 0) throw new TypeError('invalid binary CRDT actor schedule pattern');
  const pattern = new Array<number>(patternLength);
  for (let i = 0; i < patternLength; i++) {
    const actorIndex = reader.readVarint();
    if (actorIndex >= actorCount) throw new TypeError('invalid binary CRDT actor schedule index');
    pattern[i] = actorIndex;
  }
  return { count, actors, startSeqs, pattern };
}

function readBinaryActorGrammarSchedule(reader: CrdtBinaryReader): CrdtActorGrammarSchedule {
  const count = reader.readVarint();
  const actorCount = reader.readVarint();
  if (count === 0 || actorCount === 0) throw new TypeError('invalid binary CRDT actor grammar schedule');
  const actors = new Array<string>(actorCount);
  const startSeqs = new Array<number>(actorCount);
  for (let i = 0; i < actorCount; i++) {
    actors[i] = reader.readString();
    startSeqs[i] = reader.readVarint();
    if (startSeqs[i] <= 0) throw new TypeError('invalid binary CRDT actor grammar seq');
  }
  const ruleCount = reader.readVarint();
  if (ruleCount === 0 || ruleCount > CRDT_ACTOR_GRAMMAR_MAX_RULES) throw new TypeError('invalid binary CRDT actor grammar rule count');
  const rules = new Array<[number, number]>(ruleCount);
  for (let i = 0; i < ruleCount; i++) {
    const left = reader.readVarint();
    const right = reader.readVarint();
    const maxSymbol = actorCount + i;
    if (left >= maxSymbol || right >= maxSymbol) throw new TypeError('invalid binary CRDT actor grammar rule');
    rules[i] = [left, right];
  }
  const symbolCount = reader.readVarint();
  if (symbolCount === 0) throw new TypeError('invalid binary CRDT actor grammar root');
  const symbols = new Array<number>(symbolCount);
  const maxSymbol = actorCount + ruleCount;
  for (let i = 0; i < symbolCount; i++) {
    const symbol = reader.readVarint();
    if (symbol >= maxSymbol) throw new TypeError('invalid binary CRDT actor grammar symbol');
    symbols[i] = symbol;
  }
  return { count, actors, startSeqs, rules, symbols };
}

function expandActorGrammarSchedule(schedule: CrdtActorGrammarSchedule): number[] {
  const actorCount = schedule.actors.length;
  const expanded: number[] = [];
  const stack = schedule.symbols.slice().reverse();
  while (stack.length > 0) {
    const symbol = stack.pop() as number;
    if (symbol < actorCount) {
      expanded[expanded.length] = symbol;
    } else {
      const rule = schedule.rules[symbol - actorCount];
      if (rule === undefined) throw new TypeError('invalid binary CRDT actor grammar reference');
      stack[stack.length] = rule[1];
      stack[stack.length] = rule[0];
    }
    if (expanded.length > schedule.count) throw new TypeError('invalid binary CRDT actor grammar length');
  }
  if (expanded.length !== schedule.count) throw new TypeError('invalid binary CRDT actor grammar length');
  return expanded;
}

function readBinaryScheduledTextValues(reader: CrdtBinaryReader, count: number): string[] {
  const mode = reader.readByte();
  const texts = new Array<string>(count);
  if (mode === CRDT_TEXT_SCHEDULE_TEXT_REPEATED) {
    const text = reader.readString();
    if (codePointLength(text) !== 1) throw new TypeError('invalid binary CRDT scheduled text repeat');
    for (let i = 0; i < count; i++) texts[i] = text;
    return texts;
  }
  if (mode === CRDT_TEXT_SCHEDULE_TEXT_JOINED) {
    const joined = reader.readString();
    const chars = stringCodePoints(joined);
    if (chars.length !== count) throw new TypeError('invalid binary CRDT scheduled text length');
    return chars;
  }
  if (mode === CRDT_TEXT_SCHEDULE_TEXT_RAW) {
    for (let i = 0; i < count; i++) texts[i] = reader.readString();
    return texts;
  }
  throw new TypeError('invalid binary CRDT scheduled text mode');
}

function readBinaryScheduledTextDeps(reader: CrdtBinaryReader, ids: string[], count: number): string[][] {
  const mode = reader.readByte();
  const deps = new Array<string[]>(count);
  if (mode === CRDT_TEXT_SCHEDULE_DEPS_CHAIN) {
    deps[0] = readBinaryOperationIds(reader);
    for (let i = 1; i < count; i++) deps[i] = [ids[i - 1]];
    return deps;
  }
  if (mode === CRDT_TEXT_SCHEDULE_DEPS_SAME) {
    const shared = readBinaryOperationIds(reader);
    for (let i = 0; i < count; i++) deps[i] = shared.slice();
    return deps;
  }
  if (mode === CRDT_TEXT_SCHEDULE_DEPS_RAW) {
    for (let i = 0; i < count; i++) deps[i] = readBinaryOperationIds(reader);
    return deps;
  }
  throw new TypeError('invalid binary CRDT scheduled deps mode');
}

function readBinaryScheduledTextAfter(reader: CrdtBinaryReader, ids: string[], texts: string[]): Array<string | null> {
  const mode = reader.readByte();
  const afters = new Array<string | null>(ids.length);
  if (mode === CRDT_TEXT_SCHEDULE_AFTER_CHAIN) {
    afters[0] = readBinaryNullableString(reader);
    for (let i = 1; i < ids.length; i++) {
      afters[i] = `${ids[i - 1]}/${codePointLength(texts[i - 1]) - 1}`;
    }
    return afters;
  }
  if (mode === CRDT_TEXT_SCHEDULE_AFTER_NULL) {
    for (let i = 0; i < ids.length; i++) afters[i] = null;
    return afters;
  }
  if (mode === CRDT_TEXT_SCHEDULE_AFTER_RAW) {
    for (let i = 0; i < ids.length; i++) afters[i] = readBinaryNullableString(reader);
    return afters;
  }
  throw new TypeError('invalid binary CRDT scheduled after mode');
}

function getUniformListRunObjectKeys(ops: CrdtOperation[], start: number, end: number): string[] | null {
  const firstValues = (ops[start] as Extract<CrdtOperation, { type: 'listInsert' }>).values;
  if (firstValues.length !== 1 || !isPlainJsonObject(firstValues[0])) return null;
  const keys = Object.keys(firstValues[0] as Record<string, JsonValue>);
  if (keys.length === 0) return null;
  for (let i = start + 1; i < end; i++) {
    const values = (ops[i] as Extract<CrdtOperation, { type: 'listInsert' }>).values;
    if (values.length !== 1 || !isPlainJsonObject(values[0]) || !hasSameKeys(values[0] as Record<string, JsonValue>, keys)) {
      return null;
    }
  }
  return keys;
}

function getUniformObjectValueKeys(values: JsonValue[]): string[] | null {
  if (values.length === 0 || !isPlainJsonObject(values[0])) return null;
  const keys = Object.keys(values[0] as Record<string, JsonValue>);
  if (keys.length === 0) return null;
  for (let i = 1, length = values.length; i < length; i++) {
    if (!isPlainJsonObject(values[i]) || !hasSameKeys(values[i] as Record<string, JsonValue>, keys)) return null;
  }
  return keys;
}

function isPlainJsonObject(value: JsonValue): boolean {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isJsonObject(value: unknown): value is Record<string, JsonValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasSameKeys(value: Record<string, JsonValue>, keys: string[]): boolean {
  const valueKeys = Object.keys(value);
  if (valueKeys.length !== keys.length) return false;
  for (let i = 0, length = keys.length; i < length; i++) {
    if (!Object.prototype.hasOwnProperty.call(value, keys[i])) return false;
  }
  return true;
}

function writeBinaryOperationIds(writer: CrdtBinaryWriter, ids: string[]): void {
  writer.writeVarint(ids.length);
  for (let i = 0, length = ids.length; i < length; i++) {
    const parsed = parseOperationId(ids[i]);
    writer.writeString(parsed.actor);
    writer.writeVarint(parsed.seq);
  }
}

function readBinaryOperationIds(reader: CrdtBinaryReader): string[] {
  const count = reader.readVarint();
  const ids = new Array<string>(count);
  for (let i = 0; i < count; i++) {
    ids[i] = `${reader.readString()}:${reader.readVarint()}`;
  }
  return ids;
}

function writeBinaryBytes(writer: CrdtBinaryWriter, value: Uint8Array): void {
  writer.writeVarint(value.byteLength);
  writer.writeBytes(value);
}

function readBinaryBytes(reader: CrdtBinaryReader): Uint8Array {
  const length = reader.readVarint();
  const end = reader.offset + length;
  if (end > reader.bytes.length) throw new TypeError('unexpected end of binary CRDT bytes');
  const out = reader.bytes.slice(reader.offset, end);
  reader.offset = end;
  return out;
}

function writeBinaryStrings(writer: CrdtBinaryWriter, values: string[]): void {
  writer.writeVarint(values.length);
  for (let i = 0, length = values.length; i < length; i++) writer.writeString(values[i]);
}

function readBinaryStrings(reader: CrdtBinaryReader): string[] {
  const count = reader.readVarint();
  const values = new Array<string>(count);
  for (let i = 0; i < count; i++) values[i] = reader.readString();
  return values;
}

function writeBinaryNullableString(writer: CrdtBinaryWriter, value: string | null): void {
  if (value === null) {
    writer.writeByte(0);
  } else {
    writer.writeByte(1);
    writer.writeString(value);
  }
}

function readBinaryNullableString(reader: CrdtBinaryReader): string | null {
  const tag = reader.readByte();
  if (tag === 0) return null;
  if (tag === 1) return reader.readString();
  throw new TypeError('invalid binary CRDT nullable string');
}

function writeBinaryPath(writer: CrdtBinaryWriter, path: JsonPath): void {
  writeBinaryPathWithOptions(writer, path, CRDT_BINARY_PATH_OPTIONS);
}

function readBinaryPath(reader: CrdtBinaryReader): JsonPath {
  return readBinaryPathWithOptions(reader, CRDT_BINARY_PATH_OPTIONS);
}

function writeBinaryJsonValue(writer: CrdtBinaryWriter, value: JsonValue): void {
  writeBinaryJsonValueCore(writer, value, CRDT_BINARY_JSON_VALUE_OPTIONS);
}

function readBinaryJsonValue(reader: CrdtBinaryReader): JsonValue {
  return readBinaryJsonValueCore(reader, CRDT_BINARY_JSON_VALUE_OPTIONS);
}

function writeBinaryJsonValueColumn(writer: CrdtBinaryWriter, values: JsonValue[]): void {
  if (values.length > 0 && allSameJsonPrimitive(values)) {
    writer.writeByte(1);
    writeBinaryJsonValue(writer, values[0]);
    return;
  }
  const arithmetic = arithmeticNumberColumn(values);
  if (arithmetic !== null) {
    writer.writeByte(2);
    writer.writeSignedVarint(arithmetic.first);
    writer.writeSignedVarint(arithmetic.step);
    return;
  }
  if (allBooleanValues(values)) {
    writer.writeByte(3);
    writeBooleanColumn(writer, values as boolean[]);
    return;
  }
  const stringRun = stringPrefixNumberColumn(values);
  if (stringRun !== null) {
    writer.writeByte(4);
    writer.writeString(stringRun.prefix);
    writer.writeSignedVarint(stringRun.first);
    writer.writeSignedVarint(stringRun.step);
    return;
  }
  writer.writeByte(0);
  for (let i = 0, length = values.length; i < length; i++) writeBinaryJsonValue(writer, values[i]);
}

function readBinaryJsonValueColumn(reader: CrdtBinaryReader, length: number): JsonValue[] {
  const mode = reader.readByte();
  if (mode === 1) {
    const value = readBinaryJsonValue(reader);
    const values = new Array<JsonValue>(length);
    for (let i = 0; i < length; i++) values[i] = cloneJson(value);
    return values;
  }
  if (mode === 2) {
    const first = reader.readSignedVarint();
    const step = reader.readSignedVarint();
    const values = new Array<JsonValue>(length);
    for (let i = 0; i < length; i++) values[i] = first + (step * i);
    return values;
  }
  if (mode === 3) return readBooleanColumn(reader, length) as JsonValue[];
  if (mode === 4) {
    const prefix = reader.readString();
    const first = reader.readSignedVarint();
    const step = reader.readSignedVarint();
    const values = new Array<JsonValue>(length);
    for (let i = 0; i < length; i++) values[i] = prefix + String(first + (step * i));
    return values;
  }
  if (mode === 0) {
    const values = new Array<JsonValue>(length);
    for (let i = 0; i < length; i++) values[i] = readBinaryJsonValue(reader);
    return values;
  }
  throw new TypeError('invalid binary CRDT value-column mode');
}

function writeBinaryStringColumn(writer: CrdtBinaryWriter, values: string[]): void {
  const stringRun = stringPrefixNumberStringColumn(values);
  if (stringRun !== null) {
    writer.writeByte(1);
    writer.writeString(stringRun.prefix);
    writer.writeSignedVarint(stringRun.first);
    writer.writeSignedVarint(stringRun.step);
    return;
  }
  writer.writeByte(0);
  for (let i = 0, length = values.length; i < length; i++) writer.writeString(values[i]);
}

function readBinaryStringColumn(reader: CrdtBinaryReader, length: number): string[] {
  const mode = reader.readByte();
  if (mode === 1) {
    const prefix = reader.readString();
    const first = reader.readSignedVarint();
    const step = reader.readSignedVarint();
    const values = new Array<string>(length);
    for (let i = 0; i < length; i++) values[i] = prefix + String(first + (step * i));
    return values;
  }
  if (mode === 0) {
    const values = new Array<string>(length);
    for (let i = 0; i < length; i++) values[i] = reader.readString();
    return values;
  }
  throw new TypeError('invalid binary CRDT string-column mode');
}

function writeBinarySignedIntegerColumn(writer: CrdtBinaryWriter, values: number[]): void {
  const arithmetic = arithmeticIntegerColumn(values);
  const periodicLength = findPeriodicIntegerColumnLength(values);
  const runCount = countIntegerColumnRuns(values);
  const sizes = {
    raw: 1 + signedIntegerColumnRawByteLength(values),
    delta: 1 + signedIntegerColumnDeltaByteLength(values),
    arithmetic: arithmetic === null ? Number.POSITIVE_INFINITY : 1 + signedVarintByteLength(arithmetic.first) + signedVarintByteLength(arithmetic.step),
    rle: runCount < values.length ? 1 + signedIntegerColumnRleByteLength(values, runCount) : Number.POSITIVE_INFINITY,
    periodic: periodicLength === 0 ? Number.POSITIVE_INFINITY : 1 + varintByteLength(periodicLength) + signedIntegerColumnRawByteLength(values, periodicLength)
  };
  let mode = CRDT_INT_COLUMN_RAW;
  let best = sizes.raw;
  if (sizes.arithmetic < best) {
    mode = CRDT_INT_COLUMN_ARITHMETIC;
    best = sizes.arithmetic;
  }
  if (sizes.delta < best) {
    mode = CRDT_INT_COLUMN_DELTA;
    best = sizes.delta;
  }
  if (sizes.rle < best) {
    mode = CRDT_INT_COLUMN_RLE;
    best = sizes.rle;
  }
  if (sizes.periodic < best) {
    mode = CRDT_INT_COLUMN_PERIODIC;
  }

  writer.writeByte(mode);
  if (mode === CRDT_INT_COLUMN_ARITHMETIC) {
    writer.writeSignedVarint((arithmetic as { first: number; step: number }).first);
    writer.writeSignedVarint((arithmetic as { first: number; step: number }).step);
  } else if (mode === CRDT_INT_COLUMN_DELTA) {
    writeSignedIntegerColumnDelta(writer, values);
  } else if (mode === CRDT_INT_COLUMN_RLE) {
    writeSignedIntegerColumnRle(writer, values, runCount);
  } else if (mode === CRDT_INT_COLUMN_PERIODIC) {
    writer.writeVarint(periodicLength);
    for (let i = 0; i < periodicLength; i++) writer.writeSignedVarint(values[i]);
  } else {
    for (let i = 0, length = values.length; i < length; i++) writer.writeSignedVarint(values[i]);
  }
}

function readBinarySignedIntegerColumn(reader: CrdtBinaryReader, length: number): number[] {
  const mode = reader.readByte();
  const values = new Array<number>(length);
  if (mode === CRDT_INT_COLUMN_RAW) {
    for (let i = 0; i < length; i++) values[i] = reader.readSignedVarint();
    return values;
  }
  if (mode === CRDT_INT_COLUMN_ARITHMETIC) {
    const first = reader.readSignedVarint();
    const step = reader.readSignedVarint();
    for (let i = 0; i < length; i++) values[i] = first + (step * i);
    return values;
  }
  if (mode === CRDT_INT_COLUMN_DELTA) {
    if (length === 0) return values;
    let value = reader.readSignedVarint();
    values[0] = value;
    for (let i = 1; i < length; i++) {
      value += reader.readSignedVarint();
      values[i] = value;
    }
    return values;
  }
  if (mode === CRDT_INT_COLUMN_RLE) {
    let offset = 0;
    const runCount = reader.readVarint();
    for (let run = 0; run < runCount; run++) {
      const value = reader.readSignedVarint();
      const count = reader.readVarint();
      if (count === 0 || offset + count > length) throw new TypeError('invalid binary CRDT integer-column run');
      for (let i = 0; i < count; i++) values[offset + i] = value;
      offset += count;
    }
    if (offset !== length) throw new TypeError('invalid binary CRDT integer-column length');
    return values;
  }
  if (mode === CRDT_INT_COLUMN_PERIODIC) {
    const period = reader.readVarint();
    if (period === 0) throw new TypeError('invalid binary CRDT integer-column period');
    const pattern = new Array<number>(period);
    for (let i = 0; i < period; i++) pattern[i] = reader.readSignedVarint();
    for (let i = 0; i < length; i++) values[i] = pattern[i % period];
    return values;
  }
  throw new TypeError('invalid binary CRDT integer-column mode');
}

function allSameJsonPrimitive(values: JsonValue[]): boolean {
  const first = values[0];
  if (first !== null && typeof first === 'object') return false;
  for (let i = 1, length = values.length; i < length; i++) {
    if (values[i] !== first) return false;
  }
  return values.length !== 0;
}

function arithmeticNumberColumn(values: JsonValue[]): { first: number; step: number } | null {
  if (values.length < 2 || typeof values[0] !== 'number' || typeof values[1] !== 'number') return null;
  const first = values[0] as number;
  const step = (values[1] as number) - first;
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(step)) return null;
  for (let i = 0, length = values.length; i < length; i++) {
    const value = values[i];
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value !== first + (step * i)) return null;
  }
  return { first, step };
}

function allBooleanValues(values: JsonValue[]): boolean {
  if (values.length === 0) return false;
  for (let i = 0, length = values.length; i < length; i++) {
    if (typeof values[i] !== 'boolean') return false;
  }
  return true;
}

function writeBooleanColumn(writer: CrdtBinaryWriter, values: boolean[]): void {
  let byte = 0;
  let bit = 0;
  for (let i = 0, length = values.length; i < length; i++) {
    if (values[i]) byte |= 1 << bit;
    bit++;
    if (bit === 8) {
      writer.writeByte(byte);
      byte = 0;
      bit = 0;
    }
  }
  if (bit !== 0) writer.writeByte(byte);
}

function readBooleanColumn(reader: CrdtBinaryReader, length: number): boolean[] {
  const values = new Array<boolean>(length);
  let byte = 0;
  for (let i = 0; i < length; i++) {
    if ((i & 7) === 0) byte = reader.readByte();
    values[i] = ((byte >> (i & 7)) & 1) === 1;
  }
  return values;
}

function stringPrefixNumberColumn(values: JsonValue[]): { prefix: string; first: number; step: number } | null {
  if (values.length < 2) return null;
  const strings = new Array<string>(values.length);
  for (let i = 0, length = values.length; i < length; i++) {
    if (typeof values[i] !== 'string') return null;
    strings[i] = values[i] as string;
  }
  return stringPrefixNumberStringColumn(strings);
}

function stringPrefixNumberStringColumn(values: string[]): { prefix: string; first: number; step: number } | null {
  if (values.length < 2) return null;
  const first = splitNumericSuffix(values[0]);
  const second = splitNumericSuffix(values[1]);
  if (first === null || second === null || first.prefix !== second.prefix) return null;
  const step = second.number - first.number;
  if (!Number.isSafeInteger(step)) return null;
  for (let i = 0, length = values.length; i < length; i++) {
    const parsed = splitNumericSuffix(values[i]);
    if (parsed === null || parsed.prefix !== first.prefix || parsed.number !== first.number + (step * i)) return null;
  }
  return { prefix: first.prefix, first: first.number, step };
}

function splitNumericSuffix(value: string): { prefix: string; number: number } | null {
  let index = value.length;
  while (index > 0) {
    const code = value.charCodeAt(index - 1);
    if (code < 48 || code > 57) break;
    index--;
  }
  if (index === value.length) return null;
  const prefix = value.slice(0, index);
  const suffix = value.slice(index);
  if (suffix.length === 0) return null;
  const number = Number(suffix);
  return Number.isSafeInteger(number) ? { prefix, number } : null;
}

function arithmeticIntegerColumn(values: number[]): { first: number; step: number } | null {
  if (values.length < 2) return null;
  const first = values[0];
  const step = values[1] - first;
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(step)) return null;
  for (let i = 0, length = values.length; i < length; i++) {
    if (!Number.isSafeInteger(values[i]) || values[i] !== first + (step * i)) return null;
  }
  return { first, step };
}

function signedIntegerColumnRawByteLength(values: number[], length = values.length): number {
  let size = 0;
  for (let i = 0; i < length; i++) size += signedVarintByteLength(values[i]);
  return size;
}

function signedIntegerColumnDeltaByteLength(values: number[]): number {
  if (values.length === 0) return 0;
  let size = signedVarintByteLength(values[0]);
  for (let i = 1, length = values.length; i < length; i++) size += signedVarintByteLength(values[i] - values[i - 1]);
  return size;
}

function countIntegerColumnRuns(values: number[]): number {
  if (values.length === 0) return 0;
  let count = 1;
  for (let i = 1, length = values.length; i < length; i++) {
    if (values[i] !== values[i - 1]) count++;
  }
  return count;
}

function signedIntegerColumnRleByteLength(values: number[], runCount: number): number {
  if (values.length === 0) return varintByteLength(0);
  let size = varintByteLength(runCount);
  let count = 1;
  for (let i = 1, length = values.length; i <= length; i++) {
    if (i < length && values[i] === values[i - 1]) {
      count++;
    } else {
      size += signedVarintByteLength(values[i - 1]) + varintByteLength(count);
      count = 1;
    }
  }
  return size;
}

function writeSignedIntegerColumnDelta(writer: CrdtBinaryWriter, values: number[]): void {
  if (values.length === 0) return;
  writer.writeSignedVarint(values[0]);
  for (let i = 1, length = values.length; i < length; i++) writer.writeSignedVarint(values[i] - values[i - 1]);
}

function writeSignedIntegerColumnRle(writer: CrdtBinaryWriter, values: number[], runCount: number): void {
  writer.writeVarint(runCount);
  if (values.length === 0) return;
  let count = 1;
  for (let i = 1, length = values.length; i <= length; i++) {
    if (i < length && values[i] === values[i - 1]) {
      count++;
    } else {
      writer.writeSignedVarint(values[i - 1]);
      writer.writeVarint(count);
      count = 1;
    }
  }
}

function findPeriodicIntegerColumnLength(values: number[]): number {
  if (values.length < 4) return 0;
  const maxPeriod = Math.min(CRDT_INT_COLUMN_MAX_PERIOD, values.length - 1);
  const first = values[0];
  for (let period = 1; period <= maxPeriod; period++) {
    if (values[period] !== first) continue;
    let matches = true;
    for (let i = period, length = values.length; i < length; i++) {
      if (values[i] !== values[i % period]) {
        matches = false;
        break;
      }
    }
    if (matches) return period;
  }
  return 0;
}

function varintByteLength(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) return Number.POSITIVE_INFINITY;
  let length = 1;
  while (value >= 128) {
    length++;
    value = Math.floor(value / 128);
  }
  return length;
}

function writeVarintBytes(bytes: Uint8Array, offset: number, value: number): number {
  while (value >= 128) {
    bytes[offset++] = (value % 128) | 0x80;
    value = Math.floor(value / 128);
  }
  bytes[offset++] = value;
  return offset;
}

function signedVarintByteLength(value: number): number {
  if (!Number.isSafeInteger(value)) return Number.POSITIVE_INFINITY;
  return varintByteLength(value < 0 ? (-value * 2) - 1 : value * 2);
}

function writeRawBinaryBytes(writer: CrdtBinaryWriter, bytes: Uint8Array): void {
  for (let i = 0, length = bytes.length; i < length; i++) writer.writeByte(bytes[i]);
}

function writePackedTwoBitValues(writer: CrdtBinaryWriter, values: number[]): void {
  const byteLength = Math.ceil(values.length / 4);
  for (let i = 0; i < byteLength; i++) {
    let byte = 0;
    for (let bit = 0; bit < 4; bit++) {
      const value = values[i * 4 + bit] || 0;
      if (value < 0 || value > 3) throw new TypeError('two-bit CRDT value out of range');
      byte |= value << (bit * 2);
    }
    writer.writeByte(byte);
  }
}

function readPackedTwoBitValues(reader: CrdtBinaryReader, count: number): number[] {
  if (!Number.isSafeInteger(count) || count < 0) throw new TypeError('invalid packed CRDT value count');
  const values = new Array<number>(count);
  const byteLength = Math.ceil(count / 4);
  for (let i = 0; i < byteLength; i++) {
    const byte = reader.readByte();
    for (let bit = 0; bit < 4; bit++) {
      const index = i * 4 + bit;
      if (index >= count) break;
      values[index] = (byte >>> (bit * 2)) & 0x03;
    }
  }
  return values;
}

function writeBinaryTextTagColumn(writer: CrdtBinaryWriter, tags: number[]): void {
  const primary = topIntegerValues(tags, 2);
  const first = primary[0] === undefined ? 0 : primary[0];
  const second = primary[1] === undefined ? first : primary[1];
  writer.writeByte(first);
  writer.writeByte(second);
  const secondBits = new Array<boolean>(tags.length);
  const overrides: number[] = [];
  for (let i = 0, length = tags.length; i < length; i++) {
    const tag = tags[i];
    if (tag === second) {
      secondBits[i] = true;
    } else {
      secondBits[i] = false;
      if (tag !== first) {
        overrides[overrides.length] = i;
        overrides[overrides.length] = tag;
      }
    }
  }
  writeBooleanColumn(writer, secondBits);
  writer.writeVarint(overrides.length / 2);
  let previousIndex = 0;
  for (let i = 0; i < overrides.length; i += 2) {
    const index = overrides[i];
    writer.writeVarint(index - previousIndex);
    writer.writeByte(overrides[i + 1]);
    previousIndex = index;
  }
}

function readBinaryTextTagColumn(reader: CrdtBinaryReader, count: number): number[] {
  const first = reader.readByte();
  const second = reader.readByte();
  const secondBits = readBooleanColumn(reader, count);
  const tags = new Array<number>(count);
  for (let i = 0; i < count; i++) tags[i] = secondBits[i] ? second : first;
  const overrideCount = reader.readVarint();
  let previousIndex = 0;
  for (let i = 0; i < overrideCount; i++) {
    const index = previousIndex + reader.readVarint();
    const tag = reader.readByte();
    if (index < 0 || index >= count) throw new TypeError('invalid CRDT text tag override');
    tags[index] = tag;
    previousIndex = index;
  }
  return tags;
}

function writeTopValueSignedVarintColumn(writer: CrdtBinaryWriter, values: number[]): void {
  const primary = topIntegerValues(values, 3);
  writer.writeVarint(primary.length);
  for (let i = 0, length = primary.length; i < length; i++) writer.writeSignedVarint(primary[i]);
  const packed = new Array<number>(values.length);
  const escapes: number[] = [];
  for (let i = 0, length = values.length; i < length; i++) {
    const index = primary.indexOf(values[i]);
    if (index === -1) {
      packed[i] = 3;
      escapes[escapes.length] = values[i];
    } else {
      packed[i] = index;
    }
  }
  writePackedTwoBitValues(writer, packed);
  for (let i = 0, length = escapes.length; i < length; i++) writer.writeSignedVarint(escapes[i]);
}

function readTopValueSignedVarintColumn(reader: CrdtBinaryReader, count: number): number[] {
  const primaryCount = reader.readVarint();
  if (primaryCount > 3) throw new TypeError('invalid top-value CRDT column');
  const primary = new Array<number>(primaryCount);
  for (let i = 0; i < primaryCount; i++) primary[i] = reader.readSignedVarint();
  const packed = readPackedTwoBitValues(reader, count);
  const values = new Array<number>(count);
  for (let i = 0; i < count; i++) {
    const code = packed[i];
    if (code === 3) {
      values[i] = reader.readSignedVarint();
    } else {
      const value = primary[code];
      if (value === undefined) throw new TypeError('invalid top-value CRDT column code');
      values[i] = value;
    }
  }
  return values;
}

function writeSparseOneVarintColumn(writer: CrdtBinaryWriter, values: number[]): void {
  let overrideCount = 0;
  for (let i = 0, length = values.length; i < length; i++) {
    if (values[i] !== 1) overrideCount++;
  }
  writer.writeVarint(overrideCount);
  let previousIndex = 0;
  for (let i = 0, length = values.length; i < length; i++) {
    const value = values[i];
    if (value === 1) continue;
    writer.writeVarint(i - previousIndex);
    writer.writeVarint(value);
    previousIndex = i;
  }
}

function readSparseOneVarintColumn(reader: CrdtBinaryReader, count: number): number[] {
  const values = new Array<number>(count);
  values.fill(1);
  const overrideCount = reader.readVarint();
  let previousIndex = 0;
  for (let i = 0; i < overrideCount; i++) {
    const index = previousIndex + reader.readVarint();
    if (index < 0 || index >= count) throw new TypeError('invalid sparse-one CRDT column index');
    values[index] = reader.readVarint();
    previousIndex = index;
  }
  return values;
}

function writeNibbleVarintColumn(writer: CrdtBinaryWriter, values: number[]): void {
  const escapes: number[] = [];
  for (let i = 0, length = values.length; i < length; i += 2) {
    const first = nibbleVarintColumnCode(values[i], escapes);
    const second = i + 1 < values.length ? nibbleVarintColumnCode(values[i + 1], escapes) : 0;
    writer.writeByte(first | (second << 4));
  }
  for (let i = 0, length = escapes.length; i < length; i++) writer.writeVarint(escapes[i]);
}

function readNibbleVarintColumn(reader: CrdtBinaryReader, count: number): number[] {
  const values = new Array<number>(count);
  let escapeCount = 0;
  for (let i = 0; i < count; i += 2) {
    const byte = reader.readByte();
    const first = byte & 0x0f;
    values[i] = first;
    if (first === 0) escapeCount++;
    if (i + 1 < count) {
      const second = byte >>> 4;
      values[i + 1] = second;
      if (second === 0) escapeCount++;
    }
  }
  for (let i = 0; i < count && escapeCount > 0; i++) {
    if (values[i] !== 0) continue;
    values[i] = reader.readVarint();
    escapeCount--;
  }
  return values;
}

function nibbleVarintColumnCode(value: number, escapes: number[]): number {
  if (value >= 1 && value <= 15) return value;
  escapes[escapes.length] = value;
  return 0;
}

function topIntegerValues(values: number[], count: number): number[] {
  const counts = new Map<number, number>();
  for (let i = 0, length = values.length; i < length; i++) counts.set(values[i], (counts.get(values[i]) || 0) + 1);
  const topValues: number[] = [];
  const topCounts: number[] = [];
  counts.forEach((valueCount, value) => {
    let insertAt = topValues.length;
    while (insertAt > 0 && valueCount > topCounts[insertAt - 1]) insertAt--;
    if (insertAt >= count) return;
    topValues.splice(insertAt, 0, value);
    topCounts.splice(insertAt, 0, valueCount);
    if (topValues.length > count) {
      topValues.length = count;
      topCounts.length = count;
    }
  });
  return topValues;
}

function writeRleVarintColumn(writer: CrdtBinaryWriter, values: number[]): void {
  writeRleColumn(writer, values, (value) => writer.writeVarint(value));
}

function readPlainVarintColumn(reader: CrdtBinaryReader, count: number): number[] {
  const values = new Array<number>(count);
  for (let i = 0; i < count; i++) values[i] = reader.readVarint();
  return values;
}

function readPlainSignedVarintColumn(reader: CrdtBinaryReader, count: number): number[] {
  const values = new Array<number>(count);
  for (let i = 0; i < count; i++) values[i] = reader.readSignedVarint();
  return values;
}

function writeRleSignedVarintColumn(writer: CrdtBinaryWriter, values: number[]): void {
  writeRleColumn(writer, values, (value) => writer.writeSignedVarint(value));
}

function writeRleColumn(writer: CrdtBinaryWriter, values: number[], writeValue: (value: number) => void): void {
  const segmentCountOffset = writer.reserveFixedVarint();
  let segmentCount = 0;
  let offset = 0;
  while (offset < values.length) {
    const repeatLength = equalValueRunLength(values, offset);
    if (repeatLength >= 3) {
      writer.writeByte(1);
      writer.writeVarint(repeatLength);
      writeValue(values[offset]);
      offset += repeatLength;
      segmentCount++;
      continue;
    }

    const literalStart = offset;
    offset += repeatLength;
    while (offset < values.length) {
      const nextRepeatLength = equalValueRunLength(values, offset);
      if (nextRepeatLength >= 3) break;
      offset += nextRepeatLength;
    }
    writer.writeByte(0);
    writer.writeVarint(offset - literalStart);
    for (let i = literalStart; i < offset; i++) writeValue(values[i]);
    segmentCount++;
  }
  writer.patchFixedVarint(segmentCountOffset, segmentCount);
}

function readRleVarintColumn(reader: CrdtBinaryReader, count: number): number[] {
  return readRleColumn(reader, count, () => reader.readVarint());
}

function readRleSignedVarintColumn(reader: CrdtBinaryReader, count: number): number[] {
  return readRleColumn(reader, count, () => reader.readSignedVarint());
}

function readRleColumn(reader: CrdtBinaryReader, count: number, readValue: () => number): number[] {
  if (!Number.isSafeInteger(count) || count < 0) throw new TypeError('invalid RLE CRDT column count');
  const values = new Array<number>(count);
  const segmentCount = reader.readVarint();
  let offset = 0;
  for (let segment = 0; segment < segmentCount; segment++) {
    const mode = reader.readByte();
    const length = reader.readVarint();
    if (length <= 0 || offset + length > count) throw new TypeError('invalid RLE CRDT column segment');
    if (mode === 1) {
      const value = readValue();
      for (let i = 0; i < length; i++) values[offset + i] = value;
      offset += length;
    } else if (mode === 0) {
      for (let i = 0; i < length; i++) values[offset++] = readValue();
    } else {
      throw new TypeError('invalid RLE CRDT column mode');
    }
  }
  if (offset !== count) throw new TypeError('invalid RLE CRDT column length');
  return values;
}

function equalValueRunLength(values: number[], offset: number): number {
  const value = values[offset];
  let length = 1;
  while (offset + length < values.length && values[offset + length] === value) length++;
  return length;
}

function sliceStringCodePoints(value: string, startOffset: number, count: number): { text: string; nextOffset: number } {
  if (count < 0 || startOffset < 0 || startOffset > value.length) throw new TypeError('invalid CRDT text slice');
  if (count === 0) return { text: '', nextOffset: startOffset };
  let offset = startOffset;
  for (let i = 0; i < count; i++) {
    if (offset >= value.length) throw new TypeError('unexpected end of CRDT text content');
    const code = value.charCodeAt(offset++);
    if (code >= 0xd800 && code <= 0xdbff && offset < value.length) {
      const next = value.charCodeAt(offset);
      if (next >= 0xdc00 && next <= 0xdfff) offset++;
    }
  }
  return { text: value.slice(startOffset, offset), nextOffset: offset };
}

function compressCrdtLzBlock(input: Uint8Array): Uint8Array {
  const length = input.byteLength;
  if (length < 16) return input;
  const table = new Int32Array(1 << 16);
  table.fill(-1);
  const out: number[] = [];
  let anchor = 0;
  let offset = 0;

  while (offset <= length - 4) {
    const hash = crdtLzHash4(input, offset);
    const matchOffset = table[hash];
    table[hash] = offset;
    if (
      matchOffset >= 0 &&
      offset - matchOffset <= 0xffff &&
      input[matchOffset] === input[offset] &&
      input[matchOffset + 1] === input[offset + 1] &&
      input[matchOffset + 2] === input[offset + 2] &&
      input[matchOffset + 3] === input[offset + 3]
    ) {
      let matchLength = crdtLzMatchLength(input, matchOffset, offset);
      let shouldSkipForLazyMatch = false;
      for (let lookahead = 1; lookahead <= 3 && offset + lookahead <= length - 4; lookahead++) {
        const nextHash = crdtLzHash4(input, offset + lookahead);
        const nextMatchOffset = table[nextHash];
        if (
          nextMatchOffset >= 0 &&
          offset + lookahead - nextMatchOffset <= 0xffff &&
          input[nextMatchOffset] === input[offset + lookahead] &&
          input[nextMatchOffset + 1] === input[offset + lookahead + 1] &&
          input[nextMatchOffset + 2] === input[offset + lookahead + 2] &&
          input[nextMatchOffset + 3] === input[offset + lookahead + 3]
        ) {
          const nextMatchLength = crdtLzMatchLength(input, nextMatchOffset, offset + lookahead);
          if (nextMatchLength > matchLength + lookahead - 1) {
            shouldSkipForLazyMatch = true;
            continue;
          }
        }
      }
      if (shouldSkipForLazyMatch) {
        offset++;
        continue;
      }

      const literalLength = offset - anchor;
      out[out.length] = (Math.min(literalLength, 15) << 4) | Math.min(matchLength - 4, 15);
      if (literalLength >= 15) writeCrdtLzExtendedLength(out, literalLength - 15);
      for (let i = anchor; i < offset; i++) out[out.length] = input[i];
      const distance = offset - matchOffset;
      out[out.length] = distance & 0xff;
      out[out.length] = distance >>> 8;
      if (matchLength - 4 >= 15) writeCrdtLzExtendedLength(out, matchLength - 4 - 15);

      const matchStart = offset;
      offset += matchLength;
      anchor = offset;
      for (let i = matchStart + 1; i <= offset - 4; i++) {
        table[crdtLzHash4(input, i)] = i;
      }
    } else {
      offset++;
    }
  }

  const literalLength = length - anchor;
  out[out.length] = Math.min(literalLength, 15) << 4;
  if (literalLength >= 15) writeCrdtLzExtendedLength(out, literalLength - 15);
  for (let i = anchor; i < length; i++) out[out.length] = input[i];
  return new Uint8Array(out);
}

function decompressCrdtLzBlock(input: Uint8Array, expectedLength: number): Uint8Array {
  if (!Number.isSafeInteger(expectedLength) || expectedLength < 0) {
    throw new TypeError('invalid compressed CRDT block length');
  }
  const out = new Uint8Array(expectedLength);
  let inputOffset = 0;
  let outputOffset = 0;

  while (inputOffset < input.byteLength) {
    const token = input[inputOffset++];
    let literalLength = token >>> 4;
    if (literalLength === 15) {
      const result = readCrdtLzExtendedLength(input, inputOffset, literalLength);
      literalLength = result.length;
      inputOffset = result.offset;
    }
    if (inputOffset + literalLength > input.byteLength || outputOffset + literalLength > expectedLength) {
      throw new TypeError('invalid compressed CRDT literal block');
    }
    out.set(input.subarray(inputOffset, inputOffset + literalLength), outputOffset);
    inputOffset += literalLength;
    outputOffset += literalLength;
    if (inputOffset >= input.byteLength) break;
    if (inputOffset + 2 > input.byteLength) throw new TypeError('invalid compressed CRDT match offset');
    const distance = input[inputOffset] | (input[inputOffset + 1] << 8);
    inputOffset += 2;
    if (distance <= 0 || distance > outputOffset) throw new TypeError('invalid compressed CRDT match distance');
    let matchLength = (token & 0x0f) + 4;
    if ((token & 0x0f) === 15) {
      const result = readCrdtLzExtendedLength(input, inputOffset, matchLength);
      matchLength = result.length;
      inputOffset = result.offset;
    }
    if (outputOffset + matchLength > expectedLength) throw new TypeError('invalid compressed CRDT match block');
    for (let i = 0; i < matchLength; i++) out[outputOffset + i] = out[outputOffset - distance + i];
    outputOffset += matchLength;
  }

  if (outputOffset !== expectedLength) throw new TypeError('invalid compressed CRDT block size');
  return out;
}

function writeCrdtLzExtendedLength(out: number[], value: number): void {
  while (value >= 255) {
    out[out.length] = 255;
    value -= 255;
  }
  out[out.length] = value;
}

function readCrdtLzExtendedLength(
  input: Uint8Array,
  offset: number,
  baseLength: number
): { length: number; offset: number } {
  let length = baseLength;
  while (true) {
    if (offset >= input.byteLength) throw new TypeError('invalid compressed CRDT extended length');
    const byte = input[offset++];
    length += byte;
    if (!Number.isSafeInteger(length)) throw new TypeError('compressed CRDT length exceeds safe integer range');
    if (byte !== 255) return { length, offset };
  }
}

function crdtLzHash4(input: Uint8Array, offset: number): number {
  const value = (
    input[offset] |
    (input[offset + 1] << 8) |
    (input[offset + 2] << 16) |
    (input[offset + 3] << 24)
  ) >>> 0;
  return Math.imul(value, 2654435761) >>> 16;
}

function crdtLzMatchLength(input: Uint8Array, matchOffset: number, offset: number): number {
  let matchLength = 4;
  const maxMatchLength = input.byteLength - offset;
  while (
    matchLength < maxMatchLength &&
    input[matchOffset + matchLength] === input[offset + matchLength]
  ) {
    matchLength++;
  }
  return matchLength;
}

function encodeCompactOperations(ops: CrdtOperation[], updateActor: string): unknown[] {
  const encoded: unknown[] = [];
  for (let i = 0, length = ops.length; i < length; i++) {
    if (ops[i].type === 'textRun') {
      encoded[encoded.length] = encodeCompactTextRun(ops[i] as Extract<CrdtOperation, { type: 'textRun' }>, updateActor);
      continue;
    }
    if (ops[i].type === 'listRun') {
      encoded[encoded.length] = encodeCompactListRunOperation(ops[i] as Extract<CrdtOperation, { type: 'listRun' }>, updateActor);
      continue;
    }
    if (ops[i].type === 'mapSetRun') {
      encoded[encoded.length] = encodeCompactMapSetRunOperation(ops[i] as Extract<CrdtOperation, { type: 'mapSetRun' }>, updateActor);
      continue;
    }
    const runEnd = textInsertRunEnd(ops, i);
    if (runEnd - i >= 3) {
      const first = ops[i];
      const joined = tryJoinSingleCodePointTextRun(ops, i, runEnd);
      if (joined !== null && first.actor === updateActor) {
        encoded[encoded.length] = ['T', first.seq, first.deps, first.path, (first as Extract<CrdtOperation, { type: 'textInsert' }>).after, joined, runEnd - i];
      } else {
        const texts = new Array(runEnd - i);
        for (let j = i; j < runEnd; j++) texts[j - i] = (ops[j] as Extract<CrdtOperation, { type: 'textInsert' }>).text;
        encoded[encoded.length] = ['T', first.actor, first.seq, first.deps, first.path, (first as Extract<CrdtOperation, { type: 'textInsert' }>).after, texts];
      }
      i = runEnd - 1;
    } else {
      const listRunEnd = listInsertRunEnd(ops, i);
      if (listRunEnd - i >= 3 && ops[i].actor === updateActor) {
        encoded[encoded.length] = encodeCompactListRun(ops, i, listRunEnd);
        i = listRunEnd - 1;
      } else {
        const mapRunEnd = mapSetRunEnd(ops, i);
        if (mapRunEnd - i >= 3 && ops[i].actor === updateActor) {
          encoded[encoded.length] = encodeCompactMapSetRun(ops, i, mapRunEnd);
          i = mapRunEnd - 1;
        } else {
          encoded[encoded.length] = encodeCompactOperation(ops[i], updateActor);
        }
      }
    }
  }
  return encoded;
}

function encodeCompactTextRun(op: Extract<CrdtOperation, { type: 'textRun' }>, updateActor: string): unknown[] {
  return op.actor === updateActor
    ? ['T', op.seq, op.deps, op.path, op.after, op.text, op.count]
    : ['T', op.actor, op.seq, op.deps, op.path, op.after, op.text, op.count];
}

function encodeCompactListRun(ops: CrdtOperation[], start: number, end: number): unknown[] {
  const first = ops[start] as Extract<CrdtOperation, { type: 'listInsert' }>;
  const values: JsonValue[] = [];
  let counts: number[] | null = null;
  for (let i = start; i < end; i++) {
    const opValues = (ops[i] as Extract<CrdtOperation, { type: 'listInsert' }>).values;
    if (opValues.length !== 1 && counts === null) {
      counts = new Array(end - start);
      for (let j = 0; j < i - start; j++) counts[j] = 1;
    }
    if (counts !== null) counts[i - start] = opValues.length;
    for (let j = 0, valueCount = opValues.length; j < valueCount; j++) values[values.length] = opValues[j];
  }
  return counts === null
    ? ['L', first.seq, first.deps, first.path, first.after, values]
    : ['L', first.seq, first.deps, first.path, first.after, values, counts];
}

function encodeCompactListRunOperation(op: Extract<CrdtOperation, { type: 'listRun' }>, updateActor: string): unknown[] {
  return op.actor === updateActor
    ? ['L', op.seq, op.deps, op.path, op.after, op.values]
    : ['L', op.actor, op.seq, op.deps, op.path, op.after, op.values];
}

function encodeCompactMapSetRun(ops: CrdtOperation[], start: number, end: number): unknown[] {
  const first = ops[start] as Extract<CrdtOperation, { type: 'set' }>;
  const parentPath = first.path.slice(0, -1);
  const keys = new Array(end - start);
  const values = new Array(end - start);
  for (let i = start; i < end; i++) {
    const op = ops[i] as Extract<CrdtOperation, { type: 'set' }>;
    keys[i - start] = op.path[op.path.length - 1];
    values[i - start] = op.value;
  }
  return ['M', first.seq, first.deps, parentPath, keys, values];
}

function encodeCompactMapSetRunOperation(op: Extract<CrdtOperation, { type: 'mapSetRun' }>, updateActor: string): unknown[] {
  return op.actor === updateActor
    ? ['M', op.seq, op.deps, op.path, op.keys, op.values]
    : ['M', op.actor, op.seq, op.deps, op.path, op.keys, op.values];
}

function encodeCompactOperation(op: CrdtOperation, updateActor: string): unknown[] {
  if (op.actor === updateActor) {
    if (op.type === 'set') return [0, op.seq, op.deps, op.path, op.value];
    if (op.type === 'del') return [1, op.seq, op.deps, op.path];
    if (op.type === 'mapSetRun') return encodeCompactMapSetRunOperation(op, updateActor);
    if (op.type === 'counter') return [17, op.seq, op.deps, op.path, op.delta];
    if (op.type === 'treeCreate') return [18, op.seq, op.deps, op.path, op.nodeId, op.parent, op.after, op.value];
    if (op.type === 'treeMove') return [19, op.seq, op.deps, op.path, op.nodeId, op.parent, op.after];
    if (op.type === 'treeDel') return [20, op.seq, op.deps, op.path, op.nodeId];
    if (op.type === 'binarySet') return [21, op.seq, op.deps, op.path, op.bytes];
    if (op.type === 'treeSet') return [22, op.seq, op.deps, op.path, op.nodeId, op.value];
    if (op.type === 'listInsert') return [2, op.seq, op.deps, op.path, op.after, op.values];
    if (op.type === 'listRun') return encodeCompactListRunOperation(op, updateActor);
    if (op.type === 'listDel') return [3, op.seq, op.deps, op.path, op.elems];
    if (op.type === 'textInsert') return [4, op.seq, op.deps, op.path, op.after, op.text];
    if (op.type === 'textRun') return encodeCompactTextRun(op, updateActor);
    if (op.type === 'textDelRange') return [10, op.seq, op.deps, op.path, op.start, op.count, textDeleteSpanCode(op.span)];
    return [5, op.seq, op.deps, op.path, op.elems];
  }
  if (op.type === 'set') return [0, op.actor, op.seq, op.deps, op.path, op.value];
  if (op.type === 'del') return [1, op.actor, op.seq, op.deps, op.path];
  if (op.type === 'mapSetRun') return encodeCompactMapSetRunOperation(op, updateActor);
  if (op.type === 'counter') return [17, op.actor, op.seq, op.deps, op.path, op.delta];
  if (op.type === 'treeCreate') return [18, op.actor, op.seq, op.deps, op.path, op.nodeId, op.parent, op.after, op.value];
  if (op.type === 'treeMove') return [19, op.actor, op.seq, op.deps, op.path, op.nodeId, op.parent, op.after];
  if (op.type === 'treeDel') return [20, op.actor, op.seq, op.deps, op.path, op.nodeId];
  if (op.type === 'binarySet') return [21, op.actor, op.seq, op.deps, op.path, op.bytes];
  if (op.type === 'treeSet') return [22, op.actor, op.seq, op.deps, op.path, op.nodeId, op.value];
  if (op.type === 'listInsert') return [2, op.actor, op.seq, op.deps, op.path, op.after, op.values];
  if (op.type === 'listRun') return encodeCompactListRunOperation(op, updateActor);
  if (op.type === 'listDel') return [3, op.actor, op.seq, op.deps, op.path, op.elems];
  if (op.type === 'textInsert') return [4, op.actor, op.seq, op.deps, op.path, op.after, op.text];
  if (op.type === 'textRun') return encodeCompactTextRun(op, updateActor);
  if (op.type === 'textDelRange') return [10, op.actor, op.seq, op.deps, op.path, op.start, op.count, textDeleteSpanCode(op.span)];
  return [5, op.actor, op.seq, op.deps, op.path, op.elems];
}

function tryJoinSingleCodePointTextRun(ops: CrdtOperation[], start: number, end: number): string | null {
  let joined = '';
  for (let i = start; i < end; i++) {
    const text = (ops[i] as Extract<CrdtOperation, { type: 'textInsert' }>).text;
    if (codePointLength(text) !== 1) return null;
    joined += text;
  }
  return joined;
}

function tryRepeatSingleCodePointTextRun(ops: CrdtOperation[], start: number, end: number): string | null {
  const first = (ops[start] as Extract<CrdtOperation, { type: 'textInsert' }>).text;
  if (codePointLength(first) !== 1) return null;
  for (let i = start + 1; i < end; i++) {
    if ((ops[i] as Extract<CrdtOperation, { type: 'textInsert' }>).text !== first) return null;
  }
  return first;
}

function tryRepeatSingleCodePointString(text: string, count: number): string | null {
  if (count <= 0) return null;
  const firstEnd = nextCodePointOffset(text, 0);
  if (firstEnd <= 0) return null;
  const first = text.slice(0, firstEnd);
  let offset = firstEnd;
  for (let i = 1; i < count; i++) {
    if (offset + first.length > text.length || text.slice(offset, offset + first.length) !== first) return null;
    offset += first.length;
  }
  return offset === text.length ? first : null;
}

function decodeCompactOperations(encoded: unknown[], updateActor: string): CrdtOperation[] {
  const ops: CrdtOperation[] = [];
  for (let i = 0, length = encoded.length; i < length; i++) {
    const item = encoded[i];
    if (!Array.isArray(item)) throw new TypeError('invalid compact CRDT operation');
    if (item[0] === 'T') {
      appendDecodedTextRun(ops, item, updateActor);
    } else if (item[0] === 'L') {
      appendDecodedListRun(ops, item, updateActor);
    } else if (item[0] === 'M') {
      appendDecodedMapSetRun(ops, item, updateActor);
    } else {
      ops[ops.length] = decodeCompactOperation(item, updateActor);
    }
  }
  return ops;
}

function decodeCompactOperation(item: unknown[], updateActor: string): CrdtOperation {
  const code = item[0];
  if (typeof item[1] === 'number') return decodeActorlessCompactOperation(item, updateActor);

  const actor = item[1];
  const seq = item[2];
  const deps = item[3];
  const path = item[4];
  if (typeof actor !== 'string' || !Number.isSafeInteger(seq) || !Array.isArray(deps) || !Array.isArray(path)) {
    throw new TypeError('invalid compact CRDT operation');
  }
  const opSeq = seq as number;
  const opDeps = deps as string[];
  const opPath = path as JsonPath;
  const id = `${actor}:${opSeq}`;
  if (code === 0) return { type: 'set', id, actor, seq: opSeq, deps: opDeps, path: opPath, value: item[5] as JsonValue };
  if (code === 1) return { type: 'del', id, actor, seq: opSeq, deps: opDeps, path: opPath };
  if (code === 17) {
    if (!Number.isSafeInteger(item[5])) throw new TypeError('invalid compact CRDT counter');
    return { type: 'counter', id, actor, seq: opSeq, deps: opDeps, path: opPath, delta: item[5] as number };
  }
  if (code === 18) {
    if (
      typeof item[5] !== 'string' ||
      !(item[6] === null || typeof item[6] === 'string') ||
      !(item[7] === null || typeof item[7] === 'string')
    ) {
      throw new TypeError('invalid compact CRDT tree create');
    }
    return { type: 'treeCreate', id, actor, seq: opSeq, deps: opDeps, path: opPath, nodeId: item[5], parent: item[6] as string | null, after: item[7] as string | null, value: item[8] as JsonValue };
  }
  if (code === 19) {
    if (
      typeof item[5] !== 'string' ||
      !(item[6] === null || typeof item[6] === 'string') ||
      !(item[7] === null || typeof item[7] === 'string')
    ) {
      throw new TypeError('invalid compact CRDT tree move');
    }
    return { type: 'treeMove', id, actor, seq: opSeq, deps: opDeps, path: opPath, nodeId: item[5], parent: item[6] as string | null, after: item[7] as string | null };
  }
  if (code === 20) {
    if (typeof item[5] !== 'string') throw new TypeError('invalid compact CRDT tree delete');
    return { type: 'treeDel', id, actor, seq: opSeq, deps: opDeps, path: opPath, nodeId: item[5] };
  }
  if (code === 21) {
    if (typeof item[5] !== 'string') throw new TypeError('invalid compact CRDT binary set');
    return { type: 'binarySet', id, actor, seq: opSeq, deps: opDeps, path: opPath, bytes: item[5] };
  }
  if (code === 22) {
    if (typeof item[5] !== 'string') throw new TypeError('invalid compact CRDT tree set');
    return { type: 'treeSet', id, actor, seq: opSeq, deps: opDeps, path: opPath, nodeId: item[5], value: item[6] as JsonValue };
  }
  if (code === 2) {
    if (!(item[5] === null || typeof item[5] === 'string') || !Array.isArray(item[6])) {
      throw new TypeError('invalid compact CRDT list insert');
    }
    return { type: 'listInsert', id, actor, seq: opSeq, deps: opDeps, path: opPath, after: item[5] as string | null, values: item[6] as JsonValue[] };
  }
  if (code === 3) {
    if (!Array.isArray(item[5])) throw new TypeError('invalid compact CRDT list delete');
    return { type: 'listDel', id, actor, seq: opSeq, deps: opDeps, path: opPath, elems: item[5] as string[] };
  }
  if (code === 4) {
    if (!(item[5] === null || typeof item[5] === 'string') || typeof item[6] !== 'string') {
      throw new TypeError('invalid compact CRDT text insert');
    }
    return { type: 'textInsert', id, actor, seq: opSeq, deps: opDeps, path: opPath, after: item[5] as string | null, text: item[6] };
  }
  if (code === 5) {
    if (!Array.isArray(item[5])) throw new TypeError('invalid compact CRDT text delete');
    return { type: 'textDel', id, actor, seq: opSeq, deps: opDeps, path: opPath, elems: item[5] as string[] };
  }
  if (code === 10) {
    if (typeof item[5] !== 'string' || !Number.isSafeInteger(item[6]) || (item[6] as number) <= 0) {
      throw new TypeError('invalid compact CRDT text delete range');
    }
    return {
      type: 'textDelRange',
      id,
      actor,
      seq: opSeq,
      deps: opDeps,
      path: opPath,
      start: item[5],
      count: item[6] as number,
      span: textDeleteSpanFromCode(item[7])
    };
  }
  throw new TypeError('unknown compact CRDT operation type');
}

function decodeActorlessCompactOperation(item: unknown[], actor: string): CrdtOperation {
  const code = item[0];
  const seq = item[1];
  const deps = item[2];
  const path = item[3];
  if (!Number.isSafeInteger(seq) || !Array.isArray(deps) || !Array.isArray(path)) {
    throw new TypeError('invalid compact CRDT operation');
  }
  const opSeq = seq as number;
  const opDeps = deps as string[];
  const opPath = path as JsonPath;
  const id = `${actor}:${opSeq}`;
  if (code === 0) return { type: 'set', id, actor, seq: opSeq, deps: opDeps, path: opPath, value: item[4] as JsonValue };
  if (code === 1) return { type: 'del', id, actor, seq: opSeq, deps: opDeps, path: opPath };
  if (code === 17) {
    if (!Number.isSafeInteger(item[4])) throw new TypeError('invalid compact CRDT counter');
    return { type: 'counter', id, actor, seq: opSeq, deps: opDeps, path: opPath, delta: item[4] as number };
  }
  if (code === 18) {
    if (
      typeof item[4] !== 'string' ||
      !(item[5] === null || typeof item[5] === 'string') ||
      !(item[6] === null || typeof item[6] === 'string')
    ) {
      throw new TypeError('invalid compact CRDT tree create');
    }
    return { type: 'treeCreate', id, actor, seq: opSeq, deps: opDeps, path: opPath, nodeId: item[4], parent: item[5] as string | null, after: item[6] as string | null, value: item[7] as JsonValue };
  }
  if (code === 19) {
    if (
      typeof item[4] !== 'string' ||
      !(item[5] === null || typeof item[5] === 'string') ||
      !(item[6] === null || typeof item[6] === 'string')
    ) {
      throw new TypeError('invalid compact CRDT tree move');
    }
    return { type: 'treeMove', id, actor, seq: opSeq, deps: opDeps, path: opPath, nodeId: item[4], parent: item[5] as string | null, after: item[6] as string | null };
  }
  if (code === 20) {
    if (typeof item[4] !== 'string') throw new TypeError('invalid compact CRDT tree delete');
    return { type: 'treeDel', id, actor, seq: opSeq, deps: opDeps, path: opPath, nodeId: item[4] };
  }
  if (code === 21) {
    if (typeof item[4] !== 'string') throw new TypeError('invalid compact CRDT binary set');
    return { type: 'binarySet', id, actor, seq: opSeq, deps: opDeps, path: opPath, bytes: item[4] };
  }
  if (code === 22) {
    if (typeof item[4] !== 'string') throw new TypeError('invalid compact CRDT tree set');
    return { type: 'treeSet', id, actor, seq: opSeq, deps: opDeps, path: opPath, nodeId: item[4], value: item[5] as JsonValue };
  }
  if (code === 2) {
    if (!(item[4] === null || typeof item[4] === 'string') || !Array.isArray(item[5])) {
      throw new TypeError('invalid compact CRDT list insert');
    }
    return { type: 'listInsert', id, actor, seq: opSeq, deps: opDeps, path: opPath, after: item[4] as string | null, values: item[5] as JsonValue[] };
  }
  if (code === 3) {
    if (!Array.isArray(item[4])) throw new TypeError('invalid compact CRDT list delete');
    return { type: 'listDel', id, actor, seq: opSeq, deps: opDeps, path: opPath, elems: item[4] as string[] };
  }
  if (code === 4) {
    if (!(item[4] === null || typeof item[4] === 'string') || typeof item[5] !== 'string') {
      throw new TypeError('invalid compact CRDT text insert');
    }
    return { type: 'textInsert', id, actor, seq: opSeq, deps: opDeps, path: opPath, after: item[4] as string | null, text: item[5] };
  }
  if (code === 5) {
    if (!Array.isArray(item[4])) throw new TypeError('invalid compact CRDT text delete');
    return { type: 'textDel', id, actor, seq: opSeq, deps: opDeps, path: opPath, elems: item[4] as string[] };
  }
  if (code === 10) {
    if (typeof item[4] !== 'string' || !Number.isSafeInteger(item[5]) || (item[5] as number) <= 0) {
      throw new TypeError('invalid compact CRDT text delete range');
    }
    return {
      type: 'textDelRange',
      id,
      actor,
      seq: opSeq,
      deps: opDeps,
      path: opPath,
      start: item[4],
      count: item[5] as number,
      span: textDeleteSpanFromCode(item[6])
    };
  }
  throw new TypeError('unknown compact CRDT operation type');
}

function appendDecodedTextRun(ops: CrdtOperation[], item: unknown[], updateActor: string): void {
  if (typeof item[1] === 'number') {
    appendDecodedJoinedTextRun(ops, item, updateActor);
    return;
  }

  const actor = item[1];
  const startSeq = item[2];
  const firstDeps = item[3];
  const path = item[4];
  const firstAfter = item[5];
  const texts = item[6];
  const count = item[7];
  if (
    typeof actor !== 'string' ||
    !Number.isSafeInteger(startSeq) ||
    !Array.isArray(firstDeps) ||
    !Array.isArray(path) ||
    !(firstAfter === null || typeof firstAfter === 'string') ||
    !(
      Array.isArray(texts) ||
      (typeof texts === 'string' && Number.isSafeInteger(count))
    )
  ) {
    throw new TypeError('invalid compact CRDT text run');
  }

  const runActor = actor as string;
  const runStartSeq = startSeq as number;
  const runDeps = firstDeps as string[];
  const runPath = path as JsonPath;
  const runAfter = firstAfter as string | null;
  if (typeof texts === 'string') {
    const runCount = count as number;
    if (runCount < 0 || codePointLength(texts) !== runCount) throw new TypeError('invalid compact CRDT text run length');
    if (runCount !== 0) {
      ops[ops.length] = { type: 'textRun', id: `${runActor}:${runStartSeq}`, actor: runActor, seq: runStartSeq, deps: runDeps, path: runPath, after: runAfter, text: texts, count: runCount };
    }
    return;
  }

  let allSingleCodePoint = true;
  const runTexts = texts as unknown[];
  for (let i = 0, length = runTexts.length; i < length; i++) {
    if (typeof runTexts[i] !== 'string') throw new TypeError('invalid compact CRDT text run item');
    if (codePointLength(runTexts[i] as string) !== 1) allSingleCodePoint = false;
  }
  if (runTexts.length === 0) return;
  if (allSingleCodePoint) {
    ops[ops.length] = { type: 'textRun', id: `${runActor}:${runStartSeq}`, actor: runActor, seq: runStartSeq, deps: runDeps, path: runPath, after: runAfter, text: (runTexts as string[]).join(''), count: runTexts.length };
  } else {
    appendExpandedTextInsertRun(ops, runActor, runStartSeq, runDeps, runPath, runAfter, runTexts as string[]);
  }
}

function appendDecodedJoinedTextRun(ops: CrdtOperation[], item: unknown[], actor: string): void {
  const startSeq = item[1];
  const firstDeps = item[2];
  const path = item[3];
  const firstAfter = item[4];
  const text = item[5];
  const count = item[6];
  if (
    !Number.isSafeInteger(startSeq) ||
    !Array.isArray(firstDeps) ||
    !Array.isArray(path) ||
    !(firstAfter === null || typeof firstAfter === 'string') ||
    typeof text !== 'string' ||
    !Number.isSafeInteger(count)
  ) {
    throw new TypeError('invalid compact CRDT joined text run');
  }
  const runCount = count as number;
  if (runCount < 0) throw new TypeError('invalid compact CRDT joined text run');

  const chars = stringCodePoints(text);
  if (chars.length !== runCount) throw new TypeError('invalid compact CRDT joined text run length');
  const runStartSeq = startSeq as number;
  const runDeps = firstDeps as string[];
  const runPath = path as JsonPath;
  if (runCount !== 0) {
    ops[ops.length] = { type: 'textRun', id: `${actor}:${runStartSeq}`, actor, seq: runStartSeq, deps: runDeps, path: runPath, after: firstAfter as string | null, text, count: runCount };
  }
}

function appendExpandedTextInsertRun(
  ops: CrdtOperation[],
  actor: string,
  startSeq: number,
  firstDeps: string[],
  path: JsonPath,
  firstAfter: string | null,
  texts: string[]
): void {
  let after = firstAfter as string | null;
  for (let i = 0, length = texts.length; i < length; i++) {
    const seq = startSeq + i;
    const id = `${actor}:${seq}`;
    const deps = i === 0 ? firstDeps : [`${actor}:${seq - 1}`];
    const text = texts[i];
    ops[ops.length] = { type: 'textInsert', id, actor, seq, deps, path, after, text };
    after = `${id}/${codePointLength(text) - 1}`;
  }
}

function appendDecodedListRun(ops: CrdtOperation[], item: unknown[], actor: string): void {
  const hasActor = typeof item[1] === 'string';
  const runActor = hasActor ? item[1] : actor;
  const startSeq = hasActor ? item[2] : item[1];
  const firstDeps = hasActor ? item[3] : item[2];
  const path = hasActor ? item[4] : item[3];
  const firstAfter = hasActor ? item[5] : item[4];
  const values = hasActor ? item[6] : item[5];
  const counts = hasActor ? item[7] : item[6];
  if (
    typeof runActor !== 'string' ||
    !Number.isSafeInteger(startSeq) ||
    !Array.isArray(firstDeps) ||
    !Array.isArray(path) ||
    !(firstAfter === null || typeof firstAfter === 'string') ||
    !Array.isArray(values) ||
    !(counts === undefined || Array.isArray(counts))
  ) {
    throw new TypeError('invalid compact CRDT list run');
  }

  const runStartSeq = startSeq as number;
  const runDeps = firstDeps as string[];
  const runPath = path as JsonPath;
  const runValues = values as JsonValue[];
  const runCounts = counts as number[] | undefined;
  const opCount = runCounts === undefined ? runValues.length : runCounts.length;
  if (runCounts === undefined) {
    if (runValues.length !== 0) {
      ops[ops.length] = { type: 'listRun', id: `${runActor}:${runStartSeq}`, actor: runActor, seq: runStartSeq, deps: runDeps, path: runPath, after: firstAfter as string | null, values: runValues, count: runValues.length };
    }
    return;
  }
  let after = firstAfter as string | null;
  let valueOffset = 0;
  for (let i = 0; i < opCount; i++) {
    const count = runCounts === undefined ? 1 : runCounts[i];
    if (!Number.isSafeInteger(count) || count <= 0 || valueOffset + count > runValues.length) {
      throw new TypeError('invalid compact CRDT list run count');
    }
    const seq = runStartSeq + i;
    const id = `${runActor}:${seq}`;
    const deps = i === 0 ? runDeps : [`${runActor}:${seq - 1}`];
    const opValues = runValues.slice(valueOffset, valueOffset + count);
    ops[ops.length] = { type: 'listInsert', id, actor: runActor, seq, deps, path: runPath, after, values: opValues };
    after = `${id}/${count - 1}`;
    valueOffset += count;
  }
  if (valueOffset !== runValues.length) throw new TypeError('invalid compact CRDT list run values');
}

function appendDecodedMapSetRun(ops: CrdtOperation[], item: unknown[], actor: string): void {
  const hasActor = typeof item[1] === 'string';
  const runActor = hasActor ? item[1] : actor;
  const startSeq = hasActor ? item[2] : item[1];
  const firstDeps = hasActor ? item[3] : item[2];
  const parentPath = hasActor ? item[4] : item[3];
  const keys = hasActor ? item[5] : item[4];
  const values = hasActor ? item[6] : item[5];
  if (
    typeof runActor !== 'string' ||
    !Number.isSafeInteger(startSeq) ||
    !Array.isArray(firstDeps) ||
    !Array.isArray(parentPath) ||
    !Array.isArray(keys) ||
    !Array.isArray(values) ||
    keys.length !== values.length
  ) {
    throw new TypeError('invalid compact CRDT map set run');
  }

  const runStartSeq = startSeq as number;
  const runDeps = firstDeps as string[];
  const runParentPath = parentPath as JsonPath;
  const runKeys = keys as string[];
  const runValues = values as JsonValue[];
  for (let i = 0, length = runKeys.length; i < length; i++) {
    const key = keys[i];
    if (typeof key !== 'string') throw new TypeError('invalid compact CRDT map set key');
  }
  if (runKeys.length !== 0) {
    ops[ops.length] = { type: 'mapSetRun', id: `${runActor}:${runStartSeq}`, actor: runActor, seq: runStartSeq, deps: runDeps, path: runParentPath, keys: runKeys, values: runValues, count: runKeys.length };
  }
}

function textInsertRunEnd(ops: CrdtOperation[], start: number): number {
  const first = ops[start];
  if (first.type !== 'textInsert') return start + 1;
  let end = start + 1;
  let previous = first;
  while (end < ops.length) {
    const op = ops[end];
    if (
      op.type !== 'textInsert' ||
      op.actor !== first.actor ||
      op.seq !== previous.seq + 1 ||
      !samePath(op.path, first.path) ||
      op.deps.length !== 1 ||
      op.deps[0] !== previous.id ||
      !afterMatchesLastCreatedElement(op.after, previous)
    ) {
      break;
    }
    previous = op;
    end++;
  }
  return end;
}

function textOperationChainRunEnd(ops: CrdtOperation[], start: number): number {
  const first = ops[start];
  if (!isTextSequenceOperation(first)) return start + 1;
  let end = start + 1;
  let previous = first;
  let hasDelete = isTextDeleteOperation(first);
  while (end < ops.length) {
    const op = ops[end];
    if (
      !isTextSequenceOperation(op) ||
      op.actor !== first.actor ||
      op.seq !== operationEndSeq(previous) + 1 ||
      !samePath(op.path, first.path) ||
      op.deps.length !== 1 ||
      op.deps[0] !== operationHeadId(previous)
    ) {
      break;
    }
    if (isTextDeleteOperation(op)) hasDelete = true;
    if (!hasDelete && end - start >= 16) return start + 1;
    previous = op;
    end++;
  }
  return hasDelete ? end : start + 1;
}

function createOptimizedScheduledTextEncodingCandidate(
  ops: CrdtOperation[],
  start: number
): CrdtScheduledTextEncodingCandidate | null {
  let cache = scheduledTextCandidateCache.get(ops);
  if (cache !== undefined && cache.has(start)) return cache.get(start) || null;
  const candidate = computeOptimizedScheduledTextEncodingCandidate(ops, start);
  if (cache === undefined) {
    cache = new Map<number, CrdtScheduledTextEncodingCandidate | null>();
    scheduledTextCandidateCache.set(ops, cache);
  }
  cache.set(start, candidate);
  return candidate;
}

function computeOptimizedScheduledTextEncodingCandidate(
  ops: CrdtOperation[],
  start: number
): CrdtScheduledTextEncodingCandidate | null {
  const collected = collectScheduledTextCandidateOps(ops, start);
  if (collected === null) return null;
  const fallbackBytes = estimateBinaryOperationRangeBytes(ops, start, collected.originalEnd);
  let best = createScheduledTextEncodingCandidateForOps(collected.ops, collected.originalEnd);
  const ordered = orderTextInsertOpsByAfterChain(collected.ops);
  if (ordered !== null && !sameTextOperationOrder(collected.ops, ordered)) {
    const orderedCandidate = createScheduledTextEncodingCandidateForOps(ordered, collected.originalEnd);
    if (orderedCandidate !== null && (best === null || orderedCandidate.byteLength < best.byteLength)) {
      best = orderedCandidate;
    }
  }
  if (best === null || best.byteLength + CRDT_SCHEDULED_TEXT_CANDIDATE_MIN_SAVINGS >= fallbackBytes) return null;
  return best;
}

function collectScheduledTextCandidateOps(
  ops: CrdtOperation[],
  start: number
): { originalEnd: number; ops: CrdtOperation[] } | null {
  const first = ops[start];
  if (first.type !== 'textInsert' && first.type !== 'textRun') return null;
  const path = first.path;
  const expanded: CrdtOperation[] = [];
  let end = start;
  while (end < ops.length) {
    const op = ops[end];
    if (op.type === 'textInsert') {
      if (!samePath(op.path, path)) break;
      expanded[expanded.length] = op;
    } else if (op.type === 'textRun') {
      if (!samePath(op.path, path)) break;
      if (!expandTextRunOperationForSchedule(op, expanded)) return null;
    } else {
      break;
    }
    end++;
  }
  if (expanded.length < CRDT_ACTOR_SCHEDULE_TEXT_RUN_MIN) return null;
  return { originalEnd: end, ops: expanded };
}

function expandTextRunOperationForSchedule(
  op: Extract<CrdtOperation, { type: 'textRun' }>,
  output: CrdtOperation[]
): boolean {
  const chars = stringCodePoints(op.text);
  if (chars.length !== op.count) return false;
  for (let i = 0; i < op.count; i++) {
    const seq = op.seq + i;
    const id = `${op.actor}:${seq}`;
    output[output.length] = {
      type: 'textInsert',
      id,
      actor: op.actor,
      seq,
      deps: i === 0 ? op.deps : [`${op.actor}:${seq - 1}`],
      path: op.path,
      after: i === 0 ? op.after : `${op.actor}:${seq - 1}/0`,
      text: chars[i]
    };
  }
  return true;
}

function createScheduledTextEncodingCandidateForOps(
  textOps: CrdtOperation[],
  originalEnd: number
): CrdtScheduledTextEncodingCandidate | null {
  let best: CrdtScheduledTextEncodingCandidate | null = null;
  if (textOps.length >= CRDT_ACTOR_SCHEDULE_TEXT_RUN_MIN) {
    const cyclicSchedule = createCyclicActorSchedule(textOps, 0, textOps.length);
    if (cyclicSchedule !== null && cyclicSchedule.actors.length > 1) {
      best = {
        kind: 'cycle',
        originalEnd,
        ops: textOps,
        schedule: cyclicSchedule,
        byteLength: measureScheduledTextEncodingCandidateBytes('cycle', textOps, cyclicSchedule)
      };
    }
  }
  if (textOps.length >= CRDT_ACTOR_GRAMMAR_TEXT_RUN_MIN && hasRepeatedActorPairPrefix(textOps, 0, textOps.length)) {
    const grammarSchedule = createPairGrammarActorSchedule(textOps, 0, textOps.length);
    if (grammarSchedule !== null) {
      const grammarCandidate: CrdtScheduledTextEncodingCandidate = {
        kind: 'grammar',
        originalEnd,
        ops: textOps,
        schedule: grammarSchedule,
        byteLength: measureScheduledTextEncodingCandidateBytes('grammar', textOps, grammarSchedule)
      };
      if (best === null || grammarCandidate.byteLength < best.byteLength) best = grammarCandidate;
    }
  }
  return best;
}

function measureScheduledTextEncodingCandidateBytes(
  kind: 'cycle' | 'grammar',
  textOps: CrdtOperation[],
  schedule: CrdtActorSchedule | CrdtActorGrammarSchedule
): number {
  const writer = new CrdtBinaryWriter();
  if (kind === 'cycle') {
    writeBinaryScheduledTextInsertRun(writer, textOps, 0, textOps.length, schedule as CrdtActorSchedule);
  } else {
    writeBinaryScheduledTextInsertGrammarRun(writer, textOps, 0, textOps.length, schedule as CrdtActorGrammarSchedule);
  }
  return writer.finish().byteLength;
}

function estimateBinaryOperationRangeBytes(ops: CrdtOperation[], start: number, end: number): number {
  const writer = new CrdtBinaryWriter();
  for (let i = start; i < end; i++) writeBinaryOperation(writer, ops[i]);
  return writer.finish().byteLength;
}

function orderTextInsertOpsByAfterChain(ops: CrdtOperation[]): CrdtOperation[] | null {
  const tailToIndex = new Map<string, number>();
  for (let i = 0, length = ops.length; i < length; i++) {
    const op = ops[i];
    if (op.type !== 'textInsert') return null;
    const tail = createdTextInsertTailElementId(op);
    if (tailToIndex.has(tail)) return null;
    tailToIndex.set(tail, i);
  }

  const nextByTail = new Map<string, number>();
  let root = -1;
  for (let i = 0, length = ops.length; i < length; i++) {
    const op = ops[i] as Extract<CrdtOperation, { type: 'textInsert' }>;
    if (op.after !== null && tailToIndex.has(op.after)) {
      if (nextByTail.has(op.after)) return null;
      nextByTail.set(op.after, i);
    } else {
      if (root !== -1) return null;
      root = i;
    }
  }
  if (root === -1) return null;

  const ordered: CrdtOperation[] = [];
  const visited = new Uint8Array(ops.length);
  let index: number | undefined = root;
  while (index !== undefined) {
    if (visited[index] !== 0) return null;
    visited[index] = 1;
    const op = ops[index];
    ordered[ordered.length] = op;
    index = nextByTail.get(createdTextInsertTailElementId(op as Extract<CrdtOperation, { type: 'textInsert' }>));
  }
  return ordered.length === ops.length ? ordered : null;
}

function createdTextInsertTailElementId(op: Extract<CrdtOperation, { type: 'textInsert' }>): string {
  return createdElementId(op, codePointLength(op.text) - 1);
}

function sameTextOperationOrder(left: CrdtOperation[], right: CrdtOperation[]): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0, length = left.length; i < length; i++) {
    if (left[i].id !== right[i].id) return false;
  }
  return true;
}

function hasRepeatedActorPairPrefix(ops: CrdtOperation[], start: number, end: number): boolean {
  const actorToIndex = new Map<string, number>();
  const pairCounts = new Map<string, number>();
  let previous = -1;
  for (let i = start; i < end; i++) {
    const op = ops[i];
    if (op.type !== 'textInsert') return false;
    let actorIndex = actorToIndex.get(op.actor);
    if (actorIndex === undefined) {
      actorIndex = actorToIndex.size;
      actorToIndex.set(op.actor, actorIndex);
    }
    if (previous >= 0) {
      const key = `${previous},${actorIndex}`;
      const count = (pairCounts.get(key) || 0) + 1;
      if (actorToIndex.size > 1 && count >= CRDT_ACTOR_GRAMMAR_MIN_PAIR_COUNT) return true;
      pairCounts.set(key, count);
    }
    previous = actorIndex;
  }
  return false;
}

function createPairGrammarActorSchedule(ops: CrdtOperation[], start: number, end: number): CrdtActorGrammarSchedule | null {
  const count = end - start;
  if (count < CRDT_ACTOR_GRAMMAR_TEXT_RUN_MIN) return null;
  const actors: string[] = [];
  const startSeqs: number[] = [];
  const nextSeqs: number[] = [];
  const actorIndexes = new Array<number>(count);
  const actorToIndex = new Map<string, number>();
  for (let i = start; i < end; i++) {
    const op = ops[i];
    if (op.type !== 'textInsert') return null;
    let actorIndex = actorToIndex.get(op.actor);
    if (actorIndex === undefined) {
      actorIndex = actors.length;
      actorToIndex.set(op.actor, actorIndex);
      actors[actorIndex] = op.actor;
      startSeqs[actorIndex] = op.seq;
      nextSeqs[actorIndex] = op.seq;
    }
    if (op.seq !== nextSeqs[actorIndex]) return null;
    nextSeqs[actorIndex]++;
    actorIndexes[i - start] = actorIndex;
  }
  if (actors.length < 2) return null;
  const grammar = createPairGrammarActorSymbols(actorIndexes, actors.length);
  if (grammar === null) return null;
  return {
    count,
    actors,
    startSeqs,
    rules: grammar.rules,
    symbols: grammar.symbols
  };
}

function createPairGrammarActorSymbols(
  actorIndexes: number[],
  terminalCount: number
): { rules: Array<[number, number]>; symbols: number[] } | null {
  let symbols = actorIndexes.slice();
  const rules: Array<[number, number]> = [];
  while (rules.length < CRDT_ACTOR_GRAMMAR_MAX_RULES && symbols.length >= CRDT_ACTOR_GRAMMAR_MIN_PAIR_COUNT * 2) {
    const best = mostCommonAdjacentPair(symbols);
    if (best === null || best.count < CRDT_ACTOR_GRAMMAR_MIN_PAIR_COUNT) break;
    const newSymbol = terminalCount + rules.length;
    const next: number[] = [];
    let replacements = 0;
    for (let i = 0; i < symbols.length; i++) {
      if (i + 1 < symbols.length && symbols[i] === best.left && symbols[i + 1] === best.right) {
        next[next.length] = newSymbol;
        replacements++;
        i++;
      } else {
        next[next.length] = symbols[i];
      }
    }
    if (replacements < CRDT_ACTOR_GRAMMAR_MIN_PAIR_COUNT) break;
    rules[rules.length] = [best.left, best.right];
    symbols = next;
  }
  const grammarCost = symbols.length + rules.length * 2;
  if (rules.length === 0 || grammarCost + CRDT_ACTOR_GRAMMAR_MIN_SAVINGS >= actorIndexes.length) return null;
  return { rules, symbols };
}

function mostCommonAdjacentPair(symbols: number[]): { left: number; right: number; count: number } | null {
  const counts = new Map<string, { left: number; right: number; count: number }>();
  let best: { left: number; right: number; count: number } | null = null;
  for (let i = 0, length = symbols.length - 1; i < length; i++) {
    const left = symbols[i];
    const right = symbols[i + 1];
    const key = `${left},${right}`;
    let entry = counts.get(key);
    if (entry === undefined) {
      entry = { left, right, count: 0 };
      counts.set(key, entry);
    }
    entry.count++;
    if (
      best === null ||
      entry.count > best.count ||
      (entry.count === best.count && (entry.left < best.left || (entry.left === best.left && entry.right < best.right)))
    ) {
      best = entry;
    }
  }
  return best;
}

function createCyclicActorSchedule(ops: CrdtOperation[], start: number, end: number): CrdtActorSchedule | null {
  const count = end - start;
  if (count < CRDT_ACTOR_SCHEDULE_TEXT_RUN_MIN) return null;
  const actors: string[] = [];
  const startSeqs: number[] = [];
  const lastSeqs: number[] = [];
  const actorIndexes = new Array<number>(count);
  const actorToIndex = new Map<string, number>();
  for (let i = start; i < end; i++) {
    const op = ops[i];
    let actorIndex = actorToIndex.get(op.actor);
    if (actorIndex === undefined) {
      actorIndex = actors.length;
      actorToIndex.set(op.actor, actorIndex);
      actors[actorIndex] = op.actor;
      startSeqs[actorIndex] = op.seq;
      lastSeqs[actorIndex] = op.seq;
    } else {
      if (op.seq !== lastSeqs[actorIndex] + 1) return null;
      lastSeqs[actorIndex] = op.seq;
    }
    actorIndexes[i - start] = actorIndex;
  }
  const patternLength = findPeriodicNumberPatternLength(actorIndexes, CRDT_ACTOR_SCHEDULE_MAX_PATTERN);
  if (patternLength === 0) return null;
  return {
    count,
    actors,
    startSeqs,
    pattern: actorIndexes.slice(0, patternLength)
  };
}

function findPeriodicNumberPatternLength(values: number[], maxPattern: number): number {
  if (values.length === 0) return 0;
  const limit = Math.min(maxPattern, values.length === 1 ? 1 : Math.floor(values.length / 2));
  for (let period = 1; period <= limit; period++) {
    let matches = true;
    for (let i = period, length = values.length; i < length; i++) {
      if (values[i] !== values[i % period]) {
        matches = false;
        break;
      }
    }
    if (matches) return period;
  }
  return 0;
}

function scheduledTextDepsAreChain(ops: CrdtOperation[], start: number, end: number): boolean {
  for (let i = start + 1; i < end; i++) {
    if (ops[i].deps.length !== 1 || ops[i].deps[0] !== operationHeadId(ops[i - 1])) return false;
  }
  return true;
}

function scheduledTextDepsAreSame(ops: CrdtOperation[], start: number, end: number): boolean {
  const firstDeps = ops[start].deps;
  for (let i = start + 1; i < end; i++) {
    if (!sameOperationIds(ops[i].deps, firstDeps)) return false;
  }
  return true;
}

function scheduledTextAfterIsChain(ops: CrdtOperation[], start: number, end: number): boolean {
  for (let i = start + 1; i < end; i++) {
    if (!afterMatchesLastCreatedElement((ops[i] as Extract<CrdtOperation, { type: 'textInsert' }>).after, ops[i - 1] as Extract<CrdtOperation, { type: 'textInsert' }>)) {
      return false;
    }
  }
  return true;
}

function scheduledTextAfterIsNull(ops: CrdtOperation[], start: number, end: number): boolean {
  for (let i = start; i < end; i++) {
    if ((ops[i] as Extract<CrdtOperation, { type: 'textInsert' }>).after !== null) return false;
  }
  return true;
}

function sameOperationIds(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0, length = left.length; i < length; i++) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

function compactCrdtOperationRuns(ops: CrdtOperation[]): CrdtOperation[] {
  let compacted: CrdtOperation[] | null = null;
  for (let i = 0, length = ops.length; i < length; i++) {
    const firstOp = ops[i];
    if (firstOp.type === 'textInsert' && isSingleCodePointString(firstOp.text)) {
      const textRunEnd = textInsertRunEnd(ops, i);
      if (textRunEnd - i >= 2) {
        const joined = tryJoinSingleCodePointTextRun(ops, i, textRunEnd);
        if (joined !== null) {
          if (compacted === null) compacted = ops.slice(0, i);
          const first = firstOp as Extract<CrdtOperation, { type: 'textInsert' }>;
          compacted[compacted.length] = {
            type: 'textRun',
            id: first.id,
            actor: first.actor,
            seq: first.seq,
            deps: first.deps,
            path: first.path,
            after: first.after,
            text: joined,
            count: textRunEnd - i
          };
          i = textRunEnd - 1;
          continue;
        }
      }
    } else if (firstOp.type === 'listInsert') {
      const listRunEnd = listInsertRunEnd(ops, i);
      if (listRunEnd - i >= 2 && canCompactSingleValueListRun(ops, i, listRunEnd)) {
        if (compacted === null) compacted = ops.slice(0, i);
        const first = firstOp as Extract<CrdtOperation, { type: 'listInsert' }>;
        const values = new Array<JsonValue>(listRunEnd - i);
        for (let j = i; j < listRunEnd; j++) {
          values[j - i] = (ops[j] as Extract<CrdtOperation, { type: 'listInsert' }>).values[0];
        }
        compacted[compacted.length] = {
          type: 'listRun',
          id: first.id,
          actor: first.actor,
          seq: first.seq,
          deps: first.deps,
          path: first.path,
          after: first.after,
          values,
          count: values.length
        };
        i = listRunEnd - 1;
        continue;
      }
    } else if (firstOp.type === 'set') {
      const mapRunEnd = mapSetRunEnd(ops, i);
      if (mapRunEnd - i >= 2) {
        if (compacted === null) compacted = ops.slice(0, i);
        const first = firstOp as Extract<CrdtOperation, { type: 'set' }>;
        const parentPath = first.path.slice(0, -1);
        const keys = new Array<string>(mapRunEnd - i);
        const values = new Array<JsonValue>(mapRunEnd - i);
        for (let j = i; j < mapRunEnd; j++) {
          const op = ops[j] as Extract<CrdtOperation, { type: 'set' }>;
          keys[j - i] = op.path[op.path.length - 1] as string;
          values[j - i] = op.value;
        }
        compacted[compacted.length] = {
          type: 'mapSetRun',
          id: first.id,
          actor: first.actor,
          seq: first.seq,
          deps: first.deps,
          path: parentPath,
          keys,
          values,
          count: keys.length
        };
        i = mapRunEnd - 1;
        continue;
      }
    }

    if (compacted !== null) compacted[compacted.length] = ops[i];
  }
  return compacted === null ? ops : compacted;
}

function canCompactSingleValueListRun(ops: CrdtOperation[], start: number, end: number): boolean {
  for (let i = start; i < end; i++) {
    const op = ops[i];
    if (op.type !== 'listInsert' || op.values.length !== 1) return false;
  }
  return true;
}

function listInsertRunEnd(ops: CrdtOperation[], start: number): number {
  const first = ops[start];
  if (first.type !== 'listInsert') return start + 1;
  let end = start + 1;
  let previous = first;
  while (end < ops.length) {
    const op = ops[end];
    if (
      op.type !== 'listInsert' ||
      op.actor !== first.actor ||
      op.seq !== previous.seq + 1 ||
      !samePath(op.path, first.path) ||
      op.deps.length !== 1 ||
      op.deps[0] !== previous.id ||
      !afterMatchesLastCreatedElement(op.after, previous)
    ) {
      break;
    }
    previous = op;
    end++;
  }
  return end;
}

function mapSetRunEnd(ops: CrdtOperation[], start: number): number {
  const first = ops[start];
  if (first.type !== 'set' || first.path.length === 0) return start + 1;
  const parentPath = first.path.slice(0, -1);
  if (typeof first.path[first.path.length - 1] !== 'string') return start + 1;
  let end = start + 1;
  let previous = first;
  while (end < ops.length) {
    const op = ops[end];
    if (
      op.type !== 'set' ||
      op.actor !== first.actor ||
      op.seq !== previous.seq + 1 ||
      op.path.length === 0 ||
      typeof op.path[op.path.length - 1] !== 'string' ||
      !sameParentPath(op.path, parentPath) ||
      op.deps.length !== 1 ||
      op.deps[0] !== previous.id
    ) {
      break;
    }
    previous = op;
    end++;
  }
  return end;
}

function pathShapeSetRunEnd(ops: CrdtOperation[], start: number): number {
  const first = ops[start];
  if (first.type !== 'set' || first.path.length === 0) return start + 1;
  let end = start + 1;
  let previous = first;
  while (end < ops.length) {
    const op = ops[end];
    if (
      op.type !== 'set' ||
      op.actor !== first.actor ||
      op.seq !== previous.seq + 1 ||
      op.path.length !== first.path.length ||
      !samePathSegmentTypes(op.path, first.path) ||
      op.deps.length !== 1 ||
      op.deps[0] !== previous.id
    ) {
      break;
    }
    previous = op;
    end++;
  }
  return end;
}

function samePathSegmentTypes(left: JsonPath, right: JsonPath): boolean {
  for (let i = 0, length = left.length; i < length; i++) {
    if (typeof left[i] !== typeof right[i]) return false;
  }
  return true;
}

function afterMatchesLastCreatedElement(
  after: string | null,
  op: Extract<CrdtOperation, { type: 'listInsert' | 'textInsert' }>
): boolean {
  if (after === null) return false;
  const count = op.type === 'listInsert'
    ? op.values.length
    : op.text.length === 1
      ? 1
      : codePointLength(op.text);
  const elementIndex = count - 1;
  const idLength = op.id.length;
  if (elementIndex === 0) {
    return after.length === idLength + 2 &&
      after.charCodeAt(idLength) === 47 &&
      after.charCodeAt(idLength + 1) === 48 &&
      after.startsWith(op.id);
  }
  if (after.length <= idLength + 1 || after.charCodeAt(idLength) !== 47 || !after.startsWith(op.id)) return false;
  return Number(after.slice(idLength + 1)) === elementIndex;
}

function operationSeqSpan(op: CrdtOperation): number {
  return isSpanningOperation(op) ? op.count : 1;
}

function operationEndSeq(op: CrdtOperation): number {
  return op.seq + operationSeqSpan(op) - 1;
}

function operationHeadId(op: CrdtOperation): string {
  return isSpanningOperation(op) ? `${op.actor}:${operationEndSeq(op)}` : op.id;
}

function operationHeadIdEquals(id: string, op: CrdtOperation): boolean {
  if (!isSpanningOperation(op)) return id === op.id;
  return operationIdPartsEqual(id, op.actor, operationEndSeq(op));
}

function operationElementIdEquals(id: string | null, op: CrdtOperation, index: number): boolean {
  if (id === null) return false;
  if (!isSpanningOperation(op)) return elementIdPartsEqual(id, op.actor, op.seq, index);
  return elementIdPartsEqual(id, op.actor, operationEndSeq(op), index);
}

function operationIdPartsEqual(id: string, actor: string, seq: number): boolean {
  const actorLength = actor.length;
  return id.length > actorLength + 1 &&
    id.charCodeAt(actorLength) === 58 &&
    id.startsWith(actor) &&
    Number(id.slice(actorLength + 1)) === seq;
}

function elementIdPartsEqual(id: string, actor: string, seq: number, index: number): boolean {
  const actorLength = actor.length;
  if (id.length <= actorLength + 3 || id.charCodeAt(actorLength) !== 58 || !id.startsWith(actor)) return false;
  const slash = id.indexOf('/', actorLength + 1);
  if (slash === -1) return false;
  if (index === 0) {
    if (id.length !== slash + 2 || id.charCodeAt(slash + 1) !== 48) return false;
  } else if (Number(id.slice(slash + 1)) !== index) {
    return false;
  }
  return Number(id.slice(actorLength + 1, slash)) === seq;
}

function operationContainsId(op: CrdtOperation, id: string): boolean {
  if (op.id === id) return true;
  if (!isSpanningOperation(op)) return false;
  const parsed = parseOperationId(id);
  return parsed.actor === op.actor && parsed.seq >= op.seq && parsed.seq <= operationEndSeq(op);
}

function isSpanningOperation(op: CrdtOperation): op is Extract<CrdtOperation, { type: 'textRun' | 'listRun' | 'mapSetRun' }> {
  return op.type === 'textRun' || op.type === 'listRun' || op.type === 'mapSetRun';
}

function operationsOverlap(left: CrdtOperation, right: CrdtOperation): boolean {
  return left.actor === right.actor &&
    left.seq <= operationEndSeq(right) &&
    operationEndSeq(left) >= right.seq;
}

function textInsertExtendsOperation(
  left: CrdtOperation,
  right: Extract<CrdtOperation, { type: 'textInsert' }>
): left is Extract<CrdtOperation, { type: 'textInsert' | 'textRun' }> {
  if (
    (left.type !== 'textInsert' && left.type !== 'textRun') ||
    left.actor !== right.actor ||
    right.seq !== operationEndSeq(left) + 1 ||
    !samePath(left.path, right.path) ||
    right.deps.length !== 1 ||
    !operationHeadIdEquals(right.deps[0], left)
  ) {
    return false;
  }
  if (left.type === 'textInsert' && !isSingleCodePointString(left.text)) return false;
  return operationElementIdEquals(right.after, left, 0);
}

function listInsertExtendsOperation(
  left: CrdtOperation,
  right: Extract<CrdtOperation, { type: 'listInsert' }>
): left is Extract<CrdtOperation, { type: 'listInsert' | 'listRun' }> {
  if (
    (left.type !== 'listInsert' && left.type !== 'listRun') ||
    left.actor !== right.actor ||
    right.values.length !== 1 ||
    right.seq !== operationEndSeq(left) + 1 ||
    !samePath(left.path, right.path) ||
    right.deps.length !== 1 ||
    !operationHeadIdEquals(right.deps[0], left)
  ) {
    return false;
  }
  if (left.type === 'listInsert' && left.values.length !== 1) return false;
  return operationElementIdEquals(right.after, left, 0);
}

function mapSetExtendsOperation(
  left: CrdtOperation,
  right: Extract<CrdtOperation, { type: 'set' }>
): left is Extract<CrdtOperation, { type: 'set' | 'mapSetRun' }> {
  if (right.path.length === 0 || typeof right.path[right.path.length - 1] !== 'string') return false;
  if (
    (left.type !== 'set' && left.type !== 'mapSetRun') ||
    left.actor !== right.actor ||
    right.seq !== operationEndSeq(left) + 1 ||
    right.deps.length !== 1 ||
    !operationHeadIdEquals(right.deps[0], left)
  ) {
    return false;
  }
  if (left.type === 'mapSetRun') return sameParentPath(right.path, left.path);
  return left.path.length !== 0 &&
    typeof left.path[left.path.length - 1] === 'string' &&
    sameParentPath(right.path, left.path.slice(0, -1));
}

function operationDepsForId(op: CrdtOperation, id: string): string[] {
  if (!isSpanningOperation(op)) return op.deps;
  const parsed = parseOperationId(id);
  if (parsed.actor !== op.actor || parsed.seq < op.seq || parsed.seq > operationEndSeq(op)) return op.deps;
  return parsed.seq === op.seq ? op.deps : [`${op.actor}:${parsed.seq - 1}`];
}

function markOperationReadyIds(ready: Set<string>, op: CrdtOperation): void {
  if (!isSpanningOperation(op)) {
    ready.add(op.id);
    return;
  }
  const end = operationEndSeq(op);
  for (let seq = op.seq; seq <= end; seq++) ready.add(`${op.actor}:${seq}`);
}

function createdElementId(op: CrdtOperation, index: number): string {
  return op.type === 'textRun' || op.type === 'listRun' ? `${op.actor}:${op.seq + index}/0` : `${op.id}/${index}`;
}

function isTextDeleteOperation(op: CrdtOperation): op is CrdtTextDeleteOperation {
  return op.type === 'textDel' || op.type === 'textDelRange';
}

function isTextSequenceOperation(op: CrdtOperation): boolean {
  return op.type === 'textInsert' || op.type === 'textRun' || isTextDeleteOperation(op);
}

function isTreeOperation(op: CrdtOperation): op is Extract<CrdtOperation, { type: 'treeCreate' | 'treeMove' | 'treeSet' | 'treeDel' }> {
  return op.type === 'treeCreate' || op.type === 'treeMove' || op.type === 'treeSet' || op.type === 'treeDel';
}

function isRegisterLikeOperation(op: CrdtOperation): boolean {
  return op.type === 'set' ||
    op.type === 'del' ||
    op.type === 'mapSetRun' ||
    op.type === 'counter' ||
    op.type === 'binarySet' ||
    isTreeOperation(op);
}

function textDeleteCount(op: CrdtTextDeleteOperation): number {
  return op.type === 'textDelRange' ? op.count : op.elems.length;
}

function textDeleteFirstElement(op: CrdtTextDeleteOperation): string | null {
  return op.type === 'textDelRange' ? op.start : op.elems.length === 0 ? null : op.elems[0];
}

function textDeleteSpanCode(span: 'index' | 'seq'): number {
  return span === 'seq' ? 1 : 0;
}

function textDeleteSpanFromCode(code: unknown): 'index' | 'seq' {
  if (code === 0) return 'index';
  if (code === 1) return 'seq';
  throw new TypeError('invalid CRDT text delete range span');
}

function createTextDeleteRangePayload(elems: string[]): TextDeleteRangePayload | null {
  if (elems.length <= 1) return null;
  const firstId = elems[0];
  const slash = firstId.lastIndexOf('/');
  if (slash <= 0 || slash === firstId.length - 1) return null;
  const firstIndex = Number(firstId.slice(slash + 1));
  if (!Number.isSafeInteger(firstIndex) || firstIndex < 0) return null;
  const firstOpId = firstId.slice(0, slash);

  let indexRange = true;
  for (let i = 1, length = elems.length; i < length; i++) {
    if (elems[i] !== `${firstOpId}/${firstIndex + i}`) {
      indexRange = false;
      break;
    }
  }
  if (indexRange) return { start: firstId, count: elems.length, span: 'index' };

  if (firstIndex !== 0) return null;
  const first = tryParseOperationId(firstOpId);
  if (first === null) return null;
  for (let i = 1, length = elems.length; i < length; i++) {
    if (elems[i] !== `${first.actor}:${first.seq + i}/0`) return null;
  }
  return { start: firstId, count: elems.length, span: 'seq' };
}

function createTextDeleteOperationPayloadFromElements(elems: string[]): TextDeleteOperationPayload | null {
  if (elems.length === 0) return null;
  const range = createTextDeleteRangePayload(elems);
  return range === null
    ? { type: 'textDel', elems, count: elems.length }
    : { type: 'textDelRange', range, count: elems.length };
}

function createTextDeleteOperationPayloadFromSequence(
  sequence: TextSequence,
  index: number,
  count: number,
  preferRange = true
): TextDeleteOperationPayload | null {
  if (count <= 0 || index >= sequence.length) return null;
  const actualCount = Math.min(count, sequence.length - index);
  if (actualCount <= 0) return null;
  if (actualCount === 1) {
    const elem = sequence.at(index);
    return elem === null ? null : { type: 'textDel', elems: [elem], count: 1 };
  }
  if (preferRange) {
    const range = createTextDeleteRangePayloadFromSequence(sequence, index, actualCount);
    if (range !== null) return { type: 'textDelRange', range, count: actualCount };
  }
  const elems = sequence.slice(index, actualCount);
  return elems.length === 0 ? null : { type: 'textDel', elems, count: elems.length };
}

function createTextDeleteRangePayloadFromSequence(
  sequence: TextSequence,
  index: number,
  count: number
): TextDeleteRangePayload | null {
  return sequence.textDeleteRangePayload(index, count);
}

function textDeleteRangeElementAt(op: Extract<CrdtOperation, { type: 'textDelRange' }>, offset: number): string | null {
  const parsed = parseTextElementId(op.start);
  if (parsed === null) return offset === 0 ? op.start : null;
  if (op.span === 'seq') return `${parsed.actor}:${parsed.seq + offset}/0`;
  return `${parsed.opId}/${parsed.index + offset}`;
}

function textDeleteRangeEqualsAt(values: { at(index: number): string | null }, index: number, op: Extract<CrdtOperation, { type: 'textDelRange' }>): boolean {
  const parsed = parseTextElementId(op.start);
  if (parsed === null) return op.count === 1 && values.at(index) === op.start;
  for (let i = 0; i < op.count; i++) {
    const value = values.at(index + i);
    if (value === null || !textElementIdMatchesRange(value, parsed, i, op.span)) return false;
  }
  return true;
}

function textDeleteArrayRangeEqualsAt(values: string[], index: number, op: Extract<CrdtOperation, { type: 'textDelRange' }>): boolean {
  const parsed = parseTextElementId(op.start);
  if (parsed === null) return op.count === 1 && values[index] === op.start;
  for (let i = 0; i < op.count; i++) {
    const value = values[index + i];
    if (value === undefined || !textElementIdMatchesRange(value, parsed, i, op.span)) return false;
  }
  return true;
}

function textDeleteIndexRange(visible: string[], op: CrdtTextDeleteOperation): { index: number; count: number } | null {
  if (op.type === 'textDel') {
    if (op.elems.length === 0) return null;
    const indexes = elementIndexes(visible, op.elems);
    return indexes === null || indexes.length === 0 ? null : { index: indexes[0], count: indexes.length };
  }
  if (op.count <= 0) return null;
  const index = visible.indexOf(op.start);
  if (index === -1 || index + op.count > visible.length) return null;
  return textDeleteArrayRangeEqualsAt(visible, index, op) ? { index, count: op.count } : null;
}

function sequenceTextDeleteRange(sequence: TextSequence, op: CrdtTextDeleteOperation): { index: number; count: number } | null {
  const first = textDeleteFirstElement(op);
  if (first === null) return null;
  const index = sequence.indexOf(first);
  if (index === -1) return null;
  const count = textDeleteCount(op);
  if (index + count > sequence.length) return null;
  if (op.type === 'textDelRange') {
    return sequence.textDeleteRangeEquals(index, op) ? { index, count } : null;
  }
  return sequenceSliceEquals(sequence, index, op.elems) ? { index, count } : null;
}

function addTextDeleteElementsToSet(target: Set<string>, op: CrdtTextDeleteOperation): void {
  if (op.type === 'textDel') {
    for (let i = 0, count = op.elems.length; i < count; i++) target.add(op.elems[i]);
    return;
  }
  for (let i = 0; i < op.count; i++) {
    const id = textDeleteRangeElementAt(op, i);
    if (id !== null) target.add(id);
  }
}

function textRunSuffix(op: Extract<CrdtOperation, { type: 'textRun' }>, startSeq: number): CrdtOperation | null {
  const endSeq = operationEndSeq(op);
  if (startSeq > endSeq) return null;
  const offset = startSeq - op.seq;
  if (offset <= 0) return op;
  const chars = stringCodePoints(op.text);
  const text = chars.slice(offset).join('');
  const count = endSeq - startSeq + 1;
  const deps = [`${op.actor}:${startSeq - 1}`];
  const after = `${op.actor}:${startSeq - 1}/0`;
  const id = `${op.actor}:${startSeq}`;
  return count === 1
    ? { type: 'textInsert', id, actor: op.actor, seq: startSeq, deps, path: op.path, after, text }
    : { type: 'textRun', id, actor: op.actor, seq: startSeq, deps, path: op.path, after, text, count };
}

function listRunSuffix(op: Extract<CrdtOperation, { type: 'listRun' }>, startSeq: number): CrdtOperation | null {
  const endSeq = operationEndSeq(op);
  if (startSeq > endSeq) return null;
  const offset = startSeq - op.seq;
  if (offset <= 0) return op;
  const values = op.values.slice(offset);
  const count = endSeq - startSeq + 1;
  const deps = [`${op.actor}:${startSeq - 1}`];
  const after = `${op.actor}:${startSeq - 1}/0`;
  const id = `${op.actor}:${startSeq}`;
  return count === 1
    ? { type: 'listInsert', id, actor: op.actor, seq: startSeq, deps, path: op.path, after, values }
    : { type: 'listRun', id, actor: op.actor, seq: startSeq, deps, path: op.path, after, values, count };
}

function mapSetRunSuffix(op: Extract<CrdtOperation, { type: 'mapSetRun' }>, startSeq: number): CrdtOperation | null {
  const endSeq = operationEndSeq(op);
  if (startSeq > endSeq) return null;
  const offset = startSeq - op.seq;
  if (offset <= 0) return op;
  const keys = op.keys.slice(offset);
  const values = op.values.slice(offset);
  const count = endSeq - startSeq + 1;
  const deps = [`${op.actor}:${startSeq - 1}`];
  const id = `${op.actor}:${startSeq}`;
  return count === 1
    ? { type: 'set', id, actor: op.actor, seq: startSeq, deps, path: op.path.concat(keys[0]), value: values[0] }
    : { type: 'mapSetRun', id, actor: op.actor, seq: startSeq, deps, path: op.path, keys, values, count };
}

function operationSuffix(op: CrdtOperation, startSeq: number): CrdtOperation | null {
  if (op.type === 'textRun') return textRunSuffix(op, startSeq);
  if (op.type === 'listRun') return listRunSuffix(op, startSeq);
  if (op.type === 'mapSetRun') return mapSetRunSuffix(op, startSeq);
  return op.seq >= startSeq ? op : null;
}

function textRunPrefix(op: Extract<CrdtOperation, { type: 'textRun' }>, endSeq: number): CrdtOperation | null {
  if (endSeq < op.seq) return null;
  const count = Math.min(endSeq, operationEndSeq(op)) - op.seq + 1;
  if (count >= op.count) return op;
  const text = stringCodePoints(op.text).slice(0, count).join('');
  return count === 1
    ? { type: 'textInsert', id: op.id, actor: op.actor, seq: op.seq, deps: op.deps, path: op.path, after: op.after, text }
    : { type: 'textRun', id: op.id, actor: op.actor, seq: op.seq, deps: op.deps, path: op.path, after: op.after, text, count };
}

function listRunPrefix(op: Extract<CrdtOperation, { type: 'listRun' }>, endSeq: number): CrdtOperation | null {
  if (endSeq < op.seq) return null;
  const count = Math.min(endSeq, operationEndSeq(op)) - op.seq + 1;
  if (count >= op.count) return op;
  const values = op.values.slice(0, count);
  return count === 1
    ? { type: 'listInsert', id: op.id, actor: op.actor, seq: op.seq, deps: op.deps, path: op.path, after: op.after, values }
    : { type: 'listRun', id: op.id, actor: op.actor, seq: op.seq, deps: op.deps, path: op.path, after: op.after, values, count };
}

function mapSetRunPrefix(op: Extract<CrdtOperation, { type: 'mapSetRun' }>, endSeq: number): CrdtOperation | null {
  if (endSeq < op.seq) return null;
  const count = Math.min(endSeq, operationEndSeq(op)) - op.seq + 1;
  if (count >= op.count) return op;
  const keys = op.keys.slice(0, count);
  const values = op.values.slice(0, count);
  return count === 1
    ? { type: 'set', id: op.id, actor: op.actor, seq: op.seq, deps: op.deps, path: op.path.concat(keys[0]), value: values[0] }
    : { type: 'mapSetRun', id: op.id, actor: op.actor, seq: op.seq, deps: op.deps, path: op.path, keys, values, count };
}

function operationPrefix(op: CrdtOperation, endSeq: number): CrdtOperation | null {
  if (op.type === 'textRun') return textRunPrefix(op, endSeq);
  if (op.type === 'listRun') return listRunPrefix(op, endSeq);
  if (op.type === 'mapSetRun') return mapSetRunPrefix(op, endSeq);
  return op.seq <= endSeq ? op : null;
}

function findWantedOperationHeadInOperation(
  op: CrdtOperation,
  wanted: Set<string>,
  included: Set<string>
): string | null {
  if (!isSpanningOperation(op)) {
    return wanted.has(op.id) && !included.has(op.id) ? op.id : null;
  }
  let best: string | null = null;
  let bestSeq = 0;
  wanted.forEach((id) => {
    if (included.has(id)) return;
    const parsed = tryParseOperationId(id);
    if (parsed === null) return;
    if (parsed.actor !== op.actor || parsed.seq < op.seq || parsed.seq > operationEndSeq(op)) return;
    if (parsed.seq > bestSeq) {
      best = id;
      bestSeq = parsed.seq;
    }
  });
  return best;
}

function expandTextRunOperation(op: Extract<CrdtOperation, { type: 'textRun' }>): CrdtOperation[] {
  const chars = stringCodePoints(op.text);
  const ops = new Array<CrdtOperation>(chars.length);
  for (let i = 0, length = chars.length; i < length; i++) {
    const seq = op.seq + i;
    const id = `${op.actor}:${seq}`;
    ops[i] = {
      type: 'textInsert',
      id,
      actor: op.actor,
      seq,
      deps: i === 0 ? op.deps : [`${op.actor}:${seq - 1}`],
      path: op.path,
      after: i === 0 ? op.after : `${op.actor}:${seq - 1}/0`,
      text: chars[i]
    };
  }
  return ops;
}

function expandListRunOperation(op: Extract<CrdtOperation, { type: 'listRun' }>): CrdtOperation[] {
  const ops = new Array<CrdtOperation>(op.values.length);
  for (let i = 0, length = op.values.length; i < length; i++) {
    const seq = op.seq + i;
    const id = `${op.actor}:${seq}`;
    ops[i] = {
      type: 'listInsert',
      id,
      actor: op.actor,
      seq,
      deps: i === 0 ? op.deps : [`${op.actor}:${seq - 1}`],
      path: op.path,
      after: i === 0 ? op.after : `${op.actor}:${seq - 1}/0`,
      values: [op.values[i]]
    };
  }
  return ops;
}

function expandMapSetRunOperation(op: Extract<CrdtOperation, { type: 'mapSetRun' }>): CrdtOperation[] {
  const ops = new Array<CrdtOperation>(op.keys.length);
  for (let i = 0, length = op.keys.length; i < length; i++) {
    const seq = op.seq + i;
    const id = `${op.actor}:${seq}`;
    ops[i] = {
      type: 'set',
      id,
      actor: op.actor,
      seq,
      deps: i === 0 ? op.deps : [`${op.actor}:${seq - 1}`],
      path: op.path.concat(op.keys[i]),
      value: op.values[i]
    };
  }
  return ops;
}

function expandSpanningOperation(op: Extract<CrdtOperation, { type: 'textRun' | 'listRun' | 'mapSetRun' }>): CrdtOperation[] {
  if (op.type === 'textRun') return expandTextRunOperation(op);
  if (op.type === 'listRun') return expandListRunOperation(op);
  return expandMapSetRunOperation(op);
}

function createCrdtAdaptiveProfileState(options?: CrdtDocumentOptions): CrdtAdaptiveProfileState {
  const profileState = readCrdtProfile(options && options.profile);
  const enabled = options && options.adaptive !== undefined
    ? options.adaptive
    : profileState.enabled;
  if (typeof enabled !== 'boolean') throw new TypeError('adaptive option must be a boolean');
  return {
    enabled,
    plans: profileState.plans,
    textProfiles: profileState.textProfiles,
    textStats: new Map()
  };
}

function readCrdtProfile(profile?: CrdtProfile | null): { enabled: boolean; plans: ProfilePlans | undefined; textProfiles: Map<string, CrdtTextProfilePlan> } {
  const textProfiles = new Map<string, CrdtTextProfilePlan>();
  if (profile === undefined || profile === null) return { enabled: true, plans: undefined, textProfiles };
  if (typeof profile !== 'object' || Array.isArray(profile)) throw new TypeError('CRDT profile must be an object');
  if (profile.version !== undefined && profile.version !== CRDT_PROFILE_VERSION) {
    throw new TypeError('unsupported CRDT profile version: ' + profile.version);
  }
  const settings = profile.settings;
  if (settings !== undefined && (settings === null || typeof settings !== 'object' || Array.isArray(settings))) {
    throw new TypeError('CRDT profile settings must be an object');
  }
  const enabled = settings && settings.adaptive !== undefined ? settings.adaptive : true;
  if (typeof enabled !== 'boolean') throw new TypeError('CRDT profile adaptive setting must be a boolean');
  if (profile.text !== undefined) {
    if (!Array.isArray(profile.text)) throw new TypeError('CRDT profile text entries must be an array');
    for (let i = 0, length = profile.text.length; i < length; i++) {
      const plan = readCrdtTextProfile(profile.text[i], i);
      textProfiles.set(pathKey(plan.path), plan);
    }
  }
  return { enabled, plans: readProfilePlans(profile, 'CRDT profile'), textProfiles };
}

function readCrdtTextProfile(profile: CrdtTextProfile, index: number): CrdtTextProfilePlan {
  if (profile === null || typeof profile !== 'object' || Array.isArray(profile)) {
    throw new TypeError('CRDT text profile at index ' + index + ' must be an object');
  }
  const path = readCrdtProfilePath(profile.path, 'CRDT text profile path');
  if (profile.workload !== 'positional-text') {
    throw new TypeError('CRDT text profile workload must be "positional-text"');
  }
  const strategy = profile.strategy === undefined ? 'direct-splice' : profile.strategy;
  if (strategy !== 'direct-splice' && strategy !== 'batch-splice') {
    throw new TypeError('CRDT text profile strategy must be "direct-splice" or "batch-splice"');
  }
  const transactions = readOptionalNonNegativeInteger(profile.transactions, 'CRDT text profile transactions') || 0;
  const operations = readOptionalNonNegativeInteger(profile.operations, 'CRDT text profile operations') || 0;
  const maxBatchSize = readOptionalNonNegativeInteger(profile.maxBatchSize, 'CRDT text profile maxBatchSize') || 0;
  const averageBatchSize = readOptionalNonNegativeNumber(profile.averageBatchSize, 'CRDT text profile averageBatchSize') ||
    (transactions === 0 ? 0 : operations / transactions);
  const routeIndexThreshold = readOptionalPositiveInteger(
    profile.routeIndexThreshold,
    'CRDT text profile routeIndexThreshold'
  ) || readDefaultCrdtTextRouteIndexThreshold(strategy);

  return {
    path,
    workload: 'positional-text',
    strategy,
    averageBatchSize,
    maxBatchSize,
    transactions,
    operations,
    routeIndexThreshold
  };
}

function createCrdtProfileSnapshot(state: CrdtAdaptiveProfileState): CrdtProfile {
  const text = Array.from(state.textProfiles.values()).map(writeCrdtTextProfile);
  text.sort((left, right) => compareProfilePath(left.path, right.path));
  const profile: CrdtProfile = {
    version: CRDT_PROFILE_VERSION as 1,
    settings: { adaptive: state.enabled }
  };
  if (text.length !== 0) profile.text = text;
  const plans = createCrdtProfilePlansSnapshot(state.plans, text.length);
  if (plans !== undefined) profile.plans = plans;
  return profile;
}

function writeCrdtTextProfile(plan: CrdtTextProfilePlan): CrdtTextProfile {
  return {
    path: plan.path.slice(),
    workload: plan.workload,
    strategy: plan.strategy,
    averageBatchSize: Math.round(plan.averageBatchSize * 1000) / 1000,
    maxBatchSize: plan.maxBatchSize,
    transactions: plan.transactions,
    operations: plan.operations,
    routeIndexThreshold: plan.routeIndexThreshold
  };
}

function observeCrdtTextTransactionShape(
  state: CrdtAdaptiveProfileState,
  spans: TextDirtySpan[] | null | undefined
): void {
  if (!state.enabled || spans === null || spans === undefined || spans.length === 0) return;
  const firstPath = spans[0].path;
  const firstKey = pathKey(firstPath);
  let singlePath = true;
  for (let i = 1, length = spans.length; i < length; i++) {
    const path = spans[i].path;
    if (path !== firstPath && !samePath(path, firstPath)) {
      singlePath = false;
      break;
    }
  }
  if (singlePath) {
    if (state.textProfiles.has(firstKey)) return;
    let stats = state.textStats.get(firstKey);
    if (stats === undefined) {
      stats = {
        path: firstPath.slice(),
        transactions: 0,
        operations: 0,
        maxBatchSize: 0,
        insertOnly: 0,
        deleteOnly: 0,
        replace: 0,
        totalInsertCodePoints: 0,
        totalDeleteCount: 0
      };
      state.textStats.set(firstKey, stats);
    }
    stats.transactions++;
    stats.operations += spans.length;
    if (spans.length > stats.maxBatchSize) stats.maxBatchSize = spans.length;
    for (let i = 0, length = spans.length; i < length; i++) {
      const span = spans[i];
      const insertCount = codePointLength(span.insert);
      stats.totalInsertCodePoints += insertCount;
      stats.totalDeleteCount += span.deleteCount;
      if (span.deleteCount === 0 && insertCount !== 0) stats.insertOnly++;
      else if (span.deleteCount !== 0 && insertCount === 0) stats.deleteOnly++;
      else stats.replace++;
    }
    maybeLearnCrdtTextProfile(state, firstKey, stats);
    return;
  }
  let allProfiled = true;
  for (let i = 0, length = spans.length; i < length; i++) {
    if (!state.textProfiles.has(pathKey(spans[i].path))) {
      allProfiled = false;
      break;
    }
  }
  if (allProfiled) return;
  const grouped = new Map<string, { path: JsonPath; spans: TextDirtySpan[] }>();
  for (let i = 0, length = spans.length; i < length; i++) {
    const span = spans[i];
    const key = pathKey(span.path);
    let entry = grouped.get(key);
    if (entry === undefined) {
      entry = { path: span.path.slice(), spans: [] };
      grouped.set(key, entry);
    }
    entry.spans[entry.spans.length] = span;
  }
  grouped.forEach((entry, key) => {
    if (state.textProfiles.has(key)) return;
    let stats = state.textStats.get(key);
    if (stats === undefined) {
      stats = {
        path: entry.path.slice(),
        transactions: 0,
        operations: 0,
        maxBatchSize: 0,
        insertOnly: 0,
        deleteOnly: 0,
        replace: 0,
        totalInsertCodePoints: 0,
        totalDeleteCount: 0
      };
      state.textStats.set(key, stats);
    }
    stats.transactions++;
    stats.operations += entry.spans.length;
    if (entry.spans.length > stats.maxBatchSize) stats.maxBatchSize = entry.spans.length;
    for (let i = 0, length = entry.spans.length; i < length; i++) {
      const span = entry.spans[i];
      const insertCount = codePointLength(span.insert);
      stats.totalInsertCodePoints += insertCount;
      stats.totalDeleteCount += span.deleteCount;
      if (span.deleteCount === 0 && insertCount !== 0) stats.insertOnly++;
      else if (span.deleteCount !== 0 && insertCount === 0) stats.deleteOnly++;
      else stats.replace++;
    }
    maybeLearnCrdtTextProfile(state, key, stats);
  });
}

function maybeLearnCrdtTextProfile(
  state: CrdtAdaptiveProfileState,
  key: string,
  stats: CrdtTextProfileStats
): void {
  if (stats.transactions < CRDT_TEXT_PROFILE_MIN_TRANSACTIONS) return;
  const averageBatchSize = stats.operations / stats.transactions;
  const strategy = averageBatchSize >= CRDT_TEXT_PROFILE_BATCH_MIN || stats.maxBatchSize > 1
    ? 'batch-splice'
    : 'direct-splice';
  const plan: CrdtTextProfilePlan = {
    path: stats.path.slice(),
    workload: 'positional-text',
    strategy,
    averageBatchSize,
    maxBatchSize: stats.maxBatchSize,
    transactions: stats.transactions,
    operations: stats.operations,
    routeIndexThreshold: readDefaultCrdtTextRouteIndexThreshold(strategy)
  };
  state.textProfiles.set(key, plan);
}

function readDefaultCrdtTextRouteIndexThreshold(strategy: 'direct-splice' | 'batch-splice'): number {
  return strategy === 'batch-splice'
    ? CRDT_TEXT_PROFILE_BATCH_ROUTE_INDEX_THRESHOLD
    : CRDT_TEXT_PROFILE_DEFAULT_ROUTE_INDEX_THRESHOLD;
}

function readCrdtProfilePath(path: JsonPath | undefined, name: string): JsonPath {
  if (!Array.isArray(path)) throw new TypeError(name + ' must be an array');
  const out = new Array(path.length);
  for (let i = 0, length = path.length; i < length; i++) {
    const segment = path[i];
    if (typeof segment !== 'string' && typeof segment !== 'number') {
      throw new TypeError(name + ' segments must be strings or numbers');
    }
    out[i] = segment;
  }
  return out;
}

function readOptionalNonNegativeInteger(value: number | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(name + ' must be a non-negative safe integer');
  return value;
}

function readOptionalPositiveInteger(value: number | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(name + ' must be a positive safe integer');
  return value;
}

function readOptionalNonNegativeNumber(value: number | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError(name + ' must be a non-negative finite number');
  }
  return value;
}

function stateVectorIsEmpty(stateVector?: CrdtStateVector | null): boolean {
  if (stateVector === undefined || stateVector === null) return true;
  for (const actor in stateVector) return false;
  return true;
}

function compareProfilePath(left: JsonPath, right: JsonPath): number {
  const length = left.length < right.length ? left.length : right.length;
  for (let i = 0; i < length; i++) {
    const a = String(left[i]);
    const b = String(right[i]);
    if (a < b) return -1;
    if (a > b) return 1;
  }
  return left.length - right.length;
}

class FrontierCrdtDocument implements CrdtDocument {
  readonly actorId: string;
  private readonly actorIdPrefix: string;
  private readonly encodedActor: string;
  private nextSeq: number;
  private readonly operations = new Map<string, CrdtOperation>();
  private readonly operationLog: CrdtOperation[] = [];
  private readonly commitMetadata = new Map<string, JsonObject>();
  private readonly commitMetadataHeadByOperation = new Map<string, string>();
  private readonly versionMarks = new Map<string, CrdtVersionMark>();
  private readonly spanningOperations: Array<Extract<CrdtOperation, { type: 'textRun' | 'listRun' | 'mapSetRun' }>> = [];
  private readonly operationRangesByActor = new Map<string, Array<[number, number]>>();
  private operationLogSorted = true;
  private readonly sequenceVisibleCache = new Map<string, string[]>();
  private readonly textSequenceCache = new Map<string, TextSequence>();
  private readonly textValueCache = new Map<string, { path: JsonPath; value: ChunkedTextValue }>();
  private readonly sequenceAppendCache = new Map<string, SequenceAppendState>();
  private nativeTextLog: NativePositionalTextLog | null = null;
  private readyHeadsCache: string[] | null = null;
  private allReadyCache: boolean | null = null;
  private stateVectorCache: CrdtStateVector | null = null;
  private observedLocalUpdateReads = 0;
  private readonly mapHandleCache = new Map<string, CrdtMapHandle>();
  private readonly counterHandleCache = new Map<string, CrdtCounterHandle>();
  private readonly binaryHandleCache = new Map<string, CrdtBinaryHandle>();
  private readonly listHandleCache = new Map<string, CrdtListHandle>();
  private readonly textHandleCache = new Map<string, CrdtTextHandle>();
  private readonly treeHandleCache = new Map<string, CrdtTreeHandle>();
  private readonly xmlHandleCache = new Map<string, CrdtXmlHandle>();
  private readonly richTextHandleCache = new Map<string, CrdtRichTextHandle>();
  private crdtProfile: CrdtAdaptiveProfileState;
  private viewValue: JsonValue;

  constructor(options?: CrdtDocumentOptions) {
    const actorId = options && options.actorId ? options.actorId : createActorId();
    if (actorId.length === 0 || actorId.includes(':') || actorId.includes('/')) {
      throw new TypeError('actorId must be non-empty and must not contain ":" or "/"');
    }
    this.actorId = actorId;
    this.actorIdPrefix = actorId + ':';
    this.encodedActor = JSON.stringify(actorId);
    this.nextSeq = 1;
    this.crdtProfile = createCrdtAdaptiveProfileState(options);
    this.viewValue = options && options.initial !== undefined ? cloneJson(options.initial) : {};
    if (options && options.initial !== undefined) {
      const op = this.createOperation('set', [], { value: this.viewValue });
      this.addOperation(op);
      this.viewValue = materialize(this.getReadyOperationsForRead());
      this.readyHeadsCache = [op.id];
      this.allReadyCache = true;
      this.stateVectorCache = { [op.actor]: op.seq };
    }
  }

  toJSON(): JsonValue {
    this.flushNativeTextLogView();
    this.flushTextValueCache();
    return cloneJson(this.viewValue);
  }

  getHeads(): string[] {
    return this.getReadyHeadsCached().slice();
  }

  getVersion(): CrdtVersion {
    return this.getReadyHeadsCached().slice();
  }

  getStateVector(): CrdtStateVector {
    return this.getStateVectorCached();
  }

  change(callback: (tx: CrdtTransaction) => void, options?: CrdtChangeOptions): CrdtCommitResult {
    this.flushPendingNativeTextBeforeGeneric();
    const tx = new Transaction(this, options && options.metadata);
    callback(tx);
    return tx.commit();
  }

  set(path: WatchPath, value: JsonValue): CrdtCommitResult {
    this.flushTextValueCache();
    this.flushNativeTextLogToOperations();
    return this.commitLocal([this.createOperation('set', normalizeCrdtPath(path), { value: cloneJson(value) })]);
  }

  delete(path: WatchPath): CrdtCommitResult {
    this.flushTextValueCache();
    this.flushNativeTextLogToOperations();
    return this.commitLocal([this.createOperation('del', normalizeCrdtPath(path), {})]);
  }

  map(path: WatchPath): CrdtMapHandle {
    const key = watchPathCacheKey(path);
    const cached = this.mapHandleCache.get(key);
    if (cached !== undefined) return cached;
    const handle = new MapHandle(this, normalizeCrdtPath(path));
    this.mapHandleCache.set(key, handle);
    return handle;
  }

  getConflict(path: WatchPath): CrdtConflict | undefined {
    return getCrdtConflictAtPath(
      this.getReadyOperationsForRead(),
      normalizeCrdtPath(path),
      this.commitMetadata,
      this.commitMetadataHeadByOperation
    );
  }

  getConflictSummary(path: WatchPath): CrdtConflictSummary | undefined {
    return getCrdtConflictSummaryAtPath(
      this.getReadyOperationsForRead(),
      normalizeCrdtPath(path)
    );
  }

  getConflicts(path?: WatchPath): CrdtConflict[] {
    return getCrdtConflicts(
      this.getReadyOperationsForRead(),
      path === undefined ? undefined : normalizeCrdtPath(path),
      false,
      this.commitMetadata,
      this.commitMetadataHeadByOperation
    );
  }

  getConflictSummaries(path?: WatchPath): CrdtConflictSummary[] {
    return getCrdtConflictSummaries(
      this.getReadyOperationsForRead(),
      path === undefined ? undefined : normalizeCrdtPath(path),
      false
    );
  }

  getConflictAt(version: CrdtVersion, path: WatchPath): CrdtConflict | undefined {
    return getCrdtConflictAtPath(
      getReadyOperationsFromList(this.getOperationsAtVersion(version)),
      normalizeCrdtPath(path),
      this.commitMetadata,
      this.commitMetadataHeadByOperation
    );
  }

  getConflictSummaryAt(version: CrdtVersion, path: WatchPath): CrdtConflictSummary | undefined {
    return getCrdtConflictSummaryAtPath(
      getReadyOperationsFromList(this.getOperationsAtVersion(version)),
      normalizeCrdtPath(path)
    );
  }

  getConflictsAt(version: CrdtVersion, path?: WatchPath): CrdtConflict[] {
    return getCrdtConflicts(
      getReadyOperationsFromList(this.getOperationsAtVersion(version)),
      path === undefined ? undefined : normalizeCrdtPath(path),
      false,
      this.commitMetadata,
      this.commitMetadataHeadByOperation
    );
  }

  getConflictSummariesAt(version: CrdtVersion, path?: WatchPath): CrdtConflictSummary[] {
    return getCrdtConflictSummaries(
      getReadyOperationsFromList(this.getOperationsAtVersion(version)),
      path === undefined ? undefined : normalizeCrdtPath(path),
      false
    );
  }

  resolveConflict(
    path: WatchPath,
    resolution: CrdtConflictResolution,
    options?: CrdtConflictResolutionOptions
  ): CrdtCommitResult {
    const normalized = normalizeCrdtPath(path);
    const action = this.resolveConflictAction(normalized, resolution);
    return this.change((tx) => {
      if (action.type === 'delete') tx.delete(normalized);
      else tx.set(normalized, action.value);
    }, options);
  }

  _getDirectMapConflicts(path: JsonPath): CrdtConflict[] {
    return getCrdtConflicts(
      this.getReadyOperationsForRead(),
      path,
      true,
      this.commitMetadata,
      this.commitMetadataHeadByOperation
    );
  }

  _getDirectMapConflictSummaries(path: JsonPath): CrdtConflictSummary[] {
    return getCrdtConflictSummaries(
      this.getReadyOperationsForRead(),
      path,
      true
    );
  }

  _resolveConflictAction(path: JsonPath, resolution: CrdtConflictResolution): CrdtResolvedConflictAction {
    return this.resolveConflictAction(path, resolution);
  }

  private resolveConflictAction(path: JsonPath, resolution: CrdtConflictResolution): CrdtResolvedConflictAction {
    const conflict = getCrdtConflictAtPath(
      this.getReadyOperationsForRead(),
      path,
      this.commitMetadata,
      this.commitMetadataHeadByOperation
    );
    if (conflict === undefined) throw new TypeError('no CRDT register conflict exists at path');
    return resolveCrdtConflictAction(conflict, resolution);
  }

  counter(path: WatchPath): CrdtCounterHandle {
    const key = watchPathCacheKey(path);
    const cached = this.counterHandleCache.get(key);
    if (cached !== undefined) return cached;
    const handle = new CounterHandle(this, normalizeCrdtPath(path));
    this.counterHandleCache.set(key, handle);
    return handle;
  }

  binary(path: WatchPath): CrdtBinaryHandle {
    const key = watchPathCacheKey(path);
    const cached = this.binaryHandleCache.get(key);
    if (cached !== undefined) return cached;
    const handle = new BinaryHandle(this, normalizeCrdtPath(path));
    this.binaryHandleCache.set(key, handle);
    return handle;
  }

  list(path: WatchPath): CrdtListHandle {
    const key = watchPathCacheKey(path);
    const cached = this.listHandleCache.get(key);
    if (cached !== undefined) return cached;
    const handle = new ListHandle(this, normalizeCrdtPath(path));
    this.listHandleCache.set(key, handle);
    return handle;
  }

  text(path: WatchPath): CrdtTextHandle {
    const key = watchPathCacheKey(path);
    const cached = this.textHandleCache.get(key);
    if (cached !== undefined) return cached;
    const handle = new TextHandle(this, normalizeCrdtPath(path));
    this.textHandleCache.set(key, handle);
    return handle;
  }

  tree(path: WatchPath): CrdtTreeHandle {
    const key = watchPathCacheKey(path);
    const cached = this.treeHandleCache.get(key);
    if (cached !== undefined) return cached;
    const handle = new TreeHandle(this, normalizeCrdtPath(path));
    this.treeHandleCache.set(key, handle);
    return handle;
  }

  xml(path: WatchPath): CrdtXmlHandle {
    const key = watchPathCacheKey(path);
    const cached = this.xmlHandleCache.get(key);
    if (cached !== undefined) return cached;
    const handle = new XmlHandle(this, normalizeCrdtPath(path));
    this.xmlHandleCache.set(key, handle);
    return handle;
  }

  richText(path: WatchPath): CrdtRichTextHandle {
    const key = watchPathCacheKey(path);
    const cached = this.richTextHandleCache.get(key);
    if (cached !== undefined) return cached;
    const handle = createCrdtRichTextHandle(this, normalizeCrdtPath(path));
    this.richTextHandleCache.set(key, handle);
    return handle;
  }

  applyUpdate(updateBytes: ArrayBuffer | ArrayBufferView | CrdtUpdate): CrdtCommitResult {
    const encodedInput = getEncodedUpdateInput(updateBytes);
    if (encodedInput !== null) {
      const nativeResult = this.tryApplyEncodedNativeTextLogUpdate(encodedInput);
      if (nativeResult !== null) return nativeResult;
    }
    this.flushNativeTextLogToOperations();
    const update = decodeCrdtUpdate(updateBytes);
    let before = this.viewValue;
    if (!trustedDecodedUpdates.has(update)) {
      for (let i = 0, length = update.ops.length; i < length; i++) {
        validateOperation(update.ops[i]);
      }
    }

	    if (update.ops.length === 1) {
	      const op = update.ops[0];
	      if (!this.operationRangeOverlapsKnown(op) && this.allOperationsReadyCached()) {
	        const beforeReadyHeads = this.getReadyHeadsForOperation();
	        if (sameOperationIdSet(op.deps, beforeReadyHeads)) {
	          const textAppend = this.tryApplyReadyTextAppend(update, op, encodedInput);
	          if (textAppend !== null) return textAppend;
	          const textDirty = this.createReadyTextDirtyApplication([op]);
	          if (textDirty !== null) {
	            const updateResult = encodedInput === null ? encodeTrustedCrdtUpdate(update) : encodedInput;
		            this.addOperation(op);
		            this.recordCommitMetadataForUpdate([op], update);
	            this.catchUpLocalSeq(update);
	            this.noteDirectTextDirtyOperationsApplied([op], textDirty.spans, textDirty.sequences);
	            return createCrdtCommitResult(
	              () => updateResult,
	              textDirty.viewPatch,
	              this.getReadyHeadsCached(),
	              this.getStateVectorCached(),
	              undefined,
	              update.metadata
	            );
	          }
	          this.flushTextValueCache();
	          before = this.viewValue;
	          const directPatch = this.createDirectSingleReadyPatch(before, op);
	          if (directPatch !== null) {
            this.addOperation(op);
            this.recordCommitMetadataForUpdate([op], update);
            this.catchUpLocalSeq(update);
            this.viewValue = applyDirectPatchToView(this.viewValue, directPatch);
            this.noteDirectOperationApplied(op);
            return createStaticCrdtCommitResult(
              encodedInput === null ? encodeTrustedCrdtUpdate(update) : encodedInput,
              directPatch,
              this.getReadyHeadsCached(),
              this.getStateVectorCached(),
              update.metadata
            );
          }
        }
      }
    }

    let changed = false;
    let allNew = true;
    const newOps: CrdtOperation[] = [];
    for (let i = 0, length = update.ops.length; i < length; i++) {
      const op = update.ops[i];
      if (this.operationFullyKnown(op)) {
        allNew = false;
      } else {
        changed = true;
        const missing = this.missingOperations(op);
        for (let j = 0, missingLength = missing.length; j < missingLength; j++) newOps[newOps.length] = missing[j];
        if (missing.length !== 1 || missing[0] !== op) allNew = false;
      }
    }
    if (!changed) {
      return createStaticCrdtCommitResult(
        encodedInput === null ? encodeTrustedCrdtUpdate(update) : encodedInput,
        [],
        this.getReadyHeadsCached(),
        this.getStateVectorCached()
      );
    }

    const beforeReadyHeads = allNew && this.allOperationsReadyCached()
      ? this.getReadyHeadsCached()
      : null;
	    let directPatch: Patch | null = null;
	    let textDirty: TextDirtyApplication | null = null;
	    if (
	      beforeReadyHeads !== null &&
	      sameOperationIdSet(update.ops[0].deps, beforeReadyHeads) &&
	      operationsBecomeReady(update.ops, beforeReadyHeads)
	    ) {
	      textDirty = this.createReadyTextDirtyApplication(update.ops);
	      if (textDirty === null && update.ops.length === 1) {
	        this.flushTextValueCache();
	        before = this.viewValue;
	        directPatch = createDominatingPatch(
	          before,
	          update.ops[0],
          (path, kind) => this.getVisibleElementIdsCached(path, kind),
          (path, kind, after) => this.getSequenceIndexAfterCached(path, kind, after)
        );
	      } else if (textDirty === null) {
	        this.flushTextValueCache();
	        before = this.viewValue;
	        directPatch = createDominatingBatchPatch(
	          before,
	          update.ops,
          (path, kind) => this.getVisibleElementIdsCached(path, kind),
          (path, kind, after) => this.getSequenceIndexAfterCached(path, kind, after)
        );
      }
    }

    for (let i = 0, length = newOps.length; i < length; i++) {
      this.addOperation(newOps[i]);
    }
    this.recordCommitMetadataForUpdate(newOps, update);
    this.catchUpLocalSeq(update);
	    let viewPatch: Patch | (() => Patch);
	    if (textDirty !== null) {
	      viewPatch = textDirty.viewPatch;
	      this.noteDirectTextDirtyOperationsApplied(update.ops, textDirty.spans, textDirty.sequences);
	    } else if (directPatch !== null) {
	      viewPatch = directPatch;
	      this.viewValue = applyDirectPatchToView(this.viewValue, viewPatch);
	      this.noteDirectOperationsApplied(update.ops);
    } else {
      this.readyHeadsCache = null;
      this.allReadyCache = null;
      this.flushTextValueCache();
      before = this.viewValue;
      this.viewValue = materialize(this.getReadyOperationsForRead());
      this.clearRuntimeCaches();
      viewPatch = diff(before, this.viewValue);
    }
	    return createCrdtCommitResult(
	      () => encodedInput === null ? encodeTrustedCrdtUpdate(update) : encodedInput,
	      viewPatch,
	      this.getReadyHeadsCached(),
	      this.getStateVectorCached(),
	      undefined,
	      update.metadata
	    );
	  }

  private tryApplyEncodedNativeTextLogUpdate(encodedInput: Uint8Array): CrdtCommitResult | null {
    const parsed = tryReadNativeColumnarPositionedTextLogUpdate(encodedInput);
    if (parsed === null) return null;
    const firstSeq = parsed.firstSeq;
    const lastSeq = parsed.seq;
    if (actorSeqRangesCover(this.operationRangesByActor.get(parsed.actor), firstSeq, lastSeq)) {
      return createStaticCrdtCommitResult(encodedInput, [], this.getReadyHeadsCached(), this.getStateVectorCached());
    }
    if (actorSeqRangesOverlap(this.operationRangesByActor.get(parsed.actor), firstSeq, lastSeq)) return null;
    if (parsed.segment !== undefined) {
      return this.tryApplyNativeTextLogSegmentUpdate(encodedInput, parsed, firstSeq, lastSeq);
    }
    const log = parsed.log;
    if (log === undefined) return null;
    if (this.operationLog.length !== 0 || this.nativeTextLog !== null || !this.allOperationsReadyCached()) return null;
    const currentHeads = this.getReadyHeadsForOperation();
    if (!sameOperationIdSet(log.firstDeps, currentHeads)) return null;
    const current = valueAtPath(this.viewValue, log.path);
    if (current !== undefined && current !== log.initialText) return null;

    this.nativeTextLog = log;
    this.noteActorRange(parsed.actor, firstSeq, lastSeq);
    if (parsed.actor === this.actorId && lastSeq >= this.nextSeq) this.nextSeq = lastSeq + 1;
    this.readyHeadsCache = [`${parsed.actor}:${lastSeq}`];
    this.allReadyCache = true;
    this.stateVectorCache = { [parsed.actor]: lastSeq };
    this.sequenceVisibleCache.delete(log.key);
    this.textSequenceCache.delete(log.key);
    this.textValueCache.delete(log.key);
    this.sequenceAppendCache.delete(log.key);

    const beforeRoot = this.viewValue;
    const path = log.path.slice();
    return createCrdtCommitResult(
      () => encodedInput,
      () => createSetPatch(beforeRoot, path, materializeNativeTextLog(log)),
      this.getReadyHeadsCached(),
      this.getStateVectorCached()
    );
  }

  private tryApplyNativeTextLogSegmentUpdate(
    encodedInput: Uint8Array,
    parsed: NativeColumnarTextLogUpdate,
    firstSeq: number,
    lastSeq: number
  ): CrdtCommitResult | null {
    const segment = parsed.segment;
    const log = this.nativeTextLog;
    if (segment === undefined || log === null) return null;
    if (this.operationLog.length !== 0 || !this.allOperationsReadyCached()) return null;
    if (log.actor !== parsed.actor || log.key !== segment.key || !samePath(log.path, segment.path)) return null;
    if (firstSeq !== log.firstSeq + log.tags.length) return null;
    if (!sameOperationIdSet(parsed.firstDeps, this.getReadyHeadsForOperation())) return null;

    const beforeRoot = this.viewValue;
    if (!appendNativeTextLogSegment(log, segment)) return null;

    this.noteActorRange(parsed.actor, firstSeq, lastSeq);
    if (parsed.actor === this.actorId && lastSeq >= this.nextSeq) this.nextSeq = lastSeq + 1;
    this.readyHeadsCache = [`${parsed.actor}:${lastSeq}`];
    this.allReadyCache = true;
    this.stateVectorCache = { [parsed.actor]: lastSeq };
    this.sequenceVisibleCache.delete(log.key);
    this.textSequenceCache.delete(log.key);
    this.textValueCache.delete(log.key);
    this.sequenceAppendCache.delete(log.key);

    const patchPath = log.path.slice();
    return createCrdtCommitResult(
      () => encodedInput,
      () => createSetPatch(beforeRoot, patchPath, materializeNativeTextLog(log)),
      this.getReadyHeadsCached(),
      this.getStateVectorCached()
    );
  }

  encodeStateAsUpdate(stateVector?: CrdtStateVector | null): Uint8Array {
    if (this.nativeTextLog !== null) {
      const vector = stateVector || {};
      if (this.operationLog.length === 0 || this.stateVectorCoversOperationRanges(vector)) {
        const nativeUpdate = this.encodeNativeTextLogUpdateSinceStateVector(this.nativeTextLog, stateVector);
        if (nativeUpdate !== null) return nativeUpdate;
      }
    }
    this.flushNativeTextLogToOperations();
    const ops = this.getOperationsSince(stateVector);
    return encodeTrustedCrdtUpdate({
      actor: this.actorId,
      seq: this.nextSeq - 1,
      deps: this.getReadyHeadsCached(),
      ops
    });
  }

  exportUpdate(stateVector?: CrdtStateVector | null): Uint8Array {
    return this.encodeStateAsUpdate(stateVector);
  }

  exportChangesSince(version?: CrdtVersion | null): Uint8Array {
    if (version === undefined || version === null || !Array.isArray(version)) {
      return this.exportUpdate(version as CrdtStateVector | null | undefined);
    }
    return this.exportChangesBetween(version, null);
  }

  exportChangesBetween(fromVersion?: CrdtVersion | null, toVersion?: CrdtVersion | null): Uint8Array {
    if (
      (toVersion === undefined || toVersion === null) &&
      (fromVersion === undefined || fromVersion === null || !Array.isArray(fromVersion))
    ) {
      return this.exportUpdate(fromVersion as CrdtStateVector | null | undefined);
    }
    const ops = this.changesBetween(fromVersion ?? null, toVersion ?? null);
    return encodeTrustedCrdtUpdate({
      actor: this.actorId,
      seq: ops.length === 0 ? this.nextSeq - 1 : maxOperationSeq(ops),
      deps: ops.length === 0 ? this.getReadyHeadsCached() : getHeadsFromOperationList(ops),
      ops
    });
  }

  changesSince(version?: CrdtVersion | null): CrdtOperation[] {
    if (Array.isArray(version)) return this.changesBetween(version, null);
    const update = decodeCrdtUpdate(this.exportUpdate(version));
    return cloneCrdtOperations(update.ops);
  }

  changesBetween(fromVersion?: CrdtVersion | null, toVersion?: CrdtVersion | null): CrdtOperation[] {
    const fromVector = fromVersion === undefined || fromVersion === null
      ? {}
      : Array.isArray(fromVersion)
        ? getStateVectorFromOperationList(this.getOperationsAtVersion(fromVersion))
        : fromVersion;
    const toOps = toVersion === undefined || toVersion === null
      ? decodeCrdtUpdate(this.exportUpdate(null)).ops
      : this.getOperationsAtVersion(toVersion);
    return getOperationsSinceStateVectorFromList(toOps, fromVector);
  }

  getHistory(options?: CrdtHistoryOptions): CrdtHistoryEntry[] {
    const ops = this.getHistoryOperations(options);
    return createCrdtHistoryEntries(
      ops,
      !!(options && options.includeOps),
      options && options.includeMetadata ? this.commitMetadata : undefined
    );
  }

  forEachHistory(callback: CrdtHistoryVisitor, options?: CrdtHistoryOptions): void {
    if (typeof callback !== 'function') throw new TypeError('CRDT history callback must be a function');
    visitCrdtHistoryEntries(
      this.getHistoryOperations(options),
      !!(options && options.includeOps),
      options && options.includeMetadata ? this.commitMetadata : undefined,
      callback
    );
  }

  getCommitMetadata(version?: CrdtVersion | CrdtOperationId | null): JsonObject | undefined {
    const heads = this.getHeadsForMetadataVersion(version);
    if (heads.length === 0) return undefined;
    if (heads.length > 1) heads.sort(compareOperationIds);
    for (let i = heads.length - 1; i >= 0; i--) {
      const metadataHead = this.commitMetadataHeadByOperation.get(heads[i]) || heads[i];
      const metadata = this.commitMetadata.get(metadataHead);
      if (metadata !== undefined) return cloneJson(metadata);
    }
    return undefined;
  }

  markVersion(name: string, options?: CrdtVersionMarkOptions): CrdtVersionMark {
    const normalizedName = validateCrdtVersionMarkName(name);
    const hasVersion = options !== undefined && Object.prototype.hasOwnProperty.call(options, 'version');
    const version = hasVersion ? options.version ?? null : null;
    const info = this.inspectVersion(version);
    const mark: CrdtVersionMark = {
      name: normalizedName,
      version: cloneCrdtVersion(info.version),
      heads: info.heads.slice(),
      stateVector: cloneStateVector(info.stateVector)
    };
    if (options && options.metadata !== undefined) mark.metadata = cloneJson(options.metadata);
    this.versionMarks.set(normalizedName, cloneCrdtVersionMark(mark));
    return cloneCrdtVersionMark(mark);
  }

  getVersionMark(name: string): CrdtVersionMark | undefined {
    const mark = this.versionMarks.get(validateCrdtVersionMarkName(name));
    return mark === undefined ? undefined : cloneCrdtVersionMark(mark);
  }

  listVersionMarks(): CrdtVersionMark[] {
    const marks = Array.from(this.versionMarks.values());
    marks.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    const cloned = new Array<CrdtVersionMark>(marks.length);
    for (let i = 0, length = marks.length; i < length; i++) cloned[i] = cloneCrdtVersionMark(marks[i]);
    return cloned;
  }

  deleteVersionMark(name: string): boolean {
    return this.versionMarks.delete(validateCrdtVersionMarkName(name));
  }

  viewMark(name: string): JsonValue {
    return this.viewAt(this.requireVersionMark(name).version);
  }

  checkoutMark(name: string, options?: CrdtForkOptions): CrdtDocument {
    return this.checkout(this.requireVersionMark(name).version, options);
  }

  snapshotMark(name: string, options?: CrdtSnapshotOptions): CrdtSnapshot {
    return this.snapshot({
      ...(options || {}),
      version: this.requireVersionMark(name).version
    });
  }

  inspectVersion(version?: CrdtVersion | null, options?: CrdtVersionInfoOptions): CrdtVersionInfo {
    const currentVersion = version === undefined || version === null;
    const ops = currentVersion ? this.changesSince(null) : this.getOperationsAtVersion(version);
    const inspectVersion = currentVersion ? this.getVersion() : cloneCrdtVersion(version);
    const info: CrdtVersionInfo = {
      version: inspectVersion,
      heads: getHeadsFromOperationList(ops),
      stateVector: getStateVectorFromOperationList(ops)
    };
    if (options && options.includeMetadata) {
      const metadata = this.getCommitMetadata(currentVersion ? null : version);
      if (metadata !== undefined) info.metadata = metadata;
    }
    if (options && options.includeHistory) {
      info.history = createCrdtHistoryEntries(
        ops,
        false,
        options.includeMetadata ? this.commitMetadata : undefined
      );
    }
    if (options && options.includeView) {
      info.view = currentVersion ? this.toJSON() : this.viewAt(version);
    }
    if (options && options.includeUpdate) {
      info.update = this.exportChangesBetween(null, currentVersion ? null : version).slice();
    }
    return info;
  }

  compareVersions(left?: CrdtVersion | null, right?: CrdtVersion | null): CrdtVersionRelation {
    const leftIds = this.getOperationIdsAtVersion(left ?? null);
    const rightIds = this.getOperationIdsAtVersion(right ?? null);
    let leftInRight = true;
    leftIds.forEach((id) => {
      if (!rightIds.has(id)) leftInRight = false;
    });
    let rightInLeft = true;
    rightIds.forEach((id) => {
      if (!leftIds.has(id)) rightInLeft = false;
    });
    if (leftInRight && rightInLeft) return 'equal';
    if (leftInRight) return 'before';
    if (rightInLeft) return 'after';
    return 'concurrent';
  }

  snapshot(options?: CrdtSnapshotOptions): CrdtSnapshot {
    const hasFrom = options !== undefined && Object.prototype.hasOwnProperty.call(options, 'from');
    const fromVersion = hasFrom ? options.from ?? null : null;
    const hasVersion = options !== undefined && Object.prototype.hasOwnProperty.call(options, 'version');
    const version = hasVersion ? options.version ?? null : null;
    const ops = fromVersion === null && version === null
      ? this.changesSince(null)
      : this.changesBetween(fromVersion, version);
    const snapshotVersion = version === null ? this.getVersion() : cloneCrdtVersion(version);
    const snapshot: CrdtSnapshot = {
      version: snapshotVersion,
      heads: getHeadsFromOperationList(ops),
      stateVector: getStateVectorFromOperationList(ops),
      update: this.exportChangesBetween(fromVersion, version).slice()
    };
    if (hasFrom) snapshot.baseVersion = fromVersion === null ? null : cloneCrdtVersion(fromVersion);
    if (options === undefined || options.includeMetadata !== false) {
      const metadata = this.getCommitMetadataEntriesForOps(ops);
      if (metadata.length !== 0) snapshot.metadata = metadata;
    }
    if (options && options.includeView) {
      snapshot.view = version === null ? this.toJSON() : this.viewAt(version);
    }
    return snapshot;
  }

  applySnapshot(snapshot: CrdtSnapshot): CrdtCommitResult {
    validateCrdtSnapshot(snapshot);
    const result = this.applyUpdate(snapshot.update);
    this.importCommitMetadataEntries(snapshot.metadata);
    return result;
  }

  viewAt(version?: CrdtVersion | null): JsonValue {
    if (version === undefined || version === null) return this.toJSON();
    const ops = this.getOperationsAtVersion(version);
    return cloneJson(materialize(getReadyOperationsFromList(ops)));
  }

  checkout(version?: CrdtVersion | null, options?: CrdtForkOptions): CrdtDocument {
    const doc = new FrontierCrdtDocument({
      actorId: options && options.actorId,
      profile: options && options.profile !== undefined ? options.profile : this.getProfile()
    });
    const ops = version === undefined || version === null
      ? this.changesSince(null)
      : this.getOperationsAtVersion(version);
    if (ops.length !== 0) {
      doc.applyUpdate({
        actor: this.actorId,
        seq: maxOperationSeq(ops),
        deps: getHeadsFromOperationList(ops),
        ops
      });
      this.copyCommitMetadataForOpsTo(doc, ops);
    }
    return doc;
  }

  fork(options?: CrdtForkOptions): CrdtDocument {
    return this.checkout(null, options);
  }

  createCursor(path: WatchPath, index: number, options?: CrdtCursorOptions): CrdtTextCursor {
    if (!Number.isSafeInteger(index) || index < 0) throw new RangeError('cursor index must be a non-negative safe integer');
    this.flushNativeTextLogView();
    this.flushTextValueCache();
    const normalized = normalizeCrdtPath(path);
    const current = valueAtPath(this.viewValue, normalized);
    if (current !== undefined && typeof current !== 'string') throw new TypeError('cursor path must point to text');
    const text = current === undefined ? '' : current as string;
    const length = text.length === 0 ? 0 : codePointLength(text);
    const boundedIndex = Math.min(index, length);
    const assoc = normalizeCursorAssoc(options && options.assoc);

    if (assoc < 0) {
      if (boundedIndex === 0) {
        return { type: 'text', path: normalized, anchor: null, side: 'start', assoc, index: 0 };
      }
      const sequence = this.getTextSequenceCached(normalized, current);
      return {
        type: 'text',
        path: normalized,
        anchor: sequence.at(Math.min(boundedIndex, sequence.length) - 1),
        side: 'after',
        assoc,
        index: boundedIndex
      };
    }

    if (boundedIndex >= length) {
      return { type: 'text', path: normalized, anchor: null, side: 'end', assoc, index: boundedIndex };
    }
    const sequence = this.getTextSequenceCached(normalized, current);
    return {
      type: 'text',
      path: normalized,
      anchor: sequence.at(Math.min(boundedIndex, sequence.length - 1)),
      side: 'before',
      assoc,
      index: boundedIndex
    };
  }

  resolveCursor(cursor: CrdtTextCursor): CrdtResolvedCursor {
    validateCrdtTextCursor(cursor);
    this.flushNativeTextLogView();
    this.flushTextValueCache();
    const path = cursor.path.slice();
    const current = valueAtPath(this.viewValue, path);
    if (current !== undefined && typeof current !== 'string') {
      return { path, index: 0, assoc: cursor.assoc, found: false };
    }
    const text = current === undefined ? '' : current as string;
    const length = text.length === 0 ? 0 : codePointLength(text);
    if (cursor.side === 'start') return { path, index: 0, assoc: cursor.assoc, found: true };
    if (cursor.side === 'end') return { path, index: length, assoc: cursor.assoc, found: true };
    if (cursor.anchor !== null) {
      const sequence = this.getTextSequenceCached(path, current);
      const anchorIndex = sequence.indexOf(cursor.anchor);
      if (anchorIndex !== -1) {
        return {
          path,
          index: cursor.side === 'after' ? anchorIndex + 1 : anchorIndex,
          assoc: cursor.assoc,
          found: true
        };
      }
    }
    return { path, index: Math.min(cursor.index, length), assoc: cursor.assoc, found: false };
  }

  createSelection(path: WatchPath, anchor: number, focus: number, options?: CrdtSelectionOptions): CrdtTextSelection {
    return {
      type: 'text-selection',
      anchor: this.createCursor(path, anchor, { assoc: options && options.anchorAssoc !== undefined ? options.anchorAssoc : -1 }),
      focus: this.createCursor(path, focus, { assoc: options && options.focusAssoc !== undefined ? options.focusAssoc : 1 })
    };
  }

  resolveSelection(selection: CrdtTextSelection): CrdtResolvedSelection {
    validateCrdtTextSelection(selection);
    const anchor = this.resolveCursor(selection.anchor);
    const focus = this.resolveCursor(selection.focus);
    return {
      path: anchor.path,
      anchor: anchor.index,
      focus: focus.index,
      found: anchor.found && focus.found && samePath(anchor.path, focus.path)
    };
  }

  getProfile(): CrdtProfile {
    return createCrdtProfileSnapshot(this.crdtProfile);
  }

  loadProfile(profile?: CrdtProfile | null): void {
    this.crdtProfile = createCrdtAdaptiveProfileState({ profile });
    this.applyTextProfilesToCachedSequences();
  }

  _createOperation(type: CrdtOperation['type'], path: JsonPath, payload: Record<string, unknown>): CrdtOperation {
    return this.createOperation(type, path, payload);
  }

  _createSetOperation(path: JsonPath, value: JsonValue): Extract<CrdtOperation, { type: 'set' }> {
    return this.createSetOperation(path, value);
  }

  _createDeleteOperation(path: JsonPath): Extract<CrdtOperation, { type: 'del' }> {
    return this.createDeleteOperation(path);
  }

  _createCounterOperation(path: JsonPath, delta: number): Extract<CrdtOperation, { type: 'counter' }> {
    return this.createCounterOperation(path, delta);
  }

  _createBinarySetOperation(path: JsonPath, bytes: string): Extract<CrdtOperation, { type: 'binarySet' }> {
    return this.createBinarySetOperation(path, bytes);
  }

  _createTreeCreateOperation(path: JsonPath, nodeId: string, parent: string | null, after: string | null, value: JsonValue): Extract<CrdtOperation, { type: 'treeCreate' }> {
    return this.createTreeCreateOperation(path, nodeId, parent, after, value);
  }

  _createTreeMoveOperation(path: JsonPath, nodeId: string, parent: string | null, after: string | null): Extract<CrdtOperation, { type: 'treeMove' }> {
    return this.createTreeMoveOperation(path, nodeId, parent, after);
  }

  _createTreeSetOperation(path: JsonPath, nodeId: string, value: JsonValue): Extract<CrdtOperation, { type: 'treeSet' }> {
    return this.createTreeSetOperation(path, nodeId, value);
  }

  _createTreeDeleteOperation(path: JsonPath, nodeId: string): Extract<CrdtOperation, { type: 'treeDel' }> {
    return this.createTreeDeleteOperation(path, nodeId);
  }

  _createListInsertOperation(path: JsonPath, after: string | null, values: JsonValue[]): Extract<CrdtOperation, { type: 'listInsert' }> {
    return this.createListInsertOperation(path, after, values);
  }

  _createTextInsertOperation(path: JsonPath, after: string | null, text: string): Extract<CrdtOperation, { type: 'textInsert' }> {
    return this.createTextInsertOperation(path, after, text);
  }

  _reserveOperationSeq(expected?: number): number {
    if (expected !== undefined && this.nextSeq !== expected) return 0;
    return this.nextSeq++;
  }

  _commitLocal(
    ops: CrdtOperation[],
    textDirtySpans?: TextDirtySpan[] | null,
    textDirtySequences?: TextDirtySequenceSource | null,
    depsAlreadyChained = false,
    metadata?: JsonObject
  ): CrdtCommitResult {
    return this.commitLocal(ops, textDirtySpans, textDirtySequences, depsAlreadyChained, metadata);
  }

  _textSequenceLength(path: JsonPath): number {
    return this.getTextSequenceCached(path, valueAtPath(this.viewValue, path)).length;
  }

  _textElementAt(path: JsonPath, index: number): string | null {
    return this.getTextSequenceCached(path, valueAtPath(this.viewValue, path)).at(index);
  }

  _textElementsSlice(path: JsonPath, index: number, count: number): string[] {
    return this.getTextSequenceCached(path, valueAtPath(this.viewValue, path)).slice(index, count);
  }

  _listValuesSlice(path: JsonPath, index: number, count: number): JsonValue[] {
    const current = valueAtPath(this.viewValue, path);
    if (!Array.isArray(current) || count <= 0 || index >= current.length) return [];
    const start = Math.max(0, index);
    const end = Math.min(current.length, start + count);
    const values = new Array<JsonValue>(end - start);
    for (let i = start; i < end; i++) values[i - start] = cloneJson(current[i]);
    return values;
  }

  _binaryValue(path: JsonPath): Uint8Array | undefined {
    this.flushNativeTextLogView();
    this.flushTextValueCache();
    return binaryJsonToBytes(valueAtPath(this.viewValue, path));
  }

  _treeValue(path: JsonPath): CrdtTreeNode[] {
    this.flushNativeTextLogView();
    this.flushTextValueCache();
    const current = valueAtPath(this.viewValue, path);
    return readTreeJsonValue(current);
  }

  _readyOperationsSnapshot(): CrdtOperation[] {
    return this.getReadyOperationsForRead();
  }

  _textSequenceSnapshot(path: JsonPath): TextSequence {
    return this.getTextSequenceCached(path, valueAtPath(this.viewValue, path)).clone();
  }

  _canApplyTextDirtyPatch(path: JsonPath): boolean {
    return typeof valueAtPath(this.viewValue, path) === 'string';
  }

  _commitLocalMapSet(path: JsonPath, key: string | number, value: JsonValue, encodedPath?: string): CrdtCommitResult {
    this.flushTextValueCache();
    this.flushPendingNativeTextBeforeGeneric();
    const opPath = appendPathSegment(path, key);
    const opValue = cloneJson(value);
    const op = this.createSetOperation(opPath, opValue);
    const current = valueAtPath(this.viewValue, path);
    if (current !== null && typeof current === 'object' && !Array.isArray(current)) {
      const patchValue = isMutableJsonValue(opValue) ? cloneJson(opValue) : opValue;
      const viewValue = isMutableJsonValue(patchValue) ? cloneJson(patchValue) : patchValue;
      this.addOperation(op);
      setOwnValue(current as Record<string | number, JsonValue>, key, viewValue);
      return this.finishLocalDirectCommit(op, [[OP_SET, opPath, patchValue]], encodedPath);
    }
    const patch = createDirectMapSetPatch(this.viewValue, path, opPath, opValue);
    return this.commitLocalWithDirectPatch(op, patch, encodedPath);
  }

  _commitLocalMapDelete(path: JsonPath, key: string | number, encodedPath?: string): CrdtCommitResult {
    this.flushTextValueCache();
    this.flushPendingNativeTextBeforeGeneric();
    const opPath = appendPathSegment(path, key);
    const op = this.createDeleteOperation(opPath);
    const patch = createRemovePatch(this.viewValue, opPath);
    return this.commitLocalWithDirectPatch(op, patch, encodedPath);
  }

  _commitLocalCounter(path: JsonPath, delta: number, encodedPath?: string): CrdtCommitResult {
    const normalized = normalizeCounterDelta(delta);
    if (normalized === 0) return this.commitLocal([]);
    this.flushTextValueCache();
    this.flushPendingNativeTextBeforeGeneric();
    const op = this.createCounterOperation(path, normalized);
    const patch = createCounterPatch(this.viewValue, path, normalized);
    return this.commitLocalWithDirectPatch(op, patch, encodedPath);
  }

  _commitLocalBinarySet(path: JsonPath, value: ArrayBuffer | ArrayBufferView, encodedPath?: string): CrdtCommitResult {
    this.flushTextValueCache();
    this.flushPendingNativeTextBeforeGeneric();
    const bytes = bytesToBase64(toBinaryUint8Array(value));
    const op = this.createBinarySetOperation(path, bytes);
    const patch = createSetPatch(this.viewValue, path, binaryJsonValue(bytes));
    return this.commitLocalWithDirectPatch(op, patch, encodedPath);
  }

  _commitLocalTreeCreate(path: JsonPath, parent: string | null, value: JsonValue, index?: number, encodedPath?: string): CrdtTreeCreateResult {
    this.flushTextValueCache();
    this.flushPendingNativeTextBeforeGeneric();
    const opValue = cloneJson(value);
    const currentTree = this._treeValue(path);
    const normalizedParent = normalizeTreeParent(parent);
    if (normalizedParent !== null && !treeContainsNode(currentTree, normalizedParent)) throw new RangeError('tree parent does not exist');
    const after = treeAfterForIndex(currentTree, normalizedParent, index);
    const seq = this.nextSeq;
    const nodeId = this.actorIdPrefix + seq;
    const op = this.createTreeCreateOperation(path, nodeId, normalizedParent, after, opValue);
    const result = this.commitLocalTreeOperation(op, encodedPath) as CrdtTreeCreateResult;
    result.id = nodeId;
    return result;
  }

  _commitLocalTreeMove(path: JsonPath, nodeId: string, parent: string | null, index?: number, encodedPath?: string): CrdtCommitResult {
    this.flushTextValueCache();
    this.flushPendingNativeTextBeforeGeneric();
    validateTreeNodeId(nodeId);
    const currentTree = this._treeValue(path);
    const normalizedParent = normalizeTreeParent(parent);
    if (normalizedParent !== null && !treeContainsNode(currentTree, normalizedParent)) throw new RangeError('tree parent does not exist');
    if (!treeContainsNode(currentTree, nodeId) || treeIsDescendant(currentTree, nodeId, normalizedParent)) return this.commitLocal([]);
    const after = treeAfterForIndex(currentTree, normalizedParent, index, nodeId);
    const op = this.createTreeMoveOperation(path, nodeId, normalizedParent, after);
    return this.commitLocalTreeOperation(op, encodedPath);
  }

  _commitLocalTreeSetValue(path: JsonPath, nodeId: string, value: JsonValue, encodedPath?: string): CrdtCommitResult {
    this.flushTextValueCache();
    this.flushPendingNativeTextBeforeGeneric();
    validateTreeNodeId(nodeId);
    if (!treeContainsNode(this._treeValue(path), nodeId)) return this.commitLocal([]);
    const op = this.createTreeSetOperation(path, nodeId, cloneJson(value));
    return this.commitLocalTreeOperation(op, encodedPath);
  }

  _commitLocalTreeDelete(path: JsonPath, nodeId: string, encodedPath?: string): CrdtCommitResult {
    this.flushTextValueCache();
    this.flushPendingNativeTextBeforeGeneric();
    validateTreeNodeId(nodeId);
    if (!treeContainsNode(this._treeValue(path), nodeId)) return this.commitLocal([]);
    const op = this.createTreeDeleteOperation(path, nodeId);
    return this.commitLocalTreeOperation(op, encodedPath);
  }

  _commitLocalListInsert(path: JsonPath, index: number, values: JsonValue[], encodedPath?: string, sequenceKey?: string): CrdtCommitResult {
    this.flushTextValueCache();
    this.flushPendingNativeTextBeforeGeneric();
    if (!Number.isSafeInteger(index) || index < 0) throw new RangeError('list index must be a non-negative safe integer');
    if (values.length === 0) return this.commitLocal([]);
    const current = valueAtPath(this.viewValue, path);
    const appendState = this.getSequenceAppendState(path, 'list', current, sequenceKey);
    if (appendState !== null && index >= appendState.length) {
      return this.commitLocalListInsertAt(path, appendState.length, appendState.tail, values, current, encodedPath);
    }
    const visible = this.getVisibleElementIdsCached(path, 'list', sequenceKey);
    const boundedIndex = Math.min(index, visible.length);
    const after = boundedIndex === 0 ? null : visible[boundedIndex - 1];
    return this.commitLocalListInsertAt(path, boundedIndex, after, values, current, encodedPath);
  }

  private commitLocalListInsertAt(
    path: JsonPath,
    boundedIndex: number,
    after: string | null,
    values: JsonValue[],
    current: JsonValue | undefined,
    encodedPath?: string
  ): CrdtCommitResult {
    const opValues = new Array<JsonValue>(values.length);
    for (let i = 0, length = values.length; i < length; i++) opValues[i] = cloneJson(values[i]);
    const op = this.createListInsertOperation(path, after, opValues);
    const patchValues = new Array<JsonValue>(opValues.length);
    for (let i = 0, length = opValues.length; i < length; i++) patchValues[i] = cloneJson(opValues[i]);
    const patch = Array.isArray(current)
      ? null
      : createSetPatch(this.viewValue, path, patchValues);
    if (Array.isArray(current)) {
      this.addOperation(op);
      applyDirectArraySplice(current, boundedIndex, 0, patchValues);
      return this.finishLocalDirectCommit(
        op,
        [[OP_ARRAY_SPLICE, path.slice(), boundedIndex, 0, patchValues]],
        encodedPath
      );
    }
    return this.commitLocalWithDirectPatch(op, patch as Patch, encodedPath);
  }

  _commitLocalListMove(path: JsonPath, fromIndex: number, toIndex: number, count = 1, encodedPath?: string, sequenceKey?: string): CrdtCommitResult {
    this.flushTextValueCache();
    this.flushPendingNativeTextBeforeGeneric();
    const move = createListMovePlan(this, path, fromIndex, toIndex, count);
    if (move === null) return this.commitLocal([]);
    const current = valueAtPath(this.viewValue, path);
    const patch = Array.isArray(current)
      ? [[OP_ARRAY_SPLICE, path.slice(), move.fromIndex, move.count, []], [OP_ARRAY_SPLICE, path.slice(), move.insertIndex, 0, move.patchValues]] as Patch
      : createSetPatch(this.viewValue, path, move.nextValues);
    return this.commitLocalBatchWithDirectPatch(move.ops, patch, encodedPath);
  }

  _commitLocalTextInsert(path: JsonPath, index: number, text: string, encodedPath?: string, sequenceKey?: string): CrdtCommitResult {
    if (!Number.isSafeInteger(index) || index < 0) throw new RangeError('text index must be a non-negative safe integer');
    if (text.length === 0) return this.commitLocal([]);
    const native = this.tryCommitNativeTextSpliceBatch(path, [{ index, deleteCount: 0, insert: text }], encodedPath, sequenceKey);
    if (native !== null) return native;
    this.flushPendingNativeTextBeforeGeneric();
    const current = valueAtPath(this.viewValue, path);
    const appendState = this.getSequenceAppendState(path, 'text', current, sequenceKey);
    if (appendState !== null && index >= appendState.length) {
      return this.commitLocalTextInsertAt(
        path,
        appendState.length,
        appendState.tail,
        text,
        current,
        encodedPath,
        undefined,
        appendState.length,
        sequenceKey
      );
    }
    const sequence = this.getTextSequenceCached(path, current, sequenceKey);
    if (index >= sequence.length) {
      return this.commitLocalTextInsertAt(
        path,
        sequence.length,
        sequence.tail(),
        text,
        current,
        encodedPath,
        undefined,
        sequence.length,
        sequenceKey
      );
    }
    const boundedIndex = Math.min(index, sequence.length);
    const after = boundedIndex === 0 ? null : sequence.at(boundedIndex - 1);
    return this.commitLocalTextInsertAt(path, boundedIndex, after, text, current, encodedPath, undefined, sequence.length, sequenceKey);
  }

  private commitLocalTextInsertAt(
    path: JsonPath,
    boundedIndex: number,
    after: string | null,
    text: string,
    current: JsonValue | undefined,
    encodedPath?: string,
    knownCodeUnitOffset?: number,
    knownCodePointLength?: number,
    sequenceKey?: string
  ): CrdtCommitResult {
    const op = this.createTextInsertOperation(path, after, text);
    if (typeof current === 'string') {
      const textValue = this.getTextValueCached(path, current, sequenceKey);
	      const offset = knownCodeUnitOffset === undefined
	        ? textValue.codeUnitOffset(boundedIndex)
	        : knownCodeUnitOffset;
	      const insertedCount = text.length === 1 ? 1 : codePointLength(text);
      if (this.crdtProfile.enabled) {
        observeCrdtTextTransactionShape(this.crdtProfile, [{ path: path.slice(), index: boundedIndex, deleteCount: 0, insert: text }]);
      }
	      this.addOperation(op);
	      textValue.insert(boundedIndex, text, insertedCount);
      return this.finishLocalDirectTextInsertCommit(
        op,
        () => [[OP_STRING_SPLICE, path.slice(), offset, 0, text]] as Patch,
        boundedIndex,
        insertedCount,
        encodedPath,
        sequenceKey
      );
    }
    const patch = createSetPatch(this.viewValue, path, text);
    return this.commitLocalWithDirectPatch(op, patch, encodedPath);
  }

  _commitLocalTextDelete(path: JsonPath, index: number, count: number, encodedPath?: string, sequenceKey?: string): CrdtCommitResult {
    if (!Number.isSafeInteger(index) || index < 0) throw new RangeError('text index must be a non-negative safe integer');
    if (!Number.isSafeInteger(count) || count < 0) throw new RangeError('text delete count must be a non-negative safe integer');
    if (count === 0) return this.commitLocal([]);
    const native = this.tryCommitNativeTextSpliceBatch(path, [{ index, deleteCount: count, insert: '' }], encodedPath, sequenceKey);
    if (native !== null) return native;
    this.flushPendingNativeTextBeforeGeneric();
    const current = valueAtPath(this.viewValue, path);
    const sequence = this.getTextSequenceCached(path, current, sequenceKey);
    const boundedIndex = Math.min(index, sequence.length);
    const payload = createTextDeleteOperationPayloadFromSequence(sequence, boundedIndex, count);
    if (payload === null) return this.commitLocal([]);
    const op = this.createTextDeleteOperation(path, payload);
	    if (typeof current !== 'string') return this.commitLocal([op]);
	    const textValue = this.getTextValueCached(path, current, sequenceKey);
	    const [offset, deleteCodeUnits] = textValue.codeUnitRange(boundedIndex, payload.count);
    if (this.crdtProfile.enabled) {
      observeCrdtTextTransactionShape(this.crdtProfile, [{ path: path.slice(), index: boundedIndex, deleteCount: payload.count, insert: '' }]);
    }
	    this.addOperation(op);
    textValue.delete(boundedIndex, payload.count);
    return this.finishLocalDirectTextDeleteCommit(
      op,
      () => [[OP_STRING_SPLICE, path.slice(), offset, deleteCodeUnits, '']] as Patch,
      boundedIndex,
      payload.count,
      encodedPath,
      sequenceKey
    );
  }

  private tryCommitNativeTextSpliceBatch(
    path: JsonPath,
    splices: readonly CrdtTextSpliceInput[],
    encodedPath?: string,
    sequenceKey?: string
  ): CrdtCommitResult | null {
    const key = sequenceKey === undefined ? sequenceCacheKey(path, 'text') : sequenceKey;
    let log = this.nativeTextLog;
    let createdText: boolean;
    let beforeCodeUnitAligned: boolean;
    const beforeRoot = this.viewValue;
    if (log !== null) {
      if (!this.canUseNativeTextLog(path, key, undefined)) return null;
      createdText = log.createdText;
      beforeCodeUnitAligned = log.initialCodeUnitAligned;
    } else {
      const current = valueAtPath(this.viewValue, path);
      if (!this.canUseNativeTextLog(path, key, current)) return null;
      const cachedTextBefore = this.textValueCache.get(key);
      const currentText = current === undefined
        ? cachedTextBefore === undefined ? '' : cachedTextBefore.value.toString()
        : current as string;
      createdText = current === undefined && cachedTextBefore === undefined;
      beforeCodeUnitAligned = !createdText && currentText.length === codePointLength(currentText);
      const baseSequence = this.operationLog.length === 0
        ? null
        : this.createNativeTextLogBaseSequence(path, key, currentText);
      if (this.operationLog.length !== 0 && baseSequence === null) return null;
      log = this.getOrCreateNativeTextLog(path, key, currentText, createdText, beforeCodeUnitAligned, baseSequence);
    }
    if (createdText && log.initialText.length === 0) {
      return Array.isArray(splices[0])
        ? this.commitCreatedNativeTextTupleSpliceBatch(path, key, log, splices as readonly CrdtTextSpliceTuple[], beforeRoot)
        : this.commitCreatedNativeTextSpliceBatch(path, key, log, splices as readonly CrdtTextSplice[], beforeRoot);
    }
    const objectSplices = Array.isArray(splices[0])
      ? normalizeCrdtTextSpliceBatch(splices)
      : splices as readonly CrdtTextSplice[];
    const recordStart = log.tags.length;
    const firstSeq = this.nextSeq;
    const tags = log.tags;
    const positionDeltas = log.positionDeltas;
    const counts = log.counts;
    const texts = log.texts;
    let logPreviousIndex = log.previousIndex;
    const recordStartPreviousIndex = logPreviousIndex;
    const recordStartTextIndex = texts.length;
    let logLength = log.length;
    let logAppendOnly = log.appendOnly;
    let logMaterializedText = log.materializedText;
    let nextSeq = this.nextSeq;
    let spansInsertCodeUnitAligned = true;

    for (let i = 0, length = objectSplices.length; i < length; i++) {
      const splice = objectSplices[i];
      if (
        splice === null ||
        typeof splice !== 'object' ||
        !Number.isSafeInteger(splice.index) ||
        splice.index < 0
      ) {
        throw new RangeError('text splice index must be a non-negative safe integer');
      }
      if (!Number.isSafeInteger(splice.deleteCount) || splice.deleteCount < 0) {
        throw new RangeError('text delete count must be a non-negative safe integer');
      }
      if (typeof splice.insert !== 'string') throw new TypeError('text splice insert must be a string');
      if (splice.deleteCount === 0 && splice.insert.length === 0) continue;

      const boundedIndex = Math.min(splice.index, logLength);
      const actualDeleteCount = Math.min(splice.deleteCount, logLength - boundedIndex);
      let insertCount = 0;
      if (actualDeleteCount !== 0) {
        const recordIndex = tags.length;
        tags[recordIndex] = 3;
        positionDeltas[recordIndex] = boundedIndex - logPreviousIndex;
        logPreviousIndex = boundedIndex;
        counts[recordIndex] = actualDeleteCount;
        logAppendOnly = false;
        logMaterializedText = null;
        nextSeq++;
        logLength -= actualDeleteCount;
      }
      if (splice.insert.length !== 0) {
        insertCount = spliceInsertCodePointLength(splice);
        if (insertCount !== splice.insert.length) spansInsertCodeUnitAligned = false;
        const recordIndex = tags.length;
        tags[recordIndex] = 1;
        positionDeltas[recordIndex] = boundedIndex - logPreviousIndex;
        logPreviousIndex = boundedIndex;
        counts[recordIndex] = insertCount;
        texts[texts.length] = splice.insert;
        if (logMaterializedText !== null) {
          logMaterializedText = boundedIndex === logLength ? logMaterializedText + splice.insert : null;
        }
        if (boundedIndex !== logLength) logAppendOnly = false;
        nextSeq++;
        logLength += insertCount;
      }
    }
    log.previousIndex = logPreviousIndex;
    log.length = logLength;
    log.appendOnly = logAppendOnly;
    log.materializedText = logMaterializedText;
    this.nextSeq = nextSeq;

    const recordEnd = log.tags.length;
    if (recordEnd === recordStart) return this.commitLocal([]);
    const lastSeq = this.nextSeq - 1;
    let spans: TextDirtySpan[] | null = null;
    let beforeTextForPatch: string | null = null;
    const getSpans = () => {
      if (spans === null) {
        spans = this.createNativeTextLogSpans(log, recordStart, recordEnd, recordStartPreviousIndex, recordStartTextIndex);
      }
      return spans;
    };
    const getBeforeTextForPatch = () => {
      if (beforeTextForPatch === null) beforeTextForPatch = materializeNativeTextLog(log, recordStart);
      return beforeTextForPatch;
    };
    this.noteActorRange(this.actorId, firstSeq, lastSeq);
    this.readyHeadsCache = [this.actorIdPrefix + lastSeq];
    this.allReadyCache = true;
    this.stateVectorCache = { [this.actorId]: lastSeq };
    this.sequenceVisibleCache.delete(key);
    this.textSequenceCache.delete(key);
    this.textValueCache.delete(key);
    this.sequenceAppendCache.delete(key);

    let viewPatch: () => Patch;
    if (createdText) {
      const patchPath = path.slice();
      viewPatch = () => createSetPatch(beforeRoot, patchPath, materializeNativeTextLog(log, recordEnd));
    } else if (log.baseSequence !== null) {
      const patchPath = path.slice();
      viewPatch = () => createSetPatch(beforeRoot, patchPath, materializeNativeTextLog(log, recordEnd));
    } else if (beforeCodeUnitAligned && spansInsertCodeUnitAligned) {
      viewPatch = () => createCodeUnitAlignedTextDirtyPatch(path, getSpans());
    } else {
      const patchPath = path.slice();
      viewPatch = () => createTextDirtyPatchFromSpans(
        patchPath,
        getBeforeTextForPatch(),
        getSpans()
      );
    }

    if (this.crdtProfile.enabled) {
      observeCrdtTextTransactionShape(this.crdtProfile, getSpans());
    }
    const heads = [this.actorIdPrefix + lastSeq];
    const stateVector = { [this.actorId]: lastSeq };
    return this.createLocalCommitResult(
      () => this.encodeNativeTextLogOperationUpdate(log, recordStart, recordEnd),
      viewPatch,
      heads,
      stateVector
    );
  }

  private commitCreatedNativeTextSpliceBatch(
    path: JsonPath,
    key: string,
    log: NativePositionalTextLog,
    splices: readonly CrdtTextSplice[],
    beforeRoot: JsonValue
  ): CrdtCommitResult {
    const recordStart = log.tags.length;
    const firstSeq = this.nextSeq;
    const tags = log.tags;
    const positionDeltas = log.positionDeltas;
    const counts = log.counts;
    const texts = log.texts;
    let logPreviousIndex = log.previousIndex;
    const recordStartPreviousIndex = logPreviousIndex;
    const recordStartTextIndex = texts.length;
    let logLength = log.length;
    let logAppendOnly = log.appendOnly;
    let logMaterializedText = log.materializedText;
    let nextSeq = this.nextSeq;
    let lastBatchIndex = 0;

    for (let i = 0, length = splices.length; i < length; i++) {
      const splice = splices[i];
      if (
        splice === null ||
        typeof splice !== 'object' ||
        !Number.isSafeInteger(splice.index) ||
        splice.index < 0
      ) {
        throw new RangeError('text splice index must be a non-negative safe integer');
      }
      if (!Number.isSafeInteger(splice.deleteCount) || splice.deleteCount < 0) {
        throw new RangeError('text delete count must be a non-negative safe integer');
      }
      const insert = splice.insert;
      if (typeof insert !== 'string') throw new TypeError('text splice insert must be a string');
      if (splice.deleteCount === 0 && insert.length === 0) continue;

      const boundedIndex = splice.index < logLength ? splice.index : logLength;
      if (splice.deleteCount !== 0) {
        const actualDeleteCount = Math.min(splice.deleteCount, logLength - boundedIndex);
        if (actualDeleteCount !== 0) {
          const previousRecord = tags.length - 1;
          if (previousRecord >= recordStart && tags[previousRecord] === 3 && boundedIndex === lastBatchIndex) {
            counts[previousRecord] += actualDeleteCount;
          } else {
            const recordIndex = tags.length;
            tags[recordIndex] = 3;
            positionDeltas[recordIndex] = boundedIndex - logPreviousIndex;
            logPreviousIndex = boundedIndex;
            counts[recordIndex] = actualDeleteCount;
            lastBatchIndex = boundedIndex;
            nextSeq++;
          }
          logAppendOnly = false;
          logMaterializedText = null;
          logLength -= actualDeleteCount;
        }
      }
      if (insert.length !== 0) {
        const insertCount = spliceInsertCodePointLength(splice);
        const previousRecord = tags.length - 1;
        if (
          previousRecord >= recordStart &&
          tags[previousRecord] === 1 &&
          boundedIndex === lastBatchIndex + counts[previousRecord]
        ) {
          counts[previousRecord] += insertCount;
          texts[texts.length - 1] += insert;
        } else {
          const recordIndex = tags.length;
          tags[recordIndex] = 1;
          positionDeltas[recordIndex] = boundedIndex - logPreviousIndex;
          logPreviousIndex = boundedIndex;
          counts[recordIndex] = insertCount;
          texts[texts.length] = insert;
          lastBatchIndex = boundedIndex;
          nextSeq++;
        }
        if (logMaterializedText !== null) {
          logMaterializedText = boundedIndex === logLength ? logMaterializedText + insert : null;
        }
        if (boundedIndex !== logLength) logAppendOnly = false;
        logLength += insertCount;
      }
    }

    log.previousIndex = logPreviousIndex;
    log.length = logLength;
    log.appendOnly = logAppendOnly;
    log.materializedText = logMaterializedText;
    this.nextSeq = nextSeq;

    const recordEnd = log.tags.length;
    if (recordEnd === recordStart) return this.commitLocal([]);
    const lastSeq = this.nextSeq - 1;
    this.noteActorRange(this.actorId, firstSeq, lastSeq);
    this.readyHeadsCache = [this.actorIdPrefix + lastSeq];
    this.allReadyCache = true;
    this.stateVectorCache = { [this.actorId]: lastSeq };
    this.sequenceVisibleCache.delete(key);
    this.textSequenceCache.delete(key);
    this.textValueCache.delete(key);
    this.sequenceAppendCache.delete(key);

    if (this.crdtProfile.enabled) {
      observeCrdtTextTransactionShape(
        this.crdtProfile,
        this.createNativeTextLogSpans(log, recordStart, recordEnd, recordStartPreviousIndex, recordStartTextIndex)
      );
    }

    const patchPath = path.slice();
    const heads = [this.actorIdPrefix + lastSeq];
    const stateVector = { [this.actorId]: lastSeq };
    return this.createLocalCommitResult(
      () => this.encodeNativeTextLogOperationUpdate(log, recordStart, recordEnd),
      () => createSetPatch(beforeRoot, patchPath, materializeNativeTextLog(log, recordEnd)),
      heads,
      stateVector
    );
  }

  private commitCreatedNativeTextTupleSpliceBatch(
    path: JsonPath,
    key: string,
    log: NativePositionalTextLog,
    splices: readonly CrdtTextSpliceTuple[],
    beforeRoot: JsonValue
  ): CrdtCommitResult {
    const recordStart = log.tags.length;
    const firstSeq = this.nextSeq;
    const tags = log.tags;
    const positionDeltas = log.positionDeltas;
    const counts = log.counts;
    const texts = log.texts;
    let logPreviousIndex = log.previousIndex;
    const recordStartPreviousIndex = logPreviousIndex;
    const recordStartTextIndex = texts.length;
    let logLength = log.length;
    let logAppendOnly = log.appendOnly;
    let logMaterializedText = log.materializedText;
    let nextSeq = this.nextSeq;
    let lastBatchIndex = 0;

    for (let i = 0, length = splices.length; i < length; i++) {
      const splice = splices[i];
      if (!Array.isArray(splice)) throw new TypeError('text splice tuple must be an array');
      const index = splice[0];
      const deleteCount = splice[1];
      const insert = splice[2];
      if (!Number.isSafeInteger(index) || index < 0) {
        throw new RangeError('text splice index must be a non-negative safe integer');
      }
      if (!Number.isSafeInteger(deleteCount) || deleteCount < 0) {
        throw new RangeError('text delete count must be a non-negative safe integer');
      }
      if (typeof insert !== 'string') throw new TypeError('text splice insert must be a string');
      if (deleteCount === 0 && insert.length === 0) continue;

      const boundedIndex = index < logLength ? index : logLength;
      if (deleteCount !== 0) {
        const actualDeleteCount = Math.min(deleteCount, logLength - boundedIndex);
        if (actualDeleteCount !== 0) {
          const previousRecord = tags.length - 1;
          if (previousRecord >= recordStart && tags[previousRecord] === 3 && boundedIndex === lastBatchIndex) {
            counts[previousRecord] += actualDeleteCount;
          } else {
            const recordIndex = tags.length;
            tags[recordIndex] = 3;
            positionDeltas[recordIndex] = boundedIndex - logPreviousIndex;
            logPreviousIndex = boundedIndex;
            counts[recordIndex] = actualDeleteCount;
            lastBatchIndex = boundedIndex;
            nextSeq++;
          }
          logAppendOnly = false;
          logMaterializedText = null;
          logLength -= actualDeleteCount;
        }
      }
      if (insert.length !== 0) {
        const insertCount = tupleSpliceInsertCodePointLength(splice, insert);
        const previousRecord = tags.length - 1;
        if (
          previousRecord >= recordStart &&
          tags[previousRecord] === 1 &&
          boundedIndex === lastBatchIndex + counts[previousRecord]
        ) {
          counts[previousRecord] += insertCount;
          texts[texts.length - 1] += insert;
        } else {
          const recordIndex = tags.length;
          tags[recordIndex] = 1;
          positionDeltas[recordIndex] = boundedIndex - logPreviousIndex;
          logPreviousIndex = boundedIndex;
          counts[recordIndex] = insertCount;
          texts[texts.length] = insert;
          lastBatchIndex = boundedIndex;
          nextSeq++;
        }
        if (logMaterializedText !== null) {
          logMaterializedText = boundedIndex === logLength ? logMaterializedText + insert : null;
        }
        if (boundedIndex !== logLength) logAppendOnly = false;
        logLength += insertCount;
      }
    }

    log.previousIndex = logPreviousIndex;
    log.length = logLength;
    log.appendOnly = logAppendOnly;
    log.materializedText = logMaterializedText;
    this.nextSeq = nextSeq;

    const recordEnd = log.tags.length;
    if (recordEnd === recordStart) return this.commitLocal([]);
    const lastSeq = this.nextSeq - 1;
    this.noteActorRange(this.actorId, firstSeq, lastSeq);
    this.readyHeadsCache = [this.actorIdPrefix + lastSeq];
    this.allReadyCache = true;
    this.stateVectorCache = { [this.actorId]: lastSeq };
    this.sequenceVisibleCache.delete(key);
    this.textSequenceCache.delete(key);
    this.textValueCache.delete(key);
    this.sequenceAppendCache.delete(key);

    if (this.crdtProfile.enabled) {
      observeCrdtTextTransactionShape(
        this.crdtProfile,
        this.createNativeTextLogSpans(log, recordStart, recordEnd, recordStartPreviousIndex, recordStartTextIndex)
      );
    }

    const patchPath = path.slice();
    const heads = [this.actorIdPrefix + lastSeq];
    const stateVector = { [this.actorId]: lastSeq };
    return this.createLocalCommitResult(
      () => this.encodeNativeTextLogOperationUpdate(log, recordStart, recordEnd),
      () => createSetPatch(beforeRoot, patchPath, materializeNativeTextLog(log, recordEnd)),
      heads,
      stateVector
    );
  }

  private tryCommitNativeTextSpliceColumns(
    path: JsonPath,
    indexes: ArrayLike<number>,
    deleteCounts: ArrayLike<number>,
    inserts: ArrayLike<string>,
    insertLengths: ArrayLike<number> | undefined,
    spliceCount: number,
    sequenceKey?: string
  ): CrdtCommitResult | null {
    const key = sequenceKey === undefined ? sequenceCacheKey(path, 'text') : sequenceKey;
    let log = this.nativeTextLog;
    let createdText: boolean;
    const beforeRoot = this.viewValue;
    if (log !== null) {
      if (!this.canUseNativeTextLog(path, key, undefined)) return null;
      createdText = log.createdText;
    } else {
      const current = valueAtPath(this.viewValue, path);
      if (!this.canUseNativeTextLog(path, key, current)) return null;
      const cachedTextBefore = this.textValueCache.get(key);
      const currentText = current === undefined
        ? cachedTextBefore === undefined ? '' : cachedTextBefore.value.toString()
        : current as string;
      createdText = current === undefined && cachedTextBefore === undefined;
      const beforeCodeUnitAligned = !createdText && currentText.length === codePointLength(currentText);
      const baseSequence = this.operationLog.length === 0
        ? null
        : this.createNativeTextLogBaseSequence(path, key, currentText);
      if (this.operationLog.length !== 0 && baseSequence === null) return null;
      log = this.getOrCreateNativeTextLog(path, key, currentText, createdText, beforeCodeUnitAligned, baseSequence);
    }
    if (!createdText || log.initialText.length !== 0) return null;
    return this.commitCreatedNativeTextColumnSpliceBatch(
      path,
      key,
      log,
      indexes,
      deleteCounts,
      inserts,
      insertLengths,
      spliceCount,
      beforeRoot
    );
  }

  private commitCreatedNativeTextColumnSpliceBatch(
    path: JsonPath,
    key: string,
    log: NativePositionalTextLog,
    indexes: ArrayLike<number>,
    deleteCounts: ArrayLike<number>,
    inserts: ArrayLike<string>,
    insertLengths: ArrayLike<number> | undefined,
    spliceCount: number,
    beforeRoot: JsonValue
  ): CrdtCommitResult {
    const recordStart = log.tags.length;
    const firstSeq = this.nextSeq;
    const tags = log.tags;
    const positionDeltas = log.positionDeltas;
    const counts = log.counts;
    const texts = log.texts;
    let logPreviousIndex = log.previousIndex;
    const recordStartPreviousIndex = logPreviousIndex;
    const recordStartTextIndex = texts.length;
    let logLength = log.length;
    let logAppendOnly = log.appendOnly;
    let nextSeq = this.nextSeq;
    let lastBatchIndex = 0;
    let recordIndex = recordStart;
    let textIndex = texts.length;
    const trustedIntegerColumns = indexes instanceof Uint32Array &&
      deleteCounts instanceof Uint32Array &&
      (insertLengths === undefined || insertLengths instanceof Uint32Array);
    const trustedInsertLengths = trustedIntegerColumns && insertLengths !== undefined
      ? insertLengths
      : undefined;

    for (let i = 0; i < spliceCount; i++) {
      const index = indexes[i];
      const deleteCount = deleteCounts[i];
      const insert = inserts[i];
      if (typeof insert !== 'string') throw new TypeError('text splice insert must be a string');
      const insertCodeUnits = insert.length;
      if (!trustedIntegerColumns) {
        if (!Number.isSafeInteger(index) || index < 0) {
          throw new RangeError('text splice index must be a non-negative safe integer');
        }
        if (!Number.isSafeInteger(deleteCount) || deleteCount < 0) {
          throw new RangeError('text delete count must be a non-negative safe integer');
        }
      }
      if (deleteCount === 0 && insertCodeUnits === 0) continue;

      const boundedIndex = index < logLength ? index : logLength;
      if (deleteCount !== 0) {
        const remaining = logLength - boundedIndex;
        const actualDeleteCount = deleteCount < remaining ? deleteCount : remaining;
        if (actualDeleteCount !== 0) {
          const previousRecord = recordIndex - 1;
          if (previousRecord >= recordStart && tags[previousRecord] === 3 && boundedIndex === lastBatchIndex) {
            counts[previousRecord] += actualDeleteCount;
          } else {
            tags[recordIndex] = 3;
            positionDeltas[recordIndex] = boundedIndex - logPreviousIndex;
            logPreviousIndex = boundedIndex;
            counts[recordIndex] = actualDeleteCount;
            recordIndex++;
            lastBatchIndex = boundedIndex;
            nextSeq++;
          }
          logAppendOnly = false;
          logLength -= actualDeleteCount;
        }
      }
      if (insertCodeUnits !== 0) {
        const hintedLength = trustedInsertLengths === undefined ? undefined : trustedInsertLengths[i];
        const insertCount = hintedLength !== undefined
          ? insertCodeUnits <= 1 ? insertCodeUnits : hintedLength
          : columnSpliceInsertCodePointLength(insert, hintedLength);
        const previousRecord = recordIndex - 1;
        if (
          previousRecord >= recordStart &&
          tags[previousRecord] === 1 &&
          boundedIndex === lastBatchIndex + counts[previousRecord]
        ) {
          counts[previousRecord] += insertCount;
          texts[textIndex - 1] += insert;
        } else {
          tags[recordIndex] = 1;
          positionDeltas[recordIndex] = boundedIndex - logPreviousIndex;
          logPreviousIndex = boundedIndex;
          counts[recordIndex] = insertCount;
          texts[textIndex++] = insert;
          recordIndex++;
          lastBatchIndex = boundedIndex;
          nextSeq++;
        }
        if (boundedIndex !== logLength) logAppendOnly = false;
        logLength += insertCount;
      }
    }
    tags.length = recordIndex;
    positionDeltas.length = recordIndex;
    counts.length = recordIndex;
    texts.length = textIndex;

    log.previousIndex = logPreviousIndex;
    log.length = logLength;
    log.appendOnly = logAppendOnly;
    log.materializedText = null;
    this.nextSeq = nextSeq;

    const recordEnd = recordIndex;
    if (recordEnd === recordStart) return this.commitLocal([]);
    const lastSeq = this.nextSeq - 1;
    this.noteActorRange(this.actorId, firstSeq, lastSeq);
    this.readyHeadsCache = [this.actorIdPrefix + lastSeq];
    this.allReadyCache = true;
    this.stateVectorCache = { [this.actorId]: lastSeq };
    this.sequenceVisibleCache.delete(key);
    this.textSequenceCache.delete(key);
    this.textValueCache.delete(key);
    this.sequenceAppendCache.delete(key);

    if (this.crdtProfile.enabled) {
      observeCrdtTextTransactionShape(
        this.crdtProfile,
        this.createNativeTextLogSpans(log, recordStart, recordEnd, recordStartPreviousIndex, recordStartTextIndex)
      );
    }

    const patchPath = path.slice();
    const heads = [this.actorIdPrefix + lastSeq];
    const stateVector = { [this.actorId]: lastSeq };
    return this.createLocalCommitResult(
      () => this.encodeNativeTextLogOperationUpdate(log, recordStart, recordEnd),
      () => createSetPatch(beforeRoot, patchPath, materializeNativeTextLog(log, recordEnd)),
      heads,
      stateVector
    );
  }

  _commitLocalTextSplice(path: JsonPath, index: number, deleteCount: number, insert: string, encodedPath?: string, sequenceKey?: string): CrdtCommitResult {
    if (!Number.isSafeInteger(index) || index < 0) throw new RangeError('text index must be a non-negative safe integer');
    if (!Number.isSafeInteger(deleteCount) || deleteCount < 0) throw new RangeError('text delete count must be a non-negative safe integer');
    if (typeof insert !== 'string') throw new TypeError('text splice insert must be a string');
    const native = this.tryCommitNativeTextSpliceBatch(path, [{ index, deleteCount, insert }], encodedPath, sequenceKey);
    if (native !== null) return native;
    this.flushPendingNativeTextBeforeGeneric();
    if (deleteCount === 0) return insert.length === 0 ? this.commitLocal([]) : this._commitLocalTextInsert(path, index, insert, encodedPath, sequenceKey);
    if (insert.length === 0) return this._commitLocalTextDelete(path, index, deleteCount, encodedPath, sequenceKey);

    const current = valueAtPath(this.viewValue, path);
    const key = sequenceKey === undefined ? sequenceCacheKey(path, 'text') : sequenceKey;
    const sequence = this.getTextSequenceCached(path, current, key);
    const boundedIndex = Math.min(index, sequence.length);
    const deletePayload = createTextDeleteOperationPayloadFromSequence(sequence, boundedIndex, deleteCount);
    if (deletePayload === null) return this._commitLocalTextInsert(path, boundedIndex, insert, encodedPath, sequenceKey);
    const ops: CrdtOperation[] = [this.createTextDeleteOperationWithDeps(path, deletePayload, this.getReadyHeadsForOperation())];
    const after = boundedIndex === 0 ? null : sequence.at(boundedIndex - 1);
    const insertOp = this.createTextInsertOperationWithDeps(path, after, insert, EMPTY_TRANSACTION_HEADS);
    const insertCount = insert.length === 1 ? 1 : codePointLength(insert);
    ops[ops.length] = insertOp;
    sequence.delete(boundedIndex, deletePayload.count);
    sequence.insertCreated(boundedIndex, insertOp, insertCount);
    return this.commitLocal(
      ops,
      [{ path: path.slice(), index: boundedIndex, deleteCount: deletePayload.count, insert }],
      { key, path: path.slice(), sequence }
    );
  }

  _commitLocalTextSpliceColumns(
    path: JsonPath,
    indexes: ArrayLike<number>,
    deleteCounts: ArrayLike<number>,
    inserts: ArrayLike<string>,
    insertLengths?: ArrayLike<number>,
    encodedPath?: string,
    sequenceKey?: string
  ): CrdtCommitResult {
    const spliceCount = readCrdtTextSpliceColumnLength(indexes, deleteCounts, inserts, insertLengths);
    if (spliceCount === 0) return this.commitLocal([]);
    const native = this.tryCommitNativeTextSpliceColumns(
      path,
      indexes,
      deleteCounts,
      inserts,
      insertLengths,
      spliceCount,
      sequenceKey
    );
    if (native !== null) return native;
    const splices = new Array<CrdtTextSplice>(spliceCount);
    for (let i = 0; i < spliceCount; i++) {
      splices[i] = {
        index: indexes[i],
        deleteCount: deleteCounts[i],
        insert: inserts[i],
        insertLength: insertLengths === undefined ? undefined : insertLengths[i]
      };
    }
    return this._commitLocalTextSpliceBatch(path, splices, encodedPath, sequenceKey);
  }

  _commitLocalTextSpliceBatch(path: JsonPath, splices: readonly CrdtTextSpliceInput[], encodedPath?: string, sequenceKey?: string): CrdtCommitResult {
    if (!Array.isArray(splices)) throw new TypeError('text splice batch must be an array');
    if (splices.length === 0) return this.commitLocal([]);
    const native = this.tryCommitNativeTextSpliceBatch(path, splices, encodedPath, sequenceKey);
    if (native !== null) return native;
    this.flushPendingNativeTextBeforeGeneric();
    const objectSplices = Array.isArray(splices[0])
      ? normalizeCrdtTextSpliceBatch(splices)
      : splices as readonly CrdtTextSplice[];
    const current = valueAtPath(this.viewValue, path);
    const key = sequenceKey === undefined ? sequenceCacheKey(path, 'text') : sequenceKey;
    const sequence = this.getTextSequenceCached(path, current, key);
    const canApplyTextValue = current === undefined || typeof current === 'string';
    const beforeRoot = this.viewValue;
    const cachedTextBefore = canApplyTextValue ? this.textValueCache.get(key) : undefined;
    const textValue = canApplyTextValue
      ? this.getTextValueCached(path, current === undefined ? '' : current as string, key)
      : null;
    const createdText = textValue !== null && current === undefined && cachedTextBefore === undefined;
    const beforeCodeUnitAligned = textValue !== null && !createdText && textValue.isCodeUnitAligned();
    const beforeTextForPatch = textValue !== null && !createdText && !beforeCodeUnitAligned
      ? current === undefined
        ? textValue.toString()
        : current as string
      : '';
    const ops: CrdtOperation[] = [];
    const spans: TextDirtySpan[] = [];
    let firstDeps: string[] | null = null;
    let lastOpId: string | null = null;
    let mayCompactTextRuns = false;
    let spansInsertCodeUnitAligned = true;

    for (let i = 0, length = objectSplices.length; i < length; i++) {
      const splice = objectSplices[i];
      if (
        splice === null ||
        typeof splice !== 'object' ||
        !Number.isSafeInteger(splice.index) ||
        splice.index < 0
      ) {
        throw new RangeError('text splice index must be a non-negative safe integer');
      }
      if (!Number.isSafeInteger(splice.deleteCount) || splice.deleteCount < 0) {
        throw new RangeError('text delete count must be a non-negative safe integer');
      }
      if (typeof splice.insert !== 'string') throw new TypeError('text splice insert must be a string');
      if (splice.deleteCount === 0 && splice.insert.length === 0) continue;

      const boundedIndex = Math.min(splice.index, sequence.length);
      let insertAfter: string | null | undefined;
      if (splice.insert.length !== 0 && splice.deleteCount !== 0) {
        insertAfter = boundedIndex === 0 ? null : sequence.at(boundedIndex - 1);
      }
      let insertCount = 0;
      let actualDeleteCount = 0;
      if (splice.deleteCount !== 0) {
        const deletePayload = splice.deleteCount >= CRDT_TEXT_BATCH_DELETE_RANGE_MIN
          ? createTextDeleteOperationPayloadFromSequence(sequence, boundedIndex, splice.deleteCount)
          : null;
	        if (deletePayload !== null) {
          actualDeleteCount = deletePayload.count;
          const op = this.createTextDeleteOperationWithDeps(
            path,
            deletePayload,
            lastOpId === null
              ? (firstDeps = firstDeps === null ? this.getReadyHeadsForOperation() : firstDeps)
              : [lastOpId]
          );
	          ops[ops.length] = op;
	          lastOpId = op.id;
	          sequence.delete(boundedIndex, actualDeleteCount);
	        } else {
          const deleted = sequence.deleteSlice(boundedIndex, splice.deleteCount);
          if (deleted.length !== 0) {
            actualDeleteCount = deleted.length;
            const op = this.createTextDeleteOperationWithDeps(
              path,
              {
                type: 'textDel',
                elems: deleted,
                count: actualDeleteCount
              },
              lastOpId === null
                ? (firstDeps = firstDeps === null ? this.getReadyHeadsForOperation() : firstDeps)
                : [lastOpId]
	            );
	            ops[ops.length] = op;
	            lastOpId = op.id;
	          }
	        }
	      }

      if (splice.insert.length !== 0) {
	        insertCount = spliceInsertCodePointLength(splice);
        if (insertCount === 1) mayCompactTextRuns = true;
	        if (insertCount !== splice.insert.length) spansInsertCodeUnitAligned = false;
        const insertIndex = boundedIndex;
        const after = insertAfter !== undefined
          ? insertAfter
          : insertIndex === 0
            ? null
            : insertIndex === sequence.length
              ? sequence.tail()
              : sequence.at(insertIndex - 1);
	        const op = this.createTextInsertOperationWithDeps(
	          path,
	          after,
	          splice.insert,
          lastOpId === null
            ? (firstDeps = firstDeps === null ? this.getReadyHeadsForOperation() : firstDeps)
	            : [lastOpId]
	        );
	        ops[ops.length] = op;
	        lastOpId = op.id;
	        sequence.insertCreated(insertIndex, op, insertCount);
	      }
      appendTextDirtySpan(spans, path, boundedIndex, actualDeleteCount, splice.insert, false);
      if (textValue !== null) textValue.splice(boundedIndex, actualDeleteCount, splice.insert, insertCount);
    }

    if (ops.length === 0) return this.commitLocal([]);
    if (textValue !== null && spans.length !== 0) {
      let viewPatch: () => Patch;
      if (createdText) {
        const value = textValue.toString();
        const patchPath = path.slice();
        viewPatch = () => createSetPatch(beforeRoot, patchPath, value);
      } else if (beforeCodeUnitAligned && spansInsertCodeUnitAligned) {
        viewPatch = () => createCodeUnitAlignedTextDirtyPatch(path, spans);
      } else {
        const patchPath = path.slice();
        viewPatch = () => createTextDirtyPatchFromSpans(patchPath, beforeTextForPatch, spans);
      }
      return this.commitLocalWithAppliedTextDirtyPatch(ops, spans, { key, path: path.slice(), sequence }, viewPatch, true, mayCompactTextRuns);
    }
    return this.commitLocal(ops, spans, { key, path: path.slice(), sequence }, true);
  }

  _visibleListElementIds(path: JsonPath): string[] {
    return this.getVisibleElementIdsCached(path, 'list');
  }

  _visibleTextElementIds(path: JsonPath): string[] {
    const key = sequenceCacheKey(path, 'text');
    const sequence = this.textSequenceCache.get(key);
    return sequence === undefined ? this.getVisibleElementIdsCached(path, 'text', key) : sequence.toArray();
  }

  _sequenceAppendState(path: JsonPath, kind: 'list' | 'text'): SequenceAppendState | null {
    return this.getSequenceAppendState(path, kind, valueAtPath(this.viewValue, path));
  }

  private createDirectSingleReadyPatch(before: JsonValue, op: CrdtOperation): Patch | null {
    if (op.type === 'textInsert') {
      const current = valueAtPath(before, op.path);
      if (typeof current === 'string') {
        const key = sequenceCacheKey(op.path, 'text');
        const append = this.sequenceAppendCache.get(key);
        if (append !== undefined && append.tail === op.after) {
          return [[OP_STRING_SPLICE, op.path.slice(), current.length, 0, op.text]];
        }
      }
    }
    return createDominatingPatch(
      before,
      op,
      (path, kind) => this.getVisibleElementIdsCached(path, kind),
      (path, kind, after) => this.getSequenceIndexAfterCached(path, kind, after)
    );
  }

  private createOperation(type: CrdtOperation['type'], path: JsonPath, payload: Record<string, unknown>): CrdtOperation {
    const seq = this.nextSeq++;
    const op = {
      id: this.actorIdPrefix + seq,
      actor: this.actorId,
      seq,
      deps: this.getReadyHeadsForOperation(),
      type,
      path,
      ...payload
    } as CrdtOperation;
    return op;
  }

  private createSetOperation(path: JsonPath, value: JsonValue): Extract<CrdtOperation, { type: 'set' }> {
    const seq = this.nextSeq++;
    return {
      id: this.actorIdPrefix + seq,
      actor: this.actorId,
      seq,
      deps: this.getReadyHeadsForOperation(),
      type: 'set',
      path,
      value
    };
  }

  private createDeleteOperation(path: JsonPath): Extract<CrdtOperation, { type: 'del' }> {
    const seq = this.nextSeq++;
    return {
      id: this.actorIdPrefix + seq,
      actor: this.actorId,
      seq,
      deps: this.getReadyHeadsForOperation(),
      type: 'del',
      path
    };
  }

  private createCounterOperation(path: JsonPath, delta: number): Extract<CrdtOperation, { type: 'counter' }> {
    const seq = this.nextSeq++;
    return {
      id: this.actorIdPrefix + seq,
      actor: this.actorId,
      seq,
      deps: this.getReadyHeadsForOperation(),
      type: 'counter',
      path,
      delta
    };
  }

  private createBinarySetOperation(path: JsonPath, bytes: string): Extract<CrdtOperation, { type: 'binarySet' }> {
    const seq = this.nextSeq++;
    return {
      id: this.actorIdPrefix + seq,
      actor: this.actorId,
      seq,
      deps: this.getReadyHeadsForOperation(),
      type: 'binarySet',
      path,
      bytes
    };
  }

  private createTreeCreateOperation(path: JsonPath, nodeId: string, parent: string | null, after: string | null, value: JsonValue): Extract<CrdtOperation, { type: 'treeCreate' }> {
    const seq = this.nextSeq++;
    return {
      id: this.actorIdPrefix + seq,
      actor: this.actorId,
      seq,
      deps: this.getReadyHeadsForOperation(),
      type: 'treeCreate',
      path,
      nodeId,
      parent,
      after,
      value
    };
  }

  private createTreeMoveOperation(path: JsonPath, nodeId: string, parent: string | null, after: string | null): Extract<CrdtOperation, { type: 'treeMove' }> {
    const seq = this.nextSeq++;
    return {
      id: this.actorIdPrefix + seq,
      actor: this.actorId,
      seq,
      deps: this.getReadyHeadsForOperation(),
      type: 'treeMove',
      path,
      nodeId,
      parent,
      after
    };
  }

  private createTreeSetOperation(path: JsonPath, nodeId: string, value: JsonValue): Extract<CrdtOperation, { type: 'treeSet' }> {
    const seq = this.nextSeq++;
    return {
      id: this.actorIdPrefix + seq,
      actor: this.actorId,
      seq,
      deps: this.getReadyHeadsForOperation(),
      type: 'treeSet',
      path,
      nodeId,
      value
    };
  }

  private createTreeDeleteOperation(path: JsonPath, nodeId: string): Extract<CrdtOperation, { type: 'treeDel' }> {
    const seq = this.nextSeq++;
    return {
      id: this.actorIdPrefix + seq,
      actor: this.actorId,
      seq,
      deps: this.getReadyHeadsForOperation(),
      type: 'treeDel',
      path,
      nodeId
    };
  }

  private createListInsertOperation(path: JsonPath, after: string | null, values: JsonValue[]): Extract<CrdtOperation, { type: 'listInsert' }> {
    const seq = this.nextSeq++;
    return {
      id: this.actorIdPrefix + seq,
      actor: this.actorId,
      seq,
      deps: this.getReadyHeadsForOperation(),
      type: 'listInsert',
      path,
      after,
      values
    };
  }

  private createTextInsertOperation(path: JsonPath, after: string | null, text: string): Extract<CrdtOperation, { type: 'textInsert' }> {
    const seq = this.nextSeq++;
    return {
      id: this.actorIdPrefix + seq,
      actor: this.actorId,
      seq,
      deps: this.getReadyHeadsForOperation(),
      type: 'textInsert',
      path,
      after,
      text
    };
  }

  private createTextInsertOperationWithDeps(
    path: JsonPath,
    after: string | null,
    text: string,
    deps: string[]
  ): Extract<CrdtOperation, { type: 'textInsert' }> {
    const seq = this.nextSeq++;
    return {
      id: this.actorIdPrefix + seq,
      actor: this.actorId,
      seq,
      deps,
      type: 'textInsert',
      path,
      after,
      text
    };
  }

  private createTextDeleteOperation(path: JsonPath, payload: TextDeleteOperationPayload): CrdtTextDeleteOperation {
    return payload.type === 'textDel'
      ? this.createOperation('textDel', path, { elems: payload.elems }) as Extract<CrdtOperation, { type: 'textDel' }>
      : this.createOperation('textDelRange', path, payload.range) as Extract<CrdtOperation, { type: 'textDelRange' }>;
  }

  private createTextDeleteOperationWithDeps(
    path: JsonPath,
    payload: TextDeleteOperationPayload,
    deps: string[]
  ): CrdtTextDeleteOperation {
    const seq = this.nextSeq++;
    return payload.type === 'textDel'
      ? {
          id: this.actorIdPrefix + seq,
          actor: this.actorId,
          seq,
          deps,
          type: 'textDel',
          path,
          elems: payload.elems
        }
      : {
          id: this.actorIdPrefix + seq,
          actor: this.actorId,
          seq,
          deps,
          type: 'textDelRange',
          path,
          start: payload.range.start,
          count: payload.range.count,
          span: payload.range.span
        };
  }

  private observeLocalTextTransaction(path: JsonPath, index: number, deleteCount: number, insert: string): void {
    if (!this.crdtProfile.enabled) return;
    observeCrdtTextTransactionShape(this.crdtProfile, [{ path: path.slice(), index, deleteCount, insert }]);
  }

  private commitLocal(
    ops: CrdtOperation[],
    textDirtySpans?: TextDirtySpan[] | null,
    textDirtySequences?: TextDirtySequenceSource | null,
    depsAlreadyChained = false,
    metadata?: JsonObject
  ): CrdtCommitResult {
    const hasTextDirtySpans = !!(textDirtySpans && textDirtySpans.length !== 0);
    if (!hasTextDirtySpans) this.flushTextValueCache();
    if (ops.length === 0) {
      return this.createLocalCommitResult(() => encodeTrustedCrdtUpdate({
          actor: this.actorId,
          seq: this.nextSeq - 1,
          deps: this.getReadyHeadsCached(),
          ops: []
        }),
        [],
        this.getReadyHeadsCached(),
        this.getStateVectorCached(),
        metadata
      );
    }
    this.flushNativeTextLogToOperations();

    if (!depsAlreadyChained) {
      for (let i = 1; i < ops.length; i++) {
        ops[i].deps = [operationHeadId(ops[i - 1])];
      }
    }
    if (ops.length > 1) ops = compactCrdtOperationRuns(ops);
    if (hasTextDirtySpans && this.crdtProfile.enabled) observeCrdtTextTransactionShape(this.crdtProfile, textDirtySpans);

	    let before = this.viewValue;
	    let usedTextDirtyPatch = false;
	    let directPatch: Patch | (() => Patch) | null = hasTextDirtySpans
	      ? this.applyTextDirtySpans(textDirtySpans as TextDirtySpan[])
	      : null;
	    if (directPatch !== null) usedTextDirtyPatch = true;
    if (directPatch === null) {
      if (hasTextDirtySpans) {
        this.flushTextValueCache();
        before = this.viewValue;
      }
      directPatch = ops.length === 1
        ? createDominatingPatch(
            before,
            ops[0],
            (path, kind) => this.getVisibleElementIdsCached(path, kind),
            (path, kind, after) => this.getSequenceIndexAfterCached(path, kind, after)
          )
        : createDominatingBatchPatch(
            before,
            ops,
            (path, kind) => this.getVisibleElementIdsCached(path, kind),
            (path, kind, after) => this.getSequenceIndexAfterCached(path, kind, after)
          );
    }
	    this.addLocalOperations(ops);
	    let viewPatch: Patch | (() => Patch);
	    if (directPatch !== null) {
	      viewPatch = directPatch;
	      if (!usedTextDirtyPatch) this.viewValue = applyDirectPatchToView(this.viewValue, viewPatch as Patch);
      if (usedTextDirtyPatch) {
        this.noteDirectTextDirtyOperationsApplied(ops, textDirtySpans, textDirtySequences || null, true);
      } else {
        this.noteDirectOperationsApplied(ops);
      }
    } else {
      this.viewValue = materialize(this.getReadyOperationsForRead());
      this.clearRuntimeCaches();
      viewPatch = diff(before, this.viewValue);
    }
    const update = {
      actor: this.actorId,
      seq: this.nextSeq - 1,
      deps: ops[0].deps,
      ops,
      metadata: metadata === undefined ? undefined : cloneJson(metadata)
    };
    this.recordCommitMetadataForOps(ops, metadata);
    return this.createLocalCommitResult(
      () => metadata === undefined && ops.length === 1 && operationSeqSpan(ops[0]) === 1 ? this.encodeSingleLocalUpdate(ops[0]) : encodeTrustedCrdtUpdate(update),
      viewPatch,
      this.getReadyHeadsCached(),
      this.getStateVectorCached(),
      metadata
    );
  }

  private commitLocalWithAppliedTextDirtyPatch(
    ops: CrdtOperation[],
    textDirtySpans: TextDirtySpan[],
    textDirtySequences: TextDirtySequenceSource,
    viewPatch: () => Patch,
    localCausalRun = false,
    compactRuns = true
  ): CrdtCommitResult {
    if (compactRuns && ops.length > 1) ops = compactCrdtOperationRuns(ops);
    if (this.crdtProfile.enabled) observeCrdtTextTransactionShape(this.crdtProfile, textDirtySpans);
    this.addLocalOperations(ops);
    this.noteDirectTextDirtyOperationsApplied(ops, textDirtySpans, textDirtySequences, localCausalRun);
    const update = {
      actor: this.actorId,
      seq: this.nextSeq - 1,
      deps: ops[0].deps,
      ops
    };
    const heads = localCausalRun ? [this.actorIdPrefix + (this.nextSeq - 1)] : this.getReadyHeadsCached();
    return this.createLocalCommitResult(
      () => ops.length === 1 && operationSeqSpan(ops[0]) === 1 ? this.encodeSingleLocalUpdate(ops[0]) : encodeTrustedCrdtUpdate(update),
      viewPatch,
      heads,
      this.getStateVectorCached()
    );
  }

	  private applyTextDirtySpans(spans: TextDirtySpan[]): (() => Patch) | null {
    if (spans.length === 1) {
      const span = spans[0];
      const current = valueAtPath(this.viewValue, span.path);
      if (current !== undefined && typeof current !== 'string') return null;
      const before = this.viewValue;
      const key = sequenceCacheKey(span.path, 'text');
      const cachedBefore = this.textValueCache.has(key);
      const currentText = current === undefined ? '' : current as string;
      const textValue = this.getTextValueCached(span.path, currentText, key);
      const createdText = current === undefined && !cachedBefore;
      const beforeCodeUnitAligned = !createdText && textValue.isCodeUnitAligned();
      textValue.splice(span.index, span.deleteCount, span.insert);
      if (createdText) {
        const value = textValue.toString();
        return () => createSetPatch(before, span.path, value);
      }
      return () => beforeCodeUnitAligned && textDirtySpanInsertIsCodeUnitAligned(span)
        ? createCodeUnitAlignedTextDirtyPatch(span.path, spans, 0, 1)
        : createTextDirtyPatchFromSpans(span.path, currentText, spans, 0, 1);
    }
    let singlePath = true;
    const firstPath = spans[0].path;
    for (let i = 1, length = spans.length; i < length; i++) {
      if (spans[i].path !== firstPath && !samePath(firstPath, spans[i].path)) {
        singlePath = false;
        break;
      }
    }
    if (singlePath) {
      const current = valueAtPath(this.viewValue, firstPath);
      if (current !== undefined && typeof current !== 'string') return null;
      const before = this.viewValue;
      const key = sequenceCacheKey(firstPath, 'text');
      const cachedBefore = this.textValueCache.has(key);
      const currentText = current === undefined ? '' : current as string;
      const textValue = this.getTextValueCached(firstPath, currentText, key);
      const createdText = current === undefined && !cachedBefore;
      const beforeCodeUnitAligned = !createdText && textValue.isCodeUnitAligned();
      for (let i = 0, length = spans.length; i < length; i++) {
        const span = spans[i];
        textValue.splice(span.index, span.deleteCount, span.insert);
      }
      if (createdText) {
        const value = textValue.toString();
        return () => createSetPatch(before, firstPath, value);
      }
      return () => beforeCodeUnitAligned && textDirtySpansInsertAreCodeUnitAligned(spans)
        ? createCodeUnitAlignedTextDirtyPatch(firstPath, spans)
        : createTextDirtyPatchFromSpans(firstPath, currentText, spans);
    }
		    const textValues = new Array<ChunkedTextValue>(spans.length);
	    const beforeByKey = new Map<string, { path: JsonPath; value: string }>();
	    for (let i = 0, length = spans.length; i < length; i++) {
	      const span = spans[i];
	      const key = sequenceCacheKey(span.path, 'text');
	      const current = valueAtPath(this.viewValue, span.path);
	      if (typeof current !== 'string') return null;
	      if (!beforeByKey.has(key)) beforeByKey.set(key, { path: span.path.slice(), value: current });
	      textValues[i] = this.getTextValueCached(span.path, current, key);
	    }
	    for (let i = 0, length = spans.length; i < length; i++) {
	      const span = spans[i];
	      const textValue = textValues[i];
	      textValue.splice(span.index, span.deleteCount, span.insert);
	    }
	    return () => createTextDirtyPatchFromMixedSpans(spans, beforeByKey);
	  }

		  private getTextValueForDirtySpan(path: JsonPath): ChunkedTextValue | null {
	    const key = sequenceCacheKey(path, 'text');
	    const cached = this.textValueCache.get(key);
	    if (cached !== undefined) return cached.value;
	    const current = valueAtPath(this.viewValue, path);
	    if (typeof current !== 'string') return null;
	    return this.getTextValueCached(path, current, key);
	  }

  private tryApplyReadyTextAppend(
    update: CrdtUpdate,
    op: CrdtOperation,
    encodedInput: Uint8Array | null
  ): CrdtCommitResult | null {
    if (op.type !== 'textInsert' && op.type !== 'textRun') return null;
    const key = sequenceCacheKey(op.path, 'text');
    const cachedText = this.textValueCache.get(key);
    let current: JsonValue | undefined;
    const cachedAppend = this.sequenceAppendCache.get(key);
    const append = cachedAppend === undefined
      ? this.getSequenceAppendState(op.path, 'text', current = valueAtPath(this.viewValue, op.path), key)
      : cachedAppend;
    if (cachedAppend !== undefined && cachedText === undefined) current = valueAtPath(this.viewValue, op.path);
    if (append === null || append.tail !== op.after) return null;

    const insertText = op.text;
    const count = op.type === 'textRun'
      ? op.count
      : insertText.length === 1
        ? 1
        : codePointLength(insertText);
    if (count <= 0) return null;

    const insertIndex = append.length;
    let viewPatch: Patch | (() => Patch);
    if (cachedText !== undefined || typeof current === 'string') {
      const textValue = cachedText === undefined
        ? this.getTextValueCached(op.path, current as string, key)
        : cachedText.value;
      const offset = textValue.codeUnitOffset(insertIndex);
      textValue.insert(insertIndex, insertText, count);
      viewPatch = () => [[OP_STRING_SPLICE, op.path.slice(), offset, 0, insertText]] as Patch;
    } else if (current === undefined) {
      viewPatch = createSetPatch(this.viewValue, op.path, insertText);
      this.viewValue = setPath(this.viewValue, op.path, insertText);
    } else {
      return null;
    }

    this.addOperation(op);
    this.recordCommitMetadataForUpdate([op], update);
    this.catchUpLocalSeq(update);
    this.noteReadyTextAppendApplied(op, key, insertIndex, count);
    return createCrdtCommitResult(
      () => encodedInput === null ? encodeTrustedCrdtUpdate(update) : encodedInput,
      viewPatch,
      this.getReadyHeadsCached(),
      this.getStateVectorCached(),
      undefined,
      update.metadata
    );
  }

  private noteReadyTextAppendApplied(
    op: Extract<CrdtOperation, { type: 'textInsert' | 'textRun' }>,
    key: string,
    index: number,
    count: number
  ): void {
    this.readyHeadsCache = [operationHeadId(op)];
    this.allReadyCache = true;
    this.noteStateVectorDirectOperation(op);

    this.sequenceAppendCache.set(key, { length: index + count, tail: createdElementId(op, count - 1) });

    const sequence = this.textSequenceCache.get(key);
    if (sequence !== undefined) {
      if (index < 0 || index > sequence.length) {
        this.textSequenceCache.delete(key);
      } else {
        sequence.insertCreated(index, op, count);
      }
    }

    const visible = this.sequenceVisibleCache.get(key);
    if (visible === undefined) return;
    if (index < 0 || index > visible.length) {
      this.sequenceVisibleCache.delete(key);
      return;
    }
    insertCreatedElementIds(visible, index, op, count);
  }

	  private createReadyTextDirtyApplication(ops: CrdtOperation[]): TextDirtyApplication | null {
	    const spans: TextDirtySpan[] = [];
	    const sequences = new Map<string, TextDirtySequence>();
	    for (let i = 0, length = ops.length; i < length; i++) {
	      const op = ops[i];
	      if (!isTextSequenceOperation(op)) return null;
	      const key = sequenceCacheKey(op.path, 'text');
	      let entry = sequences.get(key);
	      if (entry === undefined) {
	        const current = valueAtPath(this.viewValue, op.path);
	        if (typeof current !== 'string') return null;
	        entry = {
	          path: op.path.slice(),
	          sequence: this.getTextSequenceCached(op.path, current, key).clone()
	        };
	        sequences.set(key, entry);
	      }

	      if (op.type === 'textInsert' || op.type === 'textRun') {
	        const index = op.after === null ? 0 : entry.sequence.indexOf(op.after) + 1;
	        if (index <= 0 && op.after !== null) return null;
	        const count = op.type === 'textRun' ? op.count : codePointLength(op.text);
	        spans[spans.length] = { path: op.path, index, deleteCount: 0, insert: op.text };
	        entry.sequence.insertCreated(index, op, count);
	      } else if (isTextDeleteOperation(op)) {
	        if (textDeleteCount(op) === 0) continue;
	        const range = sequenceTextDeleteRange(entry.sequence, op);
	        if (range === null) return null;
	        spans[spans.length] = { path: op.path, index: range.index, deleteCount: range.count, insert: '' };
	        entry.sequence.delete(range.index, range.count);
	      }
	    }

	    if (spans.length === 0) return null;
	    const viewPatch = this.applyTextDirtySpans(spans);
	    return viewPatch === null ? null : { spans, sequences, viewPatch };
	  }

	  private commitLocalWithDirectPatch(op: CrdtOperation, viewPatch: Patch, encodedPath?: string): CrdtCommitResult {
    this.addOperation(op);
    this.viewValue = applyDirectPatchToView(this.viewValue, viewPatch);
    return this.finishLocalDirectCommit(op, viewPatch, encodedPath);
  }

  private commitLocalBatchWithDirectPatch(ops: CrdtOperation[], viewPatch: Patch, encodedPath?: string): CrdtCommitResult {
    this.addLocalOperations(ops);
    this.viewValue = applyDirectPatchToView(this.viewValue, viewPatch);
    this.noteDirectOperationsApplied(ops);
    const update = {
      actor: this.actorId,
      seq: this.nextSeq - 1,
      deps: ops[0].deps,
      ops
    };
    return this.createLocalCommitResult(
      () => encodeTrustedCrdtUpdate(update),
      viewPatch,
      this.getReadyHeadsCached(),
      this.getStateVectorCached()
    );
  }

  private commitLocalTreeOperation(op: CrdtOperation, encodedPath?: string): CrdtCommitResult {
    const before = this.viewValue;
    const ready = this.getReadyOperationsForRead();
    ready[ready.length] = op;
    const nextTree = materializeTree(ready, op.path);
    const patch = createSetPatch(before, op.path, nextTree as unknown as JsonValue);
    return this.commitLocalWithDirectPatch(op, patch, encodedPath);
  }

  private finishLocalDirectCommit(op: CrdtOperation, viewPatch: Patch | (() => Patch), encodedPath?: string): CrdtCommitResult {
    this.noteDirectOperationApplied(op);
    return this.finishLocalDirectCommitAfterCacheUpdate(op, viewPatch, encodedPath);
  }

  private finishLocalDirectTextInsertCommit(
    op: Extract<CrdtOperation, { type: 'textInsert' }>,
    viewPatch: Patch | (() => Patch),
    index: number,
    count: number,
    encodedPath?: string,
    sequenceKey?: string
  ): CrdtCommitResult {
    this.noteDirectTextInsertApplied(op, index, count, sequenceKey);
    return this.finishLocalDirectCommitAfterCacheUpdate(op, viewPatch, encodedPath);
  }

  private finishLocalDirectTextDeleteCommit(
    op: CrdtTextDeleteOperation,
    viewPatch: Patch | (() => Patch),
    index: number,
    count: number,
    encodedPath?: string,
    sequenceKey?: string
  ): CrdtCommitResult {
    this.noteDirectTextDeleteApplied(op, index, count, sequenceKey);
    return this.finishLocalDirectCommitAfterCacheUpdate(op, viewPatch, encodedPath);
  }

  private finishLocalDirectCommitAfterCacheUpdate(op: CrdtOperation, viewPatch: Patch | (() => Patch), encodedPath?: string): CrdtCommitResult {
    const heads = [operationHeadId(op)];
    const stateVector = this.getDirectCommitStateVector(op);
    if (this.observedLocalUpdateReads !== 0) {
      const update = this.encodeSingleLocalUpdate(op, encodedPath);
      if (typeof viewPatch === 'function') {
        let patch: Patch | null = null;
        return {
          update,
          get viewPatch() {
            if (patch === null) patch = viewPatch();
            return patch;
          },
          get heads() {
            return heads.slice();
          },
          stateVector
        };
      }
      return {
        update,
        viewPatch,
        get heads() {
          return heads.slice();
        },
        stateVector
      };
    }
    return this.createLocalCommitResult(
      () => this.encodeSingleLocalUpdate(op, encodedPath),
      viewPatch,
      heads,
      stateVector
    );
  }

  private encodeSingleLocalUpdate(op: CrdtOperation, encodedPath = pathKey(op.path)): Uint8Array {
    const update = { actor: this.actorId, seq: operationEndSeq(op), deps: op.deps, ops: [op] };
    if (op.type === 'textInsert') {
      const miniAppend = encodeMiniBinaryTextAppendInsertUpdate(update);
      if (miniAppend !== null) return markEncodedUpdate(miniAppend, update);
      const miniPair = encodeMiniBinaryTextPairInsertUpdate(update);
      if (miniPair !== null) return markEncodedUpdate(miniPair, update);
      const mini = encodeMiniBinaryTextInsertUpdate(update);
      if (mini !== null) return markEncodedUpdate(mini, update);
      const miniRemote = encodeMiniBinaryTextRemoteInsertUpdate(update);
      if (miniRemote !== null) return markEncodedUpdate(miniRemote, update);
      const tiny = encodeTinyBinaryTextInsertUpdate(update);
      if (tiny !== null) return markEncodedUpdate(tiny, update);
      const single = encodeSingleBinaryCrdtUpdate(update);
      if (single !== null) return markEncodedUpdate(single, update);
      return markEncodedUpdate(encodeSingleCompactJsonTextInsert(this.encodedActor, op.seq, op.deps, op, encodedPath), update);
    }
    const miniMapSet = encodeMiniBinaryMapSetIntUpdate(update);
    if (miniMapSet !== null) return markEncodedUpdate(miniMapSet, update);
    const single = encodeSingleBinaryCrdtUpdate(update);
    if (single !== null) return markEncodedUpdate(single, update);
    return markEncodedUpdate(encodeSingleCompactJsonUpdate(this.encodedActor, operationEndSeq(op), op.deps, op, encodedPath), update);
  }

  private createLocalCommitResult(
    updateFactory: () => Uint8Array,
    viewPatch: Patch | (() => Patch),
    heads: string[],
    stateVector: CrdtStateVector,
    metadata?: JsonObject
  ): CrdtCommitResult {
    const clonedMetadata = metadata === undefined ? undefined : cloneJson(metadata);
    if (this.observedLocalUpdateReads !== 0) {
      const update = updateFactory();
      if (typeof viewPatch === 'function') {
        let patch: Patch | null = null;
        const result: CrdtCommitResult = {
          update,
          get viewPatch() {
            if (patch === null) patch = viewPatch();
            return patch;
          },
          get heads() {
            return heads.slice();
          },
          stateVector
        };
        if (clonedMetadata !== undefined) result.metadata = cloneJson(clonedMetadata);
        return result;
      }
      const result: CrdtCommitResult = {
        update,
        viewPatch,
        get heads() {
          return heads.slice();
        },
        stateVector
      };
      if (clonedMetadata !== undefined) result.metadata = cloneJson(clonedMetadata);
      return result;
    }
    return createCrdtCommitResult(updateFactory, viewPatch, heads, stateVector, () => {
      this.observedLocalUpdateReads++;
    }, clonedMetadata);
  }

  private getOperationsSince(stateVector?: CrdtStateVector | null): CrdtOperation[] {
    const vector = stateVector || {};
    let hasVectorEntries = false;
    for (const actor in vector) {
      hasVectorEntries = true;
      break;
    }
    if (!hasVectorEntries) {
      const ops = this.operationLog.slice();
      if (!this.operationLogSorted) sortOperationsIfNeeded(ops);
      return ops;
    }
    if (this.stateVectorCoversOperationRanges(vector)) return [];

    const ops = this.operationLogSorted ? this.operationLog : this.operationLog.slice();
    if (!this.operationLogSorted) sortOperationsIfNeeded(ops);
    const result: CrdtOperation[] = [];
    for (let i = 0, length = ops.length; i < length; i++) {
      const op = ops[i];
      const seen = vector[op.actor] || 0;
      if (operationEndSeq(op) <= seen) continue;
      if (op.seq > seen) {
        result.push(op);
      } else if (isSpanningOperation(op)) {
        const suffix = operationSuffix(op, seen + 1);
        if (suffix !== null) result.push(suffix);
      }
    }
    return result;
  }

  private getHistoryOperations(options?: CrdtHistoryOptions): CrdtOperation[] {
    return options && (
      Object.prototype.hasOwnProperty.call(options, 'from') ||
      Object.prototype.hasOwnProperty.call(options, 'to')
    )
      ? this.changesBetween(options.from ?? null, options.to ?? null)
      : this.changesSince(null);
  }

  private requireVersionMark(name: string): CrdtVersionMark {
    const normalizedName = validateCrdtVersionMarkName(name);
    const mark = this.versionMarks.get(normalizedName);
    if (mark === undefined) throw new RangeError(`unknown CRDT version mark: ${normalizedName}`);
    return mark;
  }

  private getOperationsAtVersion(version: CrdtVersion): CrdtOperation[] {
    if (Array.isArray(version)) return this.getOperationsAtHeads(version);
    this.flushNativeTextLogToOperations();
    const ops = this.operationLogSorted ? this.operationLog : this.operationLog.slice();
    if (!this.operationLogSorted) sortOperationsIfNeeded(ops);
    const result: CrdtOperation[] = [];
    for (let i = 0, length = ops.length; i < length; i++) {
      appendOperationAtStateVector(result, ops[i], version);
    }
    return result;
  }

  private getOperationIdsAtVersion(version?: CrdtVersion | null): Set<string> {
    const ops = version === undefined || version === null
      ? this.changesSince(null)
      : this.getOperationsAtVersion(version);
    const ids = new Set<string>();
    for (let i = 0, length = ops.length; i < length; i++) markOperationReadyIds(ids, ops[i]);
    return ids;
  }

  private getHeadsForMetadataVersion(version?: CrdtVersion | CrdtOperationId | null): CrdtOperationId[] {
    if (version === undefined || version === null) return this.getReadyHeadsCached().slice();
    if (typeof version === 'string') {
      if (tryParseOperationId(version) === null) throw new TypeError('invalid CRDT operation id');
      return [version];
    }
    if (Array.isArray(version)) return version.slice();
    return getHeadsFromOperationList(this.getOperationsAtVersion(version));
  }

  private getOperationsAtHeads(heads: CrdtOperationId[]): CrdtOperation[] {
    this.flushNativeTextLogToOperations();
    if (heads.length === 0) return [];
    const wanted = new Set<string>(heads);
    const included = new Set<string>();
    const result: CrdtOperation[] = [];
    let changed = true;
    while (changed) {
      changed = false;
      const ops = this.operationLogSorted ? this.operationLog : this.operationLog.slice();
      if (!this.operationLogSorted) sortOperationsIfNeeded(ops);
      for (let i = ops.length - 1; i >= 0; i--) {
        const op = ops[i];
        const wantedHead = findWantedOperationHeadInOperation(op, wanted, included);
        if (wantedHead === null) continue;
        const parsed = parseOperationId(wantedHead);
        const prefix = operationPrefix(op, parsed.seq);
        if (prefix === null) continue;
        const cloned = cloneCrdtOperation(prefix);
        result[result.length] = cloned;
        markOperationReadyIds(included, cloned);
        for (let j = 0, depsLength = cloned.deps.length; j < depsLength; j++) {
          if (!included.has(cloned.deps[j])) wanted.add(cloned.deps[j]);
        }
        changed = true;
      }
    }
    sortOperationsIfNeeded(result);
    return result;
  }

  private getCommitMetadataEntriesForOps(ops: readonly CrdtOperation[]): Array<{ head: CrdtOperationId; metadata: JsonObject }> {
    const entries: Array<{ head: CrdtOperationId; metadata: JsonObject }> = [];
    const seen = new Set<string>();
    for (let i = 0, length = ops.length; i < length; i++) {
      const op = ops[i];
      if (!isSpanningOperation(op)) {
        this.appendCommitMetadataEntry(entries, seen, op.id);
        continue;
      }
      const end = operationEndSeq(op);
      for (let seq = op.seq; seq <= end; seq++) {
        this.appendCommitMetadataEntry(entries, seen, `${op.actor}:${seq}`);
      }
    }
    return entries;
  }

  private appendCommitMetadataEntry(
    entries: Array<{ head: CrdtOperationId; metadata: JsonObject }>,
    seen: Set<string>,
    head: CrdtOperationId
  ): void {
    if (seen.has(head)) return;
    seen.add(head);
    const metadata = this.commitMetadata.get(head);
    if (metadata !== undefined) entries[entries.length] = { head, metadata: cloneJson(metadata) };
  }

  private importCommitMetadataEntries(entries: Array<{ head: CrdtOperationId; metadata: JsonObject }> | undefined): void {
    if (entries === undefined) return;
    for (let i = 0, length = entries.length; i < length; i++) {
      this.commitMetadata.set(entries[i].head, cloneJson(entries[i].metadata));
    }
  }

  private importCommitMetadataEntriesForOps(
    entries: Array<{ head: CrdtOperationId; metadata: JsonObject }> | undefined,
    ops: readonly CrdtOperation[]
  ): void {
    if (entries === undefined || entries.length === 0 || ops.length === 0) return;
    const heads = new Set<CrdtOperationId>();
    for (let i = 0, length = ops.length; i < length; i++) heads.add(operationHeadId(ops[i]));
    for (let i = 0, length = entries.length; i < length; i++) {
      const entry = entries[i];
      if (heads.has(entry.head)) this.commitMetadata.set(entry.head, cloneJson(entry.metadata));
    }
    if (entries.length === 1 && operationsContainHead(ops, entries[0].head)) {
      this.recordCommitMetadataHeadForOps(ops, entries[0].head);
    }
  }

  private copyCommitMetadataForOpsTo(target: FrontierCrdtDocument, ops: readonly CrdtOperation[]): void {
    const copiedOps = new Set<string>();
    const includedHeads = createOperationHeadSet(ops);
    for (let i = 0, length = ops.length; i < length; i++) {
      const op = ops[i];
      if (!isSpanningOperation(op)) {
        this.copyCommitMetadataForHeadTo(target, op.id, includedHeads, copiedOps);
        continue;
      }
      const end = operationEndSeq(op);
      for (let seq = op.seq; seq <= end; seq++) {
        this.copyCommitMetadataForHeadTo(target, `${op.actor}:${seq}`, includedHeads, copiedOps);
      }
    }
  }

  private copyCommitMetadataForHeadTo(
    target: FrontierCrdtDocument,
    head: string,
    includedHeads: Set<string>,
    copiedOps: Set<string>
  ): void {
    if (copiedOps.has(head)) return;
    copiedOps.add(head);
    const metadataHead = this.commitMetadataHeadByOperation.get(head) || head;
    if (!includedHeads.has(metadataHead)) return;
    const metadata = this.commitMetadata.get(metadataHead);
    if (metadata === undefined) return;
    target.commitMetadata.set(metadataHead, cloneJson(metadata));
    if (metadataHead !== head) target.commitMetadataHeadByOperation.set(head, metadataHead);
  }

  private stateVectorCoversOperationRanges(vector: CrdtStateVector): boolean {
    if (this.operationRangesByActor.size === 0) return true;
    let covered = true;
    this.operationRangesByActor.forEach((ranges, actor) => {
      if (!covered || ranges.length === 0) return;
      const last = ranges[ranges.length - 1];
      if ((vector[actor] || 0) < last[1]) covered = false;
    });
    return covered;
  }

		  private addOperation(op: CrdtOperation): void {
		    if (op.type === 'textInsert') {
	      if (this.tryAppendTextInsertToLastRun(op)) return;
	    } else if (op.type === 'listInsert') {
	      if (this.tryAppendListInsertToLastRun(op)) return;
    } else if (op.type === 'set') {
      if (this.tryAppendMapSetToLastRun(op)) return;
    }
    const last = this.operationLog[this.operationLog.length - 1];
    if (last !== undefined && compareOperations(last, op) > 0) this.operationLogSorted = false;
    this.operationLog[this.operationLog.length] = op;
    if (isSpanningOperation(op)) this.spanningOperations[this.spanningOperations.length] = op;
	    this.noteOperationRange(op);
	  }

  private recordCommitMetadataForOps(ops: readonly CrdtOperation[], metadata: JsonObject | undefined): void {
    if (metadata === undefined || ops.length === 0) return;
    const metadataHead = operationHeadId(ops[ops.length - 1]);
    this.commitMetadata.set(metadataHead, cloneJson(metadata));
    this.recordCommitMetadataHeadForOps(ops, metadataHead);
  }

  private recordCommitMetadataForUpdate(ops: readonly CrdtOperation[], update: CrdtUpdate): void {
    this.importCommitMetadataEntriesForOps(update.metadataEntries, update.ops);
    this.recordCommitMetadataForOps(ops, update.metadata);
  }

  private recordCommitMetadataHeadForOps(ops: readonly CrdtOperation[], metadataHead: string): void {
    for (let i = 0, length = ops.length; i < length; i++) {
      this.recordCommitMetadataHeadForOperation(ops[i], metadataHead);
    }
  }

  private recordCommitMetadataHeadForOperation(op: CrdtOperation, metadataHead: string): void {
    if (!isSpanningOperation(op)) {
      if (op.id !== metadataHead) this.commitMetadataHeadByOperation.set(op.id, metadataHead);
      return;
    }
    const end = operationEndSeq(op);
    for (let seq = op.seq; seq <= end; seq++) {
      const head = `${op.actor}:${seq}`;
      if (head !== metadataHead) this.commitMetadataHeadByOperation.set(head, metadataHead);
    }
  }

		  private addLocalOperations(ops: CrdtOperation[]): void {
	    if (ops.length === 0) return;
	    this.addOperation(ops[0]);
	    if (ops.length === 1) return;
	    const rangeActor = ops[1].actor;
	    const rangeStart = ops[1].seq;
	    let rangeEnd = operationEndSeq(ops[1]);
	    let canBatchRange = true;
	    for (let i = 1, length = ops.length; i < length; i++) {
	      const op = ops[i];
	      if (op.actor !== rangeActor) canBatchRange = false;
	      else rangeEnd = operationEndSeq(op);
	      this.appendOperationWithoutRunProbe(op, false);
	    }
	    if (canBatchRange) {
	      this.noteActorRange(rangeActor, rangeStart, rangeEnd);
	    } else {
	      for (let i = 1, length = ops.length; i < length; i++) this.noteOperationRange(ops[i]);
	    }
	  }

	  private appendOperationWithoutRunProbe(op: CrdtOperation, noteRange = true): void {
		    const last = this.operationLog[this.operationLog.length - 1];
	    if (last !== undefined && compareOperations(last, op) > 0) this.operationLogSorted = false;
	    this.operationLog[this.operationLog.length] = op;
	    if (isSpanningOperation(op)) this.spanningOperations[this.spanningOperations.length] = op;
	    if (noteRange) this.noteOperationRange(op);
	  }

  private tryAppendTextInsertToLastRun(op: CrdtOperation): boolean {
    if (op.type !== 'textInsert' || !isSingleCodePointString(op.text)) return false;
    const lastIndex = this.operationLog.length - 1;
    if (lastIndex < 0) return false;
    const last = this.operationLog[lastIndex];

    if (
      last.type === 'textRun' &&
      last.actor === op.actor &&
      last.path === op.path &&
      op.seq === last.seq + last.count &&
      op.deps.length === 1 &&
      operationIdMatchesActorSeq(op.deps[0], op.actor, op.seq - 1) &&
      op.after !== null &&
      textElementIdMatchesActorSeqZero(op.after, op.actor, op.seq - 1)
    ) {
      last.text += op.text;
      last.count++;
      this.noteActorRange(op.actor, op.seq, op.seq);
      return true;
    }

    if (
      last.type === 'textInsert' &&
      last.actor === op.actor &&
      last.path === op.path &&
      op.seq === last.seq + 1 &&
      op.deps.length === 1 &&
      op.deps[0] === last.id &&
      op.after === last.id + '/0' &&
      isSingleCodePointString(last.text)
    ) {
      const run: Extract<CrdtOperation, { type: 'textRun' }> = {
        type: 'textRun',
        id: last.id,
        actor: last.actor,
        seq: last.seq,
        deps: last.deps,
        path: last.path,
        after: last.after,
        text: last.text + op.text,
        count: 2
      };
      this.operationLog[lastIndex] = run;
      this.spanningOperations[this.spanningOperations.length] = run;
      this.noteActorRange(op.actor, op.seq, op.seq);
      return true;
    }

    if (!textInsertExtendsOperation(last, op)) return false;

    if (last.type === 'textRun') {
      last.text += op.text;
      last.count++;
      this.noteActorRange(op.actor, op.seq, op.seq);
      return true;
    }

    const run: Extract<CrdtOperation, { type: 'textRun' }> = {
      type: 'textRun',
      id: last.id,
      actor: last.actor,
      seq: last.seq,
      deps: last.deps,
      path: last.path,
      after: last.after,
      text: last.text + op.text,
      count: 2
    };
    this.operationLog[lastIndex] = run;
    this.spanningOperations[this.spanningOperations.length] = run;
    this.noteActorRange(op.actor, op.seq, op.seq);
    return true;
  }

  private tryAppendListInsertToLastRun(op: CrdtOperation): boolean {
    if (op.type !== 'listInsert' || op.values.length !== 1) return false;
    const lastIndex = this.operationLog.length - 1;
    if (lastIndex < 0) return false;
    const last = this.operationLog[lastIndex];
    if (!listInsertExtendsOperation(last, op)) return false;

    if (last.type === 'listRun') {
      last.values[last.values.length] = op.values[0];
      last.count++;
      this.noteActorRange(op.actor, op.seq, op.seq);
      return true;
    }

    const run: Extract<CrdtOperation, { type: 'listRun' }> = {
      type: 'listRun',
      id: last.id,
      actor: last.actor,
      seq: last.seq,
      deps: last.deps,
      path: last.path,
      after: last.after,
      values: [last.values[0], op.values[0]],
      count: 2
    };
    this.operationLog[lastIndex] = run;
    this.spanningOperations[this.spanningOperations.length] = run;
    this.noteActorRange(op.actor, op.seq, op.seq);
    return true;
  }

  private tryAppendMapSetToLastRun(op: CrdtOperation): boolean {
    if (op.type !== 'set' || op.path.length === 0) return false;
    const lastIndex = this.operationLog.length - 1;
    if (lastIndex < 0) return false;
    const last = this.operationLog[lastIndex];
    if (!mapSetExtendsOperation(last, op)) return false;

    const key = op.path[op.path.length - 1] as string;
    if (last.type === 'mapSetRun') {
      last.keys[last.keys.length] = key;
      last.values[last.values.length] = op.value;
      last.count++;
      this.noteActorRange(op.actor, op.seq, op.seq);
      return true;
    }

    const run: Extract<CrdtOperation, { type: 'mapSetRun' }> = {
      type: 'mapSetRun',
      id: last.id,
      actor: last.actor,
      seq: last.seq,
      deps: last.deps,
      path: last.path.slice(0, -1),
      keys: [last.path[last.path.length - 1] as string, key],
      values: [last.value, op.value],
      count: 2
    };
    this.operationLog[lastIndex] = run;
    this.spanningOperations[this.spanningOperations.length] = run;
    this.noteActorRange(op.actor, op.seq, op.seq);
    return true;
  }

  private catchUpLocalSeq(update: CrdtUpdate): void {
    if (update.actor !== this.actorId) return;
    for (let i = 0, length = update.ops.length; i < length; i++) {
      const op = update.ops[i];
      const endSeq = operationEndSeq(op);
      if (op.actor === this.actorId && endSeq >= this.nextSeq) {
        this.nextSeq = endSeq + 1;
      }
    }
  }

  private operationFullyKnown(op: CrdtOperation): boolean {
    if (!isSpanningOperation(op)) return this.hasLogicalOperationId(op.id);
    return this.operationRangeFullyKnown(op);
  }

  private missingOperations(op: CrdtOperation): CrdtOperation[] {
    if (!isSpanningOperation(op)) return [op];
    if (!this.operationRangeOverlapsKnown(op)) return [op];
    const expanded = expandSpanningOperation(op);
    const missing: CrdtOperation[] = [];
    for (let i = 0, length = expanded.length; i < length; i++) {
      if (!this.hasLogicalOperationId(expanded[i].id)) missing[missing.length] = expanded[i];
    }
    return missing.length === expanded.length ? [op] : missing;
  }

  private operationRangeOverlapsKnown(op: CrdtOperation): boolean {
    return actorSeqRangesOverlap(this.operationRangesByActor.get(op.actor), op.seq, operationEndSeq(op));
  }

  private operationRangeFullyKnown(op: CrdtOperation): boolean {
    return actorSeqRangesCover(this.operationRangesByActor.get(op.actor), op.seq, operationEndSeq(op));
  }

  private hasLogicalOperationId(id: string): boolean {
    if (this.operations.has(id)) return true;
    const parsed = tryParseOperationId(id);
    return parsed === null ? false : actorSeqRangesContain(this.operationRangesByActor.get(parsed.actor), parsed.seq);
  }

  private noteOperationRange(op: CrdtOperation): void {
    this.noteActorRange(op.actor, op.seq, operationEndSeq(op));
  }

  private noteActorRange(actor: string, start: number, end: number): void {
    let ranges = this.operationRangesByActor.get(actor);
    if (ranges === undefined) {
      ranges = [];
      this.operationRangesByActor.set(actor, ranges);
    }
    addActorSeqRange(ranges, start, end);
  }

  private getSequenceAppendState(path: JsonPath, kind: 'list' | 'text', current: JsonValue | undefined, cacheKey?: string): SequenceAppendState | null {
    const key = cacheKey === undefined ? sequenceCacheKey(path, kind) : cacheKey;
    const cached = this.sequenceAppendCache.get(key);
    if (cached !== undefined) return cached;

    if (kind === 'text') {
      const sequence = this.textSequenceCache.get(key);
      if (sequence !== undefined) {
        const state = { length: sequence.length, tail: sequence.tail() };
        this.sequenceAppendCache.set(key, state);
        return state;
      }
    }

    const visible = this.sequenceVisibleCache.get(key);
    if (visible !== undefined) {
      const state = {
        length: visible.length,
        tail: visible.length === 0 ? null : visible[visible.length - 1]
      };
      this.sequenceAppendCache.set(key, state);
      return state;
    }

    if (kind === 'list') {
      if (Array.isArray(current) && current.length === 0) {
        const state = { length: 0, tail: null };
        this.sequenceAppendCache.set(key, state);
        return state;
      }
      return null;
    }
    if (typeof current === 'string') {
      if (current.length === 0) {
        const state = { length: 0, tail: null };
        this.sequenceAppendCache.set(key, state);
        return state;
      }
      return null;
    }
    if (current === undefined) {
      const state = { length: 0, tail: null };
      this.sequenceAppendCache.set(key, state);
      return state;
    }
    return null;
  }

  private getVisibleElementIdsCached(path: JsonPath, kind: 'list' | 'text', cacheKey?: string): string[] {
    const key = cacheKey === undefined ? sequenceCacheKey(path, kind) : cacheKey;
    const cached = this.sequenceVisibleCache.get(key);
    if (cached !== undefined) return cached;
    if (kind === 'text') {
      const sequence = this.textSequenceCache.get(key);
      if (sequence !== undefined) return sequence.toArray();
    }
    const visible = getVisibleElementIds(this.getReadyOperationsForRead(), path, kind);
    this.sequenceVisibleCache.set(key, visible);
    return visible;
  }

  private getTextSequenceCached(path: JsonPath, current: JsonValue | undefined, cacheKey?: string): TextSequence {
    const key = cacheKey === undefined ? sequenceCacheKey(path, 'text') : cacheKey;
    let sequence = this.textSequenceCache.get(key);
    if (sequence !== undefined) return sequence;
    const visible = this.sequenceVisibleCache.get(key);
    if (visible !== undefined) {
      sequence = this.createTextSequenceFromVisible(path, visible);
    } else if (current === undefined || current === '') {
      sequence = this.createEmptyTextSequence(path);
    } else {
      sequence = this.createTextSequenceFromVisible(
        path,
        getVisibleElementIds(this.getReadyOperationsForRead(), path, 'text')
      );
    }
    this.configureTextSequenceProfile(path, sequence);
    this.textSequenceCache.set(key, sequence);
    this.sequenceVisibleCache.delete(key);
    return sequence;
  }

  private createEmptyTextSequence(path: JsonPath): TextSequence {
    return this.crdtProfile.textProfiles.has(pathKey(path))
      ? new NativeTextPieceSequence()
      : new ChunkedStringSequence();
  }

  private createTextSequenceFromVisible(path: JsonPath, visible: string[]): TextSequence {
    if (this.crdtProfile.textProfiles.has(pathKey(path))) {
      const native = NativeTextPieceSequence.fromArray(visible);
      if (native !== null) return native;
    }
    return ChunkedStringSequence.fromArray(visible);
  }

  private configureTextSequenceProfile(path: JsonPath, sequence: TextSequence): void {
    const profile = this.crdtProfile.textProfiles.get(pathKey(path));
    sequence.setPositionIndexThreshold(
      profile === undefined
        ? CRDT_TEXT_PROFILE_DEFAULT_ROUTE_INDEX_THRESHOLD
        : profile.routeIndexThreshold
    );
  }

  private getTextValueCached(path: JsonPath, current: string, cacheKey?: string): ChunkedTextValue {
    const key = cacheKey === undefined ? sequenceCacheKey(path, 'text') : cacheKey;
    let cached = this.textValueCache.get(key);
    if (cached !== undefined) return cached.value;
    cached = { path: path.slice(), value: ChunkedTextValue.fromString(current) };
    this.textValueCache.set(key, cached);
    return cached.value;
  }

  private canUseNativeTextLog(path: JsonPath, key: string, current: JsonValue | undefined): boolean {
    if (current !== undefined && typeof current !== 'string') return false;
    const log = this.nativeTextLog;
    if (log !== null) return log.actor === this.actorId && log.key === key && samePath(log.path, path);
    return this.crdtProfile.textProfiles.has(pathKey(path)) && (
      this.operationLog.length === 0 ||
      this.allOperationsReadyCached()
    );
  }

  private createNativeTextLogBaseSequence(path: JsonPath, key: string, current: string): NativeTextPieceSequence | null {
    const sequence = this.getTextSequenceCached(path, current, key);
    if (!(sequence instanceof NativeTextPieceSequence)) return null;
    const currentLength = current.length === sequence.length ? current.length : codePointLength(current);
    return sequence.length === currentLength ? sequence.clone() : null;
  }

  private getOrCreateNativeTextLog(
    path: JsonPath,
    key: string,
    current: string,
    createdText: boolean,
    initialCodeUnitAligned: boolean,
    baseSequence: NativeTextPieceSequence | null = null
  ): NativePositionalTextLog {
    if (this.nativeTextLog !== null) return this.nativeTextLog;
    const log: NativePositionalTextLog = {
      actor: this.actorId,
      path: path.slice(),
      key,
      initialText: current,
      baseSequence,
      createdText,
      initialCodeUnitAligned,
      firstSeq: this.nextSeq,
      firstDeps: this.getReadyHeadsForOperation().slice(),
      previousIndex: 0,
      length: current.length === 0 ? 0 : codePointLength(current),
      appendOnly: true,
      materializedText: null,
      tags: [],
      positionDeltas: [],
      counts: [],
      texts: []
    };
    this.nativeTextLog = log;
    return log;
  }

  private createNativeTextLogSpans(
    log: NativePositionalTextLog,
    start: number,
    end: number,
    initialPreviousIndex: number,
    initialTextIndex: number
  ): TextDirtySpan[] {
    const spans: TextDirtySpan[] = [];
    let index = initialPreviousIndex;
    let textIndex = initialTextIndex;
    for (let i = start; i < end; i++) {
      index += log.positionDeltas[i];
      const tag = log.tags[i];
      if (tag === 1 || tag === 2) {
        appendTextDirtySpan(spans, log.path, index, 0, log.texts[textIndex++], true);
      } else {
        appendTextDirtySpan(spans, log.path, index, log.counts[i], '', true);
      }
    }
    return spans;
  }

  private encodeNativeTextLogUpdate(log: NativePositionalTextLog, start: number, end: number): Uint8Array {
    if (start !== 0) return this.encodeNativeTextLogOperationUpdate(log, start, end);
    const count = end - start;
    if (count <= 0) return EMPTY_UPDATE_BYTES;
    const lastSeq = log.firstSeq + count - 1;
    const first: Extract<CrdtOperation, { type: 'textInsert' }> = {
      type: 'textInsert',
      id: log.actor + ':' + log.firstSeq,
      actor: log.actor,
      seq: log.firstSeq,
      deps: log.firstDeps,
      path: log.path,
      after: null,
      text: ''
    };
    const tags = end === log.tags.length ? log.tags : log.tags.slice(0, end);
    const positionDeltas = end === log.positionDeltas.length ? log.positionDeltas : log.positionDeltas.slice(0, end);
    const counts = end === log.counts.length ? log.counts : log.counts.slice(0, end);
    return encodeColumnarPositionedTextLogUpdateText(
      { actor: log.actor, seq: lastSeq, deps: [log.actor + ':' + lastSeq], ops: [] },
      first,
      log.path,
      tags,
      positionDeltas,
      counts,
      nativeTextLogTextForRange(log, 0, end)
    );
  }

  private encodeNativeTextLogUpdateSinceStateVector(
    log: NativePositionalTextLog,
    stateVector?: CrdtStateVector | null
  ): Uint8Array | null {
    if (stateVectorIsEmpty(stateVector)) {
      return log.initialText.length !== 0 || log.baseSequence !== null
        ? this.encodeNativeTextLogOperationUpdate(log, 0, log.tags.length)
        : this.encodeNativeTextLogUpdate(log, 0, log.tags.length);
    }
    const vector = stateVector || {};
    const endSeq = log.firstSeq + log.tags.length - 1;
    const seen = vector[log.actor] || 0;
    if (seen >= endSeq) return EMPTY_UPDATE_BYTES;
    const start = seen < log.firstSeq - 1 ? 0 : seen - log.firstSeq + 1;
    if (log.initialText.length !== 0 || log.baseSequence !== null) {
      return this.encodeNativeTextLogOperationUpdate(log, start, log.tags.length);
    }
    if (start === 0) return this.encodeNativeTextLogUpdate(log, 0, log.tags.length);
    return this.encodeNativeTextLogSegmentUpdate(log, start, log.tags.length);
  }

  private encodeNativeTextLogSegmentUpdate(log: NativePositionalTextLog, start: number, end: number): Uint8Array {
    const count = end - start;
    if (count <= 0) return EMPTY_UPDATE_BYTES;
    const firstSeq = log.firstSeq + start;
    const lastSeq = firstSeq + count - 1;
    const first: Extract<CrdtOperation, { type: 'textInsert' }> = {
      type: 'textInsert',
      id: `${log.actor}:${firstSeq}`,
      actor: log.actor,
      seq: firstSeq,
      deps: start === 0 ? log.firstDeps : [`${log.actor}:${firstSeq - 1}`],
      path: log.path,
      after: null,
      text: ''
    };
    return encodeColumnarPositionedTextLogUpdateText(
      { actor: log.actor, seq: lastSeq, deps: [`${log.actor}:${lastSeq}`], ops: [] },
      first,
      log.path,
      log.tags.slice(start, end),
      log.positionDeltas.slice(start, end),
      log.counts.slice(start, end),
      nativeTextLogTextForRange(log, start, end),
      true
    );
  }

  private encodeNativeTextLogOperationUpdate(log: NativePositionalTextLog, start: number, end: number): Uint8Array {
    if (end <= start) return EMPTY_UPDATE_BYTES;
    const fast = this.encodeNativeTextLogSingleOperationUpdate(log, start, end);
    if (fast !== null) return fast;
    const directOps = this.createNativeTextLogOperations(log, start, end);
    const ops = directOps === null
      ? decodeCrdtUpdate(this.encodeNativeTextLogUpdate(log, 0, end)).ops.slice(start, end)
      : directOps;
    if (ops.length === 0) return EMPTY_UPDATE_BYTES;
    return encodeTrustedCrdtUpdate({
      actor: log.actor,
      seq: operationEndSeq(ops[ops.length - 1]),
      deps: ops[0].deps,
      ops
    });
  }

  private encodeNativeTextLogSingleOperationUpdate(log: NativePositionalTextLog, start: number, end: number): Uint8Array | null {
    if (end !== start + 1 || log.tags[start] !== 1) return null;
    const after = nativeTextLogAppendInsertAfter(log, start);
    if (after === undefined) return null;
    const textIndex = log.appendOnly ? start : nativeTextLogTextIndexAt(log, start);
    const seq = log.firstSeq + start;
    const deps = start === 0 ? log.firstDeps : [`${log.actor}:${seq - 1}`];
    const op: Extract<CrdtOperation, { type: 'textInsert' }> = {
      type: 'textInsert',
      id: `${log.actor}:${seq}`,
      actor: log.actor,
      seq,
      deps,
      path: log.path,
      after,
      text: log.texts[textIndex]
    };
    return this.encodeSingleLocalUpdate(op, pathKey(log.path));
  }

  private createNativeTextLogOperations(log: NativePositionalTextLog, start: number, end: number): CrdtOperation[] | null {
    if (start < 0 || end > log.tags.length || end < start) return null;
    if (log.initialText.length !== 0 && log.baseSequence === null) return null;
    const sequence = log.baseSequence === null ? new NativeTextPieceSequence() : log.baseSequence.clone();
    const ops: CrdtOperation[] = [];
    let previousIndex = 0;
    let textIndex = 0;
    let seq = log.firstSeq;
    let deps = log.firstDeps;

    for (let i = 0; i < end; i++) {
      const tag = log.tags[i];
      const index = previousIndex + log.positionDeltas[i];
      const count = log.counts[i];
      if (!Number.isSafeInteger(index) || index < 0 || !Number.isSafeInteger(count) || count <= 0) return null;
      previousIndex = index;
      const id = `${log.actor}:${seq}`;
      let op: CrdtOperation;

      if (tag === 1 || tag === 2) {
        if (textIndex >= log.texts.length) return null;
        const text = log.texts[textIndex++];
        if (text.length === 0) return null;
        const after = index === 0 ? null : sequence.at(index - 1);
        if (index !== 0 && after === null) return null;
        op = tag === 2
          ? { type: 'textRun', id, actor: log.actor, seq, deps, path: log.path, after, text, count }
          : { type: 'textInsert', id, actor: log.actor, seq, deps, path: log.path, after, text };
        sequence.insertCreated(index, op, count);
      } else if (tag === 3) {
        const payload = createTextDeleteOperationPayloadFromNativePieceSequence(sequence, index, count);
        if (payload === null) return null;
        op = payload.type === 'textDel'
          ? { type: 'textDel', id, actor: log.actor, seq, deps, path: log.path, elems: payload.elems }
          : { type: 'textDelRange', id, actor: log.actor, seq, deps, path: log.path, start: payload.range.start, count: payload.range.count, span: payload.range.span };
        sequence.delete(index, payload.count);
      } else {
        return null;
      }

      if (i >= start) ops[ops.length] = op;
      seq = operationEndSeq(op) + 1;
      deps = [operationHeadId(op)];
    }

    return ops;
  }

  private flushTextValueCache(): void {
    if (this.textValueCache.size === 0) return;
    this.textValueCache.forEach((entry) => {
      this.viewValue = setPath(this.viewValue, entry.path, entry.value.toString());
    });
    this.textValueCache.clear();
  }

  private flushPendingNativeTextBeforeGeneric(): void {
    if (this.nativeTextLog === null) return;
    this.flushNativeTextLogView();
    this.flushNativeTextLogToOperations();
  }

  private flushNativeTextLogView(log = this.nativeTextLog): void {
    if (log === null) return;
    this.viewValue = setPath(this.viewValue, log.path, materializeNativeTextLog(log));
  }

  private flushNativeTextLogToOperations(): void {
    const log = this.nativeTextLog;
    if (log === null) return;
    this.flushNativeTextLogView(log);
    if (this.flushAppendOnlyNativeTextLogToOperations(log)) {
      this.nativeTextLog = null;
      return;
    }
    if (this.flushNativeTextLogToOperationsDirect(log)) {
      this.nativeTextLog = null;
      return;
    }
    const update = decodeCrdtUpdate(this.encodeNativeTextLogUpdate(log, 0, log.tags.length));
    for (let i = 0, length = update.ops.length; i < length; i++) {
      this.appendOperationWithoutRunProbe(update.ops[i]);
    }
    this.nativeTextLog = null;
  }

  private flushNativeTextLogToOperationsDirect(log: NativePositionalTextLog): boolean {
    const ops = this.createNativeTextLogOperations(log, 0, log.tags.length);
    if (ops === null) return false;
    for (let i = 0, length = ops.length; i < length; i++) this.appendOperationWithoutRunProbe(ops[i]);
    return true;
  }

  private flushAppendOnlyNativeTextLogToOperations(log: NativePositionalTextLog): boolean {
    if (!log.appendOnly || log.initialText.length !== 0) return false;
    let deps = log.firstDeps;
    for (let i = 0, textIndex = 0, length = log.tags.length; i < length; i++) {
      if (log.tags[i] !== 1) return false;
      const seq = log.firstSeq + i;
      const text = log.texts[textIndex++];
      const after = i === 0
        ? null
        : `${log.actor}:${seq - 1}/${log.counts[i - 1] - 1}`;
      this.addOperation({
        type: 'textInsert',
        id: `${log.actor}:${seq}`,
        actor: log.actor,
        seq,
        deps,
        path: log.path,
        after,
        text
      });
      deps = [`${log.actor}:${seq}`];
    }
    return true;
  }

  private getSequenceIndexAfterCached(path: JsonPath, kind: 'list' | 'text', after: string | null, cacheKey?: string): number {
    if (after === null) return 0;
    const key = cacheKey === undefined ? sequenceCacheKey(path, kind) : cacheKey;
    const append = this.sequenceAppendCache.get(key);
    if (append !== undefined && append.tail === after) return append.length;
    return indexAfterElement(this.getVisibleElementIdsCached(path, kind, key), after);
  }

  private getReadyHeadsCached(): string[] {
    if (this.readyHeadsCache === null) {
      this.readyHeadsCache = this.allReadyCache === true
        ? getHeadsFromOperationList(this.operationLog)
        : getHeadsFromOperationList(this.getReadyOperationsForRead());
    }
    return this.readyHeadsCache.slice();
  }

  private getReadyHeadsForOperation(): string[] {
    if (this.readyHeadsCache === null) {
      this.readyHeadsCache = this.allReadyCache === true
        ? getHeadsFromOperationList(this.operationLog)
        : getHeadsFromOperationList(this.getReadyOperationsForRead());
    }
    return this.readyHeadsCache;
  }

  private allOperationsReadyCached(): boolean {
    if (this.allReadyCache === null) this.allReadyCache = allOperationsReadyFromList(this.operationLog);
    return this.allReadyCache;
  }

  private getReadyOperationsForRead(): CrdtOperation[] {
    if (this.allReadyCache === true) {
      const ops = this.operationLog.slice();
      if (!this.operationLogSorted) sortOperationsIfNeeded(ops);
      return ops;
    }
    return getReadyOperationsFromList(this.operationLog);
  }

  private getStateVectorCached(): CrdtStateVector {
    if (this.stateVectorCache === null) this.stateVectorCache = getStateVectorFromActorRanges(this.operationRangesByActor);
    return copyStateVector(this.stateVectorCache);
  }

  private getDirectCommitStateVector(op: CrdtOperation): CrdtStateVector {
    const endSeq = operationEndSeq(op);
    const ranges = this.operationRangesByActor.get(op.actor);
    if (
      this.operationRangesByActor.size === 1 &&
      ranges !== undefined &&
      ranges.length === 1 &&
      ranges[0][0] === 1 &&
      ranges[0][1] >= endSeq
    ) {
      return { [op.actor]: endSeq };
    }
    return this.getStateVectorCached();
  }

  private noteDirectOperationApplied(op: CrdtOperation): void {
    const head = operationHeadId(op);
    this.readyHeadsCache = [head];
    this.allReadyCache = true;
    this.noteStateVectorDirectOperation(op);

    if (isRegisterLikeOperation(op)) {
      if (this.sequenceVisibleCache.size !== 0) this.sequenceVisibleCache.clear();
      if (this.textSequenceCache.size !== 0) this.textSequenceCache.clear();
      if (this.textValueCache.size !== 0) this.textValueCache.clear();
      if (this.sequenceAppendCache.size !== 0) this.sequenceAppendCache.clear();
      return;
    }

    const kind = isTextSequenceOperation(op) ? 'text' : 'list';
    const key = sequenceCacheKey(op.path, kind);
    if (kind === 'text') {
      this.textSequenceCache.delete(key);
      this.textValueCache.delete(key);
    }
    this.noteSequenceAppendCacheApplied(key, op);
    const cached = this.sequenceVisibleCache.get(key);
    if (cached === undefined) return;

    if (op.type === 'textInsert' || op.type === 'textRun') {
      const index = indexAfterElement(cached, op.after);
      if (index === -1) {
        this.sequenceVisibleCache.delete(key);
        return;
      }
      insertCreatedElementIds(cached, index, op, op.type === 'textRun' ? op.count : op.text.length === 1 ? 1 : codePointLength(op.text));
    } else if (op.type === 'listInsert' || op.type === 'listRun') {
      const index = indexAfterElement(cached, op.after);
      if (index === -1) {
        this.sequenceVisibleCache.delete(key);
        return;
      }
      insertCreatedElementIds(cached, index, op, op.type === 'listRun' ? op.count : op.values.length);
    } else if (isTextDeleteOperation(op)) {
      const range = textDeleteIndexRange(cached, op);
      if (range === null) {
        this.sequenceVisibleCache.delete(key);
        return;
      }
      cached.splice(range.index, range.count);
    } else if (op.type === 'listDel') {
      const indexes = elementIndexes(cached, op.elems);
      if (indexes === null) {
        this.sequenceVisibleCache.delete(key);
        return;
      }
      cached.splice(indexes[0], indexes.length);
    }
  }

  private noteDirectTextInsertApplied(
    op: Extract<CrdtOperation, { type: 'textInsert' }>,
    index: number,
    count: number,
    sequenceKey?: string
  ): void {
    const head = operationHeadId(op);
    this.readyHeadsCache = [head];
    this.allReadyCache = true;
    this.noteStateVectorDirectOperation(op);

    const key = sequenceKey === undefined ? sequenceCacheKey(op.path, 'text') : sequenceKey;
    this.noteSequenceAppendCacheApplied(key, op);
    this.sequenceVisibleCache.delete(key);
    const cached = this.textSequenceCache.get(key);
    if (cached === undefined) return;
    if (index < 0 || index > cached.length) {
      this.textSequenceCache.delete(key);
      return;
    }
    cached.insertCreated(index, op, count);
    this.sequenceAppendCache.set(key, { length: cached.length, tail: cached.tail() });
  }

  private noteDirectTextDeleteApplied(
    op: CrdtTextDeleteOperation,
    index: number,
    count: number,
    sequenceKey?: string
  ): void {
    const head = operationHeadId(op);
    this.readyHeadsCache = [head];
    this.allReadyCache = true;
    this.noteStateVectorDirectOperation(op);

    const key = sequenceKey === undefined ? sequenceCacheKey(op.path, 'text') : sequenceKey;
    this.sequenceAppendCache.delete(key);
    this.sequenceVisibleCache.delete(key);
    const cached = this.textSequenceCache.get(key);
    if (cached === undefined) return;
    if (index < 0 || index + count > cached.length) {
      this.textSequenceCache.delete(key);
      return;
    }
    cached.delete(index, count);
    this.sequenceAppendCache.set(key, { length: cached.length, tail: cached.tail() });
  }

  private noteDirectOperationsApplied(ops: CrdtOperation[]): void {
    if (ops.length === 1) {
      this.noteDirectOperationApplied(ops[0]);
      return;
    }

    const previousHeads = this.readyHeadsCache;
    this.readyHeadsCache = previousHeads === null
      ? null
      : getHeadsAfterDirectOperations(previousHeads, ops);
    this.allReadyCache = true;
    this.noteStateVectorDirectOperations(ops);

    const first = ops[0];
    if (ops.length === 1 && first.type === 'textRun') {
      this.noteDirectSequenceInsertOperationApplied(first, 'text');
      return;
    }
    if (ops.length === 1 && first.type === 'listRun') {
      this.noteDirectSequenceInsertOperationApplied(first, 'list');
      return;
    }
    if (textInsertRunEnd(ops, 0) === ops.length) {
      this.noteDirectSequenceInsertRunApplied(first as Extract<CrdtOperation, { type: 'textInsert' }>, ops, 'text');
      return;
    }
    if (listInsertRunEnd(ops, 0) === ops.length) {
      this.noteDirectSequenceInsertRunApplied(first as Extract<CrdtOperation, { type: 'listInsert' }>, ops, 'list');
      return;
    }

    this.sequenceVisibleCache.clear();
    this.textSequenceCache.clear();
    this.textValueCache.clear();
    this.sequenceAppendCache.clear();
  }

  private noteDirectTextDirtyOperationsApplied(
    ops: CrdtOperation[],
    spans: TextDirtySpan[],
    sequences: TextDirtySequenceSource | null,
    localCausalRun = false
  ): void {
    if (ops.length === 1) {
      this.readyHeadsCache = [operationHeadId(ops[0])];
      this.noteStateVectorDirectOperation(ops[0]);
    } else if (localCausalRun) {
      this.readyHeadsCache = [operationHeadId(ops[ops.length - 1])];
      this.noteStateVectorDirectOperationRange(ops[0].actor, ops[0].seq, operationEndSeq(ops[ops.length - 1]));
    } else {
      const previousHeads = this.readyHeadsCache;
      this.readyHeadsCache = previousHeads === null
        ? null
        : getHeadsAfterDirectOperations(previousHeads, ops);
      this.noteStateVectorDirectOperations(ops);
    }
    this.allReadyCache = true;

    if (sequences !== null) {
      if (sequences instanceof Map) {
        if (sequences.size !== 0) {
          sequences.forEach((entry, key) => {
            this.textSequenceCache.set(key, entry.sequence);
            this.sequenceVisibleCache.delete(key);
            this.sequenceAppendCache.set(key, {
              length: entry.sequence.length,
              tail: entry.sequence.tail()
            });
          });
          return;
        }
      } else {
        this.textSequenceCache.set(sequences.key, sequences.sequence);
        this.sequenceVisibleCache.delete(sequences.key);
        this.sequenceAppendCache.set(sequences.key, {
          length: sequences.sequence.length,
          tail: sequences.sequence.tail()
        });
        return;
      }
    }

    const touchedPaths = new Map<string, JsonPath>();
    let lastPath: JsonPath | null = null;
    let lastKey = '';
    for (let i = 0, length = spans.length; i < length; i++) {
      const path = spans[i].path;
      const key = path === lastPath ? lastKey : sequenceCacheKey(path, 'text');
      lastPath = path;
      lastKey = key;
      touchedPaths.set(key, path);
      this.sequenceVisibleCache.delete(key);
    }
    if (touchedPaths.size === 0) return;

    touchedPaths.forEach((path, key) => {
      const sequence = this.textSequenceCache.get(key);
      if (sequence !== undefined) {
        if (applyTextOperationsToSequence(sequence, path, ops)) {
          this.sequenceAppendCache.set(key, { length: sequence.length, tail: sequence.tail() });
        } else {
          this.textSequenceCache.delete(key);
          this.sequenceAppendCache.delete(key);
        }
        return;
      }
      for (let i = 0, length = ops.length; i < length; i++) {
        const op = ops[i];
        if (samePath(op.path, path)) this.noteSequenceAppendCacheApplied(key, op);
      }
    });
  }

  private noteDirectSequenceInsertRunApplied(
    first: Extract<CrdtOperation, { type: 'listInsert' | 'textInsert' }>,
    ops: CrdtOperation[],
    kind: 'list' | 'text'
  ): void {
    const key = sequenceCacheKey(first.path, kind);
    if (kind === 'text') {
      this.textSequenceCache.delete(key);
      this.textValueCache.delete(key);
    }
    this.noteSequenceAppendRunCacheApplied(key, first.after, ops);
    const cached = this.sequenceVisibleCache.get(key);
    if (cached === undefined) return;

    const index = indexAfterElement(cached, first.after);
    if (index === -1) {
      this.sequenceVisibleCache.delete(key);
      return;
    }

    const ids: string[] = [];
    for (let i = 0, length = ops.length; i < length; i++) {
      const op = ops[i] as Extract<CrdtOperation, { type: 'listInsert' | 'textInsert' }>;
      const count = op.type === 'listInsert' ? op.values.length : codePointLength(op.text);
      for (let j = 0; j < count; j++) ids[ids.length] = `${op.id}/${j}`;
    }
    insertStrings(cached, index, ids);
  }

  private noteDirectSequenceInsertOperationApplied(
    op: Extract<CrdtOperation, { type: 'listInsert' | 'listRun' | 'textInsert' | 'textRun' }>,
    kind: 'list' | 'text'
  ): void {
    const key = sequenceCacheKey(op.path, kind);
    if (kind === 'text') {
      this.textSequenceCache.delete(key);
      this.textValueCache.delete(key);
    }
    const cached = this.sequenceVisibleCache.get(key);
    if (cached === undefined) return;

    const index = indexAfterElement(cached, op.after);
    if (index === -1) {
      this.sequenceVisibleCache.delete(key);
      return;
    }

    const count = op.type === 'listInsert' || op.type === 'listRun'
      ? op.values.length
      : op.type === 'textRun'
        ? op.count
        : codePointLength(op.text);
    insertCreatedElementIds(cached, index, op, count);
  }

  private noteSequenceAppendCacheApplied(key: string, op: CrdtOperation): void {
    if (isTextDeleteOperation(op) || op.type === 'listDel') {
      this.sequenceAppendCache.delete(key);
      return;
    }
    if (op.type !== 'textInsert' && op.type !== 'textRun' && op.type !== 'listInsert' && op.type !== 'listRun') return;
    const count = op.type === 'listInsert' || op.type === 'listRun'
      ? op.values.length
      : op.type === 'textRun'
        ? op.count
        : codePointLength(op.text);
    const tail = createdElementId(op, count - 1);
    const cached = this.sequenceAppendCache.get(key);
    if (cached === undefined) {
      return;
    }
    if (cached.tail === op.after) {
      cached.length += count;
      cached.tail = tail;
    } else {
      this.sequenceAppendCache.delete(key);
    }
  }

  private noteSequenceAppendRunCacheApplied(key: string, after: string | null, ops: CrdtOperation[]): void {
    let count = 0;
    let tail: string | null = null;
    for (let i = 0, length = ops.length; i < length; i++) {
      const op = ops[i];
      if (op.type === 'listInsert') {
        count += op.values.length;
        tail = createdElementId(op, op.values.length - 1);
      } else if (op.type === 'textInsert') {
        const opCount = codePointLength(op.text);
        count += opCount;
        tail = createdElementId(op, opCount - 1);
      } else {
        this.sequenceAppendCache.delete(key);
        return;
      }
    }
    if (tail === null) return;
    const cached = this.sequenceAppendCache.get(key);
    if (cached === undefined) {
      return;
    }
    if (cached.tail === after) {
      cached.length += count;
      cached.tail = tail;
    } else {
      this.sequenceAppendCache.delete(key);
    }
  }

  private noteStateVectorDirectOperation(op: CrdtOperation): void {
    if (this.stateVectorCache === null) return;
    const current = this.stateVectorCache[op.actor] || 0;
    const endSeq = operationEndSeq(op);
    if (op.seq === current + 1) {
      this.stateVectorCache[op.actor] = endSeq;
    } else if (op.seq > current + 1) {
      this.stateVectorCache = null;
    }
  }

  private noteStateVectorDirectOperations(ops: CrdtOperation[]): void {
    if (this.stateVectorCache === null) return;
    for (let i = 0, length = ops.length; i < length; i++) {
      this.noteStateVectorDirectOperation(ops[i]);
      if (this.stateVectorCache === null) return;
    }
  }

  private noteStateVectorDirectOperationRange(actor: string, startSeq: number, endSeq: number): void {
    if (this.stateVectorCache === null) return;
    const current = this.stateVectorCache[actor] || 0;
    if (endSeq <= current) return;
    if (startSeq <= current + 1) {
      this.stateVectorCache[actor] = endSeq;
    } else {
      this.stateVectorCache = null;
    }
  }

  private clearRuntimeCaches(): void {
    this.sequenceVisibleCache.clear();
    this.textSequenceCache.clear();
    this.textValueCache.clear();
    this.sequenceAppendCache.clear();
    this.readyHeadsCache = null;
    this.allReadyCache = null;
    this.stateVectorCache = null;
  }

  private applyTextProfilesToCachedSequences(): void {
    this.sequenceVisibleCache.clear();
    this.textSequenceCache.clear();
    this.sequenceAppendCache.clear();
  }
}

function addActorSeqRange(ranges: Array<[number, number]>, start: number, end: number): void {
  if (end < start) return;
  const length = ranges.length;
  if (length === 0) {
    ranges[0] = [start, end];
    return;
  }

  const last = ranges[length - 1];
  if (start >= last[0]) {
    if (start <= last[1] + 1) {
      if (end > last[1]) last[1] = end;
    } else {
      ranges[length] = [start, end];
    }
    return;
  }

  let index = 0;
  while (index < length && ranges[index][0] < start) index++;
  ranges.splice(index, 0, [start, end]);
  for (let i = Math.max(1, index); i < ranges.length;) {
    const previous = ranges[i - 1];
    const current = ranges[i];
    if (current[0] > previous[1] + 1) {
      i++;
      continue;
    }
    if (current[1] > previous[1]) previous[1] = current[1];
    ranges.splice(i, 1);
  }
}

function actorSeqRangesContain(ranges: Array<[number, number]> | undefined, seq: number): boolean {
  if (ranges === undefined) return false;
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const range = ranges[mid];
    if (seq < range[0]) {
      high = mid - 1;
    } else if (seq > range[1]) {
      low = mid + 1;
    } else {
      return true;
    }
  }
  return false;
}

function actorSeqRangesOverlap(ranges: Array<[number, number]> | undefined, start: number, end: number): boolean {
  if (ranges === undefined || ranges.length === 0) return false;
  let low = 0;
  let high = ranges.length - 1;
  let index = ranges.length;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (ranges[mid][1] >= start) {
      index = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }
  return index < ranges.length && ranges[index][0] <= end;
}

function actorSeqRangesCover(ranges: Array<[number, number]> | undefined, start: number, end: number): boolean {
  if (ranges === undefined || ranges.length === 0) return false;
  let low = 0;
  let high = ranges.length - 1;
  let index = ranges.length;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (ranges[mid][1] >= start) {
      index = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  let cursor = start;
  for (let i = index, length = ranges.length; i < length; i++) {
    const range = ranges[i];
    if (range[0] > cursor) return false;
    if (range[1] >= cursor) cursor = range[1] + 1;
    if (cursor > end) return true;
  }
  return false;
}

class Transaction implements CrdtTransaction {
  private readonly ops: CrdtOperation[] = [];
  private readonly sequenceVisibleCache = new Map<string, string[]>();
  private readonly textSequenceCache = new Map<string, TextDirtySequence>();
  private readonly sequenceAppendCache = new Map<string, SequenceAppendState>();
  private textDirtySpans: TextDirtySpan[] | null = [];
  private textAppendRun: TransactionTextAppendRun | null = null;

  constructor(
    private readonly doc: FrontierCrdtDocument,
    private readonly metadata?: JsonObject
  ) {}

  set(path: WatchPath, value: JsonValue): this {
    this._push(this.doc._createSetOperation(normalizeCrdtPath(path), cloneJson(value)));
    return this;
  }

  delete(path: WatchPath): this {
    this._push(this.doc._createDeleteOperation(normalizeCrdtPath(path)));
    return this;
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

  resolveConflict(path: WatchPath, resolution: CrdtConflictResolution): this {
    const normalized = normalizeCrdtPath(path);
    const action = this.doc._resolveConflictAction(normalized, resolution);
    if (action.type === 'delete') this._push(this.doc._createDeleteOperation(normalized));
    else this._push(this.doc._createSetOperation(normalized, cloneJson(action.value)));
    return this;
  }

  map(path: WatchPath): CrdtMapHandle {
    return new TransactionMapHandle(this, normalizeCrdtPath(path));
  }

  counter(path: WatchPath): CrdtCounterHandle {
    return new TransactionCounterHandle(this, normalizeCrdtPath(path));
  }

  binary(path: WatchPath): CrdtBinaryHandle {
    return new TransactionBinaryHandle(this, normalizeCrdtPath(path));
  }

  list(path: WatchPath): CrdtListHandle {
    return new TransactionListHandle(this, normalizeCrdtPath(path));
  }

  text(path: WatchPath): CrdtTextHandle {
    return new TransactionTextHandle(this, normalizeCrdtPath(path));
  }

  tree(path: WatchPath): CrdtTreeHandle {
    return new TransactionTreeHandle(this, normalizeCrdtPath(path));
  }

  xml(path: WatchPath): CrdtXmlHandle {
    return new TransactionXmlHandle(this, normalizeCrdtPath(path));
  }

  commit(): CrdtCommitResult {
    this.finalizeTextAppendRun();
    return this.doc._commitLocal(
      this.ops,
      this.textDirtySpans,
      this.textDirtySpans === null ? null : this.textSequenceCache,
      false,
      this.metadata
    );
  }

  _push(op: CrdtOperation): void {
    this.ops.push(op);
    if (!isTextSequenceOperation(op)) {
      this.textDirtySpans = null;
    }
    this.notePendingOperation(op);
    if (op.type === 'textInsert') {
      this.rememberTextAppendRun(op);
    } else {
      this.textAppendRun = null;
    }
  }

  _pushTextInsert(op: Extract<CrdtOperation, { type: 'textInsert' }>, index: number, text: string): void {
    this._push(op);
    const insertCount = text.length === 1 ? 1 : codePointLength(text);
    const sequence = this.textSequenceCache.get(sequenceCacheKey(op.path, 'text'));
    if (sequence !== undefined) {
      sequence.sequence.insertCreated(index, op, insertCount);
      this.sequenceAppendCache.set(sequenceCacheKey(op.path, 'text'), {
        length: sequence.sequence.length,
        tail: sequence.sequence.tail()
      });
    }
    this.recordTextDirtySpan(op.path, index, 0, text);
  }

  _pushTextInsertAt(path: JsonPath, index: number, text: string): void {
    if (!Number.isSafeInteger(index) || index < 0) throw new RangeError('text index must be a non-negative safe integer');
    if (text.length === 0) return;
    if (this.tryExtendCachedTextAppend(path, index, text) || this.tryExtendLastTextAppend(path, index, text)) return;
    const op = createTextInsertOperation(this, path, index, text);
    if (op !== null) this._pushTextInsert(op, index, text);
  }

  _pushTextDelete(op: CrdtTextDeleteOperation, index: number): void {
    this._push(op);
    const sequence = this.textSequenceCache.get(sequenceCacheKey(op.path, 'text'));
    const count = textDeleteCount(op);
    if (sequence !== undefined) {
      sequence.sequence.delete(index, count);
      this.sequenceAppendCache.set(sequenceCacheKey(op.path, 'text'), {
        length: sequence.sequence.length,
        tail: sequence.sequence.tail()
      });
    }
    this.recordTextDirtySpan(op.path, index, count, '');
  }

  _pushTextSplice(path: JsonPath, index: number, deleteCount: number, insert: string): void {
    if (!Number.isSafeInteger(index) || index < 0) throw new RangeError('text index must be a non-negative safe integer');
    if (!Number.isSafeInteger(deleteCount) || deleteCount < 0) throw new RangeError('text delete count must be a non-negative safe integer');
    if (typeof insert !== 'string') throw new TypeError('text splice insert must be a string');
    if (deleteCount === 0 && insert.length === 0) return;

    const key = sequenceCacheKey(path, 'text');
    const entry = this.getTextSequence(path);
    const sequence = entry.sequence;
    const boundedIndex = Math.min(index, sequence.length);
    let actualDeleteCount = 0;
    if (deleteCount !== 0) {
      const deletePayload = createTextDeleteOperationPayloadFromSequence(sequence, boundedIndex, deleteCount);
      if (deletePayload !== null) {
        actualDeleteCount = deletePayload.count;
        const op = deletePayload.type === 'textDel'
          ? this._createOperation('textDel', path, { elems: deletePayload.elems }) as Extract<CrdtOperation, { type: 'textDel' }>
          : this._createOperation('textDelRange', path, deletePayload.range) as Extract<CrdtOperation, { type: 'textDelRange' }>;
        this.ops.push(op);
        sequence.delete(boundedIndex, actualDeleteCount);
      }
    }

    if (insert.length !== 0) {
      const insertCount = insert.length === 1 ? 1 : codePointLength(insert);
      const insertIndex = Math.min(index, sequence.length);
      const after = insertIndex === 0 ? null : insertIndex === sequence.length ? sequence.tail() : sequence.at(insertIndex - 1);
      const op = this._createTextInsertOperation(path, after, insert);
      this.ops.push(op);
      sequence.insertCreated(insertIndex, op, insertCount);
    }

    this.sequenceVisibleCache.delete(key);
    this.sequenceAppendCache.set(key, { length: sequence.length, tail: sequence.tail() });
    this.recordTextDirtySpan(path, boundedIndex, actualDeleteCount, insert);
  }

  _createOperation(type: CrdtOperation['type'], path: JsonPath, payload: Record<string, unknown>): CrdtOperation {
    return this.doc._createOperation(type, path, payload);
  }

  _createSetOperation(path: JsonPath, value: JsonValue): Extract<CrdtOperation, { type: 'set' }> {
    return this.doc._createSetOperation(path, value);
  }

  _createDeleteOperation(path: JsonPath): Extract<CrdtOperation, { type: 'del' }> {
    return this.doc._createDeleteOperation(path);
  }

  _createCounterOperation(path: JsonPath, delta: number): Extract<CrdtOperation, { type: 'counter' }> {
    return this.doc._createCounterOperation(path, delta);
  }

  _createBinarySetOperation(path: JsonPath, bytes: string): Extract<CrdtOperation, { type: 'binarySet' }> {
    return this.doc._createBinarySetOperation(path, bytes);
  }

  _createTreeCreateOperation(path: JsonPath, nodeId: string, parent: string | null, after: string | null, value: JsonValue): Extract<CrdtOperation, { type: 'treeCreate' }> {
    return this.doc._createTreeCreateOperation(path, nodeId, parent, after, value);
  }

  _createTreeMoveOperation(path: JsonPath, nodeId: string, parent: string | null, after: string | null): Extract<CrdtOperation, { type: 'treeMove' }> {
    return this.doc._createTreeMoveOperation(path, nodeId, parent, after);
  }

  _createTreeSetOperation(path: JsonPath, nodeId: string, value: JsonValue): Extract<CrdtOperation, { type: 'treeSet' }> {
    return this.doc._createTreeSetOperation(path, nodeId, value);
  }

  _createTreeDeleteOperation(path: JsonPath, nodeId: string): Extract<CrdtOperation, { type: 'treeDel' }> {
    return this.doc._createTreeDeleteOperation(path, nodeId);
  }

  _createListInsertOperation(path: JsonPath, after: string | null, values: JsonValue[]): Extract<CrdtOperation, { type: 'listInsert' }> {
    return this.doc._createListInsertOperation(path, after, values);
  }

  _createTextInsertOperation(path: JsonPath, after: string | null, text: string): Extract<CrdtOperation, { type: 'textInsert' }> {
    return this.doc._createTextInsertOperation(path, after, text);
  }

  _reserveOperationSeq(expected?: number): number {
    return this.doc._reserveOperationSeq(expected);
  }

  _visibleListElementIds(path: JsonPath): string[] {
    return this.getVisibleElementIds(path, 'list');
  }

  _listValuesSlice(path: JsonPath, index: number, count: number): JsonValue[] {
    return this.doc._listValuesSlice(path, index, count);
  }

  _treeValue(path: JsonPath): CrdtTreeNode[] {
    const ops = this.doc._readyOperationsSnapshot();
    for (let i = 0, length = this.ops.length; i < length; i++) ops[ops.length] = this.ops[i];
    return materializeTree(ops, path);
  }

  _visibleTextElementIds(path: JsonPath): string[] {
    return this.getVisibleElementIds(path, 'text');
  }

  _textSequenceLength(path: JsonPath): number {
    return this.getTextSequence(path).sequence.length;
  }

  _textElementAt(path: JsonPath, index: number): string | null {
    return this.getTextSequence(path).sequence.at(index);
  }

  _textElementsSlice(path: JsonPath, index: number, count: number): string[] {
    return this.getTextSequence(path).sequence.slice(index, count);
  }

  _sequenceAppendState(path: JsonPath, kind: 'list' | 'text'): SequenceAppendState | null {
    return this.getSequenceAppendState(path, kind);
  }

  private getVisibleElementIds(path: JsonPath, kind: 'list' | 'text'): string[] {
    const key = sequenceCacheKey(path, kind);
    const cached = this.sequenceVisibleCache.get(key);
    if (cached !== undefined) return cached;
    const visible = kind === 'list'
      ? this.doc._visibleListElementIds(path).slice()
      : this.doc._visibleTextElementIds(path).slice();
    this.replayPendingSequenceOps(visible, path, kind);
    this.sequenceVisibleCache.set(key, visible);
    this.sequenceAppendCache.set(key, { length: visible.length, tail: visible.length === 0 ? null : visible[visible.length - 1] });
    return visible;
  }

  private replayPendingSequenceOps(visible: string[], path: JsonPath, kind: 'list' | 'text'): void {
    for (let i = 0, length = this.ops.length; i < length; i++) {
      const op = this.ops[i];
      if (!samePath(op.path, path)) continue;
      if (kind === 'text') {
        if (op.type === 'textInsert' || op.type === 'textRun') {
          const index = indexAfterElement(visible, op.after);
          if (index === -1) continue;
          insertCreatedElementIds(visible, index, op, op.type === 'textRun' ? op.count : codePointLength(op.text));
        } else if (isTextDeleteOperation(op)) {
          const range = textDeleteIndexRange(visible, op);
          if (range !== null) visible.splice(range.index, range.count);
        }
      } else if (op.type === 'listInsert' || op.type === 'listRun') {
        const index = indexAfterElement(visible, op.after);
        if (index === -1) continue;
        insertCreatedElementIds(visible, index, op, op.type === 'listRun' ? op.count : op.values.length);
      } else if (op.type === 'listDel') {
        const indexes = elementIndexes(visible, op.elems);
        if (indexes !== null) visible.splice(indexes[0], indexes.length);
      }
    }
  }

  private getSequenceAppendState(path: JsonPath, kind: 'list' | 'text'): SequenceAppendState | null {
    const key = sequenceCacheKey(path, kind);
    if (kind === 'text' && this.textAppendRun !== null && this.textAppendRun.key === key) {
      this.syncTextAppendRunTail(this.textAppendRun);
      return this.textAppendRun.appendState;
    }
    const cached = this.sequenceAppendCache.get(key);
    if (cached !== undefined) return cached;
    if (kind === 'text') {
      const sequence = this.textSequenceCache.get(key);
      if (sequence !== undefined) {
        const state = { length: sequence.sequence.length, tail: sequence.sequence.tail() };
        this.sequenceAppendCache.set(key, state);
        return state;
      }
    }
    const visible = this.sequenceVisibleCache.get(key);
    if (visible !== undefined) {
      const state = { length: visible.length, tail: visible.length === 0 ? null : visible[visible.length - 1] };
      this.sequenceAppendCache.set(key, state);
      return state;
    }
    const base = this.doc._sequenceAppendState(path, kind);
    if (base === null) return null;
    const state = { length: base.length, tail: base.tail };
    this.sequenceAppendCache.set(key, state);
    return state;
  }

  private notePendingOperation(op: CrdtOperation): void {
    if (isRegisterLikeOperation(op)) {
      this.sequenceVisibleCache.clear();
      this.textSequenceCache.clear();
      this.sequenceAppendCache.clear();
      this.textAppendRun = null;
      return;
    }

    const kind = isTextSequenceOperation(op) ? 'text' : 'list';
    const key = sequenceCacheKey(op.path, kind);
    this.noteSequenceAppendCacheApplied(key, op);
    const cached = this.sequenceVisibleCache.get(key);
    if (cached === undefined) return;

    if (op.type === 'textInsert' || op.type === 'textRun') {
      const index = indexAfterElement(cached, op.after);
      if (index === -1) {
        this.sequenceVisibleCache.delete(key);
        return;
      }
      insertCreatedElementIds(cached, index, op, op.type === 'textRun' ? op.count : op.text.length === 1 ? 1 : codePointLength(op.text));
    } else if (op.type === 'listInsert' || op.type === 'listRun') {
      const index = indexAfterElement(cached, op.after);
      if (index === -1) {
        this.sequenceVisibleCache.delete(key);
        return;
      }
      insertCreatedElementIds(cached, index, op, op.type === 'listRun' ? op.count : op.values.length);
    } else if (isTextDeleteOperation(op)) {
      const range = textDeleteIndexRange(cached, op);
      if (range === null) {
        this.sequenceVisibleCache.delete(key);
        return;
      }
      cached.splice(range.index, range.count);
    } else if (op.type === 'listDel') {
      const indexes = elementIndexes(cached, op.elems);
      if (indexes === null) {
        this.sequenceVisibleCache.delete(key);
        return;
      }
      cached.splice(indexes[0], indexes.length);
    }
  }

  private noteSequenceAppendCacheApplied(key: string, op: CrdtOperation): void {
    if (isTextDeleteOperation(op) || op.type === 'listDel') {
      this.sequenceAppendCache.delete(key);
      if (this.textAppendRun !== null && this.textAppendRun.key === key) this.textAppendRun = null;
      return;
    }
    if (op.type !== 'textInsert' && op.type !== 'textRun' && op.type !== 'listInsert' && op.type !== 'listRun') return;
    const count = op.type === 'listInsert' || op.type === 'listRun'
      ? op.values.length
      : op.type === 'textRun'
        ? op.count
        : codePointLength(op.text);
    const tail = createdElementId(op, count - 1);
    const cached = this.sequenceAppendCache.get(key);
    if (cached === undefined) {
      return;
    }
    if (cached.tail === op.after) {
      cached.length += count;
      cached.tail = tail;
    } else {
      this.sequenceAppendCache.delete(key);
      if (this.textAppendRun !== null && this.textAppendRun.key === key) this.textAppendRun = null;
    }
  }

  private rememberTextAppendRun(op: Extract<CrdtOperation, { type: 'textInsert' }>): void {
    if (!isSingleCodePointString(op.text)) {
      this.textAppendRun = null;
      return;
    }
    const key = sequenceCacheKey(op.path, 'text');
    const state = this.sequenceAppendCache.get(key);
    const tail = createdElementId(op, 0);
    if (state === undefined || state.tail !== tail) {
      this.textAppendRun = null;
      return;
    }
    this.textAppendRun = { key, path: op.path, op, appendState: state, length: state.length, tail, tailSeq: op.seq, unitText: op.text };
  }

  private syncTextAppendRunTail(cached: TransactionTextAppendRun): string {
    if (cached.tail.length !== 0) return cached.tail;
    const tail = `${cached.op.actor}:${cached.tailSeq}/0`;
    cached.tail = tail;
    cached.appendState.tail = tail;
    return tail;
  }

  private recordTextDirtySpan(path: JsonPath, index: number, deleteCount: number, insert: string): void {
    if (this.textDirtySpans === null || (deleteCount === 0 && insert.length === 0)) return;
    if (!this.doc._canApplyTextDirtyPatch(path)) {
      this.textDirtySpans = null;
      return;
    }
    appendTextDirtySpan(this.textDirtySpans, path, index, deleteCount, insert);
  }

  private tryExtendLastTextAppend(path: JsonPath, index: number, text: string): boolean {
    if (!isSingleCodePointString(text)) return false;
    const key = sequenceCacheKey(path, 'text');
    const appendState = this.getSequenceAppendState(path, 'text');
    if (appendState === null || index < appendState.length) return false;
    const lastIndex = this.ops.length - 1;
    if (lastIndex < 0) return false;
    const last = this.ops[lastIndex];
    if (
      (last.type !== 'textInsert' && last.type !== 'textRun') ||
      last.actor !== this.doc.actorId ||
      !samePath(last.path, path) ||
      appendState.tail !== createdElementId(last, operationSeqSpan(last) - 1) ||
      (last.type === 'textInsert' && !isSingleCodePointString(last.text))
    ) {
      return false;
    }

    const expectedSeq = operationEndSeq(last) + 1;
    const seq = this.doc._reserveOperationSeq(expectedSeq);
    if (seq === 0) return false;
    const previousTail = appendState.tail;
    if (last.type === 'textRun') {
      last.text += text;
      last.count++;
    } else {
      this.ops[lastIndex] = {
        type: 'textRun',
        id: last.id,
        actor: last.actor,
        seq: last.seq,
        deps: last.deps,
        path: last.path,
        after: last.after,
        text: last.text + text,
        count: 2
      };
    }

    const insertedId = `${this.doc.actorId}:${seq}/0`;
    const insertIndex = appendState.length;
    appendState.length++;
    appendState.tail = insertedId;
    this.sequenceAppendCache.set(key, appendState);
    const visible = this.sequenceVisibleCache.get(key);
    if (visible !== undefined) visible[visible.length] = insertedId;
    const sequence = this.textSequenceCache.get(key);
    if (sequence !== undefined) {
      sequence.sequence.insertCreated(insertIndex, {
        type: 'textInsert',
        id: `${this.doc.actorId}:${seq}`,
        actor: this.doc.actorId,
        seq,
        deps: [],
        path,
        after: previousTail,
        text
      }, 1);
    }
    if (this.textDirtySpans !== null) this.recordTextDirtySpan(path, insertIndex, 0, text);
    const run = this.ops[lastIndex] as Extract<CrdtOperation, { type: 'textInsert' | 'textRun' }>;
    this.textAppendRun = { key, path: run.path, op: run, appendState, length: appendState.length, tail: insertedId, tailSeq: seq, unitText: null };
    return true;
  }

  private tryExtendCachedTextAppend(path: JsonPath, index: number, text: string): boolean {
    const cached = this.textAppendRun;
    if (
      cached === null ||
      !isSingleCodePointString(text) ||
      index < cached.length ||
      !(cached.path === path || samePath(cached.path, path))
    ) {
      return false;
    }
    const lastIndex = this.ops.length - 1;
    if (this.ops[lastIndex] !== cached.op) return false;
    const seq = this.doc._reserveOperationSeq(operationEndSeq(cached.op) + 1);
    if (seq === 0) return false;
    const previousTail = cached.tail;
    let op = cached.op;
    if (op.type === 'textRun') {
      if (cached.unitText === null || cached.unitText !== text) {
        if (cached.unitText !== null) {
          op.text = cached.unitText.repeat(op.count);
          cached.unitText = null;
        }
        op.text += text;
      }
      op.count++;
    } else {
      op = {
        type: 'textRun',
        id: op.id,
        actor: op.actor,
        seq: op.seq,
        deps: op.deps,
        path: op.path,
        after: op.after,
        text: op.text === text ? op.text : op.text + text,
        count: 2
      };
      this.ops[lastIndex] = op;
      cached.op = op;
      if (cached.unitText !== text) cached.unitText = null;
    }
    const sequence = this.textSequenceCache.get(cached.key);
    const visible = this.sequenceVisibleCache.get(cached.key);
    const insertedId = sequence === undefined && visible === undefined ? '' : `${this.doc.actorId}:${seq}/0`;
    cached.length++;
    cached.tail = insertedId;
    cached.tailSeq = seq;
    cached.appendState.length = cached.length;
    if (insertedId.length !== 0) cached.appendState.tail = insertedId;
    if (visible !== undefined) visible[visible.length] = insertedId;
    if (sequence !== undefined) {
      sequence.sequence.insertCreated(cached.length - 1, {
        type: 'textInsert',
        id: `${this.doc.actorId}:${seq}`,
        actor: this.doc.actorId,
        seq,
        deps: [],
        path: cached.path,
        after: previousTail,
        text
      }, 1);
    }
    if (this.textDirtySpans !== null) this.recordTextDirtySpan(cached.path, cached.length - 1, 0, text);
    return true;
  }

  private finalizeTextAppendRun(): void {
    const cached = this.textAppendRun;
    if (cached === null) return;
    this.syncTextAppendRunTail(cached);
    if (cached.unitText === null || cached.op.type !== 'textRun') return;
    cached.op.text = cached.unitText.repeat(cached.op.count);
    cached.unitText = null;
  }

  private getTextSequence(path: JsonPath): TextDirtySequence {
    const key = sequenceCacheKey(path, 'text');
    let cached = this.textSequenceCache.get(key);
    if (cached !== undefined) return cached;
    cached = { path: path.slice(), sequence: this.doc._textSequenceSnapshot(path) };
    this.replayPendingTextOps(cached.sequence, path);
    this.textSequenceCache.set(key, cached);
    this.sequenceVisibleCache.delete(key);
    this.sequenceAppendCache.set(key, {
      length: cached.sequence.length,
      tail: cached.sequence.tail()
    });
    return cached;
  }

  private replayPendingTextOps(sequence: TextSequence, path: JsonPath): void {
    for (let i = 0, length = this.ops.length; i < length; i++) {
      const op = this.ops[i];
      if (!samePath(op.path, path)) continue;
      if (op.type === 'textInsert' || op.type === 'textRun') {
        const index = op.after === null ? 0 : sequence.indexOf(op.after) + 1;
        if (index > 0 || op.after === null) {
          sequence.insertCreated(index, op, op.type === 'textRun' ? op.count : codePointLength(op.text));
        }
      } else if (isTextDeleteOperation(op)) {
        if (textDeleteCount(op) === 0) continue;
        const range = sequenceTextDeleteRange(sequence, op);
        if (range !== null) sequence.delete(range.index, range.count);
      }
    }
  }

}

class MapHandle implements CrdtMapHandle {
  private readonly encodedChildPathPrefix: string;

  constructor(private readonly doc: FrontierCrdtDocument, private readonly path: JsonPath) {
    this.encodedChildPathPrefix = childPathJsonPrefix(path);
  }

  set(key: string | number, value: JsonValue): CrdtCommitResult {
    return this.doc._commitLocalMapSet(this.path, key, value, appendEncodedPathSegment(this.encodedChildPathPrefix, key));
  }

  delete(key: string | number): CrdtCommitResult {
    return this.doc._commitLocalMapDelete(this.path, key, appendEncodedPathSegment(this.encodedChildPathPrefix, key));
  }

  getConflict(key: string | number): CrdtConflict | undefined {
    return this.doc.getConflict(appendPathSegment(this.path, key));
  }

  getConflictSummary(key: string | number): CrdtConflictSummary | undefined {
    return this.doc.getConflictSummary(appendPathSegment(this.path, key));
  }

  getConflicts(): CrdtConflict[] {
    return this.doc._getDirectMapConflicts(this.path);
  }

  getConflictSummaries(): CrdtConflictSummary[] {
    return this.doc._getDirectMapConflictSummaries(this.path);
  }

  resolveConflict(
    key: string | number,
    resolution: CrdtConflictResolution,
    options?: CrdtConflictResolutionOptions
  ): CrdtCommitResult {
    return this.doc.resolveConflict(appendPathSegment(this.path, key), resolution, options);
  }

  map(key: string | number): CrdtMapHandle {
    return this.doc.map(appendPathSegment(this.path, key));
  }

  counter(key: string | number): CrdtCounterHandle {
    return this.doc.counter(appendPathSegment(this.path, key));
  }

  binary(key: string | number): CrdtBinaryHandle {
    return this.doc.binary(appendPathSegment(this.path, key));
  }

  list(key: string | number): CrdtListHandle {
    return this.doc.list(appendPathSegment(this.path, key));
  }

  text(key: string | number): CrdtTextHandle {
    return this.doc.text(appendPathSegment(this.path, key));
  }

  tree(key: string | number): CrdtTreeHandle {
    return this.doc.tree(appendPathSegment(this.path, key));
  }

  xml(key: string | number): CrdtXmlHandle {
    return this.doc.xml(appendPathSegment(this.path, key));
  }
}

class CounterHandle implements CrdtCounterHandle {
  private readonly encodedPath: string;

  constructor(private readonly doc: FrontierCrdtDocument, private readonly path: JsonPath) {
    this.encodedPath = pathKey(path);
  }

  increment(delta = 1): CrdtCommitResult {
    return this.doc._commitLocalCounter(this.path, delta, this.encodedPath);
  }

  decrement(delta = 1): CrdtCommitResult {
    return this.doc._commitLocalCounter(this.path, -delta, this.encodedPath);
  }
}

class BinaryHandle implements CrdtBinaryHandle {
  private readonly encodedPath: string;

  constructor(private readonly doc: FrontierCrdtDocument, private readonly path: JsonPath) {
    this.encodedPath = pathKey(path);
  }

  set(value: ArrayBuffer | ArrayBufferView): CrdtCommitResult {
    return this.doc._commitLocalBinarySet(this.path, value, this.encodedPath);
  }

  get(): Uint8Array | undefined {
    return this.doc._binaryValue(this.path);
  }

  delete(): CrdtCommitResult {
    return this.doc.delete(this.path);
  }
}

class ListHandle implements CrdtListHandle {
  private readonly encodedPath: string;
  private readonly sequenceKey: string;

  constructor(private readonly doc: FrontierCrdtDocument, private readonly path: JsonPath) {
    this.encodedPath = pathKey(path);
    this.sequenceKey = sequenceCacheKey(path, 'list');
  }

  insert(index: number, values: JsonValue | JsonValue[]): CrdtCommitResult {
    const valueList = Array.isArray(values) ? values : [values];
    return this.doc._commitLocalListInsert(this.path, index, valueList, this.encodedPath, this.sequenceKey);
  }

  delete(index: number, count = 1): CrdtCommitResult {
    const op = createListDeleteOperation(this.doc, this.path, index, count);
    return this.doc._commitLocal(op === null ? [] : [op]);
  }

  move(fromIndex: number, toIndex: number, count = 1): CrdtCommitResult {
    return this.doc._commitLocalListMove(this.path, fromIndex, toIndex, count, this.encodedPath, this.sequenceKey);
  }
}

class TextHandle implements CrdtTextHandle {
  private readonly encodedPath: string;
  private readonly sequenceKey: string;

  constructor(private readonly doc: FrontierCrdtDocument, private readonly path: JsonPath) {
    this.encodedPath = pathKey(path);
    this.sequenceKey = sequenceCacheKey(path, 'text');
  }

  insert(index: number, text: string): CrdtCommitResult {
    return this.doc._commitLocalTextInsert(this.path, index, text, this.encodedPath, this.sequenceKey);
  }

  delete(index: number, count = 1): CrdtCommitResult {
    return this.doc._commitLocalTextDelete(this.path, index, count, this.encodedPath, this.sequenceKey);
  }

  splice(index: number, deleteCount: number, insert: string): CrdtCommitResult {
    return this.doc._commitLocalTextSplice(this.path, index, deleteCount, insert, this.encodedPath, this.sequenceKey);
  }

  spliceBatch(splices: readonly CrdtTextSpliceInput[]): CrdtCommitResult {
    return this.doc._commitLocalTextSpliceBatch(this.path, splices, this.encodedPath, this.sequenceKey);
  }

  spliceColumnBatch(
    indexes: ArrayLike<number>,
    deleteCounts: ArrayLike<number>,
    inserts: ArrayLike<string>,
    insertLengths?: ArrayLike<number>
  ): CrdtCommitResult {
    return this.doc._commitLocalTextSpliceColumns(
      this.path,
      indexes,
      deleteCounts,
      inserts,
      insertLengths,
      this.encodedPath,
      this.sequenceKey
    );
  }
}

class TreeHandle implements CrdtTreeHandle {
  private readonly encodedPath: string;

  constructor(private readonly doc: FrontierCrdtDocument, private readonly path: JsonPath) {
    this.encodedPath = pathKey(path);
  }

  value(): CrdtTreeNode[] {
    return this.doc._treeValue(this.path);
  }

  createNode(parentId: string | null = null, value: JsonValue = {}, index?: number): CrdtTreeCreateResult {
    return this.doc._commitLocalTreeCreate(this.path, parentId, value, index, this.encodedPath);
  }

  move(nodeId: string, parentId: string | null = null, index?: number): CrdtCommitResult {
    return this.doc._commitLocalTreeMove(this.path, nodeId, parentId, index, this.encodedPath);
  }

  setValue(nodeId: string, value: JsonValue): CrdtCommitResult {
    return this.doc._commitLocalTreeSetValue(this.path, nodeId, value, this.encodedPath);
  }

  delete(nodeId: string): CrdtCommitResult {
    return this.doc._commitLocalTreeDelete(this.path, nodeId, this.encodedPath);
  }
}

class XmlHandle implements CrdtXmlHandle {
  private readonly treeHandle: CrdtTreeHandle;

  constructor(private readonly doc: FrontierCrdtDocument, private readonly path: JsonPath) {
    this.treeHandle = doc.tree(path);
  }

  value(): CrdtXmlNode[] {
    return treeNodesToXml(this.treeHandle.value());
  }

  toString(): string {
    return serializeXmlNodes(this.value());
  }

  insertElement(parentId: string | null, index: number, name: string, attributes?: JsonObject): CrdtTreeCreateResult {
    validateXmlElementName(name);
    return this.treeHandle.createNode(parentId, {
      type: 'element',
      name,
      attributes: attributes === undefined ? {} : cloneJson(attributes)
    }, index);
  }

  insertText(parentId: string | null, index: number, text: string): CrdtTreeCreateResult {
    if (typeof text !== 'string') throw new TypeError('XML text must be a string');
    return this.treeHandle.createNode(parentId, { type: 'text', text }, index);
  }

  move(nodeId: string, parentId: string | null = null, index?: number): CrdtCommitResult {
    return this.treeHandle.move(nodeId, parentId, index);
  }

  delete(nodeId: string): CrdtCommitResult {
    return this.treeHandle.delete(nodeId);
  }

  setAttribute(nodeId: string, key: string, value: JsonValue): CrdtCommitResult {
    validateXmlElementName(key);
    const node = findTreeNode(this.treeHandle.value(), nodeId);
    if (node === null || !isXmlElementValue(node.value)) return this.doc._commitLocal([]);
    const next = cloneJson(node.value);
    const attributes = next.attributes === undefined ? {} : cloneJson(next.attributes);
    setOwnValue(attributes, key, cloneJson(value));
    next.attributes = attributes;
    return this.treeHandle.setValue(nodeId, next);
  }

  removeAttribute(nodeId: string, key: string): CrdtCommitResult {
    validateXmlElementName(key);
    const node = findTreeNode(this.treeHandle.value(), nodeId);
    if (node === null || !isXmlElementValue(node.value) || node.value.attributes === undefined) return this.doc._commitLocal([]);
    const next = cloneJson(node.value);
    const attributes = cloneJson(next.attributes || {});
    delete attributes[key];
    next.attributes = attributes;
    return this.treeHandle.setValue(nodeId, next);
  }
}

class TransactionMapHandle implements CrdtMapHandle {
  constructor(private readonly tx: Transaction, private readonly path: JsonPath) {}

  set(key: string | number, value: JsonValue): CrdtCommitResult {
    this.tx._push(this.tx._createSetOperation(appendPathSegment(this.path, key), cloneJson(value)));
    return EMPTY_TRANSACTION_RESULT;
  }

  delete(key: string | number): CrdtCommitResult {
    this.tx._push(this.tx._createDeleteOperation(appendPathSegment(this.path, key)));
    return EMPTY_TRANSACTION_RESULT;
  }

  getConflict(key: string | number): CrdtConflict | undefined {
    return this.tx.getConflict(appendPathSegment(this.path, key));
  }

  getConflictSummary(key: string | number): CrdtConflictSummary | undefined {
    return this.tx.getConflictSummary(appendPathSegment(this.path, key));
  }

  getConflicts(): CrdtConflict[] {
    return this.tx.getConflicts(this.path).filter((conflict) => sameParentPath(conflict.path, this.path));
  }

  getConflictSummaries(): CrdtConflictSummary[] {
    return this.tx.getConflictSummaries(this.path).filter((conflict) => sameParentPath(conflict.path, this.path));
  }

  resolveConflict(key: string | number, resolution: CrdtConflictResolution): CrdtCommitResult {
    this.tx.resolveConflict(appendPathSegment(this.path, key), resolution);
    return EMPTY_TRANSACTION_RESULT;
  }

  map(key: string | number): CrdtMapHandle {
    return this.tx.map(appendPathSegment(this.path, key));
  }

  counter(key: string | number): CrdtCounterHandle {
    return this.tx.counter(appendPathSegment(this.path, key));
  }

  binary(key: string | number): CrdtBinaryHandle {
    return this.tx.binary(appendPathSegment(this.path, key));
  }

  list(key: string | number): CrdtListHandle {
    return this.tx.list(appendPathSegment(this.path, key));
  }

  text(key: string | number): CrdtTextHandle {
    return this.tx.text(appendPathSegment(this.path, key));
  }

  tree(key: string | number): CrdtTreeHandle {
    return this.tx.tree(appendPathSegment(this.path, key));
  }

  xml(key: string | number): CrdtXmlHandle {
    return this.tx.xml(appendPathSegment(this.path, key));
  }
}

class TransactionCounterHandle implements CrdtCounterHandle {
  constructor(private readonly tx: Transaction, private readonly path: JsonPath) {}

  increment(delta = 1): CrdtCommitResult {
    const normalized = normalizeCounterDelta(delta);
    if (normalized !== 0) this.tx._push(this.tx._createCounterOperation(this.path, normalized));
    return EMPTY_TRANSACTION_RESULT;
  }

  decrement(delta = 1): CrdtCommitResult {
    const normalized = normalizeCounterDelta(delta);
    if (normalized !== 0) this.tx._push(this.tx._createCounterOperation(this.path, -normalized));
    return EMPTY_TRANSACTION_RESULT;
  }
}

class TransactionBinaryHandle implements CrdtBinaryHandle {
  constructor(private readonly tx: Transaction, private readonly path: JsonPath) {}

  set(value: ArrayBuffer | ArrayBufferView): CrdtCommitResult {
    this.tx._push(this.tx._createBinarySetOperation(this.path, bytesToBase64(toBinaryUint8Array(value))));
    return EMPTY_TRANSACTION_RESULT;
  }

  get(): Uint8Array | undefined {
    return undefined;
  }

  delete(): CrdtCommitResult {
    this.tx._push(this.tx._createDeleteOperation(this.path));
    return EMPTY_TRANSACTION_RESULT;
  }
}

class TransactionListHandle implements CrdtListHandle {
  constructor(private readonly tx: Transaction, private readonly path: JsonPath) {}

  insert(index: number, values: JsonValue | JsonValue[]): CrdtCommitResult {
    const valueList = Array.isArray(values) ? values : [values];
    const op = createListInsertOperation(this.tx, this.path, index, valueList);
    if (op !== null) this.tx._push(op);
    return EMPTY_TRANSACTION_RESULT;
  }

  delete(index: number, count = 1): CrdtCommitResult {
    const op = createListDeleteOperation(this.tx, this.path, index, count);
    if (op !== null) this.tx._push(op);
    return EMPTY_TRANSACTION_RESULT;
  }

  move(fromIndex: number, toIndex: number, count = 1): CrdtCommitResult {
    const move = createListMovePlan(this.tx, this.path, fromIndex, toIndex, count);
    if (move !== null) {
      for (let i = 0, length = move.ops.length; i < length; i++) this.tx._push(move.ops[i]);
    }
    return EMPTY_TRANSACTION_RESULT;
  }
}

class TransactionTextHandle implements CrdtTextHandle {
  constructor(private readonly tx: Transaction, private readonly path: JsonPath) {}

  insert(index: number, text: string): CrdtCommitResult {
    this.tx._pushTextInsertAt(this.path, index, text);
    return EMPTY_TRANSACTION_RESULT;
  }

  delete(index: number, count = 1): CrdtCommitResult {
    const op = createTextDeleteOperation(this.tx, this.path, index, count);
    if (op !== null) this.tx._pushTextDelete(op, index);
    return EMPTY_TRANSACTION_RESULT;
  }

  splice(index: number, deleteCount: number, insert: string): CrdtCommitResult {
    this.tx._pushTextSplice(this.path, index, deleteCount, insert);
    return EMPTY_TRANSACTION_RESULT;
  }

  spliceBatch(splices: readonly CrdtTextSpliceInput[]): CrdtCommitResult {
    if (!Array.isArray(splices)) throw new TypeError('text splice batch must be an array');
    for (let i = 0, length = splices.length; i < length; i++) {
      const splice = splices[i];
      if (Array.isArray(splice)) {
        this.tx._pushTextSplice(this.path, splice[0], splice[1], splice[2]);
      } else {
        this.tx._pushTextSplice(this.path, splice.index, splice.deleteCount, splice.insert);
      }
    }
    return EMPTY_TRANSACTION_RESULT;
  }

  spliceColumnBatch(
    indexes: ArrayLike<number>,
    deleteCounts: ArrayLike<number>,
    inserts: ArrayLike<string>,
    insertLengths?: ArrayLike<number>
  ): CrdtCommitResult {
    const spliceCount = readCrdtTextSpliceColumnLength(indexes, deleteCounts, inserts, insertLengths);
    for (let i = 0; i < spliceCount; i++) this.tx._pushTextSplice(this.path, indexes[i], deleteCounts[i], inserts[i]);
    return EMPTY_TRANSACTION_RESULT;
  }
}

class TransactionTreeHandle implements CrdtTreeHandle {
  constructor(private readonly tx: Transaction, private readonly path: JsonPath) {}

  value(): CrdtTreeNode[] {
    return this.tx._treeValue(this.path);
  }

  createNode(parentId: string | null = null, value: JsonValue = {}, index?: number): CrdtTreeCreateResult {
    const currentTree = this.tx._treeValue(this.path);
    const parent = normalizeTreeParent(parentId);
    if (parent !== null && !treeContainsNode(currentTree, parent)) throw new RangeError('tree parent does not exist');
    const after = treeAfterForIndex(currentTree, parent, index);
    const op = this.tx._createTreeCreateOperation(this.path, '', parent, after, cloneJson(value));
    op.nodeId = op.id;
    this.tx._push(op);
    return { ...EMPTY_TRANSACTION_RESULT, id: op.nodeId };
  }

  move(nodeId: string, parentId: string | null = null, index?: number): CrdtCommitResult {
    validateTreeNodeId(nodeId);
    const currentTree = this.tx._treeValue(this.path);
    const parent = normalizeTreeParent(parentId);
    if (parent !== null && !treeContainsNode(currentTree, parent)) throw new RangeError('tree parent does not exist');
    if (!treeContainsNode(currentTree, nodeId) || treeIsDescendant(currentTree, nodeId, parent)) return EMPTY_TRANSACTION_RESULT;
    this.tx._push(this.tx._createTreeMoveOperation(this.path, nodeId, parent, treeAfterForIndex(currentTree, parent, index, nodeId)));
    return EMPTY_TRANSACTION_RESULT;
  }

  setValue(nodeId: string, value: JsonValue): CrdtCommitResult {
    validateTreeNodeId(nodeId);
    if (!treeContainsNode(this.tx._treeValue(this.path), nodeId)) return EMPTY_TRANSACTION_RESULT;
    this.tx._push(this.tx._createTreeSetOperation(this.path, nodeId, cloneJson(value)));
    return EMPTY_TRANSACTION_RESULT;
  }

  delete(nodeId: string): CrdtCommitResult {
    validateTreeNodeId(nodeId);
    if (!treeContainsNode(this.tx._treeValue(this.path), nodeId)) return EMPTY_TRANSACTION_RESULT;
    this.tx._push(this.tx._createTreeDeleteOperation(this.path, nodeId));
    return EMPTY_TRANSACTION_RESULT;
  }
}

class TransactionXmlHandle implements CrdtXmlHandle {
  private readonly treeHandle: CrdtTreeHandle;

  constructor(private readonly tx: Transaction, private readonly path: JsonPath) {
    this.treeHandle = tx.tree(path);
  }

  value(): CrdtXmlNode[] {
    return treeNodesToXml(this.treeHandle.value());
  }

  toString(): string {
    return serializeXmlNodes(this.value());
  }

  insertElement(parentId: string | null, index: number, name: string, attributes?: JsonObject): CrdtTreeCreateResult {
    validateXmlElementName(name);
    return this.treeHandle.createNode(parentId, {
      type: 'element',
      name,
      attributes: attributes === undefined ? {} : cloneJson(attributes)
    }, index);
  }

  insertText(parentId: string | null, index: number, text: string): CrdtTreeCreateResult {
    if (typeof text !== 'string') throw new TypeError('XML text must be a string');
    return this.treeHandle.createNode(parentId, { type: 'text', text }, index);
  }

  move(nodeId: string, parentId: string | null = null, index?: number): CrdtCommitResult {
    return this.treeHandle.move(nodeId, parentId, index);
  }

  delete(nodeId: string): CrdtCommitResult {
    return this.treeHandle.delete(nodeId);
  }

  setAttribute(nodeId: string, key: string, value: JsonValue): CrdtCommitResult {
    validateXmlElementName(key);
    const node = findTreeNode(this.treeHandle.value(), nodeId);
    if (node === null || !isXmlElementValue(node.value)) return EMPTY_TRANSACTION_RESULT;
    const next = cloneJson(node.value);
    const attributes = next.attributes === undefined ? {} : cloneJson(next.attributes);
    setOwnValue(attributes, key, cloneJson(value));
    next.attributes = attributes;
    return this.treeHandle.setValue(nodeId, next);
  }

  removeAttribute(nodeId: string, key: string): CrdtCommitResult {
    validateXmlElementName(key);
    const node = findTreeNode(this.treeHandle.value(), nodeId);
    if (node === null || !isXmlElementValue(node.value) || node.value.attributes === undefined) return EMPTY_TRANSACTION_RESULT;
    const next = cloneJson(node.value);
    const attributes = cloneJson(next.attributes || {});
    delete attributes[key];
    next.attributes = attributes;
    return this.treeHandle.setValue(nodeId, next);
  }
}

function createListInsertOperation(
  owner: FrontierCrdtDocument | Transaction,
  path: JsonPath,
  index: number,
  values: JsonValue[]
): CrdtOperation | null {
  if (!Number.isSafeInteger(index) || index < 0) throw new RangeError('list index must be a non-negative safe integer');
  if (values.length === 0) return null;
  const appendState = owner._sequenceAppendState(path, 'list');
  let after: string | null;
  if (appendState !== null && index >= appendState.length) {
    after = appendState.tail;
  } else {
    const visible = owner._visibleListElementIds(path);
    const boundedIndex = Math.min(index, visible.length);
    after = boundedIndex === 0 ? null : visible[boundedIndex - 1];
  }
  const cloned = new Array<JsonValue>(values.length);
  for (let i = 0, length = values.length; i < length; i++) cloned[i] = cloneJson(values[i]);
  return owner._createListInsertOperation(path, after, cloned);
}

type ListMovePlan = {
  fromIndex: number;
  insertIndex: number;
  count: number;
  patchValues: JsonValue[];
  nextValues: JsonValue[];
  ops: CrdtOperation[];
};

function createListMovePlan(
  owner: FrontierCrdtDocument | Transaction,
  path: JsonPath,
  fromIndex: number,
  toIndex: number,
  count: number
): ListMovePlan | null {
  if (!Number.isSafeInteger(fromIndex) || fromIndex < 0) throw new RangeError('list move fromIndex must be a non-negative safe integer');
  if (!Number.isSafeInteger(toIndex) || toIndex < 0) throw new RangeError('list move toIndex must be a non-negative safe integer');
  if (!Number.isSafeInteger(count) || count < 0) throw new RangeError('list move count must be a non-negative safe integer');
  if (count === 0) return null;

  const visible = owner._visibleListElementIds(path);
  if (fromIndex >= visible.length) return null;
  const actualCount = Math.min(count, visible.length - fromIndex);
  if (actualCount === 0) return null;

  const values = owner._listValuesSlice(path, fromIndex, actualCount);
  if (values.length === 0) return null;
  const elems = visible.slice(fromIndex, fromIndex + actualCount);
  const remaining = visible.slice(0, fromIndex).concat(visible.slice(fromIndex + actualCount));
  const insertIndex = Math.min(toIndex, remaining.length);
  if (insertIndex === fromIndex) return null;
  const after = insertIndex === 0 ? null : remaining[insertIndex - 1];
  const deleteOp = owner._createOperation('listDel', path, { elems });
  const insertValues = new Array<JsonValue>(values.length);
  const patchValues = new Array<JsonValue>(values.length);
  for (let i = 0, length = values.length; i < length; i++) {
    insertValues[i] = cloneJson(values[i]);
    patchValues[i] = cloneJson(values[i]);
  }
  const insertOp = owner._createListInsertOperation(path, after, insertValues);
  insertOp.deps = [operationHeadId(deleteOp)];
  const nextValues = owner._listValuesSlice(path, 0, visible.length);
  nextValues.splice(fromIndex, actualCount);
  nextValues.splice(insertIndex, 0, ...values.map((value) => cloneJson(value)));
  return {
    fromIndex,
    insertIndex,
    count: actualCount,
    patchValues,
    nextValues,
    ops: [deleteOp, insertOp]
  };
}

function createListDeleteOperation(
  owner: FrontierCrdtDocument | Transaction,
  path: JsonPath,
  index: number,
  count: number
): CrdtOperation | null {
  if (!Number.isSafeInteger(index) || index < 0) throw new RangeError('list index must be a non-negative safe integer');
  if (!Number.isSafeInteger(count) || count < 0) throw new RangeError('list delete count must be a non-negative safe integer');
  if (count === 0) return null;
  const visible = owner._visibleListElementIds(path);
  const elems = visible.slice(index, index + count);
  if (elems.length === 0) return null;
  return owner._createOperation('listDel', path, { elems });
}

function normalizeCounterDelta(delta: number): number {
  if (!Number.isSafeInteger(delta)) throw new RangeError('counter delta must be a safe integer');
  return delta;
}

function toBinaryUint8Array(value: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (value instanceof ArrayBuffer) return new Uint8Array(value).slice();
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
  throw new TypeError('binary value must be an ArrayBuffer or typed array');
}

function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (const length = bytes.byteLength; i + 2 < length; i += 3) {
    const value = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += BASE64_ALPHABET[(value >>> 18) & 63] +
      BASE64_ALPHABET[(value >>> 12) & 63] +
      BASE64_ALPHABET[(value >>> 6) & 63] +
      BASE64_ALPHABET[value & 63];
  }
  if (i < bytes.byteLength) {
    const a = bytes[i];
    const b = i + 1 < bytes.byteLength ? bytes[i + 1] : 0;
    const value = (a << 16) | (b << 8);
    out += BASE64_ALPHABET[(value >>> 18) & 63] + BASE64_ALPHABET[(value >>> 12) & 63];
    out += i + 1 < bytes.byteLength ? BASE64_ALPHABET[(value >>> 6) & 63] + '=' : '==';
  }
  return out;
}

function base64ToBytes(value: string): Uint8Array {
  if (value.length === 0) return new Uint8Array(0);
  if (value.length % 4 === 1) throw new TypeError('invalid base64 binary value');
  let padding = 0;
  if (value.endsWith('==')) padding = 2;
  else if (value.endsWith('=')) padding = 1;
  const outputLength = Math.floor(value.length * 3 / 4) - padding;
  const out = new Uint8Array(outputLength);
  let outOffset = 0;
  for (let i = 0, length = value.length; i < length; i += 4) {
    const a = readBase64Sextet(value, i);
    const b = readBase64Sextet(value, i + 1);
    const c = i + 2 < length && value.charCodeAt(i + 2) !== 61 ? readBase64Sextet(value, i + 2) : 0;
    const d = i + 3 < length && value.charCodeAt(i + 3) !== 61 ? readBase64Sextet(value, i + 3) : 0;
    const chunk = (a << 18) | (b << 12) | (c << 6) | d;
    if (outOffset < outputLength) out[outOffset++] = (chunk >>> 16) & 255;
    if (outOffset < outputLength) out[outOffset++] = (chunk >>> 8) & 255;
    if (outOffset < outputLength) out[outOffset++] = chunk & 255;
  }
  return out;
}

function readBase64Sextet(value: string, index: number): number {
  if (index >= value.length) throw new TypeError('invalid base64 binary value');
  const code = value.charCodeAt(index);
  if (code >= 65 && code <= 90) return code - 65;
  if (code >= 97 && code <= 122) return code - 71;
  if (code >= 48 && code <= 57) return code + 4;
  if (code === 43) return 62;
  if (code === 47) return 63;
  throw new TypeError('invalid base64 binary value');
}

function binaryJsonValue(bytes: string): JsonObject {
  return { [CRDT_BINARY_JSON_KEY]: bytes };
}

function binaryJsonToBytes(value: JsonValue | undefined): Uint8Array | undefined {
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const encoded = (value as Record<string, JsonValue>)[CRDT_BINARY_JSON_KEY];
  return typeof encoded === 'string' ? base64ToBytes(encoded) : undefined;
}

function validateTreeNodeId(nodeId: unknown): asserts nodeId is string {
  if (typeof nodeId !== 'string' || nodeId.length === 0) throw new TypeError('tree node id must be a non-empty string');
}

function normalizeTreeParent(parent: string | null | undefined): string | null {
  if (parent === undefined || parent === null) return null;
  validateTreeNodeId(parent);
  return parent;
}

function readTreeJsonValue(value: JsonValue | undefined): CrdtTreeNode[] {
  if (!Array.isArray(value)) return [];
  return readTreeNodeArray(value, null);
}

function readTreeNodeArray(values: JsonValue[], parent: string | null): CrdtTreeNode[] {
  const out: CrdtTreeNode[] = [];
  for (let i = 0, length = values.length; i < length; i++) {
    const raw = values[i];
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const record = raw as Record<string, JsonValue>;
    if (typeof record.id !== 'string') continue;
    const nodeParent = typeof record.parent === 'string' ? record.parent : parent;
    const children = Array.isArray(record.children) ? readTreeNodeArray(record.children, record.id) : [];
    out[out.length] = {
      id: record.id,
      parent: nodeParent,
      index: Number.isSafeInteger(record.index) ? record.index as number : out.length,
      value: record.value === undefined ? {} : cloneJson(record.value),
      children
    };
  }
  return out;
}

function treeAfterForIndex(tree: CrdtTreeNode[], parentId: string | null, index?: number, ignoreId?: string): string | null {
  const parent = parentId === null ? null : findTreeNode(tree, parentId);
  if (parentId !== null && parent === null) throw new RangeError('tree parent does not exist');
  const children = parent === null ? tree : parent.children;
  const siblings = ignoreId === undefined ? children : children.filter((node) => node.id !== ignoreId);
  const boundedIndex = index === undefined
    ? siblings.length
    : Math.max(0, Math.min(readNonNegativeSafeInteger(index, 'tree index'), siblings.length));
  return boundedIndex === 0 ? null : siblings[boundedIndex - 1].id;
}

function readNonNegativeSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(name + ' must be a non-negative safe integer');
  return value;
}

function treeContainsNode(tree: CrdtTreeNode[], nodeId: string): boolean {
  return findTreeNode(tree, nodeId) !== null;
}

function findTreeNode(tree: CrdtTreeNode[], nodeId: string): CrdtTreeNode | null {
  for (let i = 0, length = tree.length; i < length; i++) {
    const node = tree[i];
    if (node.id === nodeId) return node;
    const child = findTreeNode(node.children, nodeId);
    if (child !== null) return child;
  }
  return null;
}

function treeIsDescendant(tree: CrdtTreeNode[], ancestorId: string, candidateId: string | null): boolean {
  if (candidateId === null) return false;
  const ancestor = findTreeNode(tree, ancestorId);
  return ancestor === null ? false : treeContainsNode(ancestor.children, candidateId);
}

function materializeTree(ops: CrdtOperation[], path: JsonPath): CrdtTreeNode[] {
  const pathId = pathKey(path);
  const treeOps: Array<Extract<CrdtOperation, { type: 'treeCreate' | 'treeMove' | 'treeSet' | 'treeDel' }>> = [];
  for (let i = 0, length = ops.length; i < length; i++) {
    const op = ops[i];
    if (isTreeOperation(op) && pathKey(op.path) === pathId) treeOps[treeOps.length] = op;
  }
  if (treeOps.length === 0) return [];
  sortOperationsIfNeeded(treeOps);
  const compare = createCausalComparator(treeOps);
  const records = new Map<string, TreeRecord>();

  for (let i = 0, length = treeOps.length; i < length; i++) {
    const op = treeOps[i];
    if (op.type !== 'treeCreate') continue;
    const current = records.get(op.nodeId);
    if (current !== undefined && compare(current.create, op) > 0) continue;
    records.set(op.nodeId, {
      id: op.nodeId,
      parent: op.parent,
      after: op.after,
      value: cloneJson(op.value),
      create: op,
      move: op,
      valueOp: op
    });
  }

  for (let i = 0, length = treeOps.length; i < length; i++) {
    const op = treeOps[i];
    if (op.type === 'treeCreate') continue;
    const record = records.get(op.nodeId);
    if (record === undefined) continue;
    if (op.type === 'treeMove') {
      continue;
    } else if (op.type === 'treeSet') {
      if (compare(op, record.valueOp) > 0) {
        record.value = cloneJson(op.value);
        record.valueOp = op;
      }
    } else if (record.deleteOp === undefined || compare(op, record.deleteOp) > 0) {
      record.deleteOp = op;
    }
  }

  applyValidTreeLocations(records, treeOps, compare);
  return buildMaterializedTree(records, compare);
}

function applyValidTreeLocations(
  records: Map<string, TreeRecord>,
  treeOps: Array<Extract<CrdtOperation, { type: 'treeCreate' | 'treeMove' | 'treeSet' | 'treeDel' }>>,
  compare: (left: CrdtOperation, right: CrdtOperation) => number
): void {
  if (records.size === 0) return;
  const parentById = new Map<string, string | null>();
  const ordered = treeOps.slice();
  if (ordered.length > 1) ordered.sort(compare);

  for (let i = 0, length = ordered.length; i < length; i++) {
    const op = ordered[i];
    if (op.type === 'treeCreate') {
      const record = records.get(op.nodeId);
      if (record === undefined || record.create !== op) continue;
      const parent = op.parent !== null && parentById.has(op.parent) ? op.parent : null;
      record.parent = parent;
      parentById.set(record.id, parent);
    } else if (op.type === 'treeMove') {
      const record = records.get(op.nodeId);
      if (record === undefined || compare(op, record.move) <= 0) continue;
      if (op.parent !== null && !parentById.has(op.parent)) continue;
      if (treeParentMapHasAncestor(parentById, op.parent, op.nodeId)) continue;
      record.parent = op.parent;
      record.after = op.after;
      record.move = op;
      parentById.set(record.id, op.parent);
    } else if (op.type === 'treeDel') {
      const record = records.get(op.nodeId);
      if (record !== undefined && record.deleteOp === op) parentById.set(record.id, null);
    }
  }
}

function buildMaterializedTree(records: Map<string, TreeRecord>, compare: (left: CrdtOperation, right: CrdtOperation) => number): CrdtTreeNode[] {
  const visible = new Map<string, TreeRecord>();
  records.forEach((record) => {
    if (record.deleteOp === undefined || compare(record.deleteOp, record.create) < 0) visible.set(record.id, record);
  });

  const childrenByParent = new Map<string, TreeRecord[]>();
  visible.forEach((record) => {
    if (record.parent !== null && (!visible.has(record.parent) || treeRecordHasAncestor(visible, record.parent, record.id))) return;
    const key = record.parent === null ? '' : record.parent;
    let children = childrenByParent.get(key);
    if (children === undefined) {
      children = [];
      childrenByParent.set(key, children);
    }
    children[children.length] = record;
  });

  const buildChildren = (parentId: string | null): CrdtTreeNode[] => {
    const siblings = childrenByParent.get(parentId === null ? '' : parentId);
    if (siblings === undefined || siblings.length === 0) return [];
    const ordered = orderTreeSiblings(siblings, compare);
    const children = new Array<CrdtTreeNode>(ordered.length);
    for (let i = 0, length = ordered.length; i < length; i++) {
      const record = ordered[i];
      children[i] = {
        id: record.id,
        parent: parentId,
        index: i,
        value: cloneJson(record.value),
        children: buildChildren(record.id)
      };
    }
    return children;
  };

  return buildChildren(null);
}

function treeParentMapHasAncestor(parentById: Map<string, string | null>, startId: string | null, ancestorId: string): boolean {
  let id = startId;
  const seen = new Set<string>();
  while (id !== null) {
    if (id === ancestorId) return true;
    if (seen.has(id)) return true;
    seen.add(id);
    id = parentById.get(id) || null;
  }
  return false;
}

function treeRecordHasAncestor(records: Map<string, TreeRecord>, startId: string, ancestorId: string): boolean {
  let id: string | null = startId;
  const seen = new Set<string>();
  while (id !== null) {
    if (id === ancestorId) return true;
    if (seen.has(id)) return true;
    seen.add(id);
    const record = records.get(id);
    if (record === undefined) return false;
    id = record.parent;
  }
  return false;
}

function orderTreeSiblings(siblings: TreeRecord[], compare: (left: CrdtOperation, right: CrdtOperation) => number): TreeRecord[] {
  const byId = new Map<string, TreeRecord>();
  for (let i = 0, length = siblings.length; i < length; i++) byId.set(siblings[i].id, siblings[i]);
  const childrenByAfter = new Map<string, TreeRecord[]>();
  for (let i = 0, length = siblings.length; i < length; i++) {
    const record = siblings[i];
    const key = record.after !== null && record.after !== record.id && byId.has(record.after) ? record.after : '';
    let list = childrenByAfter.get(key);
    if (list === undefined) {
      list = [];
      childrenByAfter.set(key, list);
    }
    list[list.length] = record;
  }
  childrenByAfter.forEach((list) => {
    list.sort((left, right) => compare(right.move, left.move));
  });

  const out: TreeRecord[] = [];
  const seen = new Set<string>();
  const pushChain = (list: TreeRecord[] | undefined): void => {
    if (list === undefined) return;
    const stack: TreeRecord[] = [];
    for (let i = list.length - 1; i >= 0; i--) stack[stack.length] = list[i];
    while (stack.length !== 0) {
      const record = stack.pop() as TreeRecord;
      if (seen.has(record.id)) continue;
      seen.add(record.id);
      out[out.length] = record;
      const next = childrenByAfter.get(record.id);
      if (next !== undefined) {
        for (let i = next.length - 1; i >= 0; i--) stack[stack.length] = next[i];
      }
    }
  };
  pushChain(childrenByAfter.get(''));
  if (out.length !== siblings.length) {
    const remaining = siblings.filter((record) => !seen.has(record.id));
    remaining.sort((left, right) => compare(left.move, right.move));
    pushChain(remaining);
  }
  return out;
}

function isXmlElementValue(value: JsonValue): value is JsonObject & { type: 'element'; name: string; attributes?: JsonObject } {
  return value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as Record<string, JsonValue>).type === 'element' &&
    typeof (value as Record<string, JsonValue>).name === 'string';
}

function isXmlTextValue(value: JsonValue): value is JsonObject & { type: 'text'; text: string } {
  return value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as Record<string, JsonValue>).type === 'text' &&
    typeof (value as Record<string, JsonValue>).text === 'string';
}

function treeNodesToXml(nodes: CrdtTreeNode[]): CrdtXmlNode[] {
  const out: CrdtXmlNode[] = [];
  for (let i = 0, length = nodes.length; i < length; i++) {
    const node = nodes[i];
    if (isXmlElementValue(node.value)) {
      const attributes = node.value.attributes !== undefined && isJsonObject(node.value.attributes)
        ? cloneJson(node.value.attributes)
        : undefined;
      out[out.length] = {
        type: 'element',
        name: node.value.name,
        attributes,
        children: treeNodesToXml(node.children)
      };
    } else if (isXmlTextValue(node.value)) {
      out[out.length] = { type: 'text', text: node.value.text };
    }
  }
  return out;
}

function serializeXmlNodes(nodes: CrdtXmlNode[]): string {
  let out = '';
  for (let i = 0, length = nodes.length; i < length; i++) {
    const node = nodes[i];
    if (node.type === 'text') {
      out += escapeXmlText(node.text);
    } else {
      out += '<' + node.name;
      const attributes = node.attributes;
      if (attributes !== undefined) {
        const keys = Object.keys(attributes).sort();
        for (let j = 0, keyCount = keys.length; j < keyCount; j++) {
          const key = keys[j];
          out += ' ' + key + '="' + escapeXmlAttribute(xmlAttributeString(attributes[key])) + '"';
        }
      }
      const children = node.children || [];
      if (children.length === 0) {
        out += '/>';
      } else {
        out += '>' + serializeXmlNodes(children) + '</' + node.name + '>';
      }
    }
  }
  return out;
}

function validateXmlElementName(name: string): void {
  if (typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(name)) {
    throw new TypeError('invalid XML name');
  }
}

function xmlAttributeString(value: JsonValue): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function escapeXmlText(value: string): string {
  return value.replace(/[&<>]/g, (char) => char === '&' ? '&amp;' : char === '<' ? '&lt;' : '&gt;');
}

function escapeXmlAttribute(value: string): string {
  return value.replace(/[&<"]/g, (char) => char === '&' ? '&amp;' : char === '<' ? '&lt;' : '&quot;');
}

function createCounterPatch(root: JsonValue, path: JsonPath, delta: number): Patch {
  const current = valueAtPath(root, path);
  const base = typeof current === 'number' && Number.isFinite(current) ? current : 0;
  return createSetPatch(root, path, base + delta);
}

function createTextInsertOperation(
  owner: FrontierCrdtDocument | Transaction,
  path: JsonPath,
  index: number,
  text: string
): Extract<CrdtOperation, { type: 'textInsert' }> | null {
  if (!Number.isSafeInteger(index) || index < 0) throw new RangeError('text index must be a non-negative safe integer');
  if (text.length === 0) return null;
  const appendState = owner._sequenceAppendState(path, 'text');
  let after: string | null;
  if (appendState !== null && index >= appendState.length) {
    after = appendState.tail;
  } else {
    const length = owner._textSequenceLength(path);
    const boundedIndex = Math.min(index, length);
    after = boundedIndex === 0 ? null : owner._textElementAt(path, boundedIndex - 1);
  }
  return owner._createTextInsertOperation(path, after, text);
}

function createTextDeleteOperation(
  owner: FrontierCrdtDocument | Transaction,
  path: JsonPath,
  index: number,
  count: number
): CrdtTextDeleteOperation | null {
  if (!Number.isSafeInteger(index) || index < 0) throw new RangeError('text index must be a non-negative safe integer');
  if (!Number.isSafeInteger(count) || count < 0) throw new RangeError('text delete count must be a non-negative safe integer');
  if (count === 0) return null;
  const elems = owner._textElementsSlice(path, index, count);
  const payload = createTextDeleteOperationPayloadFromElements(elems);
  if (payload === null) return null;
  return payload.type === 'textDel'
    ? owner._createOperation('textDel', path, { elems: payload.elems }) as Extract<CrdtOperation, { type: 'textDel' }>
    : owner._createOperation('textDelRange', path, payload.range) as Extract<CrdtOperation, { type: 'textDelRange' }>;
}

function createDominatingPatch(
  root: JsonValue,
  op: CrdtOperation,
  visibleElementIds: (path: JsonPath, kind: 'list' | 'text') => string[],
  sequenceIndexAfter?: (path: JsonPath, kind: 'list' | 'text', after: string | null) => number
): Patch | null {
  if (op.type === 'set') {
    return createSetPatch(root, op.path, op.value);
  }
  if (op.type === 'del') {
    return createRemovePatch(root, op.path);
  }
  if (op.type === 'counter') {
    return createCounterPatch(root, op.path, op.delta);
  }
  if (op.type === 'binarySet') {
    return createSetPatch(root, op.path, binaryJsonValue(op.bytes));
  }
  if (isTreeOperation(op)) {
    return null;
  }
  if (op.type === 'mapSetRun') {
    return createMapSetRunPatch(root, op);
  }
  if (op.type === 'textInsert' || op.type === 'textRun') {
    const current = valueAtPath(root, op.path);
    if (typeof current !== 'string') {
      return createSetPatch(root, op.path, op.text);
    }
    const visible = visibleElementIds(op.path, 'text');
    const index = sequenceIndexAfter === undefined
      ? op.after === null ? 0 : indexAfterElement(visible, op.after)
      : sequenceIndexAfter(op.path, 'text', op.after);
    if (index === -1 || index !== visible.length) return null;
    return [[OP_STRING_SPLICE, op.path.slice(), codePointIndexToCodeUnitOffset(current, index), 0, op.text]];
  }
  if (isTextDeleteOperation(op)) {
    const current = valueAtPath(root, op.path);
    if (typeof current !== 'string') return [];
    const visible = visibleElementIds(op.path, 'text');
    const range = textDeleteIndexRange(visible, op);
    if (range === null) return [];
    const start = range.index;
    const end = start + range.count;
    return [[
      OP_STRING_SPLICE,
      op.path.slice(),
      codePointIndexToCodeUnitOffset(current, start),
      codePointIndexToCodeUnitOffset(current, end) - codePointIndexToCodeUnitOffset(current, start),
      ''
    ]];
  }
  if (op.type === 'listInsert' || op.type === 'listRun') {
    const current = valueAtPath(root, op.path);
    const values = op.values.map((value) => cloneJson(value));
    if (!Array.isArray(current)) {
      return canApplyDirectSetPatch(root, op.path)
        ? [[OP_SET, op.path.slice(), values]]
        : createSetPatch(root, op.path, values);
    }
    const visible = visibleElementIds(op.path, 'list');
    const index = sequenceIndexAfter === undefined
      ? op.after === null ? 0 : indexAfterElement(visible, op.after)
      : sequenceIndexAfter(op.path, 'list', op.after);
    if (index === -1 || index !== visible.length) return null;
    return [[OP_ARRAY_SPLICE, op.path.slice(), index, 0, values]];
  }
  if (op.type === 'listDel') {
    const current = valueAtPath(root, op.path);
    if (!Array.isArray(current)) return [];
    const visible = visibleElementIds(op.path, 'list');
    const indexes = elementIndexes(visible, op.elems);
    if (indexes === null || indexes.length === 0) return [];
    return [[OP_ARRAY_SPLICE, op.path.slice(), indexes[0], indexes.length, []]];
  }
  return null;
}

function createDominatingBatchPatch(
  root: JsonValue,
  ops: CrdtOperation[],
  visibleElementIds: (path: JsonPath, kind: 'list' | 'text') => string[],
  sequenceIndexAfter?: (path: JsonPath, kind: 'list' | 'text', after: string | null) => number
): Patch | null {
  if (ops.length === 0) return null;
  if (ops.length === 1 && ops[0].type === 'textRun') {
    return createDominatingPatch(root, ops[0], visibleElementIds, sequenceIndexAfter);
  }
  if (ops.length === 1 && ops[0].type === 'listRun') {
    return createDominatingPatch(root, ops[0], visibleElementIds, sequenceIndexAfter);
  }
  if (textInsertRunEnd(ops, 0) !== ops.length) {
    const listPatch = createDominatingListBatchPatch(root, ops, visibleElementIds, sequenceIndexAfter);
    if (listPatch !== null) return listPatch;
    const counterPatch = createDominatingCounterBatchPatch(root, ops);
    if (counterPatch !== null) return counterPatch;
    const mapPatch = createDominatingMapSetBatchPatch(root, ops);
    if (mapPatch !== null) return mapPatch;
    return createDominatingPathShapeSetBatchPatch(root, ops);
  }
  const first = ops[0] as Extract<CrdtOperation, { type: 'textInsert' }>;
  const current = valueAtPath(root, first.path);
  let inserted = '';
  for (let i = 0, length = ops.length; i < length; i++) {
    inserted += (ops[i] as Extract<CrdtOperation, { type: 'textInsert' }>).text;
  }
  if (typeof current !== 'string') {
    return createSetPatch(root, first.path, inserted);
  }
  const visible = visibleElementIds(first.path, 'text');
  const index = sequenceIndexAfter === undefined
    ? first.after === null ? 0 : indexAfterElement(visible, first.after)
    : sequenceIndexAfter(first.path, 'text', first.after);
  if (index === -1 || index !== visible.length) return null;
  return [[OP_STRING_SPLICE, first.path.slice(), codePointIndexToCodeUnitOffset(current, index), 0, inserted]];
}

function createDominatingListBatchPatch(
  root: JsonValue,
  ops: CrdtOperation[],
  visibleElementIds: (path: JsonPath, kind: 'list' | 'text') => string[],
  sequenceIndexAfter?: (path: JsonPath, kind: 'list' | 'text', after: string | null) => number
): Patch | null {
  if (listInsertRunEnd(ops, 0) !== ops.length) return null;
  const first = ops[0] as Extract<CrdtOperation, { type: 'listInsert' }>;
  const current = valueAtPath(root, first.path);
  const values: JsonValue[] = [];
  for (let i = 0, length = ops.length; i < length; i++) {
    const opValues = (ops[i] as Extract<CrdtOperation, { type: 'listInsert' }>).values;
    for (let j = 0, valueCount = opValues.length; j < valueCount; j++) values[values.length] = cloneJson(opValues[j]);
  }
  if (!Array.isArray(current)) {
    return canApplyDirectSetPatch(root, first.path)
      ? [[OP_SET, first.path.slice(), values]]
      : createSetPatch(root, first.path, values);
  }
  const visible = visibleElementIds(first.path, 'list');
  const index = sequenceIndexAfter === undefined
    ? first.after === null ? 0 : indexAfterElement(visible, first.after)
    : sequenceIndexAfter(first.path, 'list', first.after);
  if (index === -1 || index !== visible.length) return null;
  return [[OP_ARRAY_SPLICE, first.path.slice(), index, 0, values]];
}

function createDominatingCounterBatchPatch(root: JsonValue, ops: CrdtOperation[]): Patch | null {
  const first = ops[0];
  if (first.type !== 'counter') return null;
  let sum = first.delta;
  for (let i = 1, length = ops.length; i < length; i++) {
    const op = ops[i];
    if (op.type !== 'counter' || !samePath(op.path, first.path)) return null;
    sum += op.delta;
  }
  return createCounterPatch(root, first.path, sum);
}

function createDominatingMapSetBatchPatch(root: JsonValue, ops: CrdtOperation[]): Patch | null {
  const first = ops[0];
  if (first.type !== 'set' || first.path.length === 0) return null;
  const parentPath = first.path.slice(0, -1);
  const assigned: Record<string, JsonValue> = {};
  for (let i = 0, length = ops.length; i < length; i++) {
    const op = ops[i];
    if (
      op.type !== 'set' ||
      op.path.length === 0 ||
      !sameParentPath(op.path, parentPath)
    ) {
      return null;
    }
    const key = op.path[op.path.length - 1];
    if (typeof key !== 'string') return null;
    assigned[key] = cloneJson(op.value);
  }

  const current = valueAtPath(root, parentPath);
  if (current !== null && typeof current === 'object' && !Array.isArray(current)) {
    return [[OP_ASSIGN, parentPath, assigned]];
  }
  return createSetPatch(root, parentPath, assigned);
}

function createDominatingPathShapeSetBatchPatch(root: JsonValue, ops: CrdtOperation[]): Patch | null {
  const arrayAssign = createDominatingArrayAssignBatchPatch(root, ops);
  if (arrayAssign !== null) return arrayAssign;
  return createDominatingArrayTupleAssignBatchPatch(root, ops);
}

function createDominatingArrayAssignBatchPatch(root: JsonValue, ops: CrdtOperation[]): Patch | null {
  const first = ops[0];
  if (first.type !== 'set' || first.path.length === 0) return null;
  const parentPath = first.path.slice(0, -1);
  const indexes = new Array<number>(ops.length);
  const values = new Array<JsonValue>(ops.length);
  for (let i = 0, length = ops.length; i < length; i++) {
    const op = ops[i];
    if (
      op.type !== 'set' ||
      op.path.length === 0 ||
      !sameParentPath(op.path, parentPath)
    ) {
      return null;
    }
    const index = op.path[op.path.length - 1];
    if (!isArrayPatchIndex(index)) return null;
    indexes[i] = index;
    values[i] = cloneJson(op.value);
  }
  if (!Array.isArray(valueAtPath(root, parentPath))) return null;
  return [[OP_ARRAY_ASSIGN, parentPath, indexes, values]];
}

function createDominatingArrayTupleAssignBatchPatch(root: JsonValue, ops: CrdtOperation[]): Patch | null {
  const first = ops[0];
  if (first.type !== 'set' || first.path.length < 2) return null;
  const basePath = first.path.slice(0, -2);
  const rows = new Array<number>(ops.length);
  const fields = new Array<number>(ops.length);
  const values = new Array<JsonValue>(ops.length);
  const base = valueAtPath(root, basePath);
  if (!Array.isArray(base)) return null;
  for (let i = 0, length = ops.length; i < length; i++) {
    const op = ops[i];
    if (
      op.type !== 'set' ||
      op.path.length !== basePath.length + 2 ||
      !samePathPrefix(op.path, basePath, basePath.length)
    ) {
      return null;
    }
    const rowIndex = op.path[op.path.length - 2];
    const fieldIndex = op.path[op.path.length - 1];
    if (!isArrayPatchIndex(rowIndex) || !isArrayPatchIndex(fieldIndex)) return null;
    if (!Array.isArray(base[rowIndex])) return null;
    rows[i] = rowIndex;
    fields[i] = fieldIndex;
    values[i] = cloneJson(op.value);
  }
  return [[OP_ARRAY_TUPLE_ASSIGN, basePath, rows, fields, values]];
}

function isArrayPatchIndex(value: string | number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function appendTextDirtySpan(
  out: TextDirtySpan[],
  path: JsonPath,
  index: number,
  deleteCount: number,
  insert: string,
  copyPath = true
): void {
  const last = out[out.length - 1];
  if (last !== undefined && (last.path === path || samePath(last.path, path))) {
    if (
      last.deleteCount === 0 &&
      deleteCount === 0 &&
      last.insert.length !== 0 &&
      insert.length !== 0 &&
      index === last.index + codePointLength(last.insert)
    ) {
      last.insert += insert;
      return;
    }
    if (
      last.deleteCount > 0 &&
      deleteCount === 0 &&
      last.insert.length === 0 &&
      insert.length !== 0 &&
      index === last.index
    ) {
      last.insert = insert;
      return;
    }
    if (
      last.deleteCount > 0 &&
      deleteCount > 0 &&
      last.insert.length === 0 &&
      insert.length === 0 &&
      index === last.index
    ) {
      last.deleteCount += deleteCount;
      return;
    }
  }
  out[out.length] = { path: copyPath ? path.slice() : path, index, deleteCount, insert };
}

function applyTextOperationsToSequence(sequence: TextSequence, path: JsonPath, ops: CrdtOperation[]): boolean {
  for (let i = 0, length = ops.length; i < length; i++) {
    const op = ops[i];
    if (!samePath(op.path, path)) continue;
    if (op.type === 'textInsert' || op.type === 'textRun') {
      const index = op.after === null ? 0 : sequence.indexOf(op.after) + 1;
      if (index <= 0 && op.after !== null) return false;
      sequence.insertCreated(index, op, op.type === 'textRun' ? op.count : codePointLength(op.text));
    } else if (isTextDeleteOperation(op)) {
      if (textDeleteCount(op) === 0) continue;
      const range = sequenceTextDeleteRange(sequence, op);
      if (range === null) return false;
      sequence.delete(range.index, range.count);
    }
  }
  return true;
}

function sequenceSliceEquals(sequence: TextSequence, index: number, values: string[]): boolean {
  const slice = sequence.slice(index, values.length);
  if (slice.length !== values.length) return false;
  for (let i = 0, length = values.length; i < length; i++) {
    if (slice[i] !== values[i]) return false;
  }
  return true;
}

function createTextDirtyPatch(ops: TextDirtyPatchOperation[]): Patch {
  const patch = new Array(ops.length) as Patch;
  for (let i = 0, length = ops.length; i < length; i++) {
    const op = ops[i];
    patch[i] = [OP_STRING_SPLICE, op.path, op.offset, op.deleteCodeUnits, op.insert];
  }
  return patch;
}

function createTextDirtyPatchFromSpans(
  path: JsonPath,
  before: string,
  spans: TextDirtySpan[],
  start = 0,
  end = spans.length
): Patch {
  const textValue = ChunkedTextValue.fromString(before);
  const patchOps = new Array<TextDirtyPatchOperation>(end - start);
  const patchPath = path.slice();
  let out = 0;
  for (let i = start; i < end; i++) {
    const span = spans[i];
    const [offset, deleteCodeUnits] = textValue.codeUnitRange(span.index, span.deleteCount);
    patchOps[out++] = {
      path: patchPath,
      offset,
      deleteCodeUnits,
      insert: span.insert
    };
    if (span.deleteCount !== 0) textValue.delete(span.index, span.deleteCount);
    if (span.insert.length !== 0) textValue.insert(span.index, span.insert);
  }
  return createTextDirtyPatch(patchOps);
}

function createCodeUnitAlignedTextDirtyPatch(
  path: JsonPath,
  spans: TextDirtySpan[],
  start = 0,
  end = spans.length
): Patch {
  const patch = new Array(end - start) as Patch;
  const patchPath = path.slice();
  let out = 0;
  for (let i = start; i < end; i++) {
    const span = spans[i];
    patch[out++] = [OP_STRING_SPLICE, patchPath, span.index, span.deleteCount, span.insert];
  }
  return patch;
}

function textDirtySpansInsertAreCodeUnitAligned(spans: TextDirtySpan[], start = 0, end = spans.length): boolean {
  for (let i = start; i < end; i++) {
    if (!textDirtySpanInsertIsCodeUnitAligned(spans[i])) return false;
  }
  return true;
}

function textDirtySpanInsertIsCodeUnitAligned(span: TextDirtySpan): boolean {
  return span.insert.length === codePointLength(span.insert);
}

function createTextDirtyPatchFromMixedSpans(
  spans: TextDirtySpan[],
  beforeByKey: Map<string, { path: JsonPath; value: string }>
): Patch {
  const textValues = new Map<string, { path: JsonPath; value: ChunkedTextValue }>();
  const patchOps = new Array<TextDirtyPatchOperation>(spans.length);
  for (let i = 0, length = spans.length; i < length; i++) {
    const span = spans[i];
    const key = sequenceCacheKey(span.path, 'text');
    let entry = textValues.get(key);
    if (entry === undefined) {
      const before = beforeByKey.get(key);
      if (before === undefined) throw new TypeError('missing CRDT dirty text source');
      entry = { path: before.path, value: ChunkedTextValue.fromString(before.value) };
      textValues.set(key, entry);
    }
    const [offset, deleteCodeUnits] = entry.value.codeUnitRange(span.index, span.deleteCount);
    patchOps[i] = {
      path: entry.path,
      offset,
      deleteCodeUnits,
      insert: span.insert
    };
    if (span.deleteCount !== 0) entry.value.delete(span.index, span.deleteCount);
    if (span.insert.length !== 0) entry.value.insert(span.index, span.insert);
  }
  return createTextDirtyPatch(patchOps);
}

function createMapSetRunPatch(root: JsonValue, op: Extract<CrdtOperation, { type: 'mapSetRun' }>): Patch {
  const assigned: Record<string, JsonValue> = {};
  for (let i = 0, length = op.keys.length; i < length; i++) assigned[op.keys[i]] = cloneJson(op.values[i]);
  const current = valueAtPath(root, op.path);
  if (current !== null && typeof current === 'object' && !Array.isArray(current)) {
    return [[OP_ASSIGN, op.path, assigned]];
  }
  return canApplyDirectSetPatch(root, op.path)
    ? [[OP_SET, op.path.slice(), assigned]]
    : createSetPatch(root, op.path, assigned);
}

function createDirectMapSetPatch(root: JsonValue, path: JsonPath, opPath: JsonPath, value: JsonValue): Patch {
  const current = valueAtPath(root, path);
  if (current !== null && typeof current === 'object' && !Array.isArray(current)) {
    return [[OP_SET, opPath, cloneJson(value)]];
  }
  return createSetPatch(root, opPath, value);
}

function samePath(left: JsonPath, right: JsonPath): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0, length = left.length; i < length; i++) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

function samePathPrefix(path: JsonPath, prefix: JsonPath, length: number): boolean {
  if (path.length < length || prefix.length < length) return false;
  for (let i = 0; i < length; i++) {
    if (path[i] !== prefix[i]) return false;
  }
  return true;
}

function sameParentPath(path: JsonPath, parentPath: JsonPath): boolean {
  if (path.length !== parentPath.length + 1) return false;
  for (let i = 0, length = parentPath.length; i < length; i++) {
    if (path[i] !== parentPath[i]) return false;
  }
  return true;
}

function createSetPatch(root: JsonValue, path: JsonPath, value: JsonValue): Patch {
  const cloned = cloneJson(value);
  if (path.length === 0) return [[OP_SET, [], cloned]];
  if (root === null || typeof root !== 'object') {
    return [[OP_SET, [], buildNestedValue(path, cloned)]];
  }

  let cursor: any = root;
  for (let i = 0, last = path.length - 1; i < last; i++) {
    const next = cursor[path[i]];
    if (next === null || typeof next !== 'object') {
      return [[OP_SET, path.slice(0, i + 1), buildNestedValue(path.slice(i + 1), cloned)]];
    }
    cursor = next;
  }
  return [[OP_SET, path.slice(), cloned]];
}

function canApplyDirectSetPatch(root: JsonValue, path: JsonPath): boolean {
  if (path.length === 0) return true;
  if (root === null || typeof root !== 'object') return false;
  let cursor: any = root;
  for (let i = 0, last = path.length - 1; i < last; i++) {
    cursor = cursor[path[i]];
    if (cursor === null || typeof cursor !== 'object') return false;
  }
  return true;
}

function createRemovePatch(root: JsonValue, path: JsonPath): Patch {
  if (path.length === 0) return [[OP_SET, [], {}]];
  if (root === null || typeof root !== 'object') return [];
  let cursor: any = root;
  for (let i = 0, last = path.length - 1; i < last; i++) {
    cursor = cursor[path[i]];
    if (cursor === null || typeof cursor !== 'object') return [];
  }
  const key = path[path.length - 1];
  if (Array.isArray(cursor) && typeof key === 'number') {
    return key >= 0 && key < cursor.length ? [[OP_ARRAY_SPLICE, path.slice(0, -1), key, 1, []]] : [];
  }
  return Object.prototype.hasOwnProperty.call(cursor, key) ? [[OP_REMOVE, path.slice()]] : [];
}

function applyDirectPatchToView(root: JsonValue, patch: Patch): JsonValue {
  for (let i = 0, length = patch.length; i < length; i++) {
    const op = patch[i];
    const path = op[1];
    if (op[0] === OP_SET) {
      const value = isMutableJsonValue(op[2]) ? cloneJson(op[2]) : op[2];
      if (path.length === 0) {
        root = value;
      } else {
        const parent = directParentAt(root, path);
        setOwnValue(parent, path[path.length - 1], value);
      }
    } else if (op[0] === OP_REMOVE) {
      const parent = directParentAt(root, path);
      delete parent[path[path.length - 1]];
    } else if (op[0] === OP_STRING_SPLICE) {
      if (path.length === 0) {
        root = spliceDirectString(root as string, op[2], op[3], op[4]);
      } else {
        const parent = directParentAt(root, path);
        const key = path[path.length - 1];
        parent[key] = spliceDirectString(parent[key], op[2], op[3], op[4]);
      }
    } else if (op[0] === OP_ARRAY_SPLICE) {
      const array = (path.length === 0 ? root : directValueAt(root, path)) as JsonValue[];
      applyDirectArraySplice(array, op[2], op[3], op[4]);
    } else if (op[0] === OP_ARRAY_ASSIGN) {
      const array = (path.length === 0 ? root : directValueAt(root, path)) as JsonValue[];
      applyDirectArrayAssign(array, op[2], op[3]);
    } else if (op[0] === OP_ARRAY_TUPLE_ASSIGN) {
      const array = (path.length === 0 ? root : directValueAt(root, path)) as JsonValue[];
      applyDirectArrayTupleAssign(array, op[2], op[3], op[4]);
    } else if (op[0] === OP_ASSIGN) {
      const target = directValueAt(root, path) as Record<string, JsonValue>;
      const values = op[2];
      for (const key in values) {
        const value = values[key];
        setOwnValue(target, key, isMutableJsonValue(value) ? cloneJson(value) : value);
      }
    } else {
      const remaining = patch.slice(i) as Patch;
      return applyPatch(root, remaining, { cloneValues: patchCarriesMutableValues(remaining) });
    }
  }
  return root;
}

function directParentAt(root: JsonValue, path: JsonPath): any {
  let cursor: any = root;
  for (let i = 0, last = path.length - 1; i < last; i++) cursor = cursor[path[i]];
  return cursor;
}

function directValueAt(root: JsonValue, path: JsonPath): JsonValue {
  let cursor: any = root;
  for (let i = 0, length = path.length; i < length; i++) cursor = cursor[path[i]];
  return cursor as JsonValue;
}

function spliceDirectString(value: string, start: number, deleteCount: number, insert: string): string {
  if (deleteCount === 0) {
    if (start === value.length) return value + insert;
    if (start === 0) return insert + value;
  } else if (insert.length === 0) {
    if (start === 0) return value.slice(deleteCount);
    if (start + deleteCount === value.length) return value.slice(0, start);
  }
  return value.slice(0, start) + insert + value.slice(start + deleteCount);
}

function applyDirectArraySplice(array: JsonValue[], start: number, deleteCount: number, values: JsonValue[]): void {
  const valueCount = values.length;
  if (valueCount === 0) {
    array.splice(start, deleteCount);
    return;
  }

  if (deleteCount === 0 && start === array.length) {
    for (let i = 0; i < valueCount; i++) {
      const value = values[i];
      array[start + i] = isMutableJsonValue(value) ? cloneJson(value) : value;
    }
    return;
  }

  if (valueCount === 1) {
    const value = values[0];
    array.splice(start, deleteCount, isMutableJsonValue(value) ? cloneJson(value) : value);
    return;
  }

  const cloned = new Array(valueCount);
  for (let i = 0; i < valueCount; i++) {
    const value = values[i];
    cloned[i] = isMutableJsonValue(value) ? cloneJson(value) : value;
  }
  if (valueCount < 32768) {
    array.splice(start, deleteCount, ...cloned);
    return;
  }
  array.splice(start, deleteCount);
  insertJsonValues(array, start, cloned);
}

function applyDirectArrayAssign(array: JsonValue[], indexes: number[], values: JsonValue[]): void {
  for (let i = 0, length = indexes.length; i < length; i++) {
    const value = values[i];
    array[indexes[i]] = isMutableJsonValue(value) ? cloneJson(value) : value;
  }
}

function applyDirectArrayTupleAssign(array: JsonValue[], rowIndexes: number[], fieldIndexes: number[], values: JsonValue[]): void {
  for (let i = 0, length = rowIndexes.length; i < length; i++) {
    const row = array[rowIndexes[i]] as JsonValue[];
    const value = values[i];
    row[fieldIndexes[i]] = isMutableJsonValue(value) ? cloneJson(value) : value;
  }
}

function patchCarriesMutableValues(patch: Patch): boolean {
  for (let i = 0, length = patch.length; i < length; i++) {
    const op = patch[i];
    if (op[0] === OP_SET) {
      if (isMutableJsonValue(op[2])) return true;
    } else if (op[0] === OP_ASSIGN) {
      const values = op[2];
      for (const key in values) {
        if (isMutableJsonValue(values[key])) return true;
      }
    } else if (op[0] === OP_ARRAY_SPLICE) {
      const values = op[4];
      for (let j = 0, valueCount = values.length; j < valueCount; j++) {
        if (isMutableJsonValue(values[j])) return true;
      }
    } else if (op[0] === OP_ARRAY_ASSIGN) {
      const values = op[3];
      for (let j = 0, valueCount = values.length; j < valueCount; j++) {
        if (isMutableJsonValue(values[j])) return true;
      }
    } else if (op[0] === OP_ARRAY_TUPLE_ASSIGN) {
      const values = op[4];
      for (let j = 0, valueCount = values.length; j < valueCount; j++) {
        if (isMutableJsonValue(values[j])) return true;
      }
    }
  }
  return false;
}

function isMutableJsonValue(value: JsonValue): boolean {
  return value !== null && typeof value === 'object';
}

function buildNestedValue(path: JsonPath, value: JsonValue): JsonValue {
  let cursor = value;
  for (let i = path.length - 1; i >= 0; i--) {
    const container: any = typeof path[i] === 'number' ? [] : {};
    setOwnValue(container, path[i], cursor);
    cursor = container;
  }
  return cursor;
}

function appendPathSegment(path: JsonPath, segment: string | number): JsonPath {
  if (path.length === 0) return [segment];
  if (path.length === 1) return [path[0], segment];
  const next = new Array(path.length + 1);
  for (let i = 0, length = path.length; i < length; i++) next[i] = path[i];
  next[path.length] = segment;
  return next;
}

function valueAtPath(root: JsonValue, path: JsonPath): JsonValue | undefined {
  let cursor: any = root;
  for (let i = 0, length = path.length; i < length; i++) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = cursor[path[i]];
  }
  return cursor as JsonValue | undefined;
}

function elementIndexes(visible: string[], elems: string[]): number[] | null {
  const indexes = new Array(elems.length);
  for (let i = 0, length = elems.length; i < length; i++) {
    const index = visible.indexOf(elems[i]);
    if (index === -1) return null;
    if (i !== 0 && index !== indexes[i - 1] + 1) return null;
    indexes[i] = index;
  }
  return indexes;
}

function insertCreatedElementIds(target: string[], index: number, op: CrdtOperation, count: number): void {
  if (count === 0) return;
  if (count === 1) {
    const id = createdElementId(op, 0);
    if (index === target.length) {
      target[target.length] = id;
    } else {
      target.splice(index, 0, id);
    }
    return;
  }
  const ids = new Array<string>(count);
  for (let i = 0; i < count; i++) ids[i] = createdElementId(op, i);
  insertStrings(target, index, ids);
}

function indexAfterElement(visible: string[], after: string | null): number {
  if (after === null) return 0;
  const last = visible.length - 1;
  if (last >= 0 && visible[last] === after) return visible.length;
  const index = visible.indexOf(after);
  return index === -1 ? -1 : index + 1;
}

function codePointIndexToCodeUnitOffset(value: string, index: number): number {
  if (index <= 0) return 0;
  if (index >= value.length) return value.length;
  let codePoints = 0;
  for (let offset = 0, length = value.length; offset < length; offset++) {
    if (codePoints === index) return offset;
    const code = value.charCodeAt(offset);
    if (isHighSurrogate(code) && offset + 1 < length && isLowSurrogate(value.charCodeAt(offset + 1))) offset++;
    codePoints++;
  }
  return value.length;
}

function codePointIndexToCodeUnitOffsetKnownLength(value: string, index: number, codePointLengthHint?: number): number {
  if (index <= 0) return 0;
  if (codePointLengthHint !== undefined && value.length === codePointLengthHint) return index >= value.length ? value.length : index;
  return codePointIndexToCodeUnitOffset(value, index);
}

function codePointRangeToCodeUnitRange(value: string, index: number, count: number, codePointLengthHint?: number): [number, number] {
  if (count <= 0) return [codePointIndexToCodeUnitOffsetKnownLength(value, index, codePointLengthHint), 0];
  if (codePointLengthHint !== undefined && value.length === codePointLengthHint) {
    const start = index <= 0 ? 0 : index >= value.length ? value.length : index;
    const end = index + count >= value.length ? value.length : index + count;
    return [start, end - start];
  }
  const start = codePointIndexToCodeUnitOffset(value, index);
  const end = codePointIndexToCodeUnitOffset(value, index + count);
  return [start, end - start];
}

function isSingleCodePointString(value: string): boolean {
  if (value.length === 1) return true;
  return value.length === 2 &&
    isHighSurrogate(value.charCodeAt(0)) &&
    isLowSurrogate(value.charCodeAt(1));
}

const surrogatePattern = /[\uD800-\uDBFF]/;

function codePointLength(value: string): number {
  if (!surrogatePattern.test(value)) return value.length;
  let count = 0;
  for (let offset = 0, length = value.length; offset < length; offset++) {
    const code = value.charCodeAt(offset);
    if (isHighSurrogate(code) && offset + 1 < length && isLowSurrogate(value.charCodeAt(offset + 1))) offset++;
    count++;
  }
  return count;
}

function spliceInsertCodePointLength(splice: CrdtTextSplice): number {
  const insert = splice.insert;
  if (insert.length <= 1) return insert.length;
  const hinted = splice.insertLength;
  if (Number.isSafeInteger(hinted) && hinted >= 0) return hinted;
  return codePointLength(insert);
}

function tupleSpliceInsertCodePointLength(splice: CrdtTextSpliceTuple, insert: string): number {
  if (insert.length <= 1) return insert.length;
  const hinted = splice[3];
  if (hinted !== undefined && Number.isSafeInteger(hinted) && hinted >= 0) return hinted;
  const externalHint = (splice as { insertLength?: number }).insertLength;
  if (externalHint !== undefined && Number.isSafeInteger(externalHint) && externalHint >= 0) return externalHint;
  return codePointLength(insert);
}

function columnSpliceInsertCodePointLength(insert: string, hinted: number | undefined): number {
  if (insert.length <= 1) return insert.length;
  if (hinted !== undefined && Number.isSafeInteger(hinted) && hinted >= 0) return hinted;
  return codePointLength(insert);
}

function readCrdtTextSpliceColumnLength(
  indexes: ArrayLike<number>,
  deleteCounts: ArrayLike<number>,
  inserts: ArrayLike<string>,
  insertLengths?: ArrayLike<number>
): number {
  const length = readArrayLikeColumnLength(indexes, 'text splice index column');
  if (readArrayLikeColumnLength(deleteCounts, 'text splice delete count column') !== length) {
    throw new RangeError('text splice column lengths must match');
  }
  if (readArrayLikeColumnLength(inserts, 'text splice insert column') !== length) {
    throw new RangeError('text splice column lengths must match');
  }
  if (insertLengths !== undefined && readArrayLikeColumnLength(insertLengths, 'text splice insert length column') !== length) {
    throw new RangeError('text splice column lengths must match');
  }
  return length;
}

function readArrayLikeColumnLength(value: { length: number } | null | undefined, name: string): number {
  if (value === null || value === undefined || typeof value !== 'object') {
    throw new TypeError(name + ' must be an array-like object');
  }
  const length = value.length;
  if (!Number.isSafeInteger(length) || length < 0) throw new RangeError(name + ' length must be a non-negative safe integer');
  return length;
}

function normalizeCrdtTextSpliceBatch(splices: readonly CrdtTextSpliceInput[]): CrdtTextSplice[] {
  const normalized = new Array<CrdtTextSplice>(splices.length);
  for (let i = 0, length = splices.length; i < length; i++) {
    const splice = splices[i];
    if (Array.isArray(splice)) {
      const insert = splice[2];
      normalized[i] = {
        index: splice[0],
        deleteCount: splice[1],
        insert,
        insertLength: splice[3] ?? (splice as { insertLength?: number }).insertLength
      };
    } else {
      normalized[i] = splice as CrdtTextSplice;
    }
  }
  return normalized;
}

function stringCodePoints(value: string): string[] {
  const chars: string[] = [];
  for (let offset = 0, length = value.length; offset < length; offset++) {
    const start = offset;
    const code = value.charCodeAt(offset);
    if (isHighSurrogate(code) && offset + 1 < length && isLowSurrogate(value.charCodeAt(offset + 1))) offset++;
    chars[chars.length] = offset === start ? value.charAt(start) : value.slice(start, offset + 1);
  }
  return chars;
}

function nextCodePointOffset(value: string, offset: number): number {
  if (offset >= value.length) return value.length;
  const code = value.charCodeAt(offset);
  if (isHighSurrogate(code) && offset + 1 < value.length && isLowSurrogate(value.charCodeAt(offset + 1))) {
    return offset + 2;
  }
  return offset + 1;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

function sameOperationIdSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0, length = left.length; i < length; i++) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

function operationsBecomeReady(ops: CrdtOperation[], readyHeads: string[]): boolean {
  if (ops.length === 0) return true;
  if (sameOperationIdSet(ops[0].deps, readyHeads) && isSingleCausalRun(ops)) return true;

  const ready = new Set<string>(readyHeads);
  for (let i = 0, length = ops.length; i < length; i++) {
    const op = ops[i];
    for (let j = 0, depCount = op.deps.length; j < depCount; j++) {
      if (!ready.has(op.deps[j])) return false;
    }
    markOperationReadyIds(ready, op);
  }
  return true;
}

function getHeadsAfterDirectOperations(previousHeads: string[], ops: CrdtOperation[]): string[] {
  if (ops.length !== 0 && sameOperationIdSet(ops[0].deps, previousHeads) && isSingleCausalRun(ops)) {
    return [operationHeadId(ops[ops.length - 1])];
  }

  const referenced = new Set<string>();
  for (let i = 0, length = ops.length; i < length; i++) {
    const deps = ops[i].deps;
    for (let j = 0, depCount = deps.length; j < depCount; j++) referenced.add(deps[j]);
  }

  const heads: string[] = [];
  for (let i = 0, length = previousHeads.length; i < length; i++) {
    if (!referenced.has(previousHeads[i])) heads[heads.length] = previousHeads[i];
  }
  for (let i = 0, length = ops.length; i < length; i++) {
    const head = operationHeadId(ops[i]);
    if (!referenced.has(head)) heads[heads.length] = head;
  }
  heads.sort(compareOperationIds);
  return heads;
}

function isSingleCausalRun(ops: CrdtOperation[]): boolean {
  for (let i = 1, length = ops.length; i < length; i++) {
    const deps = ops[i].deps;
    if (deps.length !== 1 || deps[0] !== operationHeadId(ops[i - 1])) return false;
  }
  return true;
}

function insertStrings(target: string[], index: number, values: string[]): void {
  if (values.length === 0) return;
  if (index === target.length) {
    for (let i = 0, length = values.length; i < length; i++) target[target.length] = values[i];
    return;
  }
  if (values.length < 32768) {
    target.splice(index, 0, ...values);
    return;
  }
  const originalLength = target.length;
  target.length = originalLength + values.length;
  for (let i = originalLength - 1; i >= index; i--) target[i + values.length] = target[i];
  for (let i = 0, length = values.length; i < length; i++) target[index + i] = values[i];
}

function insertJsonValues(target: JsonValue[], index: number, values: JsonValue[]): void {
  if (values.length === 0) return;
  if (index === target.length) {
    for (let i = 0, length = values.length; i < length; i++) target[target.length] = values[i];
    return;
  }
  const originalLength = target.length;
  target.length = originalLength + values.length;
  for (let i = originalLength - 1; i >= index; i--) target[i + values.length] = target[i];
  for (let i = 0, length = values.length; i < length; i++) target[index + i] = values[i];
}

function materializeReadyOperations(ops: Map<string, CrdtOperation>): JsonValue {
  return materialize(getReadyOperations(ops));
}

function getReadyHeads(ops: Map<string, CrdtOperation>): string[] {
  const ready = new Map<string, CrdtOperation>();
  const readyOps = getReadyOperations(ops);
  for (let i = 0, length = readyOps.length; i < length; i++) {
    ready.set(operationHeadId(readyOps[i]), readyOps[i]);
  }
  return getHeadsFromOperations(ready);
}

function getReadyOperations(ops: Map<string, CrdtOperation>): CrdtOperation[] {
  const ready = new Set<string>();
  const readyOps: CrdtOperation[] = [];
  let pending = false;
  ops.forEach((op) => {
    const head = operationHeadId(op);
    if (ready.has(head)) return;
    const deps = op.deps;
    for (let i = 0, length = deps.length; i < length; i++) {
      if (!ready.has(deps[i])) {
        pending = true;
        return;
      }
    }
    markOperationReadyIds(ready, op);
    readyOps[readyOps.length] = op;
  });
  if (!pending) {
    sortOperationsIfNeeded(readyOps);
    return readyOps;
  }

  let changed = true;
  while (changed) {
    changed = false;
    ops.forEach((op) => {
      if (ready.has(operationHeadId(op))) return;
      for (let i = 0, length = op.deps.length; i < length; i++) {
        if (!ready.has(op.deps[i])) return;
      }
      markOperationReadyIds(ready, op);
      changed = true;
    });
  }

  readyOps.length = 0;
  ops.forEach((op) => {
    if (ready.has(operationHeadId(op))) readyOps.push(op);
  });
  sortOperationsIfNeeded(readyOps);
  return readyOps;
}

function getReadyOperationsFromList(ops: readonly CrdtOperation[]): CrdtOperation[] {
  const ready = new Set<string>();
  const readyOps: CrdtOperation[] = [];
  let pending = false;
  for (let i = 0, length = ops.length; i < length; i++) {
    const op = ops[i];
    const head = operationHeadId(op);
    if (ready.has(head)) continue;
    const deps = op.deps;
    for (let j = 0, depCount = deps.length; j < depCount; j++) {
      if (!ready.has(deps[j])) {
        pending = true;
        continue;
      }
    }
    if (pending && !operationDepsReady(deps, ready)) continue;
    markOperationReadyIds(ready, op);
    readyOps[readyOps.length] = op;
  }
  if (!pending) {
    sortOperationsIfNeeded(readyOps);
    return readyOps;
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0, length = ops.length; i < length; i++) {
      const op = ops[i];
      if (ready.has(operationHeadId(op))) continue;
      if (!operationDepsReady(op.deps, ready)) continue;
      markOperationReadyIds(ready, op);
      changed = true;
    }
  }

  readyOps.length = 0;
  for (let i = 0, length = ops.length; i < length; i++) {
    const op = ops[i];
    if (ready.has(operationHeadId(op))) readyOps[readyOps.length] = op;
  }
  sortOperationsIfNeeded(readyOps);
  return readyOps;
}

function operationDepsReady(deps: readonly string[], ready: Set<string>): boolean {
  for (let i = 0, length = deps.length; i < length; i++) {
    if (!ready.has(deps[i])) return false;
  }
  return true;
}

function allOperationsReady(ops: Map<string, CrdtOperation>): boolean {
  if (ops.size === 0) return true;
  return getReadyOperations(ops).length === ops.size;
}

function allOperationsReadyFromList(ops: readonly CrdtOperation[]): boolean {
  return ops.length === 0 || getReadyOperationsFromList(ops).length === ops.length;
}

type CrdtRegisterOperation = Extract<CrdtOperation, { type: 'set' | 'del' | 'binarySet' }>;

type CrdtResolvedConflictAction =
  | { type: 'value'; value: JsonValue }
  | { type: 'delete' };

interface OperationReachabilityIndex {
  byId: Map<string, CrdtOperation>;
  cache: Map<string, Map<string, boolean>>;
}

interface ConflictVisibilityIndex {
  compare: (left: CrdtOperation, right: CrdtOperation) => number;
  mapWinners: Map<string, CrdtOperation>;
  counters: Map<string, { path: JsonPath; latest: CrdtOperation }>;
  islandLatest: Map<string, { type: 'list' | 'text' | 'tree'; op: CrdtOperation }>;
}

function getCrdtConflictAtPath(
  ops: CrdtOperation[],
  path: JsonPath,
  metadata?: Map<string, JsonObject>,
  metadataHeads?: Map<string, string>
): CrdtConflict | undefined {
  const sorted = expandMapSetRunsForMaterialize(ops);
  sortOperationsIfNeeded(sorted);
  const candidates: CrdtRegisterOperation[] = [];
  for (let i = 0, length = sorted.length; i < length; i++) {
    const op = sorted[i];
    if (isRegisterOperation(op) && samePath(op.path, path)) candidates[candidates.length] = op;
  }
  if (candidates.length <= 1) return undefined;
  const visibility = createConflictVisibilityIndex(sorted);
  return createCrdtConflictFromCandidates(path, candidates, sorted, visibility, metadata, metadataHeads);
}

function getCrdtConflicts(
  ops: CrdtOperation[],
  prefix?: JsonPath,
  directChildrenOnly = false,
  metadata?: Map<string, JsonObject>,
  metadataHeads?: Map<string, string>
): CrdtConflict[] {
  const sorted = expandMapSetRunsForMaterialize(ops);
  sortOperationsIfNeeded(sorted);
  const byPath = new Map<string, { path: JsonPath; ops: CrdtRegisterOperation[] }>();
  for (let i = 0, length = sorted.length; i < length; i++) {
    const op = sorted[i];
    if (!isRegisterOperation(op) || !pathMatchesConflictQuery(op.path, prefix, directChildrenOnly)) continue;
    const key = pathKey(op.path);
    let entry = byPath.get(key);
    if (entry === undefined) {
      entry = { path: op.path, ops: [] };
      byPath.set(key, entry);
    }
    entry.ops[entry.ops.length] = op;
  }
  if (byPath.size === 0) return [];
  const conflicts: CrdtConflict[] = [];
  const entries = Array.from(byPath.values()).sort((left, right) => comparePaths(left.path, right.path));
  let visibility: ConflictVisibilityIndex | null = null;
  for (let i = 0, length = entries.length; i < length; i++) {
    const entry = entries[i];
    if (entry.ops.length <= 1) continue;
    if (visibility === null) visibility = createConflictVisibilityIndex(sorted);
    const conflict = createCrdtConflictFromCandidates(entry.path, entry.ops, sorted, visibility, metadata, metadataHeads);
    if (conflict !== undefined) conflicts[conflicts.length] = conflict;
  }
  return conflicts;
}

function getCrdtConflictSummaryAtPath(
  ops: CrdtOperation[],
  path: JsonPath
): CrdtConflictSummary | undefined {
  const sorted = expandMapSetRunsForMaterialize(ops);
  sortOperationsIfNeeded(sorted);
  const candidates: CrdtRegisterOperation[] = [];
  for (let i = 0, length = sorted.length; i < length; i++) {
    const op = sorted[i];
    if (isRegisterOperation(op) && samePath(op.path, path)) candidates[candidates.length] = op;
  }
  if (candidates.length <= 1) return undefined;
  const visibility = createConflictVisibilityIndex(sorted);
  return createCrdtConflictSummaryFromCandidates(path, candidates, sorted, visibility);
}

function getCrdtConflictSummaries(
  ops: CrdtOperation[],
  prefix?: JsonPath,
  directChildrenOnly = false
): CrdtConflictSummary[] {
  const sorted = expandMapSetRunsForMaterialize(ops);
  sortOperationsIfNeeded(sorted);
  const byPath = new Map<string, { path: JsonPath; ops: CrdtRegisterOperation[] }>();
  for (let i = 0, length = sorted.length; i < length; i++) {
    const op = sorted[i];
    if (!isRegisterOperation(op) || !pathMatchesConflictQuery(op.path, prefix, directChildrenOnly)) continue;
    const key = pathKey(op.path);
    let entry = byPath.get(key);
    if (entry === undefined) {
      entry = { path: op.path, ops: [] };
      byPath.set(key, entry);
    }
    entry.ops[entry.ops.length] = op;
  }
  if (byPath.size === 0) return [];
  const summaries: CrdtConflictSummary[] = [];
  const entries = Array.from(byPath.values()).sort((left, right) => comparePaths(left.path, right.path));
  let visibility: ConflictVisibilityIndex | null = null;
  for (let i = 0, length = entries.length; i < length; i++) {
    const entry = entries[i];
    if (entry.ops.length <= 1) continue;
    if (visibility === null) visibility = createConflictVisibilityIndex(sorted);
    const summary = createCrdtConflictSummaryFromCandidates(entry.path, entry.ops, sorted, visibility);
    if (summary !== undefined) summaries[summaries.length] = summary;
  }
  return summaries;
}

function createCrdtConflictFromCandidates(
  path: JsonPath,
  candidates: CrdtRegisterOperation[],
  sortedOps: CrdtOperation[],
  visibility: ConflictVisibilityIndex,
  metadata?: Map<string, JsonObject>,
  metadataHeads?: Map<string, string>
): CrdtConflict | undefined {
  const reachability = createOperationReachabilityIndex(sortedOps);
  const maximal: CrdtRegisterOperation[] = [];
  candidateLoop:
  for (let i = 0, length = candidates.length; i < length; i++) {
    const candidate = candidates[i];
    for (let j = 0; j < length; j++) {
      if (i === j) continue;
      if (operationCausallyAfter(candidates[j], candidate, reachability)) continue candidateLoop;
    }
    maximal[maximal.length] = candidate;
  }
  if (maximal.length <= 1) return undefined;

  const compare = visibility.compare;
  let winner = maximal[0];
  for (let i = 1, length = maximal.length; i < length; i++) {
    if (compare(maximal[i], winner) > 0) winner = maximal[i];
  }
  if (!isRegisterConflictVisible(path, winner, visibility)) return undefined;
  maximal.sort((left, right) => {
    if (left === winner) return -1;
    if (right === winner) return 1;
    return compare(right, left);
  });

  const values = new Array<CrdtConflictValue>(maximal.length);
  for (let i = 0, length = maximal.length; i < length; i++) {
    values[i] = createCrdtConflictValue(maximal[i], maximal[i] === winner, metadata, metadataHeads);
  }
  return {
    path: path.slice(),
    winner: values[0],
    losers: values.slice(1),
    values
  };
}

function createCrdtConflictSummaryFromCandidates(
  path: JsonPath,
  candidates: CrdtRegisterOperation[],
  sortedOps: CrdtOperation[],
  visibility: ConflictVisibilityIndex
): CrdtConflictSummary | undefined {
  const reachability = createOperationReachabilityIndex(sortedOps);
  const maximal: CrdtRegisterOperation[] = [];
  candidateLoop:
  for (let i = 0, length = candidates.length; i < length; i++) {
    const candidate = candidates[i];
    for (let j = 0; j < length; j++) {
      if (i === j) continue;
      if (operationCausallyAfter(candidates[j], candidate, reachability)) continue candidateLoop;
    }
    maximal[maximal.length] = candidate;
  }
  if (maximal.length <= 1) return undefined;

  const compare = visibility.compare;
  let winner = maximal[0];
  for (let i = 1, length = maximal.length; i < length; i++) {
    if (compare(maximal[i], winner) > 0) winner = maximal[i];
  }
  if (!isRegisterConflictVisible(path, winner, visibility)) return undefined;
  const actors: CrdtActorId[] = [];
  const seenActors = new Set<CrdtActorId>();
  let hasDelete = false;
  for (let i = 0, length = maximal.length; i < length; i++) {
    const op = maximal[i];
    if (op.type === 'del') hasDelete = true;
    if (!seenActors.has(op.actor)) {
      seenActors.add(op.actor);
      actors[actors.length] = op.actor;
    }
  }
  actors.sort();
  return {
    path: path.slice(),
    selectedId: winner.id,
    valueCount: maximal.length,
    loserCount: maximal.length - 1,
    hasDelete,
    actors
  };
}

function createConflictVisibilityIndex(sortedOps: CrdtOperation[]): ConflictVisibilityIndex {
  const compare = createCausalComparator(sortedOps);
  const mapWinners = new Map<string, CrdtOperation>();
  const counters = new Map<string, { path: JsonPath; latest: CrdtOperation }>();
  const islandLatest = new Map<string, { type: 'list' | 'text' | 'tree'; op: CrdtOperation }>();

  for (let i = 0, length = sortedOps.length; i < length; i++) {
    const op = sortedOps[i];
    const key = pathKey(op.path);
    if (op.type === 'set' || op.type === 'del' || op.type === 'binarySet') {
      const current = mapWinners.get(key);
      if (current === undefined || compare(op, current) > 0) mapWinners.set(key, op);
    } else if (op.type === 'counter') {
      const current = counters.get(key);
      if (current === undefined) {
        counters.set(key, { path: op.path, latest: op });
      } else if (compare(op, current.latest) > 0) {
        current.latest = op;
      }
    } else if (isTreeOperation(op)) {
      const current = islandLatest.get(key);
      if (current === undefined || compare(op, current.op) > 0) {
        islandLatest.set(key, { type: 'tree', op });
      }
    } else {
      const kind = isTextSequenceOperation(op) ? 'text' : 'list';
      const current = islandLatest.get(key);
      if (current === undefined || compare(op, current.op) > 0) {
        islandLatest.set(key, { type: kind, op });
      }
    }
  }

  return { compare, mapWinners, counters, islandLatest };
}

function isRegisterConflictVisible(
  path: JsonPath,
  winner: CrdtRegisterOperation,
  visibility: ConflictVisibilityIndex
): boolean {
  const key = pathKey(path);
  const mapWinner = visibility.mapWinners.get(key);
  if (mapWinner !== undefined && visibility.compare(mapWinner, winner) > 0) return false;
  if (hasDominatingMapAncestor(path, visibility.mapWinners, winner, visibility.compare)) return false;
  const counter = visibility.counters.get(key);
  if (counter !== undefined && visibility.compare(counter.latest, winner) > 0) return false;
  const island = visibility.islandLatest.get(key);
  if (island !== undefined && visibility.compare(island.op, winner) > 0) return false;
  return true;
}

function createOperationReachabilityIndex(ops: CrdtOperation[]): OperationReachabilityIndex {
  const byId = new Map<string, CrdtOperation>();
  for (let i = 0, length = ops.length; i < length; i++) {
    const op = ops[i];
    if (isSpanningOperation(op)) {
      const end = operationEndSeq(op);
      for (let seq = op.seq; seq <= end; seq++) byId.set(`${op.actor}:${seq}`, op);
    } else {
      byId.set(op.id, op);
    }
  }
  return { byId, cache: new Map<string, Map<string, boolean>>() };
}

function operationCausallyAfter(
  left: CrdtOperation,
  right: CrdtOperation,
  index: OperationReachabilityIndex
): boolean {
  const leftHead = operationHeadId(left);
  const rightHead = operationHeadId(right);
  if (leftHead === rightHead) return false;
  if (left.actor === right.actor) return operationEndSeq(left) > operationEndSeq(right);
  return operationReaches(leftHead, rightHead, index.byId, index.cache);
}

function createCrdtConflictValue(
  op: CrdtRegisterOperation,
  selected: boolean,
  metadata?: Map<string, JsonObject>,
  metadataHeads?: Map<string, string>
): CrdtConflictValue {
  const value: CrdtConflictValue = {
    id: op.id,
    actor: op.actor,
    seq: op.seq,
    deps: op.deps.slice(),
    type: op.type === 'del' ? 'delete' : op.type === 'binarySet' ? 'binary' : 'set',
    path: op.path.slice(),
    selected,
    deleted: op.type === 'del'
  };
  if (op.type === 'set') value.value = cloneJson(op.value);
  else if (op.type === 'binarySet') value.value = binaryJsonValue(op.bytes);
  if (metadata !== undefined) {
    const opHead = operationHeadId(op);
    let opMetadata = metadata.get(opHead);
    if (opMetadata === undefined && metadataHeads !== undefined) {
      const metadataHead = metadataHeads.get(opHead);
      if (metadataHead !== undefined) opMetadata = metadata.get(metadataHead);
    }
    if (opMetadata !== undefined) value.metadata = cloneJson(opMetadata);
  }
  return value;
}

function resolveCrdtConflictAction(
  conflict: CrdtConflict,
  resolution: CrdtConflictResolution
): CrdtResolvedConflictAction {
  if (isCrdtConflictValueResolution(resolution)) {
    return conflictValueToResolutionAction(findCrdtConflictValue(conflict, resolution.id));
  }
  if (resolution !== null && typeof resolution === 'object' && !Array.isArray(resolution)) {
    if (resolution.type === 'operation') {
      if (typeof resolution.id !== 'string' || resolution.id.length === 0) {
        throw new TypeError('CRDT conflict operation resolution requires an operation id');
      }
      return conflictValueToResolutionAction(findCrdtConflictValue(conflict, resolution.id));
    }
    if (resolution.type === 'delete') return { type: 'delete' };
    if (resolution.type === 'value') {
      if (!Object.prototype.hasOwnProperty.call(resolution, 'value')) {
        throw new TypeError('CRDT conflict value resolution requires a value');
      }
      return { type: 'value', value: cloneJson(resolution.value) };
    }
  }
  throw new TypeError('invalid CRDT conflict resolution');
}

function findCrdtConflictValue(conflict: CrdtConflict, id: string): CrdtConflictValue {
  for (let i = 0, length = conflict.values.length; i < length; i++) {
    if (conflict.values[i].id === id) return conflict.values[i];
  }
  throw new RangeError('CRDT conflict resolution operation is not part of the current conflict');
}

function conflictValueToResolutionAction(value: CrdtConflictValue): CrdtResolvedConflictAction {
  return value.deleted ? { type: 'delete' } : { type: 'value', value: cloneJson(value.value as JsonValue) };
}

function isCrdtConflictValueResolution(value: CrdtConflictResolution): value is CrdtConflictValue {
  return value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof (value as CrdtConflictValue).id === 'string' &&
    (
      (value as CrdtConflictValue).type === 'set' ||
      (value as CrdtConflictValue).type === 'delete' ||
      (value as CrdtConflictValue).type === 'binary'
    ) &&
    Array.isArray((value as CrdtConflictValue).path);
}

function isRegisterOperation(op: CrdtOperation): op is CrdtRegisterOperation {
  return op.type === 'set' || op.type === 'del' || op.type === 'binarySet';
}

function pathMatchesConflictQuery(path: JsonPath, prefix: JsonPath | undefined, directChildrenOnly: boolean): boolean {
  if (prefix === undefined) return true;
  if (!samePathPrefix(path, prefix, prefix.length)) return false;
  return !directChildrenOnly || path.length === prefix.length + 1;
}

function comparePaths(left: JsonPath, right: JsonPath): number {
  const min = Math.min(left.length, right.length);
  for (let i = 0; i < min; i++) {
    const leftSegment = left[i];
    const rightSegment = right[i];
    if (leftSegment === rightSegment) continue;
    if (typeof leftSegment === 'number' && typeof rightSegment === 'number') return leftSegment - rightSegment;
    const leftString = String(leftSegment);
    const rightString = String(rightSegment);
    return leftString < rightString ? -1 : leftString > rightString ? 1 : 0;
  }
  return left.length - right.length;
}

function materialize(ops: CrdtOperation[]): JsonValue {
  const sorted = expandMapSetRunsForMaterialize(ops);
  sortOperationsIfNeeded(sorted);
  const causalCompare = createCausalComparator(sorted);
  const mapWinners = new Map<string, CrdtOperation>();
  const counters = new Map<string, { path: JsonPath; sum: number; latest: CrdtOperation }>();
  const islandLatest = new Map<string, { type: 'list' | 'text' | 'tree'; op: CrdtOperation }>();

  for (let i = 0, length = sorted.length; i < length; i++) {
    const op = sorted[i];
    const key = pathKey(op.path);
    if (op.type === 'set' || op.type === 'del' || op.type === 'binarySet') {
      const current = mapWinners.get(key);
      if (current === undefined || causalCompare(op, current) > 0) {
        mapWinners.set(key, op);
      }
    } else if (op.type === 'counter') {
      const current = counters.get(key);
      if (current === undefined) {
        counters.set(key, { path: op.path, sum: op.delta, latest: op });
      } else {
        current.sum += op.delta;
        if (causalCompare(op, current.latest) > 0) current.latest = op;
      }
    } else if (isTreeOperation(op)) {
      const current = islandLatest.get(key);
      if (current === undefined || causalCompare(op, current.op) > 0) {
        islandLatest.set(key, { type: 'tree', op });
      }
    } else {
      const kind = isTextSequenceOperation(op) ? 'text' : 'list';
      const current = islandLatest.get(key);
      if (current === undefined || causalCompare(op, current.op) > 0) {
        islandLatest.set(key, { type: kind, op });
      }
    }
  }

  let root: JsonValue = {};
  const rootWinner = mapWinners.get('[]');
  if (rootWinner !== undefined && rootWinner.type === 'set') {
    root = cloneJson(rootWinner.value);
  } else if (rootWinner !== undefined && rootWinner.type === 'binarySet') {
    root = binaryJsonValue(rootWinner.bytes);
  }

  const mapEntries = Array.from(mapWinners.values()).sort((left, right) => {
    const depth = left.path.length - right.path.length;
    return depth !== 0 ? depth : compareOperationIds(left.id, right.id);
  });
  const descendantMapEntries: CrdtOperation[] = [];

  for (let i = 0, length = mapEntries.length; i < length; i++) {
    const op = mapEntries[i];
    if (op.path.length === 0) continue;
    if (hasDominatingMapAncestor(op.path, mapWinners, op, causalCompare)) continue;
    if (hasIslandAncestor(op.path, islandLatest)) {
      descendantMapEntries.push(op);
      continue;
    }
    const counter = counters.get(pathKey(op.path));
    if (counter !== undefined && causalCompare(counter.latest, op) > 0) continue;
    const island = islandLatest.get(pathKey(op.path));
    if (island !== undefined && causalCompare(island.op, op) > 0) continue;
    if (op.type === 'set') {
      root = setPath(root, op.path, cloneJson(op.value));
    } else if (op.type === 'binarySet') {
      root = setPath(root, op.path, binaryJsonValue(op.bytes));
    } else {
      root = removePath(root, op.path);
    }
  }

  const islandEntries = Array.from(islandLatest.entries()).sort((left, right) => {
    const leftPath = JSON.parse(left[0]);
    const rightPath = JSON.parse(right[0]);
    const depth = leftPath.length - rightPath.length;
    return depth !== 0 ? depth : left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0;
  });

  for (let i = 0, length = islandEntries.length; i < length; i++) {
    const key = islandEntries[i][0];
    const latest = islandEntries[i][1];
    const path = JSON.parse(key);
    const mapWinner = mapWinners.get(key);
    if (mapWinner !== undefined && causalCompare(mapWinner, latest.op) > 0) continue;
    if (hasDominatingMapAncestor(path, mapWinners, latest.op, causalCompare)) continue;
    if (latest.type !== 'tree' && !hasReachableSequence(sorted, path, latest.type)) continue;
    const value = latest.type === 'tree'
      ? materializeTree(sorted, path)
      : latest.type === 'text'
        ? materializeText(sorted, path)
        : materializeList(sorted, path);
    root = setPath(root, path, value as unknown as JsonValue);
  }

  const counterEntries = Array.from(counters.values()).sort((left, right) => {
    const depth = left.path.length - right.path.length;
    return depth !== 0 ? depth : compareOperationIds(left.latest.id, right.latest.id);
  });
  for (let i = 0, length = counterEntries.length; i < length; i++) {
    const counter = counterEntries[i];
    const path = counter.path;
    if (hasDominatingMapAncestor(path, mapWinners, counter.latest, causalCompare)) continue;
    if (hasIslandAncestor(path, islandLatest)) continue;
    const key = pathKey(path);
    const mapWinner = mapWinners.get(key);
    if (mapWinner !== undefined && causalCompare(mapWinner, counter.latest) > 0) continue;
    const current = valueAtPath(root, path);
    const base = typeof current === 'number' && Number.isFinite(current) ? current : 0;
    root = setPath(root, path, base + counter.sum);
  }

  descendantMapEntries.sort((left, right) => {
    const depth = left.path.length - right.path.length;
    return depth !== 0 ? depth : compareOperationIds(left.id, right.id);
  });
  for (let i = 0, length = descendantMapEntries.length; i < length; i++) {
    const op = descendantMapEntries[i];
    if (hasDominatingMapAncestor(op.path, mapWinners, op, causalCompare)) continue;
    if (op.type === 'set') {
      root = setPath(root, op.path, cloneJson(op.value));
    } else if (op.type === 'binarySet') {
      root = setPath(root, op.path, binaryJsonValue(op.bytes));
    } else {
      root = removePath(root, op.path);
    }
  }

  return root;
}

function expandMapSetRunsForMaterialize(ops: CrdtOperation[]): CrdtOperation[] {
  let expanded: CrdtOperation[] | null = null;
  for (let i = 0, length = ops.length; i < length; i++) {
    const op = ops[i];
    if (op.type === 'mapSetRun') {
      if (expanded === null) expanded = ops.slice(0, i);
      const setOps = expandMapSetRunOperation(op);
      for (let j = 0, setCount = setOps.length; j < setCount; j++) expanded[expanded.length] = setOps[j];
    } else if (expanded !== null) {
      expanded[expanded.length] = op;
    }
  }
  return expanded === null ? ops.slice() : expanded;
}

function createCausalComparator(ops: CrdtOperation[]): (left: CrdtOperation, right: CrdtOperation) => number {
  const byId = new Map<string, CrdtOperation>();
  for (let i = 0, length = ops.length; i < length; i++) {
    const op = ops[i];
    if (isSpanningOperation(op)) {
      const end = operationEndSeq(op);
      for (let seq = op.seq; seq <= end; seq++) byId.set(`${op.actor}:${seq}`, op);
    } else {
      byId.set(op.id, op);
    }
  }
  const reachabilityCache = new Map<string, Map<string, boolean>>();

  return (left: CrdtOperation, right: CrdtOperation): number => {
    const leftHead = operationHeadId(left);
    const rightHead = operationHeadId(right);
    if (leftHead === rightHead) return 0;
    if (left.actor === right.actor) return operationEndSeq(left) - operationEndSeq(right);
    if (operationReaches(leftHead, rightHead, byId, reachabilityCache)) return 1;
    if (operationReaches(rightHead, leftHead, byId, reachabilityCache)) return -1;
    return compareOperationIds(leftHead, rightHead);
  };
}

function createCausalOperationIdComparator(ops: CrdtOperation[]): (left: string, right: string) => number {
  const byId = new Map<string, CrdtOperation>();
  for (let i = 0, length = ops.length; i < length; i++) {
    const op = ops[i];
    if (isSpanningOperation(op)) {
      const end = operationEndSeq(op);
      for (let seq = op.seq; seq <= end; seq++) byId.set(`${op.actor}:${seq}`, op);
    } else {
      byId.set(op.id, op);
    }
  }
  const reachabilityCache = new Map<string, Map<string, boolean>>();

  return (left: string, right: string): number => {
    if (left === right) return 0;
    const leftParts = parseOperationId(left);
    const rightParts = parseOperationId(right);
    if (leftParts.actor === rightParts.actor) return leftParts.seq - rightParts.seq;
    if (operationReaches(left, right, byId, reachabilityCache)) return 1;
    if (operationReaches(right, left, byId, reachabilityCache)) return -1;
    return compareOperationIds(left, right);
  };
}

function operationReaches(
  sourceId: string,
  targetId: string,
  byId: Map<string, CrdtOperation>,
  cache: Map<string, Map<string, boolean>>
): boolean {
  let sourceCache = cache.get(sourceId);
  if (sourceCache !== undefined) {
    const cached = sourceCache.get(targetId);
    if (cached !== undefined) return cached;
  }

  const source = byId.get(sourceId);
  if (source === undefined) return false;
  const stack: string[] = [];
  const sourceDeps = operationDepsForId(source, sourceId);
  for (let i = 0, length = sourceDeps.length; i < length; i++) {
    const dep = sourceDeps[i];
    if (dep === targetId) return cacheReachability(cache, sourceId, targetId, true);
    if (byId.has(dep)) stack[stack.length] = dep;
  }

  let reached = false;
  const seen = new Set<string>();
  while (stack.length !== 0) {
    const id = stack.pop() as string;
    if (id === targetId) {
      reached = true;
      break;
    }
    if (seen.has(id)) continue;
    seen.add(id);

    sourceCache = cache.get(id);
    const cached = sourceCache === undefined ? undefined : sourceCache.get(targetId);
    if (cached === true) {
      reached = true;
      break;
    }
    if (cached === false) continue;

    const op = byId.get(id);
    if (op === undefined) continue;
    const deps = operationDepsForId(op, id);
    for (let i = 0, length = deps.length; i < length; i++) {
      const dep = deps[i];
      if (dep === targetId) {
        reached = true;
        stack.length = 0;
        break;
      }
      if (byId.has(dep)) stack[stack.length] = dep;
    }
  }

  return cacheReachability(cache, sourceId, targetId, reached);
}

function cacheReachability(cache: Map<string, Map<string, boolean>>, sourceId: string, targetId: string, value: boolean): boolean {
  let sourceCache = cache.get(sourceId);
  if (sourceCache === undefined) {
    sourceCache = new Map<string, boolean>();
    cache.set(sourceId, sourceCache);
  }
  sourceCache.set(targetId, value);
  return value;
}

function hasDominatingMapAncestor(
  path: JsonPath,
  mapWinners: Map<string, CrdtOperation>,
  op: CrdtOperation,
  compare: (left: CrdtOperation, right: CrdtOperation) => number
): boolean {
  for (let depth = 0; depth < path.length; depth++) {
    const ancestor = mapWinners.get(pathKey(path.slice(0, depth)));
    if (ancestor !== undefined && compare(ancestor, op) > 0) return true;
  }
  return false;
}

function hasIslandAncestor(path: JsonPath, islands: Map<string, { type: 'list' | 'text' | 'tree'; op: CrdtOperation }>): boolean {
  for (let depth = 1; depth < path.length; depth++) {
    if (islands.has(pathKey(path.slice(0, depth)))) return true;
  }
  return false;
}

function materializeList(ops: CrdtOperation[], path: JsonPath): JsonValue[] {
  const linear = tryLinearSequenceChunks(ops, path, 'list');
  if (linear !== null) return materializeLinearList(linear);
  const nodes = buildSequenceNodes(ops, path, 'list');
  return flattenSequence(nodes, createCausalOperationIdComparator(ops))
    .filter((node) => !node.deleted)
    .map((node) => cloneJson(node.value));
}

function hasReachableSequence(ops: CrdtOperation[], path: JsonPath, kind: 'list' | 'text'): boolean {
  const linear = tryLinearSequenceChunks(ops, path, kind);
  if (linear !== null) return linear.length !== 0;
  return flattenSequence(buildSequenceNodes(ops, path, kind)).length !== 0;
}

function materializeText(ops: CrdtOperation[], path: JsonPath): string {
  const linear = tryLinearSequenceChunks(ops, path, 'text');
  if (linear !== null) return materializeLinearText(linear);
  const nodes = buildSequenceNodes(ops, path, 'text');
  const ordered = flattenSequence(nodes, createCausalOperationIdComparator(ops));
  const chunks: string[] = [];
  for (let i = 0, length = ordered.length; i < length; i++) {
    const node = ordered[i];
    if (!node.deleted) chunks[chunks.length] = node.value as string;
  }
  return chunks.join('');
}

function getVisibleElementIds(ops: CrdtOperation[], path: JsonPath, kind: 'list' | 'text'): string[] {
  const linear = tryLinearSequenceChunks(ops, path, kind);
  if (linear !== null) return linearSequenceElementIds(linear);
  const nodes = buildSequenceNodes(ops, path, kind);
  return flattenSequence(nodes, createCausalOperationIdComparator(ops))
    .filter((node) => !node.deleted)
    .map((node) => node.id);
}

function tryLinearSequenceChunks(ops: CrdtOperation[], path: JsonPath, kind: 'list' | 'text'): SequenceLinearChunk[] | null {
  const pathId = pathKey(path);
  let tail: string | null = null;
  let chunks: SequenceLinearChunk[] | null = null;

  for (let i = 0, length = ops.length; i < length; i++) {
    const op = ops[i];
    if (pathKey(op.path) !== pathId) continue;

    if (kind === 'text') {
      if (isTextDeleteOperation(op)) return null;
      if (op.type === 'textInsert') {
        if (op.after !== tail) return null;
        const count = codePointLength(op.text);
        if (count === 0) continue;
        if (chunks === null) chunks = [];
        chunks[chunks.length] = { op, count, text: op.text };
        tail = createdElementId(op, count - 1);
      } else if (op.type === 'textRun') {
        if (op.after !== tail) return null;
        if (chunks === null) chunks = [];
        chunks[chunks.length] = { op, count: op.count, text: op.text };
        tail = createdElementId(op, op.count - 1);
      }
    } else {
      if (op.type === 'listDel') return null;
      if (op.type === 'listInsert') {
        if (op.after !== tail) return null;
        const count = op.values.length;
        if (count === 0) continue;
        if (chunks === null) chunks = [];
        chunks[chunks.length] = { op, count, values: op.values };
        tail = createdElementId(op, count - 1);
      } else if (op.type === 'listRun') {
        if (op.after !== tail) return null;
        if (chunks === null) chunks = [];
        chunks[chunks.length] = { op, count: op.count, values: op.values };
        tail = createdElementId(op, op.count - 1);
      }
    }
  }

  return chunks === null ? [] : chunks;
}

function materializeLinearText(chunks: SequenceLinearChunk[]): string {
  if (chunks.length === 0) return '';
  if (chunks.length === 1) return chunks[0].text as string;
  const textChunks = new Array<string>(chunks.length);
  for (let i = 0, length = chunks.length; i < length; i++) textChunks[i] = chunks[i].text as string;
  return textChunks.join('');
}

function materializeLinearList(chunks: SequenceLinearChunk[]): JsonValue[] {
  let total = 0;
  for (let i = 0, length = chunks.length; i < length; i++) total += chunks[i].count;
  const values = new Array<JsonValue>(total);
  let offset = 0;
  for (let i = 0, length = chunks.length; i < length; i++) {
    const chunkValues = chunks[i].values as JsonValue[];
    for (let j = 0, valueCount = chunkValues.length; j < valueCount; j++) {
      values[offset++] = cloneJson(chunkValues[j]);
    }
  }
  return values;
}

function linearSequenceElementIds(chunks: SequenceLinearChunk[]): string[] {
  let total = 0;
  for (let i = 0, length = chunks.length; i < length; i++) total += chunks[i].count;
  const ids = new Array<string>(total);
  let offset = 0;
  for (let i = 0, length = chunks.length; i < length; i++) {
    const chunk = chunks[i];
    for (let j = 0; j < chunk.count; j++) ids[offset++] = createdElementId(chunk.op, j);
  }
  return ids;
}

function buildSequenceNodes(ops: CrdtOperation[], path: JsonPath, kind: 'list' | 'text') {
  const pathId = pathKey(path);
  const nodes = new Map<string, SequenceNode>();
  const deleted = new Set<string>();

  for (let i = 0, length = ops.length; i < length; i++) {
    const op = ops[i];
    if (pathKey(op.path) !== pathId) continue;

    if (kind === 'list' && op.type === 'listInsert') {
      let after = op.after;
      for (let j = 0, count = op.values.length; j < count; j++) {
        const id = `${op.id}/${j}`;
        nodes.set(id, { id, after, opId: op.id, value: op.values[j], deleted: false });
        after = id;
      }
    } else if (kind === 'list' && op.type === 'listRun') {
      let after = op.after;
      for (let j = 0, count = op.values.length; j < count; j++) {
        const opId = `${op.actor}:${op.seq + j}`;
        const id = `${opId}/0`;
        nodes.set(id, { id, after, opId, value: op.values[j], deleted: false });
        after = id;
      }
    } else if (kind === 'text' && op.type === 'textInsert') {
      let after = op.after;
      const chars = stringCodePoints(op.text);
      for (let j = 0, count = chars.length; j < count; j++) {
        const id = `${op.id}/${j}`;
        nodes.set(id, { id, after, opId: op.id, value: chars[j], deleted: false });
        after = id;
      }
    } else if (kind === 'text' && op.type === 'textRun') {
      let after = op.after;
      const chars = stringCodePoints(op.text);
      for (let j = 0, count = chars.length; j < count; j++) {
        const opId = `${op.actor}:${op.seq + j}`;
        const id = `${opId}/0`;
        nodes.set(id, { id, after, opId, value: chars[j], deleted: false });
        after = id;
      }
    } else if (kind === 'list' && op.type === 'listDel') {
      for (let j = 0, count = op.elems.length; j < count; j++) deleted.add(op.elems[j]);
    } else if (kind === 'text' && isTextDeleteOperation(op)) {
      addTextDeleteElementsToSet(deleted, op);
    }
  }

  deleted.forEach((id) => {
    const node = nodes.get(id);
    if (node !== undefined) node.deleted = true;
  });
  return nodes;
}

function flattenSequence(
  nodes: Map<string, SequenceNode>,
  compareOperationIdsForSequence: (left: string, right: string) => number = compareOperationIds
): SequenceNode[] {
  const children = new Map<string, SequenceNode[]>();
  nodes.forEach((node) => {
    const parent = node.after || '';
    let list = children.get(parent);
    if (list === undefined) {
      list = [];
      children.set(parent, list);
    }
    list.push(node);
  });

  children.forEach((list) => {
    list.sort((left, right) => compareElementIdsWithOperationComparator(right.id, left.id, compareOperationIdsForSequence));
  });

  const result: SequenceNode[] = [];
  const roots = children.get('');
  if (roots === undefined) return result;
  const stack: SequenceNode[] = [];
  for (let i = roots.length - 1; i >= 0; i--) stack[stack.length] = roots[i];
  while (stack.length !== 0) {
    const node = stack.pop() as SequenceNode;
    result[result.length] = node;
    const list = children.get(node.id);
    if (list === undefined) continue;
    for (let i = list.length - 1; i >= 0; i--) stack[stack.length] = list[i];
  }
  return result;
}

function setPath(root: JsonValue, path: JsonPath, value: JsonValue): JsonValue {
  if (path.length === 0) return value;
  if (root === null || typeof root !== 'object') root = typeof path[0] === 'number' ? [] : {};
  let cursor: any = root;
  for (let i = 0, last = path.length - 1; i < last; i++) {
    const segment = path[i];
    let next = cursor[segment];
    if (next === null || typeof next !== 'object') {
      next = typeof path[i + 1] === 'number' ? [] : {};
      setOwnValue(cursor, segment, next);
    }
    cursor = next;
  }
  setOwnValue(cursor, path[path.length - 1], value);
  return root;
}

function removePath(root: JsonValue, path: JsonPath): JsonValue {
  if (path.length === 0) return {};
  if (root === null || typeof root !== 'object') return root;
  let cursor: any = root;
  for (let i = 0, last = path.length - 1; i < last; i++) {
    cursor = cursor[path[i]];
    if (cursor === null || typeof cursor !== 'object') return root;
  }
  if (Array.isArray(cursor) && typeof path[path.length - 1] === 'number') {
    cursor.splice(path[path.length - 1] as number, 1);
  } else {
    delete cursor[path[path.length - 1]];
  }
  return root;
}

function getHeadsFromOperations(ops: Map<string, CrdtOperation>): string[] {
  const referenced = new Set<string>();
  ops.forEach((op) => {
    for (let i = 0, length = op.deps.length; i < length; i++) referenced.add(op.deps[i]);
  });
  const heads: string[] = [];
  ops.forEach((op) => {
    const head = operationHeadId(op);
    if (!referenced.has(head)) heads.push(head);
  });
  heads.sort(compareOperationIds);
  return heads;
}

function getHeadsFromOperationList(ops: CrdtOperation[]): string[] {
  const referenced = new Set<string>();
  for (let i = 0, length = ops.length; i < length; i++) {
    const deps = ops[i].deps;
    for (let j = 0, depCount = deps.length; j < depCount; j++) referenced.add(deps[j]);
  }
  const heads: string[] = [];
  for (let i = 0, length = ops.length; i < length; i++) {
    const head = operationHeadId(ops[i]);
    if (!referenced.has(head)) heads[heads.length] = head;
  }
  heads.sort(compareOperationIds);
  return heads;
}

function getStateVectorFromActorRanges(rangesByActor: Map<string, Array<[number, number]>>): CrdtStateVector {
  const vector: CrdtStateVector = {};
  rangesByActor.forEach((ranges, actor) => {
    let seq = 0;
    for (let i = 0, length = ranges.length; i < length; i++) {
      const range = ranges[i];
      if (range[0] > seq + 1) break;
      if (range[1] > seq) seq = range[1];
    }
    if (seq !== 0) vector[actor] = seq;
  });
  return vector;
}

function copyStateVector(vector: CrdtStateVector): CrdtStateVector {
  const out: CrdtStateVector = {};
  for (const actor in vector) out[actor] = vector[actor];
  return out;
}

function sortOperationsIfNeeded(ops: CrdtOperation[]): void {
  for (let i = 1, length = ops.length; i < length; i++) {
    if (compareOperations(ops[i - 1], ops[i]) > 0) {
      ops.sort(compareOperations);
      return;
    }
  }
}

function compareOperations(left: CrdtOperation, right: CrdtOperation): number {
  if (left.seq !== right.seq) return left.seq - right.seq;
  return left.actor < right.actor ? -1 : left.actor > right.actor ? 1 : 0;
}

function compareElementIds(left: string, right: string): number {
  return compareElementIdsWithOperationComparator(left, right, compareOperationIds);
}

function compareElementIdsWithOperationComparator(
  left: string,
  right: string,
  compareOperationIdsForSequence: (left: string, right: string) => number
): number {
  const leftSlash = left.lastIndexOf('/');
  const rightSlash = right.lastIndexOf('/');
  const leftOp = left.slice(0, leftSlash);
  const rightOp = right.slice(0, rightSlash);
  const opCompare = compareOperationIdsForSequence(leftOp, rightOp);
  if (opCompare !== 0) return opCompare;
  return Number(left.slice(leftSlash + 1)) - Number(right.slice(rightSlash + 1));
}

function compareOperationIds(left: string, right: string): number {
  const leftParts = parseOperationId(left);
  const rightParts = parseOperationId(right);
  if (leftParts.seq !== rightParts.seq) return leftParts.seq - rightParts.seq;
  return leftParts.actor < rightParts.actor ? -1 : leftParts.actor > rightParts.actor ? 1 : 0;
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

function childPathJsonPrefix(path: JsonPath): string {
  const parent = pathKey(path);
  return parent.length === 2 ? '[' : parent.slice(0, -1) + ',';
}

function appendEncodedPathSegment(prefix: string, segment: string | number): string {
  return prefix + JSON.stringify(segment) + ']';
}

function sequenceCacheKey(path: JsonPath, kind: 'list' | 'text'): string {
  return kind + ':' + pathKey(path);
}

function validateOperation(op: CrdtOperation): void {
  if (
    op === null ||
    typeof op !== 'object' ||
    typeof op.id !== 'string' ||
    typeof op.actor !== 'string' ||
    !Number.isSafeInteger(op.seq) ||
    !Array.isArray(op.deps) ||
    !Array.isArray(op.path)
  ) {
    throw new TypeError('invalid CRDT operation');
  }
  const parsed = parseOperationId(op.id);
  if (parsed.actor !== op.actor || parsed.seq !== op.seq) {
    throw new TypeError('CRDT operation id does not match actor/seq');
  }
  if (op.type === 'set') {
    cloneJson(op.value);
  } else if (op.type === 'del') {
    return;
  } else if (op.type === 'counter') {
    if (!Number.isSafeInteger(op.delta)) throw new TypeError('invalid CRDT counter');
  } else if (op.type === 'binarySet') {
    if (typeof op.bytes !== 'string') throw new TypeError('invalid CRDT binary set');
    base64ToBytes(op.bytes);
  } else if (op.type === 'treeCreate') {
    validateTreeNodeId(op.nodeId);
    normalizeTreeParent(op.parent);
    if (!(op.after === null || typeof op.after === 'string')) throw new TypeError('invalid CRDT tree create');
    cloneJson(op.value);
  } else if (op.type === 'treeMove') {
    validateTreeNodeId(op.nodeId);
    normalizeTreeParent(op.parent);
    if (!(op.after === null || typeof op.after === 'string')) throw new TypeError('invalid CRDT tree move');
  } else if (op.type === 'treeSet') {
    validateTreeNodeId(op.nodeId);
    cloneJson(op.value);
  } else if (op.type === 'treeDel') {
    validateTreeNodeId(op.nodeId);
  } else if (op.type === 'mapSetRun') {
    if (
      !Array.isArray(op.keys) ||
      !Array.isArray(op.values) ||
      !Number.isSafeInteger(op.count) ||
      op.count <= 0 ||
      op.keys.length !== op.count ||
      op.values.length !== op.count
    ) {
      throw new TypeError('invalid CRDT map set run');
    }
    for (let i = 0; i < op.count; i++) {
      if (typeof op.keys[i] !== 'string') throw new TypeError('invalid CRDT map set run key');
      cloneJson(op.values[i]);
    }
  } else if (op.type === 'listInsert') {
    if (!(op.after === null || typeof op.after === 'string') || !Array.isArray(op.values)) {
      throw new TypeError('invalid CRDT list insert');
    }
  } else if (op.type === 'listRun') {
    if (
      !(op.after === null || typeof op.after === 'string') ||
      !Array.isArray(op.values) ||
      !Number.isSafeInteger(op.count) ||
      op.count <= 0 ||
      op.values.length !== op.count
    ) {
      throw new TypeError('invalid CRDT list run');
    }
  } else if (op.type === 'listDel') {
    if (!Array.isArray(op.elems)) throw new TypeError('invalid CRDT list delete');
  } else if (op.type === 'textInsert') {
    if (!(op.after === null || typeof op.after === 'string') || typeof op.text !== 'string') {
      throw new TypeError('invalid CRDT text insert');
    }
  } else if (op.type === 'textRun') {
    if (
      !(op.after === null || typeof op.after === 'string') ||
      typeof op.text !== 'string' ||
      !Number.isSafeInteger(op.count) ||
      op.count <= 0 ||
      codePointLength(op.text) !== op.count
    ) {
      throw new TypeError('invalid CRDT text run');
    }
  } else if (op.type === 'textDel') {
    if (!Array.isArray(op.elems)) throw new TypeError('invalid CRDT text delete');
  } else if (op.type === 'textDelRange') {
    if (
      typeof op.start !== 'string' ||
      !Number.isSafeInteger(op.count) ||
      op.count <= 0 ||
      (op.span !== 'index' && op.span !== 'seq')
    ) {
      throw new TypeError('invalid CRDT text delete range');
    }
  } else {
    throw new TypeError('unknown CRDT operation type');
  }
}

function isCrdtUpdate(value: unknown): value is CrdtUpdate {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as CrdtUpdate).actor === 'string' &&
    Number.isSafeInteger((value as CrdtUpdate).seq) &&
    Array.isArray((value as CrdtUpdate).deps) &&
    Array.isArray((value as CrdtUpdate).ops) &&
    ((value as CrdtUpdate).metadata === undefined || isJsonObject((value as CrdtUpdate).metadata)) &&
    (
      (value as CrdtUpdate).metadataEntries === undefined ||
      Array.isArray((value as CrdtUpdate).metadataEntries)
    )
  );
}

function appendOperationAtStateVector(target: CrdtOperation[], op: CrdtOperation, vector: CrdtStateVector): void {
  const seen = vector[op.actor] || 0;
  if (seen < op.seq) return;
  if (operationEndSeq(op) <= seen) {
    target[target.length] = cloneCrdtOperation(op);
    return;
  }
  if (!isSpanningOperation(op)) return;
  const prefix = operationPrefix(op, seen);
  if (prefix !== null) target[target.length] = cloneCrdtOperation(prefix);
}

function getOperationsSinceStateVectorFromList(
  ops: readonly CrdtOperation[],
  vector: CrdtStateVector
): CrdtOperation[] {
  const sorted = ops.slice();
  sortOperationsIfNeeded(sorted);
  const result: CrdtOperation[] = [];
  for (let i = 0, length = sorted.length; i < length; i++) {
    appendOperationSinceStateVector(result, sorted[i], vector);
  }
  return result;
}

function appendOperationSinceStateVector(target: CrdtOperation[], op: CrdtOperation, vector: CrdtStateVector): void {
  const seen = vector[op.actor] || 0;
  if (operationEndSeq(op) <= seen) return;
  if (op.seq > seen) {
    target[target.length] = cloneCrdtOperation(op);
    return;
  }
  if (!isSpanningOperation(op)) return;
  const suffix = operationSuffix(op, seen + 1);
  if (suffix !== null) target[target.length] = cloneCrdtOperation(suffix);
}

function getStateVectorFromOperationList(ops: readonly CrdtOperation[]): CrdtStateVector {
  const rangesByActor = new Map<string, Array<[number, number]>>();
  for (let i = 0, length = ops.length; i < length; i++) {
    const op = ops[i];
    let ranges = rangesByActor.get(op.actor);
    if (ranges === undefined) {
      ranges = [];
      rangesByActor.set(op.actor, ranges);
    }
    addActorSeqRange(ranges, op.seq, operationEndSeq(op));
  }
  return getStateVectorFromActorRanges(rangesByActor);
}

function createOperationHeadSet(ops: readonly CrdtOperation[]): Set<string> {
  const heads = new Set<string>();
  for (let i = 0, length = ops.length; i < length; i++) {
    const op = ops[i];
    if (!isSpanningOperation(op)) {
      heads.add(op.id);
      continue;
    }
    const end = operationEndSeq(op);
    for (let seq = op.seq; seq <= end; seq++) heads.add(`${op.actor}:${seq}`);
  }
  return heads;
}

function operationsContainHead(ops: readonly CrdtOperation[], head: string): boolean {
  const parsed = tryParseOperationId(head);
  if (parsed === null) return false;
  for (let i = 0, length = ops.length; i < length; i++) {
    const op = ops[i];
    if (op.actor === parsed.actor && op.seq <= parsed.seq && operationEndSeq(op) >= parsed.seq) return true;
  }
  return false;
}

function cloneCrdtOperations(ops: readonly CrdtOperation[]): CrdtOperation[] {
  const cloned = new Array<CrdtOperation>(ops.length);
  for (let i = 0, length = ops.length; i < length; i++) cloned[i] = cloneCrdtOperation(ops[i]);
  return cloned;
}

function createCrdtHistoryEntries(
  ops: readonly CrdtOperation[],
  includeOps: boolean,
  metadataByHead?: ReadonlyMap<string, JsonObject>
): CrdtHistoryEntry[] {
  const entries: CrdtHistoryEntry[] = [];
  visitCrdtHistoryEntries(ops, includeOps, metadataByHead, (entry) => {
    entries[entries.length] = entry;
  });
  return entries;
}

function visitCrdtHistoryEntries(
  ops: readonly CrdtOperation[],
  includeOps: boolean,
  metadataByHead: ReadonlyMap<string, JsonObject> | undefined,
  callback: CrdtHistoryVisitor
): void {
  const vector: CrdtStateVector = {};
  const heads = new Set<string>();
  let current: CrdtHistoryEntry | null = null;
  let index = 0;
  let stopped = false;

  const emitCurrent = () => {
    if (current === null || stopped) return;
    stopped = callback(current, index++) === false;
    current = null;
  };

  for (let i = 0, length = ops.length; i < length; i++) {
    if (stopped) break;
    const op = ops[i];
    const endSeq = operationEndSeq(op);
    for (let j = 0, depLength = op.deps.length; j < depLength; j++) heads.delete(op.deps[j]);
    heads.add(operationHeadId(op));
    if ((vector[op.actor] || 0) < endSeq) vector[op.actor] = endSeq;

    if (current === null || current.actor !== op.actor || current.endSeq + 1 !== op.seq) {
      emitCurrent();
      if (stopped) break;
      current = {
        actor: op.actor,
        startSeq: op.seq,
        endSeq,
        count: 0,
        heads: [],
        stateVector: {}
      };
      if (includeOps) current.ops = [];
    } else {
      current.endSeq = endSeq;
    }

    current.count += operationSeqSpan(op);
    current.heads = sortedStringSet(heads);
    current.stateVector = cloneStateVector(vector);
    if (metadataByHead !== undefined) {
      const metadata = metadataByHead.get(operationHeadId(op));
      if (metadata !== undefined) current.metadata = cloneJson(metadata);
    }
    if (includeOps && current.ops !== undefined) current.ops[current.ops.length] = cloneCrdtOperation(op);
  }

  emitCurrent();
}

function sortedStringSet(values: Set<string>): string[] {
  const out: string[] = [];
  values.forEach((value) => {
    out[out.length] = value;
  });
  out.sort();
  return out;
}

function cloneStateVector(vector: CrdtStateVector): CrdtStateVector {
  const out: CrdtStateVector = {};
  for (const actor in vector) out[actor] = vector[actor];
  return out;
}

function validateCrdtVersionMarkName(name: string): string {
  if (typeof name !== 'string' || name.length === 0) {
    throw new TypeError('CRDT version mark name must be a non-empty string');
  }
  return name;
}

function cloneCrdtVersionMark(mark: CrdtVersionMark): CrdtVersionMark {
  const cloned: CrdtVersionMark = {
    name: mark.name,
    version: cloneCrdtVersion(mark.version),
    heads: mark.heads.slice(),
    stateVector: cloneStateVector(mark.stateVector)
  };
  if (mark.metadata !== undefined) cloned.metadata = cloneJson(mark.metadata);
  return cloned;
}

function cloneCrdtOperation(op: CrdtOperation): CrdtOperation {
  return cloneJson(op as unknown as JsonValue) as unknown as CrdtOperation;
}

function maxOperationSeq(ops: readonly CrdtOperation[]): number {
  let max = 0;
  for (let i = 0, length = ops.length; i < length; i++) {
    const end = operationEndSeq(ops[i]);
    if (end > max) max = end;
  }
  return max;
}

function normalizeCursorAssoc(assoc: number | undefined): -1 | 1 {
  return assoc === undefined || assoc < 0 ? -1 : 1;
}

function validateCrdtTextCursor(value: unknown): asserts value is CrdtTextCursor {
  if (
    value === null ||
    typeof value !== 'object' ||
    (value as CrdtTextCursor).type !== 'text' ||
    !Array.isArray((value as CrdtTextCursor).path) ||
    !((value as CrdtTextCursor).anchor === null || typeof (value as CrdtTextCursor).anchor === 'string') ||
    !isCursorSide((value as CrdtTextCursor).side) ||
    ((value as CrdtTextCursor).assoc !== -1 && (value as CrdtTextCursor).assoc !== 1) ||
    !Number.isSafeInteger((value as CrdtTextCursor).index) ||
    (value as CrdtTextCursor).index < 0
  ) {
    throw new TypeError('invalid CRDT text cursor');
  }
}

function validateCrdtTextSelection(value: unknown): asserts value is CrdtTextSelection {
  if (
    value === null ||
    typeof value !== 'object' ||
    (value as CrdtTextSelection).type !== 'text-selection'
  ) {
    throw new TypeError('invalid CRDT text selection');
  }
  validateCrdtTextCursor((value as CrdtTextSelection).anchor);
  validateCrdtTextCursor((value as CrdtTextSelection).focus);
}

function validateCrdtVersion(value: unknown): asserts value is CrdtVersion {
  if (Array.isArray(value)) {
    for (let i = 0, length = value.length; i < length; i++) {
      if (typeof value[i] !== 'string') throw new TypeError('invalid CRDT version');
    }
    return;
  }
  if (value === null || typeof value !== 'object') throw new TypeError('invalid CRDT version');
  for (const actor in value as Record<string, unknown>) {
    const seq = (value as Record<string, unknown>)[actor];
    if (!Number.isSafeInteger(seq) || (seq as number) < 0) throw new TypeError('invalid CRDT version');
  }
}

function validateCrdtSnapshot(value: unknown): asserts value is CrdtSnapshot {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('invalid CRDT snapshot');
  }
  const snapshot = value as CrdtSnapshot;
  if (snapshot.baseVersion !== undefined && snapshot.baseVersion !== null) validateCrdtVersion(snapshot.baseVersion);
  validateCrdtVersion(snapshot.version);
  if (!Array.isArray(snapshot.heads)) throw new TypeError('invalid CRDT snapshot heads');
  for (let i = 0, length = snapshot.heads.length; i < length; i++) {
    if (typeof snapshot.heads[i] !== 'string' || tryParseOperationId(snapshot.heads[i]) === null) {
      throw new TypeError('invalid CRDT snapshot head');
    }
  }
  validateCrdtVersion(snapshot.stateVector);
  if (Array.isArray(snapshot.stateVector)) throw new TypeError('invalid CRDT snapshot state vector');
  if (!(snapshot.update instanceof Uint8Array)) throw new TypeError('invalid CRDT snapshot update');
  if (snapshot.metadata !== undefined) validateCrdtCommitMetadataEntries(snapshot.metadata);
  if (snapshot.view !== undefined) cloneJson(snapshot.view);
}

function validateCrdtCommitMetadataEntries(value: unknown): asserts value is CrdtCommitMetadataEntry[] {
  if (!Array.isArray(value)) throw new TypeError('invalid CRDT metadata entries');
  for (let i = 0, length = value.length; i < length; i++) {
    const entry = value[i];
    if (
      entry === null ||
      typeof entry !== 'object' ||
      typeof (entry as CrdtCommitMetadataEntry).head !== 'string' ||
      tryParseOperationId((entry as CrdtCommitMetadataEntry).head) === null ||
      !isJsonObject((entry as CrdtCommitMetadataEntry).metadata)
    ) {
      throw new TypeError('invalid CRDT metadata entries');
    }
  }
}

function cloneCommitMetadataEntries(
  entries: readonly CrdtCommitMetadataEntry[] | undefined
): CrdtCommitMetadataEntry[] | undefined {
  if (entries === undefined) return undefined;
  const out = new Array<CrdtCommitMetadataEntry>(entries.length);
  for (let i = 0, length = entries.length; i < length; i++) {
    out[i] = {
      head: entries[i].head,
      metadata: cloneJson(entries[i].metadata) as JsonObject
    };
  }
  return out;
}

function cloneCrdtVersion(version: CrdtVersion): CrdtVersion {
  if (Array.isArray(version)) return version.slice();
  const out: CrdtStateVector = {};
  for (const actor in version) out[actor] = version[actor];
  return out;
}

function cloneCrdtTextCursor(cursor: CrdtTextCursor): CrdtTextCursor {
  return {
    type: 'text',
    path: cursor.path.slice(),
    anchor: cursor.anchor,
    side: cursor.side,
    assoc: cursor.assoc,
    index: cursor.index
  };
}

function cloneCrdtTextSelection(selection: CrdtTextSelection): CrdtTextSelection {
  return {
    type: 'text-selection',
    anchor: cloneCrdtTextCursor(selection.anchor),
    focus: cloneCrdtTextCursor(selection.focus)
  };
}

function isCursorSide(value: unknown): value is CrdtTextCursor['side'] {
  return value === 'before' || value === 'after' || value === 'start' || value === 'end';
}

function createCrdtCommitResult(
  updateFactory: () => Uint8Array,
  viewPatchSource: Patch | (() => Patch),
  heads: string[],
  stateVector: CrdtStateVector,
  onUpdateRead?: () => void,
  metadata?: JsonObject
): CrdtCommitResult {
  let update: Uint8Array | null = null;
  const clonedMetadata = metadata === undefined ? undefined : cloneJson(metadata);
  if (typeof viewPatchSource !== 'function') {
    const result: CrdtCommitResult = {
      get update() {
        if (update === null) {
          if (onUpdateRead !== undefined) onUpdateRead();
          update = updateFactory();
        }
        return update;
      },
      viewPatch: viewPatchSource,
      get heads() {
        return heads.slice();
      },
      stateVector
    };
    if (clonedMetadata !== undefined) result.metadata = cloneJson(clonedMetadata);
    return result;
  }
  let viewPatch: Patch | null = null;
  const result: CrdtCommitResult = {
    get update() {
      if (update === null) {
        if (onUpdateRead !== undefined) onUpdateRead();
        update = updateFactory();
      }
      return update;
    },
    get viewPatch() {
      if (viewPatch === null) viewPatch = (viewPatchSource as () => Patch)();
      return viewPatch;
    },
    get heads() {
      return heads.slice();
    },
    stateVector
  };
  if (clonedMetadata !== undefined) result.metadata = cloneJson(clonedMetadata);
  return result;
}

function createStaticCrdtCommitResult(
  update: Uint8Array,
  viewPatch: Patch,
  heads: string[],
  stateVector: CrdtStateVector,
  metadata?: JsonObject
): CrdtCommitResult {
  const result: CrdtCommitResult = {
    update,
    viewPatch,
    get heads() {
      return heads.slice();
    },
    stateVector
  };
  if (metadata !== undefined) result.metadata = cloneJson(metadata);
  return result;
}

function nativeTextLogTextsForRange(log: NativePositionalTextLog, start: number, end: number): string[] {
  if (start <= 0 && end >= log.tags.length) return log.texts.slice();
  const texts: string[] = [];
  let textIndex = 0;
  for (let i = 0; i < end; i++) {
    if (log.tags[i] === 1 || log.tags[i] === 2) {
      if (i >= start) texts[texts.length] = log.texts[textIndex];
      textIndex++;
    }
  }
  return texts;
}

function nativeTextLogTextForRange(log: NativePositionalTextLog, start: number, end: number): string {
  if (start <= 0 && end >= log.tags.length) return log.texts.join('');
  return nativeTextLogTextsForRange(log, start, end).join('');
}

function nativeTextLogAppendInsertAfter(log: NativePositionalTextLog, recordIndex: number): string | null | undefined {
  if (!log.appendOnly) return undefined;
  if (recordIndex === 0) return log.initialText.length === 0 ? null : undefined;
  if (recordIndex <= 0) return undefined;
  const previous = recordIndex - 1;
  return `${log.actor}:${log.firstSeq + previous}/${log.counts[previous] - 1}`;
}

function nativeTextLogTextIndexAt(log: NativePositionalTextLog, recordIndex: number): number {
  let textIndex = 0;
  for (let i = 0; i < recordIndex; i++) {
    const tag = log.tags[i];
    if (tag === 1 || tag === 2) textIndex++;
  }
  return textIndex;
}

function materializeNativeTextLog(log: NativePositionalTextLog, end = log.tags.length): string {
  if (end === log.tags.length && log.materializedText !== null) return log.materializedText;
  if (log.appendOnly) return log.initialText + nativeTextLogTextForRange(log, 0, end);
  const textValue = ChunkedTextValue.fromString(log.initialText);
  let index = 0;
  let textIndex = 0;
  for (let i = 0; i < end; i++) {
    index += log.positionDeltas[i];
    const tag = log.tags[i];
    const count = log.counts[i];
    if (tag === 1 || tag === 2) {
      const text = log.texts[textIndex++];
      textValue.insert(index, text, count);
    } else {
      textValue.delete(index, count);
    }
  }
  return textValue.toString();
}

function appendNativeTextLogSegment(log: NativePositionalTextLog, segment: NativeColumnarTextLogSegment): boolean {
  let previousIndex = log.previousIndex;
  let length = log.length;
  let appendOnly = log.appendOnly;
  let materializedText = log.materializedText;
  let textIndex = 0;
  for (let i = 0, recordCount = segment.tags.length; i < recordCount; i++) {
    const tag = segment.tags[i];
    const count = segment.counts[i];
    const index = previousIndex + segment.positionDeltas[i];
    if (!Number.isSafeInteger(index) || index < 0 || !Number.isSafeInteger(count) || count <= 0) return false;
    previousIndex = index;
    if (tag === 1 || tag === 2) {
      const text = segment.texts[textIndex++];
      if (typeof text !== 'string' || text.length === 0 || index > length) return false;
      log.texts[log.texts.length] = text;
      if (materializedText !== null) materializedText = index === length ? materializedText + text : null;
      if (index !== length) appendOnly = false;
      length += count;
    } else if (tag === 3) {
      if (index + count > length) return false;
      materializedText = null;
      appendOnly = false;
      length -= count;
    } else {
      return false;
    }
    log.tags[log.tags.length] = tag;
    log.positionDeltas[log.positionDeltas.length] = segment.positionDeltas[i];
    log.counts[log.counts.length] = count;
  }
  if (textIndex !== segment.texts.length) return false;
  log.previousIndex = previousIndex;
  log.length = length;
  log.appendOnly = appendOnly;
  log.materializedText = materializedText;
  return true;
}

function createTextDeleteOperationPayloadFromNativePieceSequence(
  sequence: NativeTextPieceSequence,
  index: number,
  count: number,
  preferRange = true
): TextDeleteOperationPayload | null {
  if (count <= 0 || index >= sequence.length) return null;
  const actualCount = Math.min(count, sequence.length - index);
  if (actualCount <= 0) return null;
  if (actualCount === 1) {
    const elem = sequence.at(index);
    return elem === null ? null : { type: 'textDel', elems: [elem], count: 1 };
  }
  if (preferRange) {
    const range = sequence.textDeleteRangePayload(index, actualCount);
    if (range !== null) return { type: 'textDelRange', range, count: actualCount };
  }
  const elems = sequence.slice(index, actualCount);
  return elems.length === 0 ? null : { type: 'textDel', elems, count: elems.length };
}

function createActorId(): string {
  return 'actor-' + Math.random().toString(36).slice(2, 10);
}

interface SequenceNode {
  id: string;
  after: string | null;
  opId: string;
  value: JsonValue | string;
  deleted: boolean;
}

interface SequenceLinearChunk {
  op: CrdtOperation;
  count: number;
  text?: string;
  values?: JsonValue[];
}

interface SequenceAppendState {
  length: number;
  tail: string | null;
}

interface TextDirtySpan {
  path: JsonPath;
  index: number;
  deleteCount: number;
  insert: string;
}

interface TextDirtySequence {
  path: JsonPath;
  sequence: TextSequence;
}

interface TextDirtySequenceEntry extends TextDirtySequence {
  key: string;
}

type TextDirtySequenceSource = Map<string, TextDirtySequence> | TextDirtySequenceEntry;

interface TextDirtyPatchOperation {
  path: JsonPath;
  offset: number;
  deleteCodeUnits: number;
  insert: string;
}

interface TextDirtyApplication {
  spans: TextDirtySpan[];
  sequences: Map<string, TextDirtySequence>;
  viewPatch: () => Patch;
}

interface TransactionTextAppendRun {
  key: string;
  path: JsonPath;
  op: Extract<CrdtOperation, { type: 'textInsert' | 'textRun' }>;
  appendState: SequenceAppendState;
  length: number;
  tail: string;
  tailSeq: number;
  unitText: string | null;
}
