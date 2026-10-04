import type { AuthTokens, DeviceActivationResponse, MeResponse } from '@sellwasl/validation';
import Constants from 'expo-constants';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { ApiClientError, request, setAccessToken, setRefreshHandler } from '@/api/client';
import { clearCatalogPhotos, useCatalogPhotoSync } from '@/catalog/photos';
import { useHeartbeat } from '@/device/heartbeat';
import { type DeviceProfile, secureStorage } from './storage';

/**
 * États du téléphone (UC-01) :
 * - needsActivation : aucun appareil associé, ou l'association a été révoquée ;
 * - loggedOut : appareil associé, mot de passe à saisir ;
 * - mustChangePassword : session ouverte avec un mot de passe provisoire, à changer d'abord ;
 * - loggedIn : session ouverte.
 */
type Status = 'loading' | 'needsActivation' | 'loggedOut' | 'mustChangePassword' | 'loggedIn';

interface AuthState {
  status: Status;
  profile: DeviceProfile | null;
  /** null hors connexion : le profil gardé sur le téléphone le remplace. */
  me: MeResponse | null;
  /** Session ouverte sans réseau, avec les données gardées sur le téléphone. */
  offline: boolean;
  /** Message à afficher (appareil révoqué, serveur injoignable…). */
  notice: string | null;
  activate: (code: string, password: string) => Promise<void>;
  login: (password: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  logout: () => Promise<void>;
  forgetDevice: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);
/** Le téléphone n'est plus associé : ses données locales sont effacées (BR-USR-11). */
const DEVICE_LOST = ['DEVICE_REVOKED', 'DEVICE_UNKNOWN'];
/** Le compte ou le téléphone est suspendu : retour à la connexion, association conservée. */
const ACCESS_PAUSED = ['DEVICE_BLOCKED', 'ACCOUNT_DISABLED', 'COMPANY_SUSPENDED'];

function profileFrom(me: MeResponse, series: string): DeviceProfile {
  return {
    userCode: me.user.code,
    firstName: me.user.firstName,
    lastName: me.user.lastName,
    companyName: me.company.name,
    roleName: me.role.name,
    roleCode: me.role.code,
    series,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [profile, setProfile] = useState<DeviceProfile | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);

  const deviceLost = useCallback(async (message: string) => {
    await secureStorage.clearAll();
    clearCatalogPhotos();
    setAccessToken(null);
    setProfile(null);
    setMe(null);
    setNotice(message);
    setStatus('needsActivation');
  }, []);

  const sessionClosed = useCallback(async (message: string | null) => {
    setOffline(false);
    await secureStorage.clearRefreshToken();
    setAccessToken(null);
    setMe(null);
    setNotice(message);
    setStatus('loggedOut');
  }, []);

  const openSession = useCallback(async (tokens: AuthTokens) => {
    setAccessToken(tokens.accessToken);
    if (tokens.refreshToken) await secureStorage.setRefreshToken(tokens.refreshToken);
    const nextMe = await request<MeResponse>('/me');
    setMe(nextMe);
    setNotice(null);
    setOffline(false);
    setStatus(nextMe.mustChangePassword ? 'mustChangePassword' : 'loggedIn');
  }, []);

  // Jeton d'accès expiré pendant l'utilisation : rotation silencieuse, sinon retour à la connexion.
  useEffect(() => {
    setRefreshHandler(async () => {
      const refreshToken = await secureStorage.getRefreshToken();
      if (!refreshToken) return false;
      try {
        const tokens = await request<AuthTokens>('/auth/refresh', {
          method: 'POST',
          body: JSON.stringify({ refreshToken }),
        });
        setAccessToken(tokens.accessToken);
        if (tokens.refreshToken) await secureStorage.setRefreshToken(tokens.refreshToken);
        return true;
      } catch (error) {
        if (error instanceof ApiClientError && DEVICE_LOST.includes(error.code))
          await deviceLost(error.message);
        else if (error instanceof ApiClientError && ACCESS_PAUSED.includes(error.code))
          await sessionClosed(error.message);
        else if (!(error instanceof ApiClientError && error.code === 'NETWORK'))
          await sessionClosed('Votre session a été fermée. Reconnectez-vous.');
        return false;
      }
    });
    return () => setRefreshHandler(null);
  }, [deviceLost, sessionClosed]);

  // Photos du catalogue gardées sur le téléphone, mises à jour à chaque session en ligne
  useCatalogPhotoSync(status === 'loggedIn' && !offline);

  // Hors connexion : nouvel essai toutes les 30 secondes, et au retour dans l'application
  const reconnect = useCallback(async () => {
    const refreshToken = await secureStorage.getRefreshToken();
    if (!refreshToken) return;
    try {
      await openSession(
        await request<AuthTokens>('/auth/refresh', {
          method: 'POST',
          body: JSON.stringify({ refreshToken }),
        }),
      );
    } catch (error) {
      if (!(error instanceof ApiClientError)) return;
      if (DEVICE_LOST.includes(error.code)) await deviceLost(error.message);
      else if (ACCESS_PAUSED.includes(error.code)) await sessionClosed(error.message);
      else if (error.code !== 'NETWORK')
        await sessionClosed('Votre session a été fermée. Reconnectez-vous.');
    }
  }, [openSession, deviceLost, sessionClosed]);

  useEffect(() => {
    if (!offline) return;
    const timer = setInterval(() => void reconnect(), 30_000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void reconnect();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [offline, reconnect]);

  // Signal de vie tant qu'une session est ouverte ; il révèle aussi un blocage ou une révocation.
  useHeartbeat((status === 'loggedIn' || status === 'mustChangePassword') && !offline, (error) => {
    if (DEVICE_LOST.includes(error.code)) void deviceLost(error.message);
    else if (ACCESS_PAUSED.includes(error.code)) void sessionClosed(error.message);
  });

  // Au démarrage : reprendre la session si le jeton de rafraîchissement est encore valable.
  useEffect(() => {
    void (async () => {
      const [deviceId, storedProfile, refreshToken] = await Promise.all([
        secureStorage.getDeviceId(),
        secureStorage.getProfile(),
        secureStorage.getRefreshToken(),
      ]);
      if (!deviceId) return setStatus('needsActivation');
      setProfile(storedProfile);
      if (!refreshToken) return setStatus('loggedOut');
      try {
        await openSession(
          await request<AuthTokens>('/auth/refresh', {
            method: 'POST',
            body: JSON.stringify({ refreshToken }),
          }),
        );
      } catch (error) {
        if (error instanceof ApiClientError && DEVICE_LOST.includes(error.code))
          return deviceLost(error.message);
        if (error instanceof ApiClientError && error.code === 'NETWORK') {
          // Session encore valable mais serveur injoignable : ouverture hors connexion
          setOffline(true);
          setNotice('Hors connexion : les données gardées sur le téléphone restent disponibles.');
          setStatus('loggedIn');
        } else {
          await sessionClosed(
            error instanceof ApiClientError && ACCESS_PAUSED.includes(error.code)
              ? error.message
              : null,
          );
        }
      }
    })();
  }, [openSession, deviceLost, sessionClosed]);

  const activate = useCallback(
    async (code: string, password: string) => {
      const result = await request<DeviceActivationResponse>('/auth/device/activate', {
        method: 'POST',
        body: JSON.stringify({
          code,
          password,
          device: {
            model: Platform.OS === 'android' ? String(Platform.constants.Model ?? '') : Platform.OS,
            osVersion: String(Platform.Version),
            appVersion: Constants.expoConfig?.version,
          },
        }),
      });
      const nextProfile = profileFrom(result.me, result.device.series);
      await secureStorage.saveDevice(result.device.id, nextProfile);
      setProfile(nextProfile);
      await openSession(result);
    },
    [openSession],
  );

  const login = useCallback(
    async (password: string) => {
      const deviceId = await secureStorage.getDeviceId();
      if (!deviceId) return setStatus('needsActivation');
      try {
        await openSession(
          await request<AuthTokens>('/auth/device/login', {
            method: 'POST',
            body: JSON.stringify({ deviceId, password }),
          }),
        );
      } catch (error) {
        if (error instanceof ApiClientError && DEVICE_LOST.includes(error.code))
          return deviceLost(error.message);
        throw error;
      }
    },
    [openSession, deviceLost],
  );

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    await request('/auth/password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const nextMe = await request<MeResponse>('/me');
    setMe(nextMe);
    setStatus(nextMe.mustChangePassword ? 'mustChangePassword' : 'loggedIn');
  }, []);

  const logout = useCallback(async () => {
    await request('/auth/logout', { method: 'POST' }).catch(() => undefined);
    await sessionClosed(null);
  }, [sessionClosed]);

  const forgetDevice = useCallback(async () => {
    await request('/auth/logout', { method: 'POST' }).catch(() => undefined);
    await deviceLost('');
    setNotice(null);
  }, [deviceLost]);

  return (
    <AuthContext.Provider
      value={{
        status,
        profile,
        me,
        offline,
        notice,
        activate,
        login,
        changePassword,
        logout,
        forgetDevice,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error('AuthProvider manquant');
  return value;
}
