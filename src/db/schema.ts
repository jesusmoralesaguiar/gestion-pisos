export type PropertyRegime = 'residencial' | 'vacacional';
export type TransactionType = 'ingreso' | 'gasto';
export type TransactionStatus = 'completado' | 'pendiente';
export type IncidentStatus = 'abierta' | 'en_curso' | 'resuelta';
export type ReminderCategory = 'cobro' | 'seguro' | 'ibi' | 'contrato' | 'otro';

export interface Property {
  id: number;
  name: string;
  address: string;
  cadastral_ref: string;
  regime: PropertyRegime;
  monthly_rent: number;
  payment_day: number;
  tenant_name: string;
  notes: string;
  created_at: string;
}

export interface Transaction {
  id: number;
  property_id: number;
  property_name?: string;
  type: TransactionType;
  category: string;
  amount: number;
  base_amount: number;
  vat_amount: number;
  date: string; // YYYY-MM-DD
  status: TransactionStatus;
  description: string;
  attachment_uri: string | null;
  created_at: string;
}

export interface Incident {
  id: number;
  property_id: number;
  property_name?: string;
  title: string;
  description: string;
  status: IncidentStatus;
  photo_uri: string | null;
  created_at: string;
}

export interface Reminder {
  id: number;
  property_id: number | null;
  property_name?: string;
  title: string;
  category: ReminderCategory;
  due_date: string; // YYYY-MM-DD
  completed: number; // 0 | 1
  created_at: string;
}

export interface PropertyFiscalSummary {
  property_id: number;
  property_name: string;
  cadastral_ref: string;
  regime: PropertyRegime;
  total_income: number;
  total_expense: number;
  net_yield: number;
}

export const INCOME_CATEGORIES = [
  'Alquiler mensual',
  'Alquiler vacacional',
  'Fianza recibida',
  'Otros ingresos',
] as const;

export const EXPENSE_CATEGORIES = [
  'IBI y Tasas',
  'Comunidad',
  'Seguro hogar / impago',
  'Reparación y conservación',
  'Suministros (luz, agua, gas)',
  'Intereses hipoteca',
  'Comisión plataforma (Airbnb/Booking)',
  'Limpieza y lavandería',
  'Gestoría / Otros',
] as const;

export const CURRENT_DB_VERSION = 1;

export const MIGRATION_V1_SQL = `
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS properties (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    address TEXT NOT NULL DEFAULT '',
    cadastral_ref TEXT NOT NULL DEFAULT '',
    regime TEXT NOT NULL CHECK (regime IN ('residencial', 'vacacional')) DEFAULT 'residencial',
    monthly_rent REAL NOT NULL DEFAULT 0,
    payment_day INTEGER NOT NULL DEFAULT 5,
    tenant_name TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    property_id INTEGER NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('ingreso', 'gasto')),
    category TEXT NOT NULL,
    amount REAL NOT NULL,
    base_amount REAL NOT NULL DEFAULT 0,
    vat_amount REAL NOT NULL DEFAULT 0,
    date TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('completado', 'pendiente')) DEFAULT 'completado',
    description TEXT NOT NULL DEFAULT '',
    attachment_uri TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    property_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK (status IN ('abierta', 'en_curso', 'resuelta')) DEFAULT 'abierta',
    photo_uri TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    property_id INTEGER,
    title TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('cobro', 'seguro', 'ibi', 'contrato', 'otro')) DEFAULT 'otro',
    due_date TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_transactions_property_date ON transactions(property_id, date);
  CREATE INDEX IF NOT EXISTS idx_reminders_due_date ON reminders(due_date, completed);
`;
