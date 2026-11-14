import { useEffect, useRef, useState, type ReactNode } from 'react';
import gsap from 'gsap';
import type { Group } from '../lib/board';
import { ATTENDANCE, ATTENDANCE_BY_KEY, BROWNIES, STATUSES, STATUS_BY_KEY, VERDICTS, brownieFlags, formatMinutes, timeOf, verdictOf } from '../lib/config';
import { formatBytes, openAttachment } from '../lib/files';
import type { Attendance, Brownies, Category, Entry, Member, Status } from '../lib/types';
import { CheckCircleIcon, CookieIcon, CrossCircleIcon, PaperclipIcon, PencilIcon, PlusIcon, TrashIcon } from './icons';
import { Badge, cx } from './ui';

const COLUMNS = [
  { key: 'sno', label: '#', width: 'w-[4.5%]' },
  { key: 'member', label: 'Member', width: 'w-[11%]' },
  { key: 'task', label: 'Task', width: 'w-[26%]' },
  { key: 'time', label: 'Time', width: 'w-[6%]' },
  { key: 'status', label: 'Status', width: 'w-[11.5%]' },
  { key: 'remarks', label: 'Remarks', width: 'w-[17%]' },
  { key: 'verdict', label: 'Verdict', width: 'w-[16.5%]' },
  { key: 'actions', label: '', width: 'w-[7.5%]' },
] as const;

/** Verdict buttons run from the lowest to the highest. */
const VERDICTS_UP = [...VERDICTS].sort((a, b) => b.rank - a.rank);

/** A badge with an invisible native <select> on top of it. */
function InlineSelect({
  value,
  options,
  onChange,
  disabled,
  children,
}: {
  value: string;
  options: ReadonlyArray<{ key: string; label: string }>;
  onChange: (key: string) => void;
  disabled: boolean;
  children: ReactNode;
}) {
  return (
    <span className={cx('relative inline-flex rounded-xs', !disabled && 'cursor-pointer ring-offset-1 transition hover:ring-1 hover:ring-line-strong')}>
      {children}
      {!disabled && (
        <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Change" className="absolute inset-0 cursor-pointer opacity-0">
          {options.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </span>
  );
}

/** Remark cell: click to edit, Enter saves, Shift+Enter breaks the line, Escape cancels. */
function RemarkCell({
  value,
  readOnly,
  onSave,
  placeholder = 'Add remark',
  revealOnHover = false,
  rows = 3,
}: {
  value: string | null;
  readOnly: boolean;
  onSave: (text: string) => void;
  placeholder?: string;
  revealOnHover?: boolean;
  rows?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!editing) setDraft(value ?? '');
  }, [value, editing]);
  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);
  const commit = () => {
    setEditing(false);
    if (draft.trim() !== (value ?? '').trim()) onSave(draft);
  };

  if (readOnly) {
    return value ? <p className="text-[12px] leading-[1.5] break-words text-ink-2">{value}</p> : <span className="text-[12px] text-ink-4">—</span>;
  }
  if (editing) {
    return (
      <textarea
        ref={ref}
        rows={rows}
        value={draft}
        maxLength={500}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            commit();
          }
          if (e.key === 'Escape') {
            setDraft(value ?? '');
            setEditing(false);
          }
        }}
        placeholder="Remark, then Enter"
        className="focus-ring w-full resize-none rounded-sm border border-ink bg-surface px-2 py-1.5 text-[12px] leading-[1.5] text-ink"
      />
    );
  }
  return (
    <button type="button" onClick={() => setEditing(true)} className="focus-ring w-full rounded-xs px-1 py-0.5 text-left transition-colors hover:bg-mute-bg">
      {value ? (
        <span className="text-[12px] leading-[1.5] break-words text-ink-2">{value}</span>
      ) : (
        <span className={cx('text-[12px] text-ink-4', revealOnHover && 'opacity-0 transition-opacity group-hover/row:opacity-100')}>{placeholder}</span>
      )}
    </button>
  );
}

function VerdictPill({ category, faint }: { category: Category; faint?: boolean }) {
  const v = verdictOf(category);
  if (!v) return null;
  return (
    <span
      className="inline-flex items-center rounded-xs border px-1.5 py-[3px] text-[11px] font-semibold whitespace-nowrap"
      style={{ color: v.ink, borderColor: v.line, backgroundColor: faint ? 'rgba(255,255,255,0.72)' : '#ffffff' }}
    >
      {v.label}
    </span>
  );
}

function BrowniePill({ label }: { label: string }) {
  return (
    <span
      title={`Brownie — ${label.toLowerCase()}`}
      className="inline-flex items-center gap-1 rounded-xs border border-[#e3cba4] bg-[#fdf4e5] px-1.5 py-[2px] text-[10.5px] font-semibold text-[#7a5312]"
    >
      <CookieIcon className="size-3" />
      {label}
    </span>
  );
}

/** Admin: five verdict buttons + three brownie toggles. Everyone else: the verdict pill. */
function VerdictCell({ group, canJudge, onMark }: { group: Group; canJudge: boolean; onMark: (memberId: string, category: Category | null, flags: Brownies) => void }) {
  const mark = group.mark;
  const flags = brownieFlags(mark);
  const given = BROWNIES.filter((b) => flags[b.key]);

  if (!canJudge) {
    if (!mark) return <span className="text-[11.5px] text-ink-4">Awaiting review</span>;
    return (
      <div className="flex flex-col items-start gap-1.5">
        <VerdictPill category={mark.category} faint />
        {given.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {given.map((b) => (
              <BrowniePill key={b.key} label={b.label} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-stretch gap-1.5">
      <div role="group" aria-label={`Verdict for ${group.member.name}`} className="flex flex-col gap-[3px]">
        {VERDICTS_UP.map((v) => {
          const on = mark?.category === v.key;
          return (
            <button
              key={v.key}
              type="button"
              aria-pressed={on}
              title={on ? `${group.member.name} is marked ${v.label.toLowerCase()} — click to clear` : `Mark ${group.member.name} as ${v.label.toLowerCase()}`}
              onClick={() => onMark(group.member.id, on ? null : v.key, flags)}
              className={cx(
                'focus-ring flex items-center gap-1.5 rounded-xs border px-1.5 py-[3px] text-left text-[10.5px] font-semibold transition',
                on ? 'shadow-[inset_0_0_0_1px_rgba(0,0,0,0.04)]' : 'border-line bg-surface text-ink-3 hover:border-line-strong hover:text-ink',
              )}
              style={on ? { backgroundColor: v.bg, borderColor: v.ink, color: v.ink } : undefined}
            >
              <span className="size-[8px] shrink-0 rounded-[2px] border" style={{ backgroundColor: v.bg, borderColor: v.line }} />
              <span className="truncate">{v.label}</span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-1">
        {BROWNIES.map((b) => {
          const on = flags[b.key];
          return (
            <button
              key={b.key}
              type="button"
              disabled={!mark}
              title={mark ? `${on ? 'Take back' : 'Give'} the ${b.label.toLowerCase()} brownie — ${b.hint.toLowerCase()}` : 'Judge the day first, then the brownies'}
              onClick={() => mark && onMark(group.member.id, mark.category, { ...flags, [b.key]: !on })}
              className={cx(
                'focus-ring inline-flex items-center gap-1 rounded-xs border px-1.5 py-[2px] text-[10.5px] font-semibold transition',
                on ? 'border-[#e3cba4] bg-[#fdf4e5] text-[#7a5312]' : 'border-line bg-surface text-ink-4 hover:border-line-strong hover:text-ink-3',
                !mark && 'cursor-not-allowed opacity-45',
              )}
            >
              <CookieIcon className={cx('size-3', !on && 'opacity-55')} />
              {b.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export interface BoardTableProps {
  groups: Group[];
  memberById: Map<string, Member>;
  identity: string | null;
  canEditTasks: boolean;
  canJudge: boolean;
  canRemark: boolean;
  canAdd: boolean;
  addLabel?: string;
  onStatus: (entryId: string, status: Status) => void;
  onMark: (memberId: string, category: Category | null, flags: Brownies) => void;
  onEdit: (entry: Entry) => void;
  onRemarks: (entryId: string, text: string) => void;
  onDelete: (entryId: string) => void;
  onAttendance: (memberId: string, attendance: Attendance) => void;
  onAddFor: (memberId: string) => void;
  onMember: (member: Member) => void;
}

export function BoardTable({
  groups,
  memberById,
  identity,
  canEditTasks,
  canJudge,
  canRemark,
  canAdd,
  addLabel,
  onStatus,
  onMark,
  onEdit,
  onRemarks,
  onDelete,
  onAttendance,
  onAddFor,
  onMember,
}: BoardTableProps) {
  const readOnly = !canEditTasks;
  const root = useRef<HTMLDivElement>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const shape = groups.map((g) => `${g.member.id}:${g.entries.length}:${g.mark?.category ?? ''}`).join('|');
  const anyJudged = groups.some((g) => g.mark);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.fromTo('[data-group]', { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.4, stagger: 0.03, ease: 'power2.out', overwrite: true });
    }, root);
    return () => ctx.revert();
  }, [shape]);

  useEffect(() => {
    if (!confirming) return;
    const timer = window.setTimeout(() => setConfirming(null), 4000);
    return () => window.clearTimeout(timer);
  }, [confirming]);

  return (
    <div ref={root} className="w-full overflow-x-auto rounded-md border border-line bg-surface">
      <table className="w-full min-w-[1280px] table-fixed border-collapse text-left">
        <colgroup>
          {COLUMNS.map((c) => (
            <col key={c.key} className={c.width} />
          ))}
        </colgroup>
        <thead>
          <tr className="border-b border-line bg-paper">
            {COLUMNS.map((c) => (
              <th
                key={c.key}
                scope="col"
                title={
                  c.key === 'sno'
                    ? anyJudged
                      ? 'Ordered by verdict — everyone in a category shares the place'
                      : 'Alphabetical until an admin judges the day'
                    : c.key === 'verdict'
                      ? "The admin's verdict on the whole day, plus brownies for overtime, for working a holiday, and for saving the day"
                      : undefined
                }
                className={cx('px-3 py-2.5 text-[10.5px] font-semibold tracking-[0.1em] text-ink-3 uppercase', c.key === 'sno' && 'text-center')}
              >
                {c.key === 'sno' && anyJudged ? 'Rank' : c.label}
              </th>
            ))}
          </tr>
        </thead>
        {groups.map((g) => {
          const span = Math.max(g.entries.length, 1);
          const verdict = verdictOf(g.mark?.category);
          const tint = verdict ? { backgroundColor: verdict.bg } : undefined;
          const logged = g.dayLog ? ATTENDANCE_BY_KEY[g.dayLog.attendance] : null;
          const presumed = !logged && g.presumed ? ATTENDANCE_BY_KEY[g.presumed] : null;
          const isYou = identity === g.member.id;
          const reported = g.dayLog !== null || g.entries.length > 0;
          const rows: Array<Entry | null> = g.entries.length ? g.entries : [null];

          return (
            <tbody key={g.member.id} data-group className="border-b-2 border-ink-4/60 last:border-b-0">
              {rows.map((entry, index) => (
                <tr
                  key={entry ? entry.id : 'empty'}
                  style={tint}
                  className={cx('group/row align-top transition-colors duration-150', verdict ? 'hover:brightness-[0.985]' : 'hover:bg-paper/60')}
                >
                  {index === 0 && (
                    <>
                      <td rowSpan={span} className="border-r border-line px-2 py-3 align-top">
                        <div className="flex flex-col items-center gap-1.5">
                          <span
                            title={g.rank ? `${verdict?.label} — place ${g.rank} today` : 'Not judged yet'}
                            className={cx('tnum text-[12px] font-semibold', g.rank === 1 ? 'text-ink' : 'text-ink-3')}
                          >
                            {g.rank ? String(g.rank).padStart(2, '0') : '–'}
                          </span>
                          <span title={reported ? 'Has reported today' : 'Has not reported yet'} className={reported ? 'text-ok' : 'text-line-strong'}>
                            {reported ? <CheckCircleIcon className="size-[17px]" /> : <CrossCircleIcon className="size-[17px]" />}
                          </span>
                        </div>
                      </td>
                      <td rowSpan={span} className="border-r border-line px-3 py-3 align-top">
                        <div className="flex items-baseline gap-1.5">
                          <button
                            type="button"
                            onClick={() => onMember(g.member)}
                            title={`Open ${g.member.name}'s stats`}
                            className="focus-ring rounded-xs text-left text-[13.5px] font-semibold tracking-[-0.01em] text-ink underline decoration-transparent underline-offset-2 transition hover:decoration-ink-4"
                          >
                            {g.member.name}
                          </button>
                          {isYou && <span className="text-[10px] font-semibold tracking-[0.08em] text-ink-4 uppercase">you</span>}
                        </div>
                        <div className="mt-1.5">
                          {logged || presumed || !readOnly ? (
                            <InlineSelect
                              value={g.dayLog?.attendance ?? ''}
                              disabled={readOnly}
                              options={[...(logged ? [] : [{ key: '', label: 'Not marked' }]), ...ATTENDANCE.map((a) => ({ key: a.key, label: a.label }))]}
                              onChange={(key) => key && onAttendance(g.member.id, key as Attendance)}
                            >
                              {logged ? (
                                <Badge tone={logged.tone} dot>
                                  {logged.short}
                                </Badge>
                              ) : presumed ? (
                                <span
                                  title={`Nothing was logged, so this day counts as ${presumed.label.toLowerCase()}. Set it here to say otherwise.`}
                                  className="inline-flex"
                                >
                                  <Badge tone="mute">
                                    <span className="opacity-80">{presumed.short}</span>
                                    <span className="ml-1 text-[9px] tracking-[0.06em] uppercase opacity-70">by default</span>
                                  </Badge>
                                </span>
                              ) : (
                                <Badge tone="mute">Not marked</Badge>
                              )}
                            </InlineSelect>
                          ) : (
                            <span className="text-[11.5px] text-ink-4">Not marked</span>
                          )}
                        </div>
                        {g.dayLog?.note && <p className="mt-1.5 text-[11.5px] leading-[1.45] break-words text-ink-3">{g.dayLog.note}</p>}
                      </td>
                    </>
                  )}

                  {entry ? (
                    <>
                      <td className="px-3 py-3">
                        <p className="text-[13px] leading-[1.45] font-medium break-words text-ink">{entry.title}</p>
                        {entry.details && <p className="mt-1 text-[12px] leading-[1.5] break-words text-ink-2">{entry.details}</p>}
                        <p className="tnum mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-4">
                          <span>{timeOf(entry.created_at)}</span>
                          {entry.created_by === null && (
                            <>
                              <span className="text-line-strong">/</span>
                              <span className="font-medium text-ink-3">assigned</span>
                            </>
                          )}
                          {entry.attachment_path && (
                            <>
                              <span className="text-line-strong">/</span>
                              <button
                                type="button"
                                title={`Open ${entry.attachment_name} (${formatBytes(entry.attachment_size)})`}
                                onClick={() => openAttachment(entry.id)}
                                className="focus-ring inline-flex max-w-[220px] items-center gap-1 rounded-xs font-medium text-ink-3 transition hover:text-ink"
                              >
                                <PaperclipIcon className="size-3 shrink-0" />
                                <span className="truncate underline decoration-line-strong underline-offset-2">{entry.attachment_name}</span>
                              </button>
                            </>
                          )}
                        </p>
                      </td>
                      <td className="tnum px-3 py-3 text-[12.5px] font-medium whitespace-nowrap text-ink-2">{formatMinutes(entry.minutes)}</td>
                      <td className="px-3 py-3">
                        <InlineSelect
                          value={entry.status}
                          disabled={readOnly}
                          options={STATUSES.map((s) => ({ key: s.key, label: s.label }))}
                          onChange={(key) => onStatus(entry.id, key as Status)}
                        >
                          <Badge tone={STATUS_BY_KEY[entry.status].tone} dot>
                            {STATUS_BY_KEY[entry.status].label}
                          </Badge>
                        </InlineSelect>
                        {entry.status_at && (
                          <p className="tnum mt-1 text-[10.5px] break-words text-ink-4">
                            {entry.status_by ? `${memberById.get(entry.status_by)?.name ?? '—'} / ` : ''}
                            {timeOf(entry.status_at)}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <RemarkCell value={entry.remarks} readOnly={!canRemark} revealOnHover onSave={(text) => onRemarks(entry.id, text)} />
                      </td>
                      {index === 0 && (
                        <td rowSpan={span} className="border-l border-line px-3 py-3 align-top">
                          <VerdictCell group={g} canJudge={canJudge} onMark={onMark} />
                        </td>
                      )}
                      <td className="px-2 py-3">
                        {(canAdd || !readOnly) && (
                          <div className="flex items-center justify-end gap-0.5">
                            {canAdd && index === 0 && (
                              <button
                                type="button"
                                aria-label={`Add a task for ${g.member.name}`}
                                title={`Add a task for ${g.member.name}`}
                                onClick={() => onAddFor(g.member.id)}
                                className="focus-ring rounded-xs p-1.5 text-ink-4 opacity-60 transition hover:bg-mute-bg hover:text-ink hover:opacity-100 group-hover/row:opacity-100"
                              >
                                <PlusIcon className="size-3.5" />
                              </button>
                            )}
                            {confirming === entry.id ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setConfirming(null);
                                  onDelete(entry.id);
                                }}
                                className="focus-ring rounded-xs bg-bad-bg px-1.5 py-1 text-[11px] font-semibold text-bad"
                              >
                                Sure?
                              </button>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  aria-label="Edit entry"
                                  title="Edit entry"
                                  onClick={() => onEdit(entry)}
                                  className="focus-ring rounded-xs p-1.5 text-ink-4 opacity-60 transition hover:bg-mute-bg hover:text-ink hover:opacity-100 group-hover/row:opacity-100"
                                >
                                  <PencilIcon className="size-3.5" />
                                </button>
                                <button
                                  type="button"
                                  aria-label="Delete entry"
                                  title="Delete entry"
                                  onClick={() => setConfirming(entry.id)}
                                  className="focus-ring rounded-xs p-1.5 text-ink-4 opacity-60 transition hover:bg-bad-bg hover:text-bad hover:opacity-100 group-hover/row:opacity-100"
                                >
                                  <TrashIcon className="size-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </td>
                    </>
                  ) : (
                    <>
                      <td colSpan={4} className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-[12.5px] text-ink-4">No entries logged.</span>
                          {canAdd && (
                            <button
                              type="button"
                              onClick={() => onAddFor(g.member.id)}
                              className="focus-ring inline-flex items-center gap-1 rounded-sm border border-line-strong bg-surface px-2 py-1 text-[12px] font-medium text-ink-2 transition-colors hover:border-ink-4 hover:text-ink"
                            >
                              <PlusIcon className="size-3" />
                              {addLabel ?? (isYou ? 'Add yours' : 'Assign a task')}
                            </button>
                          )}
                        </div>
                      </td>
                      <td rowSpan={span} className="border-l border-line px-3 py-3 align-top">
                        <VerdictCell group={g} canJudge={canJudge} onMark={onMark} />
                      </td>
                      <td />
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}
