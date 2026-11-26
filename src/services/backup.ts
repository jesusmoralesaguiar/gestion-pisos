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
  getDatabase,
  getFiscalSummaryByYear,
  getTransactionsByYear,
} from '@/db/database';
import { NON_TAXABLE_INCOME_CATEGORIES } from '@/db/schema';
import { getLocalISODate } from '@/utils/dates';

const SQLITE_MAGIC_HEADER = 'SQLite format 3\0';

function getAttachmentsDir(): Directory {
  return new Directory(Paths.document, 'attachments');
}

function getSqliteDir(): Directory {
  return new Directory(Paths.document, 'SQLite');
}

function getSqliteFile(): File {
  return new File(getSqliteDir(), DB_NAME);
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
  await getDatabase();
  await closeDatabase();

  let zipBytes: Uint8Array;
  try {
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

    zipBytes = await zip.generateAsync({ type: 'uint8array' });
  } finally {
    await getDatabase().catch(() => {});
  }

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

  const dbContent = await dbEntry.async('uint8array');
  if (!isValidSqliteHeader(dbContent)) {
    throw new Error('La base de datos dentro del archivo ZIP está dañada o no es válida.');
  }

  // Validate SQLite page integrity and expected schema before touching the live database.
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
  } finally {
    await probeDb.closeAsync().catch(() => {});
  }

  // Extract attachments into memory before closing or modifying the live database.
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

  await closeDatabase();

  const sqliteDir = getSqliteDir();
  if (!sqliteDir.exists) {
    sqliteDir.create({ intermediates: true, idempotent: true });
  }

  const targetDb = getSqliteFile();
  const previousDbBytes = targetDb.exists ? await targetDb.bytes() : null;

  try {
    for (const suffix of ['-wal', '-shm']) {
      const journalFile = new File(sqliteDir, `${DB_NAME}${suffix}`);
      if (journalFile.exists) {
        journalFile.delete();
      }
    }

    targetDb.write(dbContent);

    const attachmentsDir = ensureAttachmentsDir();
    for (const item of stagedAttachments) {
      const outFile = new File(attachmentsDir, item.fileName);
      outFile.write(item.data);
    }

    await getDatabase();
    return { importedAttachments: stagedAttachments.length };
  } catch (err) {
    if (previousDbBytes) {
      try {
        targetDb.write(previousDbBytes);
        await getDatabase().catch(() => {});
      } catch {
        // Best-effort rollback if restoring the previous DB fails.
      }
    }
    throw err;
  }
}

/**
 * Deletes the local SQLite database (plus WAL/SHM journals) and all stored attachments,
 * then recreates an empty database with all Drizzle migrations applied.
 */
export async function resetLocalDatabase(): Promise<void> {
  await closeDatabase();

  const sqliteDir = getSqliteDir();
  if (sqliteDir.exists) {
    for (const suffix of ['', '-wal', '-shm']) {
      const target = new File(sqliteDir, `${DB_NAME}${suffix}`);
      if (target.exists) {
        target.delete();
      }
    }
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

function getIndirectTaxLabel(
  taxRegion: 'canarias' | 'peninsula',
  regime: 'residencial' | 'vacacional',
  igicRegime: 'repep' | 'general_420'
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
    'Referencia Catastral': s.cadastral_ref || '-',
    Territorio: s.tax_region === 'canarias' ? 'Canarias (IGIC)' : 'Península/Baleares (IVA)',
    Régimen: s.regime === 'vacacional' ? 'Vacacional' : 'Residencial',
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
