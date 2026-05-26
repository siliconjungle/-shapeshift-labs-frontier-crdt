import assert from 'node:assert';
import { createCrdtDocument } from '../dist/index.js';
import { createCrdtBranch } from '../dist/crdt-branch.js';
import { createCrdtUndoManager } from '../dist/crdt-undo.js';
import {
  decodeCrdtStateVector,
  decodeCrdtStateVectorBase64url,
  decodeCrdtUpdate,
  decodeCrdtUpdateBase64url,
  encodeCrdtUpdate,
  diffCrdtUpdate,
  filterCrdtUpdate,
  getCrdtUpdateActorRanges,
  getCrdtUpdateStateVector,
  hasCrdtUpdateChanges,
  inspectCrdtUpdate,
  mergeCrdtUpdates
} from '../dist/crdt-update.js';

const args = parseArgs(process.argv.slice(2));
const cases = readPositiveInt(args.cases, 80);
const seed = readPositiveInt(args.seed, 0xc6d75421);
const rng = mulberry32(seed);

testConflictIntrospectionAndResolution();
testCheckoutForkViewAtAndChanges();
testPartialDuplicateAndFilteredUpdates();
testUndoRefusesOverlappingRemoteAdvancement();
testUndoAllowsNonOverlappingRemoteAdvancement();
testConcurrentContainerMatrix();
testRichTextSidecarConcurrentMatrix();
testBranchViewAtAndMetadataMatrix();
testPartialSyncPermutationMatrix();
testMalformedUpdateValidation();
testConcurrentRandomizedReplay(cases, rng);

console.log('frontier crdt hardening passed cases=' + cases + ' seed=' + seed);

function testConflictIntrospectionAndResolution() {
  const left = createCrdtDocument({ actorId: 'hard-conflict-left' });
  const right = createCrdtDocument({ actorId: 'hard-conflict-right' });
  left.set('/title', 'left');
  right.set('/title', 'right');

  const leftUpdate = left.exportUpdate();
  const rightUpdate = right.exportUpdate();
  left.applyUpdate(rightUpdate);
  right.applyUpdate(leftUpdate);

  const conflictVersion = left.getVersion();
  const conflict = left.getConflict('/title');
  assert.ok(conflict, 'expected same-path concurrent register conflict');
  assert.strictEqual(conflict.values.length, 2);
  assert.strictEqual(conflict.losers.length, 1);
  assert.deepStrictEqual(
    conflict.values.map((value) => value.actor).sort(),
    ['hard-conflict-left', 'hard-conflict-right']
  );

  const summary = left.getConflictSummary('/title');
  assert.ok(summary);
  assert.strictEqual(summary.valueCount, 2);
  assert.strictEqual(summary.loserCount, 1);
  assert.deepStrictEqual(summary.actors, ['hard-conflict-left', 'hard-conflict-right']);
  assert.strictEqual(left.getConflicts().length, 1);
  assert.strictEqual(left.getConflictSummaries().length, 1);

  const loser = conflict.losers[0];
  left.resolveConflict('/title', loser);
  assert.strictEqual(left.toJSON().title, loser.value);
  assert.strictEqual(left.getConflict('/title'), undefined);
  assert.strictEqual(left.getConflictAt(conflictVersion, '/title')?.values.length, 2);

  right.applyUpdate(left.exportUpdate(right.getStateVector()));
  assert.deepStrictEqual(right.toJSON(), left.toJSON());
}

function testCheckoutForkViewAtAndChanges() {
  const doc = createCrdtDocument({ actorId: 'hard-history' });
  doc.set('/title', 'one');
  const first = doc.getVersion();
  doc.text('/body').insert(0, 'abc');
  const second = doc.getVersion();
  doc.map('/meta').set('ready', true);
  const third = doc.getVersion();

  assert.deepStrictEqual(doc.viewAt(first), { title: 'one' });
  assert.deepStrictEqual(doc.viewAt(second), { title: 'one', body: 'abc' });
  assert.deepStrictEqual(doc.viewAt(third), doc.toJSON());

  const checkout = doc.checkout(second, { actorId: 'hard-checkout' });
  assert.deepStrictEqual(checkout.toJSON(), doc.viewAt(second));
  checkout.set('/checkoutOnly', true);
  assert.strictEqual(doc.toJSON().checkoutOnly, undefined);

  const fork = doc.fork({ actorId: 'hard-fork' });
  assert.deepStrictEqual(fork.toJSON(), doc.toJSON());
  fork.set('/forkOnly', true);
  assert.strictEqual(doc.toJSON().forkOnly, undefined);

  const sinceFirst = doc.exportChangesSince(first);
  const base = createCrdtDocument({ actorId: 'hard-history-base' });
  base.applyUpdate(doc.exportChangesBetween(null, first));
  base.applyUpdate(sinceFirst);
  assert.deepStrictEqual(base.toJSON(), doc.toJSON());

  const middle = createCrdtDocument({ actorId: 'hard-history-middle' });
  middle.applyUpdate(doc.exportChangesBetween(null, first));
  middle.applyUpdate(doc.exportChangesBetween(first, second));
  assert.deepStrictEqual(middle.toJSON(), doc.viewAt(second));
}

function testPartialDuplicateAndFilteredUpdates() {
  const source = createCrdtDocument({ actorId: 'hard-update-source' });
  const target = createCrdtDocument({ actorId: 'hard-update-target' });
  source.set('/title', 'alpha');
  target.applyUpdate(source.exportUpdate());

  source.text('/body').insert(0, 'frontier');
  source.list('/items').insert(0, [{ id: 'a' }, { id: 'b' }]);
  source.counter('/count').increment(3);

  const targetVector = target.getStateVector();
  const full = source.exportUpdate();
  const delta = diffCrdtUpdate(full, targetVector);
  assert.ok(delta.byteLength > 0);
  assert.strictEqual(hasCrdtUpdateChanges(full, targetVector), true);
  target.applyUpdate(delta);
  assert.deepStrictEqual(target.toJSON(), source.toJSON());
  assert.strictEqual(target.applyUpdate(delta).viewPatch.length, 0, 'duplicate delta should be a no-op');

  const merged = mergeCrdtUpdates([full, delta, full]);
  assert.deepStrictEqual(getCrdtUpdateStateVector(merged), source.getStateVector());
  assert.ok(getCrdtUpdateActorRanges(merged).length >= 1);
  assert.strictEqual(hasCrdtUpdateChanges(merged, getCrdtUpdateStateVector(merged)), false);
  assert.strictEqual(diffCrdtUpdate(merged, getCrdtUpdateStateVector(merged)).byteLength, 0);

  const bodyOnly = filterCrdtUpdate(merged, { paths: [['body']], pathMode: 'subtree' });
  const bodyInfo = inspectCrdtUpdate(bodyOnly);
  assert.ok(bodyInfo.opCount >= 1);
  assert.ok(decodeCrdtUpdate(bodyOnly).ops.every((op) => op.path[0] === 'body'));
}

function testUndoRefusesOverlappingRemoteAdvancement() {
  const local = createCrdtDocument({ actorId: 'hard-undo-local' });
  const remote = createCrdtDocument({ actorId: 'hard-undo-remote' });
  const undo = createCrdtUndoManager(local);

  undo.capture(() => {
    local.text('/body').insert(0, 'abc');
  });

  remote.applyUpdate(local.exportUpdate());
  remote.text('/body').insert(0, 'X');
  local.applyUpdate(remote.exportUpdate(local.getStateVector()));

  assert.deepStrictEqual(local.toJSON(), { body: 'Xabc' });
  assert.throws(
    () => undo.undo(),
    /cannot undo CRDT entry because the document changed at an overlapping path/
  );
  assert.deepStrictEqual(local.toJSON(), { body: 'Xabc' });
}

function testUndoAllowsNonOverlappingRemoteAdvancement() {
  const local = createCrdtDocument({ actorId: 'hard-undo-safe-local' });
  const remote = createCrdtDocument({ actorId: 'hard-undo-safe-remote' });
  const undo = createCrdtUndoManager(local, { trackedOrigins: ['typing', 'title'] });

  undo.capture(() => {
    local.text('/body').insert(0, 'abc');
  }, { origin: 'typing', metadata: { source: 'keyboard' } });
  undo.capture(() => {
    local.set('/title', 'draft');
  }, { origin: 'title' });

  remote.applyUpdate(local.exportUpdate());
  remote.map('/meta').set('remote', true);
  local.applyUpdate(remote.exportUpdate(local.getStateVector()));

  assert.deepStrictEqual(local.toJSON(), { body: 'abc', title: 'draft', meta: { remote: true } });
  undo.undo({ origin: 'typing' });
  assert.deepStrictEqual(local.toJSON(), { title: 'draft', meta: { remote: true } });
  assert.strictEqual(undo.canRedo(), true);
  undo.redo({ predicate: (entry) => entry.metadata?.source === 'keyboard' });
  assert.deepStrictEqual(local.toJSON(), { body: 'abc', title: 'draft', meta: { remote: true } });
}

function testConcurrentContainerMatrix() {
  const base = createCrdtDocument({ actorId: 'hard-container-base' });
  base.change((tx) => {
    tx.set('/title', 'base');
    tx.map('/meta').set('seed', true);
    tx.list('/items').insert(0, [{ id: 'base-a' }, { id: 'base-b' }, { id: 'base-c' }]);
    tx.text('/body').insert(0, 'abcdef');
  });
  const baseUpdate = base.exportUpdate();
  const peers = ['a', 'b', 'c'].map((id) => {
    const peer = createCrdtDocument({ actorId: 'hard-container-' + id });
    peer.applyUpdate(baseUpdate);
    return peer;
  });

  peers[0].change((tx) => {
    tx.map('/meta').set('left', 1);
    tx.map('/meta').set('shared', 'left');
    tx.list('/items').insert(1, { id: 'left-insert' });
    tx.list('/items').move(0, 2, 1);
    tx.text('/body').splice(1, 2, 'XY');
  });
  peers[1].change((tx) => {
    tx.map('/meta').set('right', 2);
    tx.map('/meta').set('shared', 'right');
    tx.list('/items').delete(2, 1);
    tx.list('/items').insert(0, { id: 'right-insert' });
    tx.text('/body').insert(3, 'zz');
  });
  peers[2].change((tx) => {
    tx.map('/meta').delete('seed');
    tx.counter('/count').increment(4);
    tx.list('/items').insert(3, { id: 'third-insert' });
    tx.text('/body').delete(4, 1);
  });

  const updates = peers.map((peer) => peer.exportUpdate(base.getStateVector()));
  const replayA = createCrdtDocument({ actorId: 'hard-container-replay-a' });
  const replayB = createCrdtDocument({ actorId: 'hard-container-replay-b' });
  const replayC = createCrdtDocument({ actorId: 'hard-container-replay-c' });
  for (const replay of [replayA, replayB, replayC]) replay.applyUpdate(baseUpdate);
  for (const update of updates) replayA.applyUpdate(update);
  for (const update of [updates[2], updates[0], updates[1]]) replayB.applyUpdate(update);
  replayC.applyUpdate(mergeCrdtUpdates([updates[1], updates[0], updates[2], updates[1]]));

  assert.deepStrictEqual(replayB.toJSON(), replayA.toJSON());
  assert.deepStrictEqual(replayC.toJSON(), replayA.toJSON());
  assert.deepStrictEqual(replayA.toJSON().meta.left, 1);
  assert.deepStrictEqual(replayA.toJSON().meta.right, 2);
  assert.strictEqual(replayA.toJSON().meta.seed, undefined);
  assert.strictEqual(replayA.getConflict('/meta/shared')?.values.length, 2);
  const summary = replayA.map('/meta').getConflictSummary('shared');
  assert.ok(summary);
  assert.deepStrictEqual(summary.actors, ['hard-container-a', 'hard-container-b']);

  const loser = replayA.getConflict('/meta/shared')?.losers[0];
  assert.ok(loser);
  replayA.resolveConflict('/meta/shared', loser);
  replayB.applyUpdate(replayA.exportUpdate(replayB.getStateVector()));
  assert.deepStrictEqual(replayB.toJSON(), replayA.toJSON());
}

function testRichTextSidecarConcurrentMatrix() {
  const base = createCrdtDocument({ actorId: 'hard-rich-base' });
  base.richText('/doc').fromDelta([
    { insert: 'hello world\n' },
    { insert: { image: 'seed.png' }, attributes: { alt: 'seed' } }
  ]);
  const baseUpdate = base.exportUpdate();
  const peers = ['a', 'b', 'c'].map((id) => {
    const peer = createCrdtDocument({ actorId: 'hard-rich-' + id });
    peer.applyUpdate(baseUpdate);
    return peer;
  });

  peers[0].richText('/doc').format(0, 5, { bold: true }, { expand: 'after', id: 'bold-hello' });
  peers[1].richText('/doc').format(6, 5, { italic: true }, { expand: 'none', id: 'italic-world' });
  peers[2].richText('/doc').insert(5, '!', { color: 'red' });
  peers[2].richText('/doc').formatBlock(0, { heading: 2 });
  peers[2].richText('/doc').updateEmbed(
    peers[2].richText('/doc').getEmbeds()[0].index,
    { image: 'updated.png' },
    { alt: 'updated' }
  );

  const updates = peers.map((peer) => peer.exportUpdate(base.getStateVector()));
  const mergedOne = replayRichText(baseUpdate, updates);
  const mergedTwo = replayRichText(baseUpdate, [updates[2], updates[1], updates[0], updates[2]]);
  assert.deepStrictEqual(mergedTwo.richText('/doc').toDelta(), mergedOne.richText('/doc').toDelta());
  assert.deepStrictEqual(mergedTwo.richText('/doc').value(), mergedOne.richText('/doc').value());

  const delta = mergedOne.richText('/doc').toDelta();
  assert.ok(delta.some((op) => typeof op.insert === 'string' && op.insert.includes('hello') && op.attributes?.bold === true));
  assert.ok(delta.some((op) => typeof op.insert === 'string' && op.insert.includes('world') && op.attributes?.italic === true));
  assert.ok(mergedOne.richText('/doc').getBlocks().some((block) => block.attributes.heading === 2));
  assert.ok(mergedOne.richText('/doc').getEmbeds().some((embed) => embed.value.image === 'updated.png'));

  const clearA = mergedOne.fork({ actorId: 'hard-rich-clear-a' });
  const clearB = mergedOne.fork({ actorId: 'hard-rich-clear-b' });
  clearA.richText('/doc').clearFormat(0, 5, ['bold']);
  clearB.richText('/doc').format(0, 5, { underline: true }, { expand: 'after', id: 'underline-hello' });
  clearA.applyUpdate(clearB.exportUpdate(mergedOne.getStateVector()));
  clearB.applyUpdate(clearA.exportUpdate(mergedOne.getStateVector()));
  assert.deepStrictEqual(clearB.richText('/doc').toDelta(), clearA.richText('/doc').toDelta());
  assert.ok(clearA.richText('/doc').toDelta().some((op) => op.attributes?.underline === true));
}

function replayRichText(baseUpdate, updates) {
  const doc = createCrdtDocument({ actorId: 'hard-rich-replay-' + updates.length + '-' + updates[0]?.byteLength });
  doc.applyUpdate(baseUpdate);
  for (const update of updates) doc.applyUpdate(update);
  return doc;
}

function testBranchViewAtAndMetadataMatrix() {
  const doc = createCrdtDocument({ actorId: 'hard-branch-main' });
  doc.change((tx) => {
    tx.set('/title', 'start');
  }, { metadata: { kind: 'seed' } });
  const seedMark = doc.markVersion('seed', { metadata: { label: 'seed' } });
  doc.change((tx) => {
    tx.text('/body').insert(0, 'abc');
    tx.list('/items').insert(0, [{ id: 'a' }]);
  }, { metadata: { kind: 'body' } });
  doc.markVersion('body');

  const branch = createCrdtBranch(doc, { name: 'hard-feature', actorId: 'hard-branch-feature' });
  branch.doc.change((tx) => {
    tx.set('/title', 'feature');
    tx.text('/body').insert(3, '!');
  }, { metadata: { kind: 'feature' } });

  assert.deepStrictEqual(doc.viewMark('seed'), { title: 'start' });
  assert.deepStrictEqual(doc.checkoutMark('seed', { actorId: 'hard-branch-seed-checkout' }).toJSON(), doc.viewAt(seedMark.version));
  assert.deepStrictEqual(doc.snapshotMark('body', { includeView: true }).view, doc.viewMark('body'));
  assert.ok(doc.inspectVersion(null, { includeHistory: true }).history.length >= 1);
  assert.strictEqual(doc.inspectVersion(null, { includeMetadata: true }).metadata?.kind, 'body');
  assert.strictEqual(doc.getCommitMetadata(doc.getHeads()[0])?.kind, 'body');

  const preview = branch.previewMergeInto(doc);
  assert.strictEqual(preview.kind, 'fast-forward');
  assert.strictEqual(preview.sourceName, 'hard-feature');
  assert.ok(preview.updateBytes > 0);
  branch.mergeInto(doc);
  assert.deepStrictEqual(doc.toJSON(), branch.doc.toJSON());

  const branchAfterMerge = createCrdtBranch(doc, { name: 'hard-already', actorId: 'hard-branch-already' });
  assert.strictEqual(branchAfterMerge.previewMergeInto(doc).kind, 'already-merged');
}

function testPartialSyncPermutationMatrix() {
  const source = createCrdtDocument({ actorId: 'hard-partial-source' });
  source.change((tx) => {
    tx.set('/title', 'partial');
    tx.text('/body').insert(0, 'abcdef');
    tx.list('/items').insert(0, [{ id: 'a' }, { id: 'b' }]);
    tx.map('/meta').set('ready', true);
  });
  source.change((tx) => {
    tx.text('/body').splice(2, 2, 'XY');
    tx.list('/items').move(0, 1, 1);
    tx.counter('/count').increment(5);
  });
  source.richText('/rich').insert(0, 'rich');
  source.richText('/rich').format(0, 4, { bold: true });

  const ops = decodeCrdtUpdate(source.exportUpdate()).ops;
  const chunks = ops.map((op) => encodeCrdtUpdate({ actor: op.actor, seq: op.seq, deps: op.deps, ops: [op] }));
  const targetA = createCrdtDocument({ actorId: 'hard-partial-a' });
  const targetB = createCrdtDocument({ actorId: 'hard-partial-b' });
  const targetC = createCrdtDocument({ actorId: 'hard-partial-c' });

  for (const chunk of chunks) targetA.applyUpdate(chunk);
  for (const chunk of chunks.slice().reverse()) targetB.applyUpdate(chunk);
  for (let i = 0; i < chunks.length; i += 2) targetC.applyUpdate(chunks[i]);
  for (let i = 1; i < chunks.length; i += 2) targetC.applyUpdate(chunks[i]);
  for (const chunk of chunks) targetC.applyUpdate(chunk);

  assert.deepStrictEqual(targetA.toJSON(), source.toJSON());
  assert.deepStrictEqual(targetB.toJSON(), source.toJSON());
  assert.deepStrictEqual(targetC.toJSON(), source.toJSON());
  assert.strictEqual(targetC.applyUpdate(mergeCrdtUpdates(chunks)).viewPatch.length, 0);

  const textOnly = filterCrdtUpdate(source.exportUpdate(), { paths: [['body']], pathMode: 'subtree' });
  const textOnlyOps = decodeCrdtUpdate(textOnly).ops;
  assert.ok(textOnlyOps.length > 0);
  assert.ok(textOnlyOps.every((op) => op.path[0] === 'body'));
}

function testMalformedUpdateValidation() {
  const doc = createCrdtDocument({ actorId: 'hard-bad-update' });
  doc.change((tx) => {
    tx.set('/title', 'bad-update-seed');
    tx.text('/body').insert(0, 'abcdefghijklmnop');
  });
  const valid = doc.exportUpdate();
  const validJson = new TextEncoder().encode(JSON.stringify({
    magic: 'FCU',
    version: 1,
    actor: 'bad-json',
    seq: 1,
    deps: [],
    ops: [{ id: 'bad-json:1', actor: 'bad-json', seq: 1, deps: [], path: ['x'], type: 'not-real' }]
  }));

  const badUpdates = [
    new Uint8Array([1, 2, 3]),
    valid.slice(0, Math.max(1, valid.byteLength - 1)),
    valid.slice(0, Math.max(1, Math.floor(valid.byteLength / 2))),
    flipByte(valid, 0),
    flipByte(valid, Math.floor(valid.byteLength / 2)),
    appendGarbage(valid),
    new TextEncoder().encode('{not json'),
    validJson
  ];

  for (const bad of badUpdates) {
    assertThrowsAny(() => decodeCrdtUpdate(bad), 'decode malformed update');
    assertThrowsAny(() => inspectCrdtUpdate(bad), 'inspect malformed update');
    assertThrowsAny(() => mergeCrdtUpdates([bad]), 'merge malformed update');
    assertThrowsAny(() => diffCrdtUpdate(bad, {}), 'diff malformed update');
    assertThrowsAny(() => filterCrdtUpdate(bad, { paths: [['body']] }), 'filter malformed update');
  }

  const malformedOperationObject = {
    actor: 'bad-object',
    seq: 1,
    deps: [],
    ops: [{ id: 'bad-object:1', actor: 'bad-object', seq: 1, deps: [], path: ['x'], type: 'not-real' }]
  };
  assertThrowsAny(() => inspectCrdtUpdate(malformedOperationObject), 'inspect malformed operation object');
  assertThrowsAny(() => mergeCrdtUpdates([malformedOperationObject]), 'merge malformed operation object');
  assertThrowsAny(() => diffCrdtUpdate(malformedOperationObject, {}), 'diff malformed operation object');
  assertThrowsAny(() => filterCrdtUpdate(malformedOperationObject, { paths: [['x']] }), 'filter malformed operation object');

  assertThrowsAny(() => decodeCrdtUpdateBase64url('abcde'), 'bad update base64 length');
  assertThrowsAny(() => decodeCrdtUpdateBase64url('!!!!'), 'bad update base64 characters');
  assertThrowsAny(() => decodeCrdtStateVector({ '': 1 }), 'empty actor state vector');
  assertThrowsAny(() => decodeCrdtStateVector({ actor: -1 }), 'negative state vector');
  assertThrowsAny(() => decodeCrdtStateVector({ actor: 1.5 }), 'fractional state vector');
  assertThrowsAny(() => decodeCrdtStateVector(new Uint8Array([123])), 'truncated state vector bytes');
  assertThrowsAny(() => decodeCrdtStateVectorBase64url('!!!!'), 'bad state vector base64');
}

function testConcurrentRandomizedReplay(cases, rng) {
  for (let caseIndex = 0; caseIndex < cases; caseIndex++) {
    const peers = [
      createCrdtDocument({ actorId: 'hard-random-a-' + caseIndex }),
      createCrdtDocument({ actorId: 'hard-random-b-' + caseIndex }),
      createCrdtDocument({ actorId: 'hard-random-c-' + caseIndex })
    ];
    for (let step = 0; step < 20; step++) {
      const doc = peers[randomInt(rng, peers.length)];
      applyRandomHardeningEdit(doc, rng, step);
      if (randomInt(rng, 4) === 0) syncPair(peers[randomInt(rng, peers.length)], peers[randomInt(rng, peers.length)]);
    }

    const merged = mergeCrdtUpdates(peers.map((peer) => peer.exportUpdate()));
    const replay = createCrdtDocument({ actorId: 'hard-random-replay-' + caseIndex });
    for (const peer of peers) peer.applyUpdate(merged);
    replay.applyUpdate(merged);

    const expected = peers[0].toJSON();
    for (const peer of peers) assert.deepStrictEqual(peer.toJSON(), expected, 'random peer convergence ' + caseIndex);
    assert.deepStrictEqual(replay.toJSON(), expected, 'random merged replay convergence ' + caseIndex);

    const checkpoint = peers[0].getVersion();
    const checkout = peers[0].checkout(checkpoint, { actorId: 'hard-random-checkout-' + caseIndex });
    assert.deepStrictEqual(checkout.toJSON(), peers[0].viewAt(checkpoint));
  }
}

function syncPair(source, target) {
  if (source === target) return;
  const update = source.exportUpdate(target.getStateVector());
  target.applyUpdate(update);
  assert.strictEqual(target.applyUpdate(update).viewPatch.length, 0);
}

function applyRandomHardeningEdit(doc, rng, step) {
  const view = doc.toJSON();
  const choice = randomInt(rng, 12);
  if (choice === 0) {
    doc.set('/shared', 'v' + step + '-' + randomInt(rng, 4));
  } else if (choice === 1) {
    doc.map('/meta').set('k' + randomInt(rng, 3), randomInt(rng, 100));
  } else if (choice === 2) {
    doc.counter('/count').increment(randomInt(rng, 7) - 3);
  } else if (choice === 3) {
    const body = typeof view.body === 'string' ? view.body : '';
    doc.text('/body').insert(randomInt(rng, body.length + 1), String.fromCharCode(97 + randomInt(rng, 26)));
  } else if (choice === 4) {
    const body = typeof view.body === 'string' ? view.body : '';
    if (body.length === 0) doc.text('/body').insert(0, 'z');
    else doc.text('/body').delete(randomInt(rng, body.length), 1);
  } else if (choice === 5) {
    const items = Array.isArray(view.items) ? view.items : [];
    doc.list('/items').insert(randomInt(rng, items.length + 1), { id: doc.actorId + '-' + step, n: randomInt(rng, 10) });
  } else if (choice === 6) {
    const items = Array.isArray(view.items) ? view.items : [];
    if (items.length !== 0) doc.list('/items').delete(randomInt(rng, items.length), 1);
  } else if (choice === 7) {
    const items = Array.isArray(view.items) ? view.items : [];
    if (items.length < 2) doc.list('/items').insert(items.length, { id: doc.actorId + '-move-seed-' + step });
    else doc.list('/items').move(randomInt(rng, items.length), randomInt(rng, items.length), 1);
  } else if (choice === 8) {
    doc.map('/meta').delete('k' + randomInt(rng, 3));
  } else if (choice === 9) {
    const rich = readRichText(view);
    doc.richText('/rich').insert(randomInt(rng, rich.length + 1), String.fromCharCode(97 + randomInt(rng, 26)));
  } else if (choice === 10) {
    const rich = readRichText(view);
    if (rich.length === 0) doc.richText('/rich').insert(0, 'r');
    else {
      const start = randomInt(rng, rich.length);
      const length = 1 + randomInt(rng, rich.length - start);
      doc.richText('/rich').format(start, length, randomInt(rng, 2) === 0 ? { bold: true } : { italic: true });
    }
  } else {
    const rich = readRichText(view);
    if (rich.length !== 0) doc.richText('/rich').clearFormat(randomInt(rng, rich.length), 1);
  }
}

function readRichText(view) {
  const rich = view && typeof view === 'object' && view.rich && typeof view.rich === 'object' ? view.rich : undefined;
  return rich && typeof rich.text === 'string' ? rich.text : '';
}

function flipByte(bytes, offset) {
  const out = bytes.slice();
  if (out.byteLength === 0) return new Uint8Array([255]);
  out[offset % out.byteLength] ^= 0xff;
  return out;
}

function appendGarbage(bytes) {
  const out = new Uint8Array(bytes.byteLength + 4);
  out.set(bytes);
  out.set([0xde, 0xad, 0xbe, 0xef], bytes.byteLength);
  return out;
}

function assertThrowsAny(fn, label) {
  let threw = false;
  try {
    fn();
  } catch (error) {
    threw = true;
    assert.ok(error instanceof Error, label + ' should throw an Error');
  }
  assert.strictEqual(threw, true, label + ' should reject malformed input');
}

function randomInt(rng, max) {
  return max <= 0 ? 0 : Math.floor(rng() * max);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--cases') out.cases = argv[++i];
    else if (arg === '--seed') out.seed = argv[++i];
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node test/hardening.mjs [--cases 80] [--seed 3336008737]');
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
