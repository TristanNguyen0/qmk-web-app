import { describe, expect, it } from 'vitest';
import { redactLog } from './redact.ts';

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
