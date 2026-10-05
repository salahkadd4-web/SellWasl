import type { DriverRouteDto } from '@sellwasl/validation';
import { request } from '@/api/client';
import { ReceiptsScreen } from '@/printing/ReceiptsScreen';
import { sendOperation } from '@/sync/operations';

/** Bons du jour du livreur (UC-34, UC-35). */
export default function DriverReceipts() {
  return (
    <ReceiptsScreen
      reprint={async (number) => {
        const route = await request<DriverRouteDto>('/me/route');
        return sendOperation('receipt.reprint', { number }, route.workday?.id ?? null);
      }}
    />
  );
}
