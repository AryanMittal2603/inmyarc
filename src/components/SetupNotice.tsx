import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import type { SetupStatus } from '../lib/types';

function Code({ children }: { children: ReactNode }) {
  return <code className="rounded-xs bg-mute-bg px-1 py-0.5 font-mono text-[11.5px] text-ink">{children}</code>;
}

/** Shown on the board until the Vercel project has a database (the original showed its Supabase key steps here). */
export function SetupNotice() {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  useEffect(() => {
    api.setup().then(setStatus, () => setStatus(null));
  }, []);

  const steps: Array<{ title: string; done?: boolean; body: ReactNode }> = [
    {
      title: 'Add the database',
      done: status?.database,
      body: (
        <>
          In the Vercel project open <b>Storage</b> → <b>Create Database</b> → <b>Neon</b> (Postgres) and connect it to this project. Vercel adds{' '}
          <Code>DATABASE_URL</Code> for you. The tables are created on first use.
        </>
      ),
    },
    {
      title: 'Add file storage',
      done: status?.files,
      body: (
        <>
          <b>Storage</b> → <b>Create</b> → <b>Blob</b>, set access to <b>Private</b>, and connect it. This adds <Code>BLOB_READ_WRITE_TOKEN</Code> for task
          attachments (one file each, up to 10 MB).
        </>
      ),
    },
    {
      title: 'Set the super admin password',
      done: status?.admin,
      body: (
        <>
          <b>Settings</b> → <b>Environment Variables</b> → add <Code>ADMIN_PASSCODE</Code>. It signs you in at <Code>/admin</Code>, where you create
          managers and their teams.
        </>
      ),
    },
    {
      title: 'Redeploy, then create the teams',
      done: (status?.managers ?? 0) > 0,
      body: (
        <>
          Redeploy so the new variables load. Then sign in at <Code>/admin</Code>, add each manager with a link name and password, and add their
          employees (or import them from the old project). Every team gets <Code>/task/&lt;name&gt;</Code> and <Code>/rating/&lt;name&gt;</Code>.
        </>
      ),
    },
  ];

  return (
    <section className="rounded-md border border-line bg-surface">
      <header className="border-b border-line px-5 py-4">
        <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-ink">A few steps left</h2>
        <p className="mt-0.5 text-[12.5px] text-ink-3">The app is deployed. It needs a database on Vercel to talk to.</p>
      </header>
      <ol className="divide-y divide-line">
        {steps.map((s, i) => (
          <li key={s.title} className="flex gap-4 px-5 py-4">
            <span
              className={`tnum mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-xs border text-[11px] font-semibold ${
                s.done ? 'border-ok/40 bg-ok-bg text-ok' : 'border-line-strong text-ink-3'
              }`}
            >
              {s.done ? '✓' : i + 1}
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-ink">{s.title}</p>
              <div className="mt-1 text-[12.5px] leading-[1.6] text-ink-2">{s.body}</div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
