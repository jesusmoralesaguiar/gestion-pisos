import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
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
import { saveAttachmentLocally } from '@/services/backup';

export default function RegistrarScreen() {
  const theme = useTheme();
  const router = useRouter();

  const [properties, setProperties] = useState<Property[]>([]);
  const [selectedPropertyId, setSelectedPropertyId] = useState<number | null>(null);
  const [type, setType] = useState<TransactionType>('gasto');
  const [category, setCategory] = useState<string>(EXPENSE_CATEGORIES[0]);
  const [amount, setAmount] = useState('');
  const [vatAmount, setVatAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState('');
  const [attachmentName, setAttachmentName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [snackbarMsg, setSnackbarMsg] = useState('');

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
      const saved = await saveAttachmentLocally(res.assets[0].uri, 'jpg');
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
      const ext = asset.name.split('.').pop() || 'pdf';
      const saved = await saveAttachmentLocally(asset.uri, ext);
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
        date: date.trim() || new Date().toISOString().slice(0, 10),
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
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
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

        <Card mode="outlined" style={styles.card}>
          <Card.Content style={{ gap: 12 }}>
            <Text variant="labelLarge">3. Importe y detalles</Text>
            <View style={styles.row}>
              <TextInput
                label="Importe total (€)*"
                value={amount}
                onChangeText={setAmount}
                keyboardType="decimal-pad"
                mode="outlined"
                style={{ flex: 2 }}
              />
              <TextInput
                label="IVA incluido (€)"
                value={vatAmount}
                onChangeText={setVatAmount}
                keyboardType="decimal-pad"
                mode="outlined"
                style={{ flex: 1 }}
              />
            </View>
            <TextInput
              label="Fecha (AAAA-MM-DD)"
              value={date}
              onChangeText={setDate}
              mode="outlined"
            />
            <TextInput
              label="Concepto / Proveedor (opcional)"
              value={description}
              onChangeText={setDescription}
              mode="outlined"
            />
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
                onClose={() => setAttachmentName(null)}
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 16 },
  content: { padding: 16, gap: 14, paddingBottom: 32 },
  card: { borderRadius: 16 },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  row: { flexDirection: 'row', gap: 10 },
});
