import type { AuthTokens, DeviceActivationResponse, MeResponse } from '@sellwasl/validation';
import Constants from 'expo-constants';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { ApiClientError, request, setAccessToken, setRefreshHandler } from '@/api/client';
import { type DeviceProfile, secureStorage } from './storage';

/**
 * États du téléphone (UC-01) :
 * - needsActivation : aucun appareil associé, ou l'association a été révoquée ;
 * - loggedOut : appareil associé, mot de passe à saisir ;
 * - loggedIn : session ouverte.
 */
type Status = 'loading' | 'needsActivation' | 'loggedOut' | 'loggedIn';

interface AuthState {
  status: Status;
  profile: DeviceProfile | null;
  me: MeResponse | null;
  /** Message à afficher (appareil révoqué, serveur injoignable…). */
  notice: string | null;
  activate: (code: string, password: string) => Promise<void>;
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
  forgetDevice: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);
const DEVICE_LOST = ['DEVICE_REVOKED', 'DEVICE_BLOCKED', 'DEVICE_UNKNOWN'];

function profileFrom(me: MeResponse, series: string): DeviceProfile {
  return {
    userCode: me.user.code,
    firstName: me.user.firstName,
    lastName: me.user.lastName,
    companyName: me.company.name,
    roleName: me.role.name,
    series,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [profile, setProfile] = useState<DeviceProfile | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const deviceLost = useCallback(async (message: string) => {
    await secureStorage.clearAll();
    setAccessToken(null);
    setProfile(null);
    setMe(null);
    setNotice(message);
    setStatus('needsActivation');
  }, []);

  const openSession = useCallback(async (tokens: AuthTokens) => {
    setAccessToken(tokens.accessToken);
    if (tokens.refreshToken) await secureStorage.setRefreshToken(tokens.refreshToken);
    setMe(await request<MeResponse>('/me'));
    setNotice(null);
    setStatus('loggedIn');
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
        else if (!(error instanceof ApiClientError && error.code === 'NETWORK')) {
          await secureStorage.clearRefreshToken();
          setAccessToken(null);
          setStatus('loggedOut');
        }
        return false;
      }
    });
    return () => setRefreshHandler(null);
  }, [deviceLost]);

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
        if (error instanceof ApiClientError && error.code === 'NETWORK') setNotice(error.message);
        else await secureStorage.clearRefreshToken();
        setStatus('loggedOut');
      }
    })();
  }, [openSession, deviceLost]);

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

  const logout = useCallback(async () => {
    await request('/auth/logout', { method: 'POST' }).catch(() => undefined);
    await secureStorage.clearRefreshToken();
    setAccessToken(null);
    setMe(null);
    setStatus('loggedOut');
  }, []);

  const forgetDevice = useCallback(async () => {
    await request('/auth/logout', { method: 'POST' }).catch(() => undefined);
    await deviceLost('');
    setNotice(null);
  }, [deviceLost]);

  return (
    <AuthContext.Provider
      value={{ status, profile, me, notice, activate, login, logout, forgetDevice }}
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
