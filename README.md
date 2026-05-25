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

Package source repositories:

- [`siliconjungle/-shapeshift-labs-frontier`](https://github.com/siliconjungle/-shapeshift-labs-frontier)
- [`siliconjungle/-shapeshift-labs-frontier-query`](https://github.com/siliconjungle/-shapeshift-labs-frontier-query)
- [`siliconjungle/-shapeshift-labs-frontier-codec`](https://github.com/siliconjungle/-shapeshift-labs-frontier-codec)
- [`siliconjungle/-shapeshift-labs-frontier-engine`](https://github.com/siliconjungle/-shapeshift-labs-frontier-engine)
- [`siliconjungle/-shapeshift-labs-frontier-state`](https://github.com/siliconjungle/-shapeshift-labs-frontier-state)
- [`siliconjungle/-shapeshift-labs-frontier-crdt`](https://github.com/siliconjungle/-shapeshift-labs-frontier-crdt)
- [`siliconjungle/-shapeshift-labs-frontier-crdt-sync`](https://github.com/siliconjungle/-shapeshift-labs-frontier-crdt-sync)
- [`siliconjungle/-shapeshift-labs-frontier-crdt-websocket`](https://github.com/siliconjungle/-shapeshift-labs-frontier-crdt-websocket)

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
- CRDT JSON, map, list, text, counter, binary, tree, XML, and rich-text document operations.
- CRDT update encode/decode/merge/diff/inspect/filter/obfuscate helpers.
- Durable versioning, snapshots, checkout/fork helpers, branch wrappers, conflict introspection, awareness, and undo.

It does not expose sync providers, repos, storage adapters, document URLs, local sync networks, model-checking transports, WebSocket transports, or editor text bindings. Those belong in the higher `@shapeshift-labs/frontier-crdt-sync` and `@shapeshift-labs/frontier-crdt-websocket` packages.

## TypeScript

The package ships ESM JavaScript plus `.d.ts` declarations for the root export and public subpaths. The package-local TypeScript source lives in `src/` and compiles directly to `dist/`.

## Validation

```sh
npm test
npm run fuzz
npm run bench
npm run pack:dry
```

## Benchmarks

Run the package-local benchmark:

```sh
npm run bench
```

Latest local package benchmark on Node v26.1.0, darwin arm64, 5 rounds:

| Fixture | Median | p95 |
| --- | ---: | ---: |
| Local text insert transaction | 6.52 us | 13.96 us |
| Incremental text typing, 100 chars | 196.60 us | 265.90 us |
| Update inspect metadata | 8.41 us | 12.35 us |
| Merge duplicate updates | 9.90 us | 10.43 us |

These are Frontier-only package measurements, not competitor comparisons.

## License

MIT. See [LICENSE](./LICENSE).
