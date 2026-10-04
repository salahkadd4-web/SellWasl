import { colors, radius } from '@sellwasl/config';
import type { CustomerDto, OrderDto, VisitCatalog } from '@sellwasl/validation';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ApiClientError, request } from '@/api/client';
import { type CartEntry, entriesFromOrder, useCart } from '@/seller/cart';
import { errorMessage, formatDA, formatDate } from '@/seller/format';
import { ProductSheet } from '@/seller/ProductSheet';
import { WorkdayGuard } from '@/seller/WorkdayGuard';
import { newId, nextOrderNumber } from '@/sync/operations';
import { useToday } from '@/today/TodayContext';
import { Card, Input, Message, PrimaryButton, Title } from '@/ui';

/** Après une réinstallation, la séquence locale des commandes repart de zéro : on avance. */
const MAX_NUMBER_RETRIES = 20;

interface ConfirmResult {
  number: string;
  totalAmount: number;
  deliveryDate?: string;
  pendingLines: { variantId: string; qty: number }[];
  stockouts: { variantId: string; reservedQty: number; orderedQty: number }[];
}

/**
 * Commande prise pendant la visite (UC-14) ou modifiée (UC-17) : produits proposables au client,
 * panier calculé sur le téléphone, confirmation recalculée et figée par le serveur.
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
  const [catalog, setCatalog] = useState<VisitCatalog | null>(null);
  const [customer, setCustomer] = useState<CustomerDto | null>(null);
  const [existing, setExisting] = useState<OrderDto | null>(null);
  const [ready, setReady] = useState(!params.orderId);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const date = params.date ?? today?.date;

  useEffect(() => {
    if (!date) return;
    void Promise.all([
      request<VisitCatalog>(`/me/visit-catalog?customerId=${params.customerId}&date=${date}`),
      request<CustomerDto>(`/customers/${params.customerId}`),
      params.orderId ? request<OrderDto[]>(`/me/orders?date=${date}`) : Promise.resolve([]),
    ])
      .then(([c, cu, orders]) => {
        setCatalog(c);
        setCustomer(cu);
        const order = orders.find((o) => o.id === params.orderId) ?? null;
        setExisting(order);
        setReady(true);
      })
      .catch((e) => setError(errorMessage(e)));
  }, [date, params.customerId, params.orderId]);

  if (!ready || !catalog)
    return (
      <View style={styles.center}>
        {error ? <Message>{error}</Message> : <ActivityIndicator color={colors.primary} />}
      </View>
    );
  return (
    <OrderForm
      catalog={catalog}
      customerName={customer?.name ?? 'Commande'}
      existing={existing}
      visitId={params.visitId}
      query={query}
      setQuery={setQuery}
      editing={editing}
      setEditing={setEditing}
      busy={busy}
      error={error}
      onSubmit={async (lines, freeVariantChoices) => {
        setError(null);
        setBusy(true);
        try {
          let result: ConfirmResult | null = null;
          if (existing) {
            result = await act<ConfirmResult>('order.update', {
              orderId: existing.id,
              lines,
              freeVariantChoices,
            });
          } else {
            const series = today?.seller.series;
            if (!today || !series)
              throw new Error('Série du téléphone inconnue : reconnectez-vous.');
            for (let attempt = 0; !result && attempt < MAX_NUMBER_RETRIES; attempt += 1) {
              try {
                result = await act<ConfirmResult>('order.confirm', {
                  orderId: newId(),
                  number: await nextOrderNumber(today.seller.code, series),
                  visitId: params.visitId,
                  lines,
                  freeVariantChoices,
                });
              } catch (e) {
                if (!(e instanceof ApiClientError && e.code === 'DUPLICATE')) throw e;
              }
            }
            if (!result)
              throw new Error('Aucun numéro de commande libre. Contactez votre superviseur.');
          }
          showResult(result, catalog, existing !== null);
          router.dismissTo('/seller');
        } catch (e) {
          setError(errorMessage(e));
        } finally {
          setBusy(false);
        }
      }}
    />
  );
}

/** Résumé du serveur : son calcul fait foi (lignes en attente, ruptures). */
function showResult(result: ConfirmResult, catalog: VisitCatalog, updated: boolean) {
  const name = (variantId: string) =>
    catalog.products.flatMap((p) => p.variants).find((v) => v.id === variantId)?.name ?? 'Article';
  const parts = [
    `Total : ${formatDA(result.totalAmount)}.`,
    result.deliveryDate ? `Livraison le ${formatDate(result.deliveryDate)}.` : null,
    ...result.pendingLines.map((l) => `En attente (quota) : ${name(l.variantId)} × ${l.qty}.`),
    ...result.stockouts.map((s) => `Rupture : ${name(s.variantId)}, stock insuffisant au dépôt.`),
  ].filter(Boolean);
  Alert.alert(
    updated ? `Commande ${result.number} modifiée` : `Commande ${result.number} confirmée`,
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
  ) => Promise<void>;
}) {
  const initial = useMemo(() => (existing ? entriesFromOrder(existing.lines) : []), [existing]);
  const cart = useCart(catalog, initial);

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
        />
      </ScrollView>
    );

  const sellerChoiceRules = (cart.priced?.freeLines ?? [])
    .map((f) => catalog.catalog.bonusRules.find((r) => r.id === f.ruleId))
    .filter((r): r is NonNullable<typeof r> => r?.freeVariantMode === 'SELLER_CHOICE');

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Title subtitle={existing ? `Modification de ${existing.number}` : 'Nouvelle commande'}>
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
                {cart.pending.get(l.variantId)} en attente (quota atteint)
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
        <Text style={styles.totalText}>Total : {formatDA(cart.priced?.total ?? 0)}</Text>
        <Text style={styles.muted}>Le serveur confirme les prix, les quotas et le stock.</Text>
      </View>
      {error ? <Message>{error}</Message> : null}
      <WorkdayGuard>
        <PrimaryButton
          title={existing ? 'Enregistrer la modification' : 'Confirmer la commande'}
          onPress={() => void onSubmit(cart.lines, cart.freeChoices)}
          busy={busy}
          disabled={cart.lines.length === 0}
        />
      </WorkdayGuard>

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
