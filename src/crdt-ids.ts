export type OperationIdParts = {
  actor: string;
  seq: number;
};

export type TextElementIdParts = {
  opId: string;
  actor: string;
  seq: number;
  index: number;
};

export function parseOperationId(id: string): OperationIdParts {
  const index = id.lastIndexOf(':');
  if (index <= 0) throw new TypeError('invalid CRDT op id');
  const actor = id.slice(0, index);
  const seq = Number(id.slice(index + 1));
  if (actor.length === 0 || !Number.isSafeInteger(seq) || seq <= 0) {
    throw new TypeError('invalid CRDT op id');
  }
  return { actor, seq };
}

export function tryParseOperationId(id: string): OperationIdParts | null {
  const index = id.lastIndexOf(':');
  if (index <= 0) return null;
  const actor = id.slice(0, index);
  const seq = Number(id.slice(index + 1));
  if (actor.length === 0 || !Number.isSafeInteger(seq) || seq <= 0) return null;
  return { actor, seq };
}

export function parseTextElementId(id: string): TextElementIdParts | null {
  const slash = id.lastIndexOf('/');
  if (slash <= 0 || slash === id.length - 1) return null;
  const index = Number(id.slice(slash + 1));
  if (!Number.isSafeInteger(index) || index < 0) return null;
  const opId = id.slice(0, slash);
  const parsed = tryParseOperationId(opId);
  if (parsed === null) return null;
  return { opId, actor: parsed.actor, seq: parsed.seq, index };
}

export function operationIdMatchesActorSeq(id: string, actor: string, seq: number): boolean {
  const actorLength = actor.length;
  return id.length > actorLength + 1 &&
    id.charCodeAt(actorLength) === 58 &&
    id.startsWith(actor) &&
    parseCanonicalUnsignedInteger(id, actorLength + 1, id.length) === seq;
}

export function textElementIdMatchesActorSeqZero(id: string, actor: string, seq: number): boolean {
  const actorLength = actor.length;
  if (
    id.length <= actorLength + 3 ||
    id.charCodeAt(actorLength) !== 58 ||
    !id.startsWith(actor)
  ) {
    return false;
  }
  const slash = id.indexOf('/', actorLength + 1);
  return slash !== -1 &&
    id.length === slash + 2 &&
    id.charCodeAt(slash + 1) === 48 &&
    parseCanonicalUnsignedInteger(id, actorLength + 1, slash) === seq;
}

export function textElementIdMatchesRange(
  id: string,
  parsedStart: TextElementIdParts,
  offset: number,
  span: 'index' | 'seq'
): boolean {
  return span === 'index'
    ? textElementIdMatchesOpIndex(id, parsedStart.opId, parsedStart.index + offset)
    : textElementIdMatchesActorSeqZero(id, parsedStart.actor, parsedStart.seq + offset);
}

function textElementIdMatchesOpIndex(id: string, opId: string, index: number): boolean {
  const prefixLength = opId.length;
  return id.length > prefixLength + 1 &&
    id.charCodeAt(prefixLength) === 47 &&
    id.startsWith(opId) &&
    parseCanonicalUnsignedInteger(id, prefixLength + 1, id.length) === index;
}

function parseCanonicalUnsignedInteger(value: string, start: number, end: number): number {
  if (start >= end) return -1;
  if (value.charCodeAt(start) === 48) return end === start + 1 ? 0 : -1;
  let number = 0;
  for (let i = start; i < end; i++) {
    const digit = value.charCodeAt(i) - 48;
    if (digit < 0 || digit > 9) return -1;
    number = (number * 10) + digit;
    if (!Number.isSafeInteger(number)) return -1;
  }
  return number;
}
