import { describe, expect, it } from 'vitest';
import { assertTestDatabaseUrl, DEFAULT_TEST_DATABASE_URL } from './test-database.ts';

describe('assertTestDatabaseUrl', () => {
  it('accepts the default and anything named for tests', () => {
    expect(() => assertTestDatabaseUrl(DEFAULT_TEST_DATABASE_URL)).not.toThrow();
    expect(() => assertTestDatabaseUrl('postgres://u:p@db.example/ci_TEST_42')).not.toThrow();
  });

  it('refuses the development database and anything else not named for tests, without echoing credentials', () => {
    for (const url of ['postgres://qwa:qwa_dev_password@127.0.0.1:5433/qwa', 'postgres://u:secret@host/production']) {
      let message = '';
      try {
        assertTestDatabaseUrl(url);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toMatch(/refusing to run destructive test suites/);
      expect(message).not.toContain('secret');
      expect(message).not.toContain('qwa_dev_password');
    }
  });
});
