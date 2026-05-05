import { useToastStore, type ToastType } from '../store/toastStore';

const TYPE_STYLES: Record<ToastType, string> = {
  error:   'bg-red-900/90 border-red-700 text-red-100',
  warning: 'bg-yellow-900/90 border-yellow-700 text-yellow-100',
  info:    'bg-blue-900/90 border-blue-700 text-blue-100',
  success: 'bg-green-900/90 border-green-700 text-green-100',
};

const TYPE_ICONS: Record<ToastType, string> = {
  error: '✗',
  warning: '⚠',
  info: 'ℹ',
  success: '✓',
};

export default function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-1.5 pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          onClick={() => dismiss(toast.id)}
          className={`pointer-events-auto cursor-pointer border rounded px-3 py-1.5 text-xs shadow-lg backdrop-blur-sm flex items-center gap-2 animate-toast ${TYPE_STYLES[toast.type]}`}
        >
          <span className="text-base leading-none">{TYPE_ICONS[toast.type]}</span>
          <span>{toast.message}</span>
        </div>
      ))}
    </div>
  );
}
