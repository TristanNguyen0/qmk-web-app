/**
 * `AssistantProvider` over the OpenAI chat-completions wire format, which is what
 * OpenRouter (and OpenAI, and most self-hosted gateways) speak.
 *
 * Same discipline as the Anthropic adapter: one forced tool call, plain `fetch`, the
 * model's tool arguments returned unparsed for `parseProposal` to judge, and nothing
 * sent but the system text and the prompt. OpenRouter lets one key reach many models
 * — `anthropic/claude-haiku-4.5` by default here, since the prompt was tuned on it,
 * but any model with reliable function calling will do.
 */
import {
  PROPOSE_TOOL_DESCRIPTION,
  PROPOSE_TOOL_NAME,
  ProviderError,
  proposeToolInputSchema,
  type AssistantProvider,
  type ProposeRequest,
  type ProposeResponse,
} from './provider.ts';

export interface OpenAICompatibleProviderOptions {
  apiKey: string;
  model: string;
  /** e.g. `https://openrouter.ai/api/v1` or `https://api.openai.com/v1`. */
  baseUrl: string;
  maxOutputTokens?: number;
  /** Extra headers, e.g. OpenRouter's optional `HTTP-Referer` / `X-Title` attribution. */
  headers?: Record<string, string>;
  fetch?: typeof fetch;
}

interface ChatCompletionResponse {
  model?: string;
  choices?: {
    finish_reason?: string;
    message?: {
      content?: string | null;
      tool_calls?: { id?: string; type?: string; function?: { name?: string; arguments?: unknown } }[];
    };
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; code?: unknown; type?: string };
}

export class OpenAICompatibleProvider implements AssistantProvider {
  readonly model: string;
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #maxOutputTokens: number;
  readonly #headers: Record<string, string>;
  readonly #fetch: typeof fetch;
  readonly #toolSchema = proposeToolInputSchema();

  constructor(options: OpenAICompatibleProviderOptions) {
    if (!options.apiKey) throw new Error('OpenAICompatibleProvider requires an API key');
    if (!options.model) throw new Error('OpenAICompatibleProvider requires a model id');
    this.#apiKey = options.apiKey;
    this.model = options.model;
    this.#baseUrl = options.baseUrl.replace(/\/$/, '');
    this.#maxOutputTokens = options.maxOutputTokens ?? 8192;
    this.#headers = options.headers ?? {};
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async propose(request: ProposeRequest, signal?: AbortSignal): Promise<ProposeResponse> {
    const messages: unknown[] = [
      { role: 'system', content: request.system },
      { role: 'user', content: request.prompt },
    ];
    if (request.previous) {
      const callId = 'call_previous';
      messages.push({
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: callId,
            type: 'function',
            function: { name: PROPOSE_TOOL_NAME, arguments: JSON.stringify(request.previous.proposal) },
          },
        ],
      });
      messages.push({ role: 'tool', tool_call_id: callId, content: request.previous.feedback });
      messages.push({
        role: 'user',
        content: `Call ${PROPOSE_TOOL_NAME} again with a corrected proposal that addresses every point in the tool result.`,
      });
    }

    const body = {
      model: this.model,
      max_tokens: this.#maxOutputTokens,
      messages,
      tools: [
        {
          type: 'function',
          function: { name: PROPOSE_TOOL_NAME, description: PROPOSE_TOOL_DESCRIPTION, parameters: this.#toolSchema },
        },
      ],
      tool_choice: { type: 'function', function: { name: PROPOSE_TOOL_NAME } },
    };

    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.#apiKey}`,
          ...this.#headers,
        },
        body: JSON.stringify(body),
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      throw new ProviderError(`could not reach the model provider: ${(error as Error).message}`);
    }

    let parsed: ChatCompletionResponse;
    try {
      parsed = (await response.json()) as ChatCompletionResponse;
    } catch {
      throw new ProviderError(`model provider returned a non-JSON response (HTTP ${response.status})`, response.status);
    }
    // OpenRouter can answer 200 with an `error` body when the upstream model failed.
    if (!response.ok || parsed.error) {
      throw new ProviderError(
        `model provider refused the request (HTTP ${response.status}): ${parsed.error?.message ?? parsed.error?.type ?? 'no detail'}`,
        response.status,
      );
    }

    const call = parsed.choices?.[0]?.message?.tool_calls?.find((c) => c.function?.name === PROPOSE_TOOL_NAME);
    if (!call) {
      throw new ProviderError(
        `model did not call ${PROPOSE_TOOL_NAME} (finish_reason ${parsed.choices?.[0]?.finish_reason ?? 'unknown'})`,
      );
    }

    // Arguments arrive as a JSON string. If it does not parse, hand the raw string on:
    // parseProposal will reject it and the correction turn shows the model its output.
    let proposal: unknown = call.function?.arguments;
    if (typeof proposal === 'string') {
      try {
        proposal = JSON.parse(proposal);
      } catch {
        /* leave as string */
      }
    }

    return {
      proposal,
      usage: {
        inputTokens: parsed.usage?.prompt_tokens ?? 0,
        outputTokens: parsed.usage?.completion_tokens ?? 0,
      },
      model: parsed.model ?? this.model,
    };
  }
}

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
/** Claude Haiku through OpenRouter: same model the prompt was tuned on, billed to OpenRouter credits. */
export const DEFAULT_OPENROUTER_MODEL = 'anthropic/claude-haiku-4.5';

export interface OpenRouterProviderOptions {
  apiKey: string;
  model?: string;
  /** Optional attribution OpenRouter shows in its dashboard; never anything user-specific. */
  appUrl?: string;
  appTitle?: string;
  fetch?: typeof fetch;
}

export function createOpenRouterProvider(options: OpenRouterProviderOptions): OpenAICompatibleProvider {
  const headers: Record<string, string> = {};
  if (options.appUrl) headers['HTTP-Referer'] = options.appUrl;
  if (options.appTitle) headers['X-Title'] = options.appTitle;
  return new OpenAICompatibleProvider({
    apiKey: options.apiKey,
    model: options.model ?? DEFAULT_OPENROUTER_MODEL,
    baseUrl: OPENROUTER_BASE_URL,
    headers,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
}
