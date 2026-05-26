import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const args = parseArgs(process.argv.slice(2));
const rounds = readPositiveInt(args.rounds, 9);
const outPath = args.out ? path.resolve(rootDir, args.out) : null;
let sink = 0;

function measure(fn, inner) {
  for (let i = 0; i < inner; i++) fn();
  const samples = new Array(rounds);
  for (let roundIndex = 0; roundIndex < rounds; roundIndex++) {
    const start = performance.now();
    for (let i = 0; i < inner; i++) fn();
    samples[roundIndex] = ((performance.now() - start) * 1000) / inner;
  }
  samples.sort((left, right) => left - right);
  return { median: percentile(samples, 0.5), p95: percentile(samples, 0.95) };
}
function measureRetained(factory, inner) {
  for (let i = 0; i < Math.min(inner, 8); i++) consume(factory());
  const timeSamples = new Array(rounds);
  const heapSamples = new Array(rounds);
  for (let roundIndex = 0; roundIndex < rounds; roundIndex++) {
    runGc();
    const before = process.memoryUsage().heapUsed;
    const retained = new Array(inner);
    const start = performance.now();
    for (let i = 0; i < inner; i++) retained[i] = factory();
    timeSamples[roundIndex] = ((performance.now() - start) * 1000) / inner;
    runGc();
    heapSamples[roundIndex] = Math.max(0, process.memoryUsage().heapUsed - before) / inner;
    for (let i = 0; i < retained.length; i++) consume(retained[i]);
    retained.length = 0;
  }
  timeSamples.sort((left, right) => left - right);
  heapSamples.sort((left, right) => left - right);
  return {
    median: percentile(timeSamples, 0.5),
    p95: percentile(timeSamples, 0.95),
    heap: percentile(heapSamples, 0.5)
  };
}
function runRow(name, inner, fn, extra = {}) {
  const timing = measure(fn, inner);
  return { fixture: name, medianUs: round(timing.median), p95Us: round(timing.p95), ...extra };
}
function runRetainedRow(name, inner, factory, extra = {}) {
  const timing = measureRetained(factory, inner);
  return {
    fixture: name,
    medianUs: round(timing.median),
    p95Us: round(timing.p95),
    heapBytes: Math.round(timing.heap),
    ...extra
  };
}
function printReport(report) {
  const hasHeap = report.rows.some((row) => row.heapBytes !== undefined);
  console.log(report.package + ' package benchmark');
  console.log('Node ' + report.node + ' on ' + report.platform + ', rounds=' + rounds);
  console.log('These are Frontier-only package measurements, not competitor comparisons.');
  console.log('');
  console.log(padRight('Fixture', 44) + padLeft('Median', 12) + padLeft('p95', 11) + (hasHeap ? padLeft('Heap/op', 12) : ''));
  for (const row of report.rows) {
    console.log(
      padRight(row.fixture, 44) +
      padLeft(formatUs(row.medianUs), 12) +
      padLeft(formatUs(row.p95Us), 11) +
      (hasHeap ? padLeft(row.heapBytes === undefined ? '-' : formatBytes(row.heapBytes), 12) : '')
    );
  }
  if (outPath) console.log('\nwrote ' + path.relative(rootDir, outPath));
}
function finish(packageName, rows) {
  const report = { package: packageName, version: readPackageVersion(), generatedAt: new Date().toISOString(), node: process.version, platform: process.platform + ' ' + process.arch, rounds, rows };
  if (outPath) { fs.mkdirSync(path.dirname(outPath), { recursive: true }); fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n'); }
  printReport(report);
  if (sink === 42) console.log('sink=' + sink);
}
function percentile(sorted, fraction) { return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))]; }
function readPackageVersion() { return JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')).version; }
function parseArgs(argv) { const out = {}; for (let i = 0; i < argv.length; i++) { const arg = argv[i]; if (arg === '--rounds') out.rounds = argv[++i]; else if (arg === '--out') out.out = argv[++i]; else if (arg === '--help' || arg === '-h') { console.log('Usage: npm run bench -- [--rounds 9] [--out benchmarks/results/package-bench.json]'); process.exit(0); } else throw new Error('unknown argument: ' + arg); } return out; }
function readPositiveInt(value, fallback) { if (value === undefined) return fallback; const number = Number(value); if (!Number.isInteger(number) || number <= 0) throw new Error('expected positive integer, got ' + value); return number; }
function round(value) { return Math.round(value * 100) / 100; }
function formatUs(value) { return value >= 1000 ? (value / 1000).toFixed(2) + ' ms' : value.toFixed(2) + ' us'; }
function formatBytes(value) {
  if (value >= 1024 * 1024) return (value / (1024 * 1024)).toFixed(2) + ' MiB';
  if (value >= 1024) return (value / 1024).toFixed(2) + ' KiB';
  return String(value) + ' B';
}
function padRight(value, width) { return String(value).padEnd(width); }
function padLeft(value, width) { return String(value).padStart(width); }
function runGc() { if (typeof globalThis.gc === 'function') globalThis.gc(); }
function consume(value) {
  if (value === null || value === undefined) return;
  if (value instanceof Uint8Array) {
    sink += value.byteLength;
  } else if (typeof value.toJSON === 'function') {
    sink += JSON.stringify(value.toJSON()).length;
  } else if (typeof value === 'object') {
    sink += Object.keys(value).length;
  }
}

import { createCrdtDocument } from '../dist/index.js';
import {
  decodeCrdtUpdate,
  encodeCrdtUpdate,
  encodeCrdtUpdateWithProfile,
  inspectCrdtUpdate,
  mergeCrdtUpdates
} from '../dist/crdt-update.js';

const richDeltaFixture = (() => {
  const doc = makeRichTextDoc();
  const rich = doc.richText('/doc');
  rich.format(0, 5, { bold: true }, { expand: 'after' });
  rich.format(6, 11, { italic: true }, { expand: 'after' });
  rich.format(17, 25, { link: 'https://frontier.local' }, { expand: 'none' });
  return doc;
})();
const gridCodecFixture = makeGridCodecFixture();
const frameFixture = makeFrameFixture();

const rows = [
  runRow('Local text insert transaction', 500, () => { const doc = createCrdtDocument({ actorId: 'bench-a' }); doc.text('/body').insert(0, 'frontier'); sink += doc.toJSON().body.length; }),
  runRow('Transaction create/move/read locals', 500, () => { const doc = createCrdtDocument({ actorId: 'bench-tx-local-' + (++sink) }); doc.change((tx) => { tx.list('/items').insert(0, ['a', 'b']); tx.list('/items').move(0, 2, 1); tx.binary('/blob').set(new Uint8Array([1, 2, 3])); sink += tx.binary('/blob').get()?.byteLength || 0; }); sink += doc.toJSON().items.length; }),
  runRow('Frame evaluate, 8 watched paths', 1000, () => { const result = frameFixture.doc.evaluateFrame(frameFixture.frame); if (!result.ok) throw new Error('frame fixture became stale'); sink += result.checkedPaths.length + result.changedPaths.length; }),
  runRow('Incremental text typing, 100 chars', 80, () => { const doc = createCrdtDocument({ actorId: 'bench-type' }); const text = doc.text('/body'); for (let i = 0; i < 100; i++) text.insert(i, 'x'); sink += doc.toJSON().body.length; }),
  runRow('Profile learn grid workload', 200, () => { sink += makeGridProfile().workloads?.length || 0; }),
  runRow('Auto grid update encode, 8 cells', 1000, () => { sink += encodeCrdtUpdate(gridCodecFixture.update).byteLength; }, { bytes: gridCodecFixture.autoBytes }),
  runRow('Profile-guided grid update encode, 8 cells', 1000, () => { sink += encodeCrdtUpdateWithProfile(gridCodecFixture.update, gridCodecFixture.profile).byteLength; }, { bytes: gridCodecFixture.profiledBytes, controlBytes: gridCodecFixture.autoBytes }),
  runRow('Auto grid update apply, 8 cells', 500, () => { const doc = createCrdtDocument({ actorId: 'bench-grid-apply-auto' }); doc.applyUpdate(gridCodecFixture.autoBytesUpdate); sink += doc.toJSON().grid.r0.c0; }, { bytes: gridCodecFixture.autoBytes }),
  runRow('Profile-guided grid update apply, 8 cells', 500, () => { const doc = createCrdtDocument({ actorId: 'bench-grid-apply-profiled' }); doc.applyUpdate(gridCodecFixture.profiledUpdate); sink += doc.toJSON().grid.r0.c0; }, { bytes: gridCodecFixture.profiledBytes, controlBytes: gridCodecFixture.autoBytes }),
  runRow('Rich text anchored mark format', 500, () => { const doc = makeRichTextDoc(); doc.richText('/doc').format(0, 5, { bold: true }, { expand: 'after' }); sink += doc.richText('/doc').toDelta().length; }),
  runRow('Rich text boundary insert resolve', 300, () => { const doc = makeRichTextDoc(); const rich = doc.richText('/doc'); rich.format(0, 5, { bold: true }, { expand: 'after' }); rich.insert(5, '!'); sink += rich.toDelta().length; }),
  runRow('Rich text Delta export, 6 spans', 1000, () => { sink += richDeltaFixture.richText('/doc').toDelta().length; }),
  runRow('Update inspect metadata', 1000, () => { const update = makeUpdate(); sink += inspectCrdtUpdate(update).opCount; }),
  runRow('Merge duplicate updates', 1000, () => { const update = makeUpdate(); sink += mergeCrdtUpdates([update, update]).byteLength; }),
  runRetainedRow('Retained heap: 100-char text doc', 40, () => makeTextDoc(100)),
  runRetainedRow('Retained heap: merged update replay', 40, () => { const doc = createCrdtDocument({ actorId: 'bench-retained-replay' }); doc.applyUpdate(makeBulkUpdate()); return doc; }),
  runRetainedRow('Retained heap: compacted update bytes', 80, () => mergeCrdtUpdates([makeBulkUpdate(), makeBulkUpdate()]))
];
finish('@shapeshift-labs/frontier-crdt', rows);
function makeUpdate() { const doc = createCrdtDocument({ actorId: 'bench-update' }); doc.set('/title', 'hello'); doc.text('/body').insert(0, 'frontier'); return doc.exportUpdate(); }
function makeBulkUpdate() { return makeTextDoc(100).exportUpdate(); }
function makeTextDoc(length) { const doc = createCrdtDocument({ actorId: 'bench-text-doc' }); const text = doc.text('/body'); for (let i = 0; i < length; i++) text.insert(i, 'x'); return doc; }
function makeRichTextDoc() { const doc = createCrdtDocument({ actorId: 'bench-rich-' + (++sink) }); doc.richText('/doc').fromDelta([{ insert: 'hello world from frontier rich text' }]); return doc; }
function makeFrameFixture() {
  const doc = createCrdtDocument({ actorId: 'bench-frame' });
  const paths = new Array(8);
  for (let i = 0; i < paths.length; i++) {
    doc.set('/doc/f' + i, i);
    paths[i] = '/doc/f' + i;
  }
  const frame = doc.captureFrame({ paths });
  doc.set('/ui/theme', 'dark');
  return { doc, frame };
}
function makeGridProfile() {
  const doc = createCrdtDocument({ actorId: 'bench-grid-profile' + (++sink) });
  for (let row = 0; row < 4; row++) {
    doc.change((tx) => {
      tx.set(['grid', 'r' + row, 'c0'], row);
      tx.set(['grid', 'r' + row, 'c1'], row + 1);
    });
  }
  return doc.getProfile();
}
function makeGridCodecFixture() {
  const profile = makeGridProfile();
  const doc = createCrdtDocument({ actorId: 'bench-grid-update', adaptive: false });
  const result = doc.change((tx) => {
    for (let i = 0; i < 8; i++) tx.set(['grid', 'r' + i, 'c' + (i % 2)], i);
  });
  const update = decodeCrdtUpdate(result.update);
  const autoBytesUpdate = encodeCrdtUpdate(update);
  const profiledUpdate = encodeCrdtUpdateWithProfile(update, profile);
  return {
    profile,
    update,
    autoBytesUpdate,
    profiledUpdate,
    autoBytes: autoBytesUpdate.byteLength,
    profiledBytes: profiledUpdate.byteLength
  };
}
