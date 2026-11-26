import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as Sharing from 'expo-sharing';
import * as SQLite from 'expo-sqlite';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';

import {
  closeDatabase,
  DB_NAME,
  getAllProperties,
  getDatabase,
  getFiscalSummaryByYear,
  getTransactionsByYear,
  serializeDatabase,
} from '@/db/database';
import {
  NON_TAXABLE_INCOME_CATEGORIES,
  type IgicRegime,
  type PropertyRegime,
  type TaxRegion,
} from '@/db/schema';
import { getLocalISODate } from '@/utils/dates';

const SQLITE_MAGIC_HEADER = 'SQLite format 3\0';

function getAttachmentsDir(): Directory {
  return new Directory(Paths.document, 'attachments');
}

function isValidSqliteHeader(bytes: Uint8Array): boolean {
  if (bytes.length < SQLITE_MAGIC_HEADER.length) {
    return false;
  }
  for (let i = 0; i < SQLITE_MAGIC_HEADER.length; i++) {
    if (bytes[i] !== SQLITE_MAGIC_HEADER.charCodeAt(i)) {
      return false;
    }
  }
  return true;
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Reads file bytes with fallbacks for Android DocumentPicker content/cache URIs.
 */
async function readFileBytes(fileOrUri: File | string): Promise<Uint8Array> {
  const uri = typeof fileOrUri === 'string' ? fileOrUri : fileOrUri.uri;
  const file = typeof fileOrUri === 'string' ? new File(fileOrUri) : fileOrUri;

  try {
    return await file.bytes();
  } catch {
    try {
      const base64 = await file.base64();
      return base64ToUint8Array(base64);
    } catch {
      const response = await fetch(uri);
      if (!response.ok) {
        throw new Error(`No se pudo leer el archivo seleccionado (${response.status}).`);
      }
      const buffer = await response.arrayBuffer();
      return new Uint8Array(buffer);
    }
  }
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

/**
 * Resizes and JPEG-compresses invoice images to keep local backups lightweight.
 */
export async function compressAndSaveImageAttachment(
  sourceUri: string,
  maxWidth = 1600
): Promise<string> {
  let context: ReturnType<typeof ImageManipulator.manipulate> | null = null;
  let imageRef: Awaited<ReturnType<ReturnType<typeof ImageManipulator.manipulate>['renderAsync']>> | null =
    null;

  try {
    context = ImageManipulator.manipulate(sourceUri);
    context.resize({ width: maxWidth });
    imageRef = await context.renderAsync();
    const result = await imageRef.saveAsync({
      format: SaveFormat.JPEG,
      compress: 0.8,
    });

    const savedName = await saveAttachmentLocally(result.uri, 'jpg');
    if (result.uri !== sourceUri) {
      try {
        const tempFile = new File(result.uri);
        if (tempFile.exists) {
          tempFile.delete();
        }
      } catch {
        // Ignore temporary cache cleanup failures.
      }
    }
    return savedName;
  } catch {
    return saveAttachmentLocally(sourceUri, 'jpg');
  } finally {
    imageRef?.release();
    context?.release();
  }
}

export function deleteAttachmentLocally(fileNameOrUri: string | null): void {
  if (!fileNameOrUri) return;
  try {
    const attachmentsDir = getAttachmentsDir();
    let targetFile: File;

    if (fileNameOrUri.startsWith('file://') || fileNameOrUri.startsWith('content://')) {
      if (!fileNameOrUri.startsWith(attachmentsDir.uri)) {
        return;
      }
      targetFile = new File(fileNameOrUri);
    } else {
      if (fileNameOrUri.includes('/') || fileNameOrUri.includes('\\')) {
        return;
      }
      targetFile = new File(attachmentsDir, fileNameOrUri);
    }

    if (targetFile.exists) {
      targetFile.delete();
    }
  } catch {
    // Ignore cleanup errors for missing or already-removed files.
  }
}

export function resolveAttachmentUri(fileNameOrUri: string | null): string | null {
  if (!fileNameOrUri) return null;
  if (fileNameOrUri.startsWith('file://') || fileNameOrUri.startsWith('content://')) {
    return fileNameOrUri;
  }
  return new File(getAttachmentsDir(), fileNameOrUri).uri;
}

export async function exportBackupZip(): Promise<void> {
  const dbBytes = await serializeDatabase();

  const zip = new JSZip();
  zip.file(DB_NAME, dbBytes);

  const attachmentsDir = getAttachmentsDir();
  if (attachmentsDir.exists) {
    const entries = attachmentsDir.list();
    const attachmentsFolder = zip.folder('attachments');
    if (attachmentsFolder) {
      for (const entry of entries) {
        if (entry instanceof File && entry.exists) {
          const bytes = await readFileBytes(entry);
          attachmentsFolder.file(entry.name, bytes);
        }
      }
    }
  }

  const zipBytes = await zip.generateAsync({ type: 'uint8array' });

  const dateTag = getLocalISODate();
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

export async function importBackupZip(): Promise<{
  importedAttachments: number;
  importedProperties: number;
}> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/zip', 'application/x-zip-compressed', '*/*'],
    copyToCacheDirectory: true,
  });

  if (result.canceled || !result.assets?.[0]) {
    throw new Error('CANCELLED');
  }

  const zipBytes = await readFileBytes(result.assets[0].uri);
  const zip = await JSZip.loadAsync(zipBytes);

  const dbEntry = zip.file(DB_NAME);
  if (!dbEntry) {
    throw new Error('El archivo ZIP seleccionado no contiene una copia válida de Gestión Pisos.');
  }

  const dbContent = await dbEntry.async('uint8array');
  if (!isValidSqliteHeader(dbContent)) {
    throw new Error('La base de datos dentro del archivo ZIP está dañada o no es válida.');
  }

  // Extract attachments into memory before touching the live database.
  const attachmentEntries = Object.keys(zip.files).filter(
    (name) => name.startsWith('attachments/') && !zip.files[name].dir
  );
  const stagedAttachments: { fileName: string; data: Uint8Array }[] = [];
  for (const fullPath of attachmentEntries) {
    const fileName = fullPath.replace('attachments/', '');
    if (!fileName || fileName.includes('/')) continue;
    const data = await zip.files[fullPath].async('uint8array');
    stagedAttachments.push({ fileName, data });
  }

  // Validate SQLite page integrity and expected schema, then copy directly via SQLite backup API.
  const probeDb = await SQLite.deserializeDatabaseAsync(dbContent);
  try {
    const integrity = await probeDb.getFirstAsync<{ integrity_check: string }>(
      'PRAGMA integrity_check'
    );
    if (integrity?.integrity_check !== 'ok') {
      throw new Error('La comprobación de integridad SQLite del backup ha fallado.');
    }
    const tables = await probeDb.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('properties', 'transactions')"
    );
    if (tables.length < 2) {
      throw new Error('La base de datos del ZIP no pertenece a Gestión Pisos.');
    }

    await closeDatabase();

    const destDb = await SQLite.openDatabaseAsync(DB_NAME, { useNewConnection: true });
    try {
      await SQLite.backupDatabaseAsync({
        sourceDatabase: probeDb,
        destDatabase: destDb,
      });
      await destDb.execAsync('PRAGMA wal_checkpoint(TRUNCATE);').catch(() => {});
    } catch (err) {
      await destDb.closeAsync().catch(() => {});
      await getDatabase().catch(() => {});
      throw err;
    }
    await destDb.closeAsync().catch(() => {});
  } finally {
    await probeDb.closeAsync().catch(() => {});
  }

  const attachmentsDir = ensureAttachmentsDir();
  for (const item of stagedAttachments) {
    const outFile = new File(attachmentsDir, item.fileName);
    outFile.write(item.data);
  }

  await getDatabase();
  const importedProperties = (await getAllProperties()).length;
  return {
    importedAttachments: stagedAttachments.length,
    importedProperties,
  };
}

/**
 * Deletes the local SQLite database and all stored attachments,
 * then recreates an empty database with all Drizzle migrations applied.
 */
export async function resetLocalDatabase(): Promise<void> {
  await closeDatabase();

  try {
    await SQLite.deleteDatabaseAsync(DB_NAME);
  } catch {
    // Ignore if database did not exist yet.
  }

  const attachmentsDir = getAttachmentsDir();
  if (attachmentsDir.exists) {
    for (const entry of attachmentsDir.list()) {
      if (entry instanceof File && entry.exists) {
        entry.delete();
      }
    }
  }

  await getDatabase();
}

function getRegimeLabel(regime: PropertyRegime): string {
  switch (regime) {
    case 'vacacional':
      return 'Vacacional';
    case 'local':
      return 'Local comercial';
    case 'garaje':
      return 'Garaje';
    default:
      return 'Residencial';
  }
}

function getIndirectTaxLabel(
  taxRegion: TaxRegion,
  regime: PropertyRegime,
  igicRegime: IgicRegime
): string {
  if (regime === 'residencial') {
    return taxRegion === 'canarias' ? 'Exento IGIC (Residencial)' : 'Exento IVA (Residencial)';
  }
  if (taxRegion === 'canarias') {
    return igicRegime === 'general_420' ? 'IGIC Mod. 420 (Base IRPF)' : 'IGIC REPEP (Exento)';
  }
  return 'IVA';
}

export async function exportFiscalExcel(year: number): Promise<void> {
  const summaries = await getFiscalSummaryByYear(year);
  const transactions = await getTransactionsByYear(year);
  const nonTaxableSet = new Set<string>(NON_TAXABLE_INCOME_CATEGORIES);

  const summaryRows = summaries.map((s) => ({
    Piso: s.property_name,
    Titular: s.owner_name || '-',
    'Referencia Catastral': s.cadastral_ref || '-',
    Territorio: s.tax_region === 'canarias' ? 'Canarias (IGIC)' : 'Península/Baleares (IVA)',
    Régimen: getRegimeLabel(s.regime),
    'Régimen Imp. Indirecto': getIndirectTaxLabel(s.tax_region, s.regime, s.igic_regime),
    'Ingresos Computables (€)': Number(s.total_income.toFixed(2)),
    'Gastos Deducibles (€)': Number(s.total_expense.toFixed(2)),
    'Rendimiento Neto (€)': Number(s.net_yield.toFixed(2)),
  }));

  const txRows = transactions.map((t) => ({
    Fecha: t.date,
    Piso: t.property_name ?? '',
    Tipo: t.type === 'ingreso' ? 'Ingreso' : 'Gasto',
    Categoría: t.category,
    'Computable IRPF': nonTaxableSet.has(t.category) ? 'No (fianza)' : 'Sí',
    Estado: t.status === 'completado' ? 'Completado' : 'Pendiente',
    'Base (€)': Number(t.base_amount.toFixed(2)),
    'IGIC / IVA (€)': Number(t.vat_amount.toFixed(2)),
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
