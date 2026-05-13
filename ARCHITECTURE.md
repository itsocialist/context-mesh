# context-mesh — Architecture Specification
**Version:** 0.1.0  
**Author:** Brian Dawson (Stylz)  
**Status:** Pre-implementation scaffold

---

## Problem Statement

Brian operates across multiple AI surfaces:
- `personal-claude` — Claude.ai personal account
- `work-claude` — Claude.ai CIQ/work account  
- Custom API tools — PM Hub, Edge Bird agents, etc.

Each surface is context-blind to the others. Anthropic's memory system is per-account and not API-accessible. Context goes stale. Work confidential context bleeds risk if it flows to personal surfaces.

---

## System Overview

**context-mesh** is a standalone MCP server that acts as the **orchestration layer** for Brian's cross-surface AI context. It does NOT replace Ship APE — it uses Ship APE as its persistence backend.

As of BAAD Tools Wave 1.1 (2026-05-13), persistence to Ship APE is wired
via direct SQLite access to `shape-core.db`, not the MCP API. Rationale
documented under **Storage Backend** below.

```
┌─────────────────────────────────────────────────────────┐
│                     AI SURFACES                          │
│  personal-claude  │  work-claude  │  pm-hub  │  agents  │
└────────┬──────────┴───────┬───────┴────┬─────┴────┬─────┘
         │                  │            │           │
         └──────────────────┼────────────┼───────────┘
                            │  context-mesh MCP
                     ┌──────┴──────┐
                     │  Direction  │
                     │  Policy     │
                     │  Engine     │
                     └──────┬──────┘
                            │
                ┌───────────┴───────────┐
                │                       │
         ┌──────┴──────┐       ┌────────┴──────┐
         │  Ship APE   │       │  .core format  │
         │  (storage)  │       │  + coremin     │
         └─────────────┘       └───────────────┘
                            │
                     ┌──────┴──────┐
                     │  Nightly    │
                     │  Scheduler  │
                     └─────────────┘
```

---

## Namespace Model

Each context package belongs to exactly one namespace:

| Namespace | Description | Default Direction |
|-----------|-------------|-------------------|
| `personal` | Identity, style, personal projects | outbound to shared tools |
| `work` | CIQ role, priorities, customer data | isolated from personal |
| `shared` | Safe cross-surface context | bidirectional |
| `project:{slug}` | Per-project context | inherits from parent namespace |

### Namespace ↔ Storage Key Mapping

context-mesh thinks in **namespaces** (the policy unit). Ship APE thinks in
**projects** (the storage unit). The mapping is:

```
Logical key:    context-mesh::{namespace}::{package_id}
Storage row:    project='context-mesh' (reserved), type='cm-package',
                key='{namespace}::{package_id}', value=JSON(ContextPackage)
```

The reserved project name `context-mesh` is created on first use. Direction
policy and content semantics stay exclusively in context-mesh; ship-ape's
substrate is policy-agnostic. **ship-ape stores bytes; context-mesh owns
semantics.**

The same convention applies to sync reports (`type='cm-report'`) and policy
overrides (`type='cm-policy'`), so all context-mesh state lives in one
ship-ape project and is recoverable from a single DB.

---

## Storage Backend

`ShipApeStorageAdapter` (`src/lib/ship-ape.ts`) picks one of two backends at
construction time:

| Mode | When chosen | Wire |
|------|-------------|------|
| **sqlite** | Default when shape-core is installed (BAAD Tools default) | Direct `better-sqlite3` access to `~/.shape-core/shape-core.db`. Reads and writes the same `context_entries` table ship-ape uses. |
| **file** | `CONTEXT_MESH_STORAGE=file` or no shape-core DB present | Original JSON-per-file layout under `data/packages/{namespace}/{id}.json`. Kept so context-mesh runs standalone. |

**Selection priority:**

1. `CONTEXT_MESH_STORAGE = "sqlite"` or `"file"` (explicit).
2. `SHAPE_CORE_DB` env var set and the file exists → sqlite.
3. Default: try `~/.shape-core/shape-core.db`, then `~/.shape-core/ship-ape.db`, then `~/.mcp-context-memory/context.db`. If none found, fall back to file.

**Why direct SQLite, not Ship APE's MCP tools?**

Ship APE's MCP tools return formatted text strings (values truncated at
77–100 characters for human readability). That is not a machine-readable
key/value channel. Two options were considered:

1. Add structured-response mode to ship-ape's MCP tools — invasive, affects
   every other ship-ape consumer.
2. Talk to the SQLite DB directly — single-machine assumption, but cheap,
   safe, and avoids two implementations of the same storage logic.

We picked (2). When BAAD Tools Wave 3 lands `ship-ape-remote`'s HTTP surface
and a Python/JS SDK, the adapter can grow a third backend (HTTP) for the
distributed case without changing the public API.

---

## Ship APE Deployment Shapes

There is one Ship APE codebase (`shape-core`) and three ways it runs:

| Shape | Wire | Used by |
|-------|------|---------|
| **shape-core** (local stdio) | MCP stdio | Claude Desktop, Claude Code |
| **shape-core-sse** (deprecated) | MCP over SSE locally | — (kept empty; superseded by ship-ape-remote) |
| **ship-ape-remote** | MCP over HTTP, wrapped by `mcp-remote` | claude.ai web; future Phase 6 LangChain bridge |

context-mesh today connects to local shape-core via the SQLite backend.
The remote shape (ship-ape-remote) is wired in Wave 3 when the HTTP
adapter is added.

---

## Direction Policy Engine

Direction policies control which namespaces can flow to which surfaces.

### Policy Types

| Policy | Meaning |
|--------|---------|
| `bidirectional` | Reads and writes flow both ways |
| `inbound_only` | Surface receives but does not push back |
| `outbound_only` | Surface pushes but does not receive |
| `isolated` | No sync — context stays in namespace |

### Default Direction Matrix

```
                   ┌──────────────┬──────────────┬──────────────┐
                   │ personal     │ work         │ custom_tools │
┌──────────────────┼──────────────┼──────────────┼──────────────┤
│ personal →       │ bidirectional│ shared_only  │ full         │
│ work →           │ BLOCKED      │ bidirectional│ work_scoped  │
│ shared →         │ bidirectional│ bidirectional│ bidirectional│
│ project:personal │ owner        │ BLOCKED      │ injected     │
│ project:work     │ BLOCKED      │ team         │ work_scoped  │
└──────────────────┴──────────────┴──────────────┴──────────────┘
```

**Key rules:**
- `work → personal` is **always blocked** (work confidential data never flows to personal surface)
- `personal → work` delivers only `shared` namespace packages
- Custom tools receive context scoped to their registered surface_tags

---

## Context Package Schema

Each context package stored in Ship APE:

```typescript
interface ContextPackage {
  id: string;                          // e.g., "personal-brian-base"
  namespace: Namespace;                // see Namespace enum
  direction_policy: DirectionPolicy;
  surface_whitelist?: SurfaceId[];     // if set, ONLY these surfaces receive this package
  surface_blacklist?: SurfaceId[];     // these surfaces never receive this package
  content: string;                     // .core format (or .coremin for protected)
  content_format: 'core' | 'coremin'; // which format
  version: number;
  freshness_timestamp: string;         // ISO 8601
  created_at: string;
  updated_at: string;
  tags: string[];
  checksum: string;                    // SHA-256 of content for change detection
  ttl_hours?: number;                  // optional: auto-expire stale packages
}
```

---

## MCP Tools

The context-mesh MCP server exposes these tools:

### `context_pull`
Pull context for injection into a surface's system prompt.
```
Input:  surface_id, namespaces? (default: all allowed), format? (core|coremin|prose)
Output: merged context string ready for system prompt injection
```
Returns a merged, direction-filtered context package for the requesting surface.

### `context_push`
Push a context update from a surface.
```
Input:  surface_id, content, namespace, tags?
Output: package_id, version, timestamp
```
Validates direction policy before accepting the push.

### `context_distill`
Summarize recent activity into a context package.
```
Input:  source_namespace, lookback_hours? (default: 24), target_namespace?, format?
Output: distilled .core package, pushed to store
```
Calls Claude API internally to summarize into .core format.

### `context_sync`
Trigger a full sync cycle (normally called by scheduler).
```
Input:  dry_run? (default: false)
Output: sync report: packages_updated, packages_created, packages_expired, errors
```

### `context_list`
List all packages with metadata.
```
Input:  namespace?, surface_id? (filters to what surface can see)
Output: package list with freshness and policy info
```

### `context_set_policy`
Override direction policy for a namespace/surface pair.
```
Input:  namespace, surface_id, policy
Output: updated policy
```

---

## Storage in Ship APE

Context packages are stored in Ship APE using this key convention:

```
context-mesh::{namespace}::{package_id}
```

Examples:
```
context-mesh::personal::brian-base
context-mesh::work::ciq-role
context-mesh::shared::cognitive-style
context-mesh::project:pm-hub::current-sprint
```

Ship APE's `store_context`, `get_project_context`, `search_context` are used directly.

---

## Nightly Batch Scheduler

A separate `context-mesh-scheduler` service runs nightly (default: 2:00 AM local):

**Batch Sync Cycle:**
1. Connect to context-mesh MCP
2. For each namespace with `ttl_hours` set: expire stale packages
3. For each namespace with `auto_distill: true`: call `context_distill`
4. Run `context_sync` with `dry_run: false`
5. Write sync report to Ship APE under `context-mesh::_reports::YYYY-MM-DD`

**Triggered manually via:**
```bash
npm run sync         # full sync
npm run sync:dry     # dry run (report only)
npm run distill      # distillation pass only
```

---

## Surface Registration

Each surface registers at startup:

```typescript
const surface: SurfaceConfig = {
  id: 'pm-hub',
  display_name: 'PM Hub',
  owner_namespace: 'work',
  allowed_namespaces: ['shared', 'work'],
  inject_on_init: true,
  push_on_session_end: false,  // pm-hub only reads, doesn't push
};
```

System prompt injection pattern:
```javascript
const ctx = await contextMesh.context_pull({ 
  surface_id: 'pm-hub',
  format: 'prose'  // or 'core' for token efficiency
});

const systemPrompt = `${BASE_SYSTEM_PROMPT}\n\n---\n## Active Context\n${ctx}`;
```

---

## .core Integration

Context packages are stored in `.core` format:
- `personal` namespace packages use full `.core` with `μ` section (user context)
- `work` namespace packages use `Σ` (state) + `Ρ` (roadmap) heavy format
- `shared` packages use minimal format: `Ω` + `μ` + `χ`
- Packages can be compiled to `.coremin` for token efficiency in high-frequency pulls

The `context_distill` tool uses Claude API to convert unstructured session notes into `.core` format automatically.

---

## New Repo vs Fork Decision

**Decision: New standalone repo `context-mesh`**

Rationale:
- Ship APE manages project/task context (what you're working on)
- context-mesh manages identity/cognitive/cross-surface context (who you are across AI)
- Different deployment lifecycle — context-mesh runs as a persistent MCP server; Ship APE may change
- Ship APE is the storage backend, not the peer

**No forks required.** Ship APE used via MCP API only.

---

## Phased Implementation

### Phase 1 — Core (MVP)
- [ ] context-mesh MCP server with `pull`, `push`, `list` tools
- [ ] Ship APE storage adapter
- [ ] `brian-personal.core`, `brian-shared.core` seed packages
- [ ] Manual push/pull via MCP tool calls

### Phase 2 — Direction + Policy
- [ ] Direction policy engine
- [ ] `context_set_policy` tool
- [ ] Surface registration config
- [ ] `work` namespace with isolation enforcement

### Phase 3 — Distillation
- [ ] `context_distill` tool with Claude API integration
- [ ] `.core` auto-formatting of distilled output
- [ ] Freshness tracking + TTL expiry

### Phase 4 — Scheduler
- [ ] `context-mesh-scheduler` service
- [ ] Nightly cron job
- [ ] Sync reports to Ship APE

### Phase 5 — PM Hub Integration
- [ ] System prompt injection helper
- [ ] Surface registration for pm-hub
- [ ] Session-end push hook

---

## File Structure

```
context-mesh/
├── src/
│   ├── index.ts              # MCP server entry point
│   ├── tools/
│   │   ├── pull.ts
│   │   ├── push.ts
│   │   ├── distill.ts
│   │   ├── sync.ts
│   │   └── list.ts
│   ├── lib/
│   │   ├── direction.ts      # Direction policy engine
│   │   ├── ship-ape.ts       # Ship APE adapter
│   │   ├── core-encoder.ts   # .core format utilities
│   │   └── crypto.ts         # checksum + change detection
│   └── types/
│       └── index.ts          # All shared types
├── context-packages/
│   ├── brian-personal.core   # seed: personal context
│   ├── brian-shared.core     # seed: shared context
│   └── direction-policy.core # seed: direction rules
├── docs/
│   └── ARCHITECTURE.md       # this file
├── package.json
├── tsconfig.json
└── README.md

context-mesh-scheduler/
├── src/
│   ├── index.ts              # scheduler entry point
│   └── batch-sync.ts         # batch sync logic
├── package.json
└── tsconfig.json
```
