// Navigation par ancre (#/classement…). La démo garde la navigation en mémoire.

export type Route =
  | { name: 'counter' }
  | { name: 'ranking' }
  | { name: 'history'; episodeId: string | null }
  | { name: 'stats' }
  | { name: 'more' }
  | { name: 'rules' }
  | { name: 'account' }
  | { name: 'admin' }
  | { name: 'install' }
  | { name: 'login' }
  | { name: 'invite'; token: string }
  | { name: 'spectator'; token: string };

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const [head, arg] = parts;
  switch (head) {
    case 'classement':
      return { name: 'ranking' };
    case 'historique':
      return { name: 'history', episodeId: arg ?? null };
    case 'stats':
      return { name: 'stats' };
    case 'plus':
      return { name: 'more' };
    case 'regles':
      return { name: 'rules' };
    case 'compte':
      return { name: 'account' };
    case 'admin':
      return { name: 'admin' };
    case 'installer':
      return { name: 'install' };
    case 'connexion':
      return { name: 'login' };
    case 'invitation':
      return arg ? { name: 'invite', token: arg } : { name: 'counter' };
    case 'spectateur':
      return arg ? { name: 'spectator', token: arg } : { name: 'counter' };
    default:
      return { name: 'counter' };
  }
}

export function routePath(route: Route): string {
  switch (route.name) {
    case 'counter':
      return '#/';
    case 'ranking':
      return '#/classement';
    case 'history':
      return route.episodeId ? `#/historique/${encodeURIComponent(route.episodeId)}` : '#/historique';
    case 'stats':
      return '#/stats';
    case 'more':
      return '#/plus';
    case 'rules':
      return '#/regles';
    case 'account':
      return '#/compte';
    case 'admin':
      return '#/admin';
    case 'install':
      return '#/installer';
    case 'login':
      return '#/connexion';
    case 'invite':
      return `#/invitation/${encodeURIComponent(route.token)}`;
    case 'spectator':
      return `#/spectateur/${encodeURIComponent(route.token)}`;
  }
}

class Router {
  route = $state<Route>(__DEMO__ ? { name: 'counter' } : parseRoute(location.hash));

  constructor() {
    if (!__DEMO__) {
      window.addEventListener('hashchange', () => {
        this.route = parseRoute(location.hash);
      });
    }
  }

  go(route: Route, replace = false): void {
    if (__DEMO__) {
      this.route = route;
      return;
    }
    const path = routePath(route);
    if (replace) {
      history.replaceState(null, '', path);
      this.route = route;
    } else if (location.hash !== path) {
      location.hash = path;
    } else {
      this.route = route;
    }
  }
}

export const router = new Router();
