/**
 * One place that turns environment-shaped settings into a provider, so the API server
 * and the smoke script cannot disagree about what `QWA_ASSISTANT_*` means.
 *
 *   QWA_ASSISTANT_API_KEY   the key; absent means "no assistant"
 *   QWA_ASSISTANT_PROVIDER  `anthropic` | `openrouter`; default inferred from the key
 *                           (`sk-or-` is OpenRouter, anything else Anthropic)
 *   QWA_ASSISTANT_MODEL     model id in the provider's own naming; provider default if unset
 */
import { AnthropicProvider, type AssistantProvider } from './provider.ts';
import { createOpenRouterProvider } from './openai-compatible.ts';

export type AssistantProviderKind = 'anthropic' | 'openrouter';

export interface AssistantEnv {
  QWA_ASSISTANT_API_KEY?: string | undefined;
  QWA_ASSISTANT_PROVIDER?: string | undefined;
  QWA_ASSISTANT_MODEL?: string | undefined;
}

export function inferProviderKind(apiKey: string, explicit?: string): AssistantProviderKind {
  if (explicit) {
    const kind = explicit.trim().toLowerCase();
    if (kind === 'anthropic' || kind === 'openrouter') return kind;
    throw new Error(`QWA_ASSISTANT_PROVIDER must be "anthropic" or "openrouter", not "${explicit}"`);
  }
  return apiKey.startsWith('sk-or-') ? 'openrouter' : 'anthropic';
}

/** Null when no key is configured — a normal, supported state. */
export function createAssistantProviderFromEnv(
  env: AssistantEnv,
  options: { appUrl?: string; appTitle?: string } = {},
): AssistantProvider | null {
  const apiKey = env.QWA_ASSISTANT_API_KEY;
  if (!apiKey) return null;
  const model = env.QWA_ASSISTANT_MODEL;
  switch (inferProviderKind(apiKey, env.QWA_ASSISTANT_PROVIDER)) {
    case 'openrouter':
      return createOpenRouterProvider({
        apiKey,
        ...(model ? { model } : {}),
        ...(options.appUrl ? { appUrl: options.appUrl } : {}),
        ...(options.appTitle ? { appTitle: options.appTitle } : {}),
      });
    case 'anthropic':
      return new AnthropicProvider({ apiKey, ...(model ? { model } : {}) });
  }
}
