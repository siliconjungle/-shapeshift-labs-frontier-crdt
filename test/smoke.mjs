import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));

const crdt = await import('../dist/index.js');
const documentOnly = await import('../dist/crdt.js');
const update = await import('../dist/crdt-update.js');
const stateOnly = await import('../dist/crdt-state-engine.js');
const awarenessOnly = await import('../dist/crdt-awareness.js');
const branchOnly = await import('../dist/crdt-branch.js');
const undoOnly = await import('../dist/crdt-undo.js');

assert.strictEqual(typeof crdt.createCrdtDocument, 'function');
assert.strictEqual(crdt.encodeCrdtUpdate, undefined);
assert.strictEqual(crdt.decodeCrdtUpdate, undefined);
assert.strictEqual(crdt.createCrdtStateEngine, undefined);
assert.strictEqual(crdt.inspectCrdtUpdate, undefined);
assert.strictEqual(crdt.mergeCrdtUpdates, undefined);
assert.strictEqual(crdt.diffCrdtUpdate, undefined);
assert.strictEqual(crdt.createCrdtAwareness, undefined);
assert.strictEqual(crdt.createCrdtBranch, undefined);
assert.strictEqual(crdt.createCrdtUndoManager, undefined);
assert.strictEqual(typeof stateOnly.createCrdtStateEngine, 'function');
assert.strictEqual(documentOnly.createCrdtDocument, crdt.createCrdtDocument);
assert.strictEqual(typeof branchOnly.createCrdtBranch, 'function');
assert.strictEqual(typeof undoOnly.createCrdtUndoManager, 'function');

assert.strictEqual(crdt.createCrdtSyncState, undefined);
assert.strictEqual(crdt.createCrdtRepo, undefined);
assert.strictEqual(crdt.createCrdtDocHandle, undefined);
assert.strictEqual(crdt.createCrdtSyncProvider, undefined);

const types = readFileSync(join(packageDir, 'dist', 'types.d.ts'), 'utf8');
assert.doesNotMatch(types, /\bCrdtSyncState\b/);
assert.doesNotMatch(types, /\bCrdtSyncProvider\b/);
assert.doesNotMatch(types, /\bCrdtDocHandle\b/);
assert.doesNotMatch(types, /\bCrdtRepo\b/);
assert.doesNotMatch(types, /\bCrdtStorageAdapter\b/);
assert.doesNotMatch(types, /\bCrdtTextBinding\b/);

const doc = crdt.createCrdtDocument({ actorId: 'pkg-crdt-a' });
doc.set('/title', 'hello');
doc.text('/body').insert(0, 'frontier');

const encoded = doc.exportUpdate();
const info = update.inspectCrdtUpdate(encoded);
assert.strictEqual(info.opCount, 2);
assert.strictEqual(update.hasCrdtUpdateChanges(encoded), true);
assert.deepStrictEqual(
  update.decodeCrdtUpdate(update.encodeCrdtUpdate(update.decodeCrdtUpdate(encoded))).ops,
  update.decodeCrdtUpdate(encoded).ops
);
assert.strictEqual(typeof update.encodeCrdtUpdateWithProfile, 'function');

const peer = crdt.createCrdtDocument({ actorId: 'pkg-crdt-b' });
peer.applyUpdate(update.mergeCrdtUpdates([encoded]));
assert.deepStrictEqual(peer.toJSON(), { title: 'hello', body: 'frontier' });
assert.deepStrictEqual(peer.applyUpdate(encoded).viewPatch, []);

const transactionLocal = crdt.createCrdtDocument({ actorId: 'pkg-transaction-local' });
transactionLocal.change((tx) => {
  tx.list('/items').insert(0, ['a', 'b']);
  tx.list('/items').move(0, 2, 1);
  tx.binary('/blob').set(new Uint8Array([1, 2, 3]));
  assert.deepStrictEqual(Array.from(tx.binary('/blob').get()), [1, 2, 3]);
});
assert.deepStrictEqual(transactionLocal.toJSON(), {
  items: ['b', 'a'],
  blob: { $frontierBinary: 'AQID' }
});

const frameDoc = crdt.createCrdtDocument({ actorId: 'pkg-frame' });
frameDoc.set('/title', 'draft');
frameDoc.set('/meta/reviewed', false);
frameDoc.markVersion('authored');
const frame = frameDoc.captureFrame({ mark: 'authored', paths: ['/title'] });
assert.strictEqual(frame.mark, 'authored');
assert.strictEqual(frame.paths.length, 1);
assert.strictEqual(frameDoc.evaluateFrame(frame).ok, true);
frameDoc.set('/meta/reviewed', true);
const unrelatedFrame = frameDoc.evaluateFrame(frame);
assert.strictEqual(unrelatedFrame.ok, true);
assert.strictEqual(unrelatedFrame.relation, 'before');
frameDoc.set('/title', 'published');
const staleFrame = frameDoc.evaluateFrame(frame);
assert.strictEqual(staleFrame.ok, false);
assert.deepStrictEqual(staleFrame.conflictingPaths, [['title']]);
const exactFrame = frameDoc.captureFrame();
frameDoc.set('/other', true);
assert.strictEqual(frameDoc.evaluateFrame(exactFrame).ok, false);
const pathOnlyFrameDoc = crdt.createCrdtDocument({ actorId: 'pkg-frame-path-only' });
const pathOnlyFrame = pathOnlyFrameDoc.captureFrame({ paths: ['/late'], includeValues: false });
pathOnlyFrameDoc.set('/unrelated', true);
assert.strictEqual(pathOnlyFrameDoc.evaluateFrame(pathOnlyFrame).ok, true);
pathOnlyFrameDoc.set('/late', true);
assert.strictEqual(pathOnlyFrameDoc.evaluateFrame(pathOnlyFrame).ok, false);

const stateFrameEngine = stateOnly.createCrdtStateEngine({ actorId: 'pkg-state-frame' });
stateFrameEngine.set('/items/0/done', false);
const stateFrame = stateFrameEngine.captureFrame({ paths: ['/items/0/done'] });
assert.strictEqual(stateFrameEngine.evaluateFrame(stateFrame).ok, true);

const gridTrainer = crdt.createCrdtDocument({ actorId: 'pkg-grid-trainer' });
for (let row = 0; row < 4; row++) {
  gridTrainer.change((tx) => {
    tx.set(['grid', 'r' + row, 'c0'], row);
    tx.set(['grid', 'r' + row, 'c1'], row + 1);
  });
}
const gridProfile = gridTrainer.getProfile();
assert.strictEqual(gridProfile.workloads?.some((entry) => entry.workload === 'grid-like' && entry.update === 'binary'), true);
assert.strictEqual(gridProfile.plans?.crdt?.update, 'binary');

const gridUpdateDoc = crdt.createCrdtDocument({ actorId: 'pkg-grid-update', adaptive: false });
const gridUpdateResult = gridUpdateDoc.change((tx) => {
  for (let i = 0; i < 8; i++) tx.set(['grid', 'r' + i, 'c' + (i % 2)], i);
});
const gridUpdate = update.decodeCrdtUpdate(gridUpdateResult.update);
const gridJson = update.convertCrdtUpdate(gridUpdate, { format: 'json' });
const gridProfiled = update.encodeCrdtUpdateWithProfile(gridUpdate, gridProfile);
assert.ok(gridProfiled.byteLength < gridJson.byteLength, 'profile-guided grid update should prefer compact binary');
assert.deepStrictEqual(update.decodeCrdtUpdate(gridProfiled).ops, gridUpdate.ops);

const textTrainer = crdt.createCrdtDocument({ actorId: 'pkg-text-trainer' });
const trainedText = textTrainer.text('/body');
for (let i = 0; i < 9; i++) trainedText.insert(i, 'x');
const textProfile = textTrainer.getProfile();
assert.strictEqual(textProfile.workloads?.some((entry) => entry.workload === 'text-heavy' && entry.update === 'columnar-text'), true);
assert.strictEqual(textProfile.plans?.crdt?.update, 'columnar-text');

const richProfileDoc = crdt.createCrdtDocument({ actorId: 'pkg-rich-profile' });
richProfileDoc.richText('/doc').fromDelta([{ insert: 'hello world from frontier' }]);
for (let i = 0; i < 8; i++) richProfileDoc.richText('/doc').format(i, 1, { bold: true }, { id: 'bold-' + i });
assert.strictEqual(
  richProfileDoc.getProfile().workloads?.some((entry) => entry.workload === 'rich-text-mark-heavy' && entry.update === 'binary'),
  true
);

const sparseUpdates = [];
for (let actor = 0; actor < 4; actor++) {
  const sparseDoc = crdt.createCrdtDocument({ actorId: 'pkg-sparse-' + actor });
  sparseDoc.set('/v' + actor, actor);
  sparseDoc.set('/w' + actor, actor + 1);
  sparseUpdates.push(sparseDoc.exportUpdate());
}
const sparsePeer = crdt.createCrdtDocument({ actorId: 'pkg-sparse-peer' });
sparsePeer.applyUpdate(update.mergeCrdtUpdates(sparseUpdates));
assert.strictEqual(
  sparsePeer.getProfile().workloads?.some((entry) => entry.workload === 'sparse-actor' && entry.update === 'binary'),
  true
);

const richBase = crdt.createCrdtDocument({ actorId: 'pkg-rich-base' });
richBase.richText('/doc').fromDelta([{ insert: 'hello world' }]);
const richA = crdt.createCrdtDocument({ actorId: 'pkg-rich-a' });
const richB = crdt.createCrdtDocument({ actorId: 'pkg-rich-b' });
richA.applyUpdate(richBase.exportUpdate());
richB.applyUpdate(richBase.exportUpdate());
richA.richText('/doc').format(0, 5, { bold: true }, { expand: 'after' });
richB.richText('/doc').format(6, 5, { italic: true }, { expand: 'after' });
richA.applyUpdate(richB.exportUpdate(richBase.getStateVector()));
richB.applyUpdate(richA.exportUpdate(richBase.getStateVector()));
assert.deepStrictEqual(richA.richText('/doc').toDelta(), [
  { insert: 'hello', attributes: { bold: true } },
  { insert: ' ' },
  { insert: 'world', attributes: { italic: true } }
]);
assert.deepStrictEqual(richB.richText('/doc').toDelta(), richA.richText('/doc').toDelta());

const richBoundary = crdt.createCrdtDocument({ actorId: 'pkg-rich-boundary-a' });
richBoundary.richText('/doc').fromDelta([{ insert: 'hello world' }]);
richBoundary.richText('/doc').format(0, 5, { bold: true }, { expand: 'after' });
const richBoundaryPeer = crdt.createCrdtDocument({ actorId: 'pkg-rich-boundary-b' });
richBoundaryPeer.applyUpdate(richBoundary.exportUpdate());
richBoundaryPeer.richText('/doc').insert(5, '!');
richBoundary.applyUpdate(richBoundaryPeer.exportUpdate(richBoundary.getStateVector()));
assert.deepStrictEqual(richBoundary.richText('/doc').toDelta(), [
  { insert: 'hello!', attributes: { bold: true } },
  { insert: ' world' }
]);

const richLink = crdt.createCrdtDocument({ actorId: 'pkg-rich-link' });
richLink.richText('/doc').fromDelta([{ insert: 'hello' }]);
richLink.richText('/doc').format(0, 5, { link: 'https://example.com' }, { expand: 'none' });
richLink.richText('/doc').insert(5, '!');
assert.deepStrictEqual(richLink.richText('/doc').toDelta(), [
  { insert: 'hello', attributes: { link: 'https://example.com' } },
  { insert: '!' }
]);
richLink.richText('/doc').clearFormat(0, 5, ['link']);
assert.deepStrictEqual(richLink.richText('/doc').toDelta(), [{ insert: 'hello!' }]);

const awarenessA = awarenessOnly.createCrdtAwareness({ actorId: 'pkg-presence-a' });
const awarenessB = awarenessOnly.createCrdtAwareness({ actorId: 'pkg-presence-b' });
const presenceUpdate = awarenessA.setLocalState({ name: 'Ada' });
awarenessB.applyUpdate(awarenessA.encodeUpdate(presenceUpdate));
assert.deepStrictEqual(awarenessB.get('pkg-presence-a')?.value, { name: 'Ada' });

const branch = branchOnly.createCrdtBranch(doc, { name: 'pkg-branch', actorId: 'pkg-crdt-branch' });
branch.doc.set('/branch', true);
assert.strictEqual(branch.getStatus().name, 'pkg-branch');
assert.strictEqual(branch.changesFromBase().length, 1);

const undoDoc = crdt.createCrdtDocument({ actorId: 'pkg-undo' });
const undo = undoOnly.createCrdtUndoManager(undoDoc);
undo.capture(() => {
  undoDoc.text('/body').insert(0, 'abc');
});
undo.capture(() => {
  undoDoc.text('/body').splice(1, 1, 'Z');
});
assert.deepStrictEqual(undoDoc.toJSON(), { body: 'aZc' });
undo.undo();
assert.deepStrictEqual(undoDoc.toJSON(), { body: 'abc' });
assert.strictEqual(undo.canRedo(), true);
