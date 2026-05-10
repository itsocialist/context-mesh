// context-mesh/src/tools/set-policy.ts
// context_set_policy — Override direction policy for a namespace/surface pair.
// Hard blocks cannot be overridden.
// ─────────────────────────────────────────────────────────

import { Namespace, SurfaceId, DirectionPolicy, PolicyOverride } from '../types/index.js';
import { DirectionEngine } from '../lib/direction.js';
import { ShipApeStorageAdapter } from '../lib/ship-ape.js';

export interface SetPolicyInput {
  namespace: Namespace;
  surface_id: SurfaceId;
  policy: DirectionPolicy;
  reason?: string;
}

const HARD_BLOCKED: Array<{ namespace: string; surface_group: string }> = [
  { namespace: 'work', surface_group: 'personal' },
];

const PERSONAL_SURFACES = new Set(['personal-claude', 'edge-bird', 'day-one']);

function isHardBlocked(namespace: Namespace, surface_id: SurfaceId): boolean {
  const surfaceGroup = PERSONAL_SURFACES.has(surface_id) ? 'personal' : 'other';
  return HARD_BLOCKED.some(
    (b) => b.namespace === namespace && b.surface_group === surfaceGroup
  );
}

export async function contextSetPolicy(
  input: SetPolicyInput,
  direction: DirectionEngine,
  storage: ShipApeStorageAdapter
): Promise<{ override: PolicyOverride; error?: string }> {
  const { namespace, surface_id, policy, reason } = input;

  // Hard blocks cannot be overridden — ever
  if (isHardBlocked(namespace, surface_id)) {
    const msg = `HARD BLOCK: ${namespace} → ${surface_id} cannot be overridden. Work context must never flow to personal surfaces.`;
    return { override: {} as PolicyOverride, error: msg };
  }

  const now = new Date().toISOString();
  const override: PolicyOverride = {
    namespace,
    surface_id,
    policy,
    reason,
    set_at: now,
  };

  // Persist and apply live
  await storage.storePolicy(override);
  direction.applyOverride(override);

  return { override };
}

export async function contextDeletePolicy(
  input: { namespace: Namespace; surface_id: SurfaceId },
  direction: DirectionEngine,
  storage: ShipApeStorageAdapter
): Promise<{ deleted: boolean }> {
  const { namespace, surface_id } = input;
  await storage.deletePolicy(namespace, surface_id);
  direction.removeOverride(namespace, surface_id);
  return { deleted: true };
}
