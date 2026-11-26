import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import {
  Button,
  Card,
  Chip,
  Divider,
  IconButton,
  List,
  Text,
  useTheme,
} from 'react-native-paper';

import {
  createTransaction,
  getAllProperties,
  getMonthlyRentPaidPropertyIds,
  getMonthTotals,
  getOpenIncidents,
  getPendingReminders,
  getRecentTransactions,
  toggleReminderCompleted,
} from '@/db/database';
import type { Incident, Property, Reminder, Transaction } from '@/db/schema';
import { getLocalISODate, getLocalYearMonth } from '@/utils/dates';
import { formatEUR } from '@/utils/format';

function getMonthLabel(yearMonth: string): string {
  const [year, month] = yearMonth.split('-');
  const months = [
    'Enero',
    'Febrero',
    'Marzo',
    'Abril',
    'Mayo',
    'Junio',
    'Julio',
    'Agosto',
    'Septiembre',
    'Octubre',
    'Noviembre',
    'Diciembre',
  ];
  const idx = Math.max(0, Math.min(11, Number(month) - 1));
  return `${months[idx]} ${year}`;
}

export default function InicioScreen() {
  const theme = useTheme();
  const router = useRouter();
  const currentMonth = getLocalYearMonth();

  const [refreshing, setRefreshing] = useState(false);
  const [payingPropertyId, setPayingPropertyId] = useState<number | null>(null);
  const payingInFlightRef = useRef<Set<number>>(new Set());
  const [properties, setProperties] = useState<Property[]>([]);
  const [paidIds, setPaidIds] = useState<Set<number>>(new Set());
  const [totals, setTotals] = useState({ income: 0, expense: 0 });
  const [recentTx, setRecentTx] = useState<Transaction[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);

  const loadData = useCallback(async () => {
    setRefreshing(true);
    try {
      const [props, paid, monthTotals, txs, inc, rem] = await Promise.all([
        getAllProperties(),
        getMonthlyRentPaidPropertyIds(currentMonth),
        getMonthTotals(currentMonth),
        getRecentTransactions(6),
        getOpenIncidents(),
        getPendingReminders(),
      ]);
      setProperties(props);
      setPaidIds(paid);
      setTotals(monthTotals);
      setRecentTx(txs);
      setIncidents(inc);
      setReminders(rem);
    } finally {
      setRefreshing(false);
    }
  }, [currentMonth]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const handleQuickMarkPaid = async (property: Property) => {
    if (payingInFlightRef.current.has(property.id) || paidIds.has(property.id)) {
      return;
    }
    payingInFlightRef.current.add(property.id);
    setPayingPropertyId(property.id);
    try {
      const today = getLocalISODate();
      await createTransaction({
        property_id: property.id,
        type: 'ingreso',
        category: property.regime === 'vacacional' ? 'Alquiler vacacional' : 'Alquiler mensual',
        amount: property.monthly_rent,
        base_amount: property.monthly_rent,
        vat_amount: 0,
        date: today,
        status: 'completado',
        description: `Cobro ${getMonthLabel(currentMonth)}`,
      });
      await loadData();
    } finally {
      payingInFlightRef.current.delete(property.id);
      setPayingPropertyId(null);
    }
  };

  const handleCompleteReminder = async (id: number) => {
    await toggleReminderCompleted(id, true);
    await loadData();
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={loadData} />}>
      {/* Resumen mensual */}
      <Card mode="elevated" style={styles.card}>
        <Card.Title
          title={`Resumen de ${getMonthLabel(currentMonth)}`}
          titleVariant="titleLarge"
        />
        <Card.Content>
          <View style={styles.summaryRow}>
            <View style={styles.summaryBox}>
              <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                Ingresos
              </Text>
              <Text variant="headlineSmall" style={{ color: theme.colors.primary, fontWeight: '700' }}>
                {formatEUR(totals.income, { showSign: true })}
              </Text>
            </View>
            <View style={styles.summaryBox}>
              <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                Gastos
              </Text>
              <Text variant="headlineSmall" style={{ color: theme.colors.error, fontWeight: '700' }}>
                {formatEUR(-totals.expense)}
              </Text>
            </View>
            <View style={styles.summaryBox}>
              <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                Balance
              </Text>
              <Text variant="headlineSmall" style={{ fontWeight: '700' }}>
                {formatEUR(totals.income - totals.expense)}
              </Text>
            </View>
          </View>
        </Card.Content>
      </Card>

      {/* Semáforo de cobros del mes */}
      <Card mode="outlined" style={styles.card}>
        <Card.Title
          title="Estado de cobros este mes"
          subtitle={
            properties.length === 0
              ? 'Añade tu primer piso en la pestaña Pisos'
              : `${paidIds.size} de ${properties.length} con ingresos registrados`
          }
        />
        <Card.Content>
          {properties.length === 0 ? (
            <Button mode="contained" icon="plus" onPress={() => router.push('/pisos')}>
              Añadir primer piso
            </Button>
          ) : (
            properties.map((prop, index) => {
              const isPaid = paidIds.has(prop.id);
              return (
                <View key={prop.id}>
                  {index > 0 && <Divider style={styles.divider} />}
                  <View style={styles.propertyRow}>
                    <View style={{ flex: 1, paddingRight: 8 }}>
                      <Text variant="titleMedium" style={{ fontWeight: '600' }}>
                        {prop.name}
                      </Text>
                      <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                        {prop.regime === 'vacacional'
                          ? 'Alquiler vacacional'
                          : `${formatEUR(prop.monthly_rent, { decimals: 0 })}/mes · Día ${prop.payment_day}`}
                      </Text>
                    </View>

                    {isPaid ? (
                      <Chip
                        icon="check-circle"
                        mode="flat"
                        style={{ backgroundColor: theme.colors.primaryContainer }}>
                        Cobrado
                      </Chip>
                    ) : prop.monthly_rent > 0 ? (
                      <Button
                        mode="contained-tonal"
                        compact
                        icon="cash-check"
                        loading={payingPropertyId === prop.id}
                        disabled={payingPropertyId === prop.id}
                        onPress={() => handleQuickMarkPaid(prop)}>
                        Cobrar {formatEUR(prop.monthly_rent, { decimals: 0 })}
                      </Button>
                    ) : (
                      <Chip icon="clock-outline" mode="outlined">
                        Sin cobros
                      </Chip>
                    )}
                  </View>
                </View>
              );
            })
          )}
        </Card.Content>
      </Card>

      {/* Avisos pendientes */}
      {reminders.length > 0 && (
        <Card mode="outlined" style={styles.card}>
          <Card.Title title="Avisos pendientes" />
          <Card.Content>
            {reminders.map((rem) => (
              <List.Item
                key={rem.id}
                title={rem.title}
                description={`${rem.property_name ? rem.property_name + ' · ' : ''}Vence: ${rem.due_date}`}
                left={(props) => <List.Icon {...props} icon="bell-ring-outline" />}
                right={() => (
                  <IconButton
                    icon="check-circle-outline"
                    onPress={() => handleCompleteReminder(rem.id)}
                  />
                )}
              />
            ))}
          </Card.Content>
        </Card>
      )}

      {/* Incidencias abiertas */}
      {incidents.length > 0 && (
        <Card mode="outlined" style={styles.card}>
          <Card.Title
            title={`Incidencias abiertas (${incidents.length})`}
            right={() => (
              <Button compact onPress={() => router.push('/pisos')}>
                Ver en Pisos
              </Button>
            )}
          />
          <Card.Content>
            {incidents.slice(0, 3).map((inc) => (
              <List.Item
                key={inc.id}
                title={inc.title}
                description={`${inc.property_name ?? ''} · Estado: ${inc.status}`}
                left={(props) => (
                  <List.Icon {...props} icon="wrench-outline" color={theme.colors.tertiary} />
                )}
              />
            ))}
          </Card.Content>
        </Card>
      )}

      {/* Últimos movimientos */}
      <Card mode="outlined" style={styles.card}>
        <Card.Title
          title="Últimos movimientos"
          right={() => (
            <Button compact onPress={() => router.push('/registrar')}>
              + Añadir
            </Button>
          )}
        />
        <Card.Content>
          {recentTx.length === 0 ? (
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
              Aún no hay cobros ni gastos registrados.
            </Text>
          ) : (
            recentTx.map((tx) => (
              <List.Item
                key={tx.id}
                title={`${tx.property_name ?? ''} · ${tx.category}`}
                description={`${tx.date}${tx.description ? ` · ${tx.description}` : ''}`}
                left={(props) => (
                  <List.Icon
                    {...props}
                    icon={tx.type === 'ingreso' ? 'arrow-down-circle' : 'arrow-up-circle'}
                    color={tx.type === 'ingreso' ? theme.colors.primary : theme.colors.error}
                  />
                )}
                right={() => (
                  <Text
                    variant="titleSmall"
                    style={{
                      alignSelf: 'center',
                      fontWeight: '700',
                      color: tx.type === 'ingreso' ? theme.colors.primary : theme.colors.error,
                    }}>
                    {formatEUR(tx.type === 'ingreso' ? tx.amount : -tx.amount, { showSign: true })}
                  </Text>
                )}
              />
            ))
          )}
        </Card.Content>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 14, paddingBottom: 32 },
  card: { borderRadius: 16 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginTop: 4 },
  summaryBox: { flex: 1 },
  propertyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  divider: { marginVertical: 4 },
});
