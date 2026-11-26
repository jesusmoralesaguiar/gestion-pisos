import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import {
  Button,
  Card,
  Chip,
  Dialog,
  FAB,
  IconButton,
  List,
  Portal,
  SegmentedButtons,
  Text,
  TextInput,
  useTheme,
} from 'react-native-paper';

import {
  createIncident,
  createProperty,
  createReminder,
  deleteProperty,
  getAllProperties,
  getOpenIncidents,
  updateIncidentStatus,
} from '@/db/database';
import type { IgicRegime, Incident, Property, PropertyRegime, TaxRegion } from '@/db/schema';
import { deleteAttachmentLocally } from '@/services/backup';
import { getLocalISODate, isValidISODate } from '@/utils/dates';
import { formatEUR } from '@/utils/format';

export default function PisosScreen() {
  const theme = useTheme();
  const [properties, setProperties] = useState<Property[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);

  // Nuevo piso dialog
  const [showAddProperty, setShowAddProperty] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [cadastralRef, setCadastralRef] = useState('');
  const [regime, setRegime] = useState<PropertyRegime>('residencial');
  const [taxRegion, setTaxRegion] = useState<TaxRegion>('canarias');
  const [igicRegime, setIgicRegime] = useState<IgicRegime>('repep');
  const [monthlyRent, setMonthlyRent] = useState('');
  const [paymentDay, setPaymentDay] = useState('5');
  const [tenantName, setTenantName] = useState('');

  // Nueva incidencia dialog
  const [incidentProperty, setIncidentProperty] = useState<Property | null>(null);
  const [incidentTitle, setIncidentTitle] = useState('');
  const [incidentDesc, setIncidentDesc] = useState('');

  // Nuevo aviso dialog
  const [reminderProperty, setReminderProperty] = useState<Property | null>(null);
  const [reminderTitle, setReminderTitle] = useState('');
  const [reminderDate, setReminderDate] = useState(() => getLocalISODate());

  const loadData = useCallback(async () => {
    const [props, inc] = await Promise.all([getAllProperties(), getOpenIncidents()]);
    setProperties(props);
    setIncidents(inc);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const handleSaveProperty = async () => {
    if (!name.trim()) {
      Alert.alert('Falta el nombre', 'Escribe un nombre corto para identificar el piso.');
      return;
    }
    const rent = Number(monthlyRent.replace(',', '.')) || 0;
    const day = Math.min(28, Math.max(1, Number(paymentDay) || 5));

    await createProperty({
      name,
      address,
      cadastral_ref: cadastralRef,
      regime,
      tax_region: taxRegion,
      igic_regime: taxRegion === 'canarias' && regime === 'vacacional' ? igicRegime : 'repep',
      monthly_rent: rent,
      payment_day: day,
      tenant_name: tenantName,
    });

    setName('');
    setAddress('');
    setCadastralRef('');
    setTaxRegion('canarias');
    setIgicRegime('repep');
    setMonthlyRent('');
    setTenantName('');
    setShowAddProperty(false);
    await loadData();
  };

  const handleDeleteProperty = (prop: Property) => {
    Alert.alert(
      'Eliminar piso',
      `¿Seguro que quieres eliminar "${prop.name}" y todos sus movimientos?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            const removedAttachments = await deleteProperty(prop.id);
            removedAttachments.forEach(deleteAttachmentLocally);
            await loadData();
          },
        },
      ]
    );
  };

  const handleSaveIncident = async () => {
    if (!incidentProperty || !incidentTitle.trim()) return;
    await createIncident({
      property_id: incidentProperty.id,
      title: incidentTitle,
      description: incidentDesc,
    });
    setIncidentProperty(null);
    setIncidentTitle('');
    setIncidentDesc('');
    await loadData();
  };

  const handleSaveReminder = async () => {
    if (!reminderProperty || !reminderTitle.trim()) return;
    const trimmedDate = reminderDate.trim();
    if (!isValidISODate(trimmedDate)) {
      Alert.alert('Fecha inválida', 'Introduce la fecha en formato AAAA-MM-DD (ej. 2026-11-30).');
      return;
    }
    await createReminder({
      property_id: reminderProperty.id,
      title: reminderTitle,
      category: 'otro',
      due_date: trimmedDate,
    });
    setReminderProperty(null);
    setReminderTitle('');
    await loadData();
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        {properties.length === 0 ? (
          <Card mode="outlined" style={styles.card}>
            <Card.Content style={{ gap: 12, alignItems: 'center', paddingVertical: 24 }}>
              <Text variant="titleMedium">No hay pisos registrados todavía</Text>
              <Text variant="bodyMedium" style={{ textAlign: 'center', color: theme.colors.onSurfaceVariant }}>
                Pulsa el botón «+ Nuevo piso» para dar de alta tu primer inmueble residencial o vacacional.
              </Text>
            </Card.Content>
          </Card>
        ) : (
          properties.map((prop) => {
            const propIncidents = incidents.filter((i) => i.property_id === prop.id);
            return (
              <Card key={prop.id} mode="elevated" style={styles.card}>
                <Card.Title
                  title={prop.name}
                  subtitle={prop.address || 'Sin dirección'}
                  right={() => (
                    <IconButton
                      icon="delete-outline"
                      iconColor={theme.colors.error}
                      onPress={() => handleDeleteProperty(prop)}
                    />
                  )}
                />
                <Card.Content style={{ gap: 8 }}>
                  <View style={styles.chipsRow}>
                    <Chip compact icon={prop.regime === 'vacacional' ? 'beach' : 'home-account'}>
                      {prop.regime === 'vacacional' ? 'Vacacional' : 'Residencial'}
                    </Chip>
                    <Chip compact icon="map-marker-outline">
                      {prop.tax_region === 'canarias'
                        ? prop.regime === 'vacacional'
                          ? prop.igic_regime === 'general_420'
                            ? 'Canarias · Mod. 420'
                            : 'Canarias · REPEP'
                          : 'Canarias · IGIC'
                        : 'Península · IVA'}
                    </Chip>
                    {prop.monthly_rent > 0 && (
                      <Chip compact icon="cash">
                        {formatEUR(prop.monthly_rent, { decimals: 0 })}/mes
                      </Chip>
                    )}
                    {prop.cadastral_ref ? (
                      <Chip compact icon="file-document-outline">
                        Catastro: {prop.cadastral_ref}
                      </Chip>
                    ) : null}
                  </View>

                  {prop.tenant_name ? (
                    <Text variant="bodyMedium">Inquilino: {prop.tenant_name}</Text>
                  ) : null}

                  {propIncidents.length > 0 && (
                    <View style={styles.incidentsBox}>
                      <Text variant="labelLarge" style={{ color: theme.colors.tertiary }}>
                        Incidencias abiertas:
                      </Text>
                      {propIncidents.map((inc) => (
                        <List.Item
                          key={inc.id}
                          title={inc.title}
                          description={inc.description || undefined}
                          right={() => (
                            <Button
                              compact
                              onPress={async () => {
                                await updateIncidentStatus(inc.id, 'resuelta');
                                await loadData();
                              }}>
                              Resolver
                            </Button>
                          )}
                        />
                      ))}
                    </View>
                  )}
                </Card.Content>
                <Card.Actions>
                  <Button
                    icon="wrench-outline"
                    onPress={() => setIncidentProperty(prop)}>
                    Incidencia
                  </Button>
                  <Button
                    icon="bell-plus-outline"
                    onPress={() => setReminderProperty(prop)}>
                    Aviso
                  </Button>
                </Card.Actions>
              </Card>
            );
          })
        )}
      </ScrollView>

      <FAB
        icon="plus"
        label="Nuevo piso"
        style={styles.fab}
        onPress={() => setShowAddProperty(true)}
      />

      {/* Dialog: Nuevo piso */}
      <Portal>
        <Dialog visible={showAddProperty} onDismiss={() => setShowAddProperty(false)}>
          <Dialog.Title>Nuevo inmueble</Dialog.Title>
          <Dialog.ScrollArea style={{ maxHeight: 420 }}>
            <ScrollView contentContainerStyle={{ gap: 10, paddingVertical: 8 }}>
              <TextInput
                label="Nombre corto (ej. Piso Centro)*"
                value={name}
                onChangeText={setName}
                mode="outlined"
              />
              <SegmentedButtons
                value={regime}
                onValueChange={(v) => setRegime(v as PropertyRegime)}
                buttons={[
                  { value: 'residencial', label: 'Residencial' },
                  { value: 'vacacional', label: 'Vacacional' },
                ]}
              />
              <SegmentedButtons
                value={taxRegion}
                onValueChange={(v) => setTaxRegion(v as TaxRegion)}
                buttons={[
                  { value: 'canarias', label: 'Canarias (IGIC)' },
                  { value: 'peninsula', label: 'Península (IVA)' },
                ]}
              />
              {taxRegion === 'canarias' && regime === 'vacacional' && (
                <SegmentedButtons
                  value={igicRegime}
                  onValueChange={(v) => setIgicRegime(v as IgicRegime)}
                  buttons={[
                    { value: 'repep', label: 'REPEP (Exento)' },
                    { value: 'general_420', label: 'General (Mod. 420)' },
                  ]}
                />
              )}
              <TextInput
                label="Dirección"
                value={address}
                onChangeText={setAddress}
                mode="outlined"
              />
              <TextInput
                label="Referencia Catastral (para Hacienda)"
                value={cadastralRef}
                onChangeText={setCadastralRef}
                autoCapitalize="characters"
                mode="outlined"
              />
              <TextInput
                label="Renta mensual habitual (€)"
                value={monthlyRent}
                onChangeText={setMonthlyRent}
                keyboardType="decimal-pad"
                mode="outlined"
              />
              {regime === 'residencial' && (
                <>
                  <TextInput
                    label="Día habitual de cobro (1-28)"
                    value={paymentDay}
                    onChangeText={setPaymentDay}
                    keyboardType="number-pad"
                    mode="outlined"
                  />
                  <TextInput
                    label="Nombre del inquilino"
                    value={tenantName}
                    onChangeText={setTenantName}
                    mode="outlined"
                  />
                </>
              )}
            </ScrollView>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button onPress={() => setShowAddProperty(false)}>Cancelar</Button>
            <Button mode="contained" onPress={handleSaveProperty}>
              Guardar
            </Button>
          </Dialog.Actions>
        </Dialog>

        {/* Dialog: Nueva incidencia */}
        <Dialog visible={!!incidentProperty} onDismiss={() => setIncidentProperty(null)}>
          <Dialog.Title>Incidencia en {incidentProperty?.name}</Dialog.Title>
          <Dialog.Content style={{ gap: 10 }}>
            <TextInput
              label="Título (ej. Fuga en grifo cocina)"
              value={incidentTitle}
              onChangeText={setIncidentTitle}
              mode="outlined"
            />
            <TextInput
              label="Descripción / técnico"
              value={incidentDesc}
              onChangeText={setIncidentDesc}
              multiline
              mode="outlined"
            />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setIncidentProperty(null)}>Cancelar</Button>
            <Button mode="contained" onPress={handleSaveIncident}>
              Guardar
            </Button>
          </Dialog.Actions>
        </Dialog>

        {/* Dialog: Nuevo aviso */}
        <Dialog visible={!!reminderProperty} onDismiss={() => setReminderProperty(null)}>
          <Dialog.Title>Aviso para {reminderProperty?.name}</Dialog.Title>
          <Dialog.Content style={{ gap: 10 }}>
            <TextInput
              label="Recordatorio (ej. Renovar seguro hogar)"
              value={reminderTitle}
              onChangeText={setReminderTitle}
              mode="outlined"
            />
            <TextInput
              label="Fecha (AAAA-MM-DD)"
              value={reminderDate}
              onChangeText={setReminderDate}
              mode="outlined"
            />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setReminderProperty(null)}>Cancelar</Button>
            <Button mode="contained" onPress={handleSaveReminder}>
              Guardar
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 14, paddingBottom: 96 },
  card: { borderRadius: 16 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  incidentsBox: { marginTop: 6 },
  fab: { position: 'absolute', right: 16, bottom: 16 },
});
