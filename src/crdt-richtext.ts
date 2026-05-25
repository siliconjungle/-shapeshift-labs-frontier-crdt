import { cloneJson } from '@shapeshift-labs/frontier/clone';
import { getCachedPointerPath, getPath } from '@shapeshift-labs/frontier/pointer';
import type {
  CrdtCommitResult,
  CrdtCursorOptions,
  CrdtDocument,
  CrdtRichTextBlock,
  CrdtRichTextDelta,
  CrdtRichTextDeltaOp,
  CrdtRichTextEmbed,
  CrdtRichTextHandle,
  CrdtRichTextSpan,
  CrdtRichTextValue,
  CrdtResolvedCursor,
  CrdtResolvedSelection,
  CrdtSelectionOptions,
  CrdtTextCursor,
  CrdtTextSelection,
  CrdtTransaction,
  JsonObject,
  JsonPath,
  JsonValue,
  WatchPath
} from './types.js';

const EMBED_CHAR = '\ufffc';

type RichTextDoc = Pick<CrdtDocument, 'toJSON' | 'change' | 'createCursor' | 'resolveCursor' | 'createSelection' | 'resolveSelection'>;
type RichTextTx = Pick<CrdtTransaction, 'set' | 'list' | 'text'>;

export function createCrdtRichTextHandle(doc: RichTextDoc, path: JsonPath): CrdtRichTextHandle {
  return new FrontierCrdtRichTextHandle(doc, path);
}

class FrontierCrdtRichTextHandle implements CrdtRichTextHandle {
  constructor(
    private readonly doc: RichTextDoc,
    private readonly path: JsonPath
  ) {}

  value(): CrdtRichTextValue {
    return readRichTextAt(this.doc.toJSON(), this.path);
  }

  getText(): string {
    return this.value().text;
  }

  getSpans(): CrdtRichTextSpan[] {
    const value = this.value();
    return compactSpans(cloneSpans(value.spans), codePointLength(value.text));
  }

  getEmbeds(): CrdtRichTextEmbed[] {
    const value = this.value();
    return compactEmbeds(cloneEmbeds(value.embeds), codePointLength(value.text));
  }

  toDelta(): CrdtRichTextDelta {
    return richTextToDelta(this.value());
  }

  getBlocks(): CrdtRichTextBlock[] {
    const value = this.value();
    return compactBlocks(cloneBlocks(value.blocks), codePointLength(value.text));
  }

  getAttributes(index: number): JsonObject | undefined {
    if (!Number.isSafeInteger(index) || index < 0) throw new RangeError('rich text attribute index must be a non-negative safe integer');
    const value = this.value();
    const length = codePointLength(value.text);
    if (index >= length) return undefined;
    const attributes = attributesAt(value.spans || [], index);
    return attributes === undefined ? undefined : cloneJson(attributes);
  }

  createCursor(index: number, options?: CrdtCursorOptions): CrdtTextCursor {
    return this.doc.createCursor(this.path.concat('text'), index, options);
  }

  resolveCursor(cursor: CrdtTextCursor): CrdtResolvedCursor {
    return this.doc.resolveCursor(cursor);
  }

  createSelection(anchor: number, focus: number, options?: CrdtSelectionOptions): CrdtTextSelection {
    return this.doc.createSelection(this.path.concat('text'), anchor, focus, options);
  }

  resolveSelection(selection: CrdtTextSelection): CrdtResolvedSelection {
    return this.doc.resolveSelection(selection);
  }

  fromDelta(delta: readonly CrdtRichTextDeltaOp[]): CrdtCommitResult {
    const next = richTextFromDelta(delta);
    const before = this.value();
    const plan: RichTextPlan = {
      textOps: [{ index: 0, deleteCount: codePointLength(before.text), insert: next.text }],
      spans: next.spans || [],
      embeds: next.embeds || [],
      blocks: next.blocks || []
    };
    return this.doc.change((tx) => {
      this.applyPlan(tx, before, plan);
    });
  }

  applyDelta(delta: readonly CrdtRichTextDeltaOp[]): CrdtCommitResult {
    const before = this.value();
    const plan = planRichTextDelta(before, delta);
    return this.doc.change((tx) => {
      this.applyPlan(tx, before, plan);
    });
  }

  insert(index: number, text: string, attributes?: JsonObject): CrdtCommitResult {
    return this.applyDelta([{ retain: index }, { insert: text, attributes }]);
  }

  insertEmbed(index: number, value: JsonObject, attributes?: JsonObject): CrdtCommitResult {
    return this.applyDelta([{ retain: index }, { insert: value, attributes }]);
  }

  delete(index: number, count = 1): CrdtCommitResult {
    return this.applyDelta([{ retain: index }, { delete: count }]);
  }

  format(index: number, length: number, attributes: JsonObject): CrdtCommitResult {
    return this.applyDelta([{ retain: index }, { retain: length, attributes }]);
  }

  clearFormat(index: number, length: number, keys?: readonly string[]): CrdtCommitResult {
    if (!Number.isSafeInteger(index) || index < 0) throw new RangeError('rich text clearFormat index must be a non-negative safe integer');
    if (!Number.isSafeInteger(length) || length < 0) throw new RangeError('rich text clearFormat length must be a non-negative safe integer');
    const before = this.value();
    const textLength = codePointLength(before.text);
    const start = Math.min(index, textLength);
    const end = Math.min(start + length, textLength);
    const spans = cloneSpans(before.spans);
    const remove = keys === undefined ? collectAttributeKeys(spans, start, end) : keys.slice();
    if (remove.length !== 0) removeFormatAttributes(spans, start, end, remove);
    const plan: RichTextPlan = {
      textOps: [],
      spans: compactSpans(spans, textLength),
      embeds: cloneEmbeds(before.embeds),
      blocks: compactBlocks(cloneBlocks(before.blocks), textLength)
    };
    return this.doc.change((tx) => {
      this.applyPlan(tx, before, plan);
    });
  }

  updateEmbed(index: number, value: JsonObject, attributes?: JsonObject): CrdtCommitResult {
    if (!Number.isSafeInteger(index) || index < 0) throw new RangeError('rich text embed index must be a non-negative safe integer');
    const before = this.value();
    const chars = Array.from(before.text);
    if (index >= chars.length || chars[index] !== EMBED_CHAR) throw new TypeError('rich text embed index must point to an embed');
    const embeds = cloneEmbeds(before.embeds);
    let updated = false;
    for (let i = 0, length = embeds.length; i < length; i++) {
      if (embeds[i].index !== index) continue;
      embeds[i] = attributes === undefined
        ? { index, value: cloneJson(value) }
        : { index, value: cloneJson(value), attributes: cloneJson(attributes) };
      updated = true;
      break;
    }
    if (!updated) {
      embeds[embeds.length] = attributes === undefined
        ? { index, value: cloneJson(value) }
        : { index, value: cloneJson(value), attributes: cloneJson(attributes) };
    }
    const textLength = chars.length;
    const plan: RichTextPlan = {
      textOps: [],
      spans: cloneSpans(before.spans),
      embeds: compactEmbeds(embeds, textLength),
      blocks: compactBlocks(cloneBlocks(before.blocks), textLength)
    };
    return this.doc.change((tx) => {
      this.applyPlan(tx, before, plan);
    });
  }

  formatBlock(index: number, attributes: JsonObject): CrdtCommitResult {
    if (!Number.isSafeInteger(index) || index < 0) throw new RangeError('rich text block index must be a non-negative safe integer');
    const before = this.value();
    const bounded = Math.min(index, codePointLength(before.text));
    const plan: RichTextPlan = {
      textOps: [],
      spans: cloneSpans(before.spans),
      embeds: cloneEmbeds(before.embeds),
      blocks: compactBlocks(upsertBlock(cloneBlocks(before.blocks), bounded, attributes), codePointLength(before.text))
    };
    return this.doc.change((tx) => {
      this.applyPlan(tx, before, plan);
    });
  }

  clearBlock(index: number): CrdtCommitResult {
    if (!Number.isSafeInteger(index) || index < 0) throw new RangeError('rich text block index must be a non-negative safe integer');
    const before = this.value();
    const bounded = Math.min(index, codePointLength(before.text));
    const plan: RichTextPlan = {
      textOps: [],
      spans: cloneSpans(before.spans),
      embeds: cloneEmbeds(before.embeds),
      blocks: compactBlocks(removeBlock(cloneBlocks(before.blocks), bounded), codePointLength(before.text))
    };
    return this.doc.change((tx) => {
      this.applyPlan(tx, before, plan);
    });
  }


  private applyPlan(tx: RichTextTx, before: CrdtRichTextValue, plan: RichTextPlan): void {
    ensureRichTextRoot(tx, this.path, before);
    const textPath = this.path.concat('text');
    for (let i = 0, length = plan.textOps.length; i < length; i++) {
      const op = plan.textOps[i];
      if (op.deleteCount === 0 && op.insert.length === 0) continue;
      tx.text(textPath).splice(op.index, op.deleteCount, op.insert);
    }
    replaceRichTextSidecarList(tx, this.path.concat('spans'), before.spans || [], plan.spans);
    replaceRichTextSidecarList(tx, this.path.concat('embeds'), before.embeds || [], plan.embeds);
    if (before.blocks !== undefined || plan.blocks.length !== 0) {
      replaceRichTextSidecarList(tx, this.path.concat('blocks'), before.blocks || [], plan.blocks);
    }
  }
}

type RichTextPlan = {
  textOps: Array<{ index: number; deleteCount: number; insert: string }>;
  spans: CrdtRichTextSpan[];
  embeds: CrdtRichTextEmbed[];
  blocks: CrdtRichTextBlock[];
};

export function normalizeCrdtRichTextPath(path: WatchPath): JsonPath {
  if (typeof path === 'string') return getCachedPointerPath(path).slice();
  if (!Array.isArray(path)) throw new TypeError('rich text path must be a JSON pointer or path array');
  return path.slice();
}

function readRichTextAt(root: JsonValue, path: JsonPath): CrdtRichTextValue {
  return normalizeRichTextValue(getPath(root, path));
}

function normalizeRichTextValue(value: JsonValue | undefined): CrdtRichTextValue {
  if (value === undefined) return { text: '', spans: [], embeds: [] };
  if (typeof value === 'string') return { text: value, spans: [], embeds: [] };
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('rich text value must be an object with a text field');
  }
  const record = value as JsonObject;
  if (typeof record.text !== 'string') throw new TypeError('rich text value must have a string text field');
  return {
    text: record.text,
    spans: normalizeSpans(record.spans),
    embeds: normalizeEmbeds(record.embeds),
    blocks: normalizeBlocks(record.blocks)
  };
}

function ensureRichTextRoot(tx: RichTextTx, path: JsonPath, before: CrdtRichTextValue): void {
  if (
    before.text.length !== 0 ||
    (before.spans && before.spans.length) ||
    (before.embeds && before.embeds.length) ||
    (before.blocks && before.blocks.length)
  ) {
    return;
  }
  tx.set(path, { text: '', spans: [], embeds: [] });
}

function replaceRichTextSidecarList(
  tx: RichTextTx,
  path: JsonPath,
  before: readonly unknown[],
  after: readonly unknown[]
): void {
  if (before.length !== 0) tx.list(path).delete(0, before.length);
  if (after.length !== 0) tx.list(path).insert(0, after.slice() as unknown as JsonValue[]);
}

function planRichTextDelta(before: CrdtRichTextValue, delta: readonly CrdtRichTextDeltaOp[]): RichTextPlan {
  let index = 0;
  let length = codePointLength(before.text);
  const spans = cloneSpans(before.spans);
  const embeds = cloneEmbeds(before.embeds);
  const blocks = cloneBlocks(before.blocks);
  const textOps: Array<{ index: number; deleteCount: number; insert: string }> = [];

  for (let i = 0, opCount = delta.length; i < opCount; i++) {
    const op = delta[i];
    if ('retain' in op) {
      const retain = normalizePositiveCount(op.retain, 'retain');
      if (op.attributes !== undefined && retain !== 0) {
        applyFormatSpan(spans, index, Math.min(index + retain, length), op.attributes);
      }
      index = Math.min(index + retain, length);
    } else if ('delete' in op) {
      const count = Math.min(normalizePositiveCount(op.delete, 'delete'), length - index);
      if (count === 0) continue;
      textOps[textOps.length] = { index, deleteCount: count, insert: '' };
      deleteRangeFromSidecars(spans, embeds, blocks, index, count);
      length -= count;
    } else if ('insert' in op) {
      const attributes = op.attributes;
      if (typeof op.insert === 'string') {
        if (op.insert.length === 0) continue;
        const count = codePointLength(op.insert);
        textOps[textOps.length] = { index, deleteCount: 0, insert: op.insert };
        shiftSidecarsForInsert(spans, embeds, blocks, index, count);
        if (attributes !== undefined) applyFormatSpan(spans, index, index + count, attributes);
        index += count;
        length += count;
      } else {
        const value = cloneJson(op.insert);
        textOps[textOps.length] = { index, deleteCount: 0, insert: EMBED_CHAR };
        shiftSidecarsForInsert(spans, embeds, blocks, index, 1);
        embeds[embeds.length] = attributes === undefined
          ? { index, value }
          : { index, value, attributes: cloneJson(attributes) };
        index++;
        length++;
      }
    }
  }

  return {
    textOps,
    spans: compactSpans(spans, length),
    embeds: compactEmbeds(embeds, length),
    blocks: compactBlocks(blocks, length)
  };
}

function richTextFromDelta(delta: readonly CrdtRichTextDeltaOp[]): CrdtRichTextValue {
  const value: CrdtRichTextValue = { text: '', spans: [], embeds: [] };
  const plan = planRichTextDelta(value, delta);
  let text = '';
  for (let i = 0, length = plan.textOps.length; i < length; i++) text += plan.textOps[i].insert;
  return {
    text,
    spans: plan.spans,
    embeds: plan.embeds
  };
}

function richTextToDelta(value: CrdtRichTextValue): CrdtRichTextDelta {
  const chars = Array.from(value.text);
  const spans = value.spans || [];
  const embeds = (value.embeds || []).slice().sort((left, right) => left.index - right.index);
  const delta: CrdtRichTextDelta = [];
  let pendingText = '';
  let pendingAttrsKey = '';
  let pendingAttrs: JsonObject | undefined;
  let embedIndex = 0;

  for (let i = 0; i < chars.length; i++) {
    const embed = embedIndex < embeds.length && embeds[embedIndex].index === i ? embeds[embedIndex++] : null;
    if (embed !== null && chars[i] === EMBED_CHAR) {
      flushDeltaText(delta, pendingText, pendingAttrs);
      pendingText = '';
      pendingAttrs = undefined;
      pendingAttrsKey = '';
      delta[delta.length] = embed.attributes === undefined
        ? { insert: cloneJson(embed.value) }
        : { insert: cloneJson(embed.value), attributes: cloneJson(embed.attributes) };
      continue;
    }
    const attrs = attributesAt(spans, i);
    const attrsKey = attrs === undefined ? '' : JSON.stringify(attrs);
    if (pendingText.length !== 0 && attrsKey !== pendingAttrsKey) {
      flushDeltaText(delta, pendingText, pendingAttrs);
      pendingText = '';
    }
    pendingText += chars[i];
    pendingAttrs = attrs;
    pendingAttrsKey = attrsKey;
  }
  flushDeltaText(delta, pendingText, pendingAttrs);
  return delta;
}

function flushDeltaText(delta: CrdtRichTextDelta, text: string, attributes: JsonObject | undefined): void {
  if (text.length === 0) return;
  delta[delta.length] = attributes === undefined ? { insert: text } : { insert: text, attributes };
}

function applyFormatSpan(spans: CrdtRichTextSpan[], start: number, end: number, attributes: JsonObject | null): void {
  if (end <= start) return;
  if (attributes === null) return;
  const add: JsonObject = {};
  const remove: string[] = [];
  const keys = Object.keys(attributes);
  for (let i = 0, length = keys.length; i < length; i++) {
    const key = keys[i];
    const value = attributes[key];
    if (value === null) remove[remove.length] = key;
    else add[key] = cloneJson(value);
  }
  if (remove.length !== 0) removeFormatAttributes(spans, start, end, remove);
  if (Object.keys(add).length !== 0) spans[spans.length] = { start, end, attributes: add };
}

function removeFormatAttributes(spans: CrdtRichTextSpan[], start: number, end: number, keys: readonly string[]): void {
  const next: CrdtRichTextSpan[] = [];
  for (let i = 0, length = spans.length; i < length; i++) {
    const span = spans[i];
    if (span.end <= start || span.start >= end || !hasAnyAttribute(span.attributes, keys)) {
      next[next.length] = span;
      continue;
    }
    if (span.start < start) {
      next[next.length] = {
        start: span.start,
        end: start,
        attributes: cloneJson(span.attributes)
      };
    }
    const midStart = Math.max(span.start, start);
    const midEnd = Math.min(span.end, end);
    const midAttributes = cloneWithoutAttributes(span.attributes, keys);
    if (midStart < midEnd && Object.keys(midAttributes).length !== 0) {
      next[next.length] = { start: midStart, end: midEnd, attributes: midAttributes };
    }
    if (span.end > end) {
      next[next.length] = {
        start: end,
        end: span.end,
        attributes: cloneJson(span.attributes)
      };
    }
  }
  spans.length = 0;
  for (let i = 0, length = next.length; i < length; i++) spans[i] = next[i];
}

function collectAttributeKeys(spans: readonly CrdtRichTextSpan[], start: number, end: number): string[] {
  if (end <= start) return [];
  const keys = new Set<string>();
  for (let i = 0, length = spans.length; i < length; i++) {
    const span = spans[i];
    if (span.end <= start || span.start >= end) continue;
    const names = Object.keys(span.attributes);
    for (let j = 0, nameCount = names.length; j < nameCount; j++) keys.add(names[j]);
  }
  return Array.from(keys);
}

function hasAnyAttribute(attributes: JsonObject, keys: readonly string[]): boolean {
  for (let i = 0, length = keys.length; i < length; i++) {
    if (Object.prototype.hasOwnProperty.call(attributes, keys[i])) return true;
  }
  return false;
}

function cloneWithoutAttributes(attributes: JsonObject, keys: readonly string[]): JsonObject {
  const out = cloneJson(attributes);
  for (let i = 0, length = keys.length; i < length; i++) delete out[keys[i]];
  return out;
}

function shiftSidecarsForInsert(
  spans: CrdtRichTextSpan[],
  embeds: CrdtRichTextEmbed[],
  blocks: CrdtRichTextBlock[],
  index: number,
  count: number
): void {
  for (let i = 0, length = spans.length; i < length; i++) {
    const span = spans[i];
    if (span.start >= index) {
      span.start += count;
      span.end += count;
    } else if (span.end > index) {
      span.end += count;
    }
  }
  for (let i = 0, length = embeds.length; i < length; i++) {
    if (embeds[i].index >= index) embeds[i].index += count;
  }
  for (let i = 0, length = blocks.length; i < length; i++) {
    if (blocks[i].index >= index) blocks[i].index += count;
  }
}

function deleteRangeFromSidecars(
  spans: CrdtRichTextSpan[],
  embeds: CrdtRichTextEmbed[],
  blocks: CrdtRichTextBlock[],
  index: number,
  count: number
): void {
  const end = index + count;
  for (let i = spans.length - 1; i >= 0; i--) {
    const span = spans[i];
    if (span.end <= index) continue;
    if (span.start >= end) {
      span.start -= count;
      span.end -= count;
      continue;
    }
    if (span.start < index && span.end > end) {
      span.end -= count;
    } else if (span.start < index) {
      span.end = index;
    } else if (span.end > end) {
      span.start = index;
      span.end -= count;
    } else {
      spans.splice(i, 1);
    }
  }
  for (let i = embeds.length - 1; i >= 0; i--) {
    const embed = embeds[i];
    if (embed.index >= end) embed.index -= count;
    else if (embed.index >= index) embeds.splice(i, 1);
  }
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (block.index >= end) block.index -= count;
    else if (block.index >= index) blocks.splice(i, 1);
  }
}

function attributesAt(spans: readonly CrdtRichTextSpan[], index: number): JsonObject | undefined {
  let out: JsonObject | undefined;
  for (let i = 0, length = spans.length; i < length; i++) {
    const span = spans[i];
    if (index < span.start || index >= span.end) continue;
    if (out === undefined) out = {};
    Object.assign(out, span.attributes);
  }
  return out;
}

function normalizeSpans(value: JsonValue | undefined): CrdtRichTextSpan[] {
  if (!Array.isArray(value)) return [];
  const spans: CrdtRichTextSpan[] = [];
  for (let i = 0, length = value.length; i < length; i++) {
    const item = value[i];
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue;
    const span = item as JsonObject;
    if (!Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.end) || span.end <= span.start) continue;
    if (span.attributes === null || typeof span.attributes !== 'object' || Array.isArray(span.attributes)) continue;
    spans[spans.length] = {
      start: span.start as number,
      end: span.end as number,
      attributes: cloneJson(span.attributes as JsonObject)
    };
  }
  return spans;
}

function normalizeEmbeds(value: JsonValue | undefined): CrdtRichTextEmbed[] {
  if (!Array.isArray(value)) return [];
  const embeds: CrdtRichTextEmbed[] = [];
  for (let i = 0, length = value.length; i < length; i++) {
    const item = value[i];
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue;
    const embed = item as JsonObject;
    const index = embed.index;
    if (!Number.isSafeInteger(index) || (index as number) < 0) continue;
    if (embed.value === null || typeof embed.value !== 'object' || Array.isArray(embed.value)) continue;
    const entry: CrdtRichTextEmbed = {
      index: index as number,
      value: cloneJson(embed.value as JsonObject)
    };
    if (embed.attributes !== undefined && embed.attributes !== null && typeof embed.attributes === 'object' && !Array.isArray(embed.attributes)) {
      entry.attributes = cloneJson(embed.attributes as JsonObject);
    }
    embeds[embeds.length] = entry;
  }
  return embeds;
}

function normalizeBlocks(value: JsonValue | undefined): CrdtRichTextValue['blocks'] {
  if (!Array.isArray(value)) return undefined;
  const blocks: CrdtRichTextBlock[] = [];
  for (let i = 0, length = value.length; i < length; i++) {
    const item = value[i];
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue;
    const block = item as JsonObject;
    const index = block.index;
    const attributes = block.attributes;
    if (!Number.isSafeInteger(index) || (index as number) < 0) continue;
    if (attributes === null || typeof attributes !== 'object' || Array.isArray(attributes)) continue;
    blocks[blocks.length] = {
      index: index as number,
      attributes: cloneJson(attributes as JsonObject)
    };
  }
  return blocks;
}

function cloneSpans(value: CrdtRichTextSpan[] | undefined): CrdtRichTextSpan[] {
  return value === undefined ? [] : value.map((span) => ({ start: span.start, end: span.end, attributes: cloneJson(span.attributes) }));
}

function cloneEmbeds(value: CrdtRichTextEmbed[] | undefined): CrdtRichTextEmbed[] {
  return value === undefined
    ? []
    : value.map((embed) => {
        const out: CrdtRichTextEmbed = { index: embed.index, value: cloneJson(embed.value) };
        if (embed.attributes !== undefined) out.attributes = cloneJson(embed.attributes);
        return out;
      });
}

function cloneBlocks(value: CrdtRichTextValue['blocks']): CrdtRichTextBlock[] {
  return value === undefined
    ? []
    : value.map((block) => ({
        index: block.index,
        attributes: cloneJson(block.attributes)
      }));
}

function compactSpans(spans: CrdtRichTextSpan[], length: number): CrdtRichTextSpan[] {
  const out: CrdtRichTextSpan[] = [];
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    const start = Math.max(0, Math.min(length, span.start));
    const end = Math.max(start, Math.min(length, span.end));
    if (end > start && Object.keys(span.attributes).length !== 0) {
      out[out.length] = { start, end, attributes: cloneJson(span.attributes) };
    }
  }
  out.sort(compareRichTextSpans);
  return out;
}

function compareRichTextSpans(left: CrdtRichTextSpan, right: CrdtRichTextSpan): number {
  return left.start - right.start ||
    left.end - right.end ||
    JSON.stringify(left.attributes).localeCompare(JSON.stringify(right.attributes));
}

function compactEmbeds(embeds: CrdtRichTextEmbed[], length: number): CrdtRichTextEmbed[] {
  const out: CrdtRichTextEmbed[] = [];
  for (let i = 0; i < embeds.length; i++) {
    const embed = embeds[i];
    if (embed.index < 0 || embed.index >= length) continue;
    const entry: CrdtRichTextEmbed = { index: embed.index, value: cloneJson(embed.value) };
    if (embed.attributes !== undefined) entry.attributes = cloneJson(embed.attributes);
    out[out.length] = entry;
  }
  out.sort((left, right) => left.index - right.index);
  return out;
}

function compactBlocks(blocks: CrdtRichTextBlock[], length: number): CrdtRichTextBlock[] {
  const out: CrdtRichTextBlock[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.index < 0 || block.index > length || Object.keys(block.attributes).length === 0) continue;
    out[out.length] = { index: block.index, attributes: cloneJson(block.attributes) };
  }
  out.sort((left, right) => left.index - right.index);
  for (let i = out.length - 1; i > 0; i--) {
    if (out[i].index === out[i - 1].index) out.splice(i - 1, 1);
  }
  return out;
}

function upsertBlock(blocks: CrdtRichTextBlock[], index: number, attributes: JsonObject): CrdtRichTextBlock[] {
  const next = cloneJson(attributes);
  for (let i = 0, length = blocks.length; i < length; i++) {
    if (blocks[i].index === index) {
      blocks[i] = { index, attributes: next };
      return blocks;
    }
  }
  blocks[blocks.length] = { index, attributes: next };
  return blocks;
}

function removeBlock(blocks: CrdtRichTextBlock[], index: number): CrdtRichTextBlock[] {
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].index === index) blocks.splice(i, 1);
  }
  return blocks;
}

function normalizePositiveCount(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('rich text ' + name + ' must be a non-negative safe integer');
  return value;
}

function codePointLength(value: string): number {
  return value.length < 2 ? value.length : Array.from(value).length;
}
