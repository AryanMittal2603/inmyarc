import { useCallback, useEffect, useState } from 'react';
import { SetupNotice } from '../components/SetupNotice';
import { ButtonLink, PageMessage, SignInCard } from '../components/SignInCard';
import { Button, cx } from '../components/ui';
import { useSession } from '../hooks/useSession';
import { api, errorText, isSignedOut } from '../lib/api';
import { APP } from '../lib/config';
import type { AdminOverview } from '../lib/types';
import { EmployeesTab } from './admin/Employees';
import { ManagersTab } from './admin/Managers';
import { OverviewTab } from './admin/Overview';
import { SettingsTab } from './admin/Settings';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'managers', label: 'Managers' },
  { key: 'employees', label: 'Employees' },
  { key: 'settings', label: 'Settings' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

function tabFromHash(): TabKey {
  const hash = window.location.hash.replace('#', '');
  return (TABS.find((t) => t.key === hash)?.key ?? 'overview') as TabKey;
}

/** /admin: the super admin creates managers, assigns people, and sees every team at once. */
export function SuperAdmin() {
  const session = useSession();

  useEffect(() => {
    document.title = `Super admin — ${APP.org}`;
  }, []);

  if (session.loading) return <div className="min-h-screen" aria-busy="true" />;
  if (session.needsSetup) {
    return (
      <div className="mx-auto flex min-h-screen max-w-[760px] flex-col justify-center px-5 py-10">
        <SetupNotice />
      </div>
    );
  }
  if (session.error) {
    return (
      <PageMessage title="Couldn’t check your sign-in" action={<Button onClick={() => void session.refresh()}>Try again</Button>}>
        {session.error}
      </PageMessage>
    );
  }
  if (!session.adminConfigured) {
    return (
      <PageMessage title="The super admin password isn’t set" action={<ButtonLink href="/">Back to teams</ButtonLink>}>
        In the Vercel project, open <b>Settings → Environment Variables</b>, add <b>ADMIN_PASSCODE</b> with the password you want, and redeploy. Then sign in
        here.
      </PageMessage>
    );
  }
  if (!session.admin) {
    return (
      <SignInCard
        area="Super admin"
        title="Super admin"
        username="super-admin"
        description="Create managers, put people on their teams, and see every team in one place. You’ll enter the password each time you open this page."
        onSubmit={session.signInAdmin}
        footer={
          <a href="/" className="focus-ring rounded-xs underline-offset-2 hover:text-ink hover:underline">
            Back to teams
          </a>
        }
      />
    );
  }
  return <Dashboard onSignOut={() => void session.signOut()} onSignedOut={() => void session.refresh()} />;
}

function Dashboard({ onSignOut, onSignedOut }: { onSignOut: () => void; onSignedOut: () => void }) {
  const [tab, setTab] = useState<TabKey>(tabFromHash);
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const pick = (key: TabKey) => {
    setTab(key);
    window.history.replaceState(null, '', key === 'overview' ? window.location.pathname : `#${key}`);
  };

  const reload = useCallback(async () => {
    try {
      setData(await api.overview());
      setError(null);
    } catch (e) {
      if (isSignedOut(e)) onSignedOut();
      else setError(errorText(e, 'Could not load the dashboard.'));
    }
  }, [onSignedOut]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** For tabs: true when the error meant "signed out" (and the gate is coming back). */
  const handleSignedOut = useCallback(
    (e: unknown) => {
      if (!isSignedOut(e)) return false;
      onSignedOut();
      return true;
    },
    [onSignedOut],
  );

  return (
    <div className="flex min-h-screen w-full flex-col gap-6 px-5 pt-8 pb-16 sm:px-8 sm:pt-10">
      <header className="flex flex-col gap-4 border-b border-line pb-4 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-[11px] leading-none font-semibold tracking-[0.14em] text-ink-3 uppercase">
            <a href="/" className="focus-ring rounded-xs text-ink hover:underline">
              {APP.org}
            </a>
            <span className="text-line-strong">/</span>
            <span>Super admin</span>
          </div>
          <nav className="-mb-[17px] flex gap-1 overflow-x-auto" aria-label="Dashboard">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => pick(t.key)}
                aria-current={tab === t.key ? 'page' : undefined}
                className={cx(
                  'focus-ring shrink-0 border-b-2 px-3 pt-1 pb-3 text-[14px] font-semibold tracking-[-0.01em] transition-colors',
                  tab === t.key ? 'border-ink text-ink' : 'border-transparent text-ink-3 hover:text-ink',
                )}
              >
                {t.label}
                {t.key === 'managers' && data ? <span className="tnum ml-1.5 text-[12px] font-medium text-ink-4">{data.managers.length}</span> : null}
                {t.key === 'employees' && data ? (
                  <span className="tnum ml-1.5 text-[12px] font-medium text-ink-4">{data.members.filter((m) => m.active).length}</span>
                ) : null}
              </button>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <ButtonLink href="/">All teams</ButtonLink>
          <Button onClick={onSignOut}>Sign out</Button>
        </div>
      </header>

      {error && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-bad/25 bg-bad-bg px-4 py-3 text-[12.5px] font-medium text-bad">
          <span>{error}</span>
          <Button size="sm" onClick={() => void reload()}>
            Try again
          </Button>
        </div>
      )}

      {tab === 'overview' && <OverviewTab onSignedOut={onSignedOut} />}
      {tab !== 'overview' && !data && !error && <div className="h-40 animate-pulse rounded-md border border-line bg-surface" />}
      {tab === 'managers' && data && <ManagersTab data={data} reload={reload} onSignedOut={handleSignedOut} />}
      {tab === 'employees' && data && <EmployeesTab data={data} reload={reload} onSignedOut={handleSignedOut} />}
      {tab === 'settings' && data && <SettingsTab data={data} reload={reload} onSignedOut={handleSignedOut} />}

      <footer className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5 text-[11.5px] text-ink-4">
        <p>Super admin — every team, full edit access</p>
        <p className="tnum">all times {APP.timezone.replace('_', ' ')}</p>
      </footer>
    </div>
  );
}
