// context-mesh-scheduler/src/index.ts
// Nightly Batch Sync Scheduler
// ─────────────────────────────────────────────────────────

import cron from 'node-cron';
import { batchSync } from './batch-sync.js';

const SCHEDULE = process.env.SYNC_SCHEDULE ?? '0 2 * * *'; // 2:00 AM daily
const CONTEXT_MESH_MCP_URL = process.env.CONTEXT_MESH_MCP_URL ?? 'http://localhost:3021/mcp';

console.log(`context-mesh-scheduler starting`);
console.log(`Schedule: ${SCHEDULE}`);
console.log(`Context Mesh MCP: ${CONTEXT_MESH_MCP_URL}`);

// ─────────────────────────────────────────────────────────
// Scheduled Job
// ─────────────────────────────────────────────────────────

cron.schedule(SCHEDULE, async () => {
  console.log(`[${new Date().toISOString()}] Starting nightly batch sync...`);
  try {
    const report = await batchSync({ dry_run: false, mcp_url: CONTEXT_MESH_MCP_URL });
    console.log(`[${new Date().toISOString()}] Sync complete:`, JSON.stringify(report, null, 2));
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Sync FAILED:`, err);
  }
});

// ─────────────────────────────────────────────────────────
// Manual Triggers (via npm run commands)
// ─────────────────────────────────────────────────────────

const command = process.argv[2];

if (command === 'sync') {
  console.log('Running manual sync...');
  batchSync({ dry_run: false, mcp_url: CONTEXT_MESH_MCP_URL })
    .then((report) => { console.log('Sync complete:', report); process.exit(0); })
    .catch((err) => { console.error('Sync failed:', err); process.exit(1); });
} else if (command === 'sync:dry') {
  console.log('Running dry-run sync...');
  batchSync({ dry_run: true, mcp_url: CONTEXT_MESH_MCP_URL })
    .then((report) => { console.log('Dry run complete:', report); process.exit(0); })
    .catch((err) => { console.error('Dry run failed:', err); process.exit(1); });
} else {
  console.log('Scheduler running. Use Ctrl+C to stop.');
  console.log('Manual commands: npm run sync | npm run sync:dry');
}
