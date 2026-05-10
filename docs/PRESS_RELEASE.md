# FOR IMMEDIATE RELEASE

**Edge Bird Systems Announces context-mesh: The Missing Infrastructure Layer for Multi-Surface AI**

*The open-source MCP server that finally lets your AI surfaces talk to each other — without compromising what should stay private*

---

**SAN DIEGO, CA — May 10, 2027**

Edge Bird Systems today announced the general availability of **context-mesh**, an open-source Model Context Protocol (MCP) server that solves one of the most persistent pain points for power AI users: the context blindness problem.

For the past two years, professionals using multiple AI surfaces — personal Claude.ai, work Claude.ai, custom agents, and PM tools — have been forced to manually paste the same context at the start of every session. Who they are. What they're building. What they decided last week. It was the equivalent of introducing yourself to a colleague every morning, then watching them forget everything by lunch.

context-mesh eliminates that. Entirely.

"The idea was simple but the implications were significant," said Brian Dawson, co-founder of Edge Bird Systems. "If you have more than one AI surface and more than one context, you need connective tissue. You need something that knows who you are, what you're working on, and what should and shouldn't cross from one surface to another. That's context-mesh."

---

## How It Works

context-mesh is a lightweight MCP server that maintains a structured, namespace-organized knowledge store and delivers the right context to the right surface at the right time. It integrates with Claude Desktop in three lines of configuration and begins working immediately.

Context is organized into namespaces — `personal`, `work`, `shared`, and per-project scopes — each governed by a **direction policy engine** that controls what can flow where. The flagship feature is the hard block: work context can never flow to personal surfaces, enforced at the code level and not overridable by any policy call. For professionals handling confidential client or employer data alongside personal AI usage, this is not a preference — it's a requirement.

The system also supports **context distillation**: after a long working session, users can paste their session notes into any Claude surface and have context-mesh automatically compress them into structured `.core` format via the Claude API, storing the result as a reusable context package for future sessions.

A companion **nightly scheduler** handles TTL expiry, package validation, and automated distillation for flagged packages — keeping context fresh without manual intervention.

---

## Reception

Since releasing on GitHub in early 2026, context-mesh has been adopted by over 4,000 power AI users — primarily founders, senior engineers, and PMs who operate across multiple Claude surfaces professionally.

"I used to spend the first ten minutes of every work Claude session re-explaining my role, my team structure, and what we decided in the last sprint," said one early adopter. "Now I just pull context and it's there. The work hard block alone would have been worth it — I've worked in regulated industries and I never wanted work context anywhere near my personal AI."

The `.core` format — the compressed, symbol-dense knowledge format used by context-mesh — has begun spreading independently, with users adopting it for everything from personal knowledge bases to team onboarding documents.

---

## Open Source and Extensible

context-mesh is fully open source (MIT license) and built on the Model Context Protocol, making it compatible with any MCP-capable AI surface. The direction policy engine is extensible — teams can register custom surfaces with their own namespace scopes and policy rules.

The project is available today at **github.com/itsocialist/context-mesh**.

---

## About Edge Bird Systems

Edge Bird Systems builds infrastructure for the personal AI layer — the tools, protocols, and patterns that let individuals operate effectively across an expanding fleet of AI agents and surfaces. Founded by Brian Dawson and Tabatha in San Diego, California.

---

*Press contact: Brian Dawson, brian@edgebird.ai*

---

> *Note: This is a working backwards press release — written from a future vantage point to clarify product vision and outcomes. All adoption figures and quotes are illustrative. The technology described is real and functional.*
