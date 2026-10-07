import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { type Href, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { request } from '@/api/client';
import { offlineEngine } from '@/offline/engine';

// Application ouverte : la notification s'affiche quand même en bannière
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * Autorisation, jeton Expo et envoi au serveur (`PUT /devices/push-token`). Sans projet EAS
 * (projectId) ni Firebase (google-services.json), aucun jeton : les notifications restent visibles
 * dans l'application (docs/notifications.md).
 */
export async function registerForPush(): Promise<string | null> {
  if (!Device.isDevice) return null;
  try {
    if (Platform.OS === 'android')
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Notifications',
        importance: Notifications.AndroidImportance.HIGH,
      });
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') ({ status } = await Notifications.requestPermissionsAsync());
    if (status !== 'granted') return null;
    const projectId =
      (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas
        ?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return null;
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    await request('/devices/push-token', {
      method: 'PUT',
      body: JSON.stringify({ pushToken: token }),
    });
    return token;
  } catch {
    // Push indisponible (Expo Go, Firebase absent) : l'application fonctionne sans
    return null;
  }
}

/** Enregistre le téléphone pour le push une fois connecté. */
export function usePushRegistration(enabled: boolean): void {
  useEffect(() => {
    if (enabled) void registerForPush();
  }, [enabled]);
}

/**
 * Écran des notifications du rôle : ouvert quand l'utilisateur touche une notification ; une
 * notification reçue application ouverte déclenche une synchronisation (liste à jour).
 */
export function useNotificationTaps(screen: Href): void {
  const router = useRouter();
  useEffect(() => {
    const tapped = Notifications.addNotificationResponseReceivedListener(() => {
      void offlineEngine.sync();
      router.push(screen);
    });
    const received = Notifications.addNotificationReceivedListener(() => {
      void offlineEngine.sync();
    });
    return () => {
      tapped.remove();
      received.remove();
    };
  }, [router, screen]);
}
