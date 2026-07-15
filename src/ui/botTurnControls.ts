export interface BotTurnControlContext {
  activeView: 'combat' | string;
  activeCreatureControlMode?: 'manual' | 'bot' | string;
  autoRunEnabled?: boolean;
  isRunning?: boolean;
  shortcutsEnabled?: boolean;
}

export function canStartBotTurn(context: BotTurnControlContext): boolean {
  return context.activeView === 'combat' && context.activeCreatureControlMode === 'bot' && !context.isRunning;
}

export function shouldAutoRunBotTurn(context: BotTurnControlContext): boolean {
  return Boolean(context.autoRunEnabled && canStartBotTurn(context));
}

export function shouldRunBotTurnShortcut(
  key: string,
  context: BotTurnControlContext,
  isTypingTarget = false
): boolean {
  return key.toLowerCase() === 'b' && Boolean(context.shortcutsEnabled) && !isTypingTarget && canStartBotTurn(context);
}

export function shouldStopAutoRunAfterBotAction(messages: string[]): boolean {
  return messages.some((message) =>
    message.includes('bot waits') ||
    message.includes('found no valid action') ||
    message.includes('found no good target') ||
    message.includes('Passive/Test Dummy')
  );
}
