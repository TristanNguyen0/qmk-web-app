/**
 * One assistant request, end to end: ground → ask → parse → resolve → (correct once).
 *
 * The model never sees the configuration schema, a keycode token destined for
 * generation, or anything about the user beyond the prompt. It sees the rendered
 * context and the operation vocabulary, and its answer is resolved and validated by
 * code. When resolution reports issues, the model gets exactly one more turn with
 * its own proposal and the issues side by side — enough to fix a wrong legend or a
 * missing add_layer, and cheap enough not to matter when it does not help.
 */
import type { Catalog, Configuration } from '@qmk-web-app/domain';
import { buildAssistantContext, renderAssistantContext } from './context.ts';
import { parseProposal } from './proposal.ts';
import type { AssistantProvider, ProviderUsage } from './provider.ts';
import { resolveProposal, type ResolvedProposal } from './resolve.ts';

/** What the model is told before it sees the keyboard. Stable across requests. */
export const SYSTEM_RULES = `You help a user configure QMK keyboard firmware through a visual editor. You act only by calling propose_changes with a list of operations from its schema; you have no other output.

Rules:
1. Bind only keycodes from the "Supported keycodes" list. Anything else the user wants (media keys, RGB, reset, shifted symbols like "!", mouse keys, unicode, custom code) goes in "unsupported" with a plain reason. Never substitute a different key without saying so in "unsupported.alternative".
2. Refer to keys by their position number from the context ({"position": 12}) whenever possible. Use {"key": "..."} only for a legend that appears exactly once on the base layer. Exception: the context shows the keyboard BEFORE your operations, so after apply_default_keymap or apply_layout_preset the legends have moved — for any key you touch after one of those, use {"key": "<legend it now has>"} (e.g. {"key": "Backspace"}), never a position copied from the old context.
3. Layer references may be a name or an index. To use a new layer, add it with add_layer first, then refer to it by name in later operations. A held layer key is a layer_momentary binding on the base layer; the user must have named which key to hold, otherwise do not guess — explain in the summary and list it in "unsupported".
4. "Default", "stock", "standard", "QWERTY", "reset": use apply_default_keymap if the context says it is available. It replaces every layer with QMK's own default for this keyboard, and turns SOCD off; re-add SOCD afterwards if the user wants it.
4b. A named standard arrangement — "HHKB layout", "WKL", "Tsangan", "ISO", "ANSI", "Alice", "ortho" — means apply_layout_preset with the matching preset from the context's "Layout presets" list (e.g. "hhkb" → 60_hhkb; prefer the one that also matches the keyboard's size). If no preset matches, the request is unsupported: never describe the default keymap, or anything you have not applied, as being that arrangement. Then apply any further edits the user asked for on top.
5. SOCD: only when the context says it is available. It needs exactly four base-layer keys bound to one implemented vertical pair and one implemented horizontal pair, applies to the base layer only, and cannot be toggled at runtime or scoped to a layer. Requests for a toggle, a per-layer SOCD, or only two directions are unsupported; when the user names only A/D or only W/S, you may complete the set with the matching pair and say so in the summary.
6. Macros: steps are tap/down/up of supported keycodes and delays. Every "down" needs a matching "up".
7. Preserve what the user did not ask to change. Prefer the smallest set of operations that fulfils the request.
8. Every part of the request you did not fulfil MUST be its own entry in "unsupported" (request, reason, and alternative if you did something instead). Mentioning it in the summary is not a substitute; the UI lists "unsupported" separately.
9. The summary is one to three sentences in plain language for a non-programmer: what you changed and, if anything, what you could not do. Do not mention operations, JSON, or positions by number.`;

export interface RunAssistantOptions {
  provider: AssistantProvider;
  configuration: Configuration;
  catalog: Catalog;
  prompt: string;
  /** Total model calls allowed, including the first. Default 2 (one correction). */
  maxAttempts?: number;
  newId?: () => string;
  signal?: AbortSignal;
}

export type AssistantRunResult =
  | {
      outcome: 'proposal';
      resolved: ResolvedProposal;
      attempts: number;
      usage: ProviderUsage;
      model: string;
    }
  | {
      /** The model never produced a proposal that parses. */
      outcome: 'malformed';
      errors: string[];
      attempts: number;
      usage: ProviderUsage;
      model: string;
    };

/** Human-readable feedback for the correction turn, built from the resolver's report. */
export function formatFeedback(resolved: ResolvedProposal): string {
  const lines: string[] = [];
  if (resolved.issues.length > 0) {
    lines.push(`${resolved.issues.length} operation(s) could not be applied:`);
    for (const issue of resolved.issues) {
      lines.push(`- operations[${issue.operation}] (${issue.op}): ${issue.reason}`);
      if (issue.candidates?.length) lines.push(`  candidates: ${issue.candidates.join('; ')}`);
    }
  }
  if (!resolved.validation.ok) {
    lines.push(`The resulting configuration was rejected (${resolved.validation.code}): ${resolved.validation.message}`);
    for (const fe of resolved.validation.fieldErrors) lines.push(`- ${fe.path}: ${fe.message}`);
  }
  lines.push('Fix these and keep every operation that did apply. If something is impossible, move it to "unsupported".');
  return lines.join('\n');
}

export async function runAssistant(options: RunAssistantOptions): Promise<AssistantRunResult> {
  const { provider, configuration, catalog, prompt } = options;
  const maxAttempts = Math.max(1, options.maxAttempts ?? 2);

  const context = buildAssistantContext({ configuration, catalog });
  const system = `${SYSTEM_RULES}\n\n---\n\n${renderAssistantContext(context)}`;

  const usage: ProviderUsage = { inputTokens: 0, outputTokens: 0 };
  let model = provider.model;
  let previous: { proposal: unknown; feedback: string } | undefined;
  let lastMalformed: string[] = [];
  let best: ResolvedProposal | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await provider.propose({ system, prompt, ...(previous ? { previous } : {}) }, options.signal);
    usage.inputTokens += response.usage.inputTokens;
    usage.outputTokens += response.usage.outputTokens;
    model = response.model;

    const parsed = parseProposal(response.proposal);
    if (!parsed.ok) {
      lastMalformed = parsed.errors;
      previous = {
        proposal: response.proposal,
        feedback: `The proposal did not match the schema:\n${parsed.errors.map((e) => `- ${e}`).join('\n')}`,
      };
      continue;
    }

    const resolved = resolveProposal({
      configuration,
      catalog,
      proposal: parsed.proposal,
      ...(options.newId ? { newId: options.newId } : {}),
    });
    if (resolved.ok || attempt === maxAttempts) {
      return { outcome: 'proposal', resolved, attempts: attempt, usage, model };
    }
    // Keep the better of the partial results in case the correction is worse or malformed.
    if (!best || resolved.issues.length < best.issues.length) best = resolved;
    previous = { proposal: response.proposal, feedback: formatFeedback(resolved) };
  }

  if (best) return { outcome: 'proposal', resolved: best, attempts: maxAttempts, usage, model };
  return { outcome: 'malformed', errors: lastMalformed, attempts: maxAttempts, usage, model };
}
