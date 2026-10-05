import type { AgentRuntime } from '@/data/types';

/** Never let a dev pairing silently fall through to the CLI's production default. */
export function agentConnectCommand(input: {
  apiUrl: string | null;
  code: string;
  handle: string;
  name: string;
  runtime: AgentRuntime;
}): string {
  if (!input.apiUrl) return 'This preview uses mock data. Connect to a real Tardy server before pairing an agent.';
  const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
  return `npx --yes github:ajmwagar/tardy connect --api ${quote(input.apiUrl)} --code ${quote(input.code)} --handle ${quote(input.handle)} --name ${quote(input.name)} --runtime ${quote(input.runtime)}`;
}
