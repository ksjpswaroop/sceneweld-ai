# ADR 0001: Shared Rust core and web/WASM boundary

- Status: Accepted
- Date: 2026-07-14
- Decision owners: SceneMeld maintainers

## Context

The repository intends to serve native desktop, browser, mobile, headless, plugin, scripting, MCP, and AI clients. If each client owns its own project model or editing semantics, save files, undo behavior, preview, export, and AI operations will diverge. Media decoding also differs materially between native FFmpeg-style backends and browser APIs such as WebCodecs.

The shared boundary therefore needs to keep deterministic editing semantics portable without pretending every platform has the same media or filesystem capabilities.

## Decision

Rust owns the portable project schema, integer/rational time model, command validation, transactions, undo/redo, migrations, and composition evaluation. These capabilities live in dependency-light crates that do not import GPUI, React, Cloudflare, FFmpeg, WebCodecs, or platform filesystem APIs.

Native applications link these crates directly. The web application compiles the same core to WebAssembly and runs it in a dedicated worker. React communicates with the worker through a versioned message protocol and renders immutable view snapshots; React state is not an independent project model.

Media, persistence, and background execution are adapters:

- native media adapters may use FFmpeg behind narrow probe/decode/render traits;
- browser media adapters may use WebCodecs, HTML media primitives, and origin-private storage;
- native persistence uses atomic filesystem writes and an external workspace manifest;
- browser persistence uses an IndexedDB/OPFS adapter where supported;
- desktop GPUI and web React translate user intent into the same typed command set;
- CLI, plugins, MCP, and AI use the same command schema and cannot bypass validation.

Project mutations cross the boundary as versioned commands or atomic batches. Read operations return bounded, serializable snapshots. Large decoded frames and audio buffers use platform-appropriate shared/transferable memory and do not pass through the project command log.

## Initial crate boundaries

```text
scenemeld-project   schema, IDs, migrations, portable serialization
scenemeld-time      integer ticks, rational rates, ranges, conversion
scenemeld-commands  validation, transactions, undo/redo, command replay
scenemeld-playback  composition evaluation independent of decode backend
```

Media, rendering, storage, plugins, and AI contracts may depend on these crates, but the four foundational crates must not depend on UI or provider implementations.

## Web protocol requirements

Every request and response includes a protocol version and request ID. Mutation requests also include the expected project version. The worker rejects unknown protocol versions, invalid commands, stale project versions, and unsupported capabilities without partially applying a batch.

TypeScript and Rust types must be generated from or checked against one canonical schema. Protocol fixture tests must deserialize in both runtimes. The browser may optimistically render interaction affordances, but authoritative project state comes back from the worker.

## Consequences

Positive consequences:

- desktop, web, CLI, plugins, MCP, and AI share edit semantics and migrations;
- deterministic command replay becomes the basis for undo, recovery, testing, and collaboration;
- UI frameworks can change without changing project files;
- AI plans can be validated as ordinary commands.

Costs and constraints:

- asynchronous worker messaging is required in the browser;
- schema/code generation and cross-runtime fixtures become mandatory;
- media adapters need explicit capability discovery and cannot leak codec-specific types into the core;
- browser previews may use different decode implementations, so golden composition semantics and export tolerances are required.

## Rejected alternatives

- **React/TypeScript owns the web model and Rust owns desktop:** rejected because it creates two command, migration, and undo implementations.
- **Put all media decoding inside portable WASM:** rejected because browser codec, licensing, binary-size, memory, and performance constraints differ from native targets.
- **Cloud API owns the project:** rejected because offline editing, creator ownership, and local recovery are product requirements.
- **UI sends arbitrary scripts to the core:** rejected because it breaks validation, capability control, determinism, and safe AI integration.

## Verification obligations

This decision is implemented only when the foundational crates exist and the same golden project and command fixtures pass natively and through WASM. Until then, this ADR is an accepted architectural constraint, not evidence that the shared core already exists.
