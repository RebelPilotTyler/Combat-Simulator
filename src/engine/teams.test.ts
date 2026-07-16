import { describe, expect, it } from 'vitest';
import { createSampleEncounter, sampleCreatures } from '../data/sampleEncounter';
import { createCombatState } from './combat';
import { areAllies, areHostile, createNextTeamDefinition, normalizeTeamId } from './teams';
import type { Creature } from './types';

function creature(id: string, team: string): Creature {
  return {
    id,
    name: id,
    team,
    hp: 10,
    maxHp: 10,
    ac: 10,
    abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    proficiencyBonus: 2,
    speed: 30,
    position: { x: 0, y: 0 },
    conditions: [],
    actions: []
  };
}

describe('teams and factions', () => {
  it('migrates legacy team ids to numbered defaults', () => {
    expect(normalizeTeamId('players')).toBe('team-1');
    expect(normalizeTeamId('enemies')).toBe('team-2');
    expect(normalizeTeamId('neutral')).toBe('neutral');
  });

  it('treats different non-neutral teams as hostile and neutral teams as non-hostile', () => {
    const state = createCombatState([
      creature('one', 'team-1'),
      creature('one-ally', 'team-1'),
      creature('three', 'team-3'),
      creature('bystander', 'neutral')
    ]);

    expect(areAllies(state.creatures[0], state.creatures[1], state)).toBe(true);
    expect(areHostile(state.creatures[0], state.creatures[2], state)).toBe(true);
    expect(areHostile(state.creatures[0], state.creatures[3], state)).toBe(false);
  });

  it('supports explicit relationships for future faction customization', () => {
    const state = createCombatState(
      [creature('one', 'team-1'), creature('three', 'team-3'), creature('bystander', 'neutral')],
      10,
      10,
      [],
      [],
      [
        { id: 'team-1', name: 'Blue Company', color: '#123456', relationships: { 'team-3': 'allied' } },
        { id: 'team-3', name: 'Green Company', color: '#234567' },
        { id: 'neutral', name: 'Watchers', color: '#345678', neutral: true, relationships: { 'team-1': 'hostile' } }
      ]
    );

    expect(areAllies(state.creatures[0], state.creatures[1], state)).toBe(true);
    expect(areHostile(state.creatures[0], state.creatures[2], state)).toBe(true);
  });

  it('creates the next available numbered team with a distinct color', () => {
    const state = createCombatState([creature('one', 'team-1'), creature('two', 'team-2')]);
    const next = createNextTeamDefinition(state.teams);

    expect(next).toMatchObject({ id: 'team-3', name: 'Team 3' });
    expect(state.teams.map((team) => team.color)).not.toContain(next.color);
  });

  it('ships sample creatures and combat with numbered team ids', () => {
    expect(new Set(sampleCreatures.map((candidate) => candidate.team))).toEqual(new Set(['team-1', 'team-2']));
    expect(createSampleEncounter().teams.map((team) => team.id)).toEqual(expect.arrayContaining(['team-1', 'team-2', 'neutral']));
  });
});
