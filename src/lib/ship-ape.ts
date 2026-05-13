// context-mesh/src/lib/ship-ape.ts
// Storage adapter for context packages, sync reports, and policy overrides.
//
// Two backends behind one public class:
//   - sqlite: direct access to ship-ape's SQLite DB (shape-core.db).
//             This is the BAAD Tools default — context-mesh persists into
//             ship-ape's own context_entries table under a reserved project
//             named "context-mesh", giving ship-ape true substrate status.
//   - file:   the original file-backed implementation. Kept as a fallback
//             so context-mesh runs standalone when ship-ape isn't installed.
//
// Backend selection (in priority order):
//   1. CONTEXT_MESH_STORAGE = "sqlite" | "file"          (explicit)
//   2. SHAPE_CORE_DB set and file exists                 (force sqlite)
//   3. Default: try ~/.shape-core/shape-core.db,
//      then ~/.mcp-context-memory/context.db; else file.
//
// Same public API as before; existing callers (push/pull/distill/sync/
// set-policy/seed-loader) are unchanged.
// ─────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import Database from 'better-sqlite3';
import { ContextPackage, PolicyOverride, Namespace, SurfaceId } from '../types/index.js';

const KEY_PREFIX = 'context-mesh';

// Reserved ship-ape project name that owns all context-mesh rows.
const SHAPE_CORE_PROJECT = 'context-mesh';

// Row-type prefixes inside ship-ape's context_entries.type column.
// "cm-" prefix avoids colliding with ship-ape's native types.
const TYPE_PACKAGE = 'cm-package';
const TYPE_REPORT = 'cm-report';
const TYPE_POLICY = 'cm-policy';

function getDataDir(): string {
  return process.env.CONTEXT_MESH_DATA_DIR ?? join(process.cwd(), 'data', 'packages');
}

function defaultShapeCoreDbPath(): string | null {
  const explicit = process.env.SHAPE_CORE_DB;
  if (explicit && existsSync(explicit)) return explicit;

  const candidates = [
    join(homedir(), '.shape-core', 'shape-core.db'),
    join(homedir(), '.shape-core', 'ship-ape.db'),
    join(homedir(), '.mcp-context-memory', 'context.db'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

function pickBackend(): { mode: 'sqlite'; dbPath: string } | { mode: 'file' } {
  const explicit = (process.env.CONTEXT_MESH_STORAGE ?? '').toLowerCase();
  if (explicit === 'file') return { mode: 'file' };
  if (explicit === 'sqlite') {
    const p = defaultShapeCoreDbPath();
    if (!p) throw new Error('CONTEXT_MESH_STORAGE=sqlite but no ship-ape DB found. Set SHAPE_CORE_DB or install shape-core.');
    return { mode: 'sqlite', dbPath: p };
  }
  // auto
  const p = defaultShapeCoreDbPath();
  return p ? { mode: 'sqlite', dbPath: p } : { mode: 'file' };
}

export function buildKey(namespace: string, package_id: string): string {
  return `${KEY_PREFIX}::${namespace}::${package_id}`;
}

export function parseKey(key: string): { namespace: string; package_id: string } | null {
  const parts = key.split('::');
  if (parts.length < 3 || parts[0] !== KEY_PREFIX) return null;
  return { namespace: parts[1], package_id: parts[2] };
}

// Encode (namespace, package_id) into a single string used as the ship-ape
// row's `key` column. Keeps namespace lookup cheap via a key prefix.
function rowKey(namespace: string, package_id: string): string {
  return `${namespace}::${package_id}`;
}

function policyRowKey(namespace: Namespace, surface_id: SurfaceId): string {
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9_.-]/g, '_');
  return `${safe(namespace)}__${safe(surface_id)}`;
}

// ─────────────────────────────────────────────────────────
// Backend interface
// ─────────────────────────────────────────────────────────

interface Backend {
  storePackage(pkg: ContextPackage): Promise<void>;
  getPackage(namespace: string, package_id: string): Promise<ContextPackage | null>;
  deletePackage(namespace: string, package_id: string): Promise<void>;
  listPackageKeys(namespace?: string): Promise<string[]>;
  listPackages(namespace?: string): Promise<ContextPackage[]>;
  storeSyncReport(date: string, report: object): Promise<void>;
  getSyncReport(date: string): Promise<object | null>;
  storePolicy(override: PolicyOverride): Promise<void>;
  deletePolicy(namespace: Namespace, surface_id: SurfaceId): Promise<void>;
  listPolicies(): Promise<PolicyOverride[]>;
}

// ─────────────────────────────────────────────────────────
// SQLite backend (BAAD Tools default — talks to ship-ape.db)
// ─────────────────────────────────────────────────────────

class SqliteBackend implements Backend {
  private db: Database.Database;
  private projectId: number;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    // Open in WAL is the shape-core convention — they already write the WAL files.
    this.db.pragma('journal_mode = WAL');
    this.projectId = this.ensureContextMeshProject();
  }

  private ensureContextMeshProject(): number {
    const existing = this.db.prepare('SELECT id FROM projects WHERE name = ?').get(SHAPE_CORE_PROJECT) as { id: number } | undefined;
    if (existing) return existing.id;
    const insert = this.db.prepare(
      `INSERT INTO projects (name, description, status, tags, metadata)
       VALUES (?, ?, 'active', ?, ?)`
    );
    const info = insert.run(
      SHAPE_CORE_PROJECT,
      'Reserved project for context-mesh package storage (BAAD Tools)',
      JSON.stringify(['context-mesh', 'baad-tools']),
      JSON.stringify({ owner: 'context-mesh', reserved: true })
    );
    return Number(info.lastInsertRowid);
  }

  async storePackage(pkg: ContextPackage): Promise<void> {
    const key = rowKey(pkg.namespace, pkg.id);
    const value = JSON.stringify(pkg);
    const tags = JSON.stringify([pkg.namespace, ...pkg.tags]);
    const meta = JSON.stringify({ namespace: pkg.namespace, package_id: pkg.id, version: pkg.version });

    const existing = this.db.prepare(
      'SELECT id FROM context_entries WHERE project_id = ? AND type = ? AND key = ?'
    ).get(this.projectId, TYPE_PACKAGE, key) as { id: number } | undefined;

    if (existing) {
      this.db.prepare(
        'UPDATE context_entries SET value = ?, tags = ?, metadata = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).run(value, tags, meta, existing.id);
    } else {
      this.db.prepare(
        `INSERT INTO context_entries (project_id, type, key, value, tags, metadata)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(this.projectId, TYPE_PACKAGE, key, value, tags, meta);
    }
  }

  async getPackage(namespace: string, package_id: string): Promise<ContextPackage | null> {
    const key = rowKey(namespace, package_id);
    const row = this.db.prepare(
      'SELECT value FROM context_entries WHERE project_id = ? AND type = ? AND key = ?'
    ).get(this.projectId, TYPE_PACKAGE, key) as { value: string } | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.value) as ContextPackage;
    } catch {
      return null;
    }
  }

  async deletePackage(namespace: string, package_id: string): Promise<void> {
    const key = rowKey(namespace, package_id);
    this.db.prepare(
      'DELETE FROM context_entries WHERE project_id = ? AND type = ? AND key = ?'
    ).run(this.projectId, TYPE_PACKAGE, key);
  }

  async listPackageKeys(namespace?: string): Promise<string[]> {
    const rows = namespace
      ? this.db.prepare(
          'SELECT key FROM context_entries WHERE project_id = ? AND type = ? AND key LIKE ?'
        ).all(this.projectId, TYPE_PACKAGE, `${namespace}::%`) as { key: string }[]
      : this.db.prepare(
          'SELECT key FROM context_entries WHERE project_id = ? AND type = ?'
        ).all(this.projectId, TYPE_PACKAGE) as { key: string }[];

    return rows.map(r => {
      const idx = r.key.indexOf('::');
      const ns = idx >= 0 ? r.key.slice(0, idx) : '';
      const id = idx >= 0 ? r.key.slice(idx + 2) : r.key;
      return buildKey(ns, id);
    });
  }

  async listPackages(namespace?: string): Promise<ContextPackage[]> {
    const rows = namespace
      ? this.db.prepare(
          'SELECT value FROM context_entries WHERE project_id = ? AND type = ? AND key LIKE ?'
        ).all(this.projectId, TYPE_PACKAGE, `${namespace}::%`) as { value: string }[]
      : this.db.prepare(
          'SELECT value FROM context_entries WHERE project_id = ? AND type = ?'
        ).all(this.projectId, TYPE_PACKAGE) as { value: string }[];

    const packages: ContextPackage[] = [];
    for (const r of rows) {
      try { packages.push(JSON.parse(r.value) as ContextPackage); } catch { /* skip corrupt */ }
    }
    return packages;
  }

  async storeSyncReport(date: string, report: object): Promise<void> {
    const value = JSON.stringify(report);
    const existing = this.db.prepare(
      'SELECT id FROM context_entries WHERE project_id = ? AND type = ? AND key = ?'
    ).get(this.projectId, TYPE_REPORT, date) as { id: number } | undefined;

    if (existing) {
      this.db.prepare(
        'UPDATE context_entries SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).run(value, existing.id);
    } else {
      this.db.prepare(
        `INSERT INTO context_entries (project_id, type, key, value, tags)
         VALUES (?, ?, ?, ?, ?)`
      ).run(this.projectId, TYPE_REPORT, date, value, JSON.stringify(['sync-report']));
    }
  }

  async getSyncReport(date: string): Promise<object | null> {
    const row = this.db.prepare(
      'SELECT value FROM context_entries WHERE project_id = ? AND type = ? AND key = ?'
    ).get(this.projectId, TYPE_REPORT, date) as { value: string } | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.value);
    } catch {
      return null;
    }
  }

  async storePolicy(override: PolicyOverride): Promise<void> {
    const key = policyRowKey(override.namespace, override.surface_id);
    const value = JSON.stringify(override);
    const existing = this.db.prepare(
      'SELECT id FROM context_entries WHERE project_id = ? AND type = ? AND key = ?'
    ).get(this.projectId, TYPE_POLICY, key) as { id: number } | undefined;

    if (existing) {
      this.db.prepare(
        'UPDATE context_entries SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).run(value, existing.id);
    } else {
      this.db.prepare(
        `INSERT INTO context_entries (project_id, type, key, value, tags)
         VALUES (?, ?, ?, ?, ?)`
      ).run(this.projectId, TYPE_POLICY, key, value, JSON.stringify(['policy-override']));
    }
  }

  async deletePolicy(namespace: Namespace, surface_id: SurfaceId): Promise<void> {
    const key = policyRowKey(namespace, surface_id);
    this.db.prepare(
      'DELETE FROM context_entries WHERE project_id = ? AND type = ? AND key = ?'
    ).run(this.projectId, TYPE_POLICY, key);
  }

  async listPolicies(): Promise<PolicyOverride[]> {
    const rows = this.db.prepare(
      'SELECT value FROM context_entries WHERE project_id = ? AND type = ?'
    ).all(this.projectId, TYPE_POLICY) as { value: string }[];
    const overrides: PolicyOverride[] = [];
    for (const r of rows) {
      try { overrides.push(JSON.parse(r.value) as PolicyOverride); } catch { /* skip corrupt */ }
    }
    return overrides;
  }
}

// ─────────────────────────────────────────────────────────
// File backend (fallback — original implementation)
// ─────────────────────────────────────────────────────────

class FileBackend implements Backend {
  private dataDir: string;

  constructor() {
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
      if (namespace.startsWith('_')) return [];
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
        if (ns.startsWith('_')) continue;
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

  private policyKey(namespace: Namespace, surface_id: SurfaceId): string {
    return policyRowKey(namespace, surface_id);
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
      } catch { /* skip corrupt */ }
    }
    return overrides;
  }
}

// ─────────────────────────────────────────────────────────
// Public adapter (selects backend at construction)
// ─────────────────────────────────────────────────────────

export class ShipApeStorageAdapter implements Backend {
  private backend: Backend;
  readonly mode: 'sqlite' | 'file';
  readonly dbPath?: string;

  constructor(_mcpClient?: unknown) {
    const choice = pickBackend();
    this.mode = choice.mode;
    if (choice.mode === 'sqlite') {
      this.dbPath = choice.dbPath;
      this.backend = new SqliteBackend(choice.dbPath);
    } else {
      this.backend = new FileBackend();
    }
  }

  storePackage(pkg: ContextPackage): Promise<void> { return this.backend.storePackage(pkg); }
  getPackage(namespace: string, package_id: string): Promise<ContextPackage | null> { return this.backend.getPackage(namespace, package_id); }
  deletePackage(namespace: string, package_id: string): Promise<void> { return this.backend.deletePackage(namespace, package_id); }
  listPackageKeys(namespace?: string): Promise<string[]> { return this.backend.listPackageKeys(namespace); }
  listPackages(namespace?: string): Promise<ContextPackage[]> { return this.backend.listPackages(namespace); }
  storeSyncReport(date: string, report: object): Promise<void> { return this.backend.storeSyncReport(date, report); }
  getSyncReport(date: string): Promise<object | null> { return this.backend.getSyncReport(date); }
  storePolicy(override: PolicyOverride): Promise<void> { return this.backend.storePolicy(override); }
  deletePolicy(namespace: Namespace, surface_id: SurfaceId): Promise<void> { return this.backend.deletePolicy(namespace, surface_id); }
  listPolicies(): Promise<PolicyOverride[]> { return this.backend.listPolicies(); }
}
