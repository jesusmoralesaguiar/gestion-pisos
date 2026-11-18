import * as SQLite from 'expo-sqlite';
import {
  CURRENT_DB_VERSION,
  MIGRATION_V1_SQL,
  type Incident,
  type IncidentStatus,
  type Property,
  type PropertyFiscalSummary,
  type PropertyRegime,
  type Reminder,
  type ReminderCategory,
  type Transaction,
  type TransactionStatus,
  type TransactionType,
} from './schema';

export const DB_NAME = 'gestion_pisos.db';

let dbInstance: SQLite.SQLiteDatabase | null = null;

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (dbInstance) {
    return dbInstance;
  }
  const db = await SQLite.openDatabaseAsync(DB_NAME);
  await migrateDbIfNeeded(db);
  dbInstance = db;
  return db;
}

export async function closeDatabase(): Promise<void> {
  if (dbInstance) {
    await dbInstance.closeAsync();
    dbInstance = null;
  }
}

async function migrateDbIfNeeded(db: SQLite.SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const currentVersion = row?.user_version ?? 0;

  if (currentVersion >= CURRENT_DB_VERSION) {
    await db.execAsync('PRAGMA foreign_keys = ON;');
    return;
  }

  if (currentVersion === 0) {
    await db.execAsync(MIGRATION_V1_SQL);
    await db.execAsync(`PRAGMA user_version = ${CURRENT_DB_VERSION};`);
  }
}

// --- Properties ---

export async function getAllProperties(): Promise<Property[]> {
  const db = await getDatabase();
  return db.getAllAsync<Property>('SELECT * FROM properties ORDER BY name ASC');
}

export async function createProperty(input: {
  name: string;
  address?: string;
  cadastral_ref?: string;
  regime: PropertyRegime;
  monthly_rent: number;
  payment_day?: number;
  tenant_name?: string;
  notes?: string;
}): Promise<number> {
  const db = await getDatabase();
  const result = await db.runAsync(
    `INSERT INTO properties (name, address, cadastral_ref, regime, monthly_rent, payment_day, tenant_name, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.name.trim(),
      input.address?.trim() ?? '',
      input.cadastral_ref?.trim().toUpperCase() ?? '',
      input.regime,
      input.monthly_rent,
      input.payment_day ?? 5,
      input.tenant_name?.trim() ?? '',
      input.notes?.trim() ?? '',
    ]
  );
  return result.lastInsertRowId;
}

export async function deleteProperty(id: number): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM properties WHERE id = ?', [id]);
}

// --- Transactions ---

export async function createTransaction(input: {
  property_id: number;
  type: TransactionType;
  category: string;
  amount: number;
  base_amount?: number;
  vat_amount?: number;
  date: string;
  status?: TransactionStatus;
  description?: string;
  attachment_uri?: string | null;
}): Promise<number> {
  const db = await getDatabase();
  const result = await db.runAsync(
    `INSERT INTO transactions (property_id, type, category, amount, base_amount, vat_amount, date, status, description, attachment_uri)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.property_id,
      input.type,
      input.category,
      input.amount,
      input.base_amount ?? input.amount,
      input.vat_amount ?? 0,
      input.date,
      input.status ?? 'completado',
      input.description?.trim() ?? '',
      input.attachment_uri ?? null,
    ]
  );
  return result.lastInsertRowId;
}

export async function getRecentTransactions(limit = 30): Promise<Transaction[]> {
  const db = await getDatabase();
  return db.getAllAsync<Transaction>(
    `SELECT t.*, p.name as property_name
     FROM transactions t
     JOIN properties p ON p.id = t.property_id
     ORDER BY t.date DESC, t.id DESC
     LIMIT ?`,
    [limit]
  );
}

export async function getTransactionsByYear(year: number): Promise<Transaction[]> {
  const db = await getDatabase();
  const prefix = `${year}-%`;
  return db.getAllAsync<Transaction>(
    `SELECT t.*, p.name as property_name
     FROM transactions t
     JOIN properties p ON p.id = t.property_id
     WHERE t.date LIKE ?
     ORDER BY t.date ASC, t.id ASC`,
    [prefix]
  );
}

export async function getMonthlyRentPaidPropertyIds(yearMonth: string): Promise<Set<number>> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ property_id: number }>(
    `SELECT DISTINCT property_id
     FROM transactions
     WHERE type = 'ingreso'
       AND status = 'completado'
       AND date LIKE ?`,
    [`${yearMonth}-%`]
  );
  return new Set(rows.map((r) => r.property_id));
}

export async function getMonthTotals(yearMonth: string): Promise<{ income: number; expense: number }> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ type: TransactionType; total: number }>(
    `SELECT type, COALESCE(SUM(amount), 0) as total
     FROM transactions
     WHERE status = 'completado' AND date LIKE ?
     GROUP BY type`,
    [`${yearMonth}-%`]
  );
  let income = 0;
  let expense = 0;
  for (const row of rows) {
    if (row.type === 'ingreso') income = row.total;
    if (row.type === 'gasto') expense = row.total;
  }
  return { income, expense };
}

export async function deleteTransaction(id: number): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM transactions WHERE id = ?', [id]);
}

// --- Incidents ---

export async function getOpenIncidents(): Promise<Incident[]> {
  const db = await getDatabase();
  return db.getAllAsync<Incident>(
    `SELECT i.*, p.name as property_name
     FROM incidents i
     JOIN properties p ON p.id = i.property_id
     WHERE i.status != 'resuelta'
     ORDER BY i.created_at DESC`
  );
}

export async function createIncident(input: {
  property_id: number;
  title: string;
  description?: string;
  photo_uri?: string | null;
}): Promise<number> {
  const db = await getDatabase();
  const result = await db.runAsync(
    `INSERT INTO incidents (property_id, title, description, photo_uri)
     VALUES (?, ?, ?, ?)`,
    [input.property_id, input.title.trim(), input.description?.trim() ?? '', input.photo_uri ?? null]
  );
  return result.lastInsertRowId;
}

export async function updateIncidentStatus(id: number, status: IncidentStatus): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('UPDATE incidents SET status = ? WHERE id = ?', [status, id]);
}

// --- Reminders ---

export async function getPendingReminders(): Promise<Reminder[]> {
  const db = await getDatabase();
  return db.getAllAsync<Reminder>(
    `SELECT r.*, p.name as property_name
     FROM reminders r
     LEFT JOIN properties p ON p.id = r.property_id
     WHERE r.completed = 0
     ORDER BY r.due_date ASC`
  );
}

export async function createReminder(input: {
  property_id?: number | null;
  title: string;
  category: ReminderCategory;
  due_date: string;
}): Promise<number> {
  const db = await getDatabase();
  const result = await db.runAsync(
    `INSERT INTO reminders (property_id, title, category, due_date)
     VALUES (?, ?, ?, ?)`,
    [input.property_id ?? null, input.title.trim(), input.category, input.due_date]
  );
  return result.lastInsertRowId;
}

export async function toggleReminderCompleted(id: number, completed: boolean): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('UPDATE reminders SET completed = ? WHERE id = ?', [completed ? 1 : 0, id]);
}

// --- Fiscal Summary ---

export async function getFiscalSummaryByYear(year: number): Promise<PropertyFiscalSummary[]> {
  const db = await getDatabase();
  const prefix = `${year}-%`;
  return db.getAllAsync<PropertyFiscalSummary>(
    `SELECT
       p.id as property_id,
       p.name as property_name,
       p.cadastral_ref,
       p.regime,
       COALESCE(SUM(CASE WHEN t.type = 'ingreso' AND t.status = 'completado' AND t.date LIKE ? THEN t.amount ELSE 0 END), 0) as total_income,
       COALESCE(SUM(CASE WHEN t.type = 'gasto' AND t.status = 'completado' AND t.date LIKE ? THEN t.amount ELSE 0 END), 0) as total_expense,
       COALESCE(SUM(CASE WHEN t.type = 'ingreso' AND t.status = 'completado' AND t.date LIKE ? THEN t.amount ELSE 0 END), 0) -
       COALESCE(SUM(CASE WHEN t.type = 'gasto' AND t.status = 'completado' AND t.date LIKE ? THEN t.amount ELSE 0 END), 0) as net_yield
     FROM properties p
     LEFT JOIN transactions t ON t.property_id = p.id
     GROUP BY p.id
     ORDER BY p.name ASC`,
    [prefix, prefix, prefix, prefix]
  );
}
