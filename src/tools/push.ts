// context-mesh/src/tools/push.ts
// ─────────────────────────────────────────────────────────

import { PushInput, PushOutput, ContextPackage, Namespace } from '../types/index.js';
import { DirectionEngine } from '../lib/direction.js';
import { ShipApeStorageAdapter } from '../lib/ship-ape.js';
import { computeChecksum, hasContentChanged } from '../lib/core-encoder.js';
import { randomUUID } from 'crypto';

export async function contextPush(
  input: PushInput,
  storage: ShipApeStorageAdapter,
  direction: DirectionEngine
): Promise<PushOutput> {
  const { surface_id, content, namespace, tags = [] } = input;
  const now = new Date().toISOString();

  // 1. Check direction policy — can this surface write to this namespace?
  const canWrite = direction.canWrite(surface_id, namespace);
  if (!canWrite) {
    const explanation = direction.explain(namespace, surface_id);
    return {
      package_id: '',
      namespace,
      version: 0,
      timestamp: now,
      policy_applied: direction.getEffectivePolicy(namespace, surface_id),
      blocked: true,
      blocked_reason: explanation,
    };
  }

  // 2. If updating existing package, check for content changes
  const package_id = input.package_id ?? randomUUID();
  const existing = input.package_id
    ? await storage.getPackage(namespace, input.package_id)
    : null;

  if (existing && !hasContentChanged(existing, content)) {
    // No change — update freshness_timestamp only
    const updated: ContextPackage = {
      ...existing,
      freshness_timestamp: now,
      updated_at: now,
    };
    await storage.storePackage(updated);
    return {
      package_id: existing.id,
      namespace,
      version: existing.version,
      timestamp: now,
      policy_applied: direction.getEffectivePolicy(namespace, surface_id),
      blocked: false,
    };
  }

  // 3. Build/update the context package
  const version = (existing?.version ?? 0) + 1;
  const pkg: ContextPackage = {
    id: package_id,
    namespace,
    direction_policy: direction.getEffectivePolicy(namespace, surface_id),
    content,
    content_format: 'core',
    version,
    freshness_timestamp: now,
    created_at: existing?.created_at ?? now,
    updated_at: now,
    tags: [...new Set([...tags, surface_id])], // tag with source surface
    checksum: computeChecksum(content),
    ttl_hours: input.ttl_hours,
  };

  await storage.storePackage(pkg);

  return {
    package_id,
    namespace,
    version,
    timestamp: now,
    policy_applied: pkg.direction_policy,
    blocked: false,
  };
}
