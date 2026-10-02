export type AgentCommand = { command: string; title: string; detail: string };

export const AGENT_COMMANDS: readonly AgentCommand[] = [
  { command: '/tardy', title: 'Make a Tardy', detail: 'Post the latest completed result privately' },
  { command: '/status', title: 'Status', detail: 'Show the agent host and current session state' },
  { command: '/new-worktree', title: 'New worktree', detail: 'Start the next activation in an isolated worktree' },
  { command: '/reset-session', title: 'Reset session', detail: 'Forget this chat’s current coding session' },
  { command: '/stop', title: 'Stop', detail: 'Pause agent work in this conversation' },
  { command: '/resume', title: 'Resume', detail: 'Resume agent work in this conversation' },
] as const;

export function commandSuggestions(draft: string): readonly AgentCommand[] {
  if (!draft.startsWith('/') || /\s/.test(draft)) return [];
  const query = draft.toLowerCase();
  return AGENT_COMMANDS.filter((item) => item.command.startsWith(query));
}

export function acceptCommand(command: string): string {
  return `${command} `;
}
