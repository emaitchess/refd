import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useState,
} from 'react';

const TOAST_MS = 4000;

interface ToastItem {
  id: number;
  text: string;
}

const ToastContext = createContext<(text: string) => void>(() => {});

export const useToast = () => useContext(ToastContext);

// App-wide transient notices, stacked bottom-center. Each clears itself after
// TOAST_MS; <output> carries an implicit polite live region.
export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const [items, setItems] = useState<ToastItem[]>([]);

  const show = useCallback((text: string) => {
    const id = Date.now() + Math.random();
    setItems((cur) => [...cur, { id, text }]);
    setTimeout(
      () => setItems((cur) => cur.filter((t) => t.id !== id)),
      TOAST_MS,
    );
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex flex-col items-center gap-2 px-4">
        {items.map((t) => (
          <output
            key={t.id}
            className="pointer-events-auto max-w-[420px] animate-[toast-in_0.2s_var(--ease-house)] border border-border-strong bg-bg-elevated px-4 py-2.5 text-[13px] text-primary shadow-lg backdrop-blur-md motion-reduce:animate-none"
          >
            {t.text}
          </output>
        ))}
      </div>
    </ToastContext.Provider>
  );
};
