// context-mesh/src/tools/distill.ts
// Context Distillation Tool
// Uses Claude API to summarize raw session notes → .core format
// ─────────────────────────────────────────────────────────

import { DistillInput, DistillOutput, ContextPackage } from '../types/index.js';
import { ShipApeStorageAdapter } from '../lib/ship-ape.js';
import { DirectionEngine } from '../lib/direction.js';
import { buildCoreHeader, buildCoreFooter, computeChecksum, estimateTokens } from '../lib/core-encoder.js';
import { contextPush } from './push.js';
import { randomUUID } from 'crypto';

// ─────────────────────────────────────────────────────────
// Distillation System Prompt
// Instructs Claude to output valid .core format
// ─────────────────────────────────────────────────────────

function buildDistillationSystemPrompt(namespace: string): string {
  return `You are a context encoder. Your job is to distill raw session notes and conversation snippets into a compressed .core knowledge file.

## .core Format Rules
- Use section symbols: Ω (purpose), Σ (state with EXISTS/NEEDED), μ (user context), Ρ (roadmap), Φ (patterns), χ (verification questions)
- Use notation: → (transforms), ¬ (not), ∈ (in set), {a,b,c} (sets), A→B (flow)
- State deltas: EXISTS := {what exists}, NEEDED := {what's needed}
- Keep to the most signal-dense facts. Remove all narrative.
- Namespace: ${namespace}

## Output Format
Return ONLY the .core content (no markdown code fences, no preamble). Start with the ## Ω section.

## What to Extract
- Active projects and their current status
- Key decisions made
- Commitments and deadlines
- Blockers and risks
- Relationships and context about people mentioned
- Technical decisions and architecture choices

## What to Omit
- Conversational filler
- Repeated information
- Anything marked as confidential that should not cross namespace boundaries
`;
}

// ─────────────────────────────────────────────────────────
// Distill
// ─────────────────────────────────────────────────────────

export async function contextDistill(
  input: DistillInput,
  storage: ShipApeStorageAdapter,
  direction: DirectionEngine,
  anthropicApiKey: string
): Promise<DistillOutput> {
  const { surface_id, source_content, target_namespace, tags = [] } = input;
  const target_package_id = input.target_package_id ?? `distilled-${randomUUID().slice(0, 8)}`;
  const lookbackLabel = input.lookback_label ?? new Date().toISOString().split('T')[0];

  const tokensOriginal = estimateTokens(source_content);

  // 1. Call Claude API to distill
  const coreContent = await callClaudeForDistillation(
    source_content,
    target_namespace,
    anthropicApiKey
  );

  // 2. Build package header/footer
  const now = new Date().toISOString();
  const tempPkg: Partial<ContextPackage> = {
    id: target_package_id,
    namespace: target_namespace,
    direction_policy: direction.getEffectivePolicy(target_namespace, surface_id),
    tags: [...tags, `distilled:${lookbackLabel}`],
    version: 1,
    created_at: now,
  };

  const fullCoreContent = [
    buildCoreHeader(tempPkg, target_namespace),
    coreContent.trim(),
    buildCoreFooter(),
  ].join('\n');

  const tokensCompressed = estimateTokens(fullCoreContent);

  // 3. Push to storage
  const pushResult = await contextPush(
    {
      surface_id,
      content: fullCoreContent,
      namespace: target_namespace,
      package_id: target_package_id,
      tags: [...tags, `distilled:${lookbackLabel}`, 'auto-distilled'],
    },
    storage,
    direction
  );

  return {
    package_id: target_package_id,
    core_content: fullCoreContent,
    tokens_original: tokensOriginal,
    tokens_compressed: tokensCompressed,
    compression_ratio: Math.round((1 - tokensCompressed / tokensOriginal) * 100) / 100,
    pushed: !pushResult.blocked,
  };
}

// ─────────────────────────────────────────────────────────
// Claude API Call
// ─────────────────────────────────────────────────────────

async function callClaudeForDistillation(
  sourceContent: string,
  namespace: string,
  apiKey: string
): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system: buildDistillationSystemPrompt(namespace),
      messages: [
        {
          role: 'user',
          content: `Distill the following session notes into .core format:\n\n${sourceContent}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API distillation failed: ${response.status} ${err}`);
  }

  const data = await response.json() as any;
  const text = data.content?.find((b: any) => b.type === 'text')?.text ?? '';

  if (!text) {
    throw new Error('Claude API returned no text content for distillation');
  }

  // Strip any accidental code fences
  return text.replace(/```[a-z]*/g, '').replace(/```/g, '').trim();
}
