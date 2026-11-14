import { useState } from 'react';
import { Button, FieldLabel, Input, Segmented, Select } from '../../components/ui';
import { useToast } from '../../context/toast';
import { api, errorText } from '../../lib/api';
import type { AdminManager, ImportResult } from '../../lib/types';
import { Panel } from './shared';

/** Copies people (and, if wanted, their old history) from the old Supabase project. Safe to run more than once. */
export function ImportPanel({
  managers,
  onDone,
  onClose,
  onSignedOut,
}: {
  managers: AdminManager[];
  onDone: () => Promise<void>;
  onClose: () => void;
  onSignedOut: (error: unknown) => boolean;
}) {
  const toast = useToast();
  const [sourceUrl, setSourceUrl] = useState('https://rzhvuincdtsiecnodmsr.supabase.co');
  const [sourceKey, setSourceKey] = useState('');
  const [scope, setScope] = useState<'team' | 'all'>('team');
  const [managerId, setManagerId] = useState(managers.find((m) => m.active)?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const target = managers.find((m) => m.id === managerId);

  async function run() {
    setError(null);
    if (!sourceKey.trim()) return setError('Paste the old project’s anon key.');
    setBusy(true);
    try {
      const r = await api.importFromOldSite(sourceUrl, sourceKey, scope, managerId || null);
      setResult(r);
      toast(scope === 'team' ? 'Employees imported.' : 'Employees and history imported.');
      await onDone();
    } catch (e) {
      if (!onSignedOut(e)) setError(errorText(e, 'The import did not finish.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title="Import from the old site"
      description="Copies the employees from the old Supabase project onto one manager’s team. Old entries, attendance and verdicts stay behind unless you include them. Running it again updates employees instead of duplicating them."
      actions={
        <Button variant="ghost" size="sm" onClick={onClose}>
          Hide
        </Button>
      }
    >
      <div className="flex flex-col gap-4 px-5 py-4">
        <Segmented
          value={scope}
          onChange={setScope}
          options={[
            { key: 'team', label: 'Employees only' },
            { key: 'all', label: 'Employees + history' },
          ]}
        />
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr_1fr_auto] lg:items-end">
          <div>
            <FieldLabel htmlFor="src-url">Old project URL</FieldLabel>
            <Input id="src-url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} />
          </div>
          <div>
            <FieldLabel htmlFor="src-key" hint="Supabase → Project Settings → API Keys">
              Anon key
            </FieldLabel>
            <Input id="src-key" type="password" autoComplete="off" value={sourceKey} placeholder="eyJhbGciOi…" onChange={(e) => setSourceKey(e.target.value)} />
          </div>
          <div>
            <FieldLabel htmlFor="src-team">Put them on</FieldLabel>
            <Select id="src-team" value={managerId} onChange={(e) => setManagerId(e.target.value)}>
              <option value="">No team (assign later)</option>
              {managers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}’s team
                </option>
              ))}
            </Select>
          </div>
          <Button variant="primary" onClick={() => void run()} disabled={busy}>
            {busy ? 'Importing…' : scope === 'team' ? 'Import employees' : 'Import employees + history'}
          </Button>
        </div>
        <p className="text-[12px] text-ink-3">
          Employees who already exist keep their team unless you pick one here{target ? `; they’ll move to ${target.name}’s team` : ''}.
        </p>
      </div>
      {(error || result) && (
        <div className="border-t border-line px-5 py-3 text-[12.5px]">
          {error && <p className="font-medium text-bad">{error}</p>}
          {result &&
            (scope === 'team' ? (
              <p className="text-ink-2">Imported {result.members} employees. No old entries, attendance or verdicts were copied.</p>
            ) : (
              <p className="text-ink-2">
                Imported {result.members} employees, {result.dayLogs} attendance records, {result.entries} entries and {result.marks} verdicts.
                {result.files.copied + result.files.failed + result.files.skipped > 0 &&
                  ` Attachments: ${result.files.copied} copied${result.files.failed ? `, ${result.files.failed} failed` : ''}${
                    result.files.skipped ? `, ${result.files.skipped} waiting for Blob storage` : ''
                  }.`}
              </p>
            ))}
        </div>
      )}
    </Panel>
  );
}
