import { describe, expect, it } from 'vitest';
import { redactAttributes, redactLog } from './redact.ts';

describe('log redaction', () => {
  it('strips container-internal paths', () => {
    const raw = 'error: /workspace/build/obj_crkbd/keymap.c:14: undefined';
    expect(redactLog(raw)).toBe('error: obj_crkbd/keymap.c:14: undefined');
  });

  it('strips host paths passed in by the caller', () => {
    const raw = 'reading /home/tristan/dev/qmk-web-app/.cache/qmk/abc123/quantum/keymap.h';
    const redacted = redactLog(raw, {
      extraPaths: ['/home/tristan/dev/qmk-web-app/.cache/qmk/abc123'],
    });
    expect(redacted).toBe('reading quantum/keymap.h');
    expect(redacted).not.toContain('/home/tristan');
  });

  it('redacts signed URL query strings but keeps the URL readable', () => {
    const raw = 'uploading to https://storage.example.com/artifacts/a.hex?X-Amz-Signature=deadbeef';
    expect(redactLog(raw)).toBe('uploading to https://storage.example.com/artifacts/a.hex?[redacted]');
  });

  it('redacts credential-shaped environment variables', () => {
    const raw = [
      'AWS_SECRET_ACCESS_KEY=abc123',
      'DATABASE_PASSWORD=hunter2',
      'API_TOKEN=xyz',
      'Authorization: Bearer eyJhbGciOi.JzdWIiOiI.SflKxwRJ',
      'AKIAIOSFODNN7EXAMPLE',
    ].join('\n');
    const redacted = redactLog(raw);
    for (const secret of ['abc123', 'hunter2', 'xyz', 'eyJhbGciOi', 'AKIAIOSFODNN7EXAMPLE']) {
      expect(redacted, secret).not.toContain(secret);
    }
  });

  it('keeps ordinary compiler diagnostics intact', () => {
    const raw = "keymap.c:14:30: error: 'MACRO_00' undeclared here (not in a function)";
    expect(redactLog(raw)).toBe(raw);
  });

  it('caps the log and keeps the tail where compiler errors live', () => {
    const raw = `${'noise\n'.repeat(5000)}error: the important part`;
    const redacted = redactLog(raw, { maxBytes: 1024 });
    expect(Buffer.byteLength(redacted, 'utf8')).toBeLessThan(1024 + 100);
    expect(redacted).toContain('error: the important part');
    expect(redacted).toContain('log truncated');
  });
});

describe('redactAttributes', () => {
  it('applies the same path and secret tables to every string value', () => {
    const attributes = {
      note: 'error: /workspace/build/obj_crkbd/keymap.c:14: undefined',
      token: 'API_TOKEN=xyz',
    };
    expect(redactAttributes(attributes)).toEqual({
      note: 'error: obj_crkbd/keymap.c:14: undefined',
      token: 'API_TOKEN=[redacted]',
    });
  });

  it('leaves numeric values untouched', () => {
    expect(redactAttributes({ count: 3, durationMs: 4200 })).toEqual({
      count: 3,
      durationMs: 4200,
    });
  });

  it('produces the same substitution redactLog performs on the same text', () => {
    const raw = 'reading /workspace/qmkroot/keyboards/crkbd/rev1/rev1.c';
    expect(redactAttributes({ note: raw }).note).toBe(redactLog(raw));
  });

  it('strips a container path from an attribute value, matching redactLog', () => {
    const raw = '/workspace/tmp/build-scratch/obj/keymap.o';
    const attributeResult = redactAttributes({ path: raw }).path;
    expect(attributeResult).toBe(redactLog(raw));
    expect(attributeResult).not.toContain('/workspace/tmp/');
  });

  it('strips host paths passed in as extraPaths, the same way redactLog does', () => {
    const raw = '/home/tristan/dev/qmk-web-app/.cache/qmk/abc123/quantum/keymap.h';
    const extraPaths = ['/home/tristan/dev/qmk-web-app/.cache/qmk/abc123'];
    expect(redactAttributes({ note: raw }, { extraPaths })).toEqual({
      note: redactLog(raw, { extraPaths }),
    });
  });

  it('does not mutate the input record', () => {
    const attributes = { note: 'API_TOKEN=xyz' };
    redactAttributes(attributes);
    expect(attributes.note).toBe('API_TOKEN=xyz');
  });
});
