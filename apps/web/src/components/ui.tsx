import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

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
