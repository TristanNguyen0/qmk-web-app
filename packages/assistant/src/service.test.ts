import { describe, expect, it } from 'vitest';
import { readCatalogSample } from '@qmk-web-app/qmk-fixtures';
import { importDefaultKeymap, type Catalog, type Configuration } from '@qmk-web-app/domain';
import { AnthropicProvider, PROPOSE_TOOL_NAME, ProviderError, proposeToolInputSchema, type AssistantProvider, type ProposeRequest } from './provider.ts';
import { formatFeedback, runAssistant, SYSTEM_RULES } from './service.ts';

const catalog = readCatalogSample() as Catalog;

let counter = 0;
const newId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

function crkbd(): Configuration {
  const kb = catalog.keyboards.find((k) => k.keyboardId === 'crkbd/rev1');
  if (!kb?.supported) throw new Error('fixture');
  const imported = importDefaultKeymap({ keyboard: kb, layoutId: 'LAYOUT_split_3x6_3', keycodeAliases: catalog.keycodeAliases, newId });
  if (!imported.available) throw new Error('fixture');
  return {
    id: '11111111-1111-4111-8111-111111111111',
    ownerId: null,
    schemaVersion: 1,
    catalogVersion: catalog.catalogVersion,
    qmkCommit: catalog.qmkCommit,
    keyboardId: 'crkbd/rev1',
    layoutId: 'LAYOUT_split_3x6_3',
    name: 'Corne',
    revision: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    layers: imported.layers,
    macros: [],
    socd: null,
    generatorVersion: '1.1.0',
  };
}

/** Replays scripted proposals in order and records what it was asked. */
function scripted(proposals: unknown[]): AssistantProvider & { requests: ProposeRequest[] } {
  const requests: ProposeRequest[] = [];
  return {
    model: 'fake-model',
    requests,
    async propose(request) {
      requests.push(request);
      const proposal = proposals.shift();
      if (proposal === undefined) throw new Error('scripted provider exhausted');
      return { proposal, usage: { inputTokens: 100, outputTokens: 10 }, model: 'fake-model' };
    },
  };
}

describe('runAssistant', () => {
  it('grounds the model in the rendered context and returns a resolved proposal', async () => {
    const provider = scripted([
      { summary: 'Made Q a Delete key.', operations: [{ op: 'set_key', layer: 0, key: { key: 'Q' }, binding: { type: 'keycode', keycode: 'Del' } }] },
    ]);
    const result = await runAssistant({ provider, configuration: crkbd(), catalog, prompt: 'make Q delete', newId });

    expect(result.outcome).toBe('proposal');
    if (result.outcome !== 'proposal') return;
    expect(result.resolved.ok).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 10 });

    const [request] = provider.requests;
    expect(request?.prompt).toBe('make Q delete');
    expect(request?.system.startsWith(SYSTEM_RULES)).toBe(true);
    expect(request?.system).toContain('[1:KC_Q]');
    expect(request?.system).toContain('SOCD: available');
    expect(request?.previous).toBeUndefined();
  });

  it('gives the model one correction turn with its own proposal and the issues', async () => {
    const provider = scripted([
      { summary: 'x', operations: [{ op: 'set_key', layer: 'Fn', key: { key: 'Q' }, binding: { type: 'keycode', keycode: 'Del' } }] },
      {
        summary: 'Added an Fn layer where Q is Delete.',
        operations: [
          { op: 'add_layer', name: 'Fn' },
          { op: 'set_key', layer: 'Fn', key: { key: 'Q' }, binding: { type: 'keycode', keycode: 'Del' } },
        ],
      },
    ]);
    const result = await runAssistant({ provider, configuration: crkbd(), catalog, prompt: 'fn+q = delete', newId });

    expect(result.attempts).toBe(2);
    expect(result.outcome).toBe('proposal');
    if (result.outcome !== 'proposal') return;
    expect(result.resolved.ok).toBe(true);
    expect(result.resolved.candidate.layers).toHaveLength(5);
    expect(result.usage.inputTokens).toBe(200);

    const second = provider.requests[1]!;
    expect(second.previous?.proposal).toEqual(
      expect.objectContaining({ operations: [expect.objectContaining({ layer: 'Fn' })] }),
    );
    expect(second.previous?.feedback).toContain('operations[0] (set_key): no layer is named "Fn"');
    expect(second.previous?.feedback).toContain('candidates: 0 (Base)');
  });

  it('returns the better partial result when the correction does not help', async () => {
    const bad = { summary: 'x', operations: [{ op: 'set_key', layer: 0, key: { key: 'Q' }, binding: { type: 'keycode', keycode: 'QK_BOOT' } }] };
    const provider = scripted([bad, bad]);
    const result = await runAssistant({ provider, configuration: crkbd(), catalog, prompt: 'q resets', newId });
    expect(result.outcome).toBe('proposal');
    if (result.outcome !== 'proposal') return;
    expect(result.resolved.ok).toBe(false);
    expect(result.resolved.issues).toHaveLength(1);
    expect(result.attempts).toBe(2);
  });

  it('reports malformed output when the model never matches the schema', async () => {
    const provider = scripted([{ nonsense: true }, 'still nonsense']);
    const result = await runAssistant({ provider, configuration: crkbd(), catalog, prompt: 'hi', newId });
    expect(result.outcome).toBe('malformed');
    if (result.outcome !== 'malformed') return;
    expect(result.errors.length).toBeGreaterThan(0);
    expect(provider.requests[1]?.previous?.feedback).toMatch(/did not match the schema/);
  });

  it('respects maxAttempts of 1', async () => {
    const provider = scripted([{ summary: 'x', operations: [{ op: 'set_key', layer: 'Nope', key: { position: 0 }, binding: { type: 'none' } }] }]);
    const result = await runAssistant({ provider, configuration: crkbd(), catalog, prompt: 'x', maxAttempts: 1, newId });
    expect(result.attempts).toBe(1);
    expect(provider.requests).toHaveLength(1);
  });
});

describe('formatFeedback', () => {
  it('lists validation failures as well as resolution issues', () => {
    const text = formatFeedback({
      ok: false,
      candidate: crkbd(),
      changes: [],
      issues: [{ operation: 2, op: 'set_socd', reason: 'bad', candidates: ['a', 'b'] }],
      validation: { ok: false, code: 'CAPABILITY_UNAVAILABLE', message: 'not verified', fieldErrors: [{ path: 'socd.enabled', message: 'unavailable' }] },
      summary: '',
      unsupported: [],
    });
    expect(text).toContain('operations[2] (set_socd): bad');
    expect(text).toContain('candidates: a; b');
    expect(text).toContain('rejected (CAPABILITY_UNAVAILABLE)');
    expect(text).toContain('- socd.enabled: unavailable');
  });
});

describe('AnthropicProvider', () => {
  function fakeFetch(handler: (url: string, init: RequestInit) => { status: number; body: unknown }) {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      const { status, body } = handler(String(url), init ?? {});
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    return { fetchImpl, calls };
  }

  it('forces the propose_changes tool and returns its input verbatim', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 200,
      body: {
        model: 'claude-haiku-4-5-20251001',
        stop_reason: 'tool_use',
        usage: { input_tokens: 1234, output_tokens: 56 },
        content: [{ type: 'tool_use', id: 'toolu_1', name: PROPOSE_TOOL_NAME, input: { summary: 's', operations: [] } }],
      },
    }));
    const provider = new AnthropicProvider({ apiKey: 'sk-test', fetch: fetchImpl });
    const response = await provider.propose({ system: 'SYS', prompt: 'hello' });

    expect(response).toEqual({
      proposal: { summary: 's', operations: [] },
      usage: { inputTokens: 1234, outputTokens: 56 },
      model: 'claude-haiku-4-5-20251001',
    });

    const [call] = calls;
    expect(call?.url).toBe('https://api.anthropic.com/v1/messages');
    const headers = call?.init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-test');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(call?.init.body as string);
    expect(body.model).toBe('claude-haiku-4-5');
    expect(body.system).toBe('SYS');
    expect(body.tool_choice).toEqual({ type: 'tool', name: PROPOSE_TOOL_NAME });
    expect(body.tools[0].input_schema).toEqual(proposeToolInputSchema());
    expect(body.messages).toEqual([{ role: 'user', content: 'hello' }]);
    // Nothing but the system text and prompt leaves the box.
    expect(JSON.stringify(body)).not.toMatch(/owner|session|cookie/i);
  });

  it('replays a rejected proposal as a tool_result on the correction turn', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 200,
      body: { content: [{ type: 'tool_use', id: 't', name: PROPOSE_TOOL_NAME, input: {} }], usage: {} },
    }));
    const provider = new AnthropicProvider({ apiKey: 'k', fetch: fetchImpl, model: 'custom-model' });
    await provider.propose({ system: 'S', prompt: 'P', previous: { proposal: { bad: 1 }, feedback: 'nope' } });
    const body = JSON.parse(calls[0]?.init.body as string);
    expect(body.model).toBe('custom-model');
    expect(body.messages).toHaveLength(3);
    expect(body.messages[1].content[0]).toMatchObject({ type: 'tool_use', name: PROPOSE_TOOL_NAME, input: { bad: 1 } });
    expect(body.messages[2].content[0]).toMatchObject({ type: 'tool_result', is_error: true, content: 'nope' });
  });

  it('turns HTTP and shape failures into ProviderError', async () => {
    const refused = new AnthropicProvider({
      apiKey: 'k',
      fetch: fakeFetch(() => ({ status: 401, body: { error: { type: 'authentication_error', message: 'invalid x-api-key' } } })).fetchImpl,
    });
    await expect(refused.propose({ system: 'S', prompt: 'P' })).rejects.toMatchObject({
      name: 'ProviderError',
      status: 401,
      message: expect.stringContaining('invalid x-api-key'),
    });

    const noTool = new AnthropicProvider({
      apiKey: 'k',
      fetch: fakeFetch(() => ({ status: 200, body: { content: [{ type: 'text', text: 'I refuse' }], stop_reason: 'end_turn' } })).fetchImpl,
    });
    await expect(noTool.propose({ system: 'S', prompt: 'P' })).rejects.toBeInstanceOf(ProviderError);

    const offline = new AnthropicProvider({
      apiKey: 'k',
      fetch: (async () => {
        throw new Error('ECONNREFUSED');
      }) as typeof fetch,
    });
    await expect(offline.propose({ system: 'S', prompt: 'P' })).rejects.toMatchObject({ message: expect.stringContaining('ECONNREFUSED') });
  });

  it('derives a bare JSON Schema object from the Zod contract', () => {
    const schema = proposeToolInputSchema();
    expect(schema['type']).toBe('object');
    expect(schema['$schema']).toBeUndefined();
    const props = schema['properties'] as Record<string, unknown>;
    expect(Object.keys(props).sort()).toEqual(['operations', 'summary', 'unsupported']);
    expect(JSON.stringify(schema)).toContain('apply_default_keymap');
    expect(JSON.stringify(schema)).not.toContain('$ref');
  });
});
