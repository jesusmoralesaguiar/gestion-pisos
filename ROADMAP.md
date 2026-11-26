# Roadmap — Gestión de Pisos

Plan de desarrollo incremental para llevar la aplicación desde los cimientos hasta su uso diario en producción.

---

## Fase 0: Cimientos y Arquitectura *(Completada)*

- [x] Definición de los 3 pilares: stack en Expo, modelo de datos orientado a Hacienda y MVP de 4 pestañas.
- [x] Inicialización del proyecto Expo SDK 58 con TypeScript y `expo-router`.
- [x] Configuración de `react-native-paper` con tema claro/oscuro (`src/constants/paperTheme.ts`).
- [x] Documentación base en `README.md`, `ARCHITECTURE.md` y `ROADMAP.md`.

---

## Fase 1: MVP Funcional Offline *(En curso / Base implementada)*

- [x] Esquema SQLite V1 (`properties`, `transactions`, `incidents`, `reminders`) tipado con **Drizzle ORM** y migraciones ordenadas con `drizzle-kit` (`src/db/schema.ts`, `src/db/database.ts`, `drizzle/`).
- [x] Navegación principal con 4 pestañas (`src/app/_layout.tsx`).
- [x] Pantallas base:
  - [x] `index.tsx` — Resumen del mes, semáforo de cobros y avisos.
  - [x] `pisos.tsx` — Gestión de pisos, incidencias y movimientos.
  - [x] `registrar.tsx` — Alta rápida de cobros/gastos con cámara, galería o PDF.
  - [x] `fiscal.tsx` — Resumen fiscal anual, exportación `.xlsx` y backup `.zip`.
- [x] Servicio de copias de seguridad `.zip` y exportación Excel (`src/services/backup.ts`).
- [ ] **Pendiente de verificación en Fase 1:**
  - [ ] Probar flujo completo en dispositivo real con Expo Go (cámara, selector PDF, compartir `.zip` por WhatsApp/Drive, restaurar `.zip`).
  - [ ] Revisar visor/previsualización de facturas adjuntas (fotos y PDFs) desde el historial de movimientos e incidencias (usando `resolveAttachmentUri`).
  - [ ] Añadir filtro trimestral (T1–T4) además del anual en la pestaña Fiscal.

### Deuda técnica y mejoras detectadas (Hardening MVP)

- [x] **Integridad de datos y backups:**
  - [x] Cerrar SQLite (`closeDatabase()`) antes de empaquetar `.db` en `exportBackupZip()`, validar cabecera SQLite y limpiar posibles ficheros `-wal`/`-shm` al restaurar en `importBackupZip()`.
  - [x] Eliminar adjuntos huérfanos en `Paths.document/attachments/` al borrar pisos, borrar movimientos o quitar/reemplazar un adjunto del formulario.
  - [x] Crear helper de fechas locales (`src/utils/dates.ts`) para reemplazar `new Date().toISOString().slice(0, 10)` y evitar desfases de día/mes por UTC en España.
  - [x] Afinar `getMonthlyRentPaidPropertyIds` para contar únicamente ingresos de alquiler (no fianzas u otros) y bloquear el botón *"Cobrar"* contra doble toque rápido en `index.tsx`.
  - [x] Excluir `Fianza recibida` del rendimiento neto en `getFiscalSummaryByYear` / `.xlsx`.
  - [x] Soporte fiscal de **Islas Canarias (IGIC)** (`tax_region`, `igic_regime`: `repep` | `general_420`) consolidado en la migración inicial `0000` de Drizzle, etiqueta dinámica IGIC/IVA en `registrar.tsx` y cómputo IRPF por Base (Mod. 420) vs. Total (REPEP/residencial).
  - [x] Comprimir/redimensionar fotos de facturas al guardarlas (`expo-image-manipulator`, máx. 1600 px) para mantener backups `.zip` ligeros y enviables por WhatsApp.
- [ ] **UX móvil y CRUD completo:**
  - [x] Crear helper `formatEUR()` con `Intl.NumberFormat('es-ES')` para mostrar importes en formato español (`1.250,00 €`).
  - [x] Añadir pantalla de error recuperable al arrancar la app (`src/app/_layout.tsx`) si falla `getDatabase()` o una migración de Drizzle, ofreciendo **Reintentar** o **Restaurar copia `.zip`**.
  - [ ] Permitir editar pisos existentes (renta, inquilino, día de cobro, referencia catastral).
  - [ ] Permitir ver historial completo de movimientos, editarlos y eliminarlos (con confirmación).
  - [x] Validar estrictamente la entrada de fecha (`isValidISODate` en `AAAA-MM-DD`).
  - [ ] Sustituir la entrada manual de fecha por selector nativo (`@react-native-community/datetimepicker`).
  - [x] Añadir `KeyboardAvoidingView` y `keyboardShouldPersistTaps="handled"` en `registrar.tsx` (pendiente revisar diálogos de `pisos.tsx` si crecen).
- [x] **Higiene del repositorio y tooling:**
  - [x] Añadir script `"typecheck": "tsc --noEmit"` (y `"db:generate"`) en `package.json`.
  - [x] Eliminar archivos residuales de la plantilla inicial de Expo no utilizados (`app-tabs.*`, `animated-icon.*`, `web-badge.tsx`, `hint-row.tsx`, `use-color-scheme.web.ts`) y dejar `npx tsc --noEmit` y `npx expo lint` en 0 errores (pasar `npx expo-doctor` periódicamente).

---

## Fase 2: Contratos, Estancias, Fiscalidad Avanzada y Avisos Locales

- [ ] **Migración SQLite V2 (`leases` y campos fiscales):**
  - [ ] Crear tabla `leases` para historial de contratos residenciales (inquilino, inicio/fin, renta, día de cobro, fianza) y estancias vacacionales (plataforma, check-in, check-out).
  - [ ] Migrar automáticamente los datos de contrato existentes en `properties` sin pérdida de información.
  - [ ] Añadir cálculo de **días alquilados vs. días vacíos a disposición** por inmueble y año fiscal para la declaración de la Renta.
  - [ ] Añadir campo opcional `billing_month` (`YYYY-MM`) en `transactions` para separar el mes devengado de la fecha real de cobro (pagos atrasados o parciales).
  - [ ] Añadir campos opcionales en `properties` para amortización del 3 % en IRPF (`cadastral_construction_value` y `acquisition_value`).
- [ ] **Paquete Gestoría anual (`src/services/backup.ts`):**
  - [ ] Exportar **"Paquete Gestoría \<Año\>.zip"** distinto al backup familiar: incluye el `.xlsx` del ejercicio y únicamente las facturas de ese año renombradas de forma legible (`YYYY-MM-DD_Piso_Categoria_Importe.ext`).
- [ ] **Enlace Incidencia -> Gasto:**
  - [ ] Añadir `transaction_id` en `incidents` para vincular una avería con la factura de reparación correspondiente.
- [ ] **Titularidad, Copropiedad y Reparto Fiscal por Declarante (Gananciales, Privativos y Herencias):**
  - [ ] **Modelo flexible de titulares (`owners` + `property_owners`):**
    - [ ] Crear tabla `owners` (`id`, `name`, `nif` opcional, `notes`) para registrar libremente a cualquier familiar o contribuyente (padre, madre, hijos, herederos, etc.) sin limitar a dos personas fijas.
    - [ ] Crear tabla puente `property_owners` (`property_id`, `owner_id`, `ownership_pct`, `ownership_type`: `gananciales` | `privativo` | `herencia` | `proindiviso`, `valid_from` / `valid_to` opcionales para cambios de titularidad a mitad de ejercicio).
    - [ ] Validar en `pisos.tsx` que los porcentajes activos de cada inmueble sumen siempre **100%**, ofreciendo atajos rápidos (*Gananciales 50%/50%*, *Privativo 100%*, *Reparto equitativo entre N herederos* o porcentaje manual).
  - [ ] **Selector dinámico y cálculo proporcional en `fiscal.tsx` y `.xlsx` (`backup.ts`):**
    - [ ] Añadir selector dinámico de declarante en `fiscal.tsx` (`Todos 100%` + cada titular existente en `owners`) calculando automáticamente su parte proporcional de **ingresos, gastos y rendimiento neto** por referencia catastral.
    - [ ] Generar en `exportFiscalExcel()` una hoja global (100%) más **una hoja independiente por cada titular** lista para copiar a Renta Web o entregar a la gestoría.
  - [ ] **Alertas preventivas ante requerimientos de Hacienda (AEAT):**
    - [ ] Avisar si algún inmueble carece de `cadastral_ref` o si sus titulares no suman **100%**.
    - [ ] Indicar opcionalmente a nombre de quién figura el contrato o plataforma (Airbnb/Booking) y mostrar alerta si los ingresos entran bajo un único NIF en un inmueble compartido/ganancial (para asegurar que cada copropietario declare su porcentaje real).
    - [ ] Recordar la imputación proporcional de rentas inmobiliarias por días vacíos entre todos los copropietarios.
- [ ] **Notificaciones locales (`expo-notifications`):**
  - [ ] Instalar `expo-notifications` con `npx expo install expo-notifications`.
  - [ ] Programar avisos locales periódicos para día de cobro mensual, vencimientos de seguro, IBI, revisión anual de contrato/IPC y plazos de **IGIC Canarias (Modelo 420 trimestral / Modelo 425 anual)** cuando aplique.
- [ ] **Histórico fiscal avanzado (Canarias / fianzas):**
  - [ ] Permitir historial de cambios de régimen IGIC (`REPEP` <-> `Mod. 420`) dentro de un mismo ejercicio fiscal o guardar el régimen en cada transacción.
  - [ ] Permitir convertir total o parcialmente una `Fianza recibida` en ingreso computable si se retiene por desperfectos o impagos.

---

## Fase 3: Calidad, Pruebas y Distribución

- [ ] **Tests automatizados:**
  - [ ] Configurar suite de tests (Jest) para migraciones SQLite (V1 -> V2), cálculos fiscales (ingresos, gastos, rendimiento neto, días alquilados) y generación de `.xlsx` / `.zip`.
- [ ] **Pulido de accesibilidad, privacidad y soporte:**
  - [ ] Validar tamaño de fuentes, contraste y flujos con el usuario final (uso real en móvil).
  - [ ] Mensajes de confirmación claros en acciones destructivas (eliminar piso, restaurar copia `.zip`).
  - [ ] Añadir botón discreto *"Exportar diagnóstico"* (versión de app, migraciones aplicadas en `__drizzle_migrations`, tamaño de BD y últimos errores locales) para soporte familiar sin consola.
  - [ ] Valorar bloqueo opcional por biometría o PIN (`expo-local-authentication`) para proteger rentas, NIFs y referencias catastrales.
- [ ] **Arquitectura de pantallas:**
  - [ ] Crear ruta dinámica de ficha de inmueble (`src/app/piso/[id].tsx`) para detalle, contratos, incidencias e historial completo sin sobrecargar diálogos.
- [ ] **Build y entrega con EAS:**
  - [ ] Declarar plugins y textos de permisos en español en `app.json` (ej. `expo-image-picker`: cámara y galería) antes de salir de Expo Go.
  - [ ] Configurar `eas.json` para generar builds de desarrollo / preview (`.apk` instalable en Android sin depender de Expo Go).
