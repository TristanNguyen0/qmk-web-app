/**
 * The seam between this package and a hosted language model.
 *
 * A provider is asked for exactly one thing: a single `propose_changes` tool call
 * whose input is a candidate `AssistantProposal`. It knows nothing about keyboards.
 * Everything the model needs is in the system text the service assembles; everything
 * the model returns is treated as untrusted and parsed by `parseProposal`.
 *
 * The Anthropic implementation talks to the Messages API over `fetch` rather than an
 * SDK: the surface used is tiny (one endpoint, forced tool choice, one follow-up
 * turn), and a dependency-free adapter is easier to audit for what leaves the box.
 * Only the system text and the user's prompt are sent; never a session id, owner id,
 * or anything from the environment.
 */
import { zodToJsonSchema } from 'zod-to-json-schema';
import { assistantProposalSchema } from './proposal.ts';

export const PROPOSE_TOOL_NAME = 'propose_changes';

/** JSON Schema for the tool input, derived from the Zod contract so the two cannot drift. */
export function proposeToolInputSchema(): Record<string, unknown> {
  const schema = zodToJsonSchema(assistantProposalSchema, { $refStrategy: 'none', target: 'jsonSchema7' }) as Record<string, unknown>;
  // The Messages API wants a bare object schema, not a document with `$schema`.
  delete schema['$schema'];
  return schema;
}

export const PROPOSE_TOOL_DESCRIPTION =
  'Propose changes to the user’s keyboard configuration as a list of operations, plus an explicit list of ' +
  'anything the user asked for that these operations cannot express. This is the only way to act; ' +
  'there is no free-form output.';

export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ProposeRequest {
  system: string;
  prompt: string;
  /**
   * For a self-correction turn: the model's previous (rejected) proposal and what was
   * wrong with it. The provider replays both so the model sees its own output.
   */
  previous?: { proposal: unknown; feedback: string };
}

export interface ProposeResponse {
  /** The tool input exactly as the model produced it — unparsed, untrusted. */
  proposal: unknown;
  usage: ProviderUsage;
  model: string;
}

export interface AssistantProvider {
  readonly model: string;
  propose(request: ProposeRequest, signal?: AbortSignal): Promise<ProposeResponse>;
}

/** Raised for transport, authentication, and malformed-response failures. */
export class ProviderError extends Error {
  readonly status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
  }
}

export interface AnthropicProviderOptions {
  apiKey: string;
  /** Defaults to the cheapest current Claude model with reliable tool use. */
  model?: string;
  baseUrl?: string;
  maxOutputTokens?: number;
  fetch?: typeof fetch;
}

export const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-4-5';

interface AnthropicToolUse {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

interface AnthropicMessagesResponse {
  content?: ({ type: string } & Partial<AnthropicToolUse>)[];
  usage?: { input_tokens?: number; output_tokens?: number };
  model?: string;
  stop_reason?: string;
  error?: { type?: string; message?: string };
}

export class AnthropicProvider implements AssistantProvider {
  readonly model: string;
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #maxOutputTokens: number;
  readonly #fetch: typeof fetch;
  readonly #toolSchema = proposeToolInputSchema();

  constructor(options: AnthropicProviderOptions) {
    if (!options.apiKey) throw new Error('AnthropicProvider requires an API key');
    this.#apiKey = options.apiKey;
    this.model = options.model ?? DEFAULT_ANTHROPIC_MODEL;
    this.#baseUrl = (options.baseUrl ?? 'https://api.anthropic.com').replace(/\/$/, '');
    this.#maxOutputTokens = options.maxOutputTokens ?? 8192;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async propose(request: ProposeRequest, signal?: AbortSignal): Promise<ProposeResponse> {
    const messages: unknown[] = [{ role: 'user', content: request.prompt }];
    if (request.previous) {
      // Replay the rejected call as a tool_use/tool_result pair so the model sees its
      // exact previous output next to the reasons it was refused.
      const toolUseId = 'toolu_previous';
      messages.push({
        role: 'assistant',
        content: [{ type: 'tool_use', id: toolUseId, name: PROPOSE_TOOL_NAME, input: request.previous.proposal }],
      });
      messages.push({
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: toolUseId, is_error: true, content: request.previous.feedback },
          { type: 'text', text: 'Call propose_changes again with a corrected proposal that addresses every point above.' },
        ],
      });
    }

    const body = {
      model: this.model,
      max_tokens: this.#maxOutputTokens,
      system: request.system,
      messages,
      tools: [{ name: PROPOSE_TOOL_NAME, description: PROPOSE_TOOL_DESCRIPTION, input_schema: this.#toolSchema }],
      tool_choice: { type: 'tool', name: PROPOSE_TOOL_NAME },
    };

    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.#apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      throw new ProviderError(`could not reach the model provider: ${(error as Error).message}`);
    }

    let parsed: AnthropicMessagesResponse;
    try {
      parsed = (await response.json()) as AnthropicMessagesResponse;
    } catch {
      throw new ProviderError(`model provider returned a non-JSON response (HTTP ${response.status})`, response.status);
    }
    if (!response.ok) {
      // Provider error text is operator-facing; the route decides what a user sees.
      throw new ProviderError(
        `model provider refused the request (HTTP ${response.status}): ${parsed.error?.message ?? parsed.error?.type ?? 'no detail'}`,
        response.status,
      );
    }

    const toolUse = parsed.content?.find(
      (block): block is AnthropicToolUse => block.type === 'tool_use' && block.name === PROPOSE_TOOL_NAME,
    );
    if (!toolUse) {
      throw new ProviderError(`model did not call ${PROPOSE_TOOL_NAME} (stop_reason ${parsed.stop_reason ?? 'unknown'})`);
    }

    return {
      proposal: toolUse.input,
      usage: {
        inputTokens: parsed.usage?.input_tokens ?? 0,
        outputTokens: parsed.usage?.output_tokens ?? 0,
      },
      model: parsed.model ?? this.model,
    };
  }
}
