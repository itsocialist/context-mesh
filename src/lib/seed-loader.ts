// context-mesh/src/lib/seed-loader.ts
// Loads .core seed files from context-packages/ into the storage adapter.
// ─────────────────────────────────────────────────────────

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { ShipApeStorageAdapter } from './ship-ape.js';
import { computeChecksum } from './core-encoder.js';
import { ContextPackage, Namespace, DirectionPolicy } from '../types/index.js';

function parseHeaderField(content: string, field: string): string | null {
  const match = content.match(new RegExp(`^# ${field}:\\s*(.+)$`, 'm'));
  return match ? match[1].trim() : null;
}

export async function seedPackages(
  storage: ShipApeStorageAdapter,
  packagesDir?: string,
  force = false
): Promise<{ seeded: string[]; skipped: string[] }> {
  const dir = packagesDir ?? join(process.cwd(), 'context-packages');
  const seeded: string[] = [];
  const skipped: string[] = [];

  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.core'));
  } catch {
    console.error(`Seed: context-packages directory not found at ${dir}`);
    return { seeded, skipped };
  }

  const now = new Date().toISOString();

  for (const file of files) {
    const id = file.replace('.core', '');
    const content = readFileSync(join(dir, file), 'utf-8');

    const namespace = (parseHeaderField(content, 'namespace') ?? 'shared') as Namespace;
    const direction_policy = (parseHeaderField(content, 'direction_policy') ?? 'bidirectional') as DirectionPolicy;

    if (!force) {
      const existing = await storage.getPackage(namespace, id);
      if (existing) {
        console.error(`Seed: ${id} already exists (v${existing.version}), skipping`);
        skipped.push(id);
        continue;
      }
    }

    const pkg: ContextPackage = {
      id,
      namespace,
      direction_policy,
      content,
      content_format: 'core',
      version: 1,
      freshness_timestamp: now,
      created_at: now,
      updated_at: now,
      tags: ['seed'],
      checksum: computeChecksum(content),
    };

    await storage.storePackage(pkg);
    console.error(`Seed: loaded ${id} (${namespace})`);
    seeded.push(id);
  }

  return { seeded, skipped };
}
