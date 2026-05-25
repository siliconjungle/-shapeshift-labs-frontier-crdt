import { parseTextElementId, textElementIdMatchesRange, type TextElementIdParts } from './crdt-ids.js';
import { VisiblePositionIndex } from './crdt-text-value.js';
import type { CrdtOperation } from './types.js';

const CRDT_TEXT_PROFILE_DEFAULT_ROUTE_INDEX_THRESHOLD = 4096;

type TextDeleteRangePayload = {
  start: string;
  count: number;
  span: 'index' | 'seq';
};

type NativeTextPiece = {
  actor: string;
  seq: number;
  index: number;
  length: number;
  span: 'index' | 'seq';
};

export class NativeTextPieceSequence {
  private static readonly defaultIndexedPieceThreshold = CRDT_TEXT_PROFILE_DEFAULT_ROUTE_INDEX_THRESHOLD;
  private readonly pieces: NativeTextPiece[] = [];
  private positionIndex: VisiblePositionIndex | null = null;
  private indexedPieceThreshold = NativeTextPieceSequence.defaultIndexedPieceThreshold;
  length = 0;

  static fromArray(values: string[]): NativeTextPieceSequence | null {
    const sequence = new NativeTextPieceSequence();
    for (let i = 0, length = values.length; i < length;) {
      const parsed = parseTextElementId(values[i]);
      if (parsed === null) return null;
      let span: 'index' | 'seq' = 'index';
      let count = 1;
      const next = i + 1 < length ? parseTextElementId(values[i + 1]) : null;
      if (
        next !== null &&
        next.actor === parsed.actor &&
        next.seq === parsed.seq &&
        next.index === parsed.index + 1
      ) {
        span = 'index';
        count = 2;
        while (i + count < length) {
          const current = parseTextElementId(values[i + count]);
          if (
            current === null ||
            current.actor !== parsed.actor ||
            current.seq !== parsed.seq ||
            current.index !== parsed.index + count
          ) {
            break;
          }
          count++;
        }
      } else if (
        parsed.index === 0 &&
        next !== null &&
        next.actor === parsed.actor &&
        next.seq === parsed.seq + 1 &&
        next.index === 0
      ) {
        span = 'seq';
        count = 2;
        while (i + count < length) {
          const current = parseTextElementId(values[i + count]);
          if (
            current === null ||
            current.actor !== parsed.actor ||
            current.seq !== parsed.seq + count ||
            current.index !== 0
          ) {
            break;
          }
          count++;
        }
      } else if (parsed.index === 0) {
        span = 'seq';
      }
      const piece: NativeTextPiece = {
        actor: parsed.actor,
        seq: parsed.seq,
        index: parsed.index,
        length: count,
        span
      };
      sequence.appendPiece(piece);
      sequence.length += count;
      i += count;
    }
    return sequence;
  }

  at(index: number): string | null {
    if (index < 0 || index >= this.length) return null;
    const found = this.find(index);
    return nativeTextPieceElementId(this.pieces[found.piece], found.offset);
  }

  tail(): string | null {
    return this.length === 0 ? null : this.at(this.length - 1);
  }

  clone(): NativeTextPieceSequence {
    const sequence = new NativeTextPieceSequence();
    for (let i = 0, length = this.pieces.length; i < length; i++) {
      const piece = this.pieces[i];
      sequence.pieces[i] = {
        actor: piece.actor,
        seq: piece.seq,
        index: piece.index,
        length: piece.length,
        span: piece.span
      };
    }
    sequence.length = this.length;
    sequence.indexedPieceThreshold = this.indexedPieceThreshold;
    if (this.positionIndex !== null) sequence.positionIndex = this.positionIndex.clone();
    return sequence;
  }

  setPositionIndexThreshold(threshold: number): void {
    if (!Number.isSafeInteger(threshold) || threshold < 1) return;
    this.indexedPieceThreshold = threshold;
    if (this.pieces.length < threshold) this.positionIndex = null;
  }

  indexOf(value: string): number {
    const parsed = parseTextElementId(value);
    if (parsed === null) return -1;
    if (this.length === 0) return -1;
    const last = this.pieces[this.pieces.length - 1];
    if (last !== undefined && nativeTextPieceOffsetMatches(last, parsed, last.length - 1)) {
      return this.length - 1;
    }
    let start = 0;
    for (let i = 0, length = this.pieces.length; i < length; i++) {
      const piece = this.pieces[i];
      if (piece.actor !== parsed.actor) {
        start += piece.length;
        continue;
      }
      if (piece.span === 'seq') {
        if (parsed.index === 0 && parsed.seq >= piece.seq && parsed.seq < piece.seq + piece.length) {
          return start + parsed.seq - piece.seq;
        }
      } else if (parsed.seq === piece.seq && parsed.index >= piece.index && parsed.index < piece.index + piece.length) {
        return start + parsed.index - piece.index;
      }
      start += piece.length;
    }
    return -1;
  }

  insertCreated(index: number, op: CrdtOperation, count: number): void {
    if (count <= 0) return;
    const piece: NativeTextPiece = {
      actor: op.actor,
      seq: op.seq,
      index: 0,
      length: count,
      span: op.type === 'textRun' || op.type === 'listRun' ? 'seq' : 'index'
    };
    this.insertPiece(index, piece);
  }

  delete(index: number, count: number): void {
    if (count <= 0 || index >= this.length) return;
    let remaining = Math.min(count, this.length - index);
    let found = this.find(index);
    while (remaining > 0 && found.piece < this.pieces.length) {
      const piece = this.pieces[found.piece];
      const take = Math.min(remaining, piece.length - found.offset);
      if (take === piece.length) {
        this.pieces.splice(found.piece, 1);
        this.replaceIndexedPieces(found.piece, 1, []);
      } else if (found.offset === 0) {
        piece.seq += piece.span === 'seq' ? take : 0;
        piece.index += piece.span === 'index' ? take : 0;
        piece.length -= take;
        this.adjustIndexedPiece(found.piece, -take);
        found.piece++;
      } else if (found.offset + take === piece.length) {
        piece.length = found.offset;
        this.adjustIndexedPiece(found.piece, -take);
        found.piece++;
      } else {
        const right: NativeTextPiece = {
          actor: piece.actor,
          seq: piece.span === 'seq' ? piece.seq + found.offset + take : piece.seq,
          index: piece.span === 'index' ? piece.index + found.offset + take : 0,
          length: piece.length - found.offset - take,
          span: piece.span
        };
        piece.length = found.offset;
        this.pieces.splice(found.piece + 1, 0, right);
        this.replaceIndexedPieces(found.piece, 1, [piece.length, right.length]);
        found.piece += 2;
      }
      remaining -= take;
      this.length -= take;
      found.offset = 0;
    }
    this.mergeAround(Math.max(0, found.piece - 1));
  }

  textDeleteRangePayload(index: number, count: number): TextDeleteRangePayload | null {
    if (count <= 1 || index < 0 || index >= this.length) return null;
    const actualCount = Math.min(count, this.length - index);
    if (actualCount <= 1) return null;
    const found = this.find(index);
    const first = this.pieces[found.piece];
    if (this.rangeMatchesPiece(found.piece, found.offset, actualCount, first, 'index')) {
      return { start: nativeTextPieceElementId(first, found.offset), count: actualCount, span: 'index' };
    }
    const firstIndex = first.span === 'seq' ? 0 : first.index + found.offset;
    if (firstIndex !== 0) return null;
    return this.rangeMatchesPiece(found.piece, found.offset, actualCount, first, 'seq')
      ? { start: nativeTextPieceElementId(first, found.offset), count: actualCount, span: 'seq' }
      : null;
  }

  textDeleteRangeEquals(index: number, op: Extract<CrdtOperation, { type: 'textDelRange' }>): boolean {
    if (op.count <= 0 || index < 0 || index + op.count > this.length) return false;
    const parsed = parseTextElementId(op.start);
    return parsed === null ? false : this.rangeMatchesParsed(index, op.count, parsed, op.span);
  }

  slice(index: number, count: number): string[] {
    if (count <= 0 || index >= this.length) return [];
    const actualCount = Math.min(count, this.length - index);
    const out = new Array<string>(actualCount);
    let written = 0;
    let remaining = actualCount;
    let found = this.find(index);
    while (remaining > 0 && found.piece < this.pieces.length) {
      const piece = this.pieces[found.piece];
      const take = Math.min(remaining, piece.length - found.offset);
      for (let i = 0; i < take; i++) out[written + i] = nativeTextPieceElementId(piece, found.offset + i);
      written += take;
      remaining -= take;
      found = { piece: found.piece + 1, offset: 0, start: found.start + piece.length - found.offset };
    }
    if (written === out.length) return out;
    out.length = written;
    return out;
  }

  deleteSlice(index: number, count: number): string[] {
    const deleted = this.slice(index, count);
    if (deleted.length !== 0) this.delete(index, deleted.length);
    return deleted;
  }

  toArray(): string[] {
    return this.slice(0, this.length);
  }

  private insertPiece(index: number, piece: NativeTextPiece): void {
    if (piece.length <= 0) return;
    if (index >= this.length) {
      this.appendPiece(piece);
      this.length += piece.length;
      return;
    }
    const found = this.find(index);
    const current = this.pieces[found.piece];
    if (found.offset === 0) {
      this.pieces.splice(found.piece, 0, piece);
      this.replaceIndexedPieces(found.piece, 0, [piece.length]);
      this.length += piece.length;
      this.mergeAround(found.piece);
      return;
    }
    const right: NativeTextPiece = {
      actor: current.actor,
      seq: current.span === 'seq' ? current.seq + found.offset : current.seq,
      index: current.span === 'index' ? current.index + found.offset : 0,
      length: current.length - found.offset,
      span: current.span
    };
    current.length = found.offset;
    this.pieces.splice(found.piece + 1, 0, piece, right);
    this.replaceIndexedPieces(found.piece, 1, [current.length, piece.length, right.length]);
    this.length += piece.length;
    this.mergeAround(found.piece);
  }

  private appendPiece(piece: NativeTextPiece): void {
    const last = this.pieces[this.pieces.length - 1];
    if (last !== undefined && nativeTextPiecesCanMerge(last, piece)) {
      last.length += piece.length;
      this.adjustIndexedPiece(this.pieces.length - 1, piece.length);
    } else {
      const index = this.pieces.length;
      this.pieces[this.pieces.length] = piece;
      this.replaceIndexedPieces(index, 0, [piece.length]);
    }
  }

  private find(index: number): { piece: number; offset: number; start: number } {
    if (this.pieces.length === 0) return { piece: 0, offset: 0, start: 0 };
    if (this.positionIndex !== null || this.pieces.length >= this.indexedPieceThreshold) {
      const found = this.getPositionIndex().find(index);
      return { piece: found.chunk, offset: found.offset, start: index - found.offset };
    }
    let start = 0;
    for (let i = 0, length = this.pieces.length; i < length; i++) {
      const end = start + this.pieces[i].length;
      if (index < end) return { piece: i, offset: index - start, start };
      start = end;
    }
    return { piece: this.pieces.length, offset: 0, start };
  }

  private mergeAround(index: number): void {
    let i = Math.max(0, index);
    if (i > 0) i--;
    while (i + 1 < this.pieces.length) {
      const left = this.pieces[i];
      const right = this.pieces[i + 1];
      if (!nativeTextPiecesCanMerge(left, right)) {
        i++;
        continue;
      }
      left.length += right.length;
      this.pieces.splice(i + 1, 1);
      this.replaceIndexedPieces(i, 2, [left.length]);
    }
  }

  private getPositionIndex(): VisiblePositionIndex {
    if (this.positionIndex === null) {
      const lengths = new Array<number>(this.pieces.length);
      for (let i = 0, length = this.pieces.length; i < length; i++) lengths[i] = this.pieces[i].length;
      this.positionIndex = VisiblePositionIndex.fromLengths(lengths);
    }
    return this.positionIndex;
  }

  private adjustIndexedPiece(piece: number, delta: number): void {
    if (this.positionIndex !== null) this.positionIndex.add(piece, delta);
  }

  private replaceIndexedPieces(index: number, deleteCount: number, insertLengths: number[]): void {
    if (this.positionIndex !== null) this.positionIndex.replaceLengths(index, deleteCount, insertLengths);
  }

  private rangeMatchesPiece(
    pieceIndex: number,
    firstOffset: number,
    count: number,
    first: NativeTextPiece,
    span: 'index' | 'seq'
  ): boolean {
    let remaining = count;
    let found = { piece: pieceIndex, offset: firstOffset };
    if (span === 'index') {
      if (first.span !== 'index') return false;
      let expectedIndex = first.index + firstOffset;
      while (remaining > 0 && found.piece < this.pieces.length) {
        const piece = this.pieces[found.piece];
        const take = Math.min(remaining, piece.length - found.offset);
        if (piece.span !== 'index' || piece.actor !== first.actor || piece.seq !== first.seq || piece.index + found.offset !== expectedIndex) return false;
        expectedIndex += take;
        remaining -= take;
        found = { piece: found.piece + 1, offset: 0 };
      }
      return remaining === 0;
    }

    let expectedSeq = first.span === 'seq' ? first.seq + firstOffset : first.seq;
    while (remaining > 0 && found.piece < this.pieces.length) {
      const piece = this.pieces[found.piece];
      const available = piece.length - found.offset;
      if (piece.span === 'seq') {
        const take = Math.min(remaining, available);
        if (piece.actor !== first.actor || piece.seq + found.offset !== expectedSeq) return false;
        expectedSeq += take;
        remaining -= take;
        found = { piece: found.piece + 1, offset: 0 };
        continue;
      }
      if (piece.actor !== first.actor || piece.index + found.offset !== 0 || piece.seq !== expectedSeq) return false;
      expectedSeq++;
      remaining--;
      if (available === 1) {
        found = { piece: found.piece + 1, offset: 0 };
      } else {
        found = { piece: found.piece, offset: found.offset + 1 };
      }
    }
    return remaining === 0;
  }

  private rangeMatchesParsed(
    index: number,
    count: number,
    parsedStart: TextElementIdParts,
    span: 'index' | 'seq'
  ): boolean {
    let remaining = count;
    let found = this.find(index);
    if (span === 'index') {
      let expectedIndex = parsedStart.index;
      while (remaining > 0 && found.piece < this.pieces.length) {
        const piece = this.pieces[found.piece];
        const take = Math.min(remaining, piece.length - found.offset);
        if (
          piece.span !== 'index' ||
          piece.actor !== parsedStart.actor ||
          piece.seq !== parsedStart.seq ||
          piece.index + found.offset !== expectedIndex
        ) {
          return false;
        }
        expectedIndex += take;
        remaining -= take;
        found = { piece: found.piece + 1, offset: 0, start: found.start + piece.length - found.offset };
      }
      return remaining === 0;
    }

    let expectedSeq = parsedStart.seq;
    while (remaining > 0 && found.piece < this.pieces.length) {
      const piece = this.pieces[found.piece];
      const available = piece.length - found.offset;
      if (piece.span === 'seq') {
        const take = Math.min(remaining, available);
        if (piece.actor !== parsedStart.actor || piece.seq + found.offset !== expectedSeq) return false;
        expectedSeq += take;
        remaining -= take;
        found = { piece: found.piece + 1, offset: 0, start: found.start + piece.length - found.offset };
        continue;
      }
      if (
        piece.actor !== parsedStart.actor ||
        piece.index + found.offset !== 0 ||
        piece.seq !== expectedSeq
      ) {
        return false;
      }
      expectedSeq++;
      remaining--;
      if (available === 1) {
        found = { piece: found.piece + 1, offset: 0, start: found.start + 1 };
      } else {
        found = { piece: found.piece, offset: found.offset + 1, start: found.start };
      }
    }
    return remaining === 0;
  }
}

function nativeTextPieceElementId(piece: NativeTextPiece, offset: number): string {
  return piece.span === 'seq'
    ? `${piece.actor}:${piece.seq + offset}/0`
    : `${piece.actor}:${piece.seq}/${piece.index + offset}`;
}

function nativeTextPieceOffsetMatches(piece: NativeTextPiece, parsed: TextElementIdParts, offset: number): boolean {
  if (piece.actor !== parsed.actor) return false;
  return piece.span === 'seq'
    ? parsed.index === 0 && parsed.seq === piece.seq + offset
    : parsed.seq === piece.seq && parsed.index === piece.index + offset;
}

function nativeTextPiecesCanMerge(left: NativeTextPiece, right: NativeTextPiece): boolean {
  if (left.actor !== right.actor || left.span !== right.span) return false;
  if (left.span === 'seq') return left.seq + left.length === right.seq;
  return left.seq === right.seq && left.index + left.length === right.index;
}

export class ChunkedStringSequence {
  private static readonly targetChunkSize = 512;
  private static readonly maxChunkSize = 1024;
  private static readonly defaultIndexedChunkThreshold = CRDT_TEXT_PROFILE_DEFAULT_ROUTE_INDEX_THRESHOLD;
  private static readonly maxRouteWalkChunks = 8;
  private readonly chunks: string[][] = [];
  private readonly sharedChunks: boolean[] = [];
  private positionIndex: VisiblePositionIndex | null = null;
  private valueIndex: Map<string, string[]> | null = null;
  private lastRoute: { chunk: number; start: number; end: number } | null = null;
  private indexedChunkThreshold = ChunkedStringSequence.defaultIndexedChunkThreshold;
  length = 0;

  static fromArray(values: string[]): ChunkedStringSequence {
    const sequence = new ChunkedStringSequence();
    for (let i = 0, length = values.length; i < length; i += ChunkedStringSequence.targetChunkSize) {
      const chunk = values.slice(i, i + ChunkedStringSequence.targetChunkSize);
      sequence.chunks[sequence.chunks.length] = chunk;
      sequence.sharedChunks[sequence.sharedChunks.length] = false;
      sequence.length += chunk.length;
    }
    return sequence;
  }

  at(index: number): string | null {
    if (index < 0 || index >= this.length) return null;
    const found = this.find(index);
    return this.chunks[found.chunk][found.offset];
  }

  tail(): string | null {
    if (this.length === 0) return null;
    const last = this.chunks.length - 1;
    const chunk = this.chunks[last];
    return chunk[chunk.length - 1];
  }

  clone(): ChunkedStringSequence {
    const sequence = new ChunkedStringSequence();
    for (let i = 0, length = this.chunks.length; i < length; i++) {
      sequence.chunks[sequence.chunks.length] = this.chunks[i];
      sequence.sharedChunks[sequence.sharedChunks.length] = true;
      this.sharedChunks[i] = true;
    }
    sequence.length = this.length;
    if (this.positionIndex !== null) sequence.positionIndex = this.positionIndex.clone();
    if (this.valueIndex !== null) sequence.rebuildValueIndex();
    if (this.lastRoute !== null) sequence.lastRoute = { ...this.lastRoute };
    sequence.indexedChunkThreshold = this.indexedChunkThreshold;
    return sequence;
  }

  enableValueIndex(): void {
    if (this.valueIndex === null) this.rebuildValueIndex();
  }

  setPositionIndexThreshold(threshold: number): void {
    if (!Number.isSafeInteger(threshold) || threshold < 1) return;
    this.indexedChunkThreshold = threshold;
  }

  indexOf(value: string): number {
    if (this.length === 0) return -1;
    if (this.valueIndex !== null) {
      const indexed = this.indexOfIndexedValue(value);
      if (indexed !== -1) return indexed;
    }
    const last = this.chunks.length - 1;
    const tailChunk = this.chunks[last];
    if (tailChunk[tailChunk.length - 1] === value) return this.length - 1;
    let offset = 0;
    for (let i = 0, length = this.chunks.length; i < length; i++) {
      const chunk = this.chunks[i];
      const found = chunk.indexOf(value);
      if (found !== -1) return offset + found;
      offset += chunk.length;
    }
    return -1;
  }

  slice(index: number, count: number): string[] {
    if (count <= 0 || index >= this.length) return [];
    const result: string[] = [];
    let remaining = Math.min(count, this.length - index);
    let found = this.find(index);
    while (remaining > 0 && found.chunk < this.chunks.length) {
      const chunk = this.chunks[found.chunk];
      const take = Math.min(remaining, chunk.length - found.offset);
      for (let i = 0; i < take; i++) result[result.length] = chunk[found.offset + i];
      remaining -= take;
      found = { chunk: found.chunk + 1, offset: 0 };
    }
    return result;
  }

  textDeleteRangePayload(index: number, count: number): TextDeleteRangePayload | null {
    if (count <= 1 || index < 0 || index >= this.length) return null;
    const actualCount = Math.min(count, this.length - index);
    if (actualCount <= 1) return null;
    const first = this.find(index);
    const firstId = this.chunks[first.chunk][first.offset];
    const parsed = parseTextElementId(firstId);
    if (parsed === null) return null;

    if (this.rangeMatches(index + 1, actualCount - 1, parsed, 'index')) {
      return { start: firstId, count: actualCount, span: 'index' };
    }
    if (parsed.index !== 0) return null;
    return this.rangeMatches(index + 1, actualCount - 1, parsed, 'seq')
      ? { start: firstId, count: actualCount, span: 'seq' }
      : null;
  }

  textDeleteRangeEquals(index: number, op: Extract<CrdtOperation, { type: 'textDelRange' }>): boolean {
    return op.count > 0 &&
      index >= 0 &&
      index + op.count <= this.length &&
      textDeleteRangeEqualsAt(this, index, op);
  }

  insertCreated(index: number, op: CrdtOperation, count: number): void {
    if (count <= 0) return;
    if (count === 1) {
      this.insertOne(
        index,
        op.type === 'textRun' || op.type === 'listRun'
          ? `${op.actor}:${op.seq}/0`
          : op.id + '/0'
      );
      return;
    }
    if (index >= this.length) {
      this.appendCreated(op, count);
      return;
    }
    const values = new Array<string>(count);
    if (op.type === 'textRun' || op.type === 'listRun') {
      for (let i = 0; i < count; i++) values[i] = `${op.actor}:${op.seq + i}/0`;
    } else {
      const prefix = op.id + '/';
      for (let i = 0; i < count; i++) values[i] = prefix + i;
    }
    this.insert(index, values);
  }

  private appendCreated(op: CrdtOperation, count: number): void {
    let offset = 0;
    const run = op.type === 'textRun' || op.type === 'listRun';
    const actorPrefix = run ? op.actor + ':' : '';
    const idPrefix = run ? '' : op.id + '/';
    if (this.chunks.length !== 0) {
      const last = this.chunks.length - 1;
      this.ensureOwned(last);
      const tail = this.chunks[last];
      const available = ChunkedStringSequence.targetChunkSize - tail.length;
      if (available > 0) {
        const take = Math.min(available, count);
        for (let i = 0; i < take; i++) {
          const value = run ? actorPrefix + (op.seq + i) + '/0' : idPrefix + i;
          tail[tail.length] = value;
          if (this.valueIndex !== null) this.indexValue(value, tail);
        }
        offset = take;
        this.length += take;
        this.adjustIndexedChunk(last, take);
        this.refreshLastRoute(last);
      }
    }
    if (offset >= count) return;

    const insertIndex = this.chunks.length;
    const chunks: string[][] = [];
    while (offset < count) {
      const take = Math.min(ChunkedStringSequence.targetChunkSize, count - offset);
      const chunk = new Array<string>(take);
      for (let i = 0; i < take; i++) {
        const elementOffset = offset + i;
        chunk[i] = run ? actorPrefix + (op.seq + elementOffset) + '/0' : idPrefix + elementOffset;
      }
      chunks[chunks.length] = chunk;
      offset += take;
    }
    for (let i = 0, length = chunks.length; i < length; i++) {
      const chunk = chunks[i];
      this.chunks[this.chunks.length] = chunk;
      this.sharedChunks[this.sharedChunks.length] = false;
      if (this.valueIndex !== null) this.indexChunk(chunk);
      this.length += chunk.length;
    }
    this.replaceIndexedChunks(insertIndex, 0, chunks);
  }

  delete(index: number, count: number): void {
    if (count <= 0 || index >= this.length) return;
    let remaining = Math.min(count, this.length - index);
    let found = this.find(index);
    while (remaining > 0 && found.chunk < this.chunks.length) {
      const chunk = this.chunks[found.chunk];
      const take = Math.min(remaining, chunk.length - found.offset);
      if (found.offset === 0 && take === chunk.length) {
        if (this.valueIndex !== null) this.removeIndexedValues(chunk, 0, take);
        this.chunks.splice(found.chunk, 1);
        this.sharedChunks.splice(found.chunk, 1);
        this.length -= take;
        remaining -= take;
        this.replaceIndexedChunks(found.chunk, 1, []);
        this.lastRoute = null;
        found = { chunk: found.chunk, offset: 0 };
        continue;
      }
      this.ensureOwned(found.chunk);
      const owned = this.chunks[found.chunk];
      if (this.valueIndex !== null) this.removeIndexedValues(owned, found.offset, take);
      owned.splice(found.offset, take);
      this.length -= take;
      remaining -= take;
      if (owned.length === 0) {
        this.chunks.splice(found.chunk, 1);
        this.sharedChunks.splice(found.chunk, 1);
        this.replaceIndexedChunks(found.chunk, 1, []);
        this.lastRoute = null;
      } else if (found.offset >= owned.length) {
        this.adjustIndexedChunk(found.chunk, -take);
        this.refreshLastRoute(found.chunk);
        found = { chunk: found.chunk + 1, offset: 0 };
      } else {
        this.adjustIndexedChunk(found.chunk, -take);
        this.refreshLastRoute(found.chunk);
      }
    }
  }

  deleteSlice(index: number, count: number): string[] {
    if (count <= 0 || index >= this.length) return [];
    const actualCount = Math.min(count, this.length - index);
    if (actualCount === 1) {
      const found = this.find(index);
      if (found.chunk >= this.chunks.length) return [];
      this.ensureOwned(found.chunk);
      const owned = this.chunks[found.chunk];
      const value = owned[found.offset];
      if (value === undefined) return [];
      if (this.valueIndex !== null) this.valueIndex.delete(value);
      owned.splice(found.offset, 1);
      this.length--;
      if (owned.length === 0) {
        this.chunks.splice(found.chunk, 1);
        this.sharedChunks.splice(found.chunk, 1);
        this.replaceIndexedChunks(found.chunk, 1, []);
        this.lastRoute = null;
      } else {
        this.adjustIndexedChunk(found.chunk, -1);
        this.refreshLastRoute(found.chunk);
      }
      return [value];
    }
    const first = this.find(index);
    if (first.chunk < this.chunks.length) {
      const chunk = this.chunks[first.chunk];
      if (first.offset + actualCount <= chunk.length) {
        this.ensureOwned(first.chunk);
        const owned = this.chunks[first.chunk];
        const result = owned.slice(first.offset, first.offset + actualCount);
        if (this.valueIndex !== null) this.removeIndexedValues(owned, first.offset, actualCount);
        owned.splice(first.offset, actualCount);
        this.length -= actualCount;
        if (owned.length === 0) {
          this.chunks.splice(first.chunk, 1);
          this.sharedChunks.splice(first.chunk, 1);
          this.replaceIndexedChunks(first.chunk, 1, []);
          this.lastRoute = null;
        } else {
          this.adjustIndexedChunk(first.chunk, -actualCount);
          this.refreshLastRoute(first.chunk);
        }
        return result;
      }
    }
    const result = new Array<string>(actualCount);
    let resultOffset = 0;
    let remaining = actualCount;
    let found = first;
    while (remaining > 0 && found.chunk < this.chunks.length) {
      const chunk = this.chunks[found.chunk];
      const take = Math.min(remaining, chunk.length - found.offset);
      for (let i = 0; i < take; i++) result[resultOffset++] = chunk[found.offset + i];
      if (found.offset === 0 && take === chunk.length) {
        if (this.valueIndex !== null) this.removeIndexedValues(chunk, 0, take);
        this.chunks.splice(found.chunk, 1);
        this.sharedChunks.splice(found.chunk, 1);
        this.length -= take;
        remaining -= take;
        this.replaceIndexedChunks(found.chunk, 1, []);
        this.lastRoute = null;
        found = { chunk: found.chunk, offset: 0 };
        continue;
      }
      this.ensureOwned(found.chunk);
      const owned = this.chunks[found.chunk];
      if (this.valueIndex !== null) this.removeIndexedValues(owned, found.offset, take);
      owned.splice(found.offset, take);
      this.length -= take;
      remaining -= take;
      if (owned.length === 0) {
        this.chunks.splice(found.chunk, 1);
        this.sharedChunks.splice(found.chunk, 1);
        this.replaceIndexedChunks(found.chunk, 1, []);
        this.lastRoute = null;
      } else if (found.offset >= owned.length) {
        this.adjustIndexedChunk(found.chunk, -take);
        this.refreshLastRoute(found.chunk);
        found = { chunk: found.chunk + 1, offset: 0 };
      } else {
        this.adjustIndexedChunk(found.chunk, -take);
        this.refreshLastRoute(found.chunk);
      }
    }
    if (resultOffset === result.length) return result;
    result.length = resultOffset;
    return result;
  }

  toArray(): string[] {
    const result = new Array<string>(this.length);
    let offset = 0;
    for (let i = 0, length = this.chunks.length; i < length; i++) {
      const chunk = this.chunks[i];
      for (let j = 0, chunkLength = chunk.length; j < chunkLength; j++) result[offset++] = chunk[j];
    }
    return result;
  }

  private insert(index: number, values: string[]): void {
    if (values.length === 0) return;
    if (values.length === 1) {
      this.insertOne(index, values[0]);
      return;
    }
    if (this.chunks.length === 0) {
      this.appendValueChunks(values, 0);
      this.length += values.length;
      return;
    }
    if (index >= this.length) {
      const last = this.chunks.length - 1;
      const tail = this.chunks[last];
      if (tail.length + values.length <= ChunkedStringSequence.targetChunkSize) {
        this.ensureOwned(last);
        const owned = this.chunks[last];
        for (let i = 0, length = values.length; i < length; i++) owned[owned.length] = values[i];
        if (this.valueIndex !== null) this.addIndexedValues(owned, values);
        this.length += values.length;
        this.adjustIndexedChunk(last, values.length);
        this.refreshLastRoute(last);
        return;
      }
      this.appendValueChunks(values, this.chunks.length);
      this.length += values.length;
      return;
    }

    const found = this.find(index);
      this.ensureOwned(found.chunk);
      const chunk = this.chunks[found.chunk];
    if (values.length + chunk.length <= ChunkedStringSequence.maxChunkSize) {
      chunk.splice(found.offset, 0, ...values);
      if (this.valueIndex !== null) this.addIndexedValues(chunk, values);
      this.length += values.length;
      this.adjustIndexedChunk(found.chunk, values.length);
      this.refreshLastRoute(found.chunk);
      return;
    }
    const replacement = [
      chunk.slice(0, found.offset),
      ...ChunkedStringSequence.valueChunks(values),
      chunk.slice(found.offset)
    ].filter((item) => item.length !== 0);
    this.chunks.splice(found.chunk, 1, ...replacement);
    this.sharedChunks.splice(found.chunk, 1, ...new Array(replacement.length).fill(false));
    if (this.valueIndex !== null) this.reindexChunks(replacement);
    this.length += values.length;
    this.replaceIndexedChunks(found.chunk, 1, replacement);
    this.refreshLastRoute(found.chunk);
  }

  private insertOne(index: number, value: string): void {
    if (this.chunks.length === 0) {
      const chunk = [value];
      this.chunks[0] = chunk;
      this.sharedChunks[0] = false;
      this.length = 1;
      if (this.valueIndex !== null) this.indexChunk(chunk);
      this.replaceIndexedChunks(0, 0, [chunk]);
      return;
    }
    if (index >= this.length) {
      const last = this.chunks.length - 1;
      this.ensureOwned(last);
      const tail = this.chunks[last];
      if (tail.length < ChunkedStringSequence.targetChunkSize) {
        tail[tail.length] = value;
        if (this.valueIndex !== null) this.indexValue(value, tail);
        this.length++;
        this.adjustIndexedChunk(last, 1);
        this.refreshLastRoute(last);
        return;
      }
      const chunk = [value];
      const chunkIndex = this.chunks.length;
      this.chunks[chunkIndex] = chunk;
      this.sharedChunks[chunkIndex] = false;
      if (this.valueIndex !== null) this.indexChunk(chunk);
      this.length++;
      this.replaceIndexedChunks(chunkIndex, 0, [chunk]);
      return;
    }

    const found = this.find(index);
    this.ensureOwned(found.chunk);
    const chunk = this.chunks[found.chunk];
    if (chunk.length < ChunkedStringSequence.maxChunkSize) {
      chunk.splice(found.offset, 0, value);
      if (this.valueIndex !== null) this.indexValue(value, chunk);
      this.length++;
      this.adjustIndexedChunk(found.chunk, 1);
      this.refreshLastRoute(found.chunk);
      return;
    }
    const replacement = [
      chunk.slice(0, found.offset),
      [value],
      chunk.slice(found.offset)
    ].filter((item) => item.length !== 0);
    this.chunks.splice(found.chunk, 1, ...replacement);
    this.sharedChunks.splice(found.chunk, 1, ...new Array(replacement.length).fill(false));
    if (this.valueIndex !== null) this.reindexChunks(replacement);
    this.length++;
    this.replaceIndexedChunks(found.chunk, 1, replacement);
    this.refreshLastRoute(found.chunk);
  }

  private rangeMatches(
    index: number,
    count: number,
    parsedStart: TextElementIdParts,
    span: 'index' | 'seq'
  ): boolean {
    let remaining = count;
    let expectedOffset = 1;
    let found = this.find(index);
    while (remaining > 0 && found.chunk < this.chunks.length) {
      const chunk = this.chunks[found.chunk];
      const take = Math.min(remaining, chunk.length - found.offset);
      for (let i = 0; i < take; i++) {
        if (!textElementIdMatchesRange(chunk[found.offset + i], parsedStart, expectedOffset, span)) return false;
        expectedOffset++;
      }
      remaining -= take;
      found = { chunk: found.chunk + 1, offset: 0 };
    }
    return remaining === 0;
  }

  private appendValueChunks(values: string[], chunkIndex: number): void {
    const chunks = ChunkedStringSequence.valueChunks(values);
    this.chunks.splice(chunkIndex, 0, ...chunks);
    this.sharedChunks.splice(chunkIndex, 0, ...new Array(chunks.length).fill(false));
    if (this.valueIndex !== null) this.reindexChunks(chunks);
    this.replaceIndexedChunks(chunkIndex, 0, chunks);
  }

  private static valueChunks(values: string[]): string[][] {
    const chunks: string[][] = [];
    for (let i = 0, length = values.length; i < length; i += ChunkedStringSequence.targetChunkSize) {
      chunks[chunks.length] = values.slice(i, i + ChunkedStringSequence.targetChunkSize);
    }
    return chunks;
  }

  private find(index: number): { chunk: number; offset: number } {
    if (this.chunks.length === 0) return { chunk: 0, offset: 0 };
    const routed = this.findFromLastRoute(index);
    if (routed !== null) return routed;
    if (this.positionIndex === null && this.chunks.length < this.indexedChunkThreshold) {
      let start = 0;
      for (let i = 0, length = this.chunks.length; i < length; i++) {
        const end = start + this.chunks[i].length;
        if (index < end) {
          this.rememberRoute(i, start);
          return { chunk: i, offset: index - start };
        }
        start = end;
      }
      const last = this.chunks.length - 1;
      this.rememberRoute(last, start - this.chunks[last].length);
      return { chunk: last, offset: this.chunks[last].length };
    }
    const found = this.getPositionIndex().find(index);
    this.rememberRoute(found.chunk, index - found.offset);
    return found;
  }

  private ensureOwned(index: number): void {
    if (!this.sharedChunks[index]) return;
    const chunk = this.chunks[index].slice();
    this.chunks[index] = chunk;
    this.sharedChunks[index] = false;
    if (this.valueIndex !== null) this.indexChunk(chunk);
  }

  private getPositionIndex(): VisiblePositionIndex {
    if (this.positionIndex === null) this.positionIndex = VisiblePositionIndex.fromChunks(this.chunks);
    return this.positionIndex;
  }

  private findFromLastRoute(index: number): { chunk: number; offset: number } | null {
    const route = this.lastRoute;
    if (route === null || route.chunk < 0 || route.chunk >= this.chunks.length) return null;
    let chunk = route.chunk;
    let start = route.start;
    let end = start + this.chunks[chunk].length;
    let walked = 0;
    if (index < start) {
      while (chunk > 0 && index < start) {
        if (walked++ >= ChunkedStringSequence.maxRouteWalkChunks) return null;
        chunk--;
        end = start;
        start -= this.chunks[chunk].length;
      }
    } else {
      while (chunk < this.chunks.length - 1 && index >= end) {
        if (walked++ >= ChunkedStringSequence.maxRouteWalkChunks) return null;
        chunk++;
        start = end;
        end += this.chunks[chunk].length;
      }
    }
    if (index < start || index >= end) return null;
    this.lastRoute = { chunk, start, end };
    return { chunk, offset: index - start };
  }

  private rememberRoute(chunk: number, start: number): void {
    if (chunk < 0 || chunk >= this.chunks.length) {
      this.lastRoute = null;
      return;
    }
    this.lastRoute = { chunk, start, end: start + this.chunks[chunk].length };
  }

  private refreshLastRoute(chunk: number): void {
    const route = this.lastRoute;
    if (route === null || route.chunk !== chunk || chunk < 0 || chunk >= this.chunks.length) {
      this.lastRoute = null;
      return;
    }
    route.end = route.start + this.chunks[chunk].length;
  }

  private adjustIndexedChunk(chunk: number, delta: number): void {
    if (this.positionIndex !== null) this.positionIndex.add(chunk, delta);
  }

  private replaceIndexedChunks(index: number, deleteCount: number, chunks: string[][]): void {
    if (this.positionIndex !== null) this.positionIndex.replace(index, deleteCount, chunks);
  }

  private indexOfIndexedValue(value: string): number {
    const index = this.valueIndex;
    if (index === null) return -1;
    const chunk = index.get(value);
    if (chunk === undefined) return -1;
    const chunkIndex = this.chunks.indexOf(chunk);
    if (chunkIndex === -1) {
      index.delete(value);
      return -1;
    }
    const offset = chunk.indexOf(value);
    if (offset === -1) {
      index.delete(value);
      return -1;
    }
    return this.chunkStart(chunkIndex) + offset;
  }

  private chunkStart(chunkIndex: number): number {
    let offset = 0;
    for (let i = 0; i < chunkIndex; i++) offset += this.chunks[i].length;
    return offset;
  }

  private rebuildValueIndex(): void {
    this.valueIndex = new Map<string, string[]>();
    for (let i = 0, length = this.chunks.length; i < length; i++) this.indexChunk(this.chunks[i]);
  }

  private indexChunk(chunk: string[]): void {
    const index = this.valueIndex;
    if (index === null) return;
    for (let i = 0, length = chunk.length; i < length; i++) index.set(chunk[i], chunk);
  }

  private reindexChunks(chunks: string[][]): void {
    if (this.valueIndex === null) return;
    for (let i = 0, length = chunks.length; i < length; i++) this.indexChunk(chunks[i]);
  }

  private addIndexedValues(chunk: string[], values: string[]): void {
    const index = this.valueIndex;
    if (index === null) return;
    for (let i = 0, length = values.length; i < length; i++) index.set(values[i], chunk);
  }

  private indexValue(value: string, chunk: string[]): void {
    if (this.valueIndex !== null) this.valueIndex.set(value, chunk);
  }

  private removeIndexedValues(chunk: string[], offset: number, count: number): void {
    const index = this.valueIndex;
    if (index === null) return;
    for (let i = 0; i < count; i++) index.delete(chunk[offset + i]);
  }
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
