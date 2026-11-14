export type Attendance = 'full_day' | 'wfh' | 'half_day' | 'week_off' | 'leave';
export type Status = 'done' | 'not_done' | 'rework';
export type Category = 'extraordinary' | 'over_performed' | 'upto_mark' | 'can_be_better' | 'not_upto_mark';
export type BrownieKey = 'overtime' | 'holiday' | 'hero';
export type Brownies = Record<BrownieKey, boolean>;

export interface Member {
  id: string;
  name: string;
  title: string | null;
  active: boolean;
}

export interface DayLog {
  id: string;
  member_id: string;
  log_date: string;
  attendance: Attendance;
  note: string | null;
  updated_at: string;
}

export interface Entry {
  id: string;
  log_date: string;
  member_id: string;
  created_by: string | null;
  title: string;
  details: string | null;
  status: Status;
  minutes: number | null;
  remarks: string | null;
  attachment_path: string | null;
  attachment_name: string | null;
  attachment_type: string | null;
  attachment_size: number | null;
  status_by: string | null;
  status_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Mark extends Brownies {
  member_id: string;
  log_date: string;
  category: Category;
  marked_at: string;
}

export interface Attachment {
  path: string;
  name: string;
  type: string | null;
  size: number;
}

export interface DayPayload {
  sig: string;
  today: string;
  openFrom: string;
  members: Member[];
  dayLogs: DayLog[];
  entries: Entry[];
  marks: Mark[];
}

export interface HistoryPayload {
  members: Member[];
  entries: Entry[];
  marks: Mark[];
  today: string;
}

export interface SetupStatus {
  database: boolean;
  ready: boolean;
  admin: boolean;
  files: boolean;
  members: number;
  entries: number;
  today: string;
  openFrom: string;
  error: string | null;
}

export interface ImportResult {
  members: number;
  dayLogs: number;
  entries: number;
  marks: number;
  files: { copied: number; failed: number; skipped: number };
}
