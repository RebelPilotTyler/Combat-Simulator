import { describe, expect, it } from 'vitest';
import { canStartBotTurn, shouldAutoRunBotTurn, shouldRunBotTurnShortcut, shouldStopAutoRunAfterBotAction } from './botTurnControls';

describe('bot turn controls', () => {
  it('allows a manual bot turn when the active combat creature is bot-controlled', () => {
    expect(canStartBotTurn({ activeView: 'combat', activeCreatureControlMode: 'bot', isRunning: false })).toBe(true);
  });

  it('allows auto-run only when enabled and the active creature is a bot', () => {
    expect(shouldAutoRunBotTurn({ activeView: 'combat', activeCreatureControlMode: 'bot', autoRunEnabled: true })).toBe(true);
    expect(shouldAutoRunBotTurn({ activeView: 'combat', activeCreatureControlMode: 'manual', autoRunEnabled: true })).toBe(false);
    expect(shouldAutoRunBotTurn({ activeView: 'combat', activeCreatureControlMode: 'bot', autoRunEnabled: false })).toBe(false);
  });

  it('prevents double-running bot turns while a sequence is already active', () => {
    expect(canStartBotTurn({ activeView: 'combat', activeCreatureControlMode: 'bot', isRunning: true })).toBe(false);
    expect(shouldAutoRunBotTurn({ activeView: 'combat', activeCreatureControlMode: 'bot', autoRunEnabled: true, isRunning: true })).toBe(false);
  });

  it('uses B as the bot turn shortcut only when appropriate', () => {
    expect(shouldRunBotTurnShortcut('b', {
      activeView: 'combat',
      activeCreatureControlMode: 'bot',
      shortcutsEnabled: true
    })).toBe(true);
    expect(shouldRunBotTurnShortcut('b', {
      activeView: 'combat',
      activeCreatureControlMode: 'manual',
      shortcutsEnabled: true
    })).toBe(false);
    expect(shouldRunBotTurnShortcut('b', {
      activeView: 'combat',
      activeCreatureControlMode: 'bot',
      shortcutsEnabled: false
    })).toBe(false);
    expect(shouldRunBotTurnShortcut('b', {
      activeView: 'combat',
      activeCreatureControlMode: 'bot',
      shortcutsEnabled: true
    }, true)).toBe(false);
    expect(shouldRunBotTurnShortcut('m', {
      activeView: 'combat',
      activeCreatureControlMode: 'bot',
      shortcutsEnabled: true
    })).toBe(false);
  });

  it('stops auto-run after bot actions that could only wait or dodge', () => {
    expect(shouldStopAutoRunAfterBotAction(['Skeleton bot chooses Shortsword against Cleric.'])).toBe(false);
    expect(shouldStopAutoRunAfterBotAction(['Skeleton bot found no valid action and waits.'])).toBe(true);
    expect(shouldStopAutoRunAfterBotAction(['Skeleton bot found no good target and Dodges.'])).toBe(true);
    expect(shouldStopAutoRunAfterBotAction(['Skeleton bot waits. Passive/Test Dummy profile takes no action.'])).toBe(true);
  });
});
