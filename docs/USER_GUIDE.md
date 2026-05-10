# context-mesh — User Guide

## Why context-mesh exists

Every AI surface you use starts blind. Claude.ai personal doesn't know what you decided in your work session. Your PM Hub agent doesn't know your communication style. Your Edge Bird agents don't know your active projects.

You fix this by pasting context at the start of every session — the same context, over and over. That's manual overhead, it's inconsistent, and it's error-prone.

context-mesh solves this with a single structured store, a policy engine that controls what flows where, and MCP-native delivery so every surface gets what it needs automatically.

---

## Core concepts

### Namespaces

Context lives in namespaces. Each namespace has a trust level:

| Namespace | Trust | What goes here |
|-----------|-------|----------------|
| `personal` | Private | Identity, cognitive style, personal projects, history |
| `work` | Org-scoped | Role, priorities, work projects, customer context |
| `shared` | Universal | Cross-surface preferences, anti-patterns, communication style |
| `project:*` | Project-scoped | Per-project context inheriting from parent namespace |

### Direction policies

Policies control what flows between namespaces and surfaces:

- **`bidirectional`** — reads and writes flow both ways
- **`inbound_only`** — surface can write to namespace, namespace doesn't push back
- **`outbound_only`** — namespace pushes to surface, surface can't write back
- **`isolated`** — no flow; namespace and surface are disconnected

The most important rule is also the only hard rule: **work context never flows to personal surfaces.** This cannot be overridden, even by an admin policy call.

### Context packages

Each piece of context is a **context package** — a structured record with:
- An ID and namespace
- Content in `.core` format (or prose/coremin)
- A direction policy
- A freshness timestamp and optional TTL
- Tags and a SHA-256 checksum

### `.core` format

`.core` is a compressed, symbol-dense knowledge format designed for token efficiency. Key sections:

| Section | Symbol | What it holds |
|---------|--------|---------------|
| Purpose | `Ω` | What this context is for |
| State | `Σ` | EXISTS / NEEDED delta |
| User context | `μ` | Identity, role, background |
| Roadmap | `Ρ` | Now / next / later |
| Patterns | `Φ` | Behavioral and cognitive patterns |
| Verification | `χ` | Q&A for grounding |

---

## Getting started

### 1. Install

```bash
git clone https://github.com/itsocialist/context-mesh
cd context-mesh
npm install
cp .env.example .env
```

### 2. Configure `.env`

```
ANTHROPIC_API_KEY=sk-ant-...        # required for distillation
CONTEXT_MESH_DATA_DIR=./data/packages
DISTILL_MODEL=claude-haiku-4-5-20251001
```

### 3. Seed your context

context-mesh ships with two seed packages in `context-packages/`:

- `brian-personal.core` — personal identity, cognitive style, projects
- `brian-shared.core` — cross-surface preferences and anti-patterns

Customize these for yourself, then:

```bash
npm run seed
```

To overwrite existing packages:
```bash
npm run seed:force
```

### 4. Wire into Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "context-mesh": {
      "command": "/path/to/node_modules/.bin/tsx",
      "args": ["/path/to/context-mesh/src/index.ts"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-...",
        "CONTEXT_MESH_DATA_DIR": "/path/to/context-mesh/data/packages"
      }
    }
  }
}
```

Restart Claude Desktop. You'll see context-mesh tools in the MCP panel.

---

## Day-to-day usage

### Pulling context into a session

Use `context_pull` to get context for your current surface:

```
context_pull { "surface_id": "personal-claude", "format": "prose" }
```

The response includes `merged_content` — a ready-to-use block you can paste into any system prompt, or have Claude inject automatically.

### Pushing context after a session

If you made decisions or learned something important, push it:

```
context_push {
  "surface_id": "personal-claude",
  "namespace": "personal",
  "content": "## Ω\nDecided to use local file storage for Phase 1...",
  "tags": ["architecture", "context-mesh"]
}
```

If direction policy blocks the push (e.g., trying to push work context to personal namespace from work-claude), you'll get `blocked: true` with an explanation.

### Distilling a session

After a long session, have Claude summarize it into structured `.core` format:

```
context_distill {
  "surface_id": "personal-claude",
  "source_content": "[paste your session notes here]",
  "target_namespace": "personal",
  "lookback_label": "2026-05-10"
}
```

This calls the Claude API, compresses the notes into a `.core` package, and pushes it to storage automatically.

### Checking what's stored

```
context_list {}
context_list { "namespace": "shared" }
context_list { "surface_id": "pm-hub" }
```

### Understanding a policy

```
context_explain_policy {
  "namespace": "work",
  "surface_id": "personal-claude"
}
```

Returns: `HARD BLOCK: work → personal-claude is permanently isolated.`

### Overriding a policy

```
context_set_policy {
  "namespace": "shared",
  "surface_id": "pm-hub",
  "policy": "isolated",
  "reason": "audit period"
}
```

Overrides persist across server restarts. Revert with `context_delete_policy`.

---

## Surfaces

Register your surfaces in `src/index.ts` under `config.surfaces`. Each surface has:

- `id` — unique identifier (e.g., `pm-hub`)
- `owner_namespace` — which namespace owns it (`personal` or `work`)
- `allowed_namespaces` — what namespaces it can access
- `default_content_format` — `core`, `coremin`, or `prose`
- `push_on_session_end` — whether it pushes context back after sessions

### Injecting context into a custom surface

```typescript
import { buildSystemPromptInjection } from 'context-mesh/src/tools/pull.js';

const pullResult = await contextMeshMcp.callTool('context_pull', {
  surface_id: 'pm-hub',
  format: 'prose',
});
const merged = JSON.parse(pullResult.content[0].text);
const systemPrompt = buildSystemPromptInjection(BASE_SYSTEM_PROMPT, merged);
```

---

## Nightly scheduler

The companion `context-mesh-scheduler` runs a nightly sync cycle:

1. Calls `context_sync` — expires stale packages (TTL exceeded), validates all packages, writes a dated sync report
2. Auto-distills any packages marked `auto_distill: true`

```bash
cd context-mesh-scheduler
CONTEXT_MESH_PATH=/path/to/context-mesh/src/index.ts npm run sync:dry
```

Add it to a cron job or launchd agent to run automatically at 2 AM.

---

## Maintaining your context

### Freshness

Each package has a `freshness_timestamp`. Set `ttl_hours` to auto-expire stale packages:

```
context_push {
  ...
  "ttl_hours": 168
}
```

The nightly sync deletes expired packages.

### Editing seed packages

Edit `context-packages/brian-personal.core` or `brian-shared.core` directly, then:

```bash
npm run seed:force
```

### Running sync manually

```bash
npm run sync:dry   # see what would change
npm run sync       # apply changes
```

---

## Troubleshooting

**"blocked: true" on a push** — Direction policy is preventing the write. Use `context_explain_policy` to understand why. Most blocks are by design (especially `work → personal`).

**Context is stale** — Check `freshness_summary` in the `context_pull` response. Run `npm run sync` or push an updated package.

**Server won't start** — Check that `CONTEXT_MESH_DATA_DIR` exists and is writable. Run `npm run seed` to initialize it.

**Distillation fails** — Verify `ANTHROPIC_API_KEY` is set and valid. Check that `DISTILL_MODEL` is a supported Claude model ID.
