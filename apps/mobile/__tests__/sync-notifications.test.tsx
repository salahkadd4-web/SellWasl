import { loadState } from '@sellwasl/offline';
import { op, sellerRows } from '@sellwasl/offline/src/fixtures';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { NotificationsScreen } from '@/notifications/NotificationsScreen';
import { SyncScreen } from '@/offline/SyncScreen';
import { sendOperation } from '@/sync/operations';
import { fakeSync } from './fake-sync';

/** Synchronisation (BR-SYN-06, BR-SYN-07) et notifications (phase 24), sur le téléphone. */
describe('écran Synchronisation', () => {
  beforeEach(() => {
    fakeSync.local = loadState(sellerRows());
    fakeSync.syncNow.mockClear();
    fakeSync.markSeen.mockClear();
  });

  it('rien en attente : bouton Synchroniser', async () => {
    fakeSync.ops = [];
    await render(<SyncScreen />);
    expect(screen.getByText('Aucune opération en attente.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Synchroniser' }));
    await waitFor(() => expect(fakeSync.syncNow).toHaveBeenCalled());
  });

  it('opérations en attente, refusées et transformées par le serveur', async () => {
    fakeSync.ops = [
      op('visit.start', { customerId: 'c1' }),
      op(
        'order.confirm',
        {},
        {
          status: 'CONFLICT',
          seen: false,
          error: { code: 'BUSINESS_RULE', message: 'Client désactivé.' },
        },
      ),
      op('order.confirm', {}, {
        status: 'SYNCED',
        seen: false,
        changes: [{ kind: 'QUOTA_PENDING', productVariantId: 'TOM', pendingQty: 20 }],
      } as never),
    ];
    await render(<SyncScreen />);
    expect(screen.getByText('Actions refusées')).toBeOnTheScreen();
    expect(screen.getByText('Client désactivé.')).toBeOnTheScreen();
    expect(screen.getByText('Changements à la réception')).toBeOnTheScreen();
    expect(screen.getByText(/Thon tomate : quantité passée en attente/)).toBeOnTheScreen();
    expect(screen.getAllByText(/En attente/).length).toBeGreaterThan(0);
    await fireEvent.press(screen.getAllByRole('button', { name: "J'ai vu" })[0]!);
    await waitFor(() => expect(fakeSync.markSeen).toHaveBeenCalled());
  });
});

describe('écran Notifications', () => {
  beforeEach(() => jest.mocked(sendOperation).mockClear());

  it('liste, puis « marquer comme lu » par une action en file', async () => {
    fakeSync.local = loadState({
      ...sellerRows(),
      notification: [
        {
          id: 'n1',
          data: {
            id: 'n1',
            type: 'QUOTA_CHANGED',
            title: 'Quota modifié',
            body: 'Thon tomate : 10 cartons aujourd’hui.',
            href: null,
            createdAt: '2027-06-05T08:00:00.000Z',
            readAt: null,
          },
        },
      ],
    });
    await render(<NotificationsScreen />);
    expect(screen.getByText('Quota modifié')).toBeOnTheScreen();
    expect(screen.getByText('Thon tomate : 10 cartons aujourd’hui.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Marquer comme lu' }));
    expect(sendOperation).toHaveBeenCalledWith('notification.read', { notificationIds: ['n1'] });
  });

  it('aucune notification', async () => {
    fakeSync.local = loadState(sellerRows());
    await render(<NotificationsScreen />);
    expect(screen.getByText('Aucune notification.')).toBeOnTheScreen();
  });
});
