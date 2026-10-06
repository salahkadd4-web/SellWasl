'use client';

import type { CurrentCompensationDto } from '@sellwasl/validation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { todayDate } from '@/lib/labels';

/** Utilisateurs de l'entreprise avec leur salaire en vigueur (rémunération, acomptes, retenues). */
export function useEmployees(): CurrentCompensationDto[] {
  const [rows, setRows] = useState<CurrentCompensationDto[]>([]);
  useEffect(() => {
    api<CurrentCompensationDto[]>('company', '/compensations/current')
      .then(setRows)
      .catch(() => setRows([]));
  }, []);
  return rows;
}

/** Mois en cours, AAAA-MM. */
export const currentMonth = () => todayDate().slice(0, 7);
