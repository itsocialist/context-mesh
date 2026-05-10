# context-mesh — One Sheet

## The Problem

You're working with AI every day — but your AI surfaces don't know each other.

Your personal Claude knows your writing style. Your work Claude knows your projects. Your PM Hub agent has your roadmap. None of them share context. You spend the first ten minutes of every session re-explaining who you are, what you're building, and what you decided last week.

This is the **context blindness problem.** And it gets worse as you add more AI surfaces.

---

## The Solution

**context-mesh** is a lightweight MCP server that acts as the connective tissue across all your AI surfaces.

It maintains a structured knowledge store — organized by namespace, governed by direction policy — and delivers the right context to the right surface at the right time.

- `personal-claude` gets your identity, cognitive style, and personal projects
- `work-claude` gets your role, priorities, and work context — never leaking to personal
- `pm-hub` gets your roadmap and team context injected into every session
- Custom agents get scoped context based on their registered permissions

One seed. Every surface, coherent.

---

## How It Works

```
You write once → context-mesh stores it → every surface wakes up knowing who you are
```

**Namespaces** organize context by trust level: `personal`, `work`, `shared`, `project:*`

**Direction policies** control what flows where:
- `shared` context reaches every surface
- `work` context never flows to personal surfaces — ever, by design
- Custom tools get scoped, read-only context

**Distillation** converts raw session notes into compressed `.core` format via Claude API — your AI summarizes its own context so you don't have to.

**Nightly sync** keeps everything fresh, expires stale packages, writes audit reports.

---

## Key Features

| Feature | Description |
|---------|-------------|
| MCP-native | Drop into any Claude Desktop config in 3 lines |
| Direction policy engine | Hard block: work context never reaches personal surfaces |
| `.core` format | Compressed, symbol-dense knowledge format — token-efficient |
| Session distillation | Claude API converts session notes to structured context |
| Policy overrides | Override direction rules per surface, with audit trail |
| Nightly scheduler | Auto-sync, TTL expiry, sync reports |

---

## Who It's For

Power AI users operating across multiple Claude surfaces — builders, founders, PMs, and anyone who's tired of explaining themselves from scratch in every new conversation.

If you have more than one AI surface and more than one context, you need context-mesh.

---

## Tech

- TypeScript / Node.js MCP server (stdio transport)
- Local file storage — your data stays on your machine
- Integrates with Claude Desktop in minutes
- Scheduler companion app for nightly sync
- Open source

---

*Built by Brian Dawson (Stylz) — Edge Bird Systems*
