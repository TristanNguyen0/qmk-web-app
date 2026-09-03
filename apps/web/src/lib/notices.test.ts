import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DATA_LOSS_NOTICE } from './notices.ts';

function sourceOf(relativeToThisFile: string): string {
  return readFileSync(fileURLToPath(new URL(relativeToThisFile, import.meta.url)), 'utf-8');
}

describe('DATA_LOSS_NOTICE', () => {
  it('names the browser-cookie tie', () => {
    expect(DATA_LOSS_NOTICE.toLowerCase()).toContain('cookie');
  });

  it('states the loss consequence plainly', () => {
    expect(DATA_LOSS_NOTICE.toLowerCase()).toContain('lose');
  });

  it('names export as the remedy', () => {
    expect(DATA_LOSS_NOTICE.toLowerCase()).toContain('export');
  });

  it('does not soften the decision as temporary or imply accounts are coming', () => {
    const lower = DATA_LOSS_NOTICE.toLowerCase();
    expect(lower).not.toContain('for now');
    expect(lower).not.toContain('coming soon');
    expect(lower).not.toContain('beta');
    expect(lower).not.toContain('temporarily');
    expect(lower).not.toContain('accounts are coming');
    expect(lower).not.toContain('yet');
  });
});

describe('DataLossNotice renders on both required surfaces', () => {
  it('the configurations list page renders <DataLossNotice', () => {
    const source = sourceOf('../app/configurations/page.tsx');
    expect(source).toContain('<DataLossNotice');
  });

  it('the keymap editor renders <DataLossNotice', () => {
    const source = sourceOf('../components/KeymapEditor.tsx');
    expect(source).toContain('<DataLossNotice');
  });
});
