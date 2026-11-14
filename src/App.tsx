import { Suspense, lazy, useEffect } from 'react';
import { ButtonLink, PageMessage } from './components/SignInCard';
import { ToastProvider } from './context/toast';
import { canonicalPath, routeOf } from './lib/routes';

const Home = lazy(() => import('./pages/Home').then((m) => ({ default: m.Home })));
const TeamBoard = lazy(() => import('./pages/TeamBoard').then((m) => ({ default: m.TeamBoard })));
const ManagerPage = lazy(() => import('./pages/ManagerPage').then((m) => ({ default: m.ManagerPage })));
const SuperAdmin = lazy(() => import('./pages/SuperAdmin').then((m) => ({ default: m.SuperAdmin })));

/**
 *  /                 home: every team's links
 *  /task/<team>      the team's board (open, pick your name)
 *  /rating/<team>    the team's manager rates and edits (password)
 *  /admin            super admin: managers, employees, every team at once
 */
export function App() {
  const route = routeOf(window.location.pathname);

  // Tidy the address bar (/Task/Alpha/ → /task/alpha) without reloading.
  useEffect(() => {
    const path = canonicalPath(route);
    if (path && path !== window.location.pathname) window.history.replaceState(null, '', `${path}${window.location.search}${window.location.hash}`);
  }, [route]);

  return (
    <ToastProvider>
      <Suspense fallback={<div className="min-h-screen" aria-busy="true" />}>
        {route.page === 'home' && <Home />}
        {route.page === 'team' && <TeamBoard key={route.slug} slug={route.slug} />}
        {route.page === 'manager' && <ManagerPage key={route.slug} slug={route.slug} />}
        {route.page === 'admin' && <SuperAdmin />}
      </Suspense>
      {route.page === 'missing' && (
        <PageMessage title="There’s nothing at this address" action={<ButtonLink href="/">See all teams</ButtonLink>}>
          Team boards live at <b>/task/&lt;team&gt;</b> and manager pages at <b>/rating/&lt;team&gt;</b>. Pick your team from the list.
        </PageMessage>
      )}
    </ToastProvider>
  );
}
