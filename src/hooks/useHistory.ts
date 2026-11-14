import { useCallback, useEffect, useState } from 'react';
import { api, errorText, type TeamScope } from '../lib/api';
import { historyRows, type HistoryRow } from '../lib/review';
import type { Entry, Member } from '../lib/types';

interface HistoryState {
  members: Member[];
  rows: HistoryRow[];
  entries: Entry[];
  loading: boolean;
  error: string | null;
}

const EMPTY: HistoryState = { members: [], rows: [], entries: [], loading: true, error: null };

/** Entries and verdicts for one team (or "*", every team) from `from` to today, loaded when `enabled`. */
export function useHistory(enabled: boolean, from: string, team: TeamScope) {
  const [state, setState] = useState<HistoryState>(EMPTY);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await api.history(from, team);
      setState({ members: res.members, rows: historyRows(res.entries, res.marks), entries: res.entries, loading: false, error: null });
    } catch (error) {
      setState((s) => ({ ...s, loading: false, error: errorText(error, 'Could not load history.') }));
    }
  }, [from, team]);

  useEffect(() => {
    if (enabled) void load();
  }, [enabled, load]);

  return { ...state, reload: load };
}
