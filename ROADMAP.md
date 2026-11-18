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

- [x] Esquema SQLite V1 (`properties`, `transactions`, `incidents`, `reminders`) y sistema de migraciones por `PRAGMA user_version` (`src/db/schema.ts`, `src/db/database.ts`).
- [x] Navegación principal con 4 pestañas (`src/app/_layout.tsx`).
- [x] Pantallas base:
  - [x] `index.tsx` — Resumen del mes, semáforo de cobros y avisos.
  - [x] `pisos.tsx` — Gestión de pisos, incidencias y movimientos.
  - [x] `registrar.tsx` — Alta rápida de cobros/gastos con cámara, galería o PDF.
  - [x] `fiscal.tsx` — Resumen fiscal anual, exportación `.xlsx` y backup `.zip`.
- [x] Servicio de copias de seguridad `.zip` y exportación Excel (`src/services/backup.ts`).
- [ ] **Pendiente de verificación en Fase 1:**
  - [ ] Probar flujo completo en dispositivo real con Expo Go (cámara, selector PDF, compartir `.zip` por WhatsApp/Drive, restaurar `.zip`).
  - [ ] Revisar visor/previsualización de facturas adjuntas (fotos y PDFs) desde el historial de movimientos e incidencias.
  - [ ] Añadir filtro trimestral (T1–T4) además del anual en la pestaña Fiscal.

---

## Fase 2: Contratos, Estancias y Avisos Locales

- [ ] **Migración SQLite V2 (`leases`):**
  - [ ] Crear tabla `leases` para historial de contratos residenciales (inquilino, inicio/fin, renta, día de cobro, fianza) y estancias vacacionales (plataforma, check-in, check-out).
  - [ ] Migrar automáticamente los datos de contrato existentes en `properties` sin pérdida de información.
  - [ ] Añadir cálculo de **días alquilados vs. días vacíos a disposición** por inmueble y año fiscal para la declaración de la Renta.
- [ ] **Enlace Incidencia -> Gasto:**
  - [ ] Añadir `transaction_id` en `incidents` para vincular una avería con la factura de reparación correspondiente.
- [ ] **Notificaciones locales (`expo-notifications`):**
  - [ ] Instalar `expo-notifications` con `npx expo install expo-notifications`.
  - [ ] Programar avisos locales periódicos para día de cobro mensual, vencimientos de seguro, IBI y revisión anual de contrato/IPC.

---

## Fase 3: Calidad, Pruebas y Distribución

- [ ] **Tests automatizados:**
  - [ ] Configurar suite de tests (Jest) para migraciones SQLite (V1 -> V2), cálculos fiscales (ingresos, gastos, rendimiento neto, días alquilados) y generación de `.xlsx` / `.zip`.
- [ ] **Pulido de accesibilidad y UX:**
  - [ ] Validar tamaño de fuentes, contraste y flujos con el usuario final (uso real en móvil).
  - [ ] Mensajes de confirmación claros en acciones destructivas (eliminar piso, restaurar copia `.zip`).
- [ ] **Build y entrega con EAS:**
  - [ ] Configurar `eas.json` para generar builds de desarrollo / preview (`.apk` instalable en Android sin depender de Expo Go).
