// context-mesh/src/lib/core-encoder.ts
// .core Format Utilities
// Handles encoding/decoding context packages to/from .core format.
// ─────────────────────────────────────────────────────────

import { createHash } from 'crypto';
import { ContentFormat, ContextPackage } from '../types/index.js';

// ─────────────────────────────────────────────────────────
// .core Header Template
// ─────────────────────────────────────────────────────────

export function buildCoreHeader(pkg: Partial<ContextPackage>, domain: string): string {
  const now = new Date().toISOString().split('T')[0];
  return [
    `# ${pkg.id?.toUpperCase()}.core v${pkg.version ?? 1}`,
    `# ${'═'.repeat(67)}`,
    `# encoding: core/1.0`,
    `# created: ${pkg.created_at?.split('T')[0] ?? now}`,
    `# author: Brian Dawson <stylz>`,
    `# namespace: ${pkg.namespace}`,
    `# surface_tags: ${pkg.tags?.join(', ') ?? 'none'}`,
    `# direction_policy: ${pkg.direction_policy}`,
    `# domain: ${domain}`,
    `# decoder: /mnt/skills/user/core-format/SKILL.md`,
    `# ${'═'.repeat(67)}`,
    '',
  ].join('\n');
}

// ─────────────────────────────────────────────────────────
// .core Footer
// ─────────────────────────────────────────────────────────

export function buildCoreFooter(): string {
  return [
    '',
    `# ${'═'.repeat(67)}`,
    `# EOF`,
    `# ${'═'.repeat(67)}`,
  ].join('\n');
}

// ─────────────────────────────────────────────────────────
// Checksum
// ─────────────────────────────────────────────────────────

export function computeChecksum(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function hasContentChanged(existing: ContextPackage, newContent: string): boolean {
  return existing.checksum !== computeChecksum(newContent);
}

// ─────────────────────────────────────────────────────────
// Token Estimator
// Rough estimate: 1 token ≈ 4 chars for .core format
// ─────────────────────────────────────────────────────────

export function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4);
}

// ─────────────────────────────────────────────────────────
// .coremin ROT-13
// Applied to ASCII a-z A-Z only. Greek/math pass through.
// ─────────────────────────────────────────────────────────

export function rot13(str: string): string {
  return str.replace(/[a-zA-Z]/g, (char) => {
    const base = char <= 'Z' ? 65 : 97;
    return String.fromCharCode(((char.charCodeAt(0) - base + 13) % 26) + base);
  });
}

// ─────────────────────────────────────────────────────────
// Token Substitution Table
// From coremin-compiler SKILL.md
// ─────────────────────────────────────────────────────────

const TOKEN_SUB: Record<string, string> = {
  'true': '⊤',
  'false': '⊥',
  'null': '∅',
  'always': '∀t',
  'never': '¬∃',
  'required': 'req',
  'optional': 'opt',
  'default': 'def',
  'maximum': 'max',
  'minimum': 'min',
  'threshold': 'θ',
  'baseline': 'β',
  'output': 'out',
  'input': 'in',
  'target': 'tgt',
  'performance': 'perf',
  'production': 'prod',
  'deployment': 'dep',
  'configuration': 'cfg',
  'environment': 'env',
  'version': 'ver',
};

const TOKEN_SUB_REVERSE: Record<string, string> = Object.fromEntries(
  Object.entries(TOKEN_SUB).map(([k, v]) => [v, k])
);

export function applyTokenSubstitution(content: string): string {
  let result = content;
  for (const [from, to] of Object.entries(TOKEN_SUB)) {
    result = result.replace(new RegExp(`\\b${from}\\b`, 'g'), to);
  }
  return result;
}

export function reverseTokenSubstitution(content: string): string {
  let result = content;
  for (const [from, to] of Object.entries(TOKEN_SUB_REVERSE)) {
    result = result.replace(new RegExp(escapeRegex(from), 'g'), to);
  }
  return result;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─────────────────────────────────────────────────────────
// Section Compression (core → coremin)
// ─────────────────────────────────────────────────────────

const SECTION_MAP: Record<string, string> = {
  '## Ω (omega: purpose)': 'Ω:',
  '## Σ (sigma: state)': 'Σ:',
  '## χ (chi: verification)': 'χ:',
  '## Φ (phi: patterns)': 'Φ:',
  '## Λ (lambda: architecture)': 'Λ:',
  '## Γ (gamma: constraints)': 'Γ:',
  '## ε (epsilon: enums)': 'ε:',
  '## ν (nu: naming)': 'ν:',
  '## τ (tau: templates)': 'τ:',
  '## Π (pi: profiles)': 'Π:',
  '## Δ (delta: delivery)': 'Δ:',
  '## Ψ (psi: IP)': 'Ψ:',
  '## Ρ (rho: roadmap)': 'Ρ:',
  '## κ (kappa: urls)': 'κ:',
  '## μ (mu: user_context)': 'μ:',
};

const SECTION_MAP_REVERSE: Record<string, string> = Object.fromEntries(
  Object.entries(SECTION_MAP).map(([k, v]) => [v, k])
);

// ─────────────────────────────────────────────────────────
// Compile .core → .coremin
// ─────────────────────────────────────────────────────────

export function compileToMin(coreContent: string, domain: string, version: string, srcFilename: string): string {
  let lines = coreContent.split('\n');

  // Stage 1: Strip header block
  lines = lines.filter((line) => {
    if (line.match(/^# [═]+/)) return false;
    if (line.match(/^# encoding:/)) return false;
    if (line.match(/^# created:/)) return false;
    if (line.match(/^# author:/)) return false;
    if (line.match(/^# collaborator:/)) return false;
    if (line.match(/^# license:/)) return false;
    if (line.match(/^# decoder:/)) return false;
    if (line.match(/^# domain:/)) return false;
    if (line.match(/^# namespace:/)) return false;
    if (line.match(/^# surface_tags:/)) return false;
    if (line.match(/^# direction_policy:/)) return false;
    if (line.match(/^# EOF/)) return false;
    if (line.match(/^# [A-Z].*\.core v/)) return false; // title line
    return true;
  });

  // Stage 2: Section compression
  lines = lines.map((line) => {
    const match = Object.entries(SECTION_MAP).find(([key]) => line.trim() === key);
    return match ? match[1] : line;
  });

  // Stage 3: State block compression
  lines = lines.map((line) =>
    line
      .replace(/EXISTS :=/g, 'Σ+:')
      .replace(/NEEDED :=/g, 'Σ-:')
      .replace(/INVARIANT:/g, '∥')
  );

  let content = lines.join('\n');

  // Stage 4: Token substitution
  content = applyTokenSubstitution(content);

  // Stage 5: Whitespace collapse
  content = content.replace(/\n{3,}/g, '\n\n').trimEnd();

  // Stage 6+7: Header injection + ROT-13 content lines
  const contentLines = content.split('\n').map((line) => {
    // Don't rot13: section symbols, operators, empty lines
    if (line.match(/^[Ω Σ χ Φ Λ Γ ε ν τ Π Δ Ψ Ρ κ μ]:/)) return line; // section headers
    if (line.trim() === '') return line;
    return rot13(line);
  });

  const header = `#cm1|ver:${version}|dom:${domain}|src:${srcFilename}`;
  return [header, ...contentLines].join('\n');
}

// ─────────────────────────────────────────────────────────
// Decompile .coremin → .core
// ─────────────────────────────────────────────────────────

export function decompileFromMin(coreminContent: string): { content: string; meta: { version: string; domain: string; src: string } } {
  const lines = coreminContent.split('\n');
  const headerLine = lines[0];

  if (!headerLine.startsWith('#cm1|')) {
    throw new Error('Invalid .coremin: missing #cm1| header');
  }

  // Parse header
  const meta: Record<string, string> = {};
  headerLine.replace('#cm1|', '').split('|').forEach((part) => {
    const [k, v] = part.split(':');
    if (k && v) meta[k] = v;
  });

  // ROT-13 inverse (ROT-13 is its own inverse)
  const contentLines = lines.slice(1).map((line) => {
    if (line.match(/^[Ω Σ χ Φ Λ Γ ε ν τ Π Δ Ψ Ρ κ μ]:/)) return line;
    if (line.trim() === '') return line;
    return rot13(line); // same function — ROT-13 reverses itself
  });

  let content = contentLines.join('\n');

  // Reverse token substitution
  content = reverseTokenSubstitution(content);

  // Reverse state block compression
  content = content
    .replace(/Σ\+:/g, 'EXISTS :=')
    .replace(/Σ-:/g, 'NEEDED :=')
    .replace(/∥/g, 'INVARIANT:');

  // Expand section symbols
  const expandedLines = content.split('\n').map((line) => {
    const trimmed = line.trim();
    const match = Object.entries(SECTION_MAP_REVERSE).find(([key]) => trimmed === key);
    return match ? match[1] : line;
  });

  return {
    content: expandedLines.join('\n'),
    meta: {
      version: meta['ver'] ?? '?',
      domain: meta['dom'] ?? '?',
      src: meta['src'] ?? '?',
    },
  };
}

// ─────────────────────────────────────────────────────────
// Prose Renderer
// Converts a .core package to plain prose for surfaces that
// don't need token efficiency.
// ─────────────────────────────────────────────────────────

export function renderToProse(coreContent: string, packageId: string): string {
  // Strip header/footer
  const lines = coreContent.split('\n').filter((line) => !line.startsWith('#'));

  return `### Context Package: ${packageId}\n\n${lines.join('\n').trim()}`;
}

// ─────────────────────────────────────────────────────────
// Merge multiple packages for system prompt injection
// ─────────────────────────────────────────────────────────

export function mergePackagesForInjection(
  packages: ContextPackage[],
  format: ContentFormat
): string {
  const separator = '\n\n---\n\n';

  const rendered = packages.map((pkg) => {
    if (format === 'coremin') {
      // Already stored as coremin or compile on the fly
      if (pkg.content_format === 'coremin') return pkg.content;
      return compileToMin(pkg.content, pkg.namespace, String(pkg.version), pkg.id);
    }
    if (format === 'prose') {
      return renderToProse(pkg.content, pkg.id);
    }
    // Default: return .core as-is
    return pkg.content;
  });

  return rendered.join(separator);
}
