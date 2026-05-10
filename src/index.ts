// context-mesh/src/index.ts
// MCP Server Entry Point
// ─────────────────────────────────────────────────────────

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { DirectionEngine } from './lib/direction.js';
import { ShipApeStorageAdapter } from './lib/ship-ape.js';
import { seedPackages } from './lib/seed-loader.js';
import { contextPull } from './tools/pull.js';
import { contextPush } from './tools/push.js';
import { contextDistill } from './tools/distill.js';
import { contextSync } from './tools/sync.js';
import { contextSetPolicy, contextDeletePolicy } from './tools/set-policy.js';

import type { ContextMeshConfig } from './types/index.js';

// ─────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────

const config: ContextMeshConfig = {
  ship_ape_mcp_url: process.env.SHIP_APE_MCP_URL ?? '',
  anthropic_api_key: process.env.ANTHROPIC_API_KEY,
  default_format: 'core',
  stale_threshold_hours: 24,
  surfaces: [
    {
      id: 'personal-claude',
      display_name: 'Personal Claude.ai',
      owner_namespace: 'personal',
      allowed_namespaces: ['personal', 'shared'],
      inject_on_init: true,
      push_on_session_end: true,
      default_content_format: 'core',
    },
    {
      id: 'work-claude',
      display_name: 'Work Claude.ai (CIQ)',
      owner_namespace: 'work',
      allowed_namespaces: ['work', 'shared'],
      inject_on_init: true,
      push_on_session_end: true,
      default_content_format: 'core',
    },
    {
      id: 'pm-hub',
      display_name: 'PM Hub',
      owner_namespace: 'work',
      allowed_namespaces: ['work', 'shared'],
      inject_on_init: true,
      push_on_session_end: false,
      default_content_format: 'prose',
    },
    {
      id: 'edge-bird',
      display_name: 'Edge Bird Systems',
      owner_namespace: 'personal',
      allowed_namespaces: ['personal', 'shared'],
      inject_on_init: true,
      push_on_session_end: true,
      default_content_format: 'core',
    },
  ],
};

// ─────────────────────────────────────────────────────────
// Bootstrap — load persisted policy overrides before starting
// ─────────────────────────────────────────────────────────

const storage = new ShipApeStorageAdapter();
const persistedOverrides = await storage.listPolicies();
const direction = new DirectionEngine(
  [...(config.policy_overrides ?? []), ...persistedOverrides],
  config.surfaces
);

// ─────────────────────────────────────────────────────────
// CLI modes: --seed, --sync, --sync-dry (runs then exits)
// ─────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes('--seed')) {
  console.error('context-mesh: seeding packages...');
  seedPackages(storage, undefined, args.includes('--force'))
    .then(({ seeded, skipped }) => {
      console.error(`Seed complete: ${seeded.length} loaded, ${skipped.length} skipped`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Seed failed:', err);
      process.exit(1);
    });
} else if (args.includes('--sync') || args.includes('--sync-dry')) {
  const dry_run = args.includes('--sync-dry');
  contextSync({ dry_run }, storage)
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error('Sync failed:', err);
      process.exit(1);
    });
} else {
  startServer();
}

// ─────────────────────────────────────────────────────────
// MCP Server
// ─────────────────────────────────────────────────────────

function startServer() {
  const server = new Server(
    { name: 'context-mesh', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  // ─────────────────────────────────────────────────────────
  // Tool Definitions
  // ─────────────────────────────────────────────────────────

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'context_pull',
        description: 'Pull context packages for a surface, direction-filtered and merged for system prompt injection.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            surface_id: { type: 'string', description: 'The surface requesting context' },
            namespaces: { type: 'array', items: { type: 'string' }, description: 'Namespaces to pull from (default: all allowed)' },
            format: { type: 'string', enum: ['core', 'coremin', 'prose'], description: 'Output format (default: core)' },
            include_metadata: { type: 'boolean', description: 'Include freshness/version metadata' },
          },
          required: ['surface_id'],
        },
      },
      {
        name: 'context_push',
        description: 'Push a context update from a surface. Direction policy is enforced.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            surface_id: { type: 'string', description: 'The surface pushing context' },
            content: { type: 'string', description: 'Context content in .core format' },
            namespace: { type: 'string', description: 'Target namespace' },
            package_id: { type: 'string', description: 'Existing package ID to update (omit to create new)' },
            tags: { type: 'array', items: { type: 'string' } },
            ttl_hours: { type: 'number', description: 'Auto-expire after this many hours' },
          },
          required: ['surface_id', 'content', 'namespace'],
        },
      },
      {
        name: 'context_distill',
        description: 'Distill raw session notes into .core format using Claude API and push to store.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            surface_id: { type: 'string' },
            source_content: { type: 'string', description: 'Raw session notes or conversation snippets' },
            target_namespace: { type: 'string' },
            target_package_id: { type: 'string', description: 'Package ID to update (omit to create new)' },
            lookback_label: { type: 'string', description: 'Human label for this distillation (e.g. 2026-05-10)' },
            tags: { type: 'array', items: { type: 'string' } },
          },
          required: ['surface_id', 'source_content', 'target_namespace'],
        },
      },
      {
        name: 'context_sync',
        description: 'Trigger a full sync cycle: expire stale packages, validate structure, write sync report.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            dry_run: { type: 'boolean', description: 'Report only, no mutations (default: false)' },
            namespaces: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      {
        name: 'context_list',
        description: 'List all context packages, optionally filtered by namespace or surface.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            namespace: { type: 'string' },
            surface_id: { type: 'string', description: 'Filter to packages visible to this surface' },
          },
        },
      },
      {
        name: 'context_explain_policy',
        description: 'Explain the direction policy between a namespace and a surface.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            namespace: { type: 'string', description: 'Source namespace' },
            surface_id: { type: 'string', description: 'Target surface' },
          },
          required: ['namespace', 'surface_id'],
        },
      },
      {
        name: 'context_set_policy',
        description: 'Override the direction policy for a namespace/surface pair. Hard blocks (work→personal surfaces) cannot be overridden.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            namespace: { type: 'string', description: 'Source namespace' },
            surface_id: { type: 'string', description: 'Target surface' },
            policy: {
              type: 'string',
              enum: ['bidirectional', 'inbound_only', 'outbound_only', 'isolated'],
              description: 'New policy to apply',
            },
            reason: { type: 'string', description: 'Why this override is needed' },
          },
          required: ['namespace', 'surface_id', 'policy'],
        },
      },
      {
        name: 'context_delete_policy',
        description: 'Remove a policy override, reverting to the default direction matrix.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            namespace: { type: 'string' },
            surface_id: { type: 'string' },
          },
          required: ['namespace', 'surface_id'],
        },
      },
    ],
  }));

  // ─────────────────────────────────────────────────────────
  // Tool Handlers
  // ─────────────────────────────────────────────────────────

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'context_pull': {
          const result = await contextPull(args as any, storage, direction);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        case 'context_push': {
          const result = await contextPush(args as any, storage, direction);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        case 'context_distill': {
          if (!config.anthropic_api_key) {
            throw new Error('ANTHROPIC_API_KEY is required for context_distill');
          }
          const result = await contextDistill(args as any, storage, direction, config.anthropic_api_key);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        case 'context_sync': {
          const result = await contextSync((args as any) ?? {}, storage);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        case 'context_list': {
          const { namespace, surface_id } = (args as any) ?? {};
          let packages = await storage.listPackages(namespace);
          if (surface_id) {
            packages = packages.filter((pkg) => {
              if (pkg.surface_blacklist?.includes(surface_id)) return false;
              if (pkg.surface_whitelist && !pkg.surface_whitelist.includes(surface_id)) return false;
              return direction.canRead(pkg.namespace, surface_id);
            });
          }
          return { content: [{ type: 'text', text: JSON.stringify(packages, null, 2) }] };
        }

        case 'context_explain_policy': {
          const { namespace, surface_id } = args as any;
          const explanation = direction.explain(namespace, surface_id);
          const policy = direction.getEffectivePolicy(namespace, surface_id);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ namespace, surface_id, policy, explanation }, null, 2),
            }],
          };
        }

        case 'context_set_policy': {
          const result = await contextSetPolicy(args as any, direction, storage);
          if (result.error) {
            return { content: [{ type: 'text', text: result.error }], isError: true };
          }
          return { content: [{ type: 'text', text: JSON.stringify(result.override, null, 2) }] };
        }

        case 'context_delete_policy': {
          const result = await contextDeletePolicy(args as any, direction, storage);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${(error as Error).message}` }],
        isError: true,
      };
    }
  });

  // ─────────────────────────────────────────────────────────
  // Start
  // ─────────────────────────────────────────────────────────

  const transport = new StdioServerTransport();
  server.connect(transport).then(() => {
    console.error('context-mesh MCP server running');
  }).catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
