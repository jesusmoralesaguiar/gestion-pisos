import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export type PropertyRegime = 'residencial' | 'vacacional';
export type TaxRegion = 'canarias' | 'peninsula';
export type IgicRegime = 'repep' | 'general_420';
export type TransactionType = 'ingreso' | 'gasto';
export type TransactionStatus = 'completado' | 'pendiente';
export type IncidentStatus = 'abierta' | 'en_curso' | 'resuelta';
export type ReminderCategory = 'cobro' | 'seguro' | 'ibi' | 'contrato' | 'otro';

export const INCOME_CATEGORIES = [
  'Alquiler mensual',
  'Alquiler vacacional',
  'Fianza recibida',
  'Otros ingresos',
] as const;

export const RENT_INCOME_CATEGORIES = ['Alquiler mensual', 'Alquiler vacacional'] as const;

export const NON_TAXABLE_INCOME_CATEGORIES = ['Fianza recibida'] as const;

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

export const properties = sqliteTable('properties', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  address: text('address').notNull().default(''),
  cadastral_ref: text('cadastral_ref').notNull().default(''),
  regime: text('regime').$type<PropertyRegime>().notNull().default('residencial'),
  tax_region: text('tax_region').$type<TaxRegion>().notNull().default('canarias'),
  igic_regime: text('igic_regime').$type<IgicRegime>().notNull().default('repep'),
  monthly_rent: real('monthly_rent').notNull().default(0),
  payment_day: integer('payment_day').notNull().default(5),
  tenant_name: text('tenant_name').notNull().default(''),
  notes: text('notes').notNull().default(''),
  created_at: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const transactions = sqliteTable(
  'transactions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    property_id: integer('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    type: text('type').$type<TransactionType>().notNull(),
    category: text('category').notNull(),
    amount: real('amount').notNull(),
    base_amount: real('base_amount').notNull().default(0),
    vat_amount: real('vat_amount').notNull().default(0),
    date: text('date').notNull(),
    status: text('status').$type<TransactionStatus>().notNull().default('completado'),
    description: text('description').notNull().default(''),
    attachment_uri: text('attachment_uri'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [index('idx_transactions_property_date').on(table.property_id, table.date)]
);

export const incidents = sqliteTable('incidents', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  property_id: integer('property_id')
    .notNull()
    .references(() => properties.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  status: text('status').$type<IncidentStatus>().notNull().default('abierta'),
  photo_uri: text('photo_uri'),
  created_at: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const reminders = sqliteTable(
  'reminders',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    property_id: integer('property_id').references(() => properties.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    category: text('category').$type<ReminderCategory>().notNull().default('otro'),
    due_date: text('due_date').notNull(),
    completed: integer('completed').notNull().default(0),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [index('idx_reminders_due_date').on(table.due_date, table.completed)]
);

export type Property = typeof properties.$inferSelect;
export type Transaction = typeof transactions.$inferSelect & { property_name?: string };
export type Incident = typeof incidents.$inferSelect & { property_name?: string };
export type Reminder = typeof reminders.$inferSelect & { property_name?: string | null };

export interface PropertyFiscalSummary {
  property_id: number;
  property_name: string;
  cadastral_ref: string;
  regime: PropertyRegime;
  tax_region: TaxRegion;
  igic_regime: IgicRegime;
  total_income: number;
  total_expense: number;
  net_yield: number;
}
