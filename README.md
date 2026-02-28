# Manuel Angel Trenas Web App

Migracion del bot de Telegram a una aplicacion web moderna con Next.js (App Router), TypeScript, TailwindCSS y Framer Motion.

## Stack

- Frontend: Next.js + TypeScript + Tailwind + Framer Motion
- Backend: Next.js Route Handlers (`/app/api/*`)
- Auth: cookie HttpOnly firmada (JWT HS256) + bcrypt
- Datos: Google Sheets + Google Drive (Service Account)
- Tests: Vitest (unit)

## Branding aplicado

- `--brand-accent`: `#F7CC2F`
- `--brand-accent-2`: `#A28932`
- `--brand-bg`: `#0B0B0C`
- `--brand-surface`: `#111113`
- `--brand-text`: `#FFFFFF`
- `--brand-muted`: `#B8B8B8`

Logo usado en header, login y favicon: `public/logoV1.png`.

## Requisitos

- Node.js 20+
- npm 10+
- Service Account de Google Cloud con acceso a Sheets/Drive

## Variables de entorno

Copia `.env.example` a `.env.local` solo si quieres sobrescribir defaults.

Notas:

- Si existe `credentials.json` en la raiz, no hace falta rellenar `GOOGLE_SERVICE_ACCOUNT_*`.
- `GOOGLE_USERS_SHEET_NAME`, `GOOGLE_QUESTIONS_SHEET_NAME`, `GOOGLE_REVISION_SHEET_NAME`, `GOOGLE_REVISION_WORKSHEET_NAME`, `GOOGLE_ROUTINE_SHEET_NAME`, `GOOGLE_ROUTINE_EXERCISES_WORKSHEET_NAME`, `GOOGLE_ROUTINE_LOGS_WORKSHEET_NAME`, `GOOGLE_DRIVE_ROOT_FOLDER_ID` y `GOOGLE_NUTRITION_PLANS_ROOT_FOLDER_ID` ya tienen valores por defecto.
- Si defines `GOOGLE_ROUTINE_EXERCISES_SPREADSHEET_ID` y/o `GOOGLE_ROUTINE_LOGS_SPREADSHEET_ID`, la app usa esos archivos directamente (prioridad sobre `GOOGLE_ROUTINE_SHEET_NAME`).
- En desarrollo, si no defines `SESSION_SECRET`, se usa un valor local de fallback.
- En produccion, `SESSION_SECRET` si es obligatorio.
- Para restablecer contrasena por email, configura SMTP (`SMTP_*`) y opcionalmente `APP_BASE_URL`.

Variables disponibles:

```bash
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=
GOOGLE_SERVICE_ACCOUNT_PROJECT_ID=
GOOGLE_SERVICE_ACCOUNT_CLIENT_ID=
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_ID=
# o GOOGLE_SERVICE_ACCOUNT_JSON={...}

GOOGLE_USERS_SHEET_NAME=Users
GOOGLE_QUESTIONS_SHEET_NAME=Preguntas
GOOGLE_REVISION_SHEET_NAME=Revisiones
GOOGLE_REVISION_WORKSHEET_NAME=Revision
GOOGLE_ROUTINE_SHEET_NAME=Rutinas
GOOGLE_ROUTINE_EXERCISES_SPREADSHEET_ID=
GOOGLE_ROUTINE_LOGS_SPREADSHEET_ID=
GOOGLE_ROUTINE_EXERCISES_WORKSHEET_NAME=Ejercicios
GOOGLE_ROUTINE_LOGS_WORKSHEET_NAME=Registro
GOOGLE_ACHIEVEMENTS_SPREADSHEET_ID=
GOOGLE_ACHIEVEMENTS_SHEET_NAME=Logros
GOOGLE_ACHIEVEMENTS_MARKS_WORKSHEET_NAME=Marcas
GOOGLE_ACHIEVEMENTS_GOALS_WORKSHEET_NAME=Objetivos
GOOGLE_DRIVE_ROOT_FOLDER_ID=1G-QgvfDD-dqMPzjuaA71ii7t6aWn_prX
GOOGLE_NUTRITION_PLANS_ROOT_FOLDER_ID=1B9yxdQztuuyzTeQrRB-JOP58vHCJ5Mmf
GOOGLE_COMPETITIONS_CALENDAR_ID=

APP_BASE_URL=http://localhost:3000
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
PASSWORD_RESET_TTL_MINUTES=30

SESSION_SECRET=pon-un-secreto-largo-y-aleatorio
SESSION_TTL_HOURS=24
ALLOW_PLAINTEXT_PASSWORDS=false
ADMIN_MIGRATION_TOKEN=token-seguro
MAX_UPLOAD_MB=8
```

## Service Account y permisos

1. Crea un proyecto en Google Cloud.
2. Habilita:
   - Google Sheets API
   - Google Drive API
3. Crea una Service Account y descarga credenciales JSON.
4. Comparte con el email de la service account:
   - Spreadsheet `Users`
   - Spreadsheet `Preguntas`
   - Spreadsheet `Revisiones`
   - Spreadsheet `Rutinas` (solo si usas modo por nombre)
   - Spreadsheet de catalogo de ejercicios (si usas `GOOGLE_ROUTINE_EXERCISES_SPREADSHEET_ID`)
   - Spreadsheet de registros de rutina (si usas `GOOGLE_ROUTINE_LOGS_SPREADSHEET_ID`)
   - Carpeta de Drive con id `1G-QgvfDD-dqMPzjuaA71ii7t6aWn_prX`
   - Carpeta de Drive de planes nutricionales con id `1B9yxdQztuuyzTeQrRB-JOP58vHCJ5Mmf`
   - Google Calendar de competiciones (`GOOGLE_COMPETITIONS_CALENDAR_ID`) compartido con la service account como editor
5. Asigna permisos de editor.

## Ejecutar en local

```bash
npm install
npm run dev
```

App:

- Login: `http://localhost:3000/login`
- Dashboard: `http://localhost:3000/dashboard`
- Herramientas: `http://localhost:3000/tools`

## Flujo funcional

- Login valida `Usuario` + `contrasena` del sheet `Users`.
- Modo compatibilidad plaintext solo si `ALLOW_PLAINTEXT_PASSWORDS=true`.
- Si la contrasena no esta en bcrypt (primer acceso), se fuerza cambio de contrasena.
- Al completar el cambio, se guarda hash bcrypt en la misma fila del sheet `Users`.
- La hoja `Users` puede incluir columna `email` (o `correo`/`mail`) para recuperacion.
- Restablecer contrasena:
  - Formulario en `/password/forgot` (usuario o email)
  - Envio de enlace por email con token firmado y expiracion (`PASSWORD_RESET_TTL_MINUTES`)
  - Cambio final en `/password/reset` pidiendo la nueva contrasena dos veces
- Boton `Nueva revision` abre wizard 1 pregunta/paso leyendo `Preguntas` columna A.
- Guardado en `Revisiones` / worksheet `Revision`:
  - `Nombre | Fecha | Telegram | Pregunta | Respuesta`
- Fotos:
  - subida al backend
  - almacenamiento en Drive en `/Fotos/{NombreUsuario}`
  - permiso `anyone reader`
  - se guarda URL publica en `Respuesta`
- Planes nutricionales:
  - lista de PDFs desde Drive en la carpeta configurada (`GOOGLE_NUTRITION_PLANS_ROOT_FOLDER_ID`)
  - busqueda por subcarpeta de usuario (`Usuario`) dentro de la carpeta raiz de planes
  - miniatura, visualizacion en modal y descarga desde la web
- Historico:
  - parsea enlaces directos y formulas `=IMAGE("...")`
  - filtros por fecha y busqueda por texto
  - galeria con lightbox animado
- Herramientas > Gestion de rutina:
  - catalogo base de 100 ejercicios agrupados por grupo muscular (editable desde Google Sheets)
  - planificador por dias con repeticiones, peso y notas
  - boton Registro que guarda la sesion en Google Sheets por usuario
  - historico y graficas de evolucion en peso y repeticiones por ejercicio
- Herramientas > Logros:
  - registro de marcas maximas en sentadilla, press de banca y peso muerto
  - objetivos por ejercicio con fecha objetivo
  - grafica comparativa entre marcas logradas y objetivos
- Herramientas > Competiciones:
  - calendario para registrar fecha de competicion, nombre, ubicacion y descripcion
  - registro automatico en Google Calendar
  - modo diablo (interfaz rojiza + aviso fijo) cuando falta 1 semana o menos para competir

## Script de migracion de contrasenas

Ruta script: `admin/migrate-passwords.ts`

Ejecutar:

```bash
npm run admin:migrate-passwords
```

Comportamiento:

- Lee sheet `Users`
- Si `contrasena` no esta en bcrypt, hashea con bcrypt(12)
- Sobrescribe la misma celda en la columna `contrasena`

Tambien existe endpoint protegido:

`POST /api/admin/migrate-passwords` con header `x-admin-token: <ADMIN_MIGRATION_TOKEN>`.

## Seed de hojas de rutinas

Para volcar automaticamente el catalogo base de 100 ejercicios y preparar cabeceras en registros:

```bash
npm run admin:seed-routine-sheets
```

Requiere definir en entorno:

- `GOOGLE_ROUTINE_EXERCISES_SPREADSHEET_ID`
- `GOOGLE_ROUTINE_LOGS_SPREADSHEET_ID`

## Tests

```bash
npm run test:run
```

Incluye unit tests para:

- parseo de formula `IMAGE()`
- auth bcrypt + toggle plaintext
- escritura en Sheets con mock

## Despliegue en Vercel

1. Sube repo a GitHub.
2. Importa proyecto en Vercel.
3. Configura al menos `SESSION_SECRET` y las credenciales de Google (env vars o `credentials.json`).
4. Deploy.
5. Verifica que la service account siga compartida en Sheets/Drive.
