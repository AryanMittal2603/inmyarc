import { useRef, useState } from 'react';
import { STATUSES, formatMinutes, timeOf } from '../lib/config';
import { fileProblem, formatBytes, openAttachment } from '../lib/files';
import type { Entry, Member, Status } from '../lib/types';
import type { EntryEdit } from '../hooks/useDay';
import { useToast } from '../context/toast';
import { CloseIcon, PaperclipIcon } from './icons';
import { Button, FieldLabel, Input, Modal, Segmented, Textarea, TimeInput, toMinutes } from './ui';

function splitMinutes(minutes: number | null): { hours: string; mins: string } {
  if (minutes == null) return { hours: '', mins: '' };
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return { hours: h ? String(h) : '', mins: m ? String(m) : '0' };
}

export function EditEntryModal({
  entry,
  owner,
  members,
  identity,
  onClose,
  onSave,
  onDelete,
}: {
  entry: Entry;
  owner: Member | null;
  members: Map<string, Member>;
  identity: string | null;
  onClose: () => void;
  onSave: (id: string, edit: EntryEdit) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
}) {
  const toast = useToast();
  const initial = splitMinutes(entry.minutes);
  const [title, setTitle] = useState(entry.title);
  const [details, setDetails] = useState(entry.details ?? '');
  const [status, setStatus] = useState<Status>(entry.status);
  const [hours, setHours] = useState(initial.hours);
  const [mins, setMins] = useState(initial.mins);
  const [remarks, setRemarks] = useState(entry.remarks ?? '');
  const [attachment, setAttachment] = useState<File | 'clear' | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const minutes = toMinutes(hours, mins);
  const statusChanged = status !== entry.status;

  async function save() {
    setError(null);
    if (!title.trim()) return setError('A task needs a title.');
    setBusy(true);
    try {
      await onSave(entry.id, { title, details, status, minutes, remarks, statusChanged, actorId: identity, attachment });
      toast('Entry updated.');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await onDelete(entry.id);
      toast('Entry removed.');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete.');
      setBusy(false);
    }
  }

  const statusHint = entry.status_at
    ? `last set ${entry.status_by ? `by ${members.get(entry.status_by)?.name ?? '—'} ` : ''}at ${timeOf(entry.status_at)}`
    : undefined;

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit entry"
      subtitle={`${owner?.name ?? 'Unknown'} — logged ${timeOf(entry.created_at)}${entry.created_by === null ? ' — assigned' : ''}`}
      width={600}
      footer={
        <>
          {confirmDelete ? (
            <div className="mr-auto flex items-center gap-2">
              <span className="text-[12px] text-ink-2">Delete this entry?</span>
              <Button size="sm" onClick={remove} disabled={busy} className="border-bad/30 text-bad hover:bg-bad-bg">
                Delete
              </Button>
              <Button size="sm" onClick={() => setConfirmDelete(false)}>
                Keep
              </Button>
            </div>
          ) : (
            <Button variant="danger" size="sm" className="mr-auto" onClick={() => setConfirmDelete(true)} disabled={busy}>
              Delete entry
            </Button>
          )}
          {error && <p className="text-[12px] font-medium text-bad">{error}</p>}
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save changes'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div data-stagger>
          <FieldLabel htmlFor="edit-title">Task</FieldLabel>
          <Input id="edit-title" value={title} maxLength={180} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div data-stagger>
          <FieldLabel htmlFor="edit-details" hint="optional">
            Detail
          </FieldLabel>
          <Textarea id="edit-details" rows={2} value={details} maxLength={400} placeholder="Any context worth keeping" onChange={(e) => setDetails(e.target.value)} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2" data-stagger>
          <div>
            <FieldLabel hint={formatMinutes(minutes)}>Time taken</FieldLabel>
            <TimeInput
              hours={hours}
              mins={mins}
              onChange={(v) => {
                if (v.hours !== undefined) setHours(v.hours);
                if (v.mins !== undefined) setMins(v.mins);
              }}
            />
          </div>
          <div>
            <FieldLabel hint="whole day, at /rating">Verdict</FieldLabel>
            <p className="flex h-8 items-center text-[11.5px] leading-[1.45] text-ink-4">Days are judged as a whole, not task by task.</p>
          </div>
        </div>
        <div data-stagger>
          <FieldLabel hint={statusHint}>Status</FieldLabel>
          <Segmented value={status} onChange={setStatus} options={STATUSES.map((s) => ({ key: s.key, label: s.label }))} />
        </div>
        <div data-stagger>
          <FieldLabel hint="one file, up to 10 MB">Attachment</FieldLabel>
          <input
            ref={fileInput}
            type="file"
            className="hidden"
            onChange={(e) => {
              const picked = e.target.files?.[0] ?? null;
              e.target.value = '';
              if (!picked) return;
              const problem = fileProblem(picked);
              setError(problem);
              if (!problem) setAttachment(picked);
            }}
          />
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {attachment instanceof File ? (
              <span title={attachment.name} className="inline-flex min-w-0 items-center gap-1 rounded-xs bg-mute-bg px-1.5 py-1 text-[11.5px] font-medium text-ink-2">
                <PaperclipIcon className="size-3 shrink-0" />
                <span className="max-w-[220px] truncate">{attachment.name}</span>
                <span className="tnum shrink-0 text-ink-4">{formatBytes(attachment.size)}</span>
                <span className="shrink-0 text-ink-4">— saves on Save</span>
              </span>
            ) : entry.attachment_path && attachment !== 'clear' ? (
              <button
                type="button"
                onClick={() => openAttachment(entry.id)}
                title={`Open ${entry.attachment_name}`}
                className="focus-ring inline-flex min-w-0 items-center gap-1 rounded-xs bg-mute-bg px-1.5 py-1 text-[11.5px] font-medium text-ink-2 transition hover:text-ink"
              >
                <PaperclipIcon className="size-3 shrink-0" />
                <span className="max-w-[220px] truncate underline decoration-line-strong underline-offset-2">{entry.attachment_name}</span>
                <span className="tnum shrink-0 text-ink-4">{formatBytes(entry.attachment_size)}</span>
              </button>
            ) : (
              <span className="text-[11.5px] text-ink-4">{attachment === 'clear' ? 'Will be removed on Save.' : 'None.'}</span>
            )}
            <Button size="sm" onClick={() => fileInput.current?.click()}>
              <PaperclipIcon className="size-3" />
              {entry.attachment_path || attachment instanceof File ? 'Replace' : 'Attach file'}
            </Button>
            {(attachment !== null || entry.attachment_path) && attachment !== 'clear' && (
              <Button
                size="sm"
                onClick={() => {
                  setError(null);
                  setAttachment(entry.attachment_path ? 'clear' : null);
                }}
              >
                <CloseIcon className="size-3" />
                Remove
              </Button>
            )}
            {attachment === 'clear' && (
              <Button size="sm" onClick={() => setAttachment(null)}>
                Keep it
              </Button>
            )}
          </div>
          <p className="mt-1.5 text-[11px] leading-[1.5] text-ink-4">
            A file that has been uploaded stays in storage even after it is removed here; only the link to it is dropped.
          </p>
        </div>
        <div data-stagger>
          <FieldLabel htmlFor="edit-remarks" hint="optional">
            Remarks
          </FieldLabel>
          <Textarea id="edit-remarks" rows={2} value={remarks} maxLength={500} placeholder="Feedback for whoever did this" onChange={(e) => setRemarks(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}
