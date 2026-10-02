import { emitTabReselect, onTabReselect } from '../tab-reselect';

describe('tab reselect events', () => {
  it('notifies only the selected route and unsubscribes cleanly', () => {
    const home = jest.fn();
    const reels = jest.fn();
    const offHome = onTabReselect('index', home);
    const offReels = onTabReselect('reels', reels);
    emitTabReselect('index');
    expect(home).toHaveBeenCalledTimes(1);
    expect(reels).not.toHaveBeenCalled();
    offHome();
    offReels();
    emitTabReselect('index');
    expect(home).toHaveBeenCalledTimes(1);
  });
});
