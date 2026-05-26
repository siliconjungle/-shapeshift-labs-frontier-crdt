import { cloneJson } from '@shapeshift-labs/frontier/clone';
import {
  decodeCrdtUpdate,
  encodeCrdtUpdate,
  encodeCrdtUpdateWithProfile
} from './crdt.js';

export {
  decodeCrdtUpdate,
  encodeCrdtUpdate,
  encodeCrdtUpdateWithProfile
};
import type {
  CrdtActorId,
  CrdtCommitMetadataEntry,
  CrdtOperation,
  CrdtOperationId,
  CrdtStateVector,
  CrdtStateVectorConvertOptions,
  CrdtStateVectorInput,
  CrdtUpdate,
  CrdtUpdateActorRange,
  CrdtUpdateConvertOptions,
  CrdtUpdateFilterOptions,
  CrdtUpdateObfuscateOptions,
  CrdtUpdateInfo,
  CrdtUpdateInput,
  CrdtUpdateStateVectorInput,
  CrdtVersionRelation,
  JsonObject,
  JsonPath,
  JsonValue
} from './types.js';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const BASE64URL_DECODE = makeBase64UrlDecodeTable();

export function inspectCrdtUpdate(input: CrdtUpdateInput): CrdtUpdateInfo {
  const update = decodeCrdtUpdate(input);
  return createUpdateInfo(
    update.actor,
    update.seq,
    update.deps,
    update.ops,
    encodedByteLength(input, update),
    inspectUpdateMetadata(update),
    cloneMetadataEntries(update.metadataEntries)
  );
}

export function inspectCrdtUpdates(updates: readonly CrdtUpdateInput[]): CrdtUpdateInfo {
  if (updates.length === 0) return createUpdateInfo('', 0, [], [], 0);
  let firstUpdate: CrdtUpdate | null = null;
  let byteLength = 0;
  const ops: CrdtOperation[] = [];
  const metadataByHead = new Map<CrdtOperationId, CrdtCommitMetadataEntry>();
  const rangesByActor = new Map<string, Array<[number, number]>>();
  const seenIds = new Set<string>();

  for (let i = 0, length = updates.length; i < length; i++) {
    const update = decodeCrdtUpdate(updates[i]);
    if (firstUpdate === null) firstUpdate = update;
    byteLength += encodedByteLength(updates[i], update);
    collectUpdateMetadata(update, metadataByHead);
    for (let j = 0, opCount = update.ops.length; j < opCount; j++) {
      appendMissingOperation(ops, update.ops[j], rangesByActor, seenIds);
    }
  }

  sortOperationsIfNeeded(ops);
  const actor = chooseEnvelopeActor(firstUpdate, ops);
  const metadataEntries = collectMetadataEntriesForOperations(firstUpdate, ops, metadataByHead);
  const metadata = metadataEntries.length === 1 ? cloneJson(metadataEntries[0].metadata) as JsonObject : undefined;
  return createUpdateInfo(
    actor,
    maxSeqForActor(ops, actor),
    getRootDeps(ops),
    ops,
    byteLength,
    metadata,
    metadataEntries.length === 0 ? undefined : metadataEntries
  );
}

export function getCrdtUpdateActorRanges(input: CrdtUpdateInput | readonly CrdtUpdateInput[]): CrdtUpdateActorRange[] {
  if (Array.isArray(input)) return inspectCrdtUpdates(input).ranges;
  return getActorRangesFromOperationList(decodeCrdtUpdate(input as CrdtUpdateInput).ops);
}

export function getCrdtUpdateStateVector(input: CrdtUpdateInput | readonly CrdtUpdateInput[]): CrdtStateVector {
  if (Array.isArray(input)) {
    const ops: CrdtOperation[] = [];
    for (let i = 0, length = input.length; i < length; i++) {
      const update = decodeCrdtUpdate(input[i]);
      for (let j = 0, opCount = update.ops.length; j < opCount; j++) ops[ops.length] = update.ops[j];
    }
    return getStateVectorFromOperationList(ops);
  }
  return getStateVectorFromOperationList(decodeCrdtUpdate(input as CrdtUpdateInput).ops);
}

export function mergeCrdtStateVectors(vectors: readonly CrdtStateVector[]): CrdtStateVector {
  const out: CrdtStateVector = {};
  for (let i = 0, length = vectors.length; i < length; i++) mergeStateVectorInto(out, vectors[i]);
  return out;
}

export function diffCrdtStateVectors(source: CrdtStateVector, known?: CrdtStateVector | null): CrdtStateVector {
  const out: CrdtStateVector = {};
  const base = known || {};
  for (const actor in source) {
    const seq = source[actor];
    if (seq > (base[actor] || 0)) out[actor] = seq;
  }
  return out;
}

export function compareCrdtStateVectors(
  left: CrdtStateVector,
  right: CrdtStateVector
): CrdtVersionRelation {
  let leftInRight = true;
  let rightInLeft = true;
  for (const actor in left) {
    if (left[actor] > (right[actor] || 0)) leftInRight = false;
  }
  for (const actor in right) {
    if (right[actor] > (left[actor] || 0)) rightInLeft = false;
  }
  if (leftInRight && rightInLeft) return 'equal';
  if (leftInRight) return 'before';
  if (rightInLeft) return 'after';
  return 'concurrent';
}

export function compareCrdtUpdateStateVectors(
  left: CrdtUpdateStateVectorInput,
  right: CrdtUpdateStateVectorInput
): CrdtVersionRelation {
  return compareCrdtStateVectors(readCrdtStateVectorSource(left), readCrdtStateVectorSource(right));
}

export function encodeCrdtStateVector(stateVector: CrdtStateVector): Uint8Array {
  return encodeStateVectorJsonBytes(stateVector);
}

export function decodeCrdtStateVector(input: CrdtStateVectorInput): CrdtStateVector {
  return readStateVectorInput(input);
}

export function encodeCrdtStateVectorBase64url(stateVector: CrdtStateVector): string {
  return encodeBase64urlBytes(encodeStateVectorJsonBytes(stateVector));
}

export function decodeCrdtStateVectorBase64url(text: string): CrdtStateVector {
  return readStateVectorJsonBytes(decodeBase64urlBytes(text));
}

export function convertCrdtStateVector(
  input: CrdtStateVectorInput,
  options: CrdtStateVectorConvertOptions & { format: 'object' }
): CrdtStateVector;
export function convertCrdtStateVector(
  input: CrdtStateVectorInput,
  options: CrdtStateVectorConvertOptions & { format: 'base64url' }
): string;
export function convertCrdtStateVector(
  input: CrdtStateVectorInput,
  options?: CrdtStateVectorConvertOptions & { format?: 'json' }
): Uint8Array;
export function convertCrdtStateVector(
  input: CrdtStateVectorInput,
  options?: CrdtStateVectorConvertOptions
): Uint8Array | CrdtStateVector | string {
  const vector = readStateVectorInput(input);
  const format = readCrdtStateVectorFormat(options);
  if (format === 'object') return vector;
  if (format === 'base64url') return encodeBase64urlBytes(encodeStateVectorJsonBytes(vector));
  return encodeStateVectorJsonBytes(vector);
}

export function hasCrdtUpdateChanges(
  input: CrdtUpdateInput | readonly CrdtUpdateInput[],
  stateVector?: CrdtStateVector | null
): boolean {
  const vector = stateVector || {};
  if (Array.isArray(input)) {
    for (let i = 0, length = input.length; i < length; i++) {
      if (updateHasOperationsSinceStateVector(decodeCrdtUpdate(input[i]), vector)) return true;
    }
    return false;
  }
  return updateHasOperationsSinceStateVector(decodeCrdtUpdate(input as CrdtUpdateInput), vector);
}

export function getCrdtUpdateMetadata(input: CrdtUpdateInput | readonly CrdtUpdateInput[]): CrdtCommitMetadataEntry[] {
  const entries = new Map<CrdtOperationId, CrdtCommitMetadataEntry>();
  if (Array.isArray(input)) {
    for (let i = 0, length = input.length; i < length; i++) collectUpdateMetadata(decodeCrdtUpdate(input[i]), entries);
  } else {
    collectUpdateMetadata(decodeCrdtUpdate(input as CrdtUpdateInput), entries);
  }
  return Array.from(entries.values()).sort((left, right) => compareOperationIds(left.head, right.head));
}

export function diffCrdtUpdate(input: CrdtUpdateInput, stateVector?: CrdtStateVector | null): Uint8Array {
  const update = decodeCrdtUpdate(input);
  const ops = getOperationsSinceStateVectorFromList(update.ops, stateVector || {});
  return encodeCrdtUpdate(createUpdateFromOperations(update, ops));
}

export function diffCrdtUpdates(updates: readonly CrdtUpdateInput[], stateVector?: CrdtStateVector | null): Uint8Array {
  return diffCrdtUpdate(mergeCrdtUpdates(updates), stateVector);
}

export function filterCrdtUpdate(input: CrdtUpdateInput, options?: CrdtUpdateFilterOptions): Uint8Array {
  return filterCrdtUpdates([input], options);
}

export function filterCrdtUpdates(updates: readonly CrdtUpdateInput[], options?: CrdtUpdateFilterOptions): Uint8Array {
  if (updates.length === 0) return encodeCrdtUpdate({ actor: '', seq: 0, deps: [], ops: [] });
  let firstUpdate: CrdtUpdate | null = null;
  const filtered: CrdtOperation[] = [];
  const metadataByHead = new Map<CrdtOperationId, CrdtCommitMetadataEntry>();
  const rangesByActor = new Map<string, Array<[number, number]>>();
  const seenIds = new Set<string>();
  const state = createUpdateFilterState(options);

  for (let i = 0, length = updates.length; i < length; i++) {
    const update = decodeCrdtUpdate(updates[i]);
    if (firstUpdate === null) firstUpdate = update;
    collectUpdateMetadata(update, metadataByHead);
    const ops = update.ops;
    for (let j = 0, opCount = ops.length; j < opCount; j++) {
      appendFilteredOperation(filtered, ops[j], state, rangesByActor, seenIds);
    }
  }

  sortOperationsIfNeeded(filtered);
  return encodeCrdtUpdate(createUpdateFromOperations(firstUpdate, filtered, metadataByHead));
}

export function compactCrdtUpdate(update: CrdtUpdateInput): Uint8Array {
  return mergeCrdtUpdates([update]);
}

export function compactCrdtUpdates(updates: readonly CrdtUpdateInput[]): Uint8Array {
  return mergeCrdtUpdates(updates);
}

export function mergeCrdtUpdates(updates: readonly CrdtUpdateInput[]): Uint8Array {
  if (updates.length === 0) return encodeCrdtUpdate({ actor: '', seq: 0, deps: [], ops: [] });
  let firstUpdate: CrdtUpdate | null = null;
  const merged: CrdtOperation[] = [];
  const metadataByHead = new Map<CrdtOperationId, CrdtCommitMetadataEntry>();
  const rangesByActor = new Map<string, Array<[number, number]>>();
  const seenIds = new Set<string>();

  for (let i = 0, length = updates.length; i < length; i++) {
    const update = decodeCrdtUpdate(updates[i]);
    if (firstUpdate === null) firstUpdate = update;
    collectUpdateMetadata(update, metadataByHead);
    const ops = update.ops;
    for (let j = 0, opCount = ops.length; j < opCount; j++) {
      appendMissingOperation(merged, ops[j], rangesByActor, seenIds);
    }
  }

  sortOperationsIfNeeded(merged);
  return encodeCrdtUpdate(createUpdateFromOperations(firstUpdate, merged, metadataByHead));
}

export function convertCrdtUpdate(input: CrdtUpdateInput, options: CrdtUpdateConvertOptions & { format: 'object' }): CrdtUpdate;
export function convertCrdtUpdate(input: CrdtUpdateInput, options: CrdtUpdateConvertOptions & { format: 'base64url' }): string;
export function convertCrdtUpdate(input: CrdtUpdateInput, options?: CrdtUpdateConvertOptions & { format?: 'auto' | 'json' }): Uint8Array;
export function convertCrdtUpdate(input: CrdtUpdateInput, options: CrdtUpdateConvertOptions): Uint8Array | CrdtUpdate | string;
export function convertCrdtUpdate(
  input: CrdtUpdateInput,
  options?: CrdtUpdateConvertOptions
): Uint8Array | CrdtUpdate | string {
  const update = decodeCrdtUpdate(input);
  const format = readCrdtUpdateFormat(options);
  if (format === 'object') return cloneCrdtUpdate(update);
  if (format === 'base64url') return encodeBase64urlBytes(options && options.profile !== undefined
    ? encodeCrdtUpdateWithProfile(update, options.profile)
    : encodeCrdtUpdate(update));
  if (format === 'json') return encodeJsonEnvelopeUpdate(update);
  return options && options.profile !== undefined
    ? encodeCrdtUpdateWithProfile(update, options.profile)
    : encodeCrdtUpdate(update);
}

export function encodeCrdtUpdateBase64url(input: CrdtUpdateInput): string {
  return encodeBase64urlBytes(encodeCrdtUpdate(decodeCrdtUpdate(input)));
}

export function decodeCrdtUpdateBase64url(text: string): CrdtUpdate {
  return decodeCrdtUpdate(decodeBase64urlBytes(text));
}

export function obfuscateCrdtUpdate(input: CrdtUpdateInput, options?: CrdtUpdateObfuscateOptions): Uint8Array {
  const update = decodeCrdtUpdate(input);
  const state = createObfuscationState();
  const obfuscated: CrdtUpdate = {
    actor: obfuscateActor(update.actor, state),
    seq: update.seq,
    deps: obfuscateOperationIds(update.deps, state),
    ops: new Array<CrdtOperation>(update.ops.length)
  };
  for (let i = 0, length = update.ops.length; i < length; i++) {
    obfuscated.ops[i] = obfuscateOperation(update.ops[i], state);
  }
  if (update.metadata !== undefined) {
    obfuscated.metadata = options && options.preserveMetadata
      ? cloneJson(update.metadata) as JsonObject
      : obfuscateJsonObject(update.metadata, state);
  }
  if (update.metadataEntries !== undefined) {
    obfuscated.metadataEntries = new Array<CrdtCommitMetadataEntry>(update.metadataEntries.length);
    for (let i = 0, length = update.metadataEntries.length; i < length; i++) {
      const entry = update.metadataEntries[i];
      obfuscated.metadataEntries[i] = {
        head: obfuscateOperationId(entry.head, state),
        metadata: options && options.preserveMetadata
          ? cloneJson(entry.metadata) as JsonObject
          : obfuscateJsonObject(entry.metadata, state)
      };
    }
  }
  return options && options.format === 'json'
    ? encodeJsonEnvelopeUpdate(obfuscated)
    : encodeCrdtUpdate(obfuscated);
}

function readCrdtStateVectorSource(input: CrdtUpdateStateVectorInput): CrdtStateVector {
  if (isCrdtStateVector(input)) return cloneStateVector(input);
  return getCrdtUpdateStateVector(input as CrdtUpdateInput | readonly CrdtUpdateInput[]);
}

function isCrdtStateVector(value: CrdtUpdateStateVectorInput): value is CrdtStateVector {
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value) || Array.isArray(value)) return false;
  return !isCrdtUpdateObject(value);
}

function isCrdtUpdateObject(value: object): value is CrdtUpdate {
  return 'ops' in value && Array.isArray((value as CrdtUpdate).ops);
}

function mergeStateVectorInto(target: CrdtStateVector, source: CrdtStateVector): void {
  for (const actor in source) {
    const seq = source[actor];
    if (seq > (target[actor] || 0)) target[actor] = seq;
  }
}

function cloneStateVector(vector: CrdtStateVector): CrdtStateVector {
  const out: CrdtStateVector = {};
  for (const actor in vector) out[actor] = vector[actor];
  return out;
}

function readStateVectorInput(input: CrdtStateVectorInput): CrdtStateVector {
  if (typeof input === 'string') {
    const trimmed = input.trimStart();
    return trimmed.startsWith('{')
      ? readStateVectorJsonValue(JSON.parse(trimmed))
      : readStateVectorJsonBytes(decodeBase64urlBytes(input));
  }
  if (input instanceof ArrayBuffer) return readStateVectorJsonBytes(new Uint8Array(input));
  if (ArrayBuffer.isView(input)) {
    return readStateVectorJsonBytes(new Uint8Array(input.buffer, input.byteOffset, input.byteLength));
  }
  return cloneValidatedStateVector(input);
}

function encodeStateVectorJsonBytes(stateVector: CrdtStateVector): Uint8Array {
  return textEncoder.encode(JSON.stringify(cloneValidatedStateVector(stateVector, true)));
}

function readStateVectorJsonBytes(bytes: Uint8Array): CrdtStateVector {
  return readStateVectorJsonValue(JSON.parse(textDecoder.decode(bytes)));
}

function readStateVectorJsonValue(value: unknown): CrdtStateVector {
  return cloneValidatedStateVector(value, true);
}

function cloneValidatedStateVector(value: unknown, canonical = false): CrdtStateVector {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('CRDT state vector must be an object');
  }
  const source = value as Record<string, unknown>;
  const keys = Object.keys(source);
  if (canonical) keys.sort(compareOperationIds);
  const out: CrdtStateVector = {};
  for (let i = 0, length = keys.length; i < length; i++) {
    const actor = keys[i];
    const seq = source[actor];
    if (actor.length === 0 || typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 0) {
      throw new TypeError('invalid CRDT state vector');
    }
    if (seq !== 0) out[actor] = seq;
  }
  return out;
}

function readCrdtStateVectorFormat(options: CrdtStateVectorConvertOptions | undefined): 'object' | 'json' | 'base64url' {
  const format = options && options.format !== undefined ? options.format : 'json';
  if (format !== 'object' && format !== 'json' && format !== 'base64url') {
    throw new TypeError('invalid CRDT state vector format');
  }
  return format;
}

interface CrdtUpdateFilterState {
  stateVector: CrdtStateVector;
  actors: ReadonlySet<string> | null;
  heads: ReadonlySet<string> | null;
  paths: readonly JsonPath[] | null;
  pathMode: 'subtree' | 'exact';
  operationTypes: ReadonlySet<CrdtOperation['type']> | null;
}

function createUpdateFilterState(options: CrdtUpdateFilterOptions | undefined): CrdtUpdateFilterState {
  const pathMode = options && options.pathMode !== undefined ? options.pathMode : 'subtree';
  if (pathMode !== 'subtree' && pathMode !== 'exact') throw new TypeError('invalid CRDT update path filter mode');
  return {
    stateVector: options && options.stateVector ? options.stateVector : {},
    actors: options && options.actors !== undefined ? new Set(options.actors) : null,
    heads: options && options.heads !== undefined ? new Set(options.heads) : null,
    paths: options && options.paths !== undefined ? options.paths : null,
    pathMode,
    operationTypes: options && options.operationTypes !== undefined ? new Set(options.operationTypes) : null
  };
}

function updateHasOperationsSinceStateVector(update: CrdtUpdate, vector: CrdtStateVector): boolean {
  const ops = update.ops;
  for (let i = 0, length = ops.length; i < length; i++) {
    const op = ops[i];
    if (operationEndSeq(op) > (vector[op.actor] || 0)) return true;
  }
  return false;
}

function appendFilteredOperation(
  target: CrdtOperation[],
  op: CrdtOperation,
  filter: CrdtUpdateFilterState,
  rangesByActor: Map<string, Array<[number, number]>>,
  seenIds: Set<string>
): void {
  const seen = filter.stateVector[op.actor] || 0;
  if (operationEndSeq(op) <= seen) return;
  const candidate = op.seq <= seen && isSpanningOperation(op)
    ? operationSuffix(op, seen + 1)
    : op;
  if (candidate === null || !operationMatchesFilter(candidate, filter)) return;
  appendMissingOperation(target, candidate, rangesByActor, seenIds);
}

function operationMatchesFilter(op: CrdtOperation, filter: CrdtUpdateFilterState): boolean {
  if (filter.actors !== null && !filter.actors.has(op.actor)) return false;
  if (filter.heads !== null && !filter.heads.has(operationHeadId(op))) return false;
  if (filter.operationTypes !== null && !filter.operationTypes.has(op.type)) return false;
  if (filter.paths !== null && !operationPathMatches(op.path, filter.paths, filter.pathMode)) return false;
  return true;
}

function operationPathMatches(
  path: JsonPath,
  filters: readonly JsonPath[],
  mode: 'subtree' | 'exact'
): boolean {
  for (let i = 0, length = filters.length; i < length; i++) {
    const filter = filters[i];
    if (mode === 'exact' ? pathsEqual(path, filter) : pathStartsWith(path, filter)) return true;
  }
  return false;
}

function pathsEqual(left: JsonPath, right: JsonPath): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0, length = left.length; i < length; i++) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

function pathStartsWith(path: JsonPath, prefix: JsonPath): boolean {
  if (prefix.length > path.length) return false;
  for (let i = 0, length = prefix.length; i < length; i++) {
    if (path[i] !== prefix[i]) return false;
  }
  return true;
}

function encodedByteLength(input: CrdtUpdateInput, update: CrdtUpdate): number {
  if (input instanceof ArrayBuffer) return input.byteLength;
  if (ArrayBuffer.isView(input)) return input.byteLength;
  return encodeCrdtUpdate(update).byteLength;
}

function createUpdateInfo(
  actor: CrdtActorId,
  seq: number,
  deps: readonly CrdtOperationId[],
  ops: readonly CrdtOperation[],
  byteLength: number,
  metadata?: JsonObject,
  metadataEntries?: CrdtCommitMetadataEntry[]
): CrdtUpdateInfo {
  const ranges = getActorRangesFromOperationList(ops);
  const info: CrdtUpdateInfo = {
    byteLength,
    actor,
    seq,
    deps: deps.slice(),
    opCount: ops.length,
    logicalOpCount: countLogicalOperations(ops),
    actors: operationActors(ops),
    heads: getHeadsFromOperationList(ops),
    ranges,
    fromStateVector: getFromStateVectorFromActorRanges(ranges),
    toStateVector: getToStateVectorFromActorRanges(ranges),
    stateVector: getStateVectorFromActorRanges(ranges)
  };
  if (metadata !== undefined) info.metadata = cloneJson(metadata) as JsonObject;
  if (metadataEntries !== undefined) info.metadataEntries = cloneMetadataEntries(metadataEntries);
  return info;
}

function createUpdateFromOperations(
  base: CrdtUpdate | null,
  ops: CrdtOperation[],
  metadataByHead?: ReadonlyMap<CrdtOperationId, CrdtCommitMetadataEntry>
): CrdtUpdate {
  if (ops.length === 0) return { actor: base === null ? '' : base.actor, seq: base === null ? 0 : base.seq, deps: [], ops: [] };
  const actor = chooseEnvelopeActor(base, ops);
  const update: CrdtUpdate = {
    actor,
    seq: maxSeqForActor(ops, actor),
    deps: getRootDeps(ops),
    ops
  };
  const entries = collectMetadataEntriesForOperations(base, ops, metadataByHead);
  if (entries.length === 1 && entries[0].head === operationHeadId(ops[ops.length - 1])) {
    update.metadata = cloneJson(entries[0].metadata) as JsonObject;
  } else if (entries.length !== 0) {
    update.metadataEntries = entries;
  }
  return update;
}

function readCrdtUpdateFormat(options: CrdtUpdateConvertOptions | undefined): 'auto' | 'json' | 'object' | 'base64url' {
  const format = options && options.format !== undefined ? options.format : 'auto';
  if (format !== 'auto' && format !== 'json' && format !== 'object' && format !== 'base64url') {
    throw new TypeError('invalid CRDT update format');
  }
  return format;
}

function encodeBase64urlBytes(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  const length = bytes.length;
  for (; i + 2 < length; i += 3) {
    const value = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += BASE64URL_ALPHABET[(value >>> 18) & 63];
    out += BASE64URL_ALPHABET[(value >>> 12) & 63];
    out += BASE64URL_ALPHABET[(value >>> 6) & 63];
    out += BASE64URL_ALPHABET[value & 63];
  }

  const remaining = length - i;
  if (remaining === 1) {
    const value = bytes[i] << 16;
    out += BASE64URL_ALPHABET[(value >>> 18) & 63];
    out += BASE64URL_ALPHABET[(value >>> 12) & 63];
  } else if (remaining === 2) {
    const value = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += BASE64URL_ALPHABET[(value >>> 18) & 63];
    out += BASE64URL_ALPHABET[(value >>> 12) & 63];
    out += BASE64URL_ALPHABET[(value >>> 6) & 63];
  }
  return out;
}

function decodeBase64urlBytes(text: string): Uint8Array {
  if (typeof text !== 'string') throw new TypeError('base64url CRDT update must be a string');
  if (text.indexOf('=') !== -1) throw new TypeError('base64url CRDT update must not use padding');
  if ((text.length & 3) === 1) throw new TypeError('invalid base64url CRDT update length');

  const outputLength = Math.floor((text.length * 6) / 8);
  const bytes = new Uint8Array(outputLength);
  let buffer = 0;
  let bits = 0;
  let offset = 0;

  for (let i = 0, length = text.length; i < length; i++) {
    const code = text.charCodeAt(i);
    const value = code < BASE64URL_DECODE.length ? BASE64URL_DECODE[code] : -1;
    if (value < 0) throw new TypeError('invalid base64url CRDT update character');
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[offset++] = (buffer >>> bits) & 0xff;
    }
  }

  if (offset !== outputLength) throw new TypeError('invalid base64url CRDT update data');
  if (bits > 0 && (buffer & ((1 << bits) - 1)) !== 0) {
    throw new TypeError('invalid base64url CRDT update trailing bits');
  }
  return bytes;
}

function makeBase64UrlDecodeTable(): Int16Array {
  const table = new Int16Array(128);
  table.fill(-1);
  for (let i = 0; i < BASE64URL_ALPHABET.length; i++) {
    table[BASE64URL_ALPHABET.charCodeAt(i)] = i;
  }
  return table;
}

function encodeJsonEnvelopeUpdate(update: CrdtUpdate): Uint8Array {
  return textEncoder.encode(JSON.stringify({
    magic: 'frontier-crdt-update',
    version: 1,
    actor: update.actor,
    seq: update.seq,
    deps: update.deps,
    ops: update.ops,
    metadata: update.metadata,
    metadataEntries: update.metadataEntries
  }));
}

function cloneCrdtUpdate(update: CrdtUpdate): CrdtUpdate {
  const cloned: CrdtUpdate = {
    actor: update.actor,
    seq: update.seq,
    deps: update.deps.slice(),
    ops: new Array<CrdtOperation>(update.ops.length)
  };
  for (let i = 0, length = update.ops.length; i < length; i++) cloned.ops[i] = cloneCrdtOperation(update.ops[i]);
  if (update.metadata !== undefined) cloned.metadata = cloneJson(update.metadata) as JsonObject;
  const metadataEntries = cloneMetadataEntries(update.metadataEntries);
  if (metadataEntries !== undefined) cloned.metadataEntries = metadataEntries;
  return cloned;
}

interface CrdtUpdateObfuscationState {
  actors: Map<string, string>;
  strings: Map<string, string>;
  nextActor: number;
  nextString: number;
}

function createObfuscationState(): CrdtUpdateObfuscationState {
  return {
    actors: new Map(),
    strings: new Map(),
    nextActor: 0,
    nextString: 0
  };
}

function obfuscateOperation(op: CrdtOperation, state: CrdtUpdateObfuscationState): CrdtOperation {
  const base = {
    id: obfuscateOperationId(op.id, state),
    actor: obfuscateActor(op.actor, state),
    seq: op.seq,
    deps: obfuscateOperationIds(op.deps, state),
    path: obfuscatePath(op.path, state)
  };
  switch (op.type) {
    case 'set':
      return { ...base, type: 'set', value: obfuscateJsonValue(op.value, state) };
    case 'del':
      return { ...base, type: 'del' };
    case 'mapSetRun':
      return {
        ...base,
        type: 'mapSetRun',
        keys: op.keys.map((key) => obfuscatePathSegment(key, state) as string),
        values: op.values.map((value) => obfuscateJsonValue(value, state)),
        count: op.count
      };
    case 'counter':
      return { ...base, type: 'counter', delta: 0 };
    case 'binarySet':
      return { ...base, type: 'binarySet', bytes: '' };
    case 'treeCreate':
      return {
        ...base,
        type: 'treeCreate',
        nodeId: obfuscateElementId(op.nodeId, state),
        parent: op.parent === null ? null : obfuscateElementId(op.parent, state),
        after: op.after === null ? null : obfuscateElementId(op.after, state),
        value: obfuscateJsonValue(op.value, state)
      };
    case 'treeMove':
      return {
        ...base,
        type: 'treeMove',
        nodeId: obfuscateElementId(op.nodeId, state),
        parent: op.parent === null ? null : obfuscateElementId(op.parent, state),
        after: op.after === null ? null : obfuscateElementId(op.after, state)
      };
    case 'treeSet':
      return {
        ...base,
        type: 'treeSet',
        nodeId: obfuscateElementId(op.nodeId, state),
        value: obfuscateJsonValue(op.value, state)
      };
    case 'treeDel':
      return { ...base, type: 'treeDel', nodeId: obfuscateElementId(op.nodeId, state) };
    case 'listInsert':
      return {
        ...base,
        type: 'listInsert',
        after: op.after === null ? null : obfuscateElementId(op.after, state),
        values: op.values.map((value) => obfuscateJsonValue(value, state))
      };
    case 'listRun':
      return {
        ...base,
        type: 'listRun',
        after: op.after === null ? null : obfuscateElementId(op.after, state),
        values: op.values.map((value) => obfuscateJsonValue(value, state)),
        count: op.count
      };
    case 'listDel':
      return { ...base, type: 'listDel', elems: op.elems.map((id) => obfuscateElementId(id, state)) };
    case 'textInsert':
      return {
        ...base,
        type: 'textInsert',
        after: op.after === null ? null : obfuscateElementId(op.after, state),
        text: obfuscateText(op.text)
      };
    case 'textRun':
      return {
        ...base,
        type: 'textRun',
        after: op.after === null ? null : obfuscateElementId(op.after, state),
        text: obfuscateText(op.text),
        count: op.count
      };
    case 'textDel':
      return { ...base, type: 'textDel', elems: op.elems.map((id) => obfuscateElementId(id, state)) };
    case 'textDelRange':
      return {
        ...base,
        type: 'textDelRange',
        start: obfuscateElementId(op.start, state),
        count: op.count,
        span: op.span
      };
  }
}

function obfuscateOperationIds(ids: readonly CrdtOperationId[], state: CrdtUpdateObfuscationState): CrdtOperationId[] {
  const out = new Array<CrdtOperationId>(ids.length);
  for (let i = 0, length = ids.length; i < length; i++) out[i] = obfuscateOperationId(ids[i], state);
  return out;
}

function obfuscateOperationId(id: CrdtOperationId, state: CrdtUpdateObfuscationState): CrdtOperationId {
  return obfuscateElementId(id, state);
}

function obfuscateElementId(id: string, state: CrdtUpdateObfuscationState): string {
  const colon = id.indexOf(':');
  if (colon <= 0) return obfuscateString(id, state);
  const actor = id.slice(0, colon);
  const rest = id.slice(colon);
  const seqEnd = rest.indexOf('/');
  const seq = seqEnd === -1 ? rest.slice(1) : rest.slice(1, seqEnd);
  if (!/^[0-9]+$/.test(seq)) return obfuscateString(id, state);
  return obfuscateActor(actor, state) + rest;
}

function obfuscateActor(actor: string, state: CrdtUpdateObfuscationState): string {
  if (actor.length === 0) return '';
  let mapped = state.actors.get(actor);
  if (mapped === undefined) {
    mapped = `actor${state.nextActor++}`;
    state.actors.set(actor, mapped);
  }
  return mapped;
}

function obfuscatePath(path: JsonPath, state: CrdtUpdateObfuscationState): JsonPath {
  const out = new Array(path.length);
  for (let i = 0, length = path.length; i < length; i++) out[i] = obfuscatePathSegment(path[i], state);
  return out;
}

function obfuscatePathSegment(segment: string | number, state: CrdtUpdateObfuscationState): string | number {
  return typeof segment === 'number' ? segment : obfuscateString(segment, state);
}

function obfuscateString(value: string, state: CrdtUpdateObfuscationState): string {
  let mapped = state.strings.get(value);
  if (mapped === undefined) {
    mapped = `k${state.nextString++}`;
    state.strings.set(value, mapped);
  }
  return mapped;
}

function obfuscateJsonObject(value: JsonObject, state: CrdtUpdateObfuscationState): JsonObject {
  return obfuscateJsonValue(value, state) as JsonObject;
}

function obfuscateJsonValue(value: JsonValue, state: CrdtUpdateObfuscationState): JsonValue {
  if (value === null) return null;
  if (typeof value === 'string') return obfuscateText(value);
  if (typeof value === 'number') return 0;
  if (typeof value === 'boolean') return false;
  if (Array.isArray(value)) {
    const out = new Array<JsonValue>(value.length);
    for (let i = 0, length = value.length; i < length; i++) out[i] = obfuscateJsonValue(value[i], state);
    return out;
  }
  const out: JsonObject = {};
  for (const key in value) out[obfuscateString(key, state)] = obfuscateJsonValue(value[key], state);
  return out;
}

function obfuscateText(text: string): string {
  if (text.length === 0) return '';
  return Array.from(text).map((char) => char === '\n' ? '\n' : 'x').join('');
}

function inspectUpdateMetadata(update: CrdtUpdate): JsonObject | undefined {
  if (update.metadata !== undefined) return cloneJson(update.metadata) as JsonObject;
  return update.metadataEntries !== undefined && update.metadataEntries.length === 1
    ? cloneJson(update.metadataEntries[0].metadata) as JsonObject
    : undefined;
}

function collectUpdateMetadata(update: CrdtUpdate, target: Map<CrdtOperationId, CrdtCommitMetadataEntry>): void {
  const metadataHead = updateEnvelopeMetadataHead(update);
  if (metadataHead !== null && update.metadata !== undefined) {
    target.set(metadataHead, { head: metadataHead, metadata: cloneJson(update.metadata) as JsonObject });
  }
  if (update.metadataEntries === undefined) return;
  for (let i = 0, length = update.metadataEntries.length; i < length; i++) {
    const entry = update.metadataEntries[i];
    target.set(entry.head, { head: entry.head, metadata: cloneJson(entry.metadata) as JsonObject });
  }
}

function collectMetadataEntriesForOperations(
  base: CrdtUpdate | null,
  ops: readonly CrdtOperation[],
  metadataByHead?: ReadonlyMap<CrdtOperationId, CrdtCommitMetadataEntry>
): CrdtCommitMetadataEntry[] {
  const operationHeads = new Set<CrdtOperationId>();
  for (let i = 0, length = ops.length; i < length; i++) operationHeads.add(operationHeadId(ops[i]));
  const entriesByHead = new Map<CrdtOperationId, CrdtCommitMetadataEntry>();
  if (base !== null) {
    const metadataHead = updateEnvelopeMetadataHead(base);
    if (metadataHead !== null && base.metadata !== undefined && operationHeads.has(metadataHead)) {
      entriesByHead.set(metadataHead, { head: metadataHead, metadata: cloneJson(base.metadata) as JsonObject });
    }
    if (base.metadataEntries !== undefined) {
      for (let i = 0, length = base.metadataEntries.length; i < length; i++) {
        const entry = base.metadataEntries[i];
        if (operationHeads.has(entry.head)) {
          entriesByHead.set(entry.head, { head: entry.head, metadata: cloneJson(entry.metadata) as JsonObject });
        }
      }
    }
  }
  if (metadataByHead !== undefined) {
    metadataByHead.forEach((entry, head) => {
      if (operationHeads.has(head)) entriesByHead.set(head, { head, metadata: cloneJson(entry.metadata) as JsonObject });
    });
  }
  return Array.from(entriesByHead.values()).sort((left, right) => compareOperationIds(left.head, right.head));
}

function updateEnvelopeMetadataHead(update: CrdtUpdate): CrdtOperationId | null {
  return update.ops.length === 0 ? null : operationHeadId(update.ops[update.ops.length - 1]);
}

function cloneMetadataEntries(
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

function chooseEnvelopeActor(base: CrdtUpdate | null, ops: readonly CrdtOperation[]): CrdtActorId {
  if (base !== null && base.actor.length !== 0) return base.actor;
  return ops.length === 0 ? '' : ops[0].actor;
}

function maxSeqForActor(ops: readonly CrdtOperation[], actor: CrdtActorId): number {
  let max = 0;
  for (let i = 0, length = ops.length; i < length; i++) {
    if (ops[i].actor !== actor) continue;
    const end = operationEndSeq(ops[i]);
    if (end > max) max = end;
  }
  return max;
}

function getRootDeps(ops: readonly CrdtOperation[]): CrdtOperationId[] {
  if (ops.length === 0) return [];
  const operationHeads = new Set<string>();
  for (let i = 0, length = ops.length; i < length; i++) operationHeads.add(operationHeadId(ops[i]));
  const deps = new Set<string>();
  for (let i = 0, length = ops.length; i < length; i++) {
    const opDeps = ops[i].deps;
    for (let j = 0, depCount = opDeps.length; j < depCount; j++) {
      if (!operationHeads.has(opDeps[j])) deps.add(opDeps[j]);
    }
  }
  return sortedStringSet(deps);
}

function appendMissingOperation(
  target: CrdtOperation[],
  op: CrdtOperation,
  rangesByActor: Map<string, Array<[number, number]>>,
  seenIds: Set<string>
): void {
  const ranges = getActorRanges(rangesByActor, op.actor);
  const start = op.seq;
  const end = operationEndSeq(op);
  if (actorSeqRangesCover(ranges, start, end)) return;

  if (!actorSeqRangesOverlap(ranges, start, end)) {
    target[target.length] = cloneCrdtOperation(op);
    addActorSeqRange(ranges, start, end);
    seenIds.add(operationHeadId(op));
    return;
  }

  if (!isSpanningOperation(op)) {
    const id = operationHeadId(op);
    if (seenIds.has(id)) return;
    target[target.length] = cloneCrdtOperation(op);
    addActorSeqRange(ranges, start, end);
    seenIds.add(id);
    return;
  }

  const expanded = expandSpanningOperation(op);
  for (let i = 0, length = expanded.length; i < length; i++) {
    appendMissingOperation(target, expanded[i], rangesByActor, seenIds);
  }
}

function getActorRanges(rangesByActor: Map<string, Array<[number, number]>>, actor: CrdtActorId): Array<[number, number]> {
  let ranges = rangesByActor.get(actor);
  if (ranges === undefined) {
    ranges = [];
    rangesByActor.set(actor, ranges);
  }
  return ranges;
}

function getOperationsSinceStateVectorFromList(
  ops: readonly CrdtOperation[],
  vector: CrdtStateVector
): CrdtOperation[] {
  const sorted = ops.slice();
  sortOperationsIfNeeded(sorted);
  const result: CrdtOperation[] = [];
  for (let i = 0, length = sorted.length; i < length; i++) {
    const op = sorted[i];
    const seen = vector[op.actor] || 0;
    if (operationEndSeq(op) <= seen) continue;
    if (op.seq > seen) {
      result[result.length] = cloneCrdtOperation(op);
    } else if (isSpanningOperation(op)) {
      const suffix = operationSuffix(op, seen + 1);
      if (suffix !== null) result[result.length] = suffix;
    }
  }
  return result;
}

function getStateVectorFromOperationList(ops: readonly CrdtOperation[]): CrdtStateVector {
  return getStateVectorFromActorRanges(getActorRangesFromOperationList(ops));
}

function getActorRangesFromOperationList(ops: readonly CrdtOperation[]): CrdtUpdateActorRange[] {
  const rangesByActor = new Map<string, Array<[number, number]>>();
  for (let i = 0, length = ops.length; i < length; i++) {
    addActorSeqRange(getActorRanges(rangesByActor, ops[i].actor), ops[i].seq, operationEndSeq(ops[i]));
  }
  const ranges: CrdtUpdateActorRange[] = [];
  rangesByActor.forEach((actorRanges, actor) => {
    for (let i = 0, length = actorRanges.length; i < length; i++) {
      ranges[ranges.length] = {
        actor,
        start: actorRanges[i][0],
        end: actorRanges[i][1]
      };
    }
  });
  ranges.sort((left, right) => compareOperationIds(`${left.actor}:${left.start}`, `${right.actor}:${right.start}`));
  return ranges;
}

function getFromStateVectorFromActorRanges(ranges: readonly CrdtUpdateActorRange[]): CrdtStateVector {
  const vector: CrdtStateVector = {};
  for (let i = 0, length = ranges.length; i < length; i++) {
    const previous = ranges[i].start - 1;
    if (previous <= 0) continue;
    const current = vector[ranges[i].actor];
    if (current === undefined || previous < current) vector[ranges[i].actor] = previous;
  }
  return vector;
}

function getToStateVectorFromActorRanges(ranges: readonly CrdtUpdateActorRange[]): CrdtStateVector {
  const vector: CrdtStateVector = {};
  for (let i = 0, length = ranges.length; i < length; i++) {
    const range = ranges[i];
    if (range.end > (vector[range.actor] || 0)) vector[range.actor] = range.end;
  }
  return vector;
}

function getStateVectorFromActorRanges(ranges: readonly CrdtUpdateActorRange[]): CrdtStateVector {
  const rangesByActor = new Map<string, CrdtUpdateActorRange[]>();
  for (let i = 0, length = ranges.length; i < length; i++) {
    const range = ranges[i];
    let actorRanges = rangesByActor.get(range.actor);
    if (actorRanges === undefined) {
      actorRanges = [];
      rangesByActor.set(range.actor, actorRanges);
    }
    actorRanges[actorRanges.length] = range;
  }
  const vector: CrdtStateVector = {};
  rangesByActor.forEach((actorRanges, actor) => {
    let seq = 0;
    actorRanges.sort((left, right) => left.start - right.start || left.end - right.end);
    for (let i = 0, length = actorRanges.length; i < length; i++) {
      const range = actorRanges[i];
      if (range.start > seq + 1) break;
      if (range.end > seq) seq = range.end;
    }
    if (seq !== 0) vector[actor] = seq;
  });
  return vector;
}

function getHeadsFromOperationList(ops: readonly CrdtOperation[]): CrdtOperationId[] {
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

function operationActors(ops: readonly CrdtOperation[]): CrdtActorId[] {
  const actors = new Set<string>();
  for (let i = 0, length = ops.length; i < length; i++) actors.add(ops[i].actor);
  return sortedStringSet(actors);
}

function countLogicalOperations(ops: readonly CrdtOperation[]): number {
  let count = 0;
  for (let i = 0, length = ops.length; i < length; i++) count += operationSeqSpan(ops[i]);
  return count;
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

function isSpanningOperation(op: CrdtOperation): op is Extract<CrdtOperation, { type: 'textRun' | 'listRun' | 'mapSetRun' }> {
  return op.type === 'textRun' || op.type === 'listRun' || op.type === 'mapSetRun';
}

function operationSuffix(op: Extract<CrdtOperation, { type: 'textRun' | 'listRun' | 'mapSetRun' }>, startSeq: number): CrdtOperation | null {
  if (op.type === 'textRun') return textRunSuffix(op, startSeq);
  if (op.type === 'listRun') return listRunSuffix(op, startSeq);
  return mapSetRunSuffix(op, startSeq);
}

function textRunSuffix(op: Extract<CrdtOperation, { type: 'textRun' }>, startSeq: number): CrdtOperation | null {
  const endSeq = operationEndSeq(op);
  if (startSeq > endSeq) return null;
  const offset = startSeq - op.seq;
  if (offset <= 0) return cloneCrdtOperation(op);
  const chars = Array.from(op.text);
  const text = chars.slice(offset).join('');
  const count = endSeq - startSeq + 1;
  const deps = [`${op.actor}:${startSeq - 1}`];
  const id = `${op.actor}:${startSeq}`;
  return count === 1
    ? { type: 'textInsert', id, actor: op.actor, seq: startSeq, deps, path: op.path.slice(), after: `${op.actor}:${startSeq - 1}/0`, text }
    : { type: 'textRun', id, actor: op.actor, seq: startSeq, deps, path: op.path.slice(), after: `${op.actor}:${startSeq - 1}/0`, text, count };
}

function listRunSuffix(op: Extract<CrdtOperation, { type: 'listRun' }>, startSeq: number): CrdtOperation | null {
  const endSeq = operationEndSeq(op);
  if (startSeq > endSeq) return null;
  const offset = startSeq - op.seq;
  if (offset <= 0) return cloneCrdtOperation(op);
  const values = op.values.slice(offset);
  const count = endSeq - startSeq + 1;
  const deps = [`${op.actor}:${startSeq - 1}`];
  const id = `${op.actor}:${startSeq}`;
  return count === 1
    ? { type: 'listInsert', id, actor: op.actor, seq: startSeq, deps, path: op.path.slice(), after: `${op.actor}:${startSeq - 1}/0`, values }
    : { type: 'listRun', id, actor: op.actor, seq: startSeq, deps, path: op.path.slice(), after: `${op.actor}:${startSeq - 1}/0`, values, count };
}

function mapSetRunSuffix(op: Extract<CrdtOperation, { type: 'mapSetRun' }>, startSeq: number): CrdtOperation | null {
  const endSeq = operationEndSeq(op);
  if (startSeq > endSeq) return null;
  const offset = startSeq - op.seq;
  if (offset <= 0) return cloneCrdtOperation(op);
  const keys = op.keys.slice(offset);
  const values = op.values.slice(offset);
  const count = endSeq - startSeq + 1;
  const deps = [`${op.actor}:${startSeq - 1}`];
  const id = `${op.actor}:${startSeq}`;
  return count === 1
    ? { type: 'set', id, actor: op.actor, seq: startSeq, deps, path: op.path.concat(keys[0]), value: cloneJson(values[0]) }
    : { type: 'mapSetRun', id, actor: op.actor, seq: startSeq, deps, path: op.path.slice(), keys, values: cloneJson(values as unknown as JsonValue) as unknown as JsonValue[], count };
}

function expandSpanningOperation(op: Extract<CrdtOperation, { type: 'textRun' | 'listRun' | 'mapSetRun' }>): CrdtOperation[] {
  if (op.type === 'textRun') return expandTextRunOperation(op);
  if (op.type === 'listRun') return expandListRunOperation(op);
  return expandMapSetRunOperation(op);
}

function expandTextRunOperation(op: Extract<CrdtOperation, { type: 'textRun' }>): CrdtOperation[] {
  const chars = Array.from(op.text);
  const ops = new Array<CrdtOperation>(chars.length);
  for (let i = 0, length = chars.length; i < length; i++) {
    const seq = op.seq + i;
    const id = `${op.actor}:${seq}`;
    ops[i] = {
      type: 'textInsert',
      id,
      actor: op.actor,
      seq,
      deps: i === 0 ? op.deps.slice() : [`${op.actor}:${seq - 1}`],
      path: op.path.slice(),
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
      deps: i === 0 ? op.deps.slice() : [`${op.actor}:${seq - 1}`],
      path: op.path.slice(),
      after: i === 0 ? op.after : `${op.actor}:${seq - 1}/0`,
      values: [cloneJson(op.values[i])]
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
      deps: i === 0 ? op.deps.slice() : [`${op.actor}:${seq - 1}`],
      path: op.path.concat(op.keys[i]),
      value: cloneJson(op.values[i])
    };
  }
  return ops;
}

function cloneCrdtOperation(op: CrdtOperation): CrdtOperation {
  return cloneJson(op as unknown as JsonValue) as unknown as CrdtOperation;
}

function compareOperations(left: CrdtOperation, right: CrdtOperation): number {
  return compareOperationIds(operationHeadId(left), operationHeadId(right));
}

function compareOperationIds(left: string, right: string): number {
  const leftIndex = left.lastIndexOf(':');
  const rightIndex = right.lastIndexOf(':');
  if (leftIndex === -1 || rightIndex === -1) return left < right ? -1 : left > right ? 1 : 0;
  const leftActor = left.slice(0, leftIndex);
  const rightActor = right.slice(0, rightIndex);
  if (leftActor < rightActor) return -1;
  if (leftActor > rightActor) return 1;
  const leftSeq = Number(left.slice(leftIndex + 1));
  const rightSeq = Number(right.slice(rightIndex + 1));
  return leftSeq - rightSeq;
}

function sortOperationsIfNeeded(ops: CrdtOperation[]): void {
  for (let i = 1, length = ops.length; i < length; i++) {
    if (compareOperations(ops[i - 1], ops[i]) > 0) {
      ops.sort(compareOperations);
      return;
    }
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

function actorSeqRangesCover(ranges: Array<[number, number]>, start: number, end: number): boolean {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const range = ranges[mid];
    if (start < range[0]) {
      high = mid - 1;
    } else if (start > range[1]) {
      low = mid + 1;
    } else {
      return end <= range[1];
    }
  }
  return false;
}

function actorSeqRangesOverlap(ranges: Array<[number, number]>, start: number, end: number): boolean {
  if (ranges.length === 0) return false;
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

function sortedStringSet(values: Set<string>): string[] {
  const out: string[] = [];
  values.forEach((value) => {
    out[out.length] = value;
  });
  out.sort(compareOperationIds);
  return out;
}
