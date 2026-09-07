import { describe, expect, it } from 'vitest';
import { createAssistantProviderFromEnv, inferProviderKind } from './factory.ts';
import { createOpenRouterProvider, OpenAICompatibleProvider, OPENROUTER_BASE_URL } from './openai-compatible.ts';
import { AnthropicProvider, PROPOSE_TOOL_NAME, ProviderError, proposeToolInputSchema } from './provider.ts';

function fakeFetch(handler: (url: string, init: RequestInit) => { status: number; body: unknown }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const { status, body } = handler(String(url), init ?? {});
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const toolCallReply = (args: unknown, extra: Record<string, unknown> = {}) => ({
  status: 200,
  body: {
    model: 'anthropic/claude-haiku-4.5',
    usage: { prompt_tokens: 900, completion_tokens: 80 },
    choices: [
      {
        finish_reason: 'tool_calls',
        message: {
          content: null,
          tool_calls: [{ id: 'call_1', type: 'function', function: { name: PROPOSE_TOOL_NAME, arguments: args } }],
        },
      },
    ],
    ...extra,
  },
});

describe('OpenAICompatibleProvider (OpenRouter)', () => {
  it('speaks the chat-completions format with a forced function call and parses the arguments', async () => {
    const { fetchImpl, calls } = fakeFetch(() => toolCallReply(JSON.stringify({ summary: 's', operations: [] })));
    const provider = createOpenRouterProvider({ apiKey: 'sk-or-v1-test', fetch: fetchImpl, appTitle: 'qmk-web-app' });

    const response = await provider.propose({ system: 'SYS', prompt: 'hello' });
    expect(response).toEqual({
      proposal: { summary: 's', operations: [] },
      usage: { inputTokens: 900, outputTokens: 80 },
      model: 'anthropic/claude-haiku-4.5',
    });

    const [call] = calls;
    expect(call?.url).toBe(`${OPENROUTER_BASE_URL}/chat/completions`);
    const headers = call?.init.headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer sk-or-v1-test');
    expect(headers['X-Title']).toBe('qmk-web-app');
    const body = JSON.parse(call?.init.body as string);
    expect(body.model).toBe('anthropic/claude-haiku-4.5');
    expect(body.messages).toEqual([
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'hello' },
    ]);
    expect(body.tool_choice).toEqual({ type: 'function', function: { name: PROPOSE_TOOL_NAME } });
    expect(body.tools[0].function.parameters).toEqual(proposeToolInputSchema());
    expect(JSON.stringify(body)).not.toMatch(/owner|session|cookie/i);
  });

  it('replays a rejected proposal as an assistant tool_call plus a tool result on the correction turn', async () => {
    const { fetchImpl, calls } = fakeFetch(() => toolCallReply('{}'));
    const provider = new OpenAICompatibleProvider({ apiKey: 'k', model: 'openai/gpt-4o-mini', baseUrl: 'https://example.test/v1/' });
    await new OpenAICompatibleProvider({ apiKey: 'k', model: 'm', baseUrl: 'https://example.test/v1', fetch: fetchImpl }).propose({
      system: 'S',
      prompt: 'P',
      previous: { proposal: { bad: 1 }, feedback: 'nope' },
    });
    expect(provider.model).toBe('openai/gpt-4o-mini');
    const body = JSON.parse(calls[0]?.init.body as string);
    expect(calls[0]?.url).toBe('https://example.test/v1/chat/completions');
    expect(body.messages).toHaveLength(5);
    expect(body.messages[2]).toMatchObject({
      role: 'assistant',
      tool_calls: [{ id: 'call_previous', type: 'function', function: { name: PROPOSE_TOOL_NAME, arguments: '{"bad":1}' } }],
    });
    expect(body.messages[3]).toEqual({ role: 'tool', tool_call_id: 'call_previous', content: 'nope' });
  });

  it('passes unparseable arguments through untouched so the schema step reports them', async () => {
    const { fetchImpl } = fakeFetch(() => toolCallReply('{not json'));
    const provider = createOpenRouterProvider({ apiKey: 'sk-or-x', fetch: fetchImpl });
    const response = await provider.propose({ system: 'S', prompt: 'P' });
    expect(response.proposal).toBe('{not json');
  });

  it('turns HTTP errors, 200-with-error bodies, and missing tool calls into ProviderError', async () => {
    const refused = createOpenRouterProvider({
      apiKey: 'sk-or-x',
      fetch: fakeFetch(() => ({ status: 402, body: { error: { message: 'Insufficient credits', code: 402 } } })).fetchImpl,
    });
    await expect(refused.propose({ system: 'S', prompt: 'P' })).rejects.toMatchObject({
      name: 'ProviderError',
      status: 402,
      message: expect.stringContaining('Insufficient credits'),
    });

    const upstream = createOpenRouterProvider({
      apiKey: 'sk-or-x',
      fetch: fakeFetch(() => ({ status: 200, body: { error: { message: 'Provider returned error', type: 'upstream' } } })).fetchImpl,
    });
    await expect(upstream.propose({ system: 'S', prompt: 'P' })).rejects.toBeInstanceOf(ProviderError);

    const chatty = createOpenRouterProvider({
      apiKey: 'sk-or-x',
      fetch: fakeFetch(() => ({ status: 200, body: { choices: [{ finish_reason: 'stop', message: { content: 'Sure!' } }] } })).fetchImpl,
    });
    await expect(chatty.propose({ system: 'S', prompt: 'P' })).rejects.toMatchObject({
      message: expect.stringContaining('did not call propose_changes'),
    });
  });
});

describe('createAssistantProviderFromEnv', () => {
  it('returns null without a key', () => {
    expect(createAssistantProviderFromEnv({})).toBeNull();
    expect(createAssistantProviderFromEnv({ QWA_ASSISTANT_API_KEY: '' })).toBeNull();
  });

  it('infers OpenRouter from an sk-or- key and Anthropic otherwise', () => {
    expect(inferProviderKind('sk-or-v1-abc')).toBe('openrouter');
    expect(inferProviderKind('sk-ant-abc')).toBe('anthropic');
    expect(createAssistantProviderFromEnv({ QWA_ASSISTANT_API_KEY: 'sk-or-v1-abc' })).toBeInstanceOf(OpenAICompatibleProvider);
    expect(createAssistantProviderFromEnv({ QWA_ASSISTANT_API_KEY: 'sk-ant-abc' })).toBeInstanceOf(AnthropicProvider);
  });

  it('honours an explicit provider and model, and rejects an unknown provider', () => {
    const provider = createAssistantProviderFromEnv({
      QWA_ASSISTANT_API_KEY: 'whatever',
      QWA_ASSISTANT_PROVIDER: 'openrouter',
      QWA_ASSISTANT_MODEL: 'openai/gpt-4o-mini',
    });
    expect(provider).toBeInstanceOf(OpenAICompatibleProvider);
    expect(provider?.model).toBe('openai/gpt-4o-mini');
    expect(createAssistantProviderFromEnv({ QWA_ASSISTANT_API_KEY: 'sk-or-x' })?.model).toBe('anthropic/claude-haiku-4.5');
    expect(() => createAssistantProviderFromEnv({ QWA_ASSISTANT_API_KEY: 'k', QWA_ASSISTANT_PROVIDER: 'gemini' })).toThrow(/anthropic.*openrouter/);
  });
});
