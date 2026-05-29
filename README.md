# Frontier CRDT

Native CRDT documents, update tooling, awareness, branches, conflict introspection, and undo for Frontier.

This package sits above [`@shapeshift-labs/frontier`](https://www.npmjs.com/package/@shapeshift-labs/frontier), [`@shapeshift-labs/frontier-codec`](https://www.npmjs.com/package/@shapeshift-labs/frontier-codec), [`@shapeshift-labs/frontier-engine`](https://www.npmjs.com/package/@shapeshift-labs/frontier-engine), and [`@shapeshift-labs/frontier-state`](https://www.npmjs.com/package/@shapeshift-labs/frontier-state). It keeps collaborative document state separate from the small JSON diff/apply core package and from the higher sync/repo/storage package.

- npm: [`@shapeshift-labs/frontier-crdt`](https://www.npmjs.com/package/@shapeshift-labs/frontier-crdt)
- source: [`siliconjungle/-shapeshift-labs-frontier-crdt`](https://github.com/siliconjungle/-shapeshift-labs-frontier-crdt)
- license: MIT

## Related Packages

The published Frontier package family is generated from one shared package catalog so READMEs stay in sync across packages:

- [`@shapeshift-labs/frontier`](https://www.npmjs.com/package/@shapeshift-labs/frontier): Core JSON diff/apply, compact patch tuples, JSON Pointer, equality, clone, validation, Unicode helpers, and tiny dependency-free runtime budget/scheduler primitives.
- [`@shapeshift-labs/frontier-query`](https://www.npmjs.com/package/@shapeshift-labs/frontier-query): Shared query-key, selector path, condition, entity identity, and table-shape primitives.
- [`@shapeshift-labs/frontier-codec`](https://www.npmjs.com/package/@shapeshift-labs/frontier-codec): Patch serialization, binary frames, canonical JSON, and patch-history codecs.
- [`@shapeshift-labs/frontier-engine`](https://www.npmjs.com/package/@shapeshift-labs/frontier-engine): Stateful planned diff engine, adaptive profiles, schema plans, and engine-level history helpers.
- [`@shapeshift-labs/frontier-state`](https://www.npmjs.com/package/@shapeshift-labs/frontier-state): Patch-routed app-state subscriptions, owned commits, maintained views, and path mapping.
- [`@shapeshift-labs/frontier-dataflow`](https://www.npmjs.com/package/@shapeshift-labs/frontier-dataflow): Serializable incremental dataflow and materialized-view graphs for Frontier apps, including selectors, dependency DAGs, filters, joins, aggregations, stale paths, recompute budgets, output patches, provenance records, and proof of why derived views changed.
- [`@shapeshift-labs/frontier-state-cache`](https://www.npmjs.com/package/@shapeshift-labs/frontier-state-cache): Normalized query-result cache with entity/query watchers, persistence, change logs, optimistic layers, scheduled persistence, and mutation bridge.
- [`@shapeshift-labs/frontier-state-cache-idb`](https://www.npmjs.com/package/@shapeshift-labs/frontier-state-cache-idb): IndexedDB persistence adapter for Frontier state-cache snapshots and durable change logs.
- [`@shapeshift-labs/frontier-state-cache-file`](https://www.npmjs.com/package/@shapeshift-labs/frontier-state-cache-file): Structured file persistence adapter for Frontier state-cache snapshots and change logs.
- [`@shapeshift-labs/frontier-state-cache-sql`](https://www.npmjs.com/package/@shapeshift-labs/frontier-state-cache-sql): SQL persistence adapter for Frontier state-cache snapshots and change logs.
- [`@shapeshift-labs/frontier-schema`](https://www.npmjs.com/package/@shapeshift-labs/frontier-schema): JSON Schema validation, Frontier profile generation, CloudEvent envelopes, and query/table schema helpers.
- [`@shapeshift-labs/frontier-migrations`](https://www.npmjs.com/package/@shapeshift-labs/frontier-migrations): Boundary-first data migrations, import normalization, plugin/API version mapping, versioned envelopes, graph diagnostics, patch path rewrites, dry-run reports, and current-shape rehydration.
- [`@shapeshift-labs/frontier-event-log`](https://www.npmjs.com/package/@shapeshift-labs/frontier-event-log): Bounded event logs, replay cursors, consumer acknowledgements, keyed compaction, checkpoints, and Frontier patch event records.
- [`@shapeshift-labs/frontier-inspect`](https://www.npmjs.com/package/@shapeshift-labs/frontier-inspect): Cross-package inspection/evidence bundles, registry graph snapshots, feature/resource impact reports, timeline/event normalization, redaction, JSONL import/export, and AI-readable app feature maps.
- [`@shapeshift-labs/frontier-scheduler`](https://www.npmjs.com/package/@shapeshift-labs/frontier-scheduler): Deterministic work scheduling, lanes, cancellation, backpressure, frame policies, replay snapshots, and work graphs.
- [`@shapeshift-labs/frontier-logging`](https://www.npmjs.com/package/@shapeshift-labs/frontier-logging): Opt-in structured logging, browser telemetry, scheduled sinks, file sinks, exporters, benchmark traces, and Frontier patch/update summaries.
- [`@shapeshift-labs/frontier-mutation`](https://www.npmjs.com/package/@shapeshift-labs/frontier-mutation): Explicit mutation and selector plans compiled to Frontier patches or CRDT operations.
- [`@shapeshift-labs/frontier-effects`](https://www.npmjs.com/package/@shapeshift-labs/frontier-effects): Serializable effect descriptors and resource graphs for Frontier apps, including fetch, storage, timers, navigation, workers, clipboard, broadcast, WebSocket, stream, policy metadata, runtime records, redaction, JSONL, proof helpers, and registry graph output.
- [`@shapeshift-labs/frontier-policy`](https://www.npmjs.com/package/@shapeshift-labs/frontier-policy): Serializable policy and capability decisions for Frontier apps, effects, views, sync, routes, traces, and AI tools.
- [`@shapeshift-labs/frontier-tools`](https://www.npmjs.com/package/@shapeshift-labs/frontier-tools): Serializable app action/tool manifests for AI-operable Frontier apps, including availability, validation, dry-run plans, patch previews, effect/tool constraints, execution records, rollback links, and registry graph output.
- [`@shapeshift-labs/frontier-sandbox`](https://www.npmjs.com/package/@shapeshift-labs/frontier-sandbox): Runtime-agnostic sandbox contracts for Frontier patch-producing actions, including manifests, declared reads/writes/capabilities, host-validated patch/effect/event/log results, dynamic source modules, source event replay, and structural runtime adapters.
- [`@shapeshift-labs/frontier-sandbox-quickjs`](https://www.npmjs.com/package/@shapeshift-labs/frontier-sandbox-quickjs): QuickJS/WebAssembly runtime adapter for Frontier sandbox actions, including invocation/runtime isolation modes, deadline and memory limits, dynamic source execution, and patch/effect result normalization.
- [`@shapeshift-labs/frontier-workflow`](https://www.npmjs.com/package/@shapeshift-labs/frontier-workflow): Serializable durable workflow/process manifests for Frontier apps, including steps, waits, approvals, timers, retries, expected patches, compensation, records, timelines, and registry graph output.
- [`@shapeshift-labs/frontier-worker`](https://www.npmjs.com/package/@shapeshift-labs/frontier-worker): Serializable worker and edge task descriptors for Frontier apps, including queues, idempotency keys, retry and timeout policy, declared reads/writes/effects, snapshots, patch outputs, produced assets, execution records, logs, trace links, proof hashes, dedupe indexes, and registry graph output.
- [`@shapeshift-labs/frontier-assets`](https://www.npmjs.com/package/@shapeshift-labs/frontier-assets): Serializable asset and content provenance graphs for Frontier apps, including source files, generated variants, thumbnails, LOD chunks, shader/material dependencies, transforms, hashes, owners, runtime consumers, review plans, registry graph output, and impact queries.
- [`@shapeshift-labs/frontier-triggers`](https://www.npmjs.com/package/@shapeshift-labs/frontier-triggers): Capability-gated event trigger registry, scoped event envelopes, listener/reaction rules, structured rejection, deterministic event-to-action scheduling, replay/provenance records, and registry graph output.
- [`@shapeshift-labs/frontier-virtual`](https://www.npmjs.com/package/@shapeshift-labs/frontier-virtual): DOM-neutral virtualization, layout providers, range materialization, grids, spatial/frustum indexes, patch invalidation, camera anchors, and serializable layout state.
- [`@shapeshift-labs/frontier-scene`](https://www.npmjs.com/package/@shapeshift-labs/frontier-scene): Patch-native 2D/3D scene graph, transform propagation, bounds queries, virtual/culling adapters, spatial invalidation, and camera/frustum materialization.
- [`@shapeshift-labs/frontier-pathfinding`](https://www.npmjs.com/package/@shapeshift-labs/frontier-pathfinding): Patch-native grid pathfinding, typed-array A*/Dijkstra search, flow fields, connected components, line-of-sight smoothing, dirty-cell invalidation, and scheduler-friendly path jobs.
- [`@shapeshift-labs/frontier-lod`](https://www.npmjs.com/package/@shapeshift-labs/frontier-lod): Patch-native level-of-detail and significance selection for rendering and computation workloads, compact typed hot paths, multi-observer selection, budget degradation, materialization frames, and scheduler work plans.
- [`@shapeshift-labs/frontier-route`](https://www.npmjs.com/package/@shapeshift-labs/frontier-route): DOM-neutral app/game route resources, route and scene manifests, match/resolve/transition planning, dependency metadata, sessions, registry graph output, and impact queries.
- [`@shapeshift-labs/frontier-trace`](https://www.npmjs.com/package/@shapeshift-labs/frontier-trace): Serializable traces, spans, events, causal links, W3C trace context helpers, timeline/resource/path queries, critical-path analysis, registry graph output, JSONL/proof helpers, Chrome trace export, and redaction for app-wide feature observability.
- [`@shapeshift-labs/frontier-manifest`](https://www.npmjs.com/package/@shapeshift-labs/frontier-manifest): Build/static feature manifests for owners, routes, actions, states, migrations, tests, source files, assets, resources, tasks, dependency metadata, registry graph output, feature maps, JSONL export, and impact queries.
- [`@shapeshift-labs/frontier-view`](https://www.npmjs.com/package/@shapeshift-labs/frontier-view): Renderer-neutral view manifests, type defaults, validation frames, action bindings, visual channels, virtual/LOD hints, and data-to-representation mapping for Frontier apps.
- [`@shapeshift-labs/frontier-dom`](https://www.npmjs.com/package/@shapeshift-labs/frontier-dom): Patch-native DOM and host renderer bindings, manifest hydration, JSX runtime/compiler helpers, SSR, devtools, and logging bridges.
- [`@shapeshift-labs/frontier-playwright`](https://www.npmjs.com/package/@shapeshift-labs/frontier-playwright): Playwright/headless automation probes for Frontier state, DOM, devtools, marks, and timeline queries.
- [`@shapeshift-labs/frontier-test`](https://www.npmjs.com/package/@shapeshift-labs/frontier-test): Serializable test/spec evidence manifests for Frontier apps, including fixtures, commands, expected patches/effects/routes/policies, coverage declarations, run plans, run records, report adapters, replay proofs, fuzzers, benchmarks, registry graph output, and impact queries.
- [`@shapeshift-labs/frontier-history`](https://www.npmjs.com/package/@shapeshift-labs/frontier-history): Serializable temporal explanation and causality records for Frontier apps, including field-change explanations, action/workflow/policy/effect/trace/test provenance, audit windows, undo planning, registry/provenance graph output, JSONL replay bundles, and proof hashes.
- [`@shapeshift-labs/frontier-application`](https://www.npmjs.com/package/@shapeshift-labs/frontier-application): Serializable whole-application graph and impact queries for Frontier apps, including features, owners, packages, routes, views, actions, mutations, state paths, effects, workers, assets, tests, traces, policies, workflows, migrations, benchmarks, registry graph output, feature maps, JSONL bundles, and proof hashes.
- [`@shapeshift-labs/frontier-linter`](https://www.npmjs.com/package/@shapeshift-labs/frontier-linter): Serializable Frontier lint rules, diagnostics, fixes, reports, and fast rule execution for package catalogs, registry graphs, application maps, manifests, traces, policies, workflows, workers, assets, tests, benchmarks, and source snippets.
- [`@shapeshift-labs/frontier-crdt-sync`](https://www.npmjs.com/package/@shapeshift-labs/frontier-crdt-sync): CRDT sync endpoints, repo/storage/provider contracts, scheduled sync work, document URLs, local networks, model checking, forensics, and text binding contracts.
- [`@shapeshift-labs/frontier-crdt-websocket`](https://www.npmjs.com/package/@shapeshift-labs/frontier-crdt-websocket): WebSocket client/server transports for Frontier CRDT sync providers.
- [`@shapeshift-labs/frontier-react`](https://www.npmjs.com/package/@shapeshift-labs/frontier-react): React external-store hooks and adapters for Frontier state, cache, and CRDT surfaces.
- [`@shapeshift-labs/frontier-richtext`](https://www.npmjs.com/package/@shapeshift-labs/frontier-richtext): Rich text Delta normalization/application, marks, embeds, ranges, and cursor/selection transforms for local editor integrations.
- [`@shapeshift-labs/frontier-realtime`](https://www.npmjs.com/package/@shapeshift-labs/frontier-realtime): Shared realtime command, tick, snapshot, prediction, reconciliation, interpolation, rollback, message, and delta primitives.
- [`@shapeshift-labs/frontier-realtime-server`](https://www.npmjs.com/package/@shapeshift-labs/frontier-realtime-server): Authoritative realtime room, tick, command validation, rate-limit, session, and snapshot-history runtime.
- [`@shapeshift-labs/frontier-realtime-websocket`](https://www.npmjs.com/package/@shapeshift-labs/frontier-realtime-websocket): WebSocket client, wire, and Node room-server transport for Frontier realtime.
- [`@shapeshift-labs/frontier-game`](https://www.npmjs.com/package/@shapeshift-labs/frontier-game): Game-facing entity, component, player, room, ownership, spatial interest, rollback, physics, and replication helpers above realtime.

Package source repositories:

- [`siliconjungle/-shapeshift-labs-frontier`](https://github.com/siliconjungle/-shapeshift-labs-frontier)
- [`siliconjungle/-shapeshift-labs-frontier-query`](https://github.com/siliconjungle/-shapeshift-labs-frontier-query)
- [`siliconjungle/-shapeshift-labs-frontier-codec`](https://github.com/siliconjungle/-shapeshift-labs-frontier-codec)
- [`siliconjungle/-shapeshift-labs-frontier-engine`](https://github.com/siliconjungle/-shapeshift-labs-frontier-engine)
- [`siliconjungle/-shapeshift-labs-frontier-state`](https://github.com/siliconjungle/-shapeshift-labs-frontier-state)
- [`siliconjungle/siliconjungle--shapeshift-labs-frontier-dataflow`](https://github.com/siliconjungle/siliconjungle--shapeshift-labs-frontier-dataflow)
- [`siliconjungle/-shapeshift-labs-frontier-state-cache`](https://github.com/siliconjungle/-shapeshift-labs-frontier-state-cache)
- [`siliconjungle/-shapeshift-labs-frontier-state-cache-idb`](https://github.com/siliconjungle/-shapeshift-labs-frontier-state-cache-idb)
- [`siliconjungle/-shapeshift-labs-frontier-state-cache-file`](https://github.com/siliconjungle/-shapeshift-labs-frontier-state-cache-file)
- [`siliconjungle/-shapeshift-labs-frontier-state-cache-sql`](https://github.com/siliconjungle/-shapeshift-labs-frontier-state-cache-sql)
- [`siliconjungle/-shapeshift-labs-frontier-schema`](https://github.com/siliconjungle/-shapeshift-labs-frontier-schema)
- [`siliconjungle/-shapeshift-labs-frontier-migrations`](https://github.com/siliconjungle/-shapeshift-labs-frontier-migrations)
- [`siliconjungle/-shapeshift-labs-frontier-event-log`](https://github.com/siliconjungle/-shapeshift-labs-frontier-event-log)
- [`siliconjungle/-shapeshift-labs-frontier-inspect`](https://github.com/siliconjungle/-shapeshift-labs-frontier-inspect)
- [`siliconjungle/-shapeshift-labs-frontier-scheduler`](https://github.com/siliconjungle/-shapeshift-labs-frontier-scheduler)
- [`siliconjungle/-shapeshift-labs-frontier-logging`](https://github.com/siliconjungle/-shapeshift-labs-frontier-logging)
- [`siliconjungle/-shapeshift-labs-frontier-mutation`](https://github.com/siliconjungle/-shapeshift-labs-frontier-mutation)
- [`siliconjungle/-shapeshift-labs-frontier-effects`](https://github.com/siliconjungle/-shapeshift-labs-frontier-effects)
- [`siliconjungle/-shapeshift-labs-frontier-policy`](https://github.com/siliconjungle/-shapeshift-labs-frontier-policy)
- [`siliconjungle/-shapeshift-labs-frontier-tools`](https://github.com/siliconjungle/-shapeshift-labs-frontier-tools)
- [`siliconjungle/-shapeshift-labs-frontier-sandbox`](https://github.com/siliconjungle/-shapeshift-labs-frontier-sandbox)
- [`siliconjungle/-shapeshift-labs-frontier-sandbox-quickjs`](https://github.com/siliconjungle/-shapeshift-labs-frontier-sandbox-quickjs)
- [`siliconjungle/-shapeshift-labs-frontier-workflow`](https://github.com/siliconjungle/-shapeshift-labs-frontier-workflow)
- [`siliconjungle/siliconjungle--shapeshift-labs-frontier-worker`](https://github.com/siliconjungle/siliconjungle--shapeshift-labs-frontier-worker)
- [`siliconjungle/-shapeshift-labs-frontier-assets`](https://github.com/siliconjungle/-shapeshift-labs-frontier-assets)
- [`siliconjungle/-shapeshift-labs-frontier-triggers`](https://github.com/siliconjungle/-shapeshift-labs-frontier-triggers)
- [`siliconjungle/-shapeshift-labs-frontier-virtual`](https://github.com/siliconjungle/-shapeshift-labs-frontier-virtual)
- [`siliconjungle/-shapeshift-labs-frontier-scene`](https://github.com/siliconjungle/-shapeshift-labs-frontier-scene)
- [`siliconjungle/-shapeshift-labs-frontier-pathfinding`](https://github.com/siliconjungle/-shapeshift-labs-frontier-pathfinding)
- [`siliconjungle/-shapeshift-labs-frontier-lod`](https://github.com/siliconjungle/-shapeshift-labs-frontier-lod)
- [`siliconjungle/-shapeshift-labs-frontier-route`](https://github.com/siliconjungle/-shapeshift-labs-frontier-route)
- [`siliconjungle/-shapeshift-labs-frontier-trace`](https://github.com/siliconjungle/-shapeshift-labs-frontier-trace)
- [`siliconjungle/-shapeshift-labs-frontier-manifest`](https://github.com/siliconjungle/-shapeshift-labs-frontier-manifest)
- [`siliconjungle/-shapeshift-labs-frontier-view`](https://github.com/siliconjungle/-shapeshift-labs-frontier-view)
- [`siliconjungle/-shapeshift-labs-frontier-dom`](https://github.com/siliconjungle/-shapeshift-labs-frontier-dom)
- [`siliconjungle/-shapeshift-labs-frontier-playwright`](https://github.com/siliconjungle/-shapeshift-labs-frontier-playwright)
- [`siliconjungle/-shapeshift-labs-frontier-test`](https://github.com/siliconjungle/-shapeshift-labs-frontier-test)
- [`siliconjungle/siliconjungle--shapeshift-labs-frontier-history`](https://github.com/siliconjungle/siliconjungle--shapeshift-labs-frontier-history)
- [`siliconjungle/siliconjungle--shapeshift-labs-frontier-application`](https://github.com/siliconjungle/siliconjungle--shapeshift-labs-frontier-application)
- [`siliconjungle/-shapeshift-labs-frontier-linter`](https://github.com/siliconjungle/-shapeshift-labs-frontier-linter)
- [`siliconjungle/-shapeshift-labs-frontier-crdt`](https://github.com/siliconjungle/-shapeshift-labs-frontier-crdt)
- [`siliconjungle/-shapeshift-labs-frontier-crdt-sync`](https://github.com/siliconjungle/-shapeshift-labs-frontier-crdt-sync)
- [`siliconjungle/-shapeshift-labs-frontier-crdt-websocket`](https://github.com/siliconjungle/-shapeshift-labs-frontier-crdt-websocket)
- [`siliconjungle/-shapeshift-labs-frontier-react`](https://github.com/siliconjungle/-shapeshift-labs-frontier-react)
- [`siliconjungle/-shapeshift-labs-frontier-richtext`](https://github.com/siliconjungle/-shapeshift-labs-frontier-richtext)
- [`siliconjungle/-shapeshift-labs-frontier-realtime`](https://github.com/siliconjungle/-shapeshift-labs-frontier-realtime)
- [`siliconjungle/-shapeshift-labs-frontier-realtime-server`](https://github.com/siliconjungle/-shapeshift-labs-frontier-realtime-server)
- [`siliconjungle/-shapeshift-labs-frontier-realtime-websocket`](https://github.com/siliconjungle/-shapeshift-labs-frontier-realtime-websocket)
- [`siliconjungle/-shapeshift-labs-frontier-game`](https://github.com/siliconjungle/-shapeshift-labs-frontier-game)

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
  encodeCrdtUpdateWithProfile,
  inspectCrdtUpdate,
  mergeCrdtUpdates
} from '@shapeshift-labs/frontier-crdt/update';
import { createCrdtBranch } from '@shapeshift-labs/frontier-crdt/branch';
import { createCrdtUndoManager } from '@shapeshift-labs/frontier-crdt/undo';
```

## Profile-Guided Update Codecs

`getProfile()` now records learned CRDT workload shape in addition to per-path text plans. Profiles can classify text-heavy, grid-like, tree-move-heavy, sparse-actor, rich-text mark-heavy, and mixed workloads, then expose the preferred update codec through `profile.plans.codec.crdt` and `profile.plans.crdt.update`.

```ts
const doc = createCrdtDocument({ actorId: 'writer-a' });

for (let row = 0; row < 4; row++) {
  doc.change((tx) => {
    tx.set(['grid', 'r' + row, 'c0'], row);
    tx.set(['grid', 'r' + row, 'c1'], row + 1);
  });
}

const profile = doc.getProfile();
const update = doc.exportUpdate();

const peer = createCrdtDocument({ actorId: 'reader-b', profile });
peer.applyUpdate(update);
```

`encodeCrdtUpdateWithProfile(update, profile)` is also available on the `./update` subpath for storage or relay code that works with decoded update objects.

## Subpath Imports

```ts
import { mergeCrdtUpdates } from '@shapeshift-labs/frontier-crdt/update';
import { createCrdtDocument } from '@shapeshift-labs/frontier-crdt/document';
import { createCrdtStateEngine } from '@shapeshift-labs/frontier-crdt/state';
import { createCrdtAwareness } from '@shapeshift-labs/frontier-crdt/awareness';
import { createCrdtBranch } from '@shapeshift-labs/frontier-crdt/branch';
import { createCrdtUndoManager } from '@shapeshift-labs/frontier-crdt/undo';
```

## Version Frames

Use version frames when an operation was authored against a specific document view and must be validated later before replay, optimistic commit, branch merge policy, undo, or rich-text anchor handling.

```ts
const doc = createCrdtDocument({ actorId: 'editor-a' });
doc.set('/title', 'Draft');
doc.markVersion('authored');

const frame = doc.captureFrame({
  mark: 'authored',
  paths: ['/title']
});

doc.set('/sidebar/open', true);

const evaluation = doc.evaluateFrame(frame);
console.log(evaluation.ok, evaluation.relation, evaluation.conflictingPaths);
```

Frames store the causal version (`heads` plus `stateVector`) and optional bounded path snapshots. Plain version evaluation requires the document to be exactly at the authored version; path evaluation tolerates unrelated later CRDT operations and reports the changed/conflicting paths when watched state moved. Pass `includeValues: false` for overlap-only validation when a caller already owns value checks.

## Package Scope

This package is intentionally limited to:

- Native CRDT document creation and document handles.
- CRDT JSON, map, list, plain text, counter, binary, tree, XML, and rich-text document operations.
- CRDT update encode/decode/merge/diff/inspect/filter/obfuscate helpers.
- Profile-guided CRDT update codec selection for learned workload families.
- Durable versioning, bounded version frames, snapshots, checkout/fork helpers, branch wrappers, conflict introspection, awareness, and undo.

It does not expose sync providers, repos, storage adapters, document URLs, local sync networks, model-checking transports, WebSocket transports, or editor text bindings. Those belong in the higher `@shapeshift-labs/frontier-crdt-sync` and `@shapeshift-labs/frontier-crdt-websocket` packages.

## Stability

The stable package surface is the plain document/update layer:

- `createCrdtDocument`, map/list/plain-text/counter/binary JSON operations, materialized view patches, state vectors, version frames, snapshots, checkout/fork/viewAt, changes-since exports, history traversal, commit metadata, and conflict introspection.
- Update tooling in `@shapeshift-labs/frontier-crdt/update`: encode/decode, profile-guided encode, inspect, merge, diff, filter, compact, obfuscate, update metadata, actor ranges, and state-vector conversion.
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

Local `change()` transactions expose creates to later operations in the same transaction. Register deletes remain CRDT tombstone operations, and transaction-local list/tree/text helpers replay pending operations before planning later moves, deletes, or reads.

## Benchmarks

Run the package-local benchmark:

```sh
npm run bench
```

Latest local package benchmark on Node v26.1.0, darwin arm64, 15 rounds:

| Fixture | Median | p95 | Bytes/op | Heap/op |
| --- | ---: | ---: | ---: | ---: |
| Local text insert transaction | 4.23 us | 10.81 us | - | - |
| Transaction create/move/read locals | 32.52 us | 46.65 us | - | - |
| Frame evaluate, 8 watched paths | 13.06 us | 27.36 us | - | - |
| Incremental text typing, 100 chars | 198.74 us | 242.81 us | - | - |
| Profile learn grid workload | 11.62 us | 35.80 us | - | - |
| Auto grid update encode, 8 cells | 2.45 us | 5.77 us | 440 B | - |
| Profile-guided grid update encode, 8 cells | 2.98 us | 6.70 us | 72 B | - |
| Auto grid update apply, 8 cells | 25.25 us | 47.93 us | 440 B | - |
| Profile-guided grid update apply, 8 cells | 28.72 us | 42.85 us | 72 B | - |
| Rich text anchored mark format | 35.41 us | 41.72 us | - | - |
| Rich text boundary insert resolve | 59.33 us | 95.37 us | - | - |
| Rich text Delta export, 6 spans | 24.02 us | 33.72 us | - | - |
| Update inspect metadata | 9.93 us | 19.88 us | - | - |
| Merge duplicate updates | 11.81 us | 16.01 us | - | - |
| Retained heap: 100-char text doc | 212.72 us | 265.60 us | - | 18.36 KiB |
| Retained heap: merged update replay | 299.68 us | 356.96 us | - | 5.97 KiB |
| Retained heap: compacted update bytes | 627.74 us | 833.83 us | - | 1.17 KiB |

These are Frontier-only package measurements, not competitor comparisons.

## License

MIT. See [LICENSE](./LICENSE).
