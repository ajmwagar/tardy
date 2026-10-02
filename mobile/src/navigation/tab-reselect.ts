type Listener = () => void;

const listeners = new Map<string, Set<Listener>>();

export function emitTabReselect(route: string) {
  listeners.get(route)?.forEach((listener) => listener());
}

export function onTabReselect(route: string, listener: Listener) {
  const routeListeners = listeners.get(route) ?? new Set<Listener>();
  routeListeners.add(listener);
  listeners.set(route, routeListeners);
  return () => {
    routeListeners.delete(listener);
    if (routeListeners.size === 0) listeners.delete(route);
  };
}
