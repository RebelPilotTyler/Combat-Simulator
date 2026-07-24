import { describe, expect, it } from 'vitest';
import { cloneJsonValue } from './jsonClone';

function cloneWithJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('cloneJsonValue', () => {
  it('matches JSON round-trip conversion rules without an intermediate string', () => {
    const fixture = {
      text: 'combat',
      finite: 12.5,
      negativeZero: -0,
      notANumber: Number.NaN,
      positiveInfinity: Number.POSITIVE_INFINITY,
      missing: undefined,
      nested: {
        keep: true,
        omit: undefined
      },
      array: [1, undefined, Number.NEGATIVE_INFINITY, { omit: undefined, keep: 'yes' }],
      date: new Date('2026-07-23T12:00:00.000Z')
    };

    expect(cloneJsonValue(fixture)).toEqual(cloneWithJson(fixture));
    expect(JSON.stringify(cloneJsonValue(fixture))).toBe(JSON.stringify(fixture));
  });

  it('deeply detaches JSON-compatible nested values', () => {
    const source = {
      grid: { blocked: [{ x: 1, y: 2 }] },
      creatures: [{ actions: [{ tags: ['attack'], damage: { dice: '1d6' } }] }]
    };
    const cloned = cloneJsonValue(source);

    cloned.grid.blocked[0].x = 9;
    cloned.creatures[0].actions[0].tags.push('melee');
    cloned.creatures[0].actions[0].damage.dice = '2d6';

    expect(source).toEqual({
      grid: { blocked: [{ x: 1, y: 2 }] },
      creatures: [{ actions: [{ tags: ['attack'], damage: { dice: '1d6' } }] }]
    });
  });

  it('rejects circular and bigint values like JSON serialization', () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;

    expect(() => cloneJsonValue(circular)).toThrow(TypeError);
    expect(() => cloneJsonValue({ value: 1n })).toThrow(TypeError);
  });
});
