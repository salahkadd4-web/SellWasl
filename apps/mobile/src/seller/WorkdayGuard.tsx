import type { ReactNode } from 'react';
import { useToday } from '@/today/TodayContext';
import { Message } from '@/ui';

/**
 * Hors journée en cours, le vendeur consulte seulement (BR-JOU-05) : les actions sont remplacées
 * par la raison.
 */
export function WorkdayGuard({ children }: { children: ReactNode }) {
  const { inProgress, today } = useToday();
  if (inProgress) return <>{children}</>;
  if (!today) return null;
  return (
    <Message tone="info">
      {today?.workday?.status === 'CLOSED'
        ? 'Journée clôturée : consultation seulement.'
        : 'Démarrez votre journée pour visiter, ajouter un client ou encaisser.'}
    </Message>
  );
}
