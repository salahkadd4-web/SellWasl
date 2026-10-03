'use client';

import { Card } from '@/components/ui';
import { PlatformAuth } from '@/lib/auth';

export default function PlatformHomePage() {
  const { me } = PlatformAuth.useAuth();
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold text-primary">Bonjour {me?.name}</h1>
      <Card>
        <p className="text-muted">
          La gestion des entreprises (création, mode, suspension) arrive en phase 8.
        </p>
      </Card>
    </div>
  );
}
