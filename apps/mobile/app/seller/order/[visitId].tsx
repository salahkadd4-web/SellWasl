import { Feather } from '@expo/vector-icons';
import { priceCart } from '@sellwasl/business-rules';
import { colors, radius } from '@sellwasl/config';
import { type BuiltOrder, buildOrder, customerView, visitCatalogView } from '@sellwasl/offline';
import type { OrderDto, VisitCatalog } from '@sellwasl/validation';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { photoUri } from '@/catalog/photos';
import { Chips, SearchField } from '@/components/Filters';
import { SwipeRow } from '@/components/SwipeRow';
import { useLocal, useSync } from '@/offline/SyncProvider';
import { printAfter } from '@/printing/printer';
import { type CartEntry, clearCartDraft, entriesFromOrder, useCart } from '@/seller/cart';
import { errorMessage, formatDA } from '@/seller/format';
import { ProductEditor } from '@/seller/ProductEditor';
import { WorkdayGuard } from '@/seller/WorkdayGuard';
import { newId, nextOrderNumber } from '@/sync/operations';
import { useToday } from '@/today/TodayContext';
import { Input, Message, PrimaryButton } from '@/ui';

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
  // Panier gardé quand le vendeur revient à la visite (refonte mobile)
  const draftKey = `${params.visitId}:${params.orderId ?? 'new'}`;

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
      draftKey={draftKey}
      onBackToVisit={() => router.back()}
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
            clearCartDraft(draftKey);
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
          clearCartDraft(draftKey);
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

type CatalogProduct = VisitCatalog['products'][number];

/** Une ligne de la liste des produits (maquette « Commande ») : photo, nom, gamme, prix, panier. */
function ProductRow({
  product,
  price,
  inCart,
  onOpen,
}: {
  product: CatalogProduct;
  price: string | null;
  /** Quantité au panier, déjà mise en forme (« 8 carton »). */
  inCart: string | null;
  onOpen: () => void;
}) {
  const uri = photoUri(product.id);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={product.name}
      accessibilityHint="Ouvre la saisie de la quantité"
      onPress={onOpen}
      style={({ pressed }) => [styles.productRow, pressed && { opacity: 0.7 }]}
    >
      {uri ? (
        <Image source={{ uri }} style={styles.photo} />
      ) : (
        <View style={[styles.photo, styles.noPhoto]}>
          <Feather name="package" size={24} color={colors.muted} />
        </View>
      )}
      <View style={styles.productText}>
        <Text style={styles.name} numberOfLines={2}>
          {product.name}
        </Text>
        <Text style={styles.muted} numberOfLines={1}>
          {[
            product.range.name,
            product.hasFlavors
              ? `${product.variants.length} parfum${product.variants.length > 1 ? 's' : ''}`
              : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
        {price ? <Text style={styles.price}>{price}</Text> : null}
        {product.variants.some((v) => v.quotaReached) ? (
          <Text style={styles.quota}>Quota atteint</Text>
        ) : null}
      </View>
      {inCart ? (
        <View style={styles.qtyBadge}>
          <Text style={styles.qtyBadgeText}>{inCart}</Text>
        </View>
      ) : (
        <Feather name="chevron-left" size={22} color={colors.muted} />
      )}
    </Pressable>
  );
}

function OrderForm({
  catalog,
  customerName,
  existing,
  draftKey,
  onBackToVisit,
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
  draftKey: string;
  onBackToVisit: () => void;
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
  const cart = useCart(catalog, initial, draftKey);
  const cashVan = catalog.truckStock !== undefined;
  const [step, setStep] = useState<'products' | 'summary'>('products');
  const [range, setRange] = useState('all');
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

  // Prix applicable au client pour une unité de la première unité (grille, BR-CAT-04)
  const prices = useMemo(() => {
    const result = new Map<string, string>();
    for (const p of catalog.products) {
      const variant = p.variants[0];
      const unit = p.units[0];
      if (!variant || !unit) continue;
      const priced = priceCart(
        catalog.catalog,
        [{ variantId: variant.id, unitId: unit.id, qty: 1 }],
        { customerTypeId: catalog.customerTypeId, date: catalog.date },
      );
      const line = priced.lines[0];
      if (line) result.set(p.id, `${formatDA(line.unitPrice)} / ${unit.name}`);
    }
    return result;
  }, [catalog]);

  const ranges = useMemo(() => {
    const byId = new Map(catalog.products.map((p) => [p.range.id, p.range.name]));
    return [...byId.entries()].map(([value, label]) => ({ value, label }));
  }, [catalog]);
  const q = query.trim().toLowerCase();
  const products = catalog.products.filter(
    (p) =>
      (range === 'all' || p.range.id === range) &&
      (!q || `${p.name} ${p.reference}`.toLowerCase().includes(q)),
  );
  const cartQty = (productId: string) => {
    const entry = cart.entries.find((e) => e.productId === productId);
    if (!entry) return null;
    const qty = Object.values(entry.qtyByVariant).reduce((a, b) => a + b, 0);
    return `${qty} ${unitName(entry.unitId)}`;
  };
  const sellerChoiceRules = (cart.priced?.freeLines ?? [])
    .map((f) => catalog.catalog.bonusRules.find((r) => r.id === f.ruleId))
    .filter((r): r is NonNullable<typeof r> => r?.freeVariantMode === 'SELLER_CHOICE');
  const subtitle = existing
    ? `Modification de ${existing.number}`
    : cashVan
      ? 'Vente depuis le camion'
      : 'Nouvelle commande';

  if (step === 'products')
    return (
      <View style={styles.screen}>
        <FlatList
          data={products}
          keyExtractor={(p) => p.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <View style={styles.header}>
              <Text style={styles.customer}>{customerName}</Text>
              <Text style={styles.muted}>{subtitle}</Text>
              <SearchField value={query} onChange={setQuery} placeholder="Rechercher un produit" />
              {ranges.length > 1 ? (
                <Chips
                  value={range}
                  onChange={setRange}
                  options={[{ value: 'all', label: 'Toutes les gammes' }, ...ranges]}
                />
              ) : null}
              <Text style={styles.muted}>
                Glissez un produit vers la gauche, ou touchez-le, pour saisir sa quantité.
              </Text>
            </View>
          }
          ListEmptyComponent={<Message tone="info">Aucun produit proposable.</Message>}
          renderItem={({ item }) => (
            <View style={styles.productCard}>
              <SwipeRow onOpen={() => setEditing(item.id)} openLabel="Quantité">
                <ProductRow
                  product={item}
                  price={prices.get(item.id) ?? null}
                  inCart={cartQty(item.id)}
                  onOpen={() => setEditing(editing === item.id ? null : item.id)}
                />
              </SwipeRow>
              {editing === item.id ? (
                <ProductEditor
                  product={item}
                  initial={cart.entries.find((e) => e.productId === item.id)}
                  onDone={(entry: CartEntry) => {
                    cart.put(entry);
                    setEditing(null);
                  }}
                  onCancel={() => setEditing(null)}
                  onRemove={
                    cart.entries.some((e) => e.productId === item.id)
                      ? () => {
                          cart.remove(item.id);
                          setEditing(null);
                        }
                      : undefined
                  }
                  truckStock={catalog.truckStock}
                  onLostDemand={cashVan ? onLostDemand : undefined}
                />
              ) : null}
            </View>
          )}
        />
        <View style={styles.cartBar}>
          <Feather name="shopping-cart" size={24} color={colors.primary} />
          <View style={styles.cartText}>
            <Text style={styles.muted}>
              {cart.entries.length} produit{cart.entries.length > 1 ? 's' : ''}
            </Text>
            <Text style={styles.cartTotal}>Total : {formatDA(total)}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Récapitulatif"
            accessibilityState={{ disabled: cart.lines.length === 0 }}
            disabled={cart.lines.length === 0}
            onPress={() => {
              setEditing(null);
              setStep('summary');
            }}
            style={({ pressed }) => [
              styles.next,
              (pressed || cart.lines.length === 0) && { opacity: 0.5 },
            ]}
          >
            <Text style={styles.nextText}>Récapitulatif</Text>
            <Feather name="chevron-right" size={20} color={colors.background} />
          </Pressable>
        </View>
      </View>
    );

  return (
    <ScrollView contentContainerStyle={styles.summary} keyboardShouldPersistTaps="handled">
      <View style={styles.header}>
        <Text style={styles.customer}>{customerName}</Text>
        <Text style={styles.muted}>Récapitulatif · {subtitle}</Text>
      </View>
      <View style={styles.panel}>
        {cart.priced?.lines.map((l) => (
          <View key={l.variantId} style={styles.summaryLine}>
            <View style={styles.summaryText}>
              <Text style={styles.line}>{variantName(l.variantId)}</Text>
              <Text style={styles.muted}>
                {l.qty} {unitName(l.unitId)} × {formatDA(l.unitPrice)}
                {l.tierMinQty !== null ? ' (palier)' : ''}
              </Text>
              {cart.pending.get(l.variantId) ? (
                <Text style={styles.warning}>
                  {cashVan
                    ? 'Quota dépassé : réduisez la quantité.'
                    : `${cart.pending.get(l.variantId)} en attente (quota atteint)`}
                </Text>
              ) : null}
            </View>
            <Text style={styles.amount}>{formatDA(l.total)}</Text>
          </View>
        ))}
        {cart.priced?.unpriced.length ? (
          <Message>Un article n'est plus proposable à ce client : retirez-le.</Message>
        ) : null}
      </View>
      {cart.priced?.freeLines.length ? (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Gratuit</Text>
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
                <Text style={styles.panelTitle}>Parfum offert : {rule.name}</Text>
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
        </View>
      ) : null}
      <View style={styles.totalBox}>
        <Feather name="dollar-sign" size={26} color={colors.muted} />
        <View style={styles.summaryText}>
          <Text style={styles.panelTitle}>Montant de la commande</Text>
          <Text style={styles.totalText}>Total : {formatDA(total)}</Text>
          <Text style={styles.muted}>Le serveur confirme les prix, les quotas et le stock.</Text>
        </View>
      </View>
      {error ? <Message>{error}</Message> : null}
      {cashVan && paying ? (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Encaissement</Text>
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
        </View>
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
      <PrimaryButton
        title="Modifier les produits"
        variant="secondary"
        onPress={() => setStep('products')}
      />
      <PrimaryButton title="Retour à la visite" variant="secondary" onPress={onBackToVisit} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  screen: { flex: 1, backgroundColor: colors.surface },
  list: { padding: 16, gap: 12 },
  header: { gap: 8, marginBottom: 4 },
  customer: { fontSize: 22, fontWeight: '700', color: colors.primary },
  productCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    overflow: 'hidden',
  },
  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    backgroundColor: colors.background,
  },
  photo: { width: 56, height: 56, borderRadius: radius.md, backgroundColor: colors.surface },
  noPhoto: { alignItems: 'center', justifyContent: 'center' },
  productText: { flex: 1, gap: 2 },
  name: { fontSize: 16, fontWeight: '700', color: colors.textDark },
  price: { fontSize: 15, fontWeight: '700', color: colors.successText },
  quota: { fontSize: 13, fontWeight: '600', color: colors.status.error },
  qtyBadge: {
    minWidth: 56,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: radius.md,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  qtyBadgeText: { fontSize: 14, fontWeight: '700', color: colors.textDark, textAlign: 'center' },
  cartBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  cartText: { flex: 1, gap: 2 },
  cartTotal: { fontSize: 18, fontWeight: '700', color: colors.textDark },
  next: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 48,
    paddingHorizontal: 16,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  nextText: { fontSize: 15, fontWeight: '700', color: colors.background },
  summary: { padding: 16, gap: 16, backgroundColor: colors.surface },
  panel: {
    gap: 12,
    padding: 16,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  panelTitle: { fontSize: 16, fontWeight: '700', color: colors.textDark },
  summaryLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  summaryText: { flex: 1, gap: 2 },
  line: { fontSize: 15, fontWeight: '600', color: colors.textDark },
  amount: { fontSize: 15, fontWeight: '700', color: colors.textDark },
  warning: { fontSize: 13, fontWeight: '600', color: colors.status.error },
  choice: { gap: 8 },
  totalBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: radius.lg,
    backgroundColor: colors.border,
  },
  totalText: { fontSize: 22, fontWeight: '700', color: colors.successText },
  muted: { fontSize: 14, color: colors.muted },
});
