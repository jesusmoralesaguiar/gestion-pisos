---
name: strata-verifier
description: >-
  Project-specific second-agent verifier for gestion-pisos using the local
  Strata model (strata_chat). Activate when the user invokes /strata-verifier,
  asks to validate or audit an implementation in gestion-pisos, or before
  finalizing changes to DB schema/migrations, fiscal calculations, or backup flows.
---

# Strata Verifier — `gestion-pisos`

Skill de auditoría específica para este proyecto usando el modelo local **Strata** (`Qwen3.8-Flash-Next` vía MCP `strata-local` / `strata_chat`) como segundo agente verificador.

## Contexto de `gestion-pisos`

- **Stack:** Expo SDK 58 (`~58.0.26`), React Native `0.88.1`, TypeScript, Expo Router (`src/app/`).
- **UI:** `react-native-paper` v5 con tema claro/oscuro (`src/constants/paperTheme.ts`) e iconos `@expo/vector-icons/MaterialCommunityIcons`.
- **Persistencia offline-first:** `expo-sqlite` (`gestion_pisos.db`) + Drizzle ORM (`src/db/schema.ts`, `src/db/database.ts`, migraciones SQL en `drizzle/*.sql` y `drizzle/meta/_journal.json`).
- **Archivos y exportación:** `expo-file-system`, `expo-image-picker`, `expo-document-picker`, `jszip`, `xlsx`, `expo-sharing`.

## Checklist de auditoría

1. **Expo Router y estructura:**
   - Solo pantallas y `_layout.tsx` en `src/app/`.
   - Componentes, hooks, servicios, utilidades y capa de DB fuera de `src/app/`.
   - Nunca crear ni editar manualmente `ios/` o `android/` (CNG vía `app.json`).
2. **Drizzle ORM y SQLite:**
   - Si se modifica `src/db/schema.ts`, comprobar que existe la migración SQL correspondiente en `drizzle/` y que `drizzle/meta/_journal.json` y `drizzle/migrations.js` están actualizados (`npm run db:generate`).
   - Revisar integridad referencial (`ON DELETE CASCADE` / `SET NULL`) y compatibilidad retroactiva con bases de datos ya existentes en dispositivos.
3. **Reglas fiscales (IRPF / IGIC / IVA):**
   - `residencial` y `vacacional` Canarias `repep`: el rendimiento neto IRPF computa `amount` (importe total).
   - `vacacional` Canarias `general_420`: ingresos y gastos computables para IRPF se calculan sobre `base_amount` (base imponible), con el IGIC aparte.
   - Fianzas recibidas excluidas del cómputo IRPF salvo retención.
4. **Copias de seguridad (`src/services/backup.ts`):**
   - Al importar un `.zip`, cerrar la conexión SQLite activa (`closeDatabase()`) antes de reemplazar `gestion_pisos.db`, validar su presencia, restaurar `attachments/` y reabrir/migrar de forma segura.
5. **Calidad móvil y TypeScript:**
   - Manejo explícito de errores en operaciones `async/await` (FS, SQLite, picker, sharing).
   - Prevención de crashes por `null`/`undefined`/`NaN` en importes, divisiones o fechas (`YYYY-MM-DD`).
   - Compatibilidad Android/iOS y soporte correcto de tema claro/oscuro.

## Procedimiento

1. Obtener el alcance real de los cambios:
   - Ejecutar `git status --short` y `git diff` acotado a los archivos modificados relevantes (excluyendo `package-lock.json` o archivos generados irrelevantes).
   - Si hay archivos nuevos sin trackear en `src/` o `drizzle/`, leer su contenido para incluirlo en la auditoría.
2. Verificar compilación y lint antes o junto con la auditoría (`npx tsc --noEmit` y `npx expo lint`) e incluir el resultado en el contexto para Strata.
3. Llamar a `call_mcp_tool`:
   - `ServerName`: `"strata-local"`
   - `ToolName`: `"strata_chat"`
   - `Arguments`:
     - `thinking`: `true`
     - `temperature`: `0.0`
     - `max_tokens`: `3072`
     - `system`: Rol de auditor técnico estricto para `gestion-pisos` (Expo SDK 58, Drizzle ORM, reglas fiscales IRPF/IGIC, backup `.zip`, RN móvil) que solo marca como `BLOCKER` errores reales, regresiones, migraciones rotas, fallos fiscales o violaciones de arquitectura.
     - `prompt`: Resumen de la tarea realizada + resultado de `tsc`/`lint` + `git diff` + fragmentos de archivos nuevos/contexto necesario.
4. Exigir a Strata respuesta estructurada con clasificación **`BLOCKER`**, **`WARNING`** y **`NIT`**, y veredicto final **`APPROVE`** o **`REQUEST_CHANGES`**.
5. Si Strata reporta algún **`BLOCKER`**:
   - Corregir los problemas detectados, re-ejecutar `npx tsc --noEmit` / `npx expo lint` y volver a validar con Strata (máximo 2 rondas de corrección).
   - Presentar al usuario el veredicto de Strata (modelo local en RTX 5070 Ti), los hallazgos y las acciones tomadas.
