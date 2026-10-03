'use client';

import type { MeResponse, PlatformMeResponse } from '@sellwasl/validation';
import { useRouter } from 'next/navigation';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { api, refreshSession, type Scope, setAccessToken } from './api';

type Status = 'loading' | 'authenticated' | 'anonymous';

interface AuthState<Me> {
  status: Status;
  me: Me | null;
  login: (body: Record<string, string>) => Promise<void>;
  logout: () => Promise<void>;
  can: (permission: string) => boolean;
}

function createAuth<Me>(
  scope: Scope,
  paths: { login: string; logout: string; me: string; loginPage: string },
) {
  const Context = createContext<AuthState<Me> | null>(null);

  function Provider({ children }: { children: ReactNode }) {
    const router = useRouter();
    const [status, setStatus] = useState<Status>('loading');
    const [me, setMe] = useState<Me | null>(null);

    const loadMe = useCallback(async () => {
      const data = await api<Me>(scope, paths.me);
      setMe(data);
      setStatus('authenticated');
    }, []);

    // Au chargement : le cookie de rafraîchissement redonne une session sans redemander le mot de passe.
    useEffect(() => {
      void (async () => {
        if (await refreshSession(scope)) {
          await loadMe().catch(() => setStatus('anonymous'));
        } else {
          setStatus('anonymous');
        }
      })();
    }, [loadMe]);

    const login = useCallback(
      async (body: Record<string, string>) => {
        const data = await api<{ accessToken: string }>(scope, paths.login, {
          method: 'POST',
          body: JSON.stringify(body),
        });
        setAccessToken(scope, data.accessToken);
        await loadMe();
      },
      [loadMe],
    );

    const logout = useCallback(async () => {
      await api(scope, paths.logout, { method: 'POST' }).catch(() => undefined);
      setAccessToken(scope, null);
      setMe(null);
      setStatus('anonymous');
      router.replace(paths.loginPage);
    }, [router]);

    const can = useCallback(
      (permission: string) =>
        !!me &&
        'permissions' in (me as object) &&
        (me as unknown as MeResponse).permissions.includes(permission),
      [me],
    );

    return (
      <Context.Provider value={{ status, me, login, logout, can }}>{children}</Context.Provider>
    );
  }

  function useAuth(): AuthState<Me> {
    const value = useContext(Context);
    if (!value) throw new Error('AuthProvider manquant');
    return value;
  }

  return { Provider, useAuth };
}

export const CompanyAuth = createAuth<MeResponse>('company', {
  login: '/auth/login',
  logout: '/auth/logout',
  me: '/me',
  loginPage: '/app/login',
});

export const PlatformAuth = createAuth<PlatformMeResponse>('platform', {
  login: '/platform/auth/login',
  logout: '/platform/auth/logout',
  me: '/platform/me',
  loginPage: '/admin/login',
});

/** Mémorise le code de l'entreprise pour la prochaine connexion (simple confort, peut échouer). */
export const rememberedCompany = {
  get(): string {
    try {
      return localStorage.getItem('sellwasl.company') ?? '';
    } catch {
      return '';
    }
  },
  set(code: string): void {
    try {
      localStorage.setItem('sellwasl.company', code);
    } catch {
      // stockage indisponible : on ignore
    }
  },
};

// Exports nommés : un composant serveur ne peut pas lire une propriété d'un module client.
export const CompanyAuthProvider = CompanyAuth.Provider;
export const PlatformAuthProvider = PlatformAuth.Provider;
