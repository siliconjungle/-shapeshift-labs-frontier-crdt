export class VisiblePositionIndex {
  private static readonly blockSize = 32;
  private lengths: number[];
  private blocks: number[];

  static fromChunks(chunks: string[][]): VisiblePositionIndex {
    const lengths = new Array<number>(chunks.length);
    for (let i = 0, length = chunks.length; i < length; i++) lengths[i] = chunks[i].length;
    return new VisiblePositionIndex(lengths);
  }

  static fromLengths(lengths: number[]): VisiblePositionIndex {
    return new VisiblePositionIndex(lengths);
  }

  private constructor(lengths: number[]) {
    this.lengths = lengths.slice();
    this.blocks = [];
    this.rebuildBlocks();
  }

  clone(): VisiblePositionIndex {
    const index = Object.create(VisiblePositionIndex.prototype) as VisiblePositionIndex;
    index.lengths = this.lengths.slice();
    index.blocks = this.blocks.slice();
    return index;
  }

  find(offset: number): { chunk: number; offset: number } {
    if (this.lengths.length === 0) return { chunk: 0, offset: 0 };
    let prefix = 0;
    let block = 0;
    for (let blockCount = this.blocks.length; block < blockCount; block++) {
      const next = prefix + this.blocks[block];
      if (offset < next) break;
      prefix = next;
    }
    let chunk = block * VisiblePositionIndex.blockSize;
    const blockEnd = Math.min(chunk + VisiblePositionIndex.blockSize, this.lengths.length);
    for (; chunk < blockEnd; chunk++) {
      const next = prefix + this.lengths[chunk];
      if (offset < next) return { chunk, offset: offset - prefix };
      prefix = next;
    }
    if (chunk >= this.lengths.length) {
      const last = this.lengths.length - 1;
      return { chunk: last, offset: this.lengths[last] };
    }
    return { chunk, offset: 0 };
  }

  add(chunk: number, delta: number): void {
    if (delta === 0 || chunk < 0 || chunk >= this.lengths.length) return;
    this.lengths[chunk] += delta;
    this.blocks[Math.floor(chunk / VisiblePositionIndex.blockSize)] += delta;
  }

  replace(index: number, deleteCount: number, chunks: string[][]): void {
    const insertLengths = new Array<number>(chunks.length);
    for (let i = 0, length = chunks.length; i < length; i++) insertLengths[i] = chunks[i].length;
    this.replaceLengths(index, deleteCount, insertLengths);
  }

  replaceLengths(index: number, deleteCount: number, insertLengths: number[]): void {
    if (deleteCount === 1 && insertLengths.length === 1 && index >= 0 && index < this.lengths.length) {
      this.add(index, insertLengths[0] - this.lengths[index]);
      return;
    }
    const firstChangedBlock = Math.floor(Math.max(0, index) / VisiblePositionIndex.blockSize);
    this.lengths.splice(index, deleteCount, ...insertLengths);
    this.rebuildBlocksFrom(firstChangedBlock);
  }

  private rebuildBlocks(): void {
    this.rebuildBlocksFrom(0);
  }

  private rebuildBlocksFrom(startBlock: number): void {
    const blockCount = Math.ceil(this.lengths.length / VisiblePositionIndex.blockSize);
    if (this.blocks.length !== blockCount) this.blocks.length = blockCount;
    for (let i = startBlock; i < blockCount; i++) this.blocks[i] = 0;
    for (let i = startBlock * VisiblePositionIndex.blockSize, length = this.lengths.length; i < length; i++) {
      this.blocks[Math.floor(i / VisiblePositionIndex.blockSize)] += this.lengths[i];
    }
  }

}

export class ChunkedTextValue {
  private static readonly targetChunkSize = 512;
  private static readonly maxChunkSize = 1024;
  private static readonly indexedChunkThreshold = 32;
  private readonly chunks: Array<{ text: string; codePoints: number }> = [];
  private positionIndex: VisiblePositionIndex | null = null;
  private codePoints = 0;
  private codeUnits = 0;

  static fromString(value: string): ChunkedTextValue {
    const text = new ChunkedTextValue();
    for (let i = 0, length = value.length; i < length; i += ChunkedTextValue.targetChunkSize) {
      text.pushChunk(value.slice(i, i + ChunkedTextValue.targetChunkSize));
    }
    return text;
  }

  insert(index: number, value: string, valueCodePoints = codePointLength(value)): void {
    if (value.length === 0) return;
    if (this.chunks.length === 0 || index >= this.codePoints) {
      this.appendText(value, valueCodePoints);
      return;
    }
    const found = this.find(index);
    const chunk = this.chunks[found.chunk];
    const offset = codePointIndexToCodeUnitOffsetKnownLength(chunk.text, found.offset, chunk.codePoints);
    const next = chunk.text.slice(0, offset) + value + chunk.text.slice(offset);
    this.replaceChunk(found.chunk, next, chunk.codePoints + valueCodePoints);
  }

  delete(index: number, count: number): void {
    if (count <= 0 || index >= this.codePoints) return;
    let remaining = Math.min(count, this.codePoints - index);
    let found = this.find(index);
    while (remaining > 0 && found.chunk < this.chunks.length) {
      const chunk = this.chunks[found.chunk];
      const take = Math.min(remaining, chunk.codePoints - found.offset);
      const start = codePointIndexToCodeUnitOffsetKnownLength(chunk.text, found.offset, chunk.codePoints);
      const end = codePointIndexToCodeUnitOffsetKnownLength(chunk.text, found.offset + take, chunk.codePoints);
      const next = chunk.text.slice(0, start) + chunk.text.slice(end);
      this.replaceChunk(found.chunk, next, chunk.codePoints - take);
      remaining -= take;
      if (next.length === 0 || found.offset >= (this.chunks[found.chunk] ? this.chunks[found.chunk].codePoints : 0)) {
        found = { chunk: found.chunk + (next.length === 0 ? 0 : 1), offset: 0 };
      }
    }
  }

  splice(index: number, deleteCount: number, insert: string, insertCodePoints = insert.length === 0 ? 0 : codePointLength(insert)): void {
    if (deleteCount <= 0) {
      if (insert.length !== 0) this.insert(index, insert, insertCodePoints);
      return;
    }
    if (insert.length === 0) {
      this.delete(index, deleteCount);
      return;
    }
    if (index >= this.codePoints) {
      this.appendText(insert, insertCodePoints);
      return;
    }
    const actualDelete = Math.min(deleteCount, this.codePoints - index);
    const found = this.find(index);
    if (found.chunk < this.chunks.length) {
      const chunk = this.chunks[found.chunk];
      if (found.offset + actualDelete <= chunk.codePoints) {
        const start = codePointIndexToCodeUnitOffsetKnownLength(chunk.text, found.offset, chunk.codePoints);
        const end = codePointIndexToCodeUnitOffsetKnownLength(chunk.text, found.offset + actualDelete, chunk.codePoints);
        const next = chunk.text.slice(0, start) + insert + chunk.text.slice(end);
        this.replaceChunk(found.chunk, next, chunk.codePoints - actualDelete + insertCodePoints);
        return;
      }
    }
    this.delete(index, actualDelete);
    this.insert(index, insert, insertCodePoints);
  }

  codeUnitOffset(index: number): number {
    if (index <= 0) return 0;
    if (this.codeUnits === this.codePoints) return index >= this.codeUnits ? this.codeUnits : index;
    if (index >= this.codePoints) return this.codeUnits;
    let remaining = index;
    let codeUnits = 0;
    for (let i = 0, length = this.chunks.length; i < length; i++) {
      const chunk = this.chunks[i];
      if (remaining <= chunk.codePoints) {
        return codeUnits + codePointIndexToCodeUnitOffsetKnownLength(chunk.text, remaining, chunk.codePoints);
      }
      remaining -= chunk.codePoints;
      codeUnits += chunk.text.length;
    }
    return this.codeUnits;
  }

  codeUnitRange(index: number, count: number): [number, number] {
    if (count <= 0) return [this.codeUnitOffset(index), 0];
    if (this.codeUnits === this.codePoints) {
      const start = index <= 0 ? 0 : index >= this.codeUnits ? this.codeUnits : index;
      const end = index + count >= this.codeUnits ? this.codeUnits : index + count;
      return [start, end - start];
    }
    const start = this.codeUnitOffset(index);
    const end = this.codeUnitOffset(index + count);
    return [start, end - start];
  }

  toString(): string {
    if (this.chunks.length === 0) return '';
    if (this.chunks.length === 1) return this.chunks[0].text;
    const chunks = new Array<string>(this.chunks.length);
    for (let i = 0, length = this.chunks.length; i < length; i++) chunks[i] = this.chunks[i].text;
    return chunks.join('');
  }

  isCodeUnitAligned(): boolean {
    return this.codeUnits === this.codePoints;
  }

  private appendText(value: string, valueCodePoints = codePointLength(value)): void {
    if (value.length <= ChunkedTextValue.targetChunkSize) {
      this.pushChunk(value, valueCodePoints);
      return;
    }
    for (let i = 0, length = value.length; i < length; i += ChunkedTextValue.targetChunkSize) {
      this.pushChunk(value.slice(i, i + ChunkedTextValue.targetChunkSize));
    }
  }

  private replaceChunk(index: number, value: string, valueCodePoints?: number): void {
    const previous = this.chunks[index];
    const previousCodeUnits = previous.text.length;
    const previousCodePoints = previous.codePoints;
    if (value.length === 0) {
      this.codeUnits -= previousCodeUnits;
      this.codePoints -= previousCodePoints;
      this.chunks.splice(index, 1);
      this.replaceIndexedChunks(index, 1, []);
      return;
    }
    if (value.length <= ChunkedTextValue.maxChunkSize) {
      const nextCodePoints = valueCodePoints === undefined ? codePointLength(value) : valueCodePoints;
      previous.text = value;
      previous.codePoints = nextCodePoints;
      this.codeUnits += value.length - previousCodeUnits;
      this.codePoints += nextCodePoints - previousCodePoints;
      this.adjustIndexedChunk(index, nextCodePoints - previousCodePoints);
      return;
    }
    this.codeUnits -= previousCodeUnits;
    this.codePoints -= previousCodePoints;
    const replacements: Array<{ text: string; codePoints: number }> = [];
    for (let i = 0, length = value.length; i < length; i += ChunkedTextValue.targetChunkSize) {
      const text = value.slice(i, i + ChunkedTextValue.targetChunkSize);
      replacements[replacements.length] = { text, codePoints: codePointLength(text) };
    }
    this.chunks.splice(index, 1, ...replacements);
    this.replaceIndexedChunks(index, 1, replacements);
    for (let i = 0, length = replacements.length; i < length; i++) {
      this.codeUnits += replacements[i].text.length;
      this.codePoints += replacements[i].codePoints;
    }
  }

  private pushChunk(text: string, textCodePoints = codePointLength(text)): void {
    if (text.length === 0) return;
    const last = this.chunks[this.chunks.length - 1];
    if (last !== undefined && last.text.length + text.length <= ChunkedTextValue.maxChunkSize) {
      const merged = last.text + text;
      this.codeUnits -= last.text.length;
      this.codePoints -= last.codePoints;
      last.text = merged;
      last.codePoints += textCodePoints;
      this.codeUnits += last.text.length;
      this.codePoints += last.codePoints;
      this.adjustIndexedChunk(this.chunks.length - 1, textCodePoints);
      return;
    }
    const chunk = { text, codePoints: textCodePoints };
    this.chunks[this.chunks.length] = chunk;
    this.replaceIndexedChunks(this.chunks.length - 1, 0, [chunk]);
    this.codeUnits += text.length;
    this.codePoints += chunk.codePoints;
  }

  private find(index: number): { chunk: number; offset: number } {
    if (this.positionIndex === null && this.chunks.length < ChunkedTextValue.indexedChunkThreshold) {
      let remaining = index;
      for (let i = 0, length = this.chunks.length; i < length; i++) {
        const chunkLength = this.chunks[i].codePoints;
        if (remaining < chunkLength) return { chunk: i, offset: remaining };
        remaining -= chunkLength;
      }
      const last = this.chunks.length - 1;
      return last < 0 ? { chunk: 0, offset: 0 } : { chunk: last, offset: this.chunks[last].codePoints };
    }
    return this.getPositionIndex().find(index);
  }

  private getPositionIndex(): VisiblePositionIndex {
    if (this.positionIndex === null) {
      const lengths = new Array<number>(this.chunks.length);
      for (let i = 0, length = this.chunks.length; i < length; i++) lengths[i] = this.chunks[i].codePoints;
      this.positionIndex = VisiblePositionIndex.fromLengths(lengths);
    }
    return this.positionIndex;
  }

  private adjustIndexedChunk(chunk: number, delta: number): void {
    if (this.positionIndex !== null) this.positionIndex.add(chunk, delta);
  }

  private replaceIndexedChunks(index: number, deleteCount: number, chunks: Array<{ text: string; codePoints: number }>): void {
    if (this.positionIndex === null) return;
    const lengths = new Array<number>(chunks.length);
    for (let i = 0, length = chunks.length; i < length; i++) lengths[i] = chunks[i].codePoints;
    this.positionIndex.replaceLengths(index, deleteCount, lengths);
  }
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

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}
