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

const peer = crdt.createCrdtDocument({ actorId: 'pkg-crdt-b' });
peer.applyUpdate(update.mergeCrdtUpdates([encoded]));
assert.deepStrictEqual(peer.toJSON(), { title: 'hello', body: 'frontier' });
assert.deepStrictEqual(peer.applyUpdate(encoded).viewPatch, []);

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
