# context-mesh — Architecture Diagram

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                          AI SURFACES                                 │
│                                                                      │
│  ┌─────────────────┐  ┌─────────────────┐  ┌────────────────────┐  │
│  │  personal-claude │  │   work-claude   │  │  pm-hub / edge-bird│  │
│  │  (Claude.ai      │  │  (Claude.ai CIQ)│  │  (custom agents)   │  │
│  │   personal)      │  │                 │  │                    │  │
│  └────────┬─────────┘  └────────┬────────┘  └─────────┬──────────┘  │
│           │                     │                      │             │
└───────────┼─────────────────────┼──────────────────────┼─────────────┘
            │                     │                      │
            └──────────────┬──────┘──────────────────────┘
                           │  MCP (stdio)
                    ┌──────▼──────────────┐
                    │    context-mesh      │
                    │    MCP Server        │
                    │                      │
                    │  ┌────────────────┐  │
                    │  │ Direction      │  │
                    │  │ Policy Engine  │  │
                    │  │                │  │
                    │  │ • Hard blocks  │  │
                    │  │ • Matrix rules │  │
                    │  │ • Overrides    │  │
                    │  └───────┬────────┘  │
                    │          │            │
                    │  ┌───────▼────────┐  │
                    │  │  Tool Layer    │  │
                    │  │                │  │
                    │  │ context_pull   │  │
                    │  │ context_push   │  │
                    │  │ context_distill│  │
                    │  │ context_sync   │  │
                    │  │ context_list   │  │
                    │  │ context_set_   │  │
                    │  │   policy       │  │
                    │  └───────┬────────┘  │
                    └──────────┼────────────┘
                               │
                    ┌──────────▼────────────┐
                    │   Local File Store    │
                    │  data/packages/       │
                    │                       │
                    │  personal/            │
                    │    brian-personal.json│
                    │  shared/              │
                    │    brian-shared.json  │
                    │  work/                │
                    │    ...                │
                    │  _policies/           │
                    │    overrides.json     │
                    │  _reports/            │
                    │    2026-05-10.json    │
                    └───────────────────────┘

         ┌─────────────────────────────────────┐
         │      context-mesh-scheduler          │
         │  (separate process, nightly cron)    │
         │                                      │
         │  cron(2AM) → batchSync()             │
         │    → connect via StdioClientTransport│
         │    → context_sync (TTL + validate)   │
         │    → auto-distill flagged packages   │
         └────────────────┬────────────────────┘
                          │  spawns
                          ▼
                   context-mesh (stdio)
```

---

## Direction Policy Matrix

```
                    ┌─────────────┬─────────────┬─────────────┐
                    │   personal  │    work     │   custom    │
                    │   surfaces  │   surfaces  │   surfaces  │
┌───────────────────┼─────────────┼─────────────┼─────────────┤
│ personal namespace│bidirectional│ inbound_only│bidirectional│
├───────────────────┼─────────────┼─────────────┼─────────────┤
│ work namespace    │  █ BLOCKED █│bidirectional│outbound_only│
├───────────────────┼─────────────┼─────────────┼─────────────┤
│ shared namespace  │bidirectional│bidirectional│bidirectional│
├───────────────────┼─────────────┼─────────────┼─────────────┤
│ project:personal  │   owner     │  █ BLOCKED █│  injected   │
├───────────────────┼─────────────┼─────────────┼─────────────┤
│ project:work      │  █ BLOCKED █│    team     │ work_scoped │
└───────────────────┴─────────────┴─────────────┴─────────────┘

  █ BLOCKED █ = hard block — enforced in code, not overridable
  inbound_only = surface can write to namespace; namespace doesn't push back
  outbound_only = namespace pushes to surface; surface can't write back
```

---

## Data Flow: context_pull

```
Surface calls context_pull(surface_id="personal-claude")
    │
    ▼
DirectionEngine.filterReadableNamespaces(
    ['personal','work','shared'], 'personal-claude'
)
    │ returns ['personal','shared']   (work is BLOCKED)
    ▼
storage.listPackages('personal')  ──→  [ brian-personal.json ]
storage.listPackages('shared')    ──→  [ brian-shared.json ]
    │
    ▼
Apply surface_whitelist / surface_blacklist filters
    │
    ▼
Sort: shared first, then personal, then work
    │
    ▼
mergePackagesForInjection(packages, format='core')
    │
    ▼
Return: { merged_content, freshness_summary, token_estimate }
```

---

## Data Flow: context_distill

```
Raw session notes (500–2000 words)
    │
    ▼
context_distill(source_content, target_namespace, surface_id)
    │
    ├── Check direction policy: can surface write to namespace?
    │
    ▼
Claude API (claude-haiku-4-5-20251001)
  System: .core format encoder prompt
  User:   raw session notes
    │
    ▼
.core formatted output (Ω Σ μ Ρ Φ χ sections)
    │
    ▼
buildCoreHeader() + distilled content + buildCoreFooter()
    │
    ▼
contextPush() → storage.storePackage()
    │
    ▼
Return: { core_content, compression_ratio, pushed: true }
```

---

## Data Flow: context_set_policy

```
context_set_policy(namespace, surface_id, policy, reason)
    │
    ├── isHardBlocked(namespace, surface_id)?
    │       YES → return error, no-op
    │       NO  → continue
    │
    ▼
PolicyOverride { namespace, surface_id, policy, reason, set_at }
    │
    ├── storage.storePolicy()  →  data/packages/_policies/{key}.json
    │
    └── direction.applyOverride()  →  live update (no restart needed)
```

---

## Storage Layout

```
data/packages/
├── personal/
│   ├── brian-personal.json          # seed: identity, cognitive style
│   └── distilled-{uuid}.json        # distilled session packages
├── shared/
│   └── brian-shared.json            # seed: cross-surface preferences
├── work/
│   └── ciq-role.json                # work context (never reaches personal)
├── project:context-mesh/
│   └── context-mesh-project.json    # this project's context
├── _policies/
│   └── shared__pm-hub.json          # persisted policy overrides
└── _reports/
    └── 2026-05-10.json              # nightly sync reports
```

---

## Context Package Schema

```typescript
ContextPackage {
  id: string                    // e.g. "brian-personal"
  namespace: Namespace          // "personal" | "work" | "shared" | "project:*"
  direction_policy: Policy      // "bidirectional" | "isolated" | ...
  content: string               // .core formatted text
  content_format: "core"        // or "coremin" | "prose"
  version: number               // increments on content change
  freshness_timestamp: ISO8601  // last meaningful update
  checksum: string              // SHA-256 of content
  ttl_hours?: number            // auto-expire after N hours
  auto_distill?: boolean        // include in nightly distillation
  tags: string[]
  surface_whitelist?: string[]  // only these surfaces receive it
  surface_blacklist?: string[]  // these surfaces never receive it
}
```

---

## .core Format Reference

```
# PACKAGEID.core v1
# ═══════════════════════════════
# namespace: personal
# direction_policy: bidirectional
# ═══════════════════════════════

## Ω (omega: purpose)
what this context achieves → outcome

## Σ (sigma: state)
EXISTS := { what currently exists }
NEEDED := { what's missing or needed }

## μ (mu: user_context)
identity, role, background

## Ρ (rho: roadmap)
now:  immediate focus
next: upcoming work
later: horizon items

## Φ (phi: patterns)
behavioral ∧ cognitive patterns
¬ anti-patterns to avoid

## χ (chi: verification)
Q1: grounding question? A: expected answer
```

---

## MCP Tool Surface

```
context-mesh MCP Server
│
├── context_pull          reads
├── context_push          writes (policy-gated)
├── context_distill       writes (Claude API + policy-gated)
├── context_sync          maintenance
├── context_list          reads
├── context_explain_policy  reads
├── context_set_policy    writes (admin, persisted)
└── context_delete_policy writes (admin, persisted)
```
