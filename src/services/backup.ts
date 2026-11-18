import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';

import {
  closeDatabase,
  DB_NAME,
  getDatabase,
  getFiscalSummaryByYear,
  getTransactionsByYear,
} from '@/db/database';

function getAttachmentsDir(): Directory {
  return new Directory(Paths.document, 'attachments');
}

function getSqliteFile(): File {
  return new File(Paths.document, 'SQLite', DB_NAME);
}

export function ensureAttachmentsDir(): Directory {
  const dir = getAttachmentsDir();
  if (!dir.exists) {
    dir.create({ intermediates: true, idempotent: true });
  }
  return dir;
}

export async function saveAttachmentLocally(sourceUri: string, extension = 'jpg'): Promise<string> {
  const dir = ensureAttachmentsDir();
  const safeExt = extension.replace(/[^a-zA-Z0-9]/g, '') || 'bin';
  const fileName = `adj_${Date.now()}.${safeExt}`;
  const sourceFile = new File(sourceUri);
  const destFile = new File(dir, fileName);
  sourceFile.copy(destFile);
  return fileName;
}

export function resolveAttachmentUri(fileNameOrUri: string | null): string | null {
  if (!fileNameOrUri) return null;
  if (fileNameOrUri.startsWith('file://') || fileNameOrUri.startsWith('content://')) {
    return fileNameOrUri;
  }
  return new File(getAttachmentsDir(), fileNameOrUri).uri;
}

export async function exportBackupZip(): Promise<void> {
  await getDatabase();
  const dbFile = getSqliteFile();
  if (!dbFile.exists) {
    throw new Error('No se encontró la base de datos local.');
  }

  const zip = new JSZip();
  const dbBytes = await dbFile.bytes();
  zip.file(DB_NAME, dbBytes);

  const attachmentsDir = getAttachmentsDir();
  if (attachmentsDir.exists) {
    const entries = attachmentsDir.list();
    const attachmentsFolder = zip.folder('attachments');
    if (attachmentsFolder) {
      for (const entry of entries) {
        if (entry instanceof File && entry.exists) {
          const bytes = await entry.bytes();
          attachmentsFolder.file(entry.name, bytes);
        }
      }
    }
  }

  const zipBytes = await zip.generateAsync({ type: 'uint8array' });
  const dateTag = new Date().toISOString().slice(0, 10);
  const outFile = new File(Paths.cache, `copia_pisos_${dateTag}.zip`);
  outFile.write(zipBytes);

  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) {
    throw new Error('El menú para compartir no está disponible en este dispositivo.');
  }
  await Sharing.shareAsync(outFile.uri, {
    mimeType: 'application/zip',
    dialogTitle: 'Compartir copia de seguridad de pisos',
  });
}

export async function importBackupZip(): Promise<{ importedAttachments: number }> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/zip', 'application/x-zip-compressed', '*/*'],
    copyToCacheDirectory: true,
  });

  if (result.canceled || !result.assets?.[0]) {
    throw new Error('CANCELLED');
  }

  const pickedFile = new File(result.assets[0].uri);
  const zipBytes = await pickedFile.bytes();
  const zip = await JSZip.loadAsync(zipBytes);

  const dbEntry = zip.file(DB_NAME);
  if (!dbEntry) {
    throw new Error('El archivo ZIP seleccionado no contiene una copia válida de Gestión Pisos.');
  }

  await closeDatabase();

  const sqliteDir = new Directory(Paths.document, 'SQLite');
  if (!sqliteDir.exists) {
    sqliteDir.create({ intermediates: true, idempotent: true });
  }

  const dbContent = await dbEntry.async('uint8array');
  const targetDb = getSqliteFile();
  targetDb.write(dbContent);

  const attachmentsDir = ensureAttachmentsDir();
  let importedAttachments = 0;

  const attachmentEntries = Object.keys(zip.files).filter(
    (name) => name.startsWith('attachments/') && !zip.files[name].dir
  );

  for (const fullPath of attachmentEntries) {
    const fileName = fullPath.replace('attachments/', '');
    if (!fileName || fileName.includes('/')) continue;
    const fileData = await zip.files[fullPath].async('uint8array');
    const outFile = new File(attachmentsDir, fileName);
    outFile.write(fileData);
    importedAttachments++;
  }

  await getDatabase();
  return { importedAttachments };
}

export async function exportFiscalExcel(year: number): Promise<void> {
  const summaries = await getFiscalSummaryByYear(year);
  const transactions = await getTransactionsByYear(year);

  const summaryRows = summaries.map((s) => ({
    Piso: s.property_name,
    'Referencia Catastral': s.cadastral_ref || '-',
    Régimen: s.regime === 'vacacional' ? 'Vacacional' : 'Residencial',
    'Ingresos (€)': Number(s.total_income.toFixed(2)),
    'Gastos Deducibles (€)': Number(s.total_expense.toFixed(2)),
    'Rendimiento Neto (€)': Number(s.net_yield.toFixed(2)),
  }));

  const txRows = transactions.map((t) => ({
    Fecha: t.date,
    Piso: t.property_name ?? '',
    Tipo: t.type === 'ingreso' ? 'Ingreso' : 'Gasto',
    Categoría: t.category,
    Estado: t.status === 'completado' ? 'Completado' : 'Pendiente',
    'Base (€)': Number(t.base_amount.toFixed(2)),
    'IVA (€)': Number(t.vat_amount.toFixed(2)),
    'Total (€)': Number(t.amount.toFixed(2)),
    Descripción: t.description,
    'Tiene Factura': t.attachment_uri ? 'Sí' : 'No',
  }));

  const wb = XLSX.utils.book_new();
  const wsSummary = XLSX.utils.json_to_sheet(
    summaryRows.length > 0 ? summaryRows : [{ Mensaje: `Sin pisos registrados para ${year}` }]
  );
  const wsTx = XLSX.utils.json_to_sheet(
    txRows.length > 0 ? txRows : [{ Mensaje: `Sin movimientos registrados en ${year}` }]
  );

  XLSX.utils.book_append_sheet(wb, wsSummary, `Resumen ${year}`);
  XLSX.utils.book_append_sheet(wb, wsTx, 'Movimientos');

  const wbBytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  const outFile = new File(Paths.cache, `resumen_fiscal_${year}.xlsx`);
  outFile.write(new Uint8Array(wbBytes));

  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) {
    throw new Error('El menú para compartir no está disponible en este dispositivo.');
  }
  await Sharing.shareAsync(outFile.uri, {
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    dialogTitle: `Exportar resumen fiscal ${year}`,
  });
}
