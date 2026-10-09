import { colors } from '@sellwasl/config';
import type {
  InventoryDto,
  InventoryResult,
  Page,
  ProductDto,
  StockRowDto,
} from '@sellwasl/validation';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import { request } from '@/api/client';
import { idempotencyDone, idempotencyKey } from '@/api/idempotency';
import { errorMessage } from '@/seller/format';
import { Card, Input, Message, PrimaryButton, Screen, Title } from '@/ui';
import { useWarehouses } from '@/warehouse/warehouses';

const label = (a: { productName: string; variantName: string | null }) =>
  a.variantName ? `${a.productName} ${a.variantName}` : a.productName;

/**
 * Inventaire du dépôt (UC-44, BR-STK-06) : comptage enregistré au fur et à mesure, puis
 * validation ; chaque écart devient un ajustement. Un article non compté ne change pas.
 */
export default function InventoryScreen() {
  const { warehouses, error: warehousesError } = useWarehouses();
  const depot = warehouses.find((w) => w.type === 'DEPOT');
  const [draft, setDraft] = useState<InventoryDto | null | undefined>(undefined);
  const [rows, setRows] = useState<StockRowDto[]>([]);
  const [baseUnits, setBaseUnits] = useState<Map<string, string>>(new Map());
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!depot) return;
    try {
      const [inventories, stock, products] = await Promise.all([
        // Première page, les plus récents d'abord : le brouillon en cours y figure
        request<Page<InventoryDto>>('/inventories'),
        request<StockRowDto[]>(`/stock?warehouseId=${depot.id}`),
        request<ProductDto[]>('/products?status=ACTIVE'),
      ]);
      const open =
        inventories.data.find((i) => i.status === 'DRAFT' && i.warehouse.id === depot.id) ?? null;
      setDraft(open);
      setRows(stock);
      setBaseUnits(
        new Map(
          products.flatMap((p) => {
            const base = p.units.find((u) => u.isBase)!;
            return p.variants.map((v) => [v.id, base.id] as const);
          }),
        ),
      );
      setCounted(
        Object.fromEntries((open?.lines ?? []).map((l) => [l.variantId, String(l.countedQty)])),
      );
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [depot]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: 'start' | 'save' | 'validate') {
    if (!depot) return;
    setError(null);
    setInfo(null);
    const lines = Object.entries(counted)
      .filter(([, v]) => v.trim() !== '')
      .map(([variantId, v]) => ({ variantId, unitId: baseUnits.get(variantId)!, value: v.trim() }));
    if (lines.some((l) => !/^\d+$/.test(l.value)))
      return setError('Les quantités comptées doivent être des nombres entiers.');
    setBusy(true);
    try {
      if (action === 'start') {
        await request('/inventories', {
          method: 'POST',
          body: JSON.stringify({ warehouseId: depot.id }),
        });
      } else {
        await request(`/inventories/${draft!.id}/lines`, {
          method: 'PUT',
          body: JSON.stringify({
            lines: lines.map((l) => ({
              variantId: l.variantId,
              unitId: l.unitId,
              qty: Number(l.value),
            })),
          }),
        });
        if (action === 'validate') {
          const result = await request<InventoryResult>(`/inventories/${draft!.id}/validate`, {
            method: 'POST',
            headers: idempotencyKey(`inventory:${draft!.id}`),
          });
          idempotencyDone(`inventory:${draft!.id}`);
          setInfo(
            `Inventaire validé : ${result.adjustments} ajustement(s)${
              result.releasedLines.length
                ? `, ${result.releasedLines.length} ligne(s) de commande en rupture`
                : ''
            }.`,
          );
        } else setInfo('Comptage enregistré.');
      }
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (draft === undefined && !error && !warehousesError)
    return <ActivityIndicator style={styles.loader} color={colors.primary} />;

  const visible = rows.filter((r) => label(r).toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <Screen>
      <Title subtitle={depot ? `${depot.code} · ${depot.name}` : undefined}>Inventaire</Title>
      {warehousesError ? <Message>{warehousesError}</Message> : null}
      {info ? <Message tone="info">{info}</Message> : null}
      {draft === null ? (
        <Card>
          <Text style={styles.muted}>Aucun inventaire en cours pour ce dépôt.</Text>
          <PrimaryButton
            title="Commencer l'inventaire"
            busy={busy}
            onPress={() => void run('start')}
          />
        </Card>
      ) : null}
      {draft ? (
        <>
          <Text style={styles.muted}>
            Quantités en unité de base. Un champ vide : article non compté.
          </Text>
          <Input label="Rechercher un article" value={search} onChangeText={setSearch} />
          {visible.map((r) => (
            <View key={r.variantId} style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.name}>{label(r)}</Text>
                <Text style={styles.muted}>Attendu {r.physical}</Text>
              </View>
              <TextInput
                accessibilityLabel={`Compté pour ${label(r)}`}
                keyboardType="number-pad"
                value={counted[r.variantId] ?? ''}
                onChangeText={(v) => setCounted((c) => ({ ...c, [r.variantId]: v }))}
                placeholder="—"
                placeholderTextColor={colors.muted}
                style={styles.qty}
              />
            </View>
          ))}
          <PrimaryButton
            title="Enregistrer le comptage"
            variant="secondary"
            busy={busy}
            onPress={() => void run('save')}
          />
          <PrimaryButton
            title="Valider l'inventaire"
            disabled={busy}
            onPress={() =>
              Alert.alert(
                "Valider l'inventaire ?",
                'Le stock du dépôt prendra les quantités comptées.',
                [
                  { text: 'Annuler', style: 'cancel' },
                  { text: 'Valider', onPress: () => void run('validate') },
                ],
              )
            }
          />
        </>
      ) : null}
      {error ? <Message>{error}</Message> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  loader: { flex: 1 },
  muted: { fontSize: 14, color: colors.muted },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowText: { flex: 1, gap: 2 },
  name: { fontSize: 16, fontWeight: '600', color: colors.textDark },
  qty: {
    width: 90,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 18,
    textAlign: 'right',
    color: colors.textDark,
    backgroundColor: colors.background,
  },
});
