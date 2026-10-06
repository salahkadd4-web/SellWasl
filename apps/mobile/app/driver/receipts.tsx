import { openWorkday } from '@sellwasl/offline';
import { useSync } from '@/offline/SyncProvider';
import { ReceiptsScreen } from '@/printing/ReceiptsScreen';
import { sendOperation } from '@/sync/operations';

/** Bons du jour du livreur (UC-34, UC-35). */
export default function DriverReceipts() {
  const { local } = useSync();
  return (
    <ReceiptsScreen
      reprint={(number) =>
        sendOperation('receipt.reprint', { number }, (local && openWorkday(local)?.id) ?? null)
      }
    />
  );
}
