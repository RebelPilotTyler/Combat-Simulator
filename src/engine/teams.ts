import type { CombatState, Creature, TeamDefinition, TeamId, TeamRelationship } from './types';

export const DEFAULT_TEAM_DEFINITIONS: TeamDefinition[] = [
  { id: 'team-1', name: 'Team 1 / Players', color: '#2367d1' },
  { id: 'team-2', name: 'Team 2 / Enemies', color: '#b3261e' },
  { id: 'neutral', name: 'Neutral', color: '#666666', neutral: true }
];

const TEAM_COLORS = [
  '#2367d1',
  '#b3261e',
  '#2e7d32',
  '#8e44ad',
  '#c56a00',
  '#00838f',
  '#ad1457',
  '#5d6d20'
];

const LEGACY_TEAM_IDS: Record<string, TeamId> = {
  players: 'team-1',
  enemies: 'team-2',
  neutral: 'neutral'
};

export function normalizeTeamId(value: unknown): TeamId {
  if (typeof value !== 'string') {
    return 'neutral';
  }

  const normalized = value.trim().toLowerCase().replace(/\s+/g, '-');
  return LEGACY_TEAM_IDS[normalized] ?? (normalized || 'neutral');
}

export function normalizeTeamDefinitions(
  definitions: TeamDefinition[] | undefined,
  creatures: Pick<Creature, 'team'>[] = []
): TeamDefinition[] {
  const normalized = new Map<TeamId, TeamDefinition>();

  DEFAULT_TEAM_DEFINITIONS.forEach((team) => normalized.set(team.id, { ...team }));
  (definitions ?? []).forEach((team, index) => {
    if (!team || typeof team.id !== 'string') {
      return;
    }
    const id = normalizeTeamId(team.id);
    const fallback = normalized.get(id);
    normalized.set(id, {
      ...fallback,
      ...team,
      id,
      name: team.name?.trim() || fallback?.name || formatTeamName(id),
      color: normalizeTeamColor(team.color, fallback?.color ?? getTeamColorForIndex(index)),
      neutral: id === 'neutral' || team.neutral === true,
      ...(team.relationships ? { relationships: normalizeRelationships(team.relationships) } : {})
    });
  });

  creatures.forEach((creature) => {
    const id = normalizeTeamId(creature.team);
    if (!normalized.has(id)) {
      normalized.set(id, {
        id,
        name: formatTeamName(id),
        color: getTeamColorForIndex(normalized.size),
        neutral: id === 'neutral'
      });
    }
  });

  return [...normalized.values()];
}

export function createNextTeamDefinition(definitions: TeamDefinition[]): TeamDefinition {
  const existingIds = new Set(normalizeTeamDefinitions(definitions).map((team) => team.id));
  let number = 1;
  while (existingIds.has(`team-${number}`)) {
    number += 1;
  }

  return {
    id: `team-${number}`,
    name: `Team ${number}`,
    color: getTeamColorForIndex(number - 1)
  };
}

export function getTeamDefinition(state: Pick<CombatState, 'teams'>, teamId: TeamId): TeamDefinition {
  const id = normalizeTeamId(teamId);
  return normalizeTeamDefinitions(state.teams).find((team) => team.id === id) ?? {
    id,
    name: formatTeamName(id),
    color: getTeamColorForIndex(teamNumberIndex(id))
  };
}

export function getTeamLabel(state: Pick<CombatState, 'teams'>, teamId: TeamId): string {
  return getTeamDefinition(state, teamId).name;
}

export function getTeamColor(state: Pick<CombatState, 'teams'>, teamId: TeamId): string {
  return getTeamDefinition(state, teamId).color;
}

export function areAllies(
  creatureA: Pick<Creature, 'team'>,
  creatureB: Pick<Creature, 'team'>,
  state: Pick<CombatState, 'teams'>
): boolean {
  const teamA = getTeamDefinition(state, creatureA.team);
  const teamB = getTeamDefinition(state, creatureB.team);
  const relationship = getExplicitRelationship(teamA, teamB);
  return relationship ? relationship === 'allied' : teamA.id === teamB.id;
}

export function areHostile(
  creatureA: Pick<Creature, 'team'>,
  creatureB: Pick<Creature, 'team'>,
  state: Pick<CombatState, 'teams'>
): boolean {
  const teamA = getTeamDefinition(state, creatureA.team);
  const teamB = getTeamDefinition(state, creatureB.team);
  const relationship = getExplicitRelationship(teamA, teamB);
  if (relationship) {
    return relationship === 'hostile';
  }

  return teamA.id !== teamB.id && !teamA.neutral && !teamB.neutral;
}

export function darkenColor(color: string, factor = 0.68): string {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) {
    return color;
  }
  const value = Number.parseInt(match[1], 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  return `#${channels.map((channel) => Math.round(channel * factor).toString(16).padStart(2, '0')).join('')}`;
}

function getExplicitRelationship(teamA: TeamDefinition, teamB: TeamDefinition): TeamRelationship | undefined {
  return teamA.relationships?.[teamB.id] ?? teamB.relationships?.[teamA.id];
}

function normalizeRelationships(relationships: Partial<Record<TeamId, TeamRelationship>>): Partial<Record<TeamId, TeamRelationship>> {
  return Object.fromEntries(
    Object.entries(relationships)
      .filter((entry): entry is [string, TeamRelationship] => ['allied', 'hostile', 'neutral'].includes(entry[1] ?? ''))
      .map(([id, relationship]) => [normalizeTeamId(id), relationship])
  );
}

function normalizeTeamColor(value: string | undefined, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim().toLowerCase() : fallback;
}

function getTeamColorForIndex(index: number): string {
  return TEAM_COLORS[Math.max(0, index) % TEAM_COLORS.length];
}

function teamNumberIndex(id: TeamId): number {
  const match = /^team-(\d+)$/.exec(id);
  return match ? Math.max(0, Number(match[1]) - 1) : 0;
}

function formatTeamName(id: TeamId): string {
  const numbered = /^team-(\d+)$/.exec(id);
  if (numbered) {
    return `Team ${numbered[1]}`;
  }
  return id
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'Neutral';
}
