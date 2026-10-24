import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

const ToastContext = createContext({ success() {}, error() {} });
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);
  const push = useCallback((kind, message) => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 4000);
  }, []);
  const value = useMemo(() => ({ success: (m) => push('success', m), error: (m) => push('error', m) }), [push]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (<div key={t.id} className={`toast ${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>{t.message}</div>))}
      </div>
    </ToastContext.Provider>
  );
}
