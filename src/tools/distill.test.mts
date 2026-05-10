// context-mesh/src/tools/distill.test.mts
// Integration test: context_distill end-to-end
// Run: tsx src/tools/distill.test.mts
// ─────────────────────────────────────────────────────────

import { rmSync } from 'fs';
import { ShipApeStorageAdapter } from '../lib/ship-ape.js';
import { DirectionEngine } from '../lib/direction.js';
import { contextDistill } from './distill.js';

const TEST_DATA_DIR = '/tmp/context-mesh-distill-test';
process.env.CONTEXT_MESH_DATA_DIR = TEST_DATA_DIR;

// ─────────────────────────────────────────────────────────
// Sample: ~500-word session summary to distill
// ─────────────────────────────────────────────────────────

const SESSION_NOTES = `
Session: context-mesh Phase 1 build — 2026-05-10

We completed the Phase 1 MVP of context-mesh today. This is a standalone MCP server
that synchronizes AI context across Brian's multiple Claude surfaces: personal Claude.ai,
work Claude.ai (CIQ), PM Hub, and Edge Bird Systems.

Architecture decisions made:
- Ship APE's MCP tool API returns formatted text strings with values truncated at 77-100
  characters, making it unsuitable as a machine-readable key-value store. We switched to
  local file-based storage (data/packages/{namespace}/{id}.json) for Phase 1. Ship APE
  integration can be added later as an optional sync/reporting layer.
- Direction policy engine is implemented and tested. Hard block: work namespace NEVER
  flows to personal-claude or edge-bird surfaces. This is enforced at the DirectionEngine
  level and cannot be overridden via context_set_policy.
- edge-bird was misclassified as 'custom' surface group instead of 'personal', which
  would have bypassed the hard block. Fixed by checking registered surface configs before
  the CUSTOM_SURFACES fallback, and adding edge-bird as a hard-coded personal surface.

Completed work:
- src/types/index.ts — all TypeScript types
- src/lib/direction.ts — direction policy engine with hard block enforcement
- src/lib/core-encoder.ts — .core/.coremin encode/decode utilities
- src/lib/ship-ape.ts — local file storage adapter (replaces MCP client stub)
- src/lib/seed-loader.ts — loads .core files from context-packages/ into storage
- src/tools/pull.ts — context_pull: direction-filtered, merged context for injection
- src/tools/push.ts — context_push: validates direction policy before storing
- src/tools/distill.ts — context_distill: Claude API → .core format
- src/tools/sync.ts — context_sync: TTL expiry, validation, sync reports
- src/tools/set-policy.ts — context_set_policy: persistent overrides with hard block guard
- src/index.ts — MCP server entry point, 8 tools registered, --seed/--sync CLI modes
- context-packages/brian-personal.core, brian-shared.core — seeded

Open items:
- Phase 3: verify context_distill end-to-end with real Claude API call
- Phase 4: nightly scheduler (context-mesh-scheduler) MCP client wiring
- Phase 5: PM Hub system prompt injection integration
- Ship APE integration as sync target (future enhancement)
- context_list does not filter _reports or _policies directories — needs guard

Key people: Brian Dawson (Stylz) — builder, Edge Bird co-founder with Tabatha.
Departing CIQ April 2026. Day One Labs partner with James Andrews.
`;

// ─────────────────────────────────────────────────────────
// Test runner
// ─────────────────────────────────────────────────────────

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log('PASS', label);
  } else {
    console.error('FAIL', label);
    process.exitCode = 1;
  }
}

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error('ANTHROPIC_API_KEY is not set — cannot run integration test');
  process.exit(1);
}

console.log(`Using model: ${process.env.DISTILL_MODEL ?? 'claude-haiku-4-5-20251001'}`);
console.log('Calling Claude API for distillation (this may take a few seconds)...\n');

try {
  const storage = new ShipApeStorageAdapter();
  const direction = new DirectionEngine([], []);

  const result = await contextDistill(
    {
      surface_id: 'personal-claude',
      source_content: SESSION_NOTES.trim(),
      target_namespace: 'personal',
      target_package_id: 'session-2026-05-10',
      lookback_label: '2026-05-10',
      tags: ['session', 'context-mesh-build'],
    },
    storage,
    direction,
    apiKey
  );

  console.log('=== Distill Output ===');
  console.log(`package_id:        ${result.package_id}`);
  console.log(`tokens_original:   ${result.tokens_original}`);
  console.log(`tokens_compressed: ${result.tokens_compressed}`);
  console.log(`compression_ratio: ${result.compression_ratio}`);
  console.log(`pushed:            ${result.pushed}`);
  console.log('\n=== .core Content Preview (first 600 chars) ===');
  console.log(result.core_content.slice(0, 600));
  console.log('...\n');

  // Verify output
  assert(result.pushed === true, 'package was pushed to storage');
  assert(result.tokens_original > 0, 'has original token count');
  assert(result.tokens_compressed > 0, 'has compressed token count');
  assert(typeof result.compression_ratio === 'number' && isFinite(result.compression_ratio), 'compression_ratio is a finite number');
  assert(result.core_content.includes('Ω'), 'output contains Ω (purpose section)');
  assert(result.core_content.includes('Σ') || result.core_content.includes('χ') || result.core_content.includes('Φ'),
    'output contains at least one of Σ/χ/Φ sections');

  // Verify stored package is retrievable
  const stored = await storage.getPackage('personal', 'session-2026-05-10');
  assert(stored !== null, 'package is retrievable from storage');
  assert(stored?.id === 'session-2026-05-10', 'stored package has correct id');
  assert(stored?.namespace === 'personal', 'stored package has correct namespace');
  assert(stored?.tags?.includes('session') === true, 'stored package has session tag');

  if (process.exitCode === 1) {
    console.error('\nSome tests FAILED');
  } else {
    console.log('\nAll distill integration tests PASSED');
  }
} finally {
  rmSync(TEST_DATA_DIR, { recursive: true, force: true });
}
