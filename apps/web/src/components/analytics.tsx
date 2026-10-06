'use client';

import type { RateDto } from '@sellwasl/validation';
import type { ReactNode } from 'react';
import { Button, Field } from '@/components/ui';
import { getAccessToken } from '@/lib/api';
import { formatRate, shiftDate, todayDate } from '@/lib/labels';

export interface Period {
  from: string;
  to: string;
}

/** Période par défaut : le mois en cours jusqu'à aujourd'hui. */
export function monthToDate(): Period {
  const today = todayDate();
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

/** Période d'un rapport : raccourcis et dates libres (366 jours au plus). */
export function PeriodFields({
  value,
  onChange,
}: {
  value: Period;
  onChange: (period: Period) => void;
}) {
  const today = todayDate();
  const presets: [string, Period][] = [
    ["Aujourd'hui", { from: today, to: today }],
    ['7 jours', { from: shiftDate(today, -6), to: today }],
    ['Mois en cours', monthToDate()],
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <Field
        label="Du"
        type="date"
        value={value.from}
        onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })}
      />
      <Field
        label="Au"
        type="date"
        value={value.to}
        onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })}
      />
      <div className="flex flex-wrap gap-2">
        {presets.map(([label, period]) => (
          <Button
            key={label}
            variant={period.from === value.from && period.to === value.to ? 'primary' : 'secondary'}
            onClick={() => onChange(period)}
          >
            {label}
          </Button>
        ))}
      </div>
    </div>
  );
}

/** Un chiffre du dashboard : libellé, valeur, précision. */
export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border px-4 py-3">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-xl font-bold text-text-dark">{value}</span>
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </div>
  );
}

/** Taux avec son volume ; « volume insuffisant » sous le minimum de l'entreprise. */
export function Rate({ value }: { value: RateDto }) {
  return (
    <span
      className={value.insufficient ? 'text-muted' : undefined}
      title={`Volume : ${value.volume}`}
    >
      {formatRate(value)}
    </span>
  );
}

/** Onglets d'une page, sans changer d'adresse. */
export function LocalTabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-border" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={t.value === value}
          onClick={() => onChange(t.value)}
          className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${
            t.value === value
              ? 'border-primary text-primary'
              : 'border-transparent text-muted hover:text-primary'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Télécharge un export CSV de l'API (la session est envoyée avec la demande). */
export async function downloadCsv(path: string, filename: string): Promise<boolean> {
  const response = await fetch(`/api/v1${path}`, {
    headers: { Authorization: `Bearer ${getAccessToken('company') ?? ''}` },
  });
  if (!response.ok) return false;
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
  return true;
}
