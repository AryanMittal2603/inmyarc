import { useMemo, useState } from 'react';
import { Badge, Button, FieldLabel, Input, Modal, cx } from '../../components/ui';
import { useToast } from '../../context/toast';
import { api, errorText } from '../../lib/api';
import { displayLink, links, slugify } from '../../lib/routes';
import type { AdminManager, AdminOverview } from '../../lib/types';
import { ConfirmModal, CopyButton, DetailLine, Panel, PasswordField, copyText } from './shared';

interface Props {
  data: AdminOverview;
  reload: () => Promise<void>;
  onSignedOut: (error: unknown) => boolean;
}

interface Issued {
  name: string;
  slug: string;
  password: string;
  fresh: boolean;
}

function signInDetails(i: Issued): string {
  return [
    `${i.name} — ${i.fresh ? 'new manager' : 'new password'}`,
    `Team board (everyone on the team): ${links.absolute(links.board(i.slug))}`,
    `Manager page: ${links.absolute(links.rating(i.slug))}`,
    `Password: ${i.password}`,
  ].join('\n');
}

/** Shown once after creating a manager or setting a password: the hash can't be read back. */
function IssuedDetails({ issued, onDone }: { issued: Issued; onDone: () => void }) {
  return (
    <div className="rounded-md border border-ok/30 bg-ok-bg/60 px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[13.5px] font-semibold text-ink">
            {issued.fresh ? `${issued.name} can sign in now` : `New password set for ${issued.name}`}
          </p>
          <p className="mt-0.5 text-[12.5px] text-ink-2">
            Send these to {issued.name} privately. The password isn’t shown again — you can always set a new one.
          </p>
        </div>
        <div className="flex gap-2">
          <CopyButtonWide text={signInDetails(issued)} />
          <Button size="sm" variant="ghost" onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
      <div className="mt-3 rounded-sm border border-line bg-surface px-3 py-1.5">
        <DetailLine label="Team board" value={links.absolute(links.board(issued.slug))} />
        <DetailLine label="Manager page" value={links.absolute(links.rating(issued.slug))} />
        <DetailLine label="Password" value={issued.password} />
      </div>
    </div>
  );
}

function CopyButtonWide({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      onClick={async () => {
        const ok = await copyText(text);
        setCopied(ok);
        if (ok) window.setTimeout(() => setCopied(false), 1600);
      }}
    >
      {copied ? 'Copied' : 'Copy sign-in details'}
    </Button>
  );
}

function NewManager({ taken, onCreated, onSignedOut }: { taken: Set<string>; onCreated: (issued: Issued) => Promise<void>; onSignedOut: Props['onSignedOut'] }) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const linkName = slugTouched ? slug : slugify(name);

  async function create() {
    setError(null);
    if (!name.trim()) return setError('Add the manager’s name.');
    if (!linkName) return setError('Add a link name, like “manager1”.');
    if (taken.has(linkName)) return setError(`The link name “${linkName}” is already used by another manager.`);
    if (password.length < 8) return setError('Use a password of at least 8 characters.');
    setBusy(true);
    try {
      const { manager } = await api.createManager({ name: name.trim(), slug: linkName, password });
      await onCreated({ name: manager.name, slug: manager.slug, password, fresh: true });
      setName('');
      setSlug('');
      setSlugTouched(false);
      setPassword('');
    } catch (e) {
      if (!onSignedOut(e)) setError(errorText(e, 'Could not create the manager.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Add a manager" description="Each manager gets a team board for their employees and a password-protected page to rate them.">
      <form
        className="grid gap-4 px-5 py-4 lg:grid-cols-[1fr_1fr_1.4fr_auto] lg:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <div>
          <FieldLabel htmlFor="mgr-name">Name</FieldLabel>
          <Input id="mgr-name" value={name} maxLength={60} placeholder="Asha Rao" onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </div>
        <div>
          <FieldLabel htmlFor="mgr-slug" hint={linkName ? `/task/${linkName}` : undefined}>
            Link name
          </FieldLabel>
          <Input
            id="mgr-slug"
            value={linkName}
            maxLength={40}
            placeholder="manager1"
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
            }}
            autoComplete="off"
          />
        </div>
        <div>
          <FieldLabel htmlFor="mgr-pass">Password</FieldLabel>
          <PasswordField id="mgr-pass" value={password} onChange={setPassword} />
        </div>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Creating…' : 'Create manager'}
        </Button>
      </form>
      {error && (
        <p role="alert" className="border-t border-line px-5 py-3 text-[12.5px] font-medium text-bad">
          {error}
        </p>
      )}
    </Panel>
  );
}

function EditManager({ manager, taken, onClose, onSaved }: { manager: AdminManager; taken: Set<string>; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(manager.name);
  const [slug, setSlug] = useState(manager.slug);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    if (slug !== manager.slug && taken.has(slug)) return setError(`The link name “${slug}” is already used by another manager.`);
    setBusy(true);
    try {
      await api.updateManager(manager.id, { name: name.trim(), slug });
      await onSaved();
      onClose();
    } catch (e) {
      setError(errorText(e, 'Could not save.'));
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit ${manager.name}`}
      width={480}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div data-stagger>
          <FieldLabel htmlFor="edit-mgr-name">Name</FieldLabel>
          <Input id="edit-mgr-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </div>
        <div data-stagger>
          <FieldLabel htmlFor="edit-mgr-slug" hint={`/task/${slug || '…'}`}>
            Link name
          </FieldLabel>
          <Input id="edit-mgr-slug" value={slug} maxLength={40} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} />
          {slug !== manager.slug && (
            <p className="mt-1.5 text-[12px] text-wait">Old links stop working. Share the new board and manager links with the team.</p>
          )}
        </div>
        {error && (
          <p role="alert" className="text-[12.5px] font-medium text-bad">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

function NewPassword({ manager, onClose, onSet }: { manager: AdminManager; onClose: () => void; onSet: (issued: Issued) => Promise<void> }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    if (password.length < 8) return setError('Use a password of at least 8 characters.');
    setBusy(true);
    try {
      await api.updateManager(manager.id, { password });
      await onSet({ name: manager.name, slug: manager.slug, password, fresh: false });
      onClose();
    } catch (e) {
      setError(errorText(e, 'Could not set the password.'));
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`New password for ${manager.name}`}
      subtitle="They’re signed out everywhere and sign in again with this one."
      width={500}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : 'Set password'}
          </Button>
        </>
      }
    >
      <div data-stagger>
        <FieldLabel htmlFor="new-pass">Password</FieldLabel>
        <PasswordField id="new-pass" value={password} onChange={setPassword} />
      </div>
      {error && (
        <p role="alert" className="mt-3 text-[12.5px] font-medium text-bad">
          {error}
        </p>
      )}
    </Modal>
  );
}

export function ManagersTab({ data, reload, onSignedOut }: Props) {
  const toast = useToast();
  const [issued, setIssued] = useState<Issued | null>(null);
  const [editing, setEditing] = useState<AdminManager | null>(null);
  const [resetting, setResetting] = useState<AdminManager | null>(null);
  const [deleting, setDeleting] = useState<AdminManager | null>(null);
  const taken = useMemo(() => new Set(data.managers.map((m) => m.slug)), [data.managers]);
  const unassigned = data.members.filter((m) => m.active && !m.manager_id).length;

  const toggle = async (m: AdminManager) => {
    try {
      await api.updateManager(m.id, { active: !m.active });
      await reload();
      toast(m.active ? `${m.name}’s team is switched off.` : `${m.name}’s team is back on.`);
    } catch (e) {
      if (!onSignedOut(e)) toast(errorText(e, 'Could not change that.'), 'error');
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {issued && <IssuedDetails issued={issued} onDone={() => setIssued(null)} />}

      <NewManager
        taken={taken}
        onSignedOut={onSignedOut}
        onCreated={async (i) => {
          setIssued(i);
          await reload();
          toast('Manager created.');
        }}
      />

      <Panel
        title="Managers"
        description={
          data.managers.length
            ? `${data.managers.length} manager${data.managers.length === 1 ? '' : 's'}. Turning a team off hides its links and signs its manager out; its history stays.`
            : 'No managers yet. Add the first one above.'
        }
        actions={unassigned > 0 ? <Badge tone="wait">{unassigned} {unassigned === 1 ? 'employee' : 'employees'} without a team</Badge> : null}
      >
        {data.managers.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-left">
              <thead>
                <tr className="border-b border-line bg-paper text-[10.5px] font-semibold tracking-[0.1em] text-ink-3 uppercase">
                  <th className="px-5 py-2.5">Manager</th>
                  <th className="px-3 py-2.5">Employees</th>
                  <th className="px-3 py-2.5">Links</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-5 py-2.5 text-right">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.managers.map((m) => (
                  <tr key={m.id} className={cx('border-b border-line align-middle last:border-b-0', !m.active && 'bg-paper/70')}>
                    <td className="px-5 py-3">
                      <p className={cx('text-[13.5px] font-semibold tracking-[-0.01em]', m.active ? 'text-ink' : 'text-ink-3')}>{m.name}</p>
                      <p className="mt-0.5 font-mono text-[11.5px] text-ink-4">{m.slug}</p>
                    </td>
                    <td className="tnum px-3 py-3 text-[13px] text-ink-2">{m.members}</td>
                    <td className="px-3 py-3">
                      <div className="flex flex-col gap-0.5">
                        {[
                          { label: 'Board', path: links.board(m.slug) },
                          { label: 'Manager page', path: links.rating(m.slug) },
                        ].map((l) => (
                          <div key={l.label} className="flex min-w-0 items-center gap-1">
                            <a
                              href={l.path}
                              className={cx(
                                'focus-ring truncate rounded-xs text-[12.5px] underline-offset-2 hover:underline',
                                m.active ? 'text-ink-2 hover:text-ink' : 'pointer-events-none text-ink-4',
                              )}
                              title={l.label}
                            >
                              {displayLink(l.path)}
                            </a>
                            <CopyButton text={links.absolute(l.path)} label={`Copy ${l.label.toLowerCase()} link`} compact />
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-3">{m.active ? <Badge tone="ok" dot>Active</Badge> : <Badge tone="mute">Off</Badge>}</td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(m)}>
                          Edit
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setResetting(m)}>
                          New password
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => void toggle(m)}>
                          {m.active ? 'Turn off' : 'Turn on'}
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => setDeleting(m)}>
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {editing && (
        <EditManager
          manager={editing}
          taken={taken}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            await reload();
            toast('Saved.');
          }}
        />
      )}
      {resetting && (
        <NewPassword
          manager={resetting}
          onClose={() => setResetting(null)}
          onSet={async (i) => {
            setIssued(i);
            await reload();
            toast('Password set.');
          }}
        />
      )}
      <ConfirmModal
        open={deleting !== null}
        title={deleting ? `Delete ${deleting.name}?` : 'Delete manager'}
        confirmLabel="Delete manager"
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          await api.deleteManager(deleting.id);
          await reload();
          toast(`${deleting.name} deleted.`);
        }}
      >
        {deleting && (
          <>
            Their links stop working and they can’t sign in.{' '}
            {deleting.members > 0
              ? `Their ${deleting.members} ${deleting.members === 1 ? 'employee keeps' : 'employees keep'} all their history and move to “No team” until you assign them again.`
              : 'No one is on their team.'}{' '}
            To keep the team but pause it, use <b>Turn off</b> instead.
          </>
        )}
      </ConfirmModal>
    </div>
  );
}
