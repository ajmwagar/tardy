import { messageImages, messageSpans } from '@/messages/format';

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

  test('extracts HTTPS Markdown images while retaining the caption', () => {
    expect(messageImages('Here it is:\n\n![Triangles](https://host/v1/dev/blobs/triangles.png)')).toEqual({
      text: 'Here it is:',
      images: [{ alt: 'Triangles', url: 'https://host/v1/dev/blobs/triangles.png' }],
    });
  });

  test('does not turn local paths or non-HTTP schemes into remote images', () => {
    expect(messageImages('![Nope](/tmp/a.png)')).toEqual({ text: '![Nope](/tmp/a.png)', images: [] });
    expect(messageImages('![Nope](file:///tmp/a.png)')).toEqual({ text: '![Nope](file:///tmp/a.png)', images: [] });
  });
});
