import type { HeartbeatInput, HeartbeatResponse } from '@sellwasl/validation';
import * as Battery from 'expo-battery';
import Constants from 'expo-constants';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { ApiClientError, request } from '@/api/client';

const DEFAULT_INTERVAL_MIN = 5;

async function batteryLevel(): Promise<number | null> {
  try {
    const level = await Battery.getBatteryLevelAsync();
    return level >= 0 ? Math.round(level * 100) : null;
  } catch {
    return null;
  }
}

/**
 * Signal de vie (architecture §11.3, BR-JOU-09) : envoyé à l'ouverture, au retour au premier plan
 * puis à l'intervalle fixé par l'entreprise, tant que l'application est ouverte. Pas d'envoi en
 * arrière-plan dans le MVP. La position sera ajoutée avec la journée de travail.
 */
export function useHeartbeat(active: boolean, onAuthError: (error: ApiClientError) => void): void {
  const onError = useRef(onAuthError);
  onError.current = onAuthError;

  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const schedule = (minutes: number) => {
      if (timer) clearTimeout(timer);
      if (!cancelled) timer = setTimeout(() => void send(), minutes * 60_000);
    };

    async function send() {
      if (AppState.currentState !== 'active') return;
      const body: HeartbeatInput = {
        batteryLevel: await batteryLevel(),
        pendingOps: 0, // file de synchronisation : phase de synchronisation
        appVersion: Constants.expoConfig?.version,
      };
      try {
        const reply = await request<HeartbeatResponse>('/devices/heartbeat', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        schedule(reply.intervalMin);
      } catch (error) {
        // Hors réseau : nouvel essai au prochain intervalle
        if (error instanceof ApiClientError && error.status !== 0 && error.status !== 429)
          onError.current(error);
        schedule(DEFAULT_INTERVAL_MIN);
      }
    }

    void send();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void send();
      else if (timer) clearTimeout(timer);
    });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      subscription.remove();
    };
  }, [active]);
}
