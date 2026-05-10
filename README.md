# context-mesh

Cross-surface AI context synchronization — an MCP server that keeps Brian's context consistent across personal Claude.ai, work Claude.ai, PM Hub, and Edge Bird agents.

Uses local file storage (`data/packages/`) as the backing store. Ship APE is used for session tracking and reporting separately.

---

## Install

```bash
npm install
cp .env.example .env
# edit .env — set ANTHROPIC_API_KEY at minimum
```

---

## Env vars

| Var | Default | Description |
|-----|---------|-------------|
| `ANTHROPIC_API_KEY` | — | Required for `context_distill` |
| `CONTEXT_MESH_DATA_DIR` | `./data/packages` | Where packages are stored |
| `DISTILL_MODEL` | `claude-haiku-4-5-20251001` | Claude model for distillation |
| `SYNC_SCHEDULE` | `0 2 * * *` | Cron schedule for nightly sync |

---

## CLI commands

```bash
npm run dev          # Start MCP server (stdio)
npm run seed         # Load context-packages/*.core into storage (skips existing)
npm run seed:force   # Re-seed all packages (overwrites)
npm run sync         # Run full sync cycle and exit
npm run sync:dry     # Dry-run sync — report only, no mutations
npm run build        # Compile to dist/
```

---

## Claude Desktop config

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "context-mesh": {
      "command": "node",
      "args": ["/Users/briandawson/workspace/context-mesh/dist/index.js"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-...",
        "CONTEXT_MESH_DATA_DIR": "/Users/briandawson/workspace/context-mesh/data/packages"
      }
    }
  }
}
```

For dev (no build step):
```json
{
  "command": "/Users/briandawson/workspace/context-mesh/node_modules/.bin/tsx",
  "args": ["/Users/briandawson/workspace/context-mesh/src/index.ts"]
}
```

---

## MCP tools

### `context_pull`
Pull direction-filtered context for a surface, merged for system prompt injection.

```json
{ "surface_id": "personal-claude", "format": "core" }
```

Returns `merged_content` — ready to append to a system prompt.

---

### `context_push`
Push context from a surface into a namespace. Direction policy is enforced; blocked pushes return `blocked: true`.

```json
{
  "surface_id": "work-claude",
  "namespace": "work",
  "content": "## Ω\n...",
  "tags": ["sprint-review"]
}
```

---

### `context_distill`
Distill raw session notes into `.core` format via Claude API, then push to storage.

```json
{
  "surface_id": "personal-claude",
  "source_content": "Today we decided to...",
  "target_namespace": "personal",
  "lookback_label": "2026-05-10"
}
```

---

### `context_sync`
Expire stale packages (TTL exceeded), validate structure, write sync report.

```json
{ "dry_run": true }
```

---

### `context_list`
List packages. Optionally filter by namespace or surface visibility.

```json
{ "namespace": "shared" }
{ "surface_id": "work-claude" }
```

---

### `context_explain_policy`
Explain the direction policy between a namespace and a surface.

```json
{ "namespace": "work", "surface_id": "personal-claude" }
```

Returns the policy (`isolated`, `bidirectional`, etc.) and a human-readable explanation.

---

### `context_set_policy`
Override direction policy for a namespace/surface pair. Hard blocks (`work → personal-claude`, `work → edge-bird`) cannot be overridden — ever.

```json
{
  "namespace": "shared",
  "surface_id": "pm-hub",
  "policy": "isolated",
  "reason": "pm-hub going read-only for audit period"
}
```

---

### `context_delete_policy`
Remove a policy override, reverting to the default direction matrix.

```json
{ "namespace": "shared", "surface_id": "pm-hub" }
```

---

## Direction policy matrix

| Namespace → Surface group | Policy |
|--------------------------|--------|
| `personal → personal` | `bidirectional` |
| `personal → work` | `inbound_only` |
| `personal → custom` | `bidirectional` |
| `work → personal` | **`isolated` (HARD BLOCK)** |
| `work → work` | `bidirectional` |
| `work → custom` | `outbound_only` |
| `shared → *` | `bidirectional` |

**Hard block:** `work` namespace never reaches `personal-claude` or `edge-bird` — enforced in code, not overridable via `context_set_policy`.

---

## Surface registration

| Surface ID | Owner | Allowed namespaces |
|------------|-------|-------------------|
| `personal-claude` | personal | personal, shared |
| `work-claude` | work | work, shared |
| `pm-hub` | work | work, shared (read-only) |
| `edge-bird` | personal | personal, shared |

---

## System prompt injection (PM Hub / custom surfaces)

```typescript
import { buildSystemPromptInjection } from 'context-mesh/src/tools/pull.js';

const ctx = await contextMeshMcp.callTool('context_pull', {
  surface_id: 'pm-hub',
  format: 'prose',
});
const merged = JSON.parse(ctx.content[0].text);
const systemPrompt = buildSystemPromptInjection(BASE_PROMPT, merged);
```

---

## Seed packages

`context-packages/` contains the seed `.core` files:

- `brian-personal.core` — identity, cognitive style, roles, active projects (namespace: `personal`)
- `brian-shared.core` — cross-surface preferences, anti-patterns, constraints (namespace: `shared`)

Run `npm run seed` to load them. Re-run `npm run seed:force` to overwrite.

---

## Phases

| Phase | Status |
|-------|--------|
| 1 — Core MCP server (pull, push, list, seed) | ✅ Done |
| 2 — Direction policy persistence + set_policy | ✅ Done |
| 3 — Distillation via Claude API | ✅ Done |
| 4 — Nightly scheduler (`context-mesh-scheduler`) | ✅ Done |
| 5 — PM Hub system prompt injection | Next |
