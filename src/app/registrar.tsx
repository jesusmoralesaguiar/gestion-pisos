import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useRouter } from 'expo-router';
import { type ComponentRef, useCallback, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import {
  Button,
  Card,
  Chip,
  SegmentedButtons,
  Snackbar,
  Text,
  TextInput,
  useTheme,
} from 'react-native-paper';

import { createTransaction, getAllProperties } from '@/db/database';
import {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  type Property,
  type TransactionType,
} from '@/db/schema';
import {
  compressAndSaveImageAttachment,
  deleteAttachmentLocally,
  saveAttachmentLocally,
} from '@/services/backup';
import { getLocalISODate, isValidISODate } from '@/utils/dates';
import { formatEUR } from '@/utils/format';

export default function RegistrarScreen() {
  const theme = useTheme();
  const router = useRouter();

  const [properties, setProperties] = useState<Property[]>([]);
  const [selectedPropertyId, setSelectedPropertyId] = useState<number | null>(null);
  const [type, setType] = useState<TransactionType>('gasto');
  const [category, setCategory] = useState<string>(EXPENSE_CATEGORIES[0]);
  const [amount, setAmount] = useState('');
  const [vatAmount, setVatAmount] = useState('');
  const [date, setDate] = useState(() => getLocalISODate());
  const [description, setDescription] = useState('');
  const [attachmentName, setAttachmentName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [snackbarMsg, setSnackbarMsg] = useState('');

  const scrollViewRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const detailsCardYRef = useRef<number>(0);
  const inputOffsetsRef = useRef<Record<string, number>>({});

  const scrollToField = (key: string) => {
    const y = Math.max(0, detailsCardYRef.current + (inputOffsetsRef.current[key] ?? 0) - 96);
    setTimeout(() => {
      scrollViewRef.current?.scrollTo({ y, animated: true });
    }, 120);
  };

  useFocusEffect(
    useCallback(() => {
      getAllProperties().then((props) => {
        setProperties(props);
        if (props.length > 0 && !selectedPropertyId) {
          setSelectedPropertyId(props[0].id);
        }
      });
    }, [selectedPropertyId])
  );

  const handleTypeChange = (newType: string) => {
    const typed = newType as TransactionType;
    setType(typed);
    setCategory(typed === 'ingreso' ? INCOME_CATEGORIES[0] : EXPENSE_CATEGORIES[0]);
  };

  const handleTakePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permiso necesario', 'Necesitamos permiso de cámara para fotografiar la factura.');
      return;
    }
    const res = await ImagePicker.launchCameraAsync({
      quality: 0.75,
    });
    if (!res.canceled && res.assets?.[0]) {
      const saved = await compressAndSaveImageAttachment(res.assets[0].uri);
      if (attachmentName) {
        deleteAttachmentLocally(attachmentName);
      }
      setAttachmentName(saved);
    }
  };

  const handlePickDocument = async () => {
    const res = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/*'],
      copyToCacheDirectory: true,
    });
    if (!res.canceled && res.assets?.[0]) {
      const asset = res.assets[0];
      const isImage = asset.mimeType?.startsWith('image/') ?? false;
      const saved = isImage
        ? await compressAndSaveImageAttachment(asset.uri)
        : await saveAttachmentLocally(asset.uri, asset.name.split('.').pop() || 'pdf');
      if (attachmentName) {
        deleteAttachmentLocally(attachmentName);
      }
      setAttachmentName(saved);
    }
  };

  const handleSave = async () => {
    if (!selectedPropertyId) {
      Alert.alert('Selecciona un piso', 'Debes añadir y seleccionar un piso primero.');
      return;
    }
    const numAmount = Number(amount.replace(',', '.'));
    if (!numAmount || numAmount <= 0) {
      Alert.alert('Importe inválido', 'Introduce un importe mayor que 0.');
      return;
    }
    const trimmedDate = date.trim();
    if (!isValidISODate(trimmedDate)) {
      Alert.alert('Fecha inválida', 'Usa el formato AAAA-MM-DD (ej. 2026-11-26).');
      return;
    }
    const numVat = Number(vatAmount.replace(',', '.')) || 0;
    const base = Math.max(0, numAmount - numVat);

    setSaving(true);
    try {
      await createTransaction({
        property_id: selectedPropertyId,
        type,
        category,
        amount: numAmount,
        base_amount: base,
        vat_amount: numVat,
        date: trimmedDate,
        status: 'completado',
        description,
        attachment_uri: attachmentName,
      });

      setAmount('');
      setVatAmount('');
      setDescription('');
      setAttachmentName(null);
      setSnackbarMsg('Movimiento guardado correctamente');
    } finally {
      setSaving(false);
    }
  };

  const categories = type === 'ingreso' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  const selectedProperty = properties.find((p) => p.id === selectedPropertyId);
  const isCanarias = !selectedProperty || selectedProperty.tax_region === 'canarias';
  const isExemptIncome =
    type === 'ingreso' &&
    !!selectedProperty &&
    (selectedProperty.regime === 'residencial' || selectedProperty.igic_regime === 'repep');

  const taxInputLabel = (() => {
    if (isCanarias) {
      return isExemptIncome ? 'IGIC (0 € exento)' : 'IGIC incluido (€)';
    }
    return 'IVA incluido (€)';
  })();

  const taxRates = isCanarias ? [7, 3, 0] : [21, 10, 0];

  const handleApplyTaxRate = (ratePct: number) => {
    if (ratePct === 0) {
      setVatAmount('0');
      return;
    }
    const numAmount = Number(amount.replace(',', '.'));
    if (!numAmount || numAmount <= 0) {
      Alert.alert(
        'Importe requerido',
        'Introduce primero el importe total para calcular el impuesto incluido.'
      );
      return;
    }
    const includedTax = numAmount - numAmount / (1 + ratePct / 100);
    setVatAmount((Math.round(includedTax * 100) / 100).toFixed(2));
  };

  const parsedAmount = Number(amount.replace(',', '.')) || 0;
  const parsedVat = Number(vatAmount.replace(',', '.')) || 0;
  const computedBase = Math.max(0, parsedAmount - parsedVat);

  if (properties.length === 0) {
    return (
      <View style={[styles.emptyContainer, { backgroundColor: theme.colors.background }]}>
        <Text variant="titleMedium" style={{ textAlign: 'center' }}>
          Primero da de alta al menos un piso para poder registrar cobros o gastos.
        </Text>
        <Button mode="contained" onPress={() => router.push('/pisos')}>
          Ir a Pisos
        </Button>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 80}>
      <ScrollView
        ref={scrollViewRef}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled">
        <SegmentedButtons
          value={type}
          onValueChange={handleTypeChange}
          buttons={[
            { value: 'gasto', label: 'Gasto / Factura', icon: 'receipt' },
            { value: 'ingreso', label: 'Cobro / Ingreso', icon: 'cash-plus' },
          ]}
        />

        <Card mode="outlined" style={styles.card}>
          <Card.Content style={{ gap: 10 }}>
            <Text variant="labelLarge">1. Selecciona el piso</Text>
            <View style={styles.chipsWrap}>
              {properties.map((p) => (
                <Chip
                  key={p.id}
                  selected={selectedPropertyId === p.id}
                  showSelectedOverlay
                  onPress={() => setSelectedPropertyId(p.id)}>
                  {p.name}
                </Chip>
              ))}
            </View>
          </Card.Content>
        </Card>

        <Card mode="outlined" style={styles.card}>
          <Card.Content style={{ gap: 10 }}>
            <Text variant="labelLarge">2. Categoría fiscal</Text>
            <View style={styles.chipsWrap}>
              {categories.map((cat) => (
                <Chip
                  key={cat}
                  selected={category === cat}
                  showSelectedOverlay
                  onPress={() => setCategory(cat)}>
                  {cat}
                </Chip>
              ))}
            </View>
          </Card.Content>
        </Card>

        <Card
          mode="outlined"
          style={styles.card}
          onLayout={(e) => {
            detailsCardYRef.current = e.nativeEvent.layout.y;
          }}>
          <Card.Content style={{ gap: 12 }}>
            <Text variant="labelLarge">3. Importe y detalles</Text>
            <View
              style={styles.row}
              onLayout={(e) => {
                inputOffsetsRef.current.amountRow = e.nativeEvent.layout.y;
              }}>
              <TextInput
                label="Importe total (€)*"
                value={amount}
                onChangeText={setAmount}
                onFocus={() => scrollToField('amountRow')}
                keyboardType="decimal-pad"
                mode="outlined"
                style={{ flex: 2 }}
              />
              <TextInput
                label={taxInputLabel}
                value={vatAmount}
                onChangeText={setVatAmount}
                onFocus={() => scrollToField('amountRow')}
                keyboardType="decimal-pad"
                mode="outlined"
                style={{ flex: 1 }}
              />
            </View>
            {!isExemptIncome && (
              <View style={{ gap: 6 }}>
                <View style={styles.chipsWrap}>
                  {taxRates.map((rate) => (
                    <Chip
                      key={rate}
                      compact
                      icon={rate === 0 ? 'close-circle-outline' : 'percent'}
                      onPress={() => handleApplyTaxRate(rate)}>
                      {rate === 0
                        ? '0 % Exento'
                        : `${rate} % ${isCanarias ? 'IGIC' : 'IVA'}`}
                    </Chip>
                  ))}
                </View>
                {parsedAmount > 0 && (
                  <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                    Base imponible: {formatEUR(computedBase)} · {isCanarias ? 'IGIC' : 'IVA'}:{' '}
                    {formatEUR(parsedVat)}
                  </Text>
                )}
              </View>
            )}
            <View
              onLayout={(e) => {
                inputOffsetsRef.current.date = e.nativeEvent.layout.y;
              }}>
              <TextInput
                label="Fecha (AAAA-MM-DD)"
                value={date}
                onChangeText={setDate}
                onFocus={() => scrollToField('date')}
                mode="outlined"
              />
            </View>
            <View
              onLayout={(e) => {
                inputOffsetsRef.current.description = e.nativeEvent.layout.y;
              }}>
              <TextInput
                label="Concepto / Proveedor (opcional)"
                value={description}
                onChangeText={setDescription}
                onFocus={() => scrollToField('description')}
                mode="outlined"
              />
            </View>
          </Card.Content>
        </Card>

        <Card mode="outlined" style={styles.card}>
          <Card.Content style={{ gap: 10 }}>
            <Text variant="labelLarge">4. Justificante / Factura (para Hacienda)</Text>
            <View style={styles.row}>
              <Button
                mode="outlined"
                icon="camera"
                style={{ flex: 1 }}
                onPress={handleTakePhoto}>
                Hacer foto
              </Button>
              <Button
                mode="outlined"
                icon="file-pdf-box"
                style={{ flex: 1 }}
                onPress={handlePickDocument}>
                PDF / Archivo
              </Button>
            </View>
            {attachmentName && (
              <Chip
                icon="paperclip"
                onClose={() => {
                  deleteAttachmentLocally(attachmentName);
                  setAttachmentName(null);
                }}
                style={{ alignSelf: 'flex-start' }}>
                Adjunto guardado ({attachmentName})
              </Chip>
            )}
          </Card.Content>
        </Card>

        <Button
          mode="contained"
          icon="content-save"
          loading={saving}
          disabled={saving}
          contentStyle={{ paddingVertical: 6 }}
          onPress={handleSave}>
          Guardar {type === 'ingreso' ? 'Ingreso' : 'Gasto'}
        </Button>
      </ScrollView>

      <Snackbar
        visible={!!snackbarMsg}
        onDismiss={() => setSnackbarMsg('')}
        duration={2500}>
        {snackbarMsg}
      </Snackbar>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 16 },
  content: { padding: 16, gap: 14, paddingBottom: 140 },
  card: { borderRadius: 16 },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  row: { flexDirection: 'row', gap: 10 },
});
