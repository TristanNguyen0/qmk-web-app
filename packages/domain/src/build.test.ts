import { describe, expect, it } from 'vitest';
import { BUILD_STATUSES, assertTransition, canTransition, isTerminal } from './build.ts';

describe('build state machine', () => {
  it('follows the happy path from queued to succeeded', () => {
    const path = ['queued', 'preparing', 'building', 'uploading', 'succeeded'] as const;
    for (let i = 0; i < path.length - 1; i += 1) {
      expect(canTransition(path[i]!, path[i + 1]!), `${path[i]} -> ${path[i + 1]}`).toBe(true);
    }
  });

  it('never allows a terminal failure to be reopened', () => {
    for (const to of BUILD_STATUSES) {
      expect(canTransition('failed', to), `failed -> ${to}`).toBe(false);
      expect(canTransition('cancelled', to), `cancelled -> ${to}`).toBe(false);
    }
  });

  it('never allows a build to skip straight to succeeded', () => {
    // The artifact is only collected in `uploading`; jumping there would mean
    // reporting success without one.
    expect(canTransition('queued', 'succeeded')).toBe(false);
    expect(canTransition('preparing', 'succeeded')).toBe(false);
    expect(canTransition('building', 'succeeded')).toBe(false);
  });

  it('allows a succeeded build to expire but nothing else', () => {
    expect(canTransition('succeeded', 'expired')).toBe(true);
    expect(canTransition('succeeded', 'failed')).toBe(false);
    expect(canTransition('succeeded', 'building')).toBe(false);
  });

  it('cannot be cancelled once uploading has started', () => {
    expect(canTransition('uploading', 'cancelled')).toBe(false);
  });

  it('lets an in-flight build return to the queue when its lease is lost', () => {
    expect(canTransition('preparing', 'queued')).toBe(true);
    expect(canTransition('building', 'queued')).toBe(true);
    expect(canTransition('uploading', 'queued')).toBe(true);
  });

  it('throws with a readable message on an illegal transition', () => {
    expect(() => assertTransition('succeeded', 'queued')).toThrow(
      'illegal build state transition: succeeded -> queued',
    );
  });

  it('reports terminal states', () => {
    expect(isTerminal('succeeded')).toBe(true);
    expect(isTerminal('failed')).toBe(true);
    expect(isTerminal('cancelled')).toBe(true);
    expect(isTerminal('expired')).toBe(true);
    expect(isTerminal('building')).toBe(false);
  });
});
