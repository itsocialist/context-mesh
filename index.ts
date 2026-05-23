// context-mesh/src/types/index.ts
// ─────────────────────────────────────────────────────────

export type Namespace =
  | 'personal'
  | 'work'
  | 'shared'
  | `project:${string}`;

export type DirectionPolicy =
  | 'bidirectional'
  | 'inbound_only'
  | 'outbound_only'
  | 'isolated';

export type ContentFormat = 'core' | 'coremin' | 'prose';

export type SurfaceId =
  | 'personal-claude'
  | 'work-claude'
  | 'pm-hub'
  | 'edge-bird'
  | 'day-one'
  | string; // allow arbitrary surface IDs

// ─────────────────────────────────────────────────────────
// Context Package
// ─────────────────────────────────────────────────────────

export interface ContextPackage {
  id: string;
  namespace: Namespace;
  direction_policy: DirectionPolicy;
  surface_whitelist?: SurfaceId[];
  surface_blacklist?: SurfaceId[];
  content: string;
  content_format: ContentFormat;
  version: number;
  freshness_timestamp: string;   // ISO 8601
  created_at: string;            // ISO 8601
  updated_at: string;            // ISO 8601
  tags: string[];
  checksum: string;              // SHA-256 of content
  ttl_hours?: number;            // optional: auto-expire
  auto_distill?: boolean;        // include in nightly distillation
}

// ─────────────────────────────────────────────────────────
// Surface Config
// ─────────────────────────────────────────────────────────

export interface SurfaceConfig {
  id: SurfaceId;
  display_name: string;
  owner_namespace: Namespace;
  allowed_namespaces: Namespace[];
  inject_on_init: boolean;
  push_on_session_end: boolean;
  default_content_format: ContentFormat;
}

// ─────────────────────────────────────────────────────────
// Direction Policy Override
// ─────────────────────────────────────────────────────────

export interface PolicyOverride {
  namespace: Namespace;
  surface_id: SurfaceId;
  policy: DirectionPolicy;
  reason?: string;
  set_at: string; // ISO 8601
}

// ─────────────────────────────────────────────────────────
// Tool Inputs / Outputs
// ─────────────────────────────────────────────────────────

export interface PullInput {
  surface_id: SurfaceId;
  namespaces?: Namespace[];      // if omitted, all allowed for surface
  format?: ContentFormat;        // default: 'core'
  include_metadata?: boolean;    // include freshness/version info
}

export interface PullOutput {
  surface_id: SurfaceId;
  packages: ContextPackage[];
  merged_content: string;        // ready for system prompt injection
  total_tokens_estimate: number;
  freshness_summary: FreshnessSummary[];
}

export interface PushInput {
  surface_id: SurfaceId;
  content: string;
  namespace: Namespace;
  package_id?: string;           // if updating existing; else creates new
  tags?: string[];
  ttl_hours?: number;
}

export interface PushOutput {
  package_id: string;
  namespace: Namespace;
  version: number;
  timestamp: string;
  policy_applied: DirectionPolicy;
  blocked: boolean;              // true if direction policy blocked the push
  blocked_reason?: string;
}

export interface DistillInput {
  surface_id: SurfaceId;
  source_content: string;        // raw session notes / conversation snippets
  target_namespace: Namespace;
  target_package_id?: string;    // if updating existing package
  lookback_label?: string;       // human label e.g. "2025-03-23 session"
  tags?: string[];
}

export interface DistillOutput {
  package_id: string;
  core_content: string;          // the distilled .core format content
  tokens_original: number;
  tokens_compressed: number;
  compression_ratio: number;
  pushed: boolean;
}

export interface SyncInput {
  dry_run?: boolean;
  namespaces?: Namespace[];      // if omitted, sync all
}

export interface SyncOutput {
  timestamp: string;
  dry_run: boolean;
  packages_scanned: number;
  packages_updated: number;
  packages_created: number;
  packages_expired: number;
  errors: SyncError[];
  duration_ms: number;
}

// ─────────────────────────────────────────────────────────
// Supporting Types
// ─────────────────────────────────────────────────────────

export interface FreshnessSummary {
  package_id: string;
  namespace: Namespace;
  age_hours: number;
  is_stale: boolean;             // true if age > ttl_hours
}

export interface SyncError {
  package_id: string;
  namespace: Namespace;
  error: string;
  timestamp: string;
}

// ─────────────────────────────────────────────────────────
// Ship APE Adapter Types
// ─────────────────────────────────────────────────────────

export interface ShipApeAdapter {
  store(key: string, value: string): Promise<void>;
  get(key: string): Promise<string | null>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

// ─────────────────────────────────────────────────────────
// Context Mesh Config
// ─────────────────────────────────────────────────────────

export interface ContextMeshConfig {
  ship_ape_mcp_url: string;
  anthropic_api_key?: string;    // for distillation calls
  surfaces: SurfaceConfig[];
  policy_overrides?: PolicyOverride[];
  default_format: ContentFormat;
  stale_threshold_hours: number; // default: 24
}
