// context-mesh/src/tools/pull.ts
// ─────────────────────────────────────────────────────────

import {
  PullInput,
  PullOutput,
  ContextPackage,
  FreshnessSummary,
  Namespace,
} from '../types/index.js';
import { DirectionEngine } from '../lib/direction.js';
import { ShipApeStorageAdapter } from '../lib/ship-ape.js';
import { mergePackagesForInjection, estimateTokens } from '../lib/core-encoder.js';

const STALE_THRESHOLD_HOURS = 24; // default; override via config

export async function contextPull(
  input: PullInput,
  storage: ShipApeStorageAdapter,
  direction: DirectionEngine
): Promise<PullOutput> {
  const { surface_id, format = 'core', include_metadata = false } = input;

  // 1. Determine which namespaces to pull from
  const allNamespaces: Namespace[] = ['personal', 'work', 'shared'];
  const requestedNamespaces = input.namespaces ?? allNamespaces;

  // 2. Filter by direction policy
  const allowedNamespaces = direction.filterReadableNamespaces(requestedNamespaces, surface_id);

  // 3. Fetch packages for each allowed namespace
  const allPackages: ContextPackage[] = [];
  for (const ns of allowedNamespaces) {
    const packages = await storage.listPackages(ns);
    // Filter by surface_whitelist / surface_blacklist
    const filtered = packages.filter((pkg) => {
      if (pkg.surface_blacklist?.includes(surface_id)) return false;
      if (pkg.surface_whitelist && !pkg.surface_whitelist.includes(surface_id)) return false;
      return true;
    });
    allPackages.push(...filtered);
  }

  // 4. Sort: shared first, then personal, then work (priority order for injection)
  allPackages.sort((a, b) => {
    const order: Record<string, number> = { shared: 0, personal: 1, work: 2 };
    const aOrder = order[a.namespace] ?? 3;
    const bOrder = order[b.namespace] ?? 3;
    return aOrder - bOrder;
  });

  // 5. Build freshness summary
  const freshnessSummary: FreshnessSummary[] = allPackages.map((pkg) => {
    const ageMs = Date.now() - new Date(pkg.freshness_timestamp).getTime();
    const ageHours = ageMs / (1000 * 60 * 60);
    return {
      package_id: pkg.id,
      namespace: pkg.namespace,
      age_hours: Math.round(ageHours * 10) / 10,
      is_stale: ageHours > (pkg.ttl_hours ?? STALE_THRESHOLD_HOURS),
    };
  });

  // 6. Merge into single injection string
  const merged = mergePackagesForInjection(allPackages, format);

  return {
    surface_id,
    packages: allPackages,
    merged_content: merged,
    total_tokens_estimate: estimateTokens(merged),
    freshness_summary: freshnessSummary,
  };
}

// ─────────────────────────────────────────────────────────
// System Prompt Injection Helper
// Call this at agent/tool initialization
// ─────────────────────────────────────────────────────────

export function buildSystemPromptInjection(
  baseSystemPrompt: string,
  pullOutput: PullOutput
): string {
  if (!pullOutput.merged_content.trim()) {
    return baseSystemPrompt;
  }

  const staleWarning = pullOutput.freshness_summary.some((f) => f.is_stale)
    ? '\n⚠️  Some context packages are stale. Treat with lower confidence.\n'
    : '';

  return [
    baseSystemPrompt,
    '\n---',
    '## Active Context (context-mesh)',
    staleWarning,
    pullOutput.merged_content,
    '---\n',
  ].join('\n');
}
