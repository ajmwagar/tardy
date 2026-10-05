import { agentConnectCommand } from '../agent-connect-command';

const input = { code: 'pairing', handle: 'helper', name: 'My agent', runtime: 'tardy-host' as const };

describe('agent setup environment', () => {
  it.each(['http://100.64.0.2:3300', 'https://api.tardy.news'])('uses the app API %s explicitly', (apiUrl) => {
    expect(agentConnectCommand({ ...input, apiUrl })).toContain(`--api '${apiUrl}'`);
  });
  it('does not emit a production command for a mock pairing', () => {
    expect(agentConnectCommand({ ...input, apiUrl: null })).not.toContain('npx');
  });
  it('quotes names without shell expansion', () => {
    expect(agentConnectCommand({ ...input, apiUrl: 'http://localhost:3300', name: "Avery's $(echo nope)" })).toContain("--name 'Avery'\\''s $(echo nope)'");
  });
});
