import { APP, ATTENDANCE_BY_KEY, BROWNIES, STATUS_BY_KEY, formatMinutes, longDate, timeOf, verdictOf, weekdayName } from './config';
import { reportTotals, type Group } from './board';

/* A4 landscape day report, same layout as the original. */

const MARGIN = 10;
const PAGE_WIDTH = 297;
const TABLE_WIDTH = PAGE_WIDTH - MARGIN * 2;
const COLUMNS = [
  { key: 'rank', header: '#', width: 8 },
  { key: 'member', header: 'Member', width: 24 },
  { key: 'verdict', header: 'Verdict', width: 28 },
  { key: 'day', header: 'Day', width: 24 },
  { key: 'task', header: 'Task', width: 58 },
  { key: 'detail', header: 'Detail', width: 48 },
  { key: 'time', header: 'Time', width: 15 },
  { key: 'status', header: 'Status', width: 21 },
  { key: 'remarks', header: 'Remarks', width: 51 },
] as const;
const INK: [number, number, number] = [23, 23, 26];
const MUTED: [number, number, number] = [120, 120, 127];
const LINE: [number, number, number] = [225, 225, 221];
const ZEBRA: [number, number, number] = [247, 247, 245];

interface ReportRow {
  cells: string[];
  group: number;
  empty: boolean;
  first: boolean;
}

function rows(groups: Group[]): ReportRow[] {
  const out: ReportRow[] = [];
  groups.forEach((g, groupIndex) => {
    const a = g.dayLog?.attendance ?? g.presumed;
    const attendance = a ? ATTENDANCE_BY_KEY[a] : null;
    const day = [attendance ? `${attendance.label}${g.dayLog ? '' : ' (by default)'}` : 'Not marked', g.dayLog?.note]
      .filter(Boolean)
      .join(' — ');
    const name = g.member.name;
    const extras = BROWNIES.filter((b) => g.mark?.[b.key])
      .map((b) => b.label.toLowerCase())
      .join(' + ');
    const verdict = verdictOf(g.mark?.category);
    const verdictText = verdict ? `${verdict.label}${extras ? `\n+ ${extras}` : ''}` : 'Not judged';
    const rank = g.rank ? String(g.rank) : '–';
    if (g.entries.length === 0) {
      out.push({ cells: [rank, name, verdictText, day, 'No entries logged.', '', '', '', ''], group: groupIndex, empty: true, first: true });
      return;
    }
    g.entries.forEach((e, i) => {
      out.push({
        cells: [
          i === 0 ? rank : '',
          i === 0 ? name : g.member.name,
          i === 0 ? verdictText : '',
          i === 0 ? day : '',
          e.created_by === null ? `${e.title}\n(assigned)` : e.title,
          e.details ?? '',
          formatMinutes(e.minutes),
          STATUS_BY_KEY[e.status].label,
          e.remarks ?? '',
        ],
        group: groupIndex,
        empty: false,
        first: i === 0,
      });
    });
  });
  return out;
}

/** `scope` names the team (or "All teams") in the header and the file name. */
export async function downloadDayReport(date: string, groups: Group[], scope?: { label: string; file: string }): Promise<void> {
  const [{ jsPDF }, autoTableModule] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const autoTable = autoTableModule.default;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const totals = reportTotals(groups);
  const body = rows(groups);
  const generated = timeOf(new Date().toISOString());

  autoTable(doc, {
    head: [COLUMNS.map((c) => c.header)],
    body: body.map((r) => r.cells),
    startY: MARGIN + 24,
    margin: { top: MARGIN + 24, right: MARGIN, bottom: MARGIN + 8, left: MARGIN },
    theme: 'grid',
    tableWidth: TABLE_WIDTH,
    rowPageBreak: 'avoid',
    styles: {
      font: 'helvetica',
      fontSize: 8,
      cellPadding: { top: 2, right: 2, bottom: 2, left: 2 },
      overflow: 'linebreak',
      valign: 'top',
      textColor: INK,
      lineColor: LINE,
      lineWidth: 0.1,
    },
    headStyles: {
      fillColor: INK,
      textColor: [255, 255, 255],
      fontSize: 7.5,
      fontStyle: 'bold',
      cellPadding: { top: 2.5, right: 2, bottom: 2.5, left: 2 },
    },
    columnStyles: Object.fromEntries(
      COLUMNS.map((c, i) => [
        i,
        {
          cellWidth: c.width,
          halign: c.key === 'rank' || c.key === 'time' ? 'center' : 'left',
          fontStyle: c.key === 'task' ? 'bold' : 'normal',
        },
      ]),
    ),
    didParseCell: (data) => {
      if (data.section !== 'body') return;
      const row = body[data.row.index];
      if (!row) return;
      if (row.group % 2 === 1) data.cell.styles.fillColor = ZEBRA;
      if (row.empty && data.column.index === 3) {
        data.cell.styles.textColor = MUTED;
        data.cell.styles.fontStyle = 'italic';
      }
      const key = COLUMNS[data.column.index]?.key;
      if (key === 'detail' || key === 'remarks') data.cell.styles.textColor = MUTED;
      if (!row.first && data.column.index === 1) data.cell.styles.textColor = MUTED;
    },
    didDrawPage: () => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(15);
      doc.setTextColor(...INK);
      doc.text(weekdayName(date), MARGIN, MARGIN + 7);
      const w = doc.getTextWidth(weekdayName(date));
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(...MUTED);
      doc.text(longDate(date), MARGIN + w + 4, MARGIN + 7);
      doc.setFontSize(8);
      doc.text(scope ? `${APP.org} — ${APP.title} — ${scope.label}` : `${APP.org} — ${APP.title}`, PAGE_WIDTH - MARGIN, MARGIN + 4, { align: 'right' });
      doc.text(`Generated ${generated} ${APP.timezone.replace('_', ' ')}`, PAGE_WIDTH - MARGIN, MARGIN + 8.5, { align: 'right' });
      doc.setFontSize(8.5);
      doc.setTextColor(...INK);
      const summary = [
        `Reported ${totals.reported}/${totals.total}`,
        `Working ${totals.working}`,
        `Off ${totals.off}`,
        `Tasks ${totals.tasks}`,
        `Done ${totals.done}`,
        `Open ${totals.open}`,
        `Time ${formatMinutes(totals.minutes)}`,
        `Judged ${totals.judged}/${totals.reported}`,
        `Brownies ${totals.brownies}`,
      ];
      doc.text(summary.join('    '), MARGIN, MARGIN + 15);
      doc.setDrawColor(...LINE);
      doc.setLineWidth(0.3);
      doc.line(MARGIN, MARGIN + 18.5, PAGE_WIDTH - MARGIN, MARGIN + 18.5);
      doc.setFontSize(7.5);
      doc.setTextColor(...MUTED);
      doc.text(`${APP.org} internal`, MARGIN, 204);
    },
  });

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p += 1) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(`Page ${p} of ${pages}`, PAGE_WIDTH - MARGIN, 204, { align: 'right' });
  }
  doc.save(scope ? `inmyarc-${scope.file}-${date}.pdf` : `inmyarc-${date}.pdf`);
}
