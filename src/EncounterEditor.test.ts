import { describe, expect, it } from 'vitest';
import { estimateEncounterBalance, filterCreaturesForEditor, hydrateEncounterCreatures, type SavedEncounterCreatureInstance } from './EncounterEditor';
import type { Creature } from './engine/types';

const creatures: Creature[] = [
  {
    id: 'ember-apprentice',
    name: 'Ember Apprentice',
    team: 'team-1',
    hp: 17,
    maxHp: 17,
    ac: 13,
    abilityScores: { str: 8, dex: 14, con: 12, int: 16, wis: 11, cha: 10 },
    proficiencyBonus: 2,
    speed: 30,
    position: { x: 1, y: 1, z: 0 },
    conditions: [],
    actions: [
      {
        id: 'fire-bolt',
        name: 'Fire Bolt',
        kind: 'spell',
        actionCost: 'action',
        tags: ['spell', 'ranged'],
        range: 12,
        effects: []
      }
    ],
    resources: [{ id: 'focus', name: 'Arcane Focus', current: 1, max: 1, resetOn: 'longRest' }],
    features: []
  },
  {
    id: 'training-brute',
    name: 'Training Brute',
    team: 'team-2',
    hp: 30,
    maxHp: 30,
    ac: 12,
    abilityScores: { str: 16, dex: 10, con: 14, int: 8, wis: 10, cha: 9 },
    proficiencyBonus: 2,
    speed: 25,
    position: { x: 4, y: 4, z: 0 },
    conditions: [],
    actions: [
      {
        id: 'club',
        name: 'Club',
        kind: 'meleeAttack',
        actionCost: 'action',
        tags: ['attack', 'melee'],
        range: 1,
        effects: []
      }
    ],
    resources: [],
    features: [{ id: 'rage', name: 'Rage Uses', description: '', enabled: true, source: 'class' }]
  }
];

describe('filterCreaturesForEditor', () => {
  it('returns all creatures for a blank query', () => {
    expect(filterCreaturesForEditor(creatures, '')).toEqual(creatures);
  });

  it('filters by creature stats and team', () => {
    expect(filterCreaturesForEditor(creatures, 'team-1 ac 13').map((creature) => creature.id)).toEqual(['ember-apprentice']);
  });

  it('filters creature editor entries by a custom numbered team id', () => {
    const thirdTeamCreature = { ...creatures[0], id: 'third-team-scout', team: 'team-3' };

    expect(filterCreaturesForEditor([...creatures, thirdTeamCreature], 'team-3').map((creature) => creature.id)).toEqual(['third-team-scout']);
  });

  it('filters creature editor entries by custom team names', () => {
    const wardens = { ...creatures[0], id: 'wardens-scout', team: 'team-3' };

    expect(
      filterCreaturesForEditor([...creatures, wardens], 'emerald wardens', [
        { id: 'team-3', name: 'Emerald Wardens', color: '#2e7d32' }
      ]).map((creature) => creature.id)
    ).toEqual(['wardens-scout']);
  });

  it('filters by action tags and feature names', () => {
    expect(filterCreaturesForEditor(creatures, 'melee rage').map((creature) => creature.id)).toEqual(['training-brute']);
  });
});

describe('hydrateEncounterCreatures', () => {
  it('uses latest library template stats while preserving placement and encounter state', () => {
    const updatedTemplate: Creature = {
      ...creatures[1],
      hp: 40,
      maxHp: 40,
      ac: 16,
      speed: 35,
      actions: [
        {
          id: 'greatclub',
          name: 'Greatclub',
          kind: 'meleeAttack',
          actionCost: 'action',
          tags: ['attack', 'melee', 'heavy'],
          range: 1,
          effects: []
        }
      ],
      features: [{ id: 'brutal', name: 'Brutal Training', description: '', enabled: true, source: 'library' }]
    };
    const instance: SavedEncounterCreatureInstance = {
      id: 'brute-instance-1',
      templateId: 'training-brute',
      overrides: {
        id: 'brute-instance-1',
        hp: 12,
        position: { x: 7, y: 3, z: 2 },
        conditions: [
          {
            id: 'prone',
            durationType: 'permanentUntilRemoved',
            stackBehavior: 'none',
            stackCount: 1,
            intensity: 1
          }
        ]
      },
      fallback: creatures[1]
    };

    const hydrated = hydrateEncounterCreatures([instance], [creatures[0], updatedTemplate]);

    expect(hydrated.warnings).toEqual([]);
    expect(hydrated.creatures[0]).toMatchObject({
      id: 'brute-instance-1',
      name: 'Training Brute',
      hp: 12,
      maxHp: 40,
      ac: 16,
      speed: 35,
      position: { x: 7, y: 3, z: 2 }
    });
    expect(hydrated.creatures[0].actions.map((action) => action.id)).toEqual(['greatclub']);
    expect(hydrated.creatures[0].features?.map((feature) => feature.id)).toEqual(['brutal']);
    expect(hydrated.creatures[0].conditions.map((condition) => condition.id)).toEqual(['prone']);
  });

  it('syncs latest resource definitions while preserving encounter resource current values', () => {
    const updatedTemplate: Creature = {
      ...creatures[0],
      resources: [
        { id: 'focus', name: 'Arcane Focus', current: 3, max: 3, resetOn: 'longRest' },
        { id: 'ward', name: 'Ward Charge', current: 1, max: 1, resetOn: 'shortRest' }
      ]
    };
    const instance: SavedEncounterCreatureInstance = {
      id: 'apprentice-instance-1',
      templateId: 'ember-apprentice',
      overrides: {
        id: 'apprentice-instance-1',
        position: { x: 3, y: 3, z: 0 },
        resources: [{ id: 'focus', name: 'Old Focus', current: 0, max: 1, resetOn: 'longRest' }]
      },
      fallback: creatures[0]
    };

    const hydrated = hydrateEncounterCreatures([instance], [updatedTemplate]);

    expect(hydrated.creatures[0].resources).toEqual([
      { id: 'focus', name: 'Arcane Focus', current: 0, max: 3, resetOn: 'longRest', display: { showOnCreaturePanel: true, mode: 'pips' } },
      { id: 'ward', name: 'Ward Charge', current: 1, max: 1, resetOn: 'shortRest', display: { showOnCreaturePanel: true, mode: 'pips' } }
    ]);
  });

  it('falls back visibly when a referenced template is missing', () => {
    const instance: SavedEncounterCreatureInstance = {
      id: 'missing-template-instance',
      templateId: 'deleted-creature',
      overrides: {
        id: 'missing-template-instance',
        position: { x: 2, y: 5, z: 0 }
      },
      fallback: creatures[0]
    };

    const hydrated = hydrateEncounterCreatures([instance], []);

    expect(hydrated.creatures[0].name).toBe('Ember Apprentice');
    expect(hydrated.creatures[0].position).toEqual({ x: 2, y: 5, z: 0 });
    expect(hydrated.warnings[0]).toContain('using saved fallback data');
  });
});

describe('estimateEncounterBalance', () => {
  it('totals estimated CR XP by team and reports the stronger side', () => {
    const hero = balanceCreature({
      id: 'hero',
      name: 'Hero',
      team: 'team-1',
      maxHp: 72,
      hp: 72,
      ac: 15,
      attackBonus: 5,
      damageDice: '1d8+3'
    });
    const brute = balanceCreature({
      id: 'brute',
      name: 'Brute',
      team: 'team-2',
      maxHp: 120,
      hp: 120,
      ac: 15,
      attackBonus: 6,
      damageDice: '2d10+4'
    });
    const bystander = balanceCreature({
      id: 'bystander',
      name: 'Bystander',
      team: 'neutral',
      maxHp: 10,
      hp: 10,
      ac: 10,
      attackBonus: 2,
      damageDice: '1'
    });

    const balance = estimateEncounterBalance([hero, brute, bystander]);

    expect(balance.teams['team-1'].xp).toBe(200);
    expect(balance.teams['team-2'].xp).toBe(700);
    expect(balance.teams.neutral.count).toBe(1);
    expect(balance.leader).toBe('team-2');
    expect(balance.message).toContain('Team 2 / Enemies');
  });

  it('reports roughly even when player and enemy CR weight is close', () => {
    const hero = balanceCreature({
      id: 'hero',
      name: 'Hero',
      team: 'team-1',
      maxHp: 72,
      hp: 72,
      ac: 15,
      attackBonus: 5,
      damageDice: '1d8+3'
    });
    const rival = balanceCreature({
      id: 'rival',
      name: 'Rival',
      team: 'team-2',
      maxHp: 72,
      hp: 72,
      ac: 15,
      attackBonus: 5,
      damageDice: '1d8+3'
    });

    const balance = estimateEncounterBalance([hero, rival]);

    expect(balance.leader).toBe('even');
    expect(balance.ratio).toBe(1);
  });

  it('includes additional numbered teams in balance summaries', () => {
    const thirdTeam = balanceCreature({
      id: 'third-team',
      name: 'Third Team',
      team: 'team-3',
      maxHp: 72,
      hp: 72,
      ac: 15,
      attackBonus: 5,
      damageDice: '1d8+3'
    });

    const balance = estimateEncounterBalance([thirdTeam]);

    expect(balance.teams['team-3'].count).toBe(1);
    expect(balance.message).toContain('Team 3');
  });
});

function balanceCreature({
  id,
  name,
  team,
  hp,
  maxHp,
  ac,
  attackBonus,
  damageDice
}: {
  id: string;
  name: string;
  team: Creature['team'];
  hp: number;
  maxHp: number;
  ac: number;
  attackBonus: number;
  damageDice: string;
}): Creature {
  return {
    id,
    name,
    team,
    hp,
    maxHp,
    ac,
    abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    proficiencyBonus: 2,
    speed: 30,
    position: { x: 0, y: 0, z: 0 },
    conditions: [],
    actions: [
      {
        id: `${id}-strike`,
        name: 'Strike',
        kind: 'meleeAttack',
        actionCost: 'action',
        tags: ['attack', 'melee'],
        range: 1,
        attackBonus,
        damage: { dice: damageDice },
        effects: []
      }
    ],
    resources: [],
    features: []
  };
}
