# Frontier CRDT

Native CRDT documents, update tooling, awareness, branches, conflict introspection, and undo for Frontier.

This package sits above [`@shapeshift-labs/frontier`](https://www.npmjs.com/package/@shapeshift-labs/frontier), [`@shapeshift-labs/frontier-codec`](https://www.npmjs.com/package/@shapeshift-labs/frontier-codec), [`@shapeshift-labs/frontier-engine`](https://www.npmjs.com/package/@shapeshift-labs/frontier-engine), and [`@shapeshift-labs/frontier-state`](https://www.npmjs.com/package/@shapeshift-labs/frontier-state). It keeps collaborative document state separate from the small JSON diff/apply core package and from the higher sync/repo/storage package.

- npm: [`@shapeshift-labs/frontier-crdt`](https://www.npmjs.com/package/@shapeshift-labs/frontier-crdt)
- source: [`siliconjungle/-shapeshift-labs-frontier-crdt`](https://github.com/siliconjungle/-shapeshift-labs-frontier-crdt)
- license: MIT

## Related Packages

- [`@shapeshift-labs/frontier`](https://www.npmjs.com/package/@shapeshift-labs/frontier): core JSON diff/apply primitives.
- [`@shapeshift-labs/frontier-codec`](https://www.npmjs.com/package/@shapeshift-labs/frontier-codec): shared patch/history codec layer used below CRDT update tooling.
- [`@shapeshift-labs/frontier-engine`](https://www.npmjs.com/package/@shapeshift-labs/frontier-engine): planned diff engine and history planning.
- [`@shapeshift-labs/frontier-state`](https://www.npmjs.com/package/@shapeshift-labs/frontier-state): state-engine integration for CRDT-backed state views.
- [`@shapeshift-labs/frontier-crdt-sync`](https://www.npmjs.com/package/@shapeshift-labs/frontier-crdt-sync): repo, storage, provider, sync protocol, document URL, local network, model-checking, and binding contracts.
- [`@shapeshift-labs/frontier-crdt-websocket`](https://www.npmjs.com/package/@shapeshift-labs/frontier-crdt-websocket): WebSocket transport package above `frontier-crdt-sync`.
- [`@shapeshift-labs/frontier-richtext`](https://www.npmjs.com/package/@shapeshift-labs/frontier-richtext): rich text Delta, marks, embeds, ranges, and cursor helpers for editor integrations above CRDT text.

Package source repositories:

- [`siliconjungle/-shapeshift-labs-frontier`](https://github.com/siliconjungle/-shapeshift-labs-frontier)
- [`siliconjungle/-shapeshift-labs-frontier-query`](https://github.com/siliconjungle/-shapeshift-labs-frontier-query)
- [`siliconjungle/-shapeshift-labs-frontier-codec`](https://github.com/siliconjungle/-shapeshift-labs-frontier-codec)
- [`siliconjungle/-shapeshift-labs-frontier-engine`](https://github.com/siliconjungle/-shapeshift-labs-frontier-engine)
- [`siliconjungle/-shapeshift-labs-frontier-state`](https://github.com/siliconjungle/-shapeshift-labs-frontier-state)
- [`siliconjungle/-shapeshift-labs-frontier-crdt`](https://github.com/siliconjungle/-shapeshift-labs-frontier-crdt)
- [`siliconjungle/-shapeshift-labs-frontier-crdt-sync`](https://github.com/siliconjungle/-shapeshift-labs-frontier-crdt-sync)
- [`siliconjungle/-shapeshift-labs-frontier-crdt-websocket`](https://github.com/siliconjungle/-shapeshift-labs-frontier-crdt-websocket)
- [`siliconjungle/-shapeshift-labs-frontier-richtext`](https://github.com/siliconjungle/-shapeshift-labs-frontier-richtext)

## Install

```sh
npm install @shapeshift-labs/frontier @shapeshift-labs/frontier-codec @shapeshift-labs/frontier-engine @shapeshift-labs/frontier-state @shapeshift-labs/frontier-crdt
```

## Usage

```ts
import { createCrdtDocument } from '@shapeshift-labs/frontier-crdt';
import { inspectCrdtUpdate } from '@shapeshift-labs/frontier-crdt/update';

const alice = createCrdtDocument({ actorId: 'alice' });
alice.set('/title', 'Draft');
alice.text('/body').insert(0, 'Hello');

const update = alice.exportUpdate();
console.log(inspectCrdtUpdate(update).ranges);

const bob = createCrdtDocument({ actorId: 'bob' });
bob.applyUpdate(update);

console.log(bob.toJSON());
```

## Rich Text

Frontier rich text is backed by the CRDT text container plus replicated mark/embed/block sidecars. Inline marks now use stable text selections, so formatting ranges move with CRDT text edits instead of staying as plain numeric offsets.

For local editor Delta transforms, range formatting, embed handling, and cursor/selection mapping outside the CRDT document itself, use [`@shapeshift-labs/frontier-richtext`](https://www.npmjs.com/package/@shapeshift-labs/frontier-richtext).

The package boundary is:

| Layer | Role |
| --- | --- |
| `@shapeshift-labs/frontier-richtext` | Local editor transform helpers: normalize/apply Deltas, map local cursors/selections, and prepare editor intent before it becomes collaborative state. |
| `@shapeshift-labs/frontier-crdt` | Durable collaborative state: CRDT text, stable mark anchors, replicated mark/embed/block sidecars, update merge, conflict/version APIs, and Delta import/export at document boundaries. |
| `@shapeshift-labs/frontier-react` or an editor package | Framework/editor bindings: React subscriptions, CodeMirror/Monaco/textarea decorations, remote selections, presence rendering, and app-specific editor UI. |

In practice, editor code can use `frontier-richtext` to shape a local Delta, then commit the resulting intent to `doc.richText(path)`. Remote updates should be applied through `frontier-crdt`; the rich-text handle resolves stable anchors and exports the current editor-facing Delta with `toDelta()`.

The mark model follows the practical Peritext/Loro direction:

- Marks are stored as CRDT data with stable range anchors.
- Marks support explicit boundary expansion: `after`, `before`, `none`, or `both`.
- Bold/italic-style marks default to `after`; link/comment-style marks default to `none`.
- `toDelta()` exports a Quill Delta-shaped view for editor bindings.
- Same-key overlaps are resolved deterministically; non-conflicting keys compose.

```ts
const doc = createCrdtDocument({ actorId: 'writer-a' });
const rich = doc.richText('/article/body');

rich.fromDelta([{ insert: 'hello world' }]);
rich.format(0, 5, { bold: true }, { expand: 'after' });
rich.format(6, 5, { link: 'https://frontier.dev' }, { expand: 'none' });

console.log(rich.toDelta());
```

This implementation is informed by [Peritext](https://www.inkandswitch.com/peritext/) and [Loro rich text](https://www.loro.dev/blog/loro-richtext): boundary expansion is explicit, mark ranges are anchored to the CRDT text sequence, and Delta export is the editor-facing representation. Frontier does not yet expose a full editor schema, ProseMirror/Quill binding package, or multi-value comment rendering policy; those belong above this package.

## API

```ts
import {
  createCrdtDocument,
  createCrdtDocumentFromSnapshot
} from '@shapeshift-labs/frontier-crdt';

import {
  decodeCrdtUpdate,
  diffCrdtUpdate,
  encodeCrdtUpdate,
  inspectCrdtUpdate,
  mergeCrdtUpdates
} from '@shapeshift-labs/frontier-crdt/update';
import { createCrdtBranch } from '@shapeshift-labs/frontier-crdt/branch';
import { createCrdtUndoManager } from '@shapeshift-labs/frontier-crdt/undo';
```

## Subpath Imports

```ts
import { mergeCrdtUpdates } from '@shapeshift-labs/frontier-crdt/update';
import { createCrdtDocument } from '@shapeshift-labs/frontier-crdt/document';
import { createCrdtStateEngine } from '@shapeshift-labs/frontier-crdt/state';
import { createCrdtAwareness } from '@shapeshift-labs/frontier-crdt/awareness';
import { createCrdtBranch } from '@shapeshift-labs/frontier-crdt/branch';
import { createCrdtUndoManager } from '@shapeshift-labs/frontier-crdt/undo';
```

## Package Scope

This package is intentionally limited to:

- Native CRDT document creation and document handles.
- CRDT JSON, map, list, plain text, counter, binary, tree, XML, and rich-text document operations.
- CRDT update encode/decode/merge/diff/inspect/filter/obfuscate helpers.
- Durable versioning, snapshots, checkout/fork helpers, branch wrappers, conflict introspection, awareness, and undo.

It does not expose sync providers, repos, storage adapters, document URLs, local sync networks, model-checking transports, WebSocket transports, or editor text bindings. Those belong in the higher `@shapeshift-labs/frontier-crdt-sync` and `@shapeshift-labs/frontier-crdt-websocket` packages.

## Stability

The stable package surface is the plain document/update layer:

- `createCrdtDocument`, map/list/plain-text/counter/binary JSON operations, materialized view patches, state vectors, snapshots, checkout/fork/viewAt, changes-since exports, history traversal, commit metadata, and conflict introspection.
- Update tooling in `@shapeshift-labs/frontier-crdt/update`: encode/decode, inspect, merge, diff, filter, compact, obfuscate, update metadata, actor ranges, and state-vector conversion.
- Awareness and branch wrappers as package-level contracts above the document API.
- Rich-text marks with anchored ranges, explicit boundary expansion, deterministic same-key ordering, and Delta export are usable for editor prototypes and higher-layer bindings.

The experimental surface is intentionally marked as such:

- Rich-text embeds, blocks, multi-value comment/link rendering policy, and XML/tree convenience helpers are early CRDT surfaces. Use them for prototypes, but plain text, JSON containers, and anchored inline marks are the hardened path.
- Undo refuses to replay when the document has advanced at overlapping paths. It is safe against known destructive replay cases, but selective CRDT undo is still evolving.
- Internal update byte layouts, packed actor/sequence storage, native text pieces, and compact update frames are optimization details. Do not treat encoded updates as cross-version durable storage unless a future release explicitly documents a compatibility window.

## TypeScript

The package ships ESM JavaScript plus `.d.ts` declarations for the root export and public subpaths. The package-local TypeScript source lives in `src/` and compiles directly to `dist/`.

## Validation

```sh
npm test
npm run fuzz
npm run bench
npm run pack:dry
```

The hardening suite covers concurrent map/list/text operations, list moves, same-key conflict introspection/resolution, undo refusal and non-overlapping replay, rich-text sidecars, branch/viewAt/metadata behavior, duplicate and partial update delivery, filtered updates, malformed update inputs, and randomized multi-peer convergence.

## Benchmarks

Run the package-local benchmark:

```sh
npm run bench
```

Latest local package benchmark on Node v26.1.0, darwin arm64, 9 rounds:

| Fixture | Median | p95 | Heap/op |
| --- | ---: | ---: | ---: |
| Local text insert transaction | 2.24 us | 6.66 us | - |
| Incremental text typing, 100 chars | 167.34 us | 239.40 us | - |
| Rich text anchored mark format | 30.45 us | 35.96 us | - |
| Rich text boundary insert resolve | 39.32 us | 54.63 us | - |
| Rich text Delta export, 6 spans | 19.36 us | 22.21 us | - |
| Update inspect metadata | 6.34 us | 16.54 us | - |
| Merge duplicate updates | 9.29 us | 11.84 us | - |
| Retained heap: 100-char text doc | 147.30 us | 200.84 us | 17.84 KiB |
| Retained heap: merged update replay | 185.19 us | 208.58 us | 5.58 KiB |
| Retained heap: compacted update bytes | 374.32 us | 410.52 us | 916 B |

These are Frontier-only package measurements, not competitor comparisons.

## License

MIT. See [LICENSE](./LICENSE).
