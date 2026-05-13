// context-mesh/src/lib/ship-ape.test.mts
// Smoke test for ShipApeStorageAdapter (both backends).
// Run: tsx src/lib/ship-ape.test.mts
//
// SQLite mode: uses a temp DB file with the shape-core schema applied,
// so the test is isolated and does NOT touch ~/.shape-core/shape-core.db.
// ─────────────────────────────────────────────────────────

import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { ShipApeStorageAdapter, buildKey, parseKey } from './ship-ape.js';
import type { ContextPackage, PolicyOverride } from '../types/index.js';
import { schema as SHAPE_CORE_SCHEMA } from '../../../shape-core/src/db/schema.js';

let passed = 0;
let failed = 0;

function assert(cond: boolean, label: string) {
  if (cond) { console.log('PASS', label); passed++; }
  else { console.error('FAIL', label); failed++; }
}

function makePackage(namespace: string, id: string): ContextPackage {
  const now = new Date().toISOString();
  return {
    id,
    namespace: namespace as ContextPackage['namespace'],
    direction_policy: 'bidirectional',
    content: `Test content for ${namespace}/${id}`,
    content_format: 'prose',
    version: 1,
    freshness_timestamp: now,
    created_at: now,
    updated_at: now,
    tags: ['test'],
    checksum: 'sha256:test',
  };
}

async function runSuite(mode: 'sqlite' | 'file', tmpRoot: string) {
  console.log(`\n=== Backend: ${mode} ===`);
  const adapter = new ShipApeStorageAdapter();
  assert(adapter.mode === mode, `adapter selected ${mode} mode`);

  // ── Packages ──
  const pkg1 = makePackage('personal', 'brian-base');
  const pkg2 = makePackage('shared', 'brian-shared');
  const pkg3 = makePackage('work', 'work-only');

  await adapter.storePackage(pkg1);
  await adapter.storePackage(pkg2);
  await adapter.storePackage(pkg3);

  const fetched = await adapter.getPackage('personal', 'brian-base');
  assert(fetched !== null && fetched.id === 'brian-base', 'getPackage returns stored package');
  assert(fetched?.content === pkg1.content, 'package content roundtrips');

  // Update
  pkg1.content = 'Updated content';
  pkg1.version = 2;
  await adapter.storePackage(pkg1);
  const updated = await adapter.getPackage('personal', 'brian-base');
  assert(updated?.content === 'Updated content', 'update overwrites prior package');
  assert(updated?.version === 2, 'updated version persists');

  // List
  const allKeys = await adapter.listPackageKeys();
  assert(allKeys.length === 3, `listPackageKeys returns 3 (got ${allKeys.length})`);
  assert(allKeys.includes(buildKey('personal', 'brian-base')), 'list contains personal::brian-base');

  const personalKeys = await adapter.listPackageKeys('personal');
  assert(personalKeys.length === 1, `namespace filter returns 1 personal key (got ${personalKeys.length})`);

  const personalPkgs = await adapter.listPackages('personal');
  assert(personalPkgs.length === 1 && personalPkgs[0]!.id === 'brian-base', 'listPackages namespace filter works');

  // parseKey round-trip
  const parsed = parseKey(buildKey('personal', 'brian-base'));
  assert(parsed?.namespace === 'personal' && parsed?.package_id === 'brian-base', 'parseKey round-trips');

  // Delete
  await adapter.deletePackage('work', 'work-only');
  const gone = await adapter.getPackage('work', 'work-only');
  assert(gone === null, 'delete removes package');
  const afterDelete = await adapter.listPackageKeys();
  assert(afterDelete.length === 2, `after delete: 2 keys (got ${afterDelete.length})`);

  // ── Sync reports ──
  const report = { date: '2026-05-13', synced: 3, expired: 0 };
  await adapter.storeSyncReport('2026-05-13', report);
  const fetchedReport = await adapter.getSyncReport('2026-05-13') as typeof report | null;
  assert(fetchedReport !== null && fetchedReport.synced === 3, 'sync report round-trips');

  // ── Policies ──
  const override: PolicyOverride = {
    namespace: 'personal',
    surface_id: 'personal-claude',
    policy: 'outbound_only',
    reason: 'test override',
    set_at: new Date().toISOString(),
  };
  await adapter.storePolicy(override);
  const policies = await adapter.listPolicies();
  assert(policies.length === 1 && policies[0]!.policy === 'outbound_only', 'policy stored and listed');

  await adapter.deletePolicy('personal', 'personal-claude');
  const after = await adapter.listPolicies();
  assert(after.length === 0, 'policy deleted');
}

// ── Suite 1: file backend (forced via env) ──
const fileTmp = mkdtempSync(join(tmpdir(), 'cm-file-'));
process.env.CONTEXT_MESH_DATA_DIR = fileTmp;
process.env.CONTEXT_MESH_STORAGE = 'file';
delete process.env.SHAPE_CORE_DB;
await runSuite('file', fileTmp);
rmSync(fileTmp, { recursive: true, force: true });

// ── Suite 2: sqlite backend (forced via env, isolated temp DB) ──
const sqliteTmp = mkdtempSync(join(tmpdir(), 'cm-sqlite-'));
const dbPath = join(sqliteTmp, 'shape-core.db');
// Build a real shape-core schema in the temp DB so the adapter sees a valid DB.
const seed = new Database(dbPath);
seed.exec(SHAPE_CORE_SCHEMA);
seed.close();
process.env.SHAPE_CORE_DB = dbPath;
process.env.CONTEXT_MESH_STORAGE = 'sqlite';
await runSuite('sqlite', sqliteTmp);
rmSync(sqliteTmp, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
