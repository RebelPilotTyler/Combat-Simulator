import { describe, expect, it } from 'vitest';
import { abilityModifier, getDiceTotalBounds, rollDamageDice, rollDice } from './dice';

function sequence(values: number[]) {
  let index = 0;
  return () => values[index++] ?? 0;
}

describe('rollDice', () => {
  it('rolls 1d20+5 with individual rolls, modifier, and total', () => {
    const result = rollDice('1d20+5', sequence([0.49]));

    expect(result.rolls).toEqual([10]);
    expect(result.modifier).toBe(5);
    expect(result.total).toBe(15);
  });

  it('rolls multiple dice with a modifier', () => {
    const result = rollDice('2d6+3', sequence([0, 0.99]));

    expect(result.rolls).toEqual([1, 6]);
    expect(result.modifier).toBe(3);
    expect(result.total).toBe(10);
  });

  it('defaults missing modifier to zero', () => {
    const result = rollDice('4d8', sequence([0, 0.125, 0.5, 0.99]));

    expect(result.rolls).toEqual([1, 2, 5, 8]);
    expect(result.modifier).toBe(0);
    expect(result.total).toBe(16);
  });

  it('keeps d20 rolls inclusive from 1 through 20', () => {
    expect(rollDice('1d20', sequence([0])).rolls).toEqual([1]);
    expect(rollDice('1d20', sequence([0.999999])).rolls).toEqual([20]);
    expect(rollDice('1d20', sequence([1])).rolls).toEqual([20]);
  });

  it('reports min and max possible totals', () => {
    expect(getDiceTotalBounds('1d20+4')).toEqual({ min: 5, max: 24 });
    expect(getDiceTotalBounds('2d6+3')).toEqual({ min: 5, max: 15 });
    expect(getDiceTotalBounds('4d8')).toEqual({ min: 4, max: 32 });
  });

  it('applies modifiers exactly once when doubling critical damage dice', () => {
    const result = rollDamageDice('1d8+3', sequence([0, 0.999]), true);

    expect(result.rolls).toEqual([1, 8]);
    expect(result.modifier).toBe(3);
    expect(result.total).toBe(12);
  });

  it('maps many d20 rolls approximately uniformly', () => {
    const buckets = new Array<number>(20).fill(0);
    const random = cyclingD20Source();

    for (let index = 0; index < 10000; index += 1) {
      const roll = rollDice('1d20', random).total;
      buckets[roll - 1] += 1;
    }

    buckets.forEach((count) => {
      expect(count).toBeGreaterThanOrEqual(480);
      expect(count).toBeLessThanOrEqual(520);
    });
  });

  it('calculates ability modifiers', () => {
    expect(abilityModifier(8)).toBe(-1);
    expect(abilityModifier(10)).toBe(0);
    expect(abilityModifier(15)).toBe(2);
  });
});

function cyclingD20Source() {
  let index = 0;
  return () => {
    const value = ((index % 20) + 0.5) / 20;
    index += 1;
    return value;
  };
}
