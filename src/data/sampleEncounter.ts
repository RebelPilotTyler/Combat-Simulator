import { createCombatState } from '../engine/combat';
import type { ActionDefinition, CombatState, Creature } from '../engine/types';

const trainingBlade: ActionDefinition = {
  id: 'training-blade',
  name: 'Training Blade',
  kind: 'meleeAttack',
  type: 'meleeAttack',
  actionCost: 'action',
  tags: ['attack', 'melee'],
  range: 1,
  reach: 5,
  attackBonus: 5,
  damage: { dice: '1d8+3', type: 'slashing' },
  shape: { type: 'single' },
  effects: [],
  description: 'A simple melee weapon attack.'
};

const offhandStrike: ActionDefinition = {
  id: 'offhand-strike',
  name: 'Offhand Strike',
  kind: 'meleeAttack',
  type: 'meleeAttack',
  actionCost: 'bonusAction',
  tags: ['attack', 'melee', 'bonus'],
  range: 1,
  reach: 5,
  attackBonus: 5,
  damage: { dice: '1d6', type: 'slashing' },
  shape: { type: 'single' },
  effects: [],
  description: 'A simple bonus action melee attack.'
};

const quickStep: ActionDefinition = {
  id: 'quick-step',
  name: 'Quick Step',
  kind: 'custom',
  actionCost: 'bonusAction',
  tags: ['movement', 'bonus'],
  range: 0,
  normalRange: 10,
  effects: [],
  description: 'Gain 10 feet of extra movement without spending normal movement.'
};

const reactiveStrike: ActionDefinition = {
  id: 'reactive-strike',
  name: 'Reactive Strike',
  kind: 'meleeAttack',
  type: 'meleeAttack',
  actionCost: 'reaction',
  tags: ['attack', 'melee', 'reaction', 'opportunity'],
  range: 1,
  reach: 5,
  attackBonus: 4,
  damage: { dice: '1d8+2', type: 'bludgeoning' },
  shape: { type: 'single' },
  effects: [],
  description: 'A reaction melee attack for opportunity attacks.'
};

const sparkBolt: ActionDefinition = {
  id: 'spark-bolt',
  name: 'Spark Bolt',
  kind: 'spell',
  type: 'rangedAttack',
  actionCost: 'action',
  tags: ['attack', 'spell', 'ranged'],
  range: 6,
  normalRange: 30,
  longRange: 120,
  attackBonus: 4,
  damage: { dice: '1d10+2', type: 'lightning' },
  shape: { type: 'single' },
  effects: [],
  description: 'A simple ranged spell attack.'
};

const cracklingPulse: ActionDefinition = {
  id: 'crackling-pulse',
  name: 'Crackling Pulse',
  kind: 'spell',
  type: 'savingThrowEffect',
  actionCost: 'action',
  tags: ['spell', 'area'],
  range: 6,
  damage: { dice: '2d6', type: 'lightning' },
  save: { ability: 'dex', dc: 13, halfDamageOnSuccess: true },
  shape: { type: 'radius', radius: 1 },
  effects: [
    {
      id: 'crackling-pulse-damage',
      name: 'Pulse Damage',
      type: 'damage',
      damage: { dice: '2d6', type: 'lightning' },
      save: { ability: 'dex', dc: 13, halfDamageOnSuccess: true }
    }
  ],
  description: 'A small area spell effect that calls for a Dexterity save.'
};

const heavyClub: ActionDefinition = {
  id: 'heavy-club',
  name: 'Moldy Maul',
  kind: 'meleeAttack',
  type: 'meleeAttack',
  actionCost: 'action',
  tags: ['attack', 'melee'],
  range: 1,
  reach: 5,
  attackBonus: 4,
  damage: { dice: '1d10+2', type: 'bludgeoning' },
  shape: { type: 'single' },
  effects: [],
  description: 'A heavy melee attack.'
};

const thornDart: ActionDefinition = {
  id: 'thorn-dart',
  name: 'Thorn Dart',
  kind: 'rangedAttack',
  type: 'rangedAttack',
  actionCost: 'action',
  tags: ['attack', 'ranged'],
  range: 5,
  normalRange: 25,
  longRange: 100,
  attackBonus: 4,
  damage: { dice: '1d6+2', type: 'piercing' },
  shape: { type: 'single' },
  effects: [],
  description: 'A simple ranged attack.'
};

const rotcapMultiattack: ActionDefinition = {
  id: 'rotcap-multiattack',
  name: 'Rotcap Multiattack',
  kind: 'multiattack',
  actionCost: 'action',
  tags: ['attack', 'melee'],
  range: 1,
  effects: [],
  description: 'Make two Moldy Maul attacks against the same target.',
  multiattack: {
    targetMode: 'sameTarget',
    steps: [
      { id: 'maul-1', name: 'Moldy Maul 1', actionId: 'heavy-club' },
      { id: 'maul-2', name: 'Moldy Maul 2', actionId: 'heavy-club' }
    ]
  }
};

export const sampleCreatures: Creature[] = [
  {
    id: 'hero-guard',
    name: 'Hero Guard',
    team: 'players',
    hp: 24,
    maxHp: 24,
    ac: 16,
    abilityScores: { str: 16, dex: 12, con: 14, int: 10, wis: 11, cha: 10 },
    proficiencyBonus: 2,
    speed: 30,
    position: { x: 2, y: 4 },
    conditions: [],
    actions: [trainingBlade, offhandStrike],
    resources: [
      {
        id: 'rage-uses',
        name: 'Rage Uses',
        current: 2,
        max: 2,
        resetOn: 'longRest',
        display: { showOnCreaturePanel: true, mode: 'pips' }
      }
    ],
    features: [
      {
        id: 'shield-training',
        name: 'Shield Training',
        description: '+1 AC from defensive training.',
        enabled: true,
        source: 'sample',
        modifiers: { ac: 1 }
      }
    ],
    skillBonuses: { athletics: 5 }
  },
  {
    id: 'ember-apprentice',
    name: 'Ember Apprentice',
    team: 'players',
    hp: 17,
    maxHp: 17,
    ac: 13,
    abilityScores: { str: 8, dex: 14, con: 12, int: 15, wis: 12, cha: 10 },
    proficiencyBonus: 2,
    speed: 30,
    position: { x: 2, y: 6 },
    conditions: [],
    actions: [
      {
        ...sparkBolt,
        resourceCosts: [{ resourceId: 'spell-slot-1', amount: 1, consumeOn: 'use' }]
      },
      {
        ...cracklingPulse,
        resourceCosts: [{ resourceId: 'spell-slot-1', amount: 1, consumeOn: 'use' }]
      },
      quickStep
    ],
    resources: [
      {
        id: 'spell-slot-1',
        name: 'Spell Slots L1',
        current: 2,
        max: 2,
        resetOn: 'longRest',
        display: { showOnCreaturePanel: true, mode: 'pips' }
      },
      {
        id: 'sorcery',
        name: 'Sorcery Points',
        current: 2,
        max: 2,
        resetOn: 'longRest',
        display: { showOnCreaturePanel: true, mode: 'number' }
      }
    ],
    features: [
      {
        id: 'quickened-spell',
        name: 'Quickened Spell Placeholder',
        description: 'Spend 2 sorcery points to use a placeholder bonus-action spell option.',
        enabled: true,
        source: 'sample',
        alternateActions: [
          {
            id: 'quickened-spell-placeholder',
            name: 'Quickened Spell: Spark Bolt',
            baseActionName: 'Cast a Spell',
            actionCost: 'bonusAction',
            tags: ['spell', 'bonus', 'placeholder'],
            resourceCosts: [{ resourceId: 'sorcery', amount: 2, consumeOn: 'use' }],
            description: 'Placeholder bonus-action spell conversion.'
          }
        ]
      }
    ],
    skillBonuses: { stealth: 4, investigation: 4 }
  },
  {
    id: 'training-brute',
    name: 'Training Brute',
    team: 'enemies',
    hp: 30,
    maxHp: 30,
    ac: 13,
    abilityScores: { str: 15, dex: 10, con: 15, int: 8, wis: 10, cha: 8 },
    proficiencyBonus: 2,
    speed: 30,
    position: { x: 7, y: 4 },
    conditions: [],
    actions: [
      heavyClub,
      rotcapMultiattack,
      reactiveStrike,
      {
        id: 'once-per-day-slam',
        name: '1/Day Crushing Slam',
        kind: 'meleeAttack',
        type: 'meleeAttack',
        actionCost: 'action',
        tags: ['attack', 'melee'],
        range: 1,
        reach: 5,
        attackBonus: 5,
        damage: { dice: '2d10+2', type: 'bludgeoning' },
        shape: { type: 'single' },
        effects: [],
        resourceCosts: [{ resourceId: 'crushing-slam', amount: 1, consumeOn: 'use' }],
        description: 'A limited-use heavy attack.'
      }
    ],
    resources: [
      {
        id: 'crushing-slam',
        name: 'Crushing Slam',
        current: 1,
        max: 1,
        resetOn: 'longRest',
        display: { showOnCreaturePanel: true, mode: 'pips' }
      },
      {
        id: 'legendary-resistance',
        name: 'Legendary Resistance',
        current: 3,
        max: 3,
        resetOn: 'longRest',
        display: { showOnCreaturePanel: true, mode: 'pips' }
      }
    ],
    skillBonuses: { athletics: 4 }
  },
  {
    id: 'target-skirmisher',
    name: 'Target Skirmisher',
    team: 'enemies',
    hp: 18,
    maxHp: 18,
    ac: 14,
    abilityScores: { str: 10, dex: 15, con: 12, int: 10, wis: 11, cha: 9 },
    proficiencyBonus: 2,
    speed: 30,
    position: { x: 8, y: 6 },
    conditions: [],
    actions: [thornDart, quickStep],
    resources: [
      {
        id: 'ki',
        name: 'Ki Points',
        current: 3,
        max: 3,
        resetOn: 'shortRest',
        display: { showOnCreaturePanel: true, mode: 'number' }
      }
    ],
    features: [
      {
        id: 'cunning-action',
        name: 'Cunning Action',
        description: 'Dash, Disengage, and Hide can be used as bonus actions.',
        enabled: true,
        source: 'sample',
        alternateActions: [
          {
            id: 'cunning-action-dash',
            name: 'Cunning Action: Dash',
            baseActionName: 'Dash',
            actionCost: 'bonusAction',
            tags: ['movement', 'bonus'],
            description: 'Dash as a bonus action.'
          },
          {
            id: 'cunning-action-disengage',
            name: 'Cunning Action: Disengage',
            baseActionName: 'Disengage',
            actionCost: 'bonusAction',
            tags: ['bonus'],
            description: 'Disengage as a bonus action.'
          },
          {
            id: 'cunning-action-hide',
            name: 'Cunning Action: Hide',
            baseActionName: 'Hide',
            actionCost: 'bonusAction',
            tags: ['bonus'],
            description: 'Hide as a bonus action.'
          }
        ]
      },
      {
        id: 'fleet-footed',
        name: 'Fleet Footed',
        description: '+10 ft speed.',
        enabled: true,
        source: 'sample',
        modifiers: { speed: 10 }
      }
    ],
    skillBonuses: { acrobatics: 4, stealth: 4 }
  }
];

export function createSampleEncounter(): CombatState {
  return createCombatState(sampleCreatures, 10, 10, [
    { x: 5, y: 4 },
    { x: 5, y: 5 },
    { x: 5, y: 6 }
  ]);
}
