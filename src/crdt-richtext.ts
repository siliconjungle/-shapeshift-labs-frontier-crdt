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
  CrdtRichTextExpand,
  CrdtRichTextFormatOptions,
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
const NON_EXPANDING_MARK_KEYS = new Set(['link', 'href', 'comment', 'mention']);

type RichTextDoc = Pick<CrdtDocument, 'actorId' | 'toJSON' | 'getStateVector' | 'change' | 'createCursor' | 'resolveCursor' | 'createSelection' | 'resolveSelection'>;
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
    return resolveRichTextValue(this.doc, this.path, this.rawValue());
  }

  private rawValue(): CrdtRichTextValue {
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
    const before = this.rawValue();
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
    const before = this.rawValue();
    const plan = planRichTextDelta(resolveRichTextValue(this.doc, this.path, before), delta);
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

  format(index: number, length: number, attributes: JsonObject, options?: CrdtRichTextFormatOptions): CrdtCommitResult {
    if (!Number.isSafeInteger(index) || index < 0) throw new RangeError('rich text format index must be a non-negative safe integer');
    if (!Number.isSafeInteger(length) || length < 0) throw new RangeError('rich text format length must be a non-negative safe integer');
    const before = this.rawValue();
    const visible = resolveRichTextValue(this.doc, this.path, before);
    const textLength = codePointLength(visible.text);
    const start = Math.min(index, textLength);
    const end = Math.min(start + length, textLength);
    if (end <= start || Object.keys(attributes).length === 0) return this.doc.change(() => {});
    const span = createAnchoredSpan(this.doc, this.path, start, end, attributes, options, 0);
    return this.doc.change((tx) => {
      ensureRichTextRoot(tx, this.path, before);
      appendRichTextSidecarList(tx, this.path.concat('spans'), before.spans || [], [span]);
    });
  }

  clearFormat(index: number, length: number, keys?: readonly string[]): CrdtCommitResult {
    if (!Number.isSafeInteger(index) || index < 0) throw new RangeError('rich text clearFormat index must be a non-negative safe integer');
    if (!Number.isSafeInteger(length) || length < 0) throw new RangeError('rich text clearFormat length must be a non-negative safe integer');
    const before = this.rawValue();
    const visible = resolveRichTextValue(this.doc, this.path, before);
    const textLength = codePointLength(visible.text);
    const start = Math.min(index, textLength);
    const end = Math.min(start + length, textLength);
    const remove = keys === undefined ? collectAttributeKeys(visible.spans || [], start, end) : keys.slice();
    if (end <= start || remove.length === 0) return this.doc.change(() => {});
    const attributes = keysToNullAttributes(remove);
    const span = createAnchoredSpan(this.doc, this.path, start, end, attributes, { expand: 'none' }, 0);
    return this.doc.change((tx) => {
      ensureRichTextRoot(tx, this.path, before);
      if (remove.length !== 0) appendRichTextSidecarList(tx, this.path.concat('spans'), before.spans || [], [span]);
    });
  }

  updateEmbed(index: number, value: JsonObject, attributes?: JsonObject): CrdtCommitResult {
    if (!Number.isSafeInteger(index) || index < 0) throw new RangeError('rich text embed index must be a non-negative safe integer');
    const before = this.rawValue();
    const visible = resolveRichTextValue(this.doc, this.path, before);
    const chars = Array.from(visible.text);
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
      spans: undefined,
      embeds: compactEmbeds(embeds, textLength),
      blocks: undefined
    };
    return this.doc.change((tx) => {
      this.applyPlan(tx, before, plan);
    });
  }

  formatBlock(index: number, attributes: JsonObject): CrdtCommitResult {
    if (!Number.isSafeInteger(index) || index < 0) throw new RangeError('rich text block index must be a non-negative safe integer');
    const before = this.rawValue();
    const visible = resolveRichTextValue(this.doc, this.path, before);
    const bounded = Math.min(index, codePointLength(visible.text));
    const plan: RichTextPlan = {
      textOps: [],
      spans: undefined,
      embeds: undefined,
      blocks: compactBlocks(upsertBlock(cloneBlocks(visible.blocks), bounded, attributes), codePointLength(visible.text))
    };
    return this.doc.change((tx) => {
      this.applyPlan(tx, before, plan);
    });
  }

  clearBlock(index: number): CrdtCommitResult {
    if (!Number.isSafeInteger(index) || index < 0) throw new RangeError('rich text block index must be a non-negative safe integer');
    const before = this.rawValue();
    const visible = resolveRichTextValue(this.doc, this.path, before);
    const bounded = Math.min(index, codePointLength(visible.text));
    const plan: RichTextPlan = {
      textOps: [],
      spans: undefined,
      embeds: undefined,
      blocks: compactBlocks(removeBlock(cloneBlocks(visible.blocks), bounded), codePointLength(visible.text))
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
    if (plan.spans !== undefined) replaceRichTextSidecarList(tx, this.path.concat('spans'), before.spans || [], plan.spans);
    if (plan.embeds !== undefined) replaceRichTextSidecarList(tx, this.path.concat('embeds'), before.embeds || [], plan.embeds);
    if (plan.blocks !== undefined && (before.blocks !== undefined || plan.blocks.length !== 0)) {
      replaceRichTextSidecarList(tx, this.path.concat('blocks'), before.blocks || [], plan.blocks);
    }
  }
}

type RichTextPlan = {
  textOps: Array<{ index: number; deleteCount: number; insert: string }>;
  spans?: CrdtRichTextSpan[];
  embeds?: CrdtRichTextEmbed[];
  blocks?: CrdtRichTextBlock[];
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

function resolveRichTextValue(doc: RichTextDoc, path: JsonPath, value: CrdtRichTextValue): CrdtRichTextValue {
  const textLength = codePointLength(value.text);
  const spans = compactSpans(resolveAnchoredSpans(doc, value.spans), textLength);
  return {
    text: value.text,
    spans: materializeVisibleSpans(spans, textLength),
    embeds: compactEmbeds(cloneEmbeds(value.embeds), textLength),
    blocks: compactBlocks(cloneBlocks(value.blocks), textLength)
  };
}

function resolveAnchoredSpans(doc: RichTextDoc, spans: CrdtRichTextSpan[] | undefined): CrdtRichTextSpan[] {
  if (spans === undefined || spans.length === 0) return [];
  const resolved = new Array<CrdtRichTextSpan>(spans.length);
  for (let i = 0, length = spans.length; i < length; i++) {
    const span = spans[i];
    let start = span.start;
    let end = span.end;
    if (span.range !== undefined) {
      const selection = doc.resolveSelection(span.range);
      if (selection.found) {
        start = Math.min(selection.anchor, selection.focus);
        end = Math.max(selection.anchor, selection.focus);
      }
    }
    const out: CrdtRichTextSpan = { start, end, attributes: cloneJson(span.attributes) };
    if (span.id !== undefined) out.id = span.id;
    if (span.range !== undefined) out.range = cloneRichTextSelection(span.range);
    if (span.expand !== undefined) out.expand = span.expand;
    resolved[i] = out;
  }
  return resolved;
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

function appendRichTextSidecarList(
  tx: RichTextTx,
  path: JsonPath,
  before: readonly unknown[],
  entries: readonly unknown[]
): void {
  if (entries.length !== 0) tx.list(path).insert(before.length, entries.slice() as unknown as JsonValue[]);
}

function planRichTextDelta(before: CrdtRichTextValue, delta: readonly CrdtRichTextDeltaOp[]): RichTextPlan {
  let index = 0;
  let length = codePointLength(before.text);
  const spans = cloneSpans(before.spans);
  const embeds = cloneEmbeds(before.embeds);
  const blocks = cloneBlocks(before.blocks);
  const textOps: Array<{ index: number; deleteCount: number; insert: string }> = [];
  let spansChanged = false;
  let embedsChanged = false;
  let blocksChanged = false;

  for (let i = 0, opCount = delta.length; i < opCount; i++) {
    const op = delta[i];
    if ('retain' in op) {
      const retain = normalizePositiveCount(op.retain, 'retain');
      if (op.attributes !== undefined && retain !== 0) {
        applyFormatSpan(spans, index, Math.min(index + retain, length), op.attributes);
        spansChanged = true;
      }
      index = Math.min(index + retain, length);
    } else if ('delete' in op) {
      const count = Math.min(normalizePositiveCount(op.delete, 'delete'), length - index);
      if (count === 0) continue;
      textOps[textOps.length] = { index, deleteCount: count, insert: '' };
      const changed = deleteRangeFromSidecars(spans, embeds, blocks, index, count);
      spansChanged ||= changed.spans;
      embedsChanged ||= changed.embeds;
      blocksChanged ||= changed.blocks;
      length -= count;
    } else if ('insert' in op) {
      const attributes = op.attributes;
      if (typeof op.insert === 'string') {
        if (op.insert.length === 0) continue;
        const count = codePointLength(op.insert);
        textOps[textOps.length] = { index, deleteCount: 0, insert: op.insert };
        const changed = shiftSidecarsForInsert(spans, embeds, blocks, index, count);
        spansChanged ||= changed.spans;
        embedsChanged ||= changed.embeds;
        blocksChanged ||= changed.blocks;
        if (attributes !== undefined) {
          applyFormatSpan(spans, index, index + count, attributes);
          spansChanged = true;
        }
        index += count;
        length += count;
      } else {
        const value = cloneJson(op.insert);
        textOps[textOps.length] = { index, deleteCount: 0, insert: EMBED_CHAR };
        const changed = shiftSidecarsForInsert(spans, embeds, blocks, index, 1);
        spansChanged ||= changed.spans;
        embedsChanged = true;
        blocksChanged ||= changed.blocks;
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
    spans: spansChanged ? compactSpans(spans, length) : undefined,
    embeds: embedsChanged ? compactEmbeds(embeds, length) : undefined,
    blocks: blocksChanged ? compactBlocks(blocks, length) : undefined
  };
}

function richTextFromDelta(delta: readonly CrdtRichTextDeltaOp[]): CrdtRichTextValue {
  const value: CrdtRichTextValue = { text: '', spans: [], embeds: [] };
  const plan = planRichTextDelta(value, delta);
  let text = '';
  for (let i = 0, length = plan.textOps.length; i < length; i++) text += plan.textOps[i].insert;
  return {
    text,
    spans: plan.spans || [],
    embeds: plan.embeds || []
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

function createAnchoredSpan(
  doc: RichTextDoc,
  path: JsonPath,
  start: number,
  end: number,
  attributes: JsonObject,
  options: CrdtRichTextFormatOptions | undefined,
  salt: number
): CrdtRichTextSpan {
  const expand = normalizeRichTextExpand(options?.expand, attributes);
  const selection = createExpandedSelection(doc, path, start, end, expand);
  const span: CrdtRichTextSpan = {
    id: options && options.id !== undefined ? options.id : nextRichTextSpanId(doc, salt),
    start,
    end,
    attributes: cloneJson(attributes),
    range: selection,
    expand
  };
  return span;
}

function createExpandedSelection(
  doc: RichTextDoc,
  path: JsonPath,
  start: number,
  end: number,
  expand: CrdtRichTextExpand
): CrdtTextSelection {
  const textPath = path.concat('text');
  if (expand === 'both') return doc.createSelection(textPath, start, end, { anchorAssoc: -1, focusAssoc: 1 });
  if (expand === 'before') return doc.createSelection(textPath, start, end, { anchorAssoc: -1, focusAssoc: -1 });
  if (expand === 'none') return doc.createSelection(textPath, start, end, { anchorAssoc: 1, focusAssoc: -1 });
  return doc.createSelection(textPath, start, end, { anchorAssoc: 1, focusAssoc: 1 });
}

function normalizeRichTextExpand(value: CrdtRichTextExpand | undefined, attributes: JsonObject): CrdtRichTextExpand {
  if (value !== undefined) {
    if (value !== 'after' && value !== 'before' && value !== 'none' && value !== 'both') throw new TypeError('invalid rich text expand policy');
    return value;
  }
  const keys = Object.keys(attributes);
  if (keys.length !== 0 && keys.every((key) => NON_EXPANDING_MARK_KEYS.has(key))) return 'none';
  return 'after';
}

function nextRichTextSpanId(doc: RichTextDoc, salt: number): string {
  const actor = doc.actorId;
  const seq = (doc.getStateVector()[actor] || 0) + 1;
  return actor + ':' + seq + (salt === 0 ? '' : '/' + salt);
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

function keysToNullAttributes(keys: readonly string[]): JsonObject {
  const attributes: JsonObject = {};
  for (let i = 0, length = keys.length; i < length; i++) attributes[keys[i]] = null;
  return attributes;
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
): { spans: boolean; embeds: boolean; blocks: boolean } {
  let spansChanged = false;
  let embedsChanged = false;
  let blocksChanged = false;
  for (let i = 0, length = spans.length; i < length; i++) {
    const span = spans[i];
    if (span.range !== undefined) continue;
    if (span.start >= index) {
      span.start += count;
      span.end += count;
      spansChanged = true;
    } else if (span.end > index) {
      span.end += count;
      spansChanged = true;
    }
  }
  for (let i = 0, length = embeds.length; i < length; i++) {
    if (embeds[i].index >= index) {
      embeds[i].index += count;
      embedsChanged = true;
    }
  }
  for (let i = 0, length = blocks.length; i < length; i++) {
    if (blocks[i].index >= index) {
      blocks[i].index += count;
      blocksChanged = true;
    }
  }
  return { spans: spansChanged, embeds: embedsChanged, blocks: blocksChanged };
}

function deleteRangeFromSidecars(
  spans: CrdtRichTextSpan[],
  embeds: CrdtRichTextEmbed[],
  blocks: CrdtRichTextBlock[],
  index: number,
  count: number
): { spans: boolean; embeds: boolean; blocks: boolean } {
  const end = index + count;
  let spansChanged = false;
  let embedsChanged = false;
  let blocksChanged = false;
  for (let i = spans.length - 1; i >= 0; i--) {
    const span = spans[i];
    if (span.range !== undefined) continue;
    if (span.end <= index) continue;
    if (span.start >= end) {
      span.start -= count;
      span.end -= count;
      spansChanged = true;
      continue;
    }
    if (span.start < index && span.end > end) {
      span.end -= count;
      spansChanged = true;
    } else if (span.start < index) {
      span.end = index;
      spansChanged = true;
    } else if (span.end > end) {
      span.start = index;
      span.end -= count;
      spansChanged = true;
    } else {
      spans.splice(i, 1);
      spansChanged = true;
    }
  }
  for (let i = embeds.length - 1; i >= 0; i--) {
    const embed = embeds[i];
    if (embed.index >= end) {
      embed.index -= count;
      embedsChanged = true;
    } else if (embed.index >= index) {
      embeds.splice(i, 1);
      embedsChanged = true;
    }
  }
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (block.index >= end) {
      block.index -= count;
      blocksChanged = true;
    } else if (block.index >= index) {
      blocks.splice(i, 1);
      blocksChanged = true;
    }
  }
  return { spans: spansChanged, embeds: embedsChanged, blocks: blocksChanged };
}

function materializeVisibleSpans(spans: readonly CrdtRichTextSpan[], length: number): CrdtRichTextSpan[] {
  if (spans.length === 0 || length === 0) return [];
  const out: CrdtRichTextSpan[] = [];
  let currentKey = '';
  let currentAttrs: JsonObject | undefined;
  let currentStart = 0;
  for (let i = 0; i < length; i++) {
    const attrs = attributesAt(spans, i);
    const key = attrs === undefined ? '' : JSON.stringify(attrs);
    if (i !== 0 && key === currentKey) continue;
    if (currentAttrs !== undefined && currentStart < i) {
      out[out.length] = { start: currentStart, end: i, attributes: currentAttrs };
    }
    currentStart = i;
    currentKey = key;
    currentAttrs = attrs;
  }
  if (currentAttrs !== undefined && currentStart < length) {
    out[out.length] = { start: currentStart, end: length, attributes: currentAttrs };
  }
  return out;
}

function attributesAt(spans: readonly CrdtRichTextSpan[], index: number): JsonObject | undefined {
  let active: CrdtRichTextSpan[] | undefined;
  for (let i = 0, length = spans.length; i < length; i++) {
    const span = spans[i];
    if (index < span.start || index >= span.end) continue;
    if (active === undefined) active = [];
    active[active.length] = span;
  }
  if (active === undefined) return undefined;
  active.sort(compareRichTextSpanPriority);
  const out: JsonObject = {};
  for (let i = 0, length = active.length; i < length; i++) {
    const span = active[i];
    const keys = Object.keys(span.attributes);
    for (let j = 0, keyCount = keys.length; j < keyCount; j++) {
      const key = keys[j];
      const value = span.attributes[key];
      if (value === null) delete out[key];
      else out[key] = cloneJson(value);
    }
  }
  if (Object.keys(out).length === 0) return undefined;
  return out;
}

function compareRichTextSpanPriority(left: CrdtRichTextSpan, right: CrdtRichTextSpan): number {
  const leftClock = parseRichTextSpanId(left.id);
  const rightClock = parseRichTextSpanId(right.id);
  if (leftClock.seq !== rightClock.seq) return leftClock.seq - rightClock.seq;
  if (leftClock.actor !== rightClock.actor) return leftClock.actor < rightClock.actor ? -1 : 1;
  return compareRichTextSpans(left, right);
}

function parseRichTextSpanId(id: string | undefined): { actor: string; seq: number } {
  if (id === undefined) return { actor: '', seq: 0 };
  const colon = id.lastIndexOf(':');
  if (colon === -1) return { actor: id, seq: 0 };
  let end = id.indexOf('/', colon + 1);
  if (end === -1) end = id.length;
  const seq = Number(id.slice(colon + 1, end));
  return { actor: id.slice(0, colon), seq: Number.isSafeInteger(seq) && seq >= 0 ? seq : 0 };
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
    const entry: CrdtRichTextSpan = {
      start: span.start as number,
      end: span.end as number,
      attributes: cloneJson(span.attributes as JsonObject)
    };
    if (typeof span.id === 'string' && span.id.length !== 0) entry.id = span.id;
    const expand = span.expand;
    if (expand === 'after' || expand === 'before' || expand === 'none' || expand === 'both') entry.expand = expand;
    if (isRichTextSelection(span.range)) entry.range = cloneRichTextSelection(span.range);
    spans[spans.length] = entry;
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
  return value === undefined
    ? []
    : value.map((span) => {
        const out: CrdtRichTextSpan = { start: span.start, end: span.end, attributes: cloneJson(span.attributes) };
        if (span.id !== undefined) out.id = span.id;
        if (span.range !== undefined) out.range = cloneRichTextSelection(span.range);
        if (span.expand !== undefined) out.expand = span.expand;
        return out;
      });
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
      const entry: CrdtRichTextSpan = { start, end, attributes: cloneJson(span.attributes) };
      if (span.id !== undefined) entry.id = span.id;
      if (span.range !== undefined) entry.range = cloneRichTextSelection(span.range);
      if (span.expand !== undefined) entry.expand = span.expand;
      out[out.length] = entry;
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

function isRichTextSelection(value: unknown): value is CrdtTextSelection {
  if (value === null || typeof value !== 'object') return false;
  const selection = value as Partial<CrdtTextSelection>;
  return selection.type === 'text-selection' &&
    isRichTextCursor(selection.anchor) &&
    isRichTextCursor(selection.focus);
}

function isRichTextCursor(value: unknown): value is CrdtTextCursor {
  if (value === null || typeof value !== 'object') return false;
  const cursor = value as Partial<CrdtTextCursor>;
  return cursor.type === 'text' &&
    Array.isArray(cursor.path) &&
    (cursor.anchor === null || typeof cursor.anchor === 'string') &&
    (cursor.side === 'start' || cursor.side === 'end' || cursor.side === 'before' || cursor.side === 'after') &&
    typeof cursor.assoc === 'number' &&
    Number.isSafeInteger(cursor.index);
}

function cloneRichTextSelection(selection: CrdtTextSelection): CrdtTextSelection {
  return {
    type: 'text-selection',
    anchor: cloneRichTextCursor(selection.anchor),
    focus: cloneRichTextCursor(selection.focus)
  };
}

function cloneRichTextCursor(cursor: CrdtTextCursor): CrdtTextCursor {
  return {
    type: 'text',
    path: cursor.path.slice(),
    anchor: cursor.anchor,
    side: cursor.side,
    assoc: cursor.assoc,
    index: cursor.index
  };
}

function normalizePositiveCount(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('rich text ' + name + ' must be a non-negative safe integer');
  return value;
}

function codePointLength(value: string): number {
  return value.length < 2 ? value.length : Array.from(value).length;
}
