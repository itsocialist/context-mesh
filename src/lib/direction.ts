// context-mesh/src/lib/direction.ts
// Direction Policy Engine
// ─────────────────────────────────────────────────────────

import {
  Namespace,
  DirectionPolicy,
  SurfaceId,
  PolicyOverride,
  SurfaceConfig,
} from '../types/index.js';

// ─────────────────────────────────────────────────────────
// Default Direction Matrix
//
// Key: `${from_namespace}::${to_surface_owner_namespace}`
// Value: default DirectionPolicy
//
// CRITICAL RULE: work → personal is always BLOCKED.
// This cannot be overridden by PolicyOverride.
// ─────────────────────────────────────────────────────────

const DEFAULT_MATRIX: Record<string, DirectionPolicy> = {
  'personal::personal':    'bidirectional',
  'personal::work':        'inbound_only',   // personal context can flow INTO work as inbound (work reads personal's shared)
  'personal::custom':      'bidirectional',
  'work::personal':        'isolated',       // HARD BLOCK — enforced additionally in canFlow()
  'work::work':            'bidirectional',
  'work::custom':          'outbound_only',  // work context pushes to tools but tools don't write back to work
  'shared::personal':      'bidirectional',
  'shared::work':          'bidirectional',
  'shared::custom':        'bidirectional',
};

// Surface IDs that belong to the "custom" surface owner group
const CUSTOM_SURFACES = new Set<string>([
  'pm-hub',
  'edge-bird',
  'day-one',
  // Add more as registered
]);

// ─────────────────────────────────────────────────────────
// Hard-blocked flows — CANNOT be overridden
// ─────────────────────────────────────────────────────────

const HARD_BLOCKED_FLOWS: Array<{ from: Namespace; to_surface_namespace: string }> = [
  { from: 'work', to_surface_namespace: 'personal' },
];

// ─────────────────────────────────────────────────────────
// Direction Engine
// ─────────────────────────────────────────────────────────

export class DirectionEngine {
  private overrides: PolicyOverride[];
  private surfaces: Map<SurfaceId, SurfaceConfig>;

  constructor(overrides: PolicyOverride[] = [], surfaces: SurfaceConfig[] = []) {
    this.overrides = [...overrides];
    this.surfaces = new Map(surfaces.map((s) => [s.id, s]));
  }

  applyOverride(override: PolicyOverride): void {
    const idx = this.overrides.findIndex(
      (o) => o.namespace === override.namespace && o.surface_id === override.surface_id
    );
    if (idx >= 0) {
      this.overrides[idx] = override;
    } else {
      this.overrides.push(override);
    }
  }

  removeOverride(namespace: Namespace, surface_id: SurfaceId): void {
    this.overrides = this.overrides.filter(
      (o) => !(o.namespace === namespace && o.surface_id === surface_id)
    );
  }

  listOverrides(): PolicyOverride[] {
    return [...this.overrides];
  }

  /**
   * Determine if a context package from `namespace` can flow TO `surface_id`.
   * Returns the effective policy, or 'isolated' if blocked.
   */
  getEffectivePolicy(namespace: Namespace, surface_id: SurfaceId): DirectionPolicy {
    const surfaceOwner = this.getSurfaceOwnerGroup(surface_id);

    // Check hard blocks first — these CANNOT be overridden
    for (const block of HARD_BLOCKED_FLOWS) {
      if (namespace === block.from && surfaceOwner === block.to_surface_namespace) {
        return 'isolated';
      }
      // Project namespaces inherit from parent
      if (
        namespace.startsWith('project:') &&
        block.from === this.getProjectParentNamespace(namespace) &&
        surfaceOwner === block.to_surface_namespace
      ) {
        return 'isolated';
      }
    }

    // Check policy overrides
    const override = this.overrides.find(
      (o) => o.namespace === namespace && o.surface_id === surface_id
    );
    if (override) {
      return override.policy;
    }

    // Fall back to default matrix
    const matrixKey = `${this.resolveNamespaceGroup(namespace)}::${surfaceOwner}`;
    return DEFAULT_MATRIX[matrixKey] ?? 'isolated';
  }

  /**
   * Can a package from `namespace` be READ by `surface_id`?
   */
  canRead(namespace: Namespace, surface_id: SurfaceId): boolean {
    const policy = this.getEffectivePolicy(namespace, surface_id);
    return policy === 'bidirectional' || policy === 'outbound_only';
    // "outbound_only" means: namespace pushes outbound to surfaces → surfaces can read
  }

  /**
   * Can a surface `surface_id` WRITE context back to `namespace`?
   */
  canWrite(surface_id: SurfaceId, namespace: Namespace): boolean {
    const policy = this.getEffectivePolicy(namespace, surface_id);
    return policy === 'bidirectional' || policy === 'inbound_only';
    // "inbound_only" means: namespace accepts inbound writes from this surface
  }

  /**
   * Filter a list of namespaces to only those readable by surface_id.
   */
  filterReadableNamespaces(namespaces: Namespace[], surface_id: SurfaceId): Namespace[] {
    return namespaces.filter((ns) => this.canRead(ns, surface_id));
  }

  /**
   * Get a human-readable explanation of why a flow is blocked or allowed.
   */
  explain(namespace: Namespace, surface_id: SurfaceId): string {
    const surfaceOwner = this.getSurfaceOwnerGroup(surface_id);
    const policy = this.getEffectivePolicy(namespace, surface_id);

    // Check if it's a hard block
    for (const block of HARD_BLOCKED_FLOWS) {
      if (namespace === block.from && surfaceOwner === block.to_surface_namespace) {
        return `HARD BLOCK: ${namespace} → ${surface_id} is permanently isolated. Work context cannot flow to personal surfaces.`;
      }
    }

    const override = this.overrides.find(
      (o) => o.namespace === namespace && o.surface_id === surface_id
    );
    if (override) {
      return `POLICY OVERRIDE: ${policy} (reason: ${override.reason ?? 'not specified'}, set at ${override.set_at})`;
    }

    return `DEFAULT MATRIX: ${namespace} → ${surface_id} (${surfaceOwner} group) = ${policy}`;
  }

  // ─────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────

  private getSurfaceOwnerGroup(surface_id: SurfaceId): string {
    // Hard-coded personal surfaces — always blocked from receiving work namespace
    if (surface_id === 'personal-claude' || surface_id === 'edge-bird' || surface_id === 'day-one') {
      return 'personal';
    }
    if (surface_id === 'work-claude') return 'work';

    // Registered surface config takes precedence over CUSTOM_SURFACES fallback
    const surface = this.surfaces.get(surface_id);
    if (surface) {
      const ownerNs = surface.owner_namespace;
      if (ownerNs === 'personal') return 'personal';
      if (ownerNs === 'work') return 'work';
      return 'custom';
    }

    if (CUSTOM_SURFACES.has(surface_id)) return 'custom';
    return 'custom'; // default unknown surfaces to custom group
  }

  private resolveNamespaceGroup(namespace: Namespace): string {
    if (namespace === 'shared') return 'shared';
    if (namespace === 'personal') return 'personal';
    if (namespace === 'work') return 'work';
    if (namespace.startsWith('project:')) {
      return this.getProjectParentNamespace(namespace);
    }
    return 'shared'; // fallback
  }

  private getProjectParentNamespace(namespace: string): string {
    // project:pm-hub → work (work-associated project)
    // project:edge-bird → personal (personal project)
    // Heuristic: check if project namespace has a registered surface owner
    // For now, default to 'work' unless explicitly personal
    const personalProjects = new Set(['edge-bird', 'dawson-bros', 'day-one-personal', 'context-mesh']);
    const slug = namespace.replace('project:', '');
    return personalProjects.has(slug) ? 'personal' : 'work';
  }
}
