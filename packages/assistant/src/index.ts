export {
  assistantProposalSchema,
  bindingSpecSchema,
  keyRefSchema,
  keycodeRefSchema,
  layerRefSchema,
  macroStepSpecSchema,
  operationSchema,
  parseProposal,
  unsupportedRequestSchema,
  MAX_OPERATIONS,
} from './proposal.ts';
export type {
  AssistantProposal,
  BindingSpec,
  KeyRef,
  LayerRef,
  MacroStepSpec,
  Operation,
  UnsupportedRequest,
} from './proposal.ts';
export { resolveProposal } from './resolve.ts';
export type { ChangeSummary, ResolveOptions, ResolutionIssue, ResolvedProposal } from './resolve.ts';
export { buildAssistantContext, renderAssistantContext, legendOf } from './context.ts';
export type { AssistantContext, BuildContextOptions, ContextKey } from './context.ts';
export { resolveKey, resolveKeycode, resolveLayer, describePosition, rowsOf } from './refs.ts';
export type { RefFailure } from './refs.ts';
export {
  AnthropicProvider,
  DEFAULT_ANTHROPIC_MODEL,
  PROPOSE_TOOL_DESCRIPTION,
  PROPOSE_TOOL_NAME,
  ProviderError,
  proposeToolInputSchema,
} from './provider.ts';
export type {
  AnthropicProviderOptions,
  AssistantProvider,
  ProposeRequest,
  ProposeResponse,
  ProviderUsage,
} from './provider.ts';
export { runAssistant, formatFeedback, SYSTEM_RULES } from './service.ts';
export type { AssistantRunResult, RunAssistantOptions } from './service.ts';
export {
  OpenAICompatibleProvider,
  createOpenRouterProvider,
  DEFAULT_OPENROUTER_MODEL,
  OPENROUTER_BASE_URL,
} from './openai-compatible.ts';
export type { OpenAICompatibleProviderOptions, OpenRouterProviderOptions } from './openai-compatible.ts';
export { createAssistantProviderFromEnv, inferProviderKind } from './factory.ts';
export type { AssistantEnv, AssistantProviderKind } from './factory.ts';
export { buildDocSearch, formatDocChunk } from './docs-retrieval.ts';
export type { DocSearch } from './docs-retrieval.ts';
