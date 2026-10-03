import { acceptCommand, commandSuggestions } from '../commands';

test('a slash opens the complete agent command palette', () => {
  expect(commandSuggestions('/').map((item) => item.command)).toEqual([
    '/tardy', '/status', '/new-worktree', '/reset-session', '/stop', '/resume',
  ]);
});

test('commands filter until whitespace closes the palette', () => {
  expect(commandSuggestions('/ta').map((item) => item.command)).toEqual(['/tardy']);
  expect(commandSuggestions('/tardy now')).toEqual([]);
  expect(commandSuggestions('please /tardy')).toEqual([]);
});

test('accepting a command closes autocomplete without sending it', () => {
  expect(acceptCommand('/tardy')).toBe('/tardy ');
});
