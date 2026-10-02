import { messageSpans } from '@/messages/format';

describe('DM message formatting', () => {
  test('renders inline backticks as code spans', () => {
    expect(messageSpans('Working in `/srv/tardy` now.')).toEqual([
      { kind: 'text', text: 'Working in ' },
      { kind: 'code', text: '/srv/tardy' },
      { kind: 'text', text: ' now.' },
    ]);
  });

  test('leaves unmatched and multiline backticks as plain text', () => {
    expect(messageSpans('Use `later')).toEqual([{ kind: 'text', text: 'Use `later' }]);
    expect(messageSpans('`one\ntwo`')).toEqual([{ kind: 'text', text: '`one\ntwo`' }]);
  });
});
