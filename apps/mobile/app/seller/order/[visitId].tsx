import { colors, radius } from '@sellwasl/config';
import { type BuiltOrder, buildOrder, customerView, visitCatalogView } from '@sellwasl/offline';
import type { OrderDto, VisitCatalog } from '@sellwasl/validation';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocal, useSync } from '@/offline/SyncProvider';
import { printAfter } from '@/printing/printer';
import { type CartEntry, entriesFromOrder, useCart } from '@/seller/cart';
import { errorMessage, formatDA, formatDate } from '@/seller/format';
import { ProductSheet } from '@/seller/ProductSheet';
import { WorkdayGuard } from '@/seller/WorkdayGuard';
import { newId, nextOrderNumber } from '@/sync/operations';
import { useToday } from '@/today/TodayContext';
import { Card, Input, Message, PrimaryButton, Title } from '@/ui';

/**
 * Commande prise pendant la visite (UC-14) ou modifiée (UC-17) : produits proposables au client,
 * panier calculé sur le téléphone, enregistré sans réseau si besoin (phase 23), recalculé et figé
 * par le serveur à la réception. Vendeur cash
 * van : vente depuis le stock du camion, encaissée sur place (UC-60, BR-CV-03 à 05).
 */
export default function OrderScreen() {
  const params = useLocalSearchParams<{
    visitId: string;
    customerId: string;
    orderId?: string;
    date?: string;
  }>();
  const router = useRouter();
  const { today, act } = useToday();
  const { local, online, ready } = useSync();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const date = params.date ?? today?.date;

  // Catalogue, client et commande gardés sur le téléphone (phase 23)
  const { data: catalog, error: catalogError } = useLocal(
    (s) => (date ? visitCatalogView(s, params.customerId, date) : null),
    [params.customerId, date],
  );
  const { data: customer } = useLocal(
    (s) => customerView(s, params.customerId),
    [params.customerId],
  );
  const { data: existing } = useLocal(
    (s) => (params.orderId ? (s.orders.get(params.orderId) ?? null) : null),
    [params.orderId],
  );

  if (!ready || !catalog || (params.orderId && !existing))
    return (
      <View style={styles.center}>
        {ready ? (
          <Message>{catalogError ?? 'Données absentes du téléphone : synchronisez.'}</Message>
        ) : (
          <ActivityIndicator color={colors.primary} />
        )}
      </View>
    );
  return (
    <OrderForm
      catalog={catalog}
      customerName={customer?.name ?? 'Commande'}
      existing={existing ?? null}
      visitId={params.visitId}
      query={query}
      setQuery={setQuery}
      editing={editing}
      setEditing={setEditing}
      busy={busy}
      error={error}
      onLostDemand={async (variantId, qty) => {
        try {
          await act('lost_demand.create', {
            lostDemandId: newId(),
            customerId: params.customerId,
            variantId,
            qty,
          });
          return null;
        } catch (e) {
          return errorMessage(e);
        }
      }}
      onSubmit={async (lines, freeVariantChoices, cashAmount) => {
        setError(null);
        setBusy(true);
        try {
          if (!local || !customer || !date) throw new Error('Données absentes : synchronisez.');
          // Découpage calculé comme le serveur : il signalera ce qui diffère (BR-SYN-05)
          const built = buildOrder(local, {
            customerTypeId: customer.customerType.id,
            date,
            lines,
            freeVariantChoices,
            excludeOrderId: existing?.id,
            cashVan: cashAmount !== undefined,
          });
          if (cashAmount !== undefined) {
            const number = await nextNumber();
            await act('sale.confirm', {
              orderId: newId(),
              number,
              visitId: params.visitId,
              lines,
              freeVariantChoices,
              cashAmount,
              ...(online ? {} : { offline: true }),
            });
            const credit = Math.max(0, built.totalAmount - cashAmount);
            showSale({
              number,
              totalAmount: built.totalAmount,
              cashAmount: Math.min(cashAmount, built.totalAmount),
              creditAmount: credit,
              debtAmount: customer.debtAmount + credit,
              online,
            });
            printAfter(number);
            router.dismissTo('/seller');
            return;
          }
          const payload = { lines, freeVariantChoices, expected: built.expected };
          let number = existing?.number ?? '';
          if (existing) await act('order.update', { orderId: existing.id, ...payload });
          else {
            number = await nextNumber();
            await act('order.confirm', {
              orderId: newId(),
              number,
              visitId: params.visitId,
              ...payload,
            });
          }
          showResult(number, built, catalog, existing !== null, online);
          router.dismissTo('/seller');
        } catch (e) {
          setError(errorMessage(e));
        } finally {
          setBusy(false);
        }
      }}
    />
  );

  /** Numéro suivant de la série du téléphone (BR-CMD-07). */
  async function nextNumber(): Promise<string> {
    const series = today?.seller.series;
    if (!today || !series) throw new Error('Série du téléphone inconnue : reconnectez-vous.');
    return nextOrderNumber(today.seller.code, series);
  }
}

const SAVED_OFFLINE = 'Enregistrée sur le téléphone : elle partira au retour du réseau.';

function showSale(sale: {
  number: string;
  totalAmount: number;
  cashAmount: number;
  creditAmount: number;
  debtAmount: number;
  online: boolean;
}) {
  const parts = [
    `Total : ${formatDA(sale.totalAmount)}.`,
    `Encaissé : ${formatDA(sale.cashAmount)}.`,
    sale.creditAmount > 0 ? `Reste à crédit : ${formatDA(sale.creditAmount)}.` : null,
    sale.debtAmount > 0 ? `Dette du client : ${formatDA(sale.debtAmount)}.` : null,
    sale.online ? null : SAVED_OFFLINE,
  ].filter(Boolean);
  Alert.alert(`Vente ${sale.number} enregistrée`, parts.join('\n'));
}

/** Résumé calculé sur le téléphone ; le serveur recalcule et signale ce qui diffère. */
function showResult(
  number: string,
  built: BuiltOrder,
  catalog: VisitCatalog,
  updated: boolean,
  online: boolean,
) {
  const name = (variantId: string) =>
    catalog.products.flatMap((p) => p.variants).find((v) => v.id === variantId)?.name ?? 'Article';
  const parts = [
    `Total : ${formatDA(built.totalAmount)}.`,
    ...built.lines
      .filter((l) => l.kind === 'PENDING')
      .map((l) => `En attente (quota) : ${name(l.variantId)} × ${l.enteredQty}.`),
    ...built.lines
      .filter((l) => l.isStockout)
      .map((l) => `Rupture : ${name(l.variantId)}, stock insuffisant au dépôt.`),
    online ? null : SAVED_OFFLINE,
  ].filter(Boolean);
  Alert.alert(
    updated ? `Commande ${number} modifiée` : `Commande ${number} confirmée`,
    parts.join('\n'),
  );
}

function OrderForm({
  catalog,
  customerName,
  existing,
  query,
  setQuery,
  editing,
  setEditing,
  busy,
  error,
  onSubmit,
  onLostDemand,
}: {
  catalog: VisitCatalog;
  customerName: string;
  existing: OrderDto | null;
  visitId: string;
  query: string;
  setQuery: (q: string) => void;
  editing: string | null;
  setEditing: (productId: string | null) => void;
  busy: boolean;
  error: string | null;
  onSubmit: (
    lines: { variantId: string; unitId: string; qty: number }[],
    freeVariantChoices: Record<string, string>,
    /** Cash van seulement : montant encaissé. */
    cashAmount?: number,
  ) => Promise<void>;
  onLostDemand: (variantId: string, baseQty: number) => Promise<string | null>;
}) {
  const initial = useMemo(() => (existing ? entriesFromOrder(existing.lines) : []), [existing]);
  const cart = useCart(catalog, initial);
  const cashVan = catalog.truckStock !== undefined;
  const [paying, setPaying] = useState(false);
  const [cash, setCash] = useState('');
  const [cashError, setCashError] = useState<string | null>(null);
  const total = cart.priced?.total ?? 0;

  // Noms : catalogue du client, sinon lignes de la commande modifiée
  const variantName = (variantId: string) =>
    catalog.products.flatMap((p) => p.variants).find((v) => v.id === variantId)?.name ??
    existing?.lines.find((l) => l.variantId === variantId)?.variantName ??
    existing?.lines.find((l) => l.variantId === variantId)?.productName ??
    'Article';
  const unitName = (unitId: string) =>
    catalog.products.flatMap((p) => p.units).find((u) => u.id === unitId)?.name ??
    existing?.lines.find((l) => l.unitId === unitId)?.unitName ??
    '';

  const inCart = new Set(cart.entries.map((e) => e.productId));
  const q = query.trim().toLowerCase();
  const available = catalog.products.filter(
    (p) => !inCart.has(p.id) && (!q || `${p.name} ${p.reference}`.toLowerCase().includes(q)),
  );
  const editingProduct = editing ? catalog.products.find((p) => p.id === editing) : undefined;

  if (editingProduct)
    return (
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <ProductSheet
          product={editingProduct}
          initial={cart.entries.find((e) => e.productId === editingProduct.id)}
          onDone={(entry: CartEntry) => {
            cart.put(entry);
            setEditing(null);
            setQuery('');
          }}
          onCancel={() => setEditing(null)}
          truckStock={catalog.truckStock}
          onLostDemand={cashVan ? onLostDemand : undefined}
        />
      </ScrollView>
    );

  const sellerChoiceRules = (cart.priced?.freeLines ?? [])
    .map((f) => catalog.catalog.bonusRules.find((r) => r.id === f.ruleId))
    .filter((r): r is NonNullable<typeof r> => r?.freeVariantMode === 'SELLER_CHOICE');

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Title
        subtitle={
          existing
            ? `Modification de ${existing.number}`
            : cashVan
              ? 'Vente depuis le camion'
              : 'Nouvelle commande'
        }
      >
        {customerName}
      </Title>

      <Card title="Panier">
        {cart.entries.length === 0 ? (
          <Text style={styles.muted}>Choisissez les produits ci-dessous.</Text>
        ) : null}
        {cart.priced?.lines.map((l) => (
          <View key={l.variantId} style={styles.cartLine}>
            <Text style={styles.line}>
              {variantName(l.variantId)} : {l.qty} {unitName(l.unitId)} × {formatDA(l.unitPrice)}
              {l.tierMinQty !== null ? ' (palier)' : ''}
            </Text>
            <Text style={styles.amount}>{formatDA(l.total)}</Text>
            {cart.pending.get(l.variantId) ? (
              <Text style={styles.warning}>
                {cashVan
                  ? 'Quota dépassé : réduisez la quantité.'
                  : `${cart.pending.get(l.variantId)} en attente (quota atteint)`}
              </Text>
            ) : null}
          </View>
        ))}
        {cart.entries.map((e) => (
          <View key={e.productId} style={styles.actions}>
            <Text style={styles.muted}>
              {catalog.products.find((p) => p.id === e.productId)?.name ??
                variantName(Object.keys(e.qtyByVariant)[0]!)}
            </Text>
            <View style={styles.actionButtons}>
              {catalog.products.some((p) => p.id === e.productId) ? (
                <View style={styles.actionButton}>
                  <PrimaryButton
                    title="Modifier"
                    variant="secondary"
                    onPress={() => setEditing(e.productId)}
                  />
                </View>
              ) : null}
              <View style={styles.actionButton}>
                <PrimaryButton
                  title="Retirer"
                  variant="secondary"
                  onPress={() => cart.remove(e.productId)}
                />
              </View>
            </View>
          </View>
        ))}
        {cart.priced?.unpriced.length ? (
          <Message>Un article n'est plus proposable à ce client : retirez-le.</Message>
        ) : null}
      </Card>

      {cart.priced?.freeLines.length ? (
        <Card title="Gratuit">
          {cart.priced.freeLines.map((f) => (
            <Text key={`${f.ruleId}-${f.variantId}`} style={styles.line}>
              {variantName(f.variantId)} : {f.qty} {unitName(f.unitId)}
              {f.reducedForStock ? ' (réduit : stock insuffisant)' : ''}
            </Text>
          ))}
          {sellerChoiceRules.map((rule) => {
            const product = catalog.products.find((p) => p.id === rule.freeProductId);
            if (!product) return null;
            return (
              <View key={rule.id} style={styles.choice}>
                <Text style={styles.label}>Parfum offert : {rule.name}</Text>
                {product.variants.map((v) => (
                  <PrimaryButton
                    key={v.id}
                    title={v.name}
                    variant={cart.freeChoices[rule.id] === v.id ? 'primary' : 'secondary'}
                    onPress={() => cart.setFreeChoice(rule.id, v.id)}
                  />
                ))}
              </View>
            );
          })}
        </Card>
      ) : null}

      <View style={styles.total}>
        <Text style={styles.totalText}>Total : {formatDA(total)}</Text>
        <Text style={styles.muted}>Le serveur confirme les prix, les quotas et le stock.</Text>
      </View>
      {error ? <Message>{error}</Message> : null}
      {cashVan && paying ? (
        <Card title="Encaissement">
          <Input
            label="Montant encaissé (DA)"
            value={cash}
            onChangeText={setCash}
            keyboardType="number-pad"
          />
          <Text style={styles.muted}>
            Le reste passe en crédit si le client y a droit ; le serveur vérifie le minimum.
          </Text>
          {cashError ? <Message>{cashError}</Message> : null}
          <WorkdayGuard>
            <PrimaryButton
              title="Confirmer la vente"
              busy={busy}
              onPress={() => {
                const amount = Number(cash.replace(/\s/g, '') || '0');
                if (!Number.isInteger(amount) || amount < 0)
                  return setCashError('Saisissez un montant entier en dinars.');
                setCashError(null);
                void onSubmit(cart.lines, cart.freeChoices, amount);
              }}
            />
          </WorkdayGuard>
          <PrimaryButton
            title="Retour au panier"
            variant="secondary"
            onPress={() => setPaying(false)}
          />
        </Card>
      ) : cashVan ? (
        <WorkdayGuard>
          <PrimaryButton
            title="Encaisser"
            onPress={() => {
              setCash(String(total));
              setPaying(true);
            }}
            disabled={cart.lines.length === 0 || cart.pending.size > 0}
          />
        </WorkdayGuard>
      ) : (
        <WorkdayGuard>
          <PrimaryButton
            title={existing ? 'Enregistrer la modification' : 'Confirmer la commande'}
            onPress={() => void onSubmit(cart.lines, cart.freeChoices)}
            busy={busy}
            disabled={cart.lines.length === 0}
          />
        </WorkdayGuard>
      )}

      <Input label="Rechercher un produit" value={query} onChangeText={setQuery} />
      {available.length === 0 ? (
        <Message tone="info">Aucun autre produit proposable.</Message>
      ) : null}
      {available.map((p) => (
        <Pressable
          key={p.id}
          onPress={() => setEditing(p.id)}
          style={({ pressed }) => [styles.product, pressed && { opacity: 0.7 }]}
        >
          <View style={styles.productText}>
            <Text style={styles.name}>{p.name}</Text>
            <Text style={styles.muted}>
              {[
                p.range.name,
                p.hasFlavors
                  ? `${p.variants.length} parfum${p.variants.length > 1 ? 's' : ''}`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
          {p.variants.some((v) => v.quotaReached) ? (
            <Text style={styles.quota}>Quota atteint</Text>
          ) : null}
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, padding: 16, justifyContent: 'center', backgroundColor: colors.background },
  container: { padding: 16, gap: 16, backgroundColor: colors.background },
  cartLine: { gap: 2 },
  line: { fontSize: 15, color: colors.textDark },
  amount: { fontSize: 15, fontWeight: '700', color: colors.textDark },
  warning: { fontSize: 14, fontWeight: '600', color: colors.status.error },
  muted: { fontSize: 14, color: colors.muted },
  label: { fontWeight: '600', color: colors.textDark },
  actions: { gap: 4 },
  actionButtons: { flexDirection: 'row', gap: 8 },
  actionButton: { flex: 1 },
  choice: { gap: 8 },
  total: { gap: 4 },
  totalText: { fontSize: 20, fontWeight: '700', color: colors.primary },
  product: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
  },
  productText: { flex: 1, gap: 2 },
  name: { fontSize: 16, fontWeight: '600', color: colors.textDark },
  quota: { fontSize: 13, fontWeight: '700', color: colors.status.error },
});
