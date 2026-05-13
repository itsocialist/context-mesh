# context-mesh — Claude Code Implementation Brief

**Project:** context-mesh  
**Author:** Brian Dawson (Stylz)  
**Date:** 2026-03-23  
**Status:** Scaffold complete — ready for implementation

---

## What This Is

`context-mesh` is a new standalone MCP server that synchronizes AI context across Brian's multiple Claude surfaces (personal Claude.ai, work Claude.ai, PM Hub, Edge Bird agents). It is **not a fork** of any existing project. Ship APE is used as the storage backend via its MCP API.

---

## Repo Structure

Two repos to create:

```
context-mesh/              ← MCP server (primary deliverable)
context-mesh-scheduler/    ← Nightly cron job (Phase 4, lower priority)
```

All scaffold files are provided. Do not restructure them.

---

## What's Done (scaffold provided)

- `src/types/index.ts` — All TypeScript types. Do not change type signatures.
- `src/lib/direction.ts` — Direction policy engine. Logic is complete; needs testing.
- `src/lib/ship-ape.ts` — Ship APE storage adapter. **Closed 2026-05-13 (BAAD Tools Wave 1.1)**: dual backend — SQLite mode (direct read/write of `shape-core.db` under a reserved project `context-mesh`) auto-selected when ship-ape is installed; falls back to file mode for standalone use. See `src/lib/ship-ape.test.mts`.
- `src/lib/core-encoder.ts` — .core/.coremin encode/decode utilities. Complete.
- `src/tools/pull.ts` — `context_pull` tool. Complete.
- `src/tools/push.ts` — `context_push` tool. Complete.
- `src/tools/distill.ts` — `context_distill` tool. Complete.
- `src/tools/sync.ts` — `context_sync` tool. Complete.
- `src/index.ts` — MCP server entry point. Adapter is initialized by `new ShipApeStorageAdapter()`; backend is auto-selected via `CONTEXT_MESH_STORAGE` / `SHAPE_CORE_DB` env vars. No MCP-client wiring needed — context-mesh talks to ship-ape via SQLite.
- `context-packages/brian-personal.core` — Seed personal context package.
- `context-packages/brian-shared.core` — Seed shared context package.
- `docs/ARCHITECTURE.md` — Full architecture spec.

---

## What Claude Code Must Implement

### P0 — Required for Phase 1 MVP

#### 1. Ship APE MCP Client (`src/lib/ship-ape.ts` and `src/index.ts`)

The `ShipApeStorageAdapter` is wired to a `mcpClient: any`. Replace with a real MCP client.

Ship APE MCP URL comes from env: `SHIP_APE_MCP_URL`  
Ship APE MCP is already running at Brian's ngrok URL: `https://ecdysial-contiguous-danielle.ngrok-free.dev/ship-ape/mcp`

The MCP client needs to call these Ship APE tools:
- `store_context` — args: `{ project: string, context: string }`
- `get_project_context` — args: `{ project: string }`
- `delete_context` — args: `{ project: string }`
- `search_context` — args: `{ query: string, limit?: number }`

Use `@modelcontextprotocol/sdk` `Client` with `StreamableHTTPClientTransport` or `SSEClientTransport` depending on which Ship APE supports. Test the connection before proceeding.

#### 2. Seed Package Loader (`src/lib/seed-loader.ts` — new file)

On first startup (or when `--seed` flag is passed), load the `.core` files from `context-packages/` into Ship APE via the storage adapter.

```typescript
export async function seedPackages(storage: ShipApeStorageAdapter): Promise<void>
```

Read each `.core` file, build a `ContextPackage` object with these fields populated:
- `id` from filename (e.g., `brian-personal`, `brian-shared`)
- `namespace` from file header comment `# namespace:`
- `direction_policy` from file header comment `# direction_policy:`
- `content` = full file contents
- `content_format: 'core'`
- `version: 1`
- `freshness_timestamp`, `created_at`, `updated_at` = now
- `checksum` = SHA-256 of content (use `computeChecksum` from `core-encoder.ts`)
- `tags: ['seed']`

#### 3. `.env` File

Create `.env.example`:
```
SHIP_APE_MCP_URL=https://ecdysial-contiguous-danielle.ngrok-free.dev/ship-ape/mcp
ANTHROPIC_API_KEY=sk-ant-...
SYNC_SCHEDULE=0 2 * * *
```

#### 4. README.md

Cover: install, env setup, `npm run dev`, seed command, MCP tool reference (pull/push/distill/sync/list/explain_policy).

---

### P1 — Required for Phase 2

#### 5. `context_set_policy` Tool

Add to `src/tools/set-policy.ts` and register in `src/index.ts`.

```typescript
export async function contextSetPolicy(
  input: { namespace: Namespace; surface_id: SurfaceId; policy: DirectionPolicy; reason?: string },
  direction: DirectionEngine,
  storage: ShipApeStorageAdapter
): Promise<PolicyOverride>
```

Persist policy overrides in Ship APE under key `context-mesh::_policies::${namespace}::${surface_id}`. Load all overrides at startup and pass to `DirectionEngine` constructor.

#### 6. Startup: Load Persisted Policy Overrides

In `src/index.ts`, before starting the MCP server:
1. Load all keys matching `context-mesh::_policies::*` from Ship APE
2. Parse into `PolicyOverride[]`
3. Pass to `DirectionEngine` constructor

---

### P2 — Phase 3 (Distillation)

#### 7. `context_distill` Wiring

The `contextDistill` tool in `src/tools/distill.ts` is complete. Verify it works end-to-end:
1. Accepts raw session notes as `source_content`
2. Calls Claude API (`claude-sonnet-4-20250514`) with the distillation system prompt
3. Parses returned `.core` content
4. Calls `contextPush` to store

Add an integration test: pass a 500-word session summary, verify the output is valid `.core` format (contains Ω, Σ, χ sections).

---

### P3 — Phase 4 (Scheduler)

#### 8. `context-mesh-scheduler` MCP Client

In `context-mesh-scheduler/src/batch-sync.ts`, the MCP client initialization is stubbed out. Wire it up:
- Connect to `context-mesh` MCP server (not Ship APE directly)
- Call `context_sync` tool
- Parse and return the sync report

Add `tsconfig.json` (copy from `context-mesh/tsconfig.json`).

---

## Testing Checklist (Phase 1)

- [ ] `npm run dev` starts without errors
- [ ] Ship APE MCP client connects and authenticates
- [ ] Seed loader writes `brian-personal` and `brian-shared` packages to Ship APE
- [ ] `context_pull` for `personal-claude` returns both personal and shared packages
- [ ] `context_pull` for `work-claude` returns work and shared packages but NOT personal
- [ ] `context_push` from `work-claude` to `personal` namespace returns `blocked: true`
- [ ] `context_explain_policy` for `work → personal-claude` explains the hard block
- [ ] `context_list` returns all packages

---

## Critical Constraints

- **HARD BLOCK is non-negotiable:** `work` namespace MUST NEVER flow to `personal-claude` or `edge-bird` surfaces. Test this explicitly.
- Do not add new npm dependencies without a clear reason. The MCP SDK is sufficient for P0.
- Keep all `.core` file handling in `core-encoder.ts`. Do not scatter it.
- Direction engine logic lives in `direction.ts` only. Do not duplicate policy checks in tools.
- Ship APE key prefix is `context-mesh::` — do not change this or existing Ship APE data may collide.

---

## Questions Claude Code Should Answer Before Starting

1. Does Ship APE's MCP server support `StreamableHTTPClientTransport` or `SSEClientTransport`? Check by inspecting the Ship APE MCP server code or testing the endpoint.
2. Does Ship APE's `search_context` tool support prefix-based key listing? If not, `listPackages()` in `ship-ape.ts` needs an alternative implementation (e.g., maintain a separate index key).
3. Is the Ship APE ngrok URL stable or does it rotate? If it rotates, `SHIP_APE_MCP_URL` env var is critical — do not hardcode.

---

## Phase Summary

| Phase | Deliverable | Priority |
|-------|-------------|----------|
| 1 | Core MCP server: pull, push, list, seed | P0 now |
| 2 | Direction policy persistence + set_policy tool | P1 next |
| 3 | Distillation via Claude API | P2 |
| 4 | Nightly scheduler | P3 |
| 5 | PM Hub integration (system prompt injection) | P4 |
