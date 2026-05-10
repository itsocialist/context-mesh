// context-mesh/src/tools/sync.ts
// Full Sync Cycle
// ─────────────────────────────────────────────────────────

import { SyncInput, SyncOutput, SyncError, ContextPackage, Namespace } from '../types/index.js';
import { ShipApeStorageAdapter } from '../lib/ship-ape.js';

export async function contextSync(
  input: SyncInput,
  storage: ShipApeStorageAdapter
): Promise<SyncOutput> {
  const { dry_run = false } = input;
  const startTime = Date.now();
  const now = new Date().toISOString();
  const today = now.split('T')[0];

  const errors: SyncError[] = [];
  let packagesScanned = 0;
  let packagesUpdated = 0;
  let packagesCreated = 0;
  let packagesExpired = 0;

  // 1. List all packages (optionally filtered by namespace)
  const namespacesToSync: Namespace[] = input.namespaces ?? ['personal', 'work', 'shared'];

  for (const ns of namespacesToSync) {
    let packages: ContextPackage[];
    try {
      packages = await storage.listPackages(ns);
    } catch (err) {
      errors.push({
        package_id: `namespace:${ns}`,
        namespace: ns,
        error: `Failed to list packages: ${(err as Error).message}`,
        timestamp: new Date().toISOString(),
      });
      continue;
    }

    for (const pkg of packages) {
      packagesScanned++;

      try {
        // 2. Check TTL expiry
        if (pkg.ttl_hours) {
          const ageMs = Date.now() - new Date(pkg.freshness_timestamp).getTime();
          const ageHours = ageMs / (1000 * 60 * 60);

          if (ageHours > pkg.ttl_hours) {
            if (!dry_run) {
              await storage.deletePackage(pkg.namespace, pkg.id);
            }
            packagesExpired++;
            continue;
          }
        }

        // 3. Bump version if checksum changed (detect external edits)
        // This is a no-op in sync; it's handled in push.
        // In sync, we just validate structure.

        // 4. Validate required fields
        if (!pkg.id || !pkg.namespace || !pkg.content) {
          errors.push({
            package_id: pkg.id ?? 'unknown',
            namespace: pkg.namespace ?? (ns as Namespace),
            error: 'Package missing required fields (id, namespace, or content)',
            timestamp: new Date().toISOString(),
          });
          continue;
        }

        packagesUpdated++;
      } catch (err) {
        errors.push({
          package_id: pkg.id,
          namespace: pkg.namespace,
          error: (err as Error).message,
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  const report: SyncOutput = {
    timestamp: now,
    dry_run,
    packages_scanned: packagesScanned,
    packages_updated: packagesUpdated,
    packages_created: packagesCreated,
    packages_expired: packagesExpired,
    errors,
    duration_ms: Date.now() - startTime,
  };

  // 5. Store sync report
  if (!dry_run) {
    try {
      await storage.storeSyncReport(today, report);
    } catch (err) {
      // Non-fatal — report storage failure is logged but doesn't fail the sync
      console.error('Failed to store sync report:', err);
    }
  }

  return report;
}
