import { useMemo, useState } from 'react';
import { BROWNIES, POINTS_PER_BROWNIE, VERDICTS, formatMinutes } from '../lib/config';
import { periodKey, periodLabel, reviewStart, standings, tally, type HistoryRow, type PeriodMode, type RankMode } from '../lib/review';
import type { Category, Member } from '../lib/types';
import { useHistory } from '../hooks/useHistory';
import { CookieIcon } from './icons';
import { Badge, Button, Modal, Segmented, Select, cx } from './ui';

/** Horizontal stacked bar of verdict counts. */
function VerdictBar({ counts, total, height = 12 }: { counts: Record<Category, number>; total: number; height?: number }) {
  if (!total) return <div className="w-full rounded-xs bg-mute-bg" style={{ height }} title="No verdicts yet" />;
  return (
    <div
      className="flex w-full overflow-hidden rounded-xs"
      style={{ height }}
      role="img"
      aria-label={VERDICTS.filter((v) => counts[v.key])
        .map((v) => `${counts[v.key]} ${v.label}`)
        .join(', ')}
    >
      {VERDICTS.map((v) =>
        counts[v.key] ? (
          <span
            key={v.key}
            title={`${counts[v.key]} × ${v.label}`}
            style={{ width: `${(100 * counts[v.key]) / total}%`, backgroundColor: v.bg, borderRight: `1px solid ${v.line}` }}
          />
        ) : null,
      )}
    </div>
  );
}

/** The "Graph" view: standings by verdict or points, per week or month, and the team's verdict mix over time. */
export function ReviewModal({ open, onClose, members, identity }: { open: boolean; onClose: () => void; members: Member[]; identity: string | null }) {
  const [mode, setMode] = useState<PeriodMode>('week');
  const [rankBy, setRankBy] = useState<RankMode>('verdicts');
  const [person, setPerson] = useState('');
  const [period, setPeriod] = useState('all');
  const from = reviewStart(mode);
  const { members: loadedMembers, rows, loading, error } = useHistory(open, from);
  const people = loadedMembers.length ? loadedMembers : members;

  const periods = useMemo(() => [...new Set(rows.map((r) => periodKey(r.log_date, mode)))].sort().reverse(), [rows, mode]);
  const inPeriod = useMemo(() => (period === 'all' ? rows : rows.filter((r) => periodKey(r.log_date, mode) === period)), [rows, period, mode]);
  const byMember = useMemo(() => {
    const map = new Map<string, HistoryRow[]>();
    for (const r of inPeriod) {
      const list = map.get(r.member_id);
      if (list) list.push(r);
      else map.set(r.member_id, [r]);
    }
    return map;
  }, [inPeriod]);
  const ranked = useMemo(() => standings(people, byMember, rankBy), [people, byMember, rankBy]);
  const overall = useMemo(() => tally(inPeriod), [inPeriod]);
  const columns = useMemo(
    () =>
      [...new Set(rows.map((r) => periodKey(r.log_date, mode)))].sort().map((key) => ({
        key,
        tally: tally(rows.filter((r) => periodKey(r.log_date, mode) === key && (!person || r.member_id === person))),
      })),
    [rows, mode, person],
  );
  const tallest = Math.max(...columns.map((c) => c.tally.judged), 1);
  const personName = people.find((m) => m.id === person)?.name ?? '';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Review"
      subtitle="Verdicts, brownies and hours since the new system began"
      width={980}
      footer={
        <>
          <p className="mr-auto text-[11.5px] text-ink-4">Days are judged whole. Nobody is ranked by a number any more — the standing is the verdict.</p>
          <Button onClick={onClose}>Close</Button>
        </>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-2" data-stagger>
        <Segmented
          value={mode}
          onChange={(m) => {
            setMode(m);
            setPeriod('all');
          }}
          options={[
            { key: 'week', label: 'By week' },
            { key: 'month', label: 'By month' },
          ]}
        />
        <Select value={period} onChange={(e) => setPeriod(e.target.value)} className="w-auto">
          <option value="all">Whole period</option>
          {periods.map((p) => (
            <option key={p} value={p}>
              {mode === 'week' ? `Week of ${periodLabel(p, mode)}` : periodLabel(p, mode)}
            </option>
          ))}
        </Select>
        <Segmented
          value={rankBy}
          onChange={setRankBy}
          options={[
            { key: 'verdicts', label: 'By verdict' },
            { key: 'points', label: 'By points' },
          ]}
        />
        <Select value={person} onChange={(e) => setPerson(e.target.value)} className="w-auto">
          <option value="">Whole team</option>
          {people.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
        {overall.judged > 0 && (
          <Badge tone="mute">
            {overall.judged} verdict{overall.judged === 1 ? '' : 's'}
          </Badge>
        )}
        {overall.brownies > 0 && <Badge tone="mute">{overall.brownies} brownies</Badge>}
      </div>

      {error && <p className="mb-3 text-[12.5px] font-medium text-bad">{error}</p>}

      {loading ? (
        <div className="flex h-[260px] items-center justify-center text-[12.5px] text-ink-4">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="flex h-[260px] flex-col items-center justify-center gap-1 text-center">
          <p className="text-[13px] font-medium text-ink-2">Nothing to review yet.</p>
          <p className="text-[12px] text-ink-4">The new system started on 1 October 2026 — verdicts appear here as admins give them.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-5" data-stagger>
          <section>
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h3 className="text-[11px] font-semibold tracking-[0.1em] text-ink-3 uppercase">
                Standing {period === 'all' ? 'over the whole period' : `for ${mode === 'week' ? 'week of ' : ''}${periodLabel(period, mode)}`}
                {rankBy === 'points' ? ' — by points' : ''}
              </h3>
              {rankBy === 'points' && (
                <p className="text-[10px] text-ink-4">
                  {[...VERDICTS]
                    .reverse()
                    .map((v) => `${v.label} ${v.points}`)
                    .join(' · ')}{' '}
                  · each cookie +{POINTS_PER_BROWNIE}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1">
              {ranked.map(({ member, tally: t, place }) => (
                <div
                  key={member.id}
                  className={cx(
                    'grid grid-cols-[26px_104px_1fr_176px] items-center gap-3 rounded-sm px-2 py-1.5',
                    member.id === identity && 'bg-paper',
                    member.id === person && 'ring-1 ring-line-strong',
                  )}
                >
                  <span className="tnum text-[12px] font-semibold text-ink-3">{place ? String(place).padStart(2, '0') : '–'}</span>
                  <span className="truncate text-[12.5px] font-medium text-ink">{member.name}</span>
                  <VerdictBar counts={t.byCategory} total={t.judged} />
                  <span className="tnum flex items-center justify-end gap-2 text-[11px] text-ink-4">
                    {rankBy === 'points' && (
                      <span className="text-[12.5px] font-semibold text-ink" title={`${t.judged} judged day(s) and ${t.brownies} brownie(s)`}>
                        {t.points}
                        <span className="ml-0.5 text-[9.5px] font-normal text-ink-4">pts</span>
                      </span>
                    )}
                    {t.brownies > 0 && (
                      <span
                        className="inline-flex items-center gap-0.5 text-[#7a5312]"
                        title={BROWNIES.map((b) => `${t.byBrownie[b.key]} ${b.label.toLowerCase()}`).join(', ')}
                      >
                        <CookieIcon className="size-3" />
                        {t.brownies}
                      </span>
                    )}
                    <span className="whitespace-nowrap">{t.tasks} tasks</span>
                    <span className="whitespace-nowrap text-ink-3">{formatMinutes(t.minutes)}</span>
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-[11px] font-semibold tracking-[0.1em] text-ink-3 uppercase">
              {person ? `${personName} — verdict by ${mode}` : `Team verdicts by ${mode}`}
            </h3>
            <div className="flex items-end gap-1.5">
              {columns.map((c) => (
                <div key={c.key} className="flex flex-1 flex-col items-center gap-1">
                  <div
                    className="flex w-full flex-col-reverse overflow-hidden rounded-xs border border-line"
                    style={{ height: 96 }}
                    title={`${c.tally.judged} judged · ${c.tally.tasks} tasks · ${formatMinutes(c.tally.minutes)}`}
                  >
                    {VERDICTS.map((v) =>
                      c.tally.byCategory[v.key] ? (
                        <span key={v.key} style={{ height: `${(96 * c.tally.byCategory[v.key]) / tallest}px`, backgroundColor: v.bg }} />
                      ) : null,
                    )}
                  </div>
                  <span className="text-[9.5px] text-ink-4">{periodLabel(c.key, mode)}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line pt-3">
            {VERDICTS.map((v) => (
              <span key={v.key} className="flex items-center gap-1.5">
                <span className="size-[10px] rounded-[2px] border" style={{ backgroundColor: v.bg, borderColor: v.line }} />
                <span className="text-[11px] text-ink-3">{v.label}</span>
                <span className="tnum text-[11.5px] font-semibold text-ink-2">{overall.byCategory[v.key]}</span>
              </span>
            ))}
            <span className="ml-auto flex items-center gap-1.5 text-[11px] text-ink-4">
              <CookieIcon className="size-3.5" />
              {BROWNIES.map((b) => `${overall.byBrownie[b.key]} ${b.label.toLowerCase()}`).join(' · ')}
            </span>
          </section>
        </div>
      )}
    </Modal>
  );
}
