import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { X, AlertTriangle, CheckCircle, Info } from 'lucide-react';

function cn(...classes: (string | undefined | false | null)[]) {
  return classes.filter(Boolean).join(' ');
}

interface DialogOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'success' | 'info';
}

interface DialogContextType {
  showConfirm: (options: DialogOptions) => Promise<boolean>;
  showAlert: (options: Omit<DialogOptions, 'confirmText' | 'cancelText'>) => Promise<void>;
}

const DialogContext = createContext<DialogContextType | null>(null);

interface DialogState {
  isOpen: boolean;
  type: 'confirm' | 'alert';
  options: DialogOptions;
  resolve: ((value: boolean | void) => void) | null;
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<DialogState | null>(null);

  const showConfirm = useCallback((options: DialogOptions) => {
    return new Promise<boolean>((resolve) => {
      setDialog({
        isOpen: true,
        type: 'confirm',
        options: {
          confirmText: 'Confirm',
          cancelText: 'Cancel',
          variant: 'warning',
          ...options,
        },
        resolve: resolve as (value: boolean | void) => void,
      });
    });
  }, []);

  const showAlert = useCallback((options: Omit<DialogOptions, 'confirmText' | 'cancelText'>) => {
    return new Promise<void>((resolve) => {
      setDialog({
        isOpen: true,
        type: 'alert',
        options: {
          confirmText: 'OK',
          variant: 'info',
          ...options,
        },
        resolve: resolve as (value: boolean | void) => void,
      });
    });
  }, []);

  const handleClose = (result: boolean | void) => {
    setDialog(null);
    dialog?.resolve?.(result);
  };

  // Always render Provider so useDialog() always works
  return (
    <DialogContext.Provider value={{ showConfirm, showAlert }}>
      {children}

      {dialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="relative w-full max-w-md mx-4 bg-[#1a1d24] border border-white/10 rounded-xl shadow-2xl">
            <button
              onClick={() => handleClose(dialog.type === 'confirm' ? false : undefined)}
              className="absolute top-4 right-4 text-white/40 hover:text-white/80 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="p-6">
              <div className={cn(
                "w-12 h-12 rounded-full flex items-center justify-center mb-4",
                dialog.options.variant === 'danger' ? 'bg-rose-500/10'
                : dialog.options.variant === 'warning' ? 'bg-amber-500/10'
                : dialog.options.variant === 'success' ? 'bg-emerald-500/10'
                : 'bg-cyan-500/10'
              )}>
                {(() => {
                  const Icon = dialog.options.variant === 'danger' ? AlertTriangle
                    : dialog.options.variant === 'success' ? CheckCircle
                    : dialog.options.variant === 'warning' ? AlertTriangle
                    : Info;
                  const color = dialog.options.variant === 'danger' ? 'text-rose-400'
                    : dialog.options.variant === 'success' ? 'text-emerald-400'
                    : dialog.options.variant === 'warning' ? 'text-amber-400'
                    : 'text-cyan-400';
                  return <Icon className={cn("w-6 h-6", color)} />;
                })()}
              </div>

              {dialog.options.title && (
                <h3 className="text-lg font-semibold text-white mb-2">
                  {dialog.options.title}
                </h3>
              )}

              <p className="text-white/70 text-sm leading-relaxed">
                {dialog.options.message}
              </p>
            </div>

            <div className="px-6 py-4 border-t border-white/10 flex gap-3">
              {dialog.type === 'confirm' && (
                <button
                  onClick={() => handleClose(false)}
                  className="flex-1 px-4 py-2.5 bg-white/5 hover:bg-white/10 text-white/70 rounded-lg font-medium transition-colors"
                >
                  {dialog.options.cancelText}
                </button>
              )}
              <button
                onClick={() => handleClose(dialog.type === 'confirm' ? true : undefined)}
                className={cn(
                  "flex-1 px-4 py-2.5 rounded-lg font-medium transition-colors",
                  dialog.options.variant === 'danger'
                    ? 'bg-rose-500 hover:bg-rose-600 text-white'
                    : dialog.options.variant === 'warning'
                    ? 'bg-amber-500 hover:bg-amber-600 text-black'
                    : 'bg-cyan-500 hover:bg-cyan-600 text-black'
                )}
              >
                {dialog.options.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}
    </DialogContext.Provider>
  );
}

export function useDialog() {
  const context = useContext(DialogContext);
  if (!context) throw new Error('useDialog must be used within DialogProvider');
  return context;
}
