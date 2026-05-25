# Frontier CRDT

Reserved package name for the future Frontier CRDT document layer.

This package is not ready for production use. It exists so the package and repository names are reserved while the CRDT document, update, branch, undo, and awareness boundaries are finalized.

- npm: [`@shapeshift-labs/frontier-crdt`](https://www.npmjs.com/package/@shapeshift-labs/frontier-crdt)
- source: [`siliconjungle/-shapeshift-labs-frontier-crdt`](https://github.com/siliconjungle/-shapeshift-labs-frontier-crdt)
- core package: [`@shapeshift-labs/frontier`](https://www.npmjs.com/package/@shapeshift-labs/frontier)
- codec package: [`@shapeshift-labs/frontier-codec`](https://www.npmjs.com/package/@shapeshift-labs/frontier-codec)
- license: MIT

## Intended Scope

When this package graduates from placeholder status, it is expected to contain:

- native CRDT document creation and document handles;
- JSON map/list/text/counter/binary/tree/XML operations;
- CRDT update encode/decode/merge/diff/inspect/filter/obfuscate helpers;
- durable versioning, snapshots, checkout/fork helpers, and branch wrappers;
- conflict introspection, awareness, and CRDT-aware undo.

It should depend on `@shapeshift-labs/frontier` and `@shapeshift-labs/frontier-codec`. Sync providers, repos, storage adapters, document URLs, local sync networks, and editor bindings belong above this package.

## Current Status

Use [`@shapeshift-labs/frontier`](https://www.npmjs.com/package/@shapeshift-labs/frontier) for the stable JSON diff/apply core and [`@shapeshift-labs/frontier-codec`](https://www.npmjs.com/package/@shapeshift-labs/frontier-codec) for patch transport codecs.

The CRDT package is reserved only. No runtime API is exported yet.

## Package Family

Published or active packages:

- [`@shapeshift-labs/frontier`](https://www.npmjs.com/package/@shapeshift-labs/frontier)
- [`@shapeshift-labs/frontier-codec`](https://www.npmjs.com/package/@shapeshift-labs/frontier-codec)
- [`@shapeshift-labs/frontier-mutation`](https://www.npmjs.com/package/@shapeshift-labs/frontier-mutation)

Reserved future packages:

- `@shapeshift-labs/frontier-engine`
- `@shapeshift-labs/frontier-state`
- `@shapeshift-labs/frontier-crdt-sync`
- `@shapeshift-labs/frontier-richtext`
- `@shapeshift-labs/frontier-logging`
- `@shapeshift-labs/frontier-state-cache`
- `@shapeshift-labs/frontier-event-log`
- `@shapeshift-labs/frontier-schema`

## License

MIT. See [LICENSE](./LICENSE).
