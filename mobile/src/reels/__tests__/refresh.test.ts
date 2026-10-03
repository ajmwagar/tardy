import type { Post } from '@/data/types';

import { freshReelOrder } from '../refresh';

const post = (id: string) => ({ id }) as Post;

describe('freshReelOrder', () => {
  it('moves the previously visible reel behind fresh choices', () => {
    expect(freshReelOrder([post('a'), post('b'), post('c')], 'a').map((item) => item.id)).toEqual(['b', 'c', 'a']);
  });

  it('preserves server order when it already starts fresh', () => {
    expect(freshReelOrder([post('a'), post('b')], 'z').map((item) => item.id)).toEqual(['a', 'b']);
  });
});
