# Arquitectura — Gestión de Pisos

Este documento describe la arquitectura técnica, las decisiones de diseño, el modelo de datos orientado a Hacienda y la estructura de la aplicación.

---

## 1. Principios de diseño

- **Offline-first sin backend:** Toda la información reside en el dispositivo del usuario. No hay cuentas, servidores ni cuotas mensuales.
- **Portabilidad y seguridad de datos:** La base de datos SQLite y la carpeta de adjuntos (`attachments/`) se pueden empaquetar en un único archivo `.zip` para compartirlo por WhatsApp, Drive o correo e importarlo en otro dispositivo familiar.
- **Migraciones versionadas desde el día 1:** Toda evolución del esquema SQLite se gestiona mediante `PRAGMA user_version` para actualizar la app sin pérdida de datos.
- **UX directa y legible:** Componentes Material Design (`react-native-paper`) con tipografía clara, botones grandes y 4 pestañas principales.

---

## 2. Stack técnico (Expo SDK 58 + TypeScript)

- **Navegación:** `expo-router` con `Tabs` en `src/app/_layout.tsx`.
- **UI:** `react-native-paper` (`PaperProvider`) con soporte automático de tema claro/oscuro (`src/constants/paperTheme.ts`) e iconos de `@expo/vector-icons/MaterialCommunityIcons`.
- **Persistencia estructurada:** `expo-sqlite` (`gestion_pisos.db`).
- **Adjuntos (fotos y PDFs):** `expo-image-picker` y `expo-document-picker`, copiados al directorio persistente `Paths.document/attachments/` mediante `expo-file-system`.
- **Exportación fiscal:** `xlsx` genera libros Excel con resumen anual por inmueble y detalle de movimientos.
- **Copia de seguridad:** `jszip` empaqueta `SQLite/gestion_pisos.db` + `attachments/` en un `.zip`, compartido con `expo-sharing`.
- **Notificaciones locales *(Fase 2)*:** `expo-notifications` para recordatorios programados de cobro mensual, vencimientos de seguros, IBI y revisión de contratos/IPC.

---

## 3. Estructura de carpetas

```text
gestion-pisos/
├── app.json                  # Configuración de Expo, plugins y esquemas
├── package.json              # Dependencias (Expo SDK 58)
├── src/
│   ├── app/                  # Rutas de Expo Router (solo pantallas y layouts)
│   │   ├── _layout.tsx       # Inicialización SQLite + SplashScreen + Tabs MVP
│   │   ├── index.tsx         # Pestaña 1: Inicio (semáforo del mes y avisos)
│   │   ├── pisos.tsx         # Pestaña 2: Pisos (inmuebles, incidencias, historial)
│   │   ├── registrar.tsx     # Pestaña 3: Añadir (+) cobro/gasto en 3 pasos
│   │   └── fiscal.tsx        # Pestaña 4: Resumen fiscal, Excel y Backup .zip
│   ├── constants/
│   │   ├── paperTheme.ts     # Tema claro/oscuro de React Native Paper
│   │   └── theme.ts          # Tokens de color y espaciado
│   ├── db/
│   │   ├── schema.ts         # Tipos TypeScript, categorías fiscales y SQL V1
│   │   └── database.ts       # Conexión singleton, migraciones y queries CRUD
│   ├── services/
│   │   └── backup.ts         # Gestión de adjuntos, export/import .zip y .xlsx
│   ├── components/           # Componentes reutilizables
│   └── hooks/                # Hooks personalizados
```

---

## 4. Modelo de datos (pensado para Hacienda / IRPF)

### Esquema actual (Migración V1 — `src/db/schema.ts`)

1. **`properties` (Pisos / Inmuebles)**
   - `id`, `name` (nombre corto), `address`, `cadastral_ref` (referencia catastral para la Renta), `regime` (`residencial` | `vacacional`), `monthly_rent`, `payment_day`, `tenant_name`, `notes`, `created_at`.
2. **`transactions` (Cobros y Gastos)**
   - `id`, `property_id` (FK -> `properties.id`, `ON DELETE CASCADE`), `type` (`ingreso` | `gasto`), `category` (categoría fiscal), `amount` (importe total), `base_amount` (base imponible), `vat_amount` (IVA), `date` (`YYYY-MM-DD`), `status` (`completado` | `pendiente`), `description`, `attachment_uri` (nombre de archivo en `attachments/`), `created_at`.
   - Categorías de ingreso: *Alquiler mensual, Alquiler vacacional, Fianza recibida, Otros ingresos*.
   - Categorías de gasto deducible: *IBI y Tasas, Comunidad, Seguro hogar / impago, Reparación y conservación, Suministros (luz, agua, gas), Intereses hipoteca, Comisión plataforma (Airbnb/Booking), Limpieza y lavandería, Gestoría / Otros*.
3. **`incidents` (Incidencias)**
   - `id`, `property_id` (FK -> `properties.id`), `title`, `description`, `status` (`abierta` | `en_curso` | `resuelta`), `photo_uri`, `created_at`.
4. **`reminders` (Avisos)**
   - `id`, `property_id` (FK -> `properties.id`, `ON DELETE SET NULL`), `title`, `category` (`cobro` | `seguro` | `ibi` | `contrato` | `otro`), `due_date` (`YYYY-MM-DD`), `completed` (`0` | `1`), `created_at`.

### Evolución planificada (Migración V2 — Contratos y Estancias)

- **`leases` (Contratos / Estancias):** Desacoplar los datos del inquilino/estancia de `properties` para soportar historial de contratos y cálculo fiscal exacto:
  - *Residencial:* inquilino, fecha inicio/fin, renta mensual, día de cobro, fianza, revisión IPC.
  - *Vacacional:* plataforma (Airbnb, Booking, directo), `check_in`, `check_out` (para computar días alquilados vs. días vacíos a disposición del propietario en la Renta).
- **`incidents.transaction_id`:** Enlace opcional de una incidencia resuelta con su gasto asociado en `transactions`.

---

## 5. Pantallas del MVP (4 pestañas)

1. **Inicio (`src/app/index.tsx`):** Semáforo mensual de cobros por piso (pagado / pendiente) con acción rápida *"Marcar cobrado"* y listado de avisos próximos.
2. **Pisos (`src/app/pisos.tsx`):** Alta y edición de inmuebles, ficha detallada con datos de contrato actual, incidencias abiertas y movimientos del piso.
3. **Añadir (`src/app/registrar.tsx`):** Flujo rápido en 3 pasos:
   1. Tipo (*Cobro* o *Gasto*).
   2. Piso y Categoría fiscal.
   3. Importe (con base/IVA opcional) y adjunto desde cámara, galería o PDF.
4. **Fiscal y Copias (`src/app/fiscal.tsx`):** Resumen anual por piso (Ingresos, Gastos y Rendimiento neto), exportación a Excel (`.xlsx`) para gestoría, exportación de copia de seguridad (`.zip`) e importación de copia (`.zip`).

---

## 6. Flujo de Copias de Seguridad (`src/services/backup.ts`)

- **Exportación `.zip`:**
  1. Asegura que SQLite está inicializado y lee `Paths.document/SQLite/gestion_pisos.db`.
  2. Recorre `Paths.document/attachments/` e incluye todos los archivos adjuntos.
  3. Genera `backup_gestion_pisos_YYYY-MM-DD.zip` y abre la hoja nativa de compartir (`expo-sharing`).
- **Importación `.zip`:**
  1. Permite seleccionar un `.zip` con `expo-document-picker`.
  2. Cierra la conexión SQLite activa (`closeDatabase()`), valida la presencia de `gestion_pisos.db`, restaura la base de datos y los archivos de `attachments/`, y reabre la conexión ejecutando migraciones si hiciera falta.
