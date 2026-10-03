import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react';

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' }) {
  const styles = {
    primary: 'bg-primary text-white hover:bg-deep-blue',
    secondary: 'border border-border bg-white text-primary hover:bg-surface',
    danger: 'border border-error/30 bg-white text-error hover:bg-error/5',
  }[variant];
  return (
    <button
      className={`inline-flex min-h-11 items-center justify-center rounded-lg px-4 font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${styles} ${className}`}
      {...props}
    />
  );
}

export function Field({
  label,
  hint,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-text-dark">{label}</span>
      <input
        className="min-h-11 rounded-lg border border-border bg-white px-3 text-text-dark outline-none focus:border-deep-blue focus:ring-2 focus:ring-deep-blue/20"
        {...props}
      />
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Alert({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-sm text-error"
    >
      {children}
    </p>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-border bg-white p-5 ${className}`}>{children}</div>
  );
}

export function FullPageMessage({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 text-muted">{children}</main>
  );
}

export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-20 flex items-end justify-center bg-black/40 sm:items-center sm:px-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 sm:max-w-lg sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-lg font-bold text-primary">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-muted hover:bg-surface"
            aria-label="Fermer"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Select({
  label,
  options,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  options: { value: string; label: string; disabled?: boolean }[];
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-text-dark">{label}</span>
      <select
        className="min-h-11 rounded-lg border border-border bg-white px-3 text-text-dark outline-none focus:border-deep-blue focus:ring-2 focus:ring-deep-blue/20"
        {...props}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Toggle({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description?: ReactNode;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-start gap-3 rounded-lg p-2 ${disabled ? '' : 'cursor-pointer hover:bg-surface'}`}
    >
      <input
        type="checkbox"
        className="mt-1 size-5 accent-[#001850]"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <span className="block font-medium text-text-dark">{label}</span>
        {description && <span className="block text-sm text-muted">{description}</span>}
      </span>
    </label>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}) {
  const styles = {
    neutral: 'bg-surface text-primary',
    success: 'bg-synced/10 text-synced',
    warning: 'bg-pending/15 text-[#92400e]',
    danger: 'bg-error/10 text-error',
  }[tone];
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${styles}`}>
      {children}
    </span>
  );
}

export function PageTitle({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold text-primary">{title}</h1>
        {subtitle && <p className="text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/** Mot de passe provisoire : affiché une seule fois (UC-80, UC-90). */
export function TemporaryPassword({ who, password }: { who: string; password: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-pending/40 bg-pending/10 p-4">
      <p className="text-sm text-text-dark">
        Mot de passe provisoire de <strong>{who}</strong>, à transmettre maintenant : il ne sera
        plus affiché.
      </p>
      <p className="select-all font-mono text-2xl font-bold tracking-wider text-primary">
        {password}
      </p>
      <p className="text-xs text-muted">Il devra être changé à la première connexion.</p>
    </div>
  );
}
