import { colors } from '@sellwasl/config';
import { type Href, Tabs, useFocusEffect, useRouter } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import { type ComponentProps, useCallback, useState } from 'react';
import { useUnreadCount } from '@/notifications/NotificationsScreen';
import { ActionSheet, type SheetAction } from './ActionSheet';
import { AppHeader } from './AppHeader';
import { TabBar, type TabItem } from './TabBar';

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

/**
 * Onglets du terrain (refonte mobile) : en-tête (menu, titre, cloche), barre du bas avec le bouton
 * + central. Les entrées du menu et du + sont déjà filtrées selon le rôle, les droits et les
 * modules par l'écran qui les fournit.
 */
export function FieldTabs({
  items,
  menu,
  quick,
  notificationsHref,
}: {
  items: (TabItem & { title: string })[];
  menu: SheetAction[];
  quick: SheetAction[];
  notificationsHref: Href;
}) {
  const router = useRouter();
  const unread = useUnreadCount();
  const [sheet, setSheet] = useState<'menu' | 'quick' | null>(null);
  // En-tête clair des onglets : icônes sombres ; les écrans de détail (en-tête marine) au-dessus
  // retrouvent les icônes claires
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle('dark');
      return () => setStatusBarStyle('light');
    }, []),
  );
  return (
    <>
      <Tabs
        tabBar={(props: TabBarProps) => (
          <TabBar
            state={props.state}
            navigation={props.navigation as unknown as ComponentProps<typeof TabBar>['navigation']}
            items={items}
            onPlus={() => setSheet('quick')}
          />
        )}
        screenOptions={{
          header: ({ options }) => (
            <AppHeader
              title={options.title ?? ''}
              onMenu={() => setSheet('menu')}
              onNotifications={() => router.push(notificationsHref)}
              unread={unread}
            />
          ),
          sceneStyle: { backgroundColor: colors.surface },
        }}
      >
        {items.map((item) => (
          <Tabs.Screen key={item.name} name={item.name} options={{ title: item.title }} />
        ))}
      </Tabs>
      <ActionSheet
        visible={sheet === 'menu'}
        title="Menu"
        actions={menu}
        onClose={() => setSheet(null)}
      />
      <ActionSheet
        visible={sheet === 'quick'}
        title="Actions rapides"
        actions={quick}
        onClose={() => setSheet(null)}
      />
    </>
  );
}
