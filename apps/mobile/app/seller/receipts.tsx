import { ReceiptsScreen } from '@/printing/ReceiptsScreen';
import { useToday } from '@/today/TodayContext';

/** Bons du jour du vendeur (UC-34, UC-35). */
export default function SellerReceipts() {
  const { act } = useToday();
  return <ReceiptsScreen reprint={(number) => act('receipt.reprint', { number })} />;
}
