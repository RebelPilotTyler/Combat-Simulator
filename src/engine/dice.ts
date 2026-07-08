export interface DiceRollResult {
  expression: string;
  count: number;
  sides: number;
  rolls: number[];
  modifier: number;
  total: number;
}

export type RandomSource = () => number;

const dicePattern = /^\s*(\d*)d(\d+)\s*([+-]\s*\d+)?\s*$/i;

export interface ParsedDiceExpression {
  expression: string;
  count: number;
  sides: number;
  modifier: number;
}

export function parseDiceExpression(expression: string): ParsedDiceExpression {
  const match = dicePattern.exec(expression);

  if (!match) {
    throw new Error(`Invalid dice expression: ${expression}`);
  }

  const count = match[1] ? Number(match[1]) : 1;
  const sides = Number(match[2]);
  const modifier = match[3] ? Number(match[3].replace(/\s/g, '')) : 0;

  if (!Number.isInteger(count) || count <= 0) {
    throw new Error(`Dice count must be positive: ${expression}`);
  }

  if (!Number.isInteger(sides) || sides <= 1) {
    throw new Error(`Dice sides must be greater than 1: ${expression}`);
  }

  return { expression, count, sides, modifier };
}

export function rollDice(expression: string, random: RandomSource = Math.random): DiceRollResult {
  const parsed = parseDiceExpression(expression);
  const { count, sides, modifier } = parsed;

  const rolls = Array.from({ length: count }, () => rollSingleDie(sides, random));
  const total = rolls.reduce((sum, roll) => sum + roll, 0) + modifier;

  return {
    expression,
    count,
    sides,
    rolls,
    modifier,
    total
  };
}

export function rollDamageDice(
  expression: string,
  random: RandomSource = Math.random,
  critical = false
): DiceRollResult {
  const parsed = parseDiceExpression(expression);
  const count = critical ? parsed.count * 2 : parsed.count;
  const rolls = Array.from({ length: count }, () => rollSingleDie(parsed.sides, random));
  const total = rolls.reduce((sum, roll) => sum + roll, 0) + parsed.modifier;

  return {
    expression,
    count,
    sides: parsed.sides,
    rolls,
    modifier: parsed.modifier,
    total
  };
}

export function getDiceTotalBounds(expression: string): { min: number; max: number } {
  const parsed = parseDiceExpression(expression);
  return {
    min: parsed.count + parsed.modifier,
    max: parsed.count * parsed.sides + parsed.modifier
  };
}

export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

function rollSingleDie(sides: number, random: RandomSource): number {
  const value = Math.min(Math.max(random(), 0), 0.999999999999);
  return Math.floor(value * sides) + 1;
}
