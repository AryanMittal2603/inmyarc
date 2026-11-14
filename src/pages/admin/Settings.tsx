import { useEffect, useState } from 'react';
import { Badge, Button, FieldLabel, Input } from '../../components/ui';
import { useToast } from '../../context/toast';
import { api, errorText } from '../../lib/api';
import { addDays, longDate, today } from '../../lib/config';
import type { AdminOverview } from '../../lib/types';
import { Panel } from './shared';

interface Props {
  data: AdminOverview;
  reload: () => Promise<void>;
  onSignedOut: (error: unknown) => boolean;
}

function Check({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <li className="flex items-start gap-3 px-5 py-3">
      <span
        className={`tnum mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-xs border text-[11px] font-semibold ${
          ok ? 'border-ok/40 bg-ok-bg text-ok' : 'border-wait/40 bg-wait-bg text-wait'
        }`}
        aria-hidden="true"
      >
        {ok ? '✓' : '!'}
      </span>
      <div>
        <p className="text-[13px] font-medium text-ink">{label}</p>
        <p className="mt-0.5 text-[12.5px] leading-[1.5] text-ink-3">{detail}</p>
      </div>
    </li>
  );
}

export function SettingsTab({ data, reload, onSignedOut }: Props) {
  const toast = useToast();
  const t = today();
  const [from, setFrom] = useState(data.settings.editableFrom ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setFrom(data.settings.editableFrom ?? ''), [data.settings.editableFrom]);

  const save = async (value: string | null) => {
    setError(null);
    if (value && value > t) return setError('Pick today or an earlier day.');
    setBusy(true);
    try {
      await api.saveSettings(value);
      await reload();
      toast(value ? `Team boards can edit from ${longDate(value)}.` : 'Team boards can edit today only.');
    } catch (e) {
      if (!onSignedOut(e)) setError(errorText(e, 'Could not save.'));
    } finally {
      setBusy(false);
    }
  };

  const open = data.settings.openFrom;
  const days = Math.round((Date.parse(t) - Date.parse(open)) / 86_400_000);

  return (
    <div className="flex flex-col gap-6">
      <Panel
        title="Backfill window"
        description="How far back employees can add or change entries on their team boards. Managers and the super admin can always edit any past day."
        actions={open === t ? <Badge tone="mute">Today only</Badge> : <Badge tone="live">{days + 1} days open</Badge>}
      >
        <div className="flex flex-col gap-4 px-5 py-4">
          <p className="text-[13px] text-ink-2">
            {open === t ? (
              <>Right now team boards can only log today, {longDate(t)}.</>
            ) : (
              <>
                Right now team boards can log any day from <b>{longDate(open)}</b> to today.
              </>
            )}
            {!data.settings.editableFrom && data.settings.envEditableFrom && (
              <> This comes from the EDITABLE_FROM variable in Vercel; a date saved here takes its place.</>
            )}
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <FieldLabel htmlFor="editable-from">Open from</FieldLabel>
              <Input id="editable-from" type="date" max={t} value={from} onChange={(e) => setFrom(e.target.value)} className="w-[180px]" />
            </div>
            <Button variant="primary" disabled={busy || !from || from === data.settings.editableFrom} onClick={() => void save(from)}>
              Save
            </Button>
            <Button disabled={busy} onClick={() => void save(addDays(t, -6))}>
              Last 7 days
            </Button>
            <Button disabled={busy || (!data.settings.editableFrom && open === t)} onClick={() => void save(null)}>
              Today only
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-[12.5px] font-medium text-bad">
              {error}
            </p>
          )}
        </div>
      </Panel>

      <Panel title="Setup" description="What this deployment has connected in Vercel.">
        <ul className="divide-y divide-line">
          <Check ok label="Database" detail="Connected. Teams, people, entries and verdicts are stored here." />
          <Check
            ok={data.status.files}
            label="File storage"
            detail={
              data.status.files
                ? 'Connected. People can attach one file per task, up to 10 MB.'
                : 'Not connected, so attachments can’t be uploaded. In Vercel, add a private Blob store to this project and redeploy.'
            }
          />
          <Check
            ok={data.status.admin}
            label="Super admin password"
            detail="Set with the ADMIN_PASSCODE variable in Vercel. Changing it there signs every super admin out."
          />
        </ul>
      </Panel>
    </div>
  );
}
