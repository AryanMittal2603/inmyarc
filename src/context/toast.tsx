import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { cx } from '../components/ui';

type Kind = 'ok' | 'error';
type Toast = (text: string, kind?: Kind) => void;

const ToastContext = createContext<Toast>(() => {});

export const useToast = (): Toast => useContext(ToastContext);

/** Bottom-centre toasts: dark for success (3.2s), red for errors (6s). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Array<{ id: number; kind: Kind; text: string }>>([]);
  const counter = useRef(0);
  const show = useCallback<Toast>((text, kind = 'ok') => {
    const id = ++counter.current;
    setItems((list) => [...list, { id, kind, text }]);
    window.setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), kind === 'error' ? 6000 : 3200);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed bottom-5 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            role="status"
            className={cx(
              'pointer-events-auto max-w-[90vw] rounded-sm border px-3 py-2 text-[12.5px] font-medium shadow-[0_8px_24px_-10px_rgba(23,23,26,0.35)]',
              t.kind === 'error' ? 'border-off/25 bg-off-bg text-off' : 'border-ink bg-ink text-white',
            )}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
