import { useCallback, useEffect, useState } from 'react';
import { ApiError, api, errorText } from '../lib/api';
import type { Session } from '../lib/types';

interface SessionState extends Session {
  loading: boolean;
  /** The API has no database yet. */
  needsSetup: boolean;
  error: string | null;
}

const EMPTY: SessionState = {
  adminConfigured: true,
  admin: false,
  manager: null,
  team: null,
  loading: true,
  needsSetup: false,
  error: null,
};

/** Who is signed in (super admin and/or one manager), and the team named by `team`, if any. */
export function useSession(team?: string) {
  const [state, setState] = useState<SessionState>(EMPTY);

  const refresh = useCallback(async () => {
    try {
      const s = await api.session(team);
      setState({ ...s, loading: false, needsSetup: false, error: null });
      return s;
    } catch (error) {
      const needsSetup = error instanceof ApiError && error.code === 'no_database';
      setState((prev) => ({ ...prev, loading: false, needsSetup, error: needsSetup ? null : errorText(error, 'Could not check your sign-in.') }));
      return null;
    }
  }, [team]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signInAdmin = useCallback(
    async (password: string) => {
      await api.signInAdmin(password);
      await refresh();
    },
    [refresh],
  );

  const signInManager = useCallback(
    async (password: string) => {
      if (!team) return;
      await api.signInManager(team, password);
      await refresh();
    },
    [team, refresh],
  );

  const signOut = useCallback(
    async (scope: 'admin' | 'manager') => {
      try {
        await api.signOut(scope);
      } finally {
        await refresh();
      }
    },
    [refresh],
  );

  return { ...state, refresh, signInAdmin, signInManager, signOut };
}
