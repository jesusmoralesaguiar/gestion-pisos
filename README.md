# Gestión de Pisos

Aplicación móvil **offline-first** construida con **React Native + Expo (SDK 58)** para la gestión sencilla de inmuebles en alquiler (residencial y vacacional), pensada para el uso diario y orientada a facilitar la declaración de la Renta (Hacienda) y las copias de seguridad familiares.

## Pilares del proyecto

1. **Simplicidad ante todo (4 pestañas):** Inicio (semáforo de cobros y alertas), Pisos, Añadir (`+` en 3 pasos) y Fiscal / Copias.
2. **100 % local y sin servidores:** Los datos viven en SQLite (`expo-sqlite`) con migraciones versionadas desde el día 1 y los justificantes (fotos/PDFs) se almacenan localmente en el dispositivo.
3. **Pensado para Hacienda y la gestoría:** Categorías fiscales alineadas con el IRPF, desglose de base imponible e IVA, referencia catastral por inmueble y exportación directa a Excel (`.xlsx`) y copia de seguridad completa (`.zip`).

## Stack principal

| Área | Tecnología |
| --- | --- |
| Framework | Expo SDK 58 (`~58.0.26`), React 19, React Native 0.88, TypeScript |
| Navegación | `expo-router` (rutas basadas en archivos en `src/app/`) |
| UI / Estilos | `react-native-paper` (Material Design 3, tema claro/oscuro) |
| Base de datos | `expo-sqlite` + **Drizzle ORM** (`drizzle-orm` / `drizzle-kit` para migraciones SQL versionadas) |
| Facturas y cámara | `expo-image-picker`, `expo-document-picker` |
| Backups y Excel | `expo-file-system`, `jszip`, `xlsx`, `expo-sharing` |
| Avisos locales *(planificado)* | `expo-notifications` |

## Documentación del proyecto

- [ARCHITECTURE.md](./ARCHITECTURE.md) — Arquitectura técnica, estructura de carpetas, modelo de datos SQLite y flujo de copias de seguridad.
- [ROADMAP.md](./ROADMAP.md) — Hoja de ruta por fases, estado actual y próximos hitos.
- [AGENTS.md](./AGENTS.md) — Reglas y convenciones de desarrollo para Expo / React Native en este repositorio.

## Puesta en marcha

```bash
# Instalar dependencias
npm install

# Arrancar servidor de desarrollo (Expo Go / emulador)
npx expo start

# Generar migración SQL tras editar src/db/schema.ts
npm run db:generate

# Verificación de tipos y lint
npm run typecheck
npx expo lint
```
