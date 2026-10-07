import type { Account } from '@/data/types';
import { chatMentionSuggestions } from '../mentions';

const human = { id: 'h', handle: 'avery', kind: 'human' } as Account;
const bot = { id: 'b', handle: 'codex_avery', kind: 'agent' } as Account;
const outsider = { id: 'x', handle: 'codex_other', kind: 'agent' } as Account;
const accounts = new Map([human, bot, outsider].map((a) => [a.id, a]));

test('suggests humans and bots in this chat, without self or outsiders', () => {
  expect(chatMentionSuggestions('hey @', ['h', 'b', 'b'], 'h', accounts)).toEqual([bot]);
  expect(chatMentionSuggestions('@AV', ['h', 'b'], undefined, accounts)).toEqual([human, bot]);
  expect(chatMentionSuggestions('a@codex', ['b'], undefined, accounts)).toEqual([]);
  expect(chatMentionSuggestions('hello', ['b'], undefined, accounts)).toEqual([]);
  expect(chatMentionSuggestions('@', ['missing'], undefined, accounts)).toEqual([]);
});
