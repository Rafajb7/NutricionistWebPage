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

Logo usado en header, login y favicon: `public/logo.jpeg`.

## Requisitos

- Node.js 20+
- npm 10+
- Service Account de Google Cloud con acceso a Sheets/Drive

## Variables de entorno

Copia `.env.example` a `.env.local` solo si quieres sobrescribir defaults.

Notas:

- Si existe `credentials.json` en la raiz, no hace falta rellenar `GOOGLE_SERVICE_ACCOUNT_*`.
- `GOOGLE_USERS_SHEET_NAME`, `GOOGLE_QUESTIONS_SHEET_NAME`, `GOOGLE_REVISION_SHEET_NAME`, `GOOGLE_REVISION_WORKSHEET_NAME`, `GOOGLE_DRIVE_ROOT_FOLDER_ID` y `GOOGLE_NUTRITION_PLANS_ROOT_FOLDER_ID` ya tienen valores por defecto.
- En desarrollo, si no defines `SESSION_SECRET`, se usa un valor local de fallback.
- En produccion, `SESSION_SECRET` si es obligatorio.

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
GOOGLE_DRIVE_ROOT_FOLDER_ID=1G-QgvfDD-dqMPzjuaA71ii7t6aWn_prX
GOOGLE_NUTRITION_PLANS_ROOT_FOLDER_ID=1B9yxdQztuuyzTeQrRB-JOP58vHCJ5Mmf

SESSION_SECRET=pon-un-secreto-largo-y-aleatorio
SESSION_TTL_HOURS=24
ALLOW_PLAINTEXT_PASSWORDS=true
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
   - Carpeta de Drive con id `1G-QgvfDD-dqMPzjuaA71ii7t6aWn_prX`
   - Carpeta de Drive de planes nutricionales con id `1B9yxdQztuuyzTeQrRB-JOP58vHCJ5Mmf`
5. Asigna permisos de editor.

## Ejecutar en local

```bash
npm install
npm run dev
```

App:

- Login: `http://localhost:3000/login`
- Dashboard: `http://localhost:3000/dashboard`

## Flujo funcional

- Login valida `Usuario` + `contraseñas` del sheet `Users`.
- Modo compatibilidad plaintext solo si `ALLOW_PLAINTEXT_PASSWORDS=true`.
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

## Script de migracion de contrasenas

Ruta script: `admin/migrate-passwords.ts`

Ejecutar:

```bash
npm run admin:migrate-passwords
```

Comportamiento:

- Lee sheet `Users`
- Si `contraseñas` no esta en bcrypt, hashea con bcrypt(12)
- Sobrescribe la misma celda en la columna `contraseñas`

Tambien existe endpoint protegido:

`POST /api/admin/migrate-passwords` con header `x-admin-token: <ADMIN_MIGRATION_TOKEN>`.

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
