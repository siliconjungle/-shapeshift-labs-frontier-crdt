import assert from 'node:assert';
import { createCrdtDocument } from '../dist/index.js';
import {
  diffCrdtUpdate,
  getCrdtUpdateStateVector,
  hasCrdtUpdateChanges,
  inspectCrdtUpdate,
  mergeCrdtUpdates
} from '../dist/crdt-update.js';

const args = parseArgs(process.argv.slice(2));
const cases = readPositiveInt(args.cases, 300);
const steps = readPositiveInt(args.steps, 36);
const seed = readPositiveInt(args.seed, 0xc2d7f00d);
const rng = mulberry32(seed);

for (let caseIndex = 0; caseIndex < cases; caseIndex++) {
  runCase(caseIndex, mulberry32((rng() * 0xffffffff) >>> 0));
}

console.log('frontier crdt fuzz passed cases=' + cases + ' steps=' + steps + ' seed=' + seed);

function runCase(caseIndex, rng) {
  const left = createCrdtDocument({ actorId: 'crdt-fuzz-left-' + caseIndex });
  const right = createCrdtDocument({ actorId: 'crdt-fuzz-right-' + caseIndex });
  const third = createCrdtDocument({ actorId: 'crdt-fuzz-third-' + caseIndex });

  for (let step = 0; step < steps; step++) {
    const doc = randomInt(rng, 2) === 0 ? left : right;
    applyRandomEdit(doc, rng, step);
    if (randomInt(rng, 6) === 0) {
      const snapshot = doc.snapshot({ includeView: true, includeUpdate: true });
      const fork = doc.checkout(snapshot.version, { actorId: doc.actorId + '-checkout-' + step });
      assert.deepStrictEqual(fork.toJSON(), doc.viewAt(snapshot.version));
    }
  }

  const leftFullUpdate = left.exportUpdate();
  const rightFullUpdate = right.exportUpdate();
  left.applyUpdate(rightFullUpdate);
  right.applyUpdate(leftFullUpdate);

  const merged = mergeCrdtUpdates([leftFullUpdate, rightFullUpdate]);
  const info = inspectCrdtUpdate(merged);
  assert.ok(info.opCount > 0);
  assert.strictEqual(hasCrdtUpdateChanges(merged, getCrdtUpdateStateVector(merged)), false);
  assert.strictEqual(diffCrdtUpdate(merged, getCrdtUpdateStateVector(merged)).byteLength, 0);

  third.applyUpdate(merged);
  assert.deepStrictEqual(left.toJSON(), right.toJSON(), 'peer convergence case=' + caseIndex);
  assert.deepStrictEqual(third.toJSON(), left.toJSON(), 'merged replay convergence case=' + caseIndex);
  assert.deepStrictEqual(third.applyUpdate(merged).viewPatch, []);
}

function applyRandomEdit(doc, rng, step) {
  const view = doc.toJSON();
  const choice = randomInt(rng, 8);
  if (choice === 0) {
    doc.set('/meta/version', step);
  } else if (choice === 1) {
    doc.map('/meta').set('flag' + randomInt(rng, 4), randomInt(rng, 2) === 0);
  } else if (choice === 2) {
    doc.counter('/count').increment(randomInt(rng, 5) - 2);
  } else if (choice === 3) {
    const body = typeof view.body === 'string' ? view.body : '';
    const index = randomInt(rng, body.length + 1);
    doc.text('/body').insert(index, String.fromCharCode(97 + randomInt(rng, 26)));
  } else if (choice === 4) {
    const body = typeof view.body === 'string' ? view.body : '';
    if (body.length === 0) doc.text('/body').insert(0, 'x');
    else doc.text('/body').delete(randomInt(rng, body.length), 1);
  } else if (choice === 5) {
    const items = Array.isArray(view.items) ? view.items : [];
    doc.list('/items').insert(randomInt(rng, items.length + 1), { id: 'i' + step, value: randomInt(rng, 100) });
  } else if (choice === 6) {
    const items = Array.isArray(view.items) ? view.items : [];
    if (items.length === 0) doc.list('/items').insert(0, { id: 'seed-' + step });
    else doc.list('/items').delete(randomInt(rng, items.length), 1);
  } else {
    const bytes = new Uint8Array([step & 255, randomInt(rng, 256), randomInt(rng, 256)]);
    doc.binary('/blob').set(bytes);
  }
}

function randomInt(rng, max) {
  return max <= 0 ? 0 : Math.floor(rng() * max);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--cases') out.cases = argv[++i];
    else if (arg === '--steps') out.steps = argv[++i];
    else if (arg === '--seed') out.seed = argv[++i];
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node test/fuzz.mjs [--cases 300] [--steps 36] [--seed 3268939789]');
      process.exit(0);
    } else {
      throw new Error('unknown argument: ' + arg);
    }
  }
  return out;
}

function readPositiveInt(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function mulberry32(seedValue) {
  let state = seedValue >>> 0;
  return function next() {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
