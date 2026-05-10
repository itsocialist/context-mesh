// context-mesh/src/lib/ship-ape.ts
// Local file-based storage adapter for context packages.
// Stores packages as JSON files under data/packages/{namespace}/{id}.json
// Ship APE MCP tool API returns truncated text strings — not suitable as a
// machine-readable key-value store. Local storage is used for Phase 1.
// ─────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { ContextPackage, PolicyOverride, Namespace, SurfaceId } from '../types/index.js';

const KEY_PREFIX = 'context-mesh';
const REPORT_PREFIX = `${KEY_PREFIX}::_reports`;

function getDataDir(): string {
  return process.env.CONTEXT_MESH_DATA_DIR ?? join(process.cwd(), 'data', 'packages');
}

export function buildKey(namespace: string, package_id: string): string {
  return `${KEY_PREFIX}::${namespace}::${package_id}`;
}

export function parseKey(key: string): { namespace: string; package_id: string } | null {
  const parts = key.split('::');
  if (parts.length < 3 || parts[0] !== KEY_PREFIX) return null;
  return { namespace: parts[1], package_id: parts[2] };
}

// ─────────────────────────────────────────────────────────
// ShipApeStorageAdapter
// File-backed implementation. Constructor accepts an optional
// mcpClient arg for future Ship APE sync (Phase 2+).
// ─────────────────────────────────────────────────────────

export class ShipApeStorageAdapter {
  private dataDir: string;

  constructor(_mcpClient?: any) {
    this.dataDir = getDataDir();
  }

  private packagePath(namespace: string, package_id: string): string {
    const safeNs = namespace.replace(/[^a-zA-Z0-9_:.-]/g, '_');
    const safeId = package_id.replace(/[^a-zA-Z0-9_:.-]/g, '_');
    return join(this.dataDir, safeNs, `${safeId}.json`);
  }

  private ensureDir(dir: string): void {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  async storePackage(pkg: ContextPackage): Promise<void> {
    const path = this.packagePath(pkg.namespace, pkg.id);
    this.ensureDir(dirname(path));
    writeFileSync(path, JSON.stringify(pkg, null, 2), 'utf-8');
  }

  async getPackage(namespace: string, package_id: string): Promise<ContextPackage | null> {
    const path = this.packagePath(namespace, package_id);
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, 'utf-8')) as ContextPackage;
    } catch {
      return null;
    }
  }

  async deletePackage(namespace: string, package_id: string): Promise<void> {
    const path = this.packagePath(namespace, package_id);
    if (existsSync(path)) unlinkSync(path);
  }

  async listPackageKeys(namespace?: string): Promise<string[]> {
    const keys: string[] = [];
    if (namespace) {
      if (namespace.startsWith('_')) return []; // internal dirs are not packages
      const dir = join(this.dataDir, namespace);
      if (!existsSync(dir)) return [];
      for (const file of readdirSync(dir)) {
        if (file.endsWith('.json') && statSync(join(dir, file)).isFile()) {
          keys.push(buildKey(namespace, file.slice(0, -5)));
        }
      }
    } else {
      if (!existsSync(this.dataDir)) return [];
      for (const ns of readdirSync(this.dataDir)) {
        const nsDir = join(this.dataDir, ns);
        if (!statSync(nsDir).isDirectory()) continue;
        if (ns.startsWith('_')) continue; // skip _reports, _policies, etc.
        for (const file of readdirSync(nsDir)) {
          if (file.endsWith('.json') && statSync(join(nsDir, file)).isFile()) {
            keys.push(buildKey(ns, file.slice(0, -5)));
          }
        }
      }
    }
    return keys;
  }

  async listPackages(namespace?: string): Promise<ContextPackage[]> {
    const keys = await this.listPackageKeys(namespace);
    const packages: ContextPackage[] = [];
    for (const key of keys) {
      const parsed = parseKey(key);
      if (!parsed) continue;
      const pkg = await this.getPackage(parsed.namespace, parsed.package_id);
      if (pkg) packages.push(pkg);
    }
    return packages;
  }

  async storeSyncReport(date: string, report: object): Promise<void> {
    const dir = join(this.dataDir, '_reports');
    this.ensureDir(dir);
    writeFileSync(join(dir, `${date}.json`), JSON.stringify(report, null, 2), 'utf-8');
  }

  async getSyncReport(date: string): Promise<object | null> {
    const path = join(this.dataDir, '_reports', `${date}.json`);
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, 'utf-8'));
    } catch {
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────
  // Policy Override Persistence
  // Stored at: data/packages/_policies/{encoded_key}.json
  // ─────────────────────────────────────────────────────────

  private policyKey(namespace: Namespace, surface_id: SurfaceId): string {
    const safe = (s: string) => s.replace(/[^a-zA-Z0-9_.-]/g, '_');
    return `${safe(namespace)}__${safe(surface_id)}`;
  }

  private get policiesDir(): string {
    return join(this.dataDir, '_policies');
  }

  async storePolicy(override: PolicyOverride): Promise<void> {
    this.ensureDir(this.policiesDir);
    const file = join(this.policiesDir, `${this.policyKey(override.namespace, override.surface_id)}.json`);
    writeFileSync(file, JSON.stringify(override, null, 2), 'utf-8');
  }

  async deletePolicy(namespace: Namespace, surface_id: SurfaceId): Promise<void> {
    const file = join(this.policiesDir, `${this.policyKey(namespace, surface_id)}.json`);
    if (existsSync(file)) unlinkSync(file);
  }

  async listPolicies(): Promise<PolicyOverride[]> {
    if (!existsSync(this.policiesDir)) return [];
    const overrides: PolicyOverride[] = [];
    for (const file of readdirSync(this.policiesDir)) {
      if (!file.endsWith('.json')) continue;
      try {
        const raw = readFileSync(join(this.policiesDir, file), 'utf-8');
        overrides.push(JSON.parse(raw) as PolicyOverride);
      } catch {
        // skip corrupt files
      }
    }
    return overrides;
  }
}
