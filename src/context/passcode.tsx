import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { api, setAdminPasscode } from '../lib/api';

interface PasscodeState {
  passcode: string | null;
  unlocked: boolean;
  unlock: (passcode: string) => Promise<void>;
  lock: () => void;
}

const PasscodeContext = createContext<PasscodeState>({
  passcode: null,
  unlocked: false,
  unlock: async () => {},
  lock: () => {},
});

export const usePasscode = (): PasscodeState => useContext(PasscodeContext);

/** The admin passcode lives in memory only; it is checked by the API and sent with every admin request. */
export function PasscodeProvider({ children }: { children: ReactNode }) {
  const [passcode, setPasscode] = useState<string | null>(null);

  const unlock = useCallback(async (value: string) => {
    await api.verify(value);
    setAdminPasscode(value);
    setPasscode(value);
  }, []);

  const lock = useCallback(() => {
    setAdminPasscode(null);
    setPasscode(null);
  }, []);

  return (
    <PasscodeContext.Provider value={{ passcode, unlocked: passcode !== null, unlock, lock }}>{children}</PasscodeContext.Provider>
  );
}
