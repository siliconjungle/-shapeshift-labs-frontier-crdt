import { cloneJson } from '@shapeshift-labs/frontier/clone';
import type {
  CrdtActorId,
  CrdtAwareness,
  CrdtAwarenessOptions,
  CrdtPresenceState,
  CrdtPresenceUpdate,
  CrdtPresenceUpdateInput,
  JsonObject
} from './types.js';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function createCrdtAwareness(options?: CrdtAwarenessOptions): CrdtAwareness {
  return new FrontierCrdtAwareness(options);
}

export function encodeCrdtPresenceUpdate(update: CrdtPresenceUpdate): Uint8Array {
  validatePresenceUpdate(update);
  return textEncoder.encode(JSON.stringify(update));
}

export function encodeCrdtPresenceUpdates(updates: readonly CrdtPresenceUpdate[]): Uint8Array {
  const encoded = new Array<CrdtPresenceUpdate>(updates.length);
  for (let i = 0, length = updates.length; i < length; i++) {
    validatePresenceUpdate(updates[i]);
    encoded[i] = clonePresenceUpdate(updates[i]);
  }
  return textEncoder.encode(JSON.stringify(encoded));
}

export function decodeCrdtPresenceUpdate(update: ArrayBuffer | ArrayBufferView | string | CrdtPresenceUpdate): CrdtPresenceUpdate {
  if (isPresenceUpdate(update)) {
    validatePresenceUpdate(update);
    return clonePresenceUpdate(update);
  }
  const text = typeof update === 'string'
    ? update
    : textDecoder.decode(toUint8Array(update as ArrayBuffer | ArrayBufferView));
  const parsed = JSON.parse(text) as unknown;
  if (!isPresenceUpdate(parsed)) throw new TypeError('invalid CRDT presence update');
  validatePresenceUpdate(parsed);
  return clonePresenceUpdate(parsed);
}

export function decodeCrdtPresenceUpdates(update: CrdtPresenceUpdateInput): CrdtPresenceUpdate[] {
  if (Array.isArray(update)) {
    const decoded = new Array<CrdtPresenceUpdate>(update.length);
    for (let i = 0, length = update.length; i < length; i++) {
      if (!isPresenceUpdate(update[i])) throw new TypeError('invalid CRDT presence update');
      validatePresenceUpdate(update[i]);
      decoded[i] = clonePresenceUpdate(update[i]);
    }
    return decoded;
  }
  if (isPresenceUpdate(update)) return [decodeCrdtPresenceUpdate(update)];
  const text = typeof update === 'string'
    ? update
    : textDecoder.decode(toUint8Array(update as ArrayBuffer | ArrayBufferView));
  const parsed = JSON.parse(text) as unknown;
  if (Array.isArray(parsed)) {
    const decoded = new Array<CrdtPresenceUpdate>(parsed.length);
    for (let i = 0, length = parsed.length; i < length; i++) {
      if (!isPresenceUpdate(parsed[i])) throw new TypeError('invalid CRDT presence update');
      validatePresenceUpdate(parsed[i]);
      decoded[i] = clonePresenceUpdate(parsed[i]);
    }
    return decoded;
  }
  if (!isPresenceUpdate(parsed)) throw new TypeError('invalid CRDT presence update');
  validatePresenceUpdate(parsed);
  return [clonePresenceUpdate(parsed)];
}

export type {
  CrdtAwareness,
  CrdtAwarenessOptions,
  CrdtPresenceState,
  CrdtPresenceUpdate,
  CrdtPresenceUpdateInput
} from './types.js';

class FrontierCrdtAwareness implements CrdtAwareness {
  readonly actorId: CrdtActorId;
  private clock = 0;
  private local: CrdtPresenceState | null = null;
  private readonly clocks = new Map<CrdtActorId, number>();
  private readonly states = new Map<CrdtActorId, CrdtPresenceState>();

  constructor(options?: CrdtAwarenessOptions) {
    this.actorId = options && options.actorId ? options.actorId : createPresenceActorId();
    if (this.actorId.length === 0) throw new TypeError('actorId must be non-empty');
  }

  getLocalState(): CrdtPresenceState | null {
    return this.local === null ? null : clonePresenceState(this.local);
  }

  setLocalState(value: JsonObject | null): CrdtPresenceUpdate {
    const update: CrdtPresenceUpdate = {
      actorId: this.actorId,
      clock: ++this.clock,
      value: value === null ? null : cloneJson(value)
    };
    const state = update.value === null
      ? null
      : { actorId: update.actorId, clock: update.clock, value: cloneJson(update.value) };
    this.local = state;
    this.clocks.set(this.actorId, update.clock);
    if (state === null) this.states.delete(this.actorId);
    else this.states.set(this.actorId, state);
    return {
      actorId: update.actorId,
      clock: update.clock,
      value: update.value === null ? null : cloneJson(update.value)
    };
  }

  clearLocalState(): CrdtPresenceUpdate {
    return this.setLocalState(null);
  }

  applyUpdate(update: ArrayBuffer | ArrayBufferView | string | CrdtPresenceUpdate): CrdtPresenceState | null {
    const decoded = decodeCrdtPresenceUpdate(update);
    return this.applyDecodedUpdate(decoded);
  }

  applyUpdates(update: CrdtPresenceUpdateInput): Array<CrdtPresenceState | null> {
    const decoded = decodeCrdtPresenceUpdates(update);
    const states = new Array<CrdtPresenceState | null>(decoded.length);
    for (let i = 0, length = decoded.length; i < length; i++) states[i] = this.applyDecodedUpdate(decoded[i]);
    return states;
  }

  private applyDecodedUpdate(decoded: CrdtPresenceUpdate): CrdtPresenceState | null {
    const knownClock = this.clocks.get(decoded.actorId) || 0;
    const current = this.states.get(decoded.actorId);
    if (knownClock >= decoded.clock) return current === undefined ? null : clonePresenceState(current);
    this.clocks.set(decoded.actorId, decoded.clock);
    if (decoded.value === null) {
      this.states.delete(decoded.actorId);
      if (decoded.actorId === this.actorId) this.local = null;
      return null;
    }
    const state: CrdtPresenceState = {
      actorId: decoded.actorId,
      clock: decoded.clock,
      value: cloneJson(decoded.value)
    };
    this.states.set(decoded.actorId, state);
    if (decoded.actorId === this.actorId) {
      this.clock = Math.max(this.clock, decoded.clock);
      this.local = state;
    }
    return clonePresenceState(state);
  }

  get(actorId: CrdtActorId): CrdtPresenceState | null {
    const state = this.states.get(actorId);
    return state === undefined ? null : clonePresenceState(state);
  }

  getStates(): CrdtPresenceState[] {
    const states: CrdtPresenceState[] = [];
    this.states.forEach((state) => {
      states[states.length] = clonePresenceState(state);
    });
    states.sort((left, right) => left.actorId < right.actorId ? -1 : left.actorId > right.actorId ? 1 : 0);
    return states;
  }

  encodeUpdate(update: CrdtPresenceUpdate): Uint8Array {
    return encodeCrdtPresenceUpdate(update);
  }

  encodeStates(actorIds?: readonly CrdtActorId[]): Uint8Array {
    const updates: CrdtPresenceUpdate[] = [];
    if (actorIds === undefined) {
      this.states.forEach((state) => {
        updates[updates.length] = { actorId: state.actorId, clock: state.clock, value: cloneJson(state.value) };
      });
    } else {
      for (let i = 0, length = actorIds.length; i < length; i++) {
        const state = this.states.get(actorIds[i]);
        if (state !== undefined) {
          updates[updates.length] = { actorId: state.actorId, clock: state.clock, value: cloneJson(state.value) };
        }
      }
    }
    updates.sort((left, right) => left.actorId < right.actorId ? -1 : left.actorId > right.actorId ? 1 : 0);
    return encodeCrdtPresenceUpdates(updates);
  }
}

function clonePresenceUpdate(update: CrdtPresenceUpdate): CrdtPresenceUpdate {
  return {
    actorId: update.actorId,
    clock: update.clock,
    value: update.value === null ? null : cloneJson(update.value)
  };
}

function clonePresenceState(state: CrdtPresenceState): CrdtPresenceState {
  return {
    actorId: state.actorId,
    clock: state.clock,
    value: state.value === null ? null : cloneJson(state.value)
  };
}

function isPresenceUpdate(value: unknown): value is CrdtPresenceUpdate {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as CrdtPresenceUpdate).actorId === 'string' &&
    Number.isSafeInteger((value as CrdtPresenceUpdate).clock) &&
    ((value as CrdtPresenceUpdate).value === null || isPlainObject((value as CrdtPresenceUpdate).value))
  );
}

function validatePresenceUpdate(update: CrdtPresenceUpdate): void {
  if (update.actorId.length === 0) throw new TypeError('presence actorId must be non-empty');
  if (!Number.isSafeInteger(update.clock) || update.clock < 0) throw new TypeError('presence clock must be a non-negative safe integer');
  if (update.value !== null && !isPlainObject(update.value)) throw new TypeError('presence value must be an object or null');
}

function isPlainObject(value: unknown): value is JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function toUint8Array(value: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return new Uint8Array(value);
}

function createPresenceActorId(): string {
  return 'presence-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
