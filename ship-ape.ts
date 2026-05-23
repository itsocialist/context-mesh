// context-mesh/src/lib/ship-ape.ts
// Ship APE Storage Adapter
// Wraps Ship APE MCP tools as a key-value store for context packages.
// ─────────────────────────────────────────────────────────

import { ContextPackage, ShipApeAdapter } from '../types/index.js';

// Ship APE key namespace prefix
const KEY_PREFIX = 'context-mesh';
const REPORT_PREFIX = `${KEY_PREFIX}::_reports`;

/**
 * Key convention: context-mesh::{namespace}::{package_id}
 * e.g. context-mesh::personal::brian-base
 *      context-mesh::project:pm-hub::current-sprint
 */
export function buildKey(namespace: string, package_id: string): string {
  return `${KEY_PREFIX}::${namespace}::${package_id}`;
}

export function parseKey(key: string): { namespace: string; package_id: string } | null {
  const parts = key.split('::');
  if (parts.length < 3 || parts[0] !== KEY_PREFIX) return null;
  // namespace may itself contain '::' for project namespaces? No — use '-' in project slugs
  return {
    namespace: parts[1],
    package_id: parts[2],
  };
}

// ─────────────────────────────────────────────────────────
// ShipApeStorageAdapter
// Implements ShipApeAdapter using the Ship APE MCP server.
// Claude Code: Wire this up to the Ship APE MCP client.
// ─────────────────────────────────────────────────────────

export class ShipApeStorageAdapter {
  private mcpClient: any; // TODO: type as Ship APE MCP client

  constructor(mcpClient: any) {
    this.mcpClient = mcpClient;
  }

  async storePackage(pkg: ContextPackage): Promise<void> {
    const key = buildKey(pkg.namespace, pkg.id);
    const value = JSON.stringify(pkg);
    await this.mcpClient.store_context({
      project: key,
      context: value,
    });
  }

  async getPackage(namespace: string, package_id: string): Promise<ContextPackage | null> {
    const key = buildKey(namespace, package_id);
    try {
      const result = await this.mcpClient.get_project_context({ project: key });
      if (!result || !result.context) return null;
      return JSON.parse(result.context) as ContextPackage;
    } catch {
      return null;
    }
  }

  async deletePackage(namespace: string, package_id: string): Promise<void> {
    const key = buildKey(namespace, package_id);
    await this.mcpClient.delete_context({ project: key });
  }

  async listPackageKeys(namespace?: string): Promise<string[]> {
    const prefix = namespace ? `${KEY_PREFIX}::${namespace}::` : `${KEY_PREFIX}::`;
    // Ship APE doesn't have a prefix list natively — use search_context as fallback
    // Claude Code: Implement this using Ship APE's list_projects or search_context
    // with prefix filtering on the returned keys.
    try {
      const result = await this.mcpClient.search_context({
        query: prefix,
        limit: 100,
      });
      return (result?.results ?? [])
        .map((r: any) => r.project ?? r.key ?? '')
        .filter((k: string) => k.startsWith(prefix));
    } catch {
      return [];
    }
  }

  async listPackages(namespace?: string): Promise<ContextPackage[]> {
    const keys = await this.listPackageKeys(namespace);
    const packages: ContextPackage[] = [];

    for (const key of keys) {
      const parsed = parseKey(key);
      if (!parsed) continue;
      // Skip report keys
      if (key.startsWith(REPORT_PREFIX)) continue;
      const pkg = await this.getPackage(parsed.namespace, parsed.package_id);
      if (pkg) packages.push(pkg);
    }

    return packages;
  }

  async storeSyncReport(date: string, report: object): Promise<void> {
    const key = `${REPORT_PREFIX}::${date}`;
    await this.mcpClient.store_context({
      project: key,
      context: JSON.stringify(report),
    });
  }

  async getSyncReport(date: string): Promise<object | null> {
    const key = `${REPORT_PREFIX}::${date}`;
    try {
      const result = await this.mcpClient.get_project_context({ project: key });
      if (!result?.context) return null;
      return JSON.parse(result.context);
    } catch {
      return null;
    }
  }
}
