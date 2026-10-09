import type { ButtonHTMLAttributes, ReactNode } from 'react';

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }) {
  const styles = {
    primary: 'bg-sea text-white hover:brightness-95',
    secondary: 'bg-white text-ink border border-line hover:border-sea',
    ghost: 'bg-transparent text-muted border border-line hover:text-ink',
    danger: 'bg-white text-danger border border-line hover:border-danger',
  }[variant];
  return (
    <button
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-3.5 text-[13px] font-bold active:translate-y-px disabled:opacity-45 ${styles} ${className}`}
      {...props}
    />
  );
}

export function Field({
  label,
  error,
  children,
  className = '',
}: {
  label: string;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`grid gap-1.5 ${className}`}>
      <span className="text-[11px] font-bold text-muted">{label}</span>
      {children}
      {error ? <span className="text-[12px] text-danger">{error}</span> : null}
    </label>
  );
}

const control =
  'h-10 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink outline-none focus:border-sea';

export function TextInput({ className = '', ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${control} ${className}`} {...props} />;
}

export function SelectInput({ className = '', ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`${control} ${className}`} {...props} />;
}

export function TextArea({ className = '', ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${control} h-24 py-2 ${className}`} {...props} />;
}

export function Badge({ tone = 'neutral', children }: { tone?: string; children: ReactNode }) {
  const styles =
    tone === 'ok'
      ? 'bg-ok-soft text-ok'
      : tone === 'warn'
        ? 'bg-warn-soft text-warn'
        : tone === 'danger'
          ? 'bg-danger-soft text-danger'
          : tone === 'info'
            ? 'bg-info-soft text-info'
            : 'bg-sea-soft text-sea-ink';
  return <span className={`inline-flex rounded-md px-2 py-1 text-[11px] font-bold ${styles}`}>{children}</span>;
}

export function PageHeader({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="m-0 text-[28px] font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1.5 mb-0 text-sm text-muted">{description}</p> : null}
      </div>
      {children ? <div className="flex flex-wrap gap-2">{children}</div> : null}
    </div>
  );
}

export function Banner({ children }: { children: ReactNode }) {
  return <div className="mb-4 rounded-lg bg-danger-soft px-3 py-2 text-sm font-semibold text-danger">{children}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-4 py-10 text-center text-sm text-muted">{children}</div>;
}

export function Modal({
  title,
  description,
  onClose,
  children,
  footer,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#041416]/70 p-4" onClick={onClose}>
      <div
        className="max-h-[calc(100dvh-2rem)] w-full max-w-2xl overflow-auto rounded-2xl bg-white text-ink shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="m-0 text-lg">{title}</h2>
            {description ? <p className="mt-1 mb-0 text-xs text-muted">{description}</p> : null}
          </div>
          <button className="text-sm font-bold text-muted" onClick={onClose} type="button">
            Close
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer ? <div className="flex justify-end gap-2 border-t border-line bg-[#f8fafa] px-5 py-3">{footer}</div> : null}
      </div>
    </div>
  );
}

export function Spinner() {
  return <div className="px-4 py-8 text-sm text-muted">Loading records...</div>;
}
