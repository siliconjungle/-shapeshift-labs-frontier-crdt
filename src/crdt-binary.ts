import { BinaryByteReader, BinaryByteWriter } from '@shapeshift-labs/frontier-codec/binary-core';

export class CrdtBinaryWriter extends BinaryByteWriter {
  private readonly stringIds = new Map<string, number>();

  writeString(value: string): void {
    const id = this.stringIds.get(value);
    if (id !== undefined) {
      this.writeByte(1);
      this.writeVarint(id);
      return;
    }
    this.stringIds.set(value, this.stringIds.size);
    this.writeByte(0);
    this.writeUtf8StringPayload(value);
  }
}

export class CrdtBinaryReader extends BinaryByteReader {
  private readonly strings: string[] = [];

  constructor(bytes: Uint8Array) {
    super(bytes, 'binary CRDT update');
  }

  readString(): string {
    const mode = this.readByte();
    if (mode === 1) {
      const id = this.readVarint();
      const value = this.strings[id];
      if (value === undefined) throw new TypeError('invalid binary CRDT string reference');
      return value;
    }
    if (mode !== 0) throw new TypeError('invalid binary CRDT string mode');
    const value = this.readUtf8StringPayload();
    this.strings[this.strings.length] = value;
    return value;
  }
}
