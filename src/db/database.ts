import { and, asc, desc, eq, like, ne, sql } from 'drizzle-orm';
import { drizzle, type ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import { migrate } from 'drizzle-orm/expo-sqlite/migrator';
import * as SQLite from 'expo-sqlite';

import migrations from '../../drizzle/migrations';
import * as schema from './schema';
import {
  incidents,
  properties,
  reminders,
  transactions,
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

export type AppDatabase = ExpoSQLiteDatabase<typeof schema>;

let expoDb: SQLite.SQLiteDatabase | null = null;
let drizzleDb: AppDatabase | null = null;
let initPromise: Promise<AppDatabase> | null = null;

/**
 * Returns the initialized Drizzle ORM database instance, running any pending
 * SQLite migrations in order on first open.
 */
export async function getDatabase(): Promise<AppDatabase> {
  if (drizzleDb) {
    return drizzleDb;
  }
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    const db = SQLite.openDatabaseSync(DB_NAME, { enableChangeListener: true });
    try {
      db.execSync('PRAGMA foreign_keys = ON;');
      const orm = drizzle(db, { schema });
      await migrate(orm, migrations);
      expoDb = db;
      drizzleDb = orm;
      return orm;
    } catch (err) {
      initPromise = null;
      await db.closeAsync().catch(() => {});
      throw err;
    }
  })();

  return initPromise;
}

/**
 * Closes the active SQLite connection so backup imports can safely replace the DB file.
 */
export async function closeDatabase(): Promise<void> {
  if (initPromise) {
    await initPromise.catch(() => {});
  }
  if (expoDb) {
    await expoDb.closeAsync();
  }
  expoDb = null;
  drizzleDb = null;
  initPromise = null;
}

// --- Properties ---

export async function getAllProperties(): Promise<Property[]> {
  const db = await getDatabase();
  return db.select().from(properties).orderBy(asc(properties.name));
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
  const [inserted] = await db
    .insert(properties)
    .values({
      name: input.name.trim(),
      address: input.address?.trim() ?? '',
      cadastral_ref: input.cadastral_ref?.trim().toUpperCase() ?? '',
      regime: input.regime,
      monthly_rent: input.monthly_rent,
      payment_day: input.payment_day ?? 5,
      tenant_name: input.tenant_name?.trim() ?? '',
      notes: input.notes?.trim() ?? '',
    })
    .returning({ id: properties.id });
  return inserted.id;
}

export async function deleteProperty(id: number): Promise<void> {
  const db = await getDatabase();
  await db.delete(properties).where(eq(properties.id, id));
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
  const [inserted] = await db
    .insert(transactions)
    .values({
      property_id: input.property_id,
      type: input.type,
      category: input.category,
      amount: input.amount,
      base_amount: input.base_amount ?? input.amount,
      vat_amount: input.vat_amount ?? 0,
      date: input.date,
      status: input.status ?? 'completado',
      description: input.description?.trim() ?? '',
      attachment_uri: input.attachment_uri ?? null,
    })
    .returning({ id: transactions.id });
  return inserted.id;
}

export async function getRecentTransactions(limit = 30): Promise<Transaction[]> {
  const db = await getDatabase();
  return db
    .select({
      id: transactions.id,
      property_id: transactions.property_id,
      type: transactions.type,
      category: transactions.category,
      amount: transactions.amount,
      base_amount: transactions.base_amount,
      vat_amount: transactions.vat_amount,
      date: transactions.date,
      status: transactions.status,
      description: transactions.description,
      attachment_uri: transactions.attachment_uri,
      created_at: transactions.created_at,
      property_name: properties.name,
    })
    .from(transactions)
    .innerJoin(properties, eq(properties.id, transactions.property_id))
    .orderBy(desc(transactions.date), desc(transactions.id))
    .limit(limit);
}

export async function getTransactionsByYear(year: number): Promise<Transaction[]> {
  const db = await getDatabase();
  const prefix = `${year}-%`;
  return db
    .select({
      id: transactions.id,
      property_id: transactions.property_id,
      type: transactions.type,
      category: transactions.category,
      amount: transactions.amount,
      base_amount: transactions.base_amount,
      vat_amount: transactions.vat_amount,
      date: transactions.date,
      status: transactions.status,
      description: transactions.description,
      attachment_uri: transactions.attachment_uri,
      created_at: transactions.created_at,
      property_name: properties.name,
    })
    .from(transactions)
    .innerJoin(properties, eq(properties.id, transactions.property_id))
    .where(like(transactions.date, prefix))
    .orderBy(asc(transactions.date), asc(transactions.id));
}

export async function getMonthlyRentPaidPropertyIds(yearMonth: string): Promise<Set<number>> {
  const db = await getDatabase();
  const rows = await db
    .selectDistinct({ property_id: transactions.property_id })
    .from(transactions)
    .where(
      and(
        eq(transactions.type, 'ingreso'),
        eq(transactions.status, 'completado'),
        like(transactions.date, `${yearMonth}-%`)
      )
    );
  return new Set(rows.map((r) => r.property_id));
}

export async function getMonthTotals(yearMonth: string): Promise<{ income: number; expense: number }> {
  const db = await getDatabase();
  const rows = await db
    .select({
      type: transactions.type,
      total: sql<number>`COALESCE(SUM(${transactions.amount}), 0)`,
    })
    .from(transactions)
    .where(and(eq(transactions.status, 'completado'), like(transactions.date, `${yearMonth}-%`)))
    .groupBy(transactions.type);

  let income = 0;
  let expense = 0;
  for (const row of rows) {
    if (row.type === 'ingreso') income = Number(row.total) || 0;
    if (row.type === 'gasto') expense = Number(row.total) || 0;
  }
  return { income, expense };
}

export async function deleteTransaction(id: number): Promise<void> {
  const db = await getDatabase();
  await db.delete(transactions).where(eq(transactions.id, id));
}

// --- Incidents ---

export async function getOpenIncidents(): Promise<Incident[]> {
  const db = await getDatabase();
  return db
    .select({
      id: incidents.id,
      property_id: incidents.property_id,
      title: incidents.title,
      description: incidents.description,
      status: incidents.status,
      photo_uri: incidents.photo_uri,
      created_at: incidents.created_at,
      property_name: properties.name,
    })
    .from(incidents)
    .innerJoin(properties, eq(properties.id, incidents.property_id))
    .where(ne(incidents.status, 'resuelta'))
    .orderBy(desc(incidents.created_at));
}

export async function createIncident(input: {
  property_id: number;
  title: string;
  description?: string;
  photo_uri?: string | null;
}): Promise<number> {
  const db = await getDatabase();
  const [inserted] = await db
    .insert(incidents)
    .values({
      property_id: input.property_id,
      title: input.title.trim(),
      description: input.description?.trim() ?? '',
      photo_uri: input.photo_uri ?? null,
    })
    .returning({ id: incidents.id });
  return inserted.id;
}

export async function updateIncidentStatus(id: number, status: IncidentStatus): Promise<void> {
  const db = await getDatabase();
  await db.update(incidents).set({ status }).where(eq(incidents.id, id));
}

// --- Reminders ---

export async function getPendingReminders(): Promise<Reminder[]> {
  const db = await getDatabase();
  return db
    .select({
      id: reminders.id,
      property_id: reminders.property_id,
      title: reminders.title,
      category: reminders.category,
      due_date: reminders.due_date,
      completed: reminders.completed,
      created_at: reminders.created_at,
      property_name: properties.name,
    })
    .from(reminders)
    .leftJoin(properties, eq(properties.id, reminders.property_id))
    .where(eq(reminders.completed, 0))
    .orderBy(asc(reminders.due_date));
}

export async function createReminder(input: {
  property_id?: number | null;
  title: string;
  category: ReminderCategory;
  due_date: string;
}): Promise<number> {
  const db = await getDatabase();
  const [inserted] = await db
    .insert(reminders)
    .values({
      property_id: input.property_id ?? null,
      title: input.title.trim(),
      category: input.category,
      due_date: input.due_date,
    })
    .returning({ id: reminders.id });
  return inserted.id;
}

export async function toggleReminderCompleted(id: number, completed: boolean): Promise<void> {
  const db = await getDatabase();
  await db
    .update(reminders)
    .set({ completed: completed ? 1 : 0 })
    .where(eq(reminders.id, id));
}

// --- Fiscal Summary ---

export async function getFiscalSummaryByYear(year: number): Promise<PropertyFiscalSummary[]> {
  const db = await getDatabase();
  const prefix = `${year}-%`;
  const rows = await db
    .select({
      property_id: properties.id,
      property_name: properties.name,
      cadastral_ref: properties.cadastral_ref,
      regime: properties.regime,
      total_income: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.type} = 'ingreso' AND ${transactions.status} = 'completado' AND ${transactions.date} LIKE ${prefix} THEN ${transactions.amount} ELSE 0 END), 0)`,
      total_expense: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.type} = 'gasto' AND ${transactions.status} = 'completado' AND ${transactions.date} LIKE ${prefix} THEN ${transactions.amount} ELSE 0 END), 0)`,
    })
    .from(properties)
    .leftJoin(transactions, eq(transactions.property_id, properties.id))
    .groupBy(properties.id)
    .orderBy(asc(properties.name));

  return rows.map((row) => {
    const total_income = Number(row.total_income) || 0;
    const total_expense = Number(row.total_expense) || 0;
    return {
      property_id: row.property_id,
      property_name: row.property_name,
      cadastral_ref: row.cadastral_ref,
      regime: row.regime,
      total_income,
      total_expense,
      net_yield: total_income - total_expense,
    };
  });
}
