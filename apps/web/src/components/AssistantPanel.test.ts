import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AssistantPanel } from './AssistantPanel.tsx';

const document = { name: 'Test', layers: [], macros: [], socd: null };

describe('AssistantPanel', () => {
  it('renders nothing when the server has no assistant', () => {
    const html = renderToStaticMarkup(
      createElement(AssistantPanel, {
        configurationId: 'c',
        status: { enabled: false, limits: { maxPromptLength: 2000, requestsPerOwnerPerHour: 30 } },
        document,
        onApply: () => {},
        onPreview: () => {},
      }),
    );
    expect(html).toBe('');
    expect(
      renderToStaticMarkup(createElement(AssistantPanel, { configurationId: 'c', status: null, document, onApply: () => {}, onPreview: () => {} })),
    ).toBe('');
  });

  it('renders the prompt form, the model, and the limits when enabled', () => {
    const html = renderToStaticMarkup(
      createElement(AssistantPanel, {
        configurationId: 'c',
        status: { enabled: true, model: 'claude-haiku-4-5', limits: { maxPromptLength: 2000, requestsPerOwnerPerHour: 30 } },
        document,
        onApply: () => {},
        onPreview: () => {},
      }),
    );
    expect(html).toContain('Describe a change');
    expect(html).toContain('claude-haiku-4-5');
    expect(html).toContain('30 requests per hour');
    expect(html).toContain('maxLength="2000"');
    // The form is honest about the boundary before a word is typed.
    expect(html).toMatch(/can only use features this editor offers/);
    expect(html).toContain('Propose changes');
  });
});
