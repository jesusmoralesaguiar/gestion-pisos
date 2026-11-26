import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import {
  Button,
  Card,
  Divider,
  IconButton,
  Text,
  useTheme,
} from 'react-native-paper';

import { getFiscalSummaryByYear } from '@/db/database';
import type { PropertyFiscalSummary } from '@/db/schema';
import {
  exportBackupZip,
  exportFiscalExcel,
  importBackupZip,
  resetLocalDatabase,
} from '@/services/backup';
import { formatEUR } from '@/utils/format';

function formatPropertyFiscalSubtitle(s: PropertyFiscalSummary): string {
  const regimeLabel =
    s.regime === 'vacacional'
      ? 'Vacacional'
      : s.regime === 'local'
        ? 'Local comercial'
        : s.regime === 'garaje'
          ? 'Garaje'
          : 'Residencial';
  let taxLabel: string;
  if (s.tax_region === 'canarias') {
    if (s.regime !== 'residencial') {
      taxLabel =
        s.igic_regime === 'general_420'
          ? 'Canarias IGIC Mod. 420 (Base IRPF)'
          : 'Canarias REPEP (Total IRPF)';
    } else {
      taxLabel = 'Canarias · Exento IGIC (Total IRPF)';
    }
  } else if (s.tax_region === 'peninsula') {
    taxLabel = 'Península · IVA (Total IRPF)';
  } else {
    taxLabel = 'Régimen fiscal general (Total IRPF)';
  }
  const ownerSuffix = s.owner_name ? ` · Titular: ${s.owner_name}` : '';
  const refSuffix = s.cadastral_ref ? ` · Ref: ${s.cadastral_ref}` : '';
  return `${regimeLabel} · ${taxLabel}${ownerSuffix}${refSuffix}`;
}

export default function FiscalScreen() {
  const theme = useTheme();
  const [year, setYear] = useState(new Date().getFullYear());
  const [summaries, setSummaries] = useState<PropertyFiscalSummary[]>([]);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    const rows = await getFiscalSummaryByYear(year);
    setSummaries(rows);
  }, [year]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const totalIncome = summaries.reduce((acc, s) => acc + s.total_income, 0);
  const totalExpense = summaries.reduce((acc, s) => acc + s.total_expense, 0);
  const totalNet = totalIncome - totalExpense;

  const handleExportExcel = async () => {
    setBusyAction('excel');
    try {
      await exportFiscalExcel(year);
    } catch (err) {
      Alert.alert('Error al exportar Excel', (err as Error).message);
    } finally {
      setBusyAction(null);
    }
  };

  const handleExportZip = async () => {
    setBusyAction('zip_export');
    try {
      await exportBackupZip();
    } catch (err) {
      Alert.alert('Error al exportar copia', (err as Error).message);
    } finally {
      setBusyAction(null);
    }
  };

  const handleImportZip = () => {
    Alert.alert(
      'Importar copia de seguridad',
      'Esto reemplazará los datos actuales de este móvil por los de la copia seleccionada. ¿Continuar?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Seleccionar .zip',
          onPress: async () => {
            setBusyAction('zip_import');
            try {
              const res = await importBackupZip();
              await loadData();
              Alert.alert(
                'Copia restaurada',
                `Base de datos cargada: ${res.importedProperties} inmuebles y ${res.importedAttachments} facturas/adjuntos importados.`
              );
            } catch (err) {
              const msg = (err as Error).message;
              if (msg !== 'CANCELLED') {
                Alert.alert('Error al importar', msg);
              }
            } finally {
              setBusyAction(null);
            }
          },
        },
      ]
    );
  };

  const handleResetDatabase = () => {
    Alert.alert(
      'Reiniciar datos de este móvil',
      'Se eliminarán todos los pisos, movimientos, incidencias, avisos y facturas guardadas en este dispositivo para empezar desde cero. ¿Seguro?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Borrar todo y reiniciar',
          style: 'destructive',
          onPress: async () => {
            setBusyAction('reset');
            try {
              await resetLocalDatabase();
              await loadData();
              Alert.alert(
                'Base de datos reiniciada',
                'La aplicación está lista con una base de datos vacía.'
              );
            } catch (err) {
              Alert.alert('Error al reiniciar', (err as Error).message);
            } finally {
              setBusyAction(null);
            }
          },
        },
      ]
    );
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      contentContainerStyle={styles.content}>
      {/* Selector de año y totales */}
      <Card mode="elevated" style={styles.card}>
        <Card.Content style={{ gap: 12 }}>
          <View style={styles.yearRow}>
            <IconButton icon="chevron-left" onPress={() => setYear((y) => y - 1)} />
            <Text variant="headlineSmall" style={{ fontWeight: '700' }}>
              Ejercicio {year}
            </Text>
            <IconButton icon="chevron-right" onPress={() => setYear((y) => y + 1)} />
          </View>

          <View style={styles.totalsRow}>
            <View style={{ flex: 1 }}>
              <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                Ingresos
              </Text>
              <Text variant="titleMedium" style={{ color: theme.colors.primary, fontWeight: '700' }}>
                {formatEUR(totalIncome, { showSign: true })}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                Gastos
              </Text>
              <Text variant="titleMedium" style={{ color: theme.colors.error, fontWeight: '700' }}>
                {formatEUR(-totalExpense)}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                Neto
              </Text>
              <Text variant="titleMedium" style={{ fontWeight: '700' }}>
                {formatEUR(totalNet)}
              </Text>
            </View>
          </View>

          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
            Nota fiscal: las fianzas recibidas no computan como ingreso IRPF. En Canarias (Mod. 420)
            el IRPF se calcula sobre base imponible; en residencial o REPEP sobre el total.
          </Text>

          <Button
            mode="contained"
            icon="microsoft-excel"
            loading={busyAction === 'excel'}
            disabled={!!busyAction}
            onPress={handleExportExcel}>
            Exportar Excel para Gestoría ({year})
          </Button>
        </Card.Content>
      </Card>

      {/* Desglose por piso */}
      <Card mode="outlined" style={styles.card}>
        <Card.Title title="Desglose por inmueble" />
        <Card.Content>
          {summaries.length === 0 ? (
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
              No hay pisos registrados.
            </Text>
          ) : (
            summaries.map((s, idx) => (
              <View key={s.property_id}>
                {idx > 0 && <Divider style={{ marginVertical: 10 }} />}
                <Text variant="titleMedium" style={{ fontWeight: '600' }}>
                  {s.property_name}
                </Text>
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                  {formatPropertyFiscalSubtitle(s)}
                </Text>
                <View style={[styles.totalsRow, { marginTop: 6 }]}>
                  <Text variant="bodyMedium" style={{ color: theme.colors.primary }}>
                    {formatEUR(s.total_income, { showSign: true })}
                  </Text>
                  <Text variant="bodyMedium" style={{ color: theme.colors.error }}>
                    {formatEUR(-s.total_expense)}
                  </Text>
                  <Text variant="bodyMedium" style={{ fontWeight: '700' }}>
                    Neto: {formatEUR(s.net_yield)}
                  </Text>
                </View>
              </View>
            ))
          )}
        </Card.Content>
      </Card>

      {/* Copia de seguridad familiar */}
      <Card mode="outlined" style={styles.card}>
        <Card.Title
          title="Copia de seguridad familiar (.zip)"
          subtitle="Coste 0€ · Comparte por WhatsApp o Google Drive"
        />
        <Card.Content style={{ gap: 10 }}>
          <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
            Empaqueta toda la base de datos y las fotos/PDFs de facturas en un solo archivo para
            guardarlo a salvo o pasarlo al móvil de otro familiar.
          </Text>
          <Button
            mode="contained-tonal"
            icon="folder-zip-outline"
            loading={busyAction === 'zip_export'}
            disabled={!!busyAction}
            onPress={handleExportZip}>
            Exportar y compartir copia (.zip)
          </Button>
          <Button
            mode="outlined"
            icon="database-import-outline"
            loading={busyAction === 'zip_import'}
            disabled={!!busyAction}
            onPress={handleImportZip}>
            Importar copia (.zip) en este móvil
          </Button>
          <Button
            mode="text"
            icon="delete-forever-outline"
            textColor={theme.colors.error}
            loading={busyAction === 'reset'}
            disabled={!!busyAction}
            onPress={handleResetDatabase}>
            Reiniciar datos de este móvil
          </Button>
        </Card.Content>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 14, paddingBottom: 32 },
  card: { borderRadius: 16 },
  yearRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  totalsRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
});
