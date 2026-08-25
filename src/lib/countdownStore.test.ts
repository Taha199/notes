import { describe, expect, it } from 'vitest';
import type { CountdownItem } from '../types';
import { mergeCountdowns } from './countdownStore';

function item(id: string, updatedAt: string, targetAt = '2027-01-01T00:00:00.000Z'): CountdownItem {
  return {
    id,
    title: id,
    targetAt,
    repeat: 'none',
    format: { years: false, months: false, weeks: false, days: true, hours: true, minutes: true, seconds: false },
    textShadow: true,
    background: 'sunset',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt,
  };
}

describe('mergeCountdowns', () => {
  it('prefers newer updatedAt when ids collide', () => {
    const local = [item('a', '2026-01-02T00:00:00.000Z')];
    const remote = [item('a', '2026-01-03T00:00:00.000Z')];
    const merged = mergeCountdowns(local, remote);
    expect(merged).toHaveLength(1);
    expect(merged[0].updatedAt).toBe('2026-01-03T00:00:00.000Z');
  });

  it('drops deleted ids', () => {
    const local = [item('a', '2026-01-02T00:00:00.000Z')];
    const remote = [item('b', '2026-01-02T00:00:00.000Z')];
    const merged = mergeCountdowns(local, remote, ['a']);
    expect(merged.map((row) => row.id)).toEqual(['b']);
  });

  it('sorts by targetAt', () => {
    const merged = mergeCountdowns(
      [item('b', '2026-01-01T00:00:00.000Z', '2027-06-01T00:00:00.000Z')],
      [item('a', '2026-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z')],
    );
    expect(merged.map((row) => row.id)).toEqual(['a', 'b']);
  });
});
