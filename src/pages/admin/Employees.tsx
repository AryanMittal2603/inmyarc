import { useMemo, useState } from 'react';
import { Badge, Button, FieldLabel, Input, Modal, Select, Textarea, cx } from '../../components/ui';
import { useToast } from '../../context/toast';
import { api, errorText } from '../../lib/api';
import type { AdminMember, AdminOverview } from '../../lib/types';
import { ImportPanel } from './ImportPanel';
import { ConfirmModal, Panel } from './shared';

interface Props {
  data: AdminOverview;
  reload: () => Promise<void>;
  onSignedOut: (error: unknown) => boolean;
}

/** '' = every team, 'none' = people without a team, otherwise a manager id. */
type TeamFilter = string;

function AddPeople({ data, defaultTeam, onAdded, onSignedOut }: { data: AdminOverview; defaultTeam: string; onAdded: () => Promise<void>; onSignedOut: Props['onSignedOut'] }) {
  const toast = useToast();
  const [team, setTeam] = useState(defaultTeam);
  const [names, setNames] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ added: string[]; skipped: Array<{ name: string; why: string }> } | null>(null);
  // One per line; repeats (any capitalisation) count once.
  const list = useMemo(() => {
    const seen = new Set<string>();
    return names
      .split('\n')
      .map((n) => n.trim().replace(/\s+/g, ' '))
      .filter((n) => {
        const key = n.toLowerCase();
        if (!n || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [names]);

  async function add() {
    if (list.length === 0) return;
    setBusy(true);
    setOutcome(null);
    const added: string[] = [];
    const skipped: Array<{ name: string; why: string }> = [];
    for (const name of list) {
      try {
        await api.createMember({ name, managerId: team || null });
        added.push(name);
      } catch (e) {
        if (onSignedOut(e)) break;
        skipped.push({ name, why: errorText(e, 'Could not add.') });
      }
    }
    setBusy(false);
    setOutcome({ added, skipped });
    if (added.length) {
      toast(`Added ${added.length} ${added.length === 1 ? 'employee' : 'employees'}.`);
      setNames(skipped.map((s) => s.name).join('\n'));
      await onAdded();
    }
  }

  return (
    <Panel title="Add employees" description="One name per line. They can log on their team’s board straight away.">
      <div className="grid gap-4 px-5 py-4 lg:grid-cols-[16rem_1fr_auto] lg:items-start">
        <div>
          <FieldLabel htmlFor="add-team">Team</FieldLabel>
          <Select id="add-team" value={team} onChange={(e) => setTeam(e.target.value)}>
            <option value="">No team (assign later)</option>
            {data.managers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}’s team{m.active ? '' : ' (off)'}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <FieldLabel htmlFor="add-names" hint={list.length ? `${list.length} ${list.length === 1 ? 'name' : 'names'}` : undefined}>
            Names
          </FieldLabel>
          <Textarea id="add-names" rows={3} value={names} placeholder={'Ana Mehta\nBen Thomas'} onChange={(e) => setNames(e.target.value)} />
        </div>
        <Button variant="primary" className="lg:mt-[22px]" onClick={() => void add()} disabled={busy || list.length === 0}>
          {busy ? 'Adding…' : list.length > 1 ? `Add ${list.length} employees` : 'Add employee'}
        </Button>
      </div>
      {outcome && outcome.skipped.length > 0 && (
        <div className="border-t border-line px-5 py-3 text-[12.5px]">
          <p className="font-medium text-bad">
            {outcome.skipped.length} not added{outcome.added.length ? `; ${outcome.added.length} added` : ''}:
          </p>
          <ul className="mt-1 list-disc pl-5 text-ink-2">
            {outcome.skipped.map((s) => (
              <li key={s.name}>
                {s.name} — {s.why}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

function Rename({ member, onClose, onSaved }: { member: AdminMember; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(member.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.updateMember(member.id, { name: name.trim() });
      await onSaved();
      onClose();
    } catch (e) {
      setError(errorText(e, 'Could not rename.'));
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={`Rename ${member.name}`}
      width={420}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={busy || !name.trim()}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div data-stagger>
        <FieldLabel htmlFor="rename">Name</FieldLabel>
        <Input
          id="rename"
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save();
          }}
        />
      </div>
      {error && (
        <p role="alert" className="mt-3 text-[12.5px] font-medium text-bad">
          {error}
        </p>
      )}
    </Modal>
  );
}

export function EmployeesTab({ data, reload, onSignedOut }: Props) {
  const toast = useToast();
  const [filter, setFilter] = useState<TeamFilter>('');
  const [query, setQuery] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [renaming, setRenaming] = useState<AdminMember | null>(null);
  const [deleting, setDeleting] = useState<AdminMember | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const managerById = useMemo(() => new Map(data.managers.map((m) => [m.id, m])), [data.managers]);

  const people = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.members
      .filter((m) => (filter === '' ? true : filter === 'none' ? !m.manager_id : m.manager_id === filter))
      .filter((m) => showInactive || m.active)
      .filter((m) => !q || m.name.toLowerCase().includes(q))
      .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  }, [data.members, filter, query, showInactive]);

  const inactiveCount = data.members.filter((m) => !m.active).length;
  const unassigned = data.members.filter((m) => m.active && !m.manager_id).length;

  const change = async (member: AdminMember, patch: { managerId?: string | null; active?: boolean }, success: string) => {
    setPending(member.id);
    try {
      await api.updateMember(member.id, patch);
      await reload();
      toast(success);
    } catch (e) {
      if (!onSignedOut(e)) toast(errorText(e, 'Could not change that.'), 'error');
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <AddPeople data={data} defaultTeam={filter && filter !== 'none' ? filter : ''} onAdded={reload} onSignedOut={onSignedOut} />

      {showImport && <ImportPanel managers={data.managers} onDone={reload} onClose={() => setShowImport(false)} onSignedOut={onSignedOut} />}

      <Panel
        title="Employees"
        description={`${data.members.filter((m) => m.active).length} active${inactiveCount ? `, ${inactiveCount} inactive` : ''}. Moving someone keeps their history; it shows on their new team’s board from now on.`}
        actions={
          <>
            {unassigned > 0 && (
              <button type="button" onClick={() => setFilter('none')} className="focus-ring rounded-xs">
                <Badge tone="wait">{unassigned} without a team</Badge>
              </button>
            )}
            {!showImport && (
              <Button size="sm" onClick={() => setShowImport(true)}>
                Import from the old site
              </Button>
            )}
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
          <Select value={filter} onChange={(e) => setFilter(e.target.value)} className="w-auto min-w-[200px]" aria-label="Team">
            <option value="">Every team</option>
            {data.managers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}’s team
              </option>
            ))}
            <option value="none">No team</option>
          </Select>
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search names" className="w-[220px]" aria-label="Search names" />
          <label className="ml-1 flex cursor-pointer items-center gap-2 text-[12.5px] text-ink-2">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="size-3.5 accent-ink" />
            Show inactive
          </label>
          <span className="tnum ml-auto text-[12px] text-ink-4">
            {people.length} shown
          </span>
        </div>

        {people.length === 0 ? (
          <p className="px-5 py-8 text-center text-[12.5px] text-ink-3">
            {data.members.length === 0 ? 'No employees yet. Add them above, or import them from the old site.' : 'No one matches.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left">
              <thead>
                <tr className="border-b border-line bg-paper text-[10.5px] font-semibold tracking-[0.1em] text-ink-3 uppercase">
                  <th className="px-5 py-2.5">Name</th>
                  <th className="px-3 py-2.5">Team</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-5 py-2.5 text-right">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {people.map((m) => {
                  const team = m.manager_id ? managerById.get(m.manager_id) : null;
                  return (
                    <tr key={m.id} className={cx('border-b border-line align-middle last:border-b-0', !m.active && 'bg-paper/70')}>
                      <td className="px-5 py-2.5">
                        <p className={cx('text-[13.5px] font-medium', m.active ? 'text-ink' : 'text-ink-3')}>{m.name}</p>
                        <p className="text-[11.5px] text-ink-4">{m.has_history ? 'Has logged days' : 'Nothing logged yet'}</p>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="max-w-[260px]">
                          <Select
                            value={m.manager_id ?? ''}
                            disabled={pending === m.id}
                            aria-label={`Team for ${m.name}`}
                            className="text-[12.5px]"
                            onChange={(e) => {
                              const next = e.target.value || null;
                              const to = next ? managerById.get(next)?.name : null;
                              void change(m, { managerId: next }, to ? `${m.name} moved to ${to}’s team.` : `${m.name} has no team now.`);
                            }}
                          >
                            <option value="">No team</option>
                            {data.managers.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name}’s team{t.active ? '' : ' (off)'}
                              </option>
                            ))}
                          </Select>
                        </div>
                        {team && !team.active && <p className="mt-1 text-[11px] text-wait">This team is switched off.</p>}
                      </td>
                      <td className="px-3 py-2.5">{m.active ? <Badge tone="ok" dot>Active</Badge> : <Badge tone="mute">Inactive</Badge>}</td>
                      <td className="px-5 py-2.5">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setRenaming(m)}>
                            Rename
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={pending === m.id}
                            onClick={() =>
                              void change(
                                m,
                                { active: !m.active },
                                m.active ? `${m.name} is inactive. Their history stays.` : `${m.name} is active again.`,
                              )
                            }
                          >
                            {m.active ? 'Deactivate' : 'Reactivate'}
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            disabled={m.has_history}
                            title={m.has_history ? 'People with logged days can only be deactivated, so their history stays.' : undefined}
                            onClick={() => setDeleting(m)}
                          >
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {renaming && (
        <Rename
          member={renaming}
          onClose={() => setRenaming(null)}
          onSaved={async () => {
            await reload();
            toast('Renamed.');
          }}
        />
      )}
      <ConfirmModal
        open={deleting !== null}
        title={deleting ? `Delete ${deleting.name}?` : 'Delete'}
        confirmLabel="Delete employee"
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          await api.deleteMember(deleting.id);
          await reload();
          toast(`${deleting.name} deleted.`);
        }}
      >
        They haven’t logged anything, so nothing else is lost. People who have logged days can only be deactivated.
      </ConfirmModal>
    </div>
  );
}
