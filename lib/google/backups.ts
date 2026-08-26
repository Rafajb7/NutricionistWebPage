import { google } from "googleapis";
import { getEnv } from "@/lib/env";
import { getGoogleAuth } from "@/lib/google/auth";

type BackupSource = {
  label: string;
  spreadsheetId?: string;
  spreadsheetName?: string;
};

type BackupResult =
  | {
      label: string;
      spreadsheetId: string;
      copiedFileId: string;
      copiedName: string;
      status: "copied";
    }
  | {
      label: string;
      spreadsheetId: string;
      copiedName: string;
      status: "skipped";
      reason: string;
    }
  | {
      label: string;
      status: "failed";
      reason: string;
    };

export type WeeklyBackupSummary = {
  date: string;
  folderId: string;
  folderName: string;
  results: BackupResult[];
};

const SPREADSHEET_MIME_TYPE = "application/vnd.google-apps.spreadsheet";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

function escapeDriveQuery(value: string): string {
  return value.replace(/'/g, "\\'");
}

function isValidSpreadsheetId(value: string | undefined): value is string {
  return Boolean(value && /^[A-Za-z0-9-_]{20,}$/.test(value.trim()));
}

function getMadridDateString(now = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

async function getDriveClient() {
  const auth = getGoogleAuth(["https://www.googleapis.com/auth/drive"]);
  return google.drive({ version: "v3", auth });
}

async function findSpreadsheetByName(name: string): Promise<string | null> {
  const drive = await getDriveClient();
  const query = [
    `name='${escapeDriveQuery(name)}'`,
    `mimeType='${SPREADSHEET_MIME_TYPE}'`,
    "trashed=false"
  ].join(" and ");

  const response = await drive.files.list({
    q: query,
    fields: "files(id,name,modifiedTime)",
    orderBy: "modifiedTime desc",
    pageSize: 10,
    includeItemsFromAllDrives: true,
    supportsAllDrives: true
  });

  return response.data.files?.[0]?.id ?? null;
}

async function ensureBackupDateFolder(input: {
  backupRootFolderId: string;
  date: string;
}): Promise<{ id: string; name: string }> {
  const drive = await getDriveClient();
  const folderName = input.date;
  const query = [
    `'${escapeDriveQuery(input.backupRootFolderId)}' in parents`,
    `name='${escapeDriveQuery(folderName)}'`,
    `mimeType='${FOLDER_MIME_TYPE}'`,
    "trashed=false"
  ].join(" and ");

  const existing = await drive.files.list({
    q: query,
    fields: "files(id,name)",
    pageSize: 10,
    includeItemsFromAllDrives: true,
    supportsAllDrives: true
  });

  const match = existing.data.files?.[0];
  if (match?.id) return { id: match.id, name: match.name ?? folderName };

  const created = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: FOLDER_MIME_TYPE,
      parents: [input.backupRootFolderId]
    },
    fields: "id,name",
    supportsAllDrives: true
  });

  if (!created.data.id) {
    throw new Error("Could not create backup folder.");
  }

  return {
    id: created.data.id,
    name: created.data.name ?? folderName
  };
}

async function fileExistsInFolder(input: {
  folderId: string;
  fileName: string;
}): Promise<boolean> {
  const drive = await getDriveClient();
  const query = [
    `'${escapeDriveQuery(input.folderId)}' in parents`,
    `name='${escapeDriveQuery(input.fileName)}'`,
    "trashed=false"
  ].join(" and ");

  const response = await drive.files.list({
    q: query,
    fields: "files(id)",
    pageSize: 1,
    includeItemsFromAllDrives: true,
    supportsAllDrives: true
  });

  return Boolean(response.data.files?.[0]?.id);
}

function sanitizeFileName(value: string): string {
  return value
    .trim()
    .replace(/[^\w.\- ]+/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 120);
}

async function copySpreadsheetToBackup(input: {
  source: BackupSource;
  dateFolderId: string;
  date: string;
}): Promise<BackupResult> {
  const spreadsheetId = isValidSpreadsheetId(input.source.spreadsheetId)
    ? input.source.spreadsheetId.trim()
    : input.source.spreadsheetName
      ? await findSpreadsheetByName(input.source.spreadsheetName)
      : null;

  if (!spreadsheetId) {
    return {
      label: input.source.label,
      status: "failed",
      reason: "Spreadsheet not found."
    };
  }

  const copiedName = sanitizeFileName(`${input.date} - ${input.source.label}`);
  if (await fileExistsInFolder({ folderId: input.dateFolderId, fileName: copiedName })) {
    return {
      label: input.source.label,
      spreadsheetId,
      copiedName,
      status: "skipped",
      reason: "Backup already exists for this date."
    };
  }

  const drive = await getDriveClient();
  const copied = await drive.files.copy({
    fileId: spreadsheetId,
    requestBody: {
      name: copiedName,
      parents: [input.dateFolderId]
    },
    fields: "id,name",
    supportsAllDrives: true
  });

  if (!copied.data.id) {
    return {
      label: input.source.label,
      status: "failed",
      reason: "Drive copy did not return a file id."
    };
  }

  return {
    label: input.source.label,
    spreadsheetId,
    copiedFileId: copied.data.id,
    copiedName: copied.data.name ?? copiedName,
    status: "copied"
  };
}

function buildBackupSources(): BackupSource[] {
  const env = getEnv();
  return [
    {
      label: "Users",
      spreadsheetName: env.GOOGLE_USERS_SHEET_NAME
    },
    {
      label: "Preguntas",
      spreadsheetName: env.GOOGLE_QUESTIONS_SHEET_NAME
    },
    {
      label: "Revisiones",
      spreadsheetName: env.GOOGLE_REVISION_SHEET_NAME
    },
    {
      label: "Rutinas ejercicios",
      spreadsheetId: env.GOOGLE_ROUTINE_EXERCISES_SPREADSHEET_ID,
      spreadsheetName: env.GOOGLE_ROUTINE_SHEET_NAME
    },
    {
      label: "Rutinas registros",
      spreadsheetId: env.GOOGLE_ROUTINE_LOGS_SPREADSHEET_ID,
      spreadsheetName: env.GOOGLE_ROUTINE_SHEET_NAME
    },
    {
      label: "Modo Pico",
      spreadsheetId: env.GOOGLE_PEAK_MODE_SPREADSHEET_ID,
      spreadsheetName: env.GOOGLE_PEAK_MODE_SHEET_NAME
    },
    {
      label: "Logros",
      spreadsheetId: env.GOOGLE_ACHIEVEMENTS_SPREADSHEET_ID,
      spreadsheetName: env.GOOGLE_ACHIEVEMENTS_SHEET_NAME
    },
    {
      label: "Gestion nutricional",
      spreadsheetId: env.GOOGLE_NUTRITION_MANAGEMENT_SPREADSHEET_ID,
      spreadsheetName: env.GOOGLE_NUTRITION_MANAGEMENT_SHEET_NAME
    },
    {
      label: "Finanzas",
      spreadsheetId: env.GOOGLE_FINANCE_SPREADSHEET_ID,
      spreadsheetName: env.GOOGLE_FINANCE_SHEET_NAME
    },
    {
      label: "Log",
      spreadsheetName: "Log"
    }
  ];
}

function dedupeSources(sources: BackupSource[]): BackupSource[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = isValidSpreadsheetId(source.spreadsheetId)
      ? `id:${source.spreadsheetId.trim()}`
      : `name:${source.spreadsheetName ?? source.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function runWeeklySheetBackup(input?: {
  date?: string;
}): Promise<WeeklyBackupSummary> {
  const env = getEnv();
  const date = input?.date ?? getMadridDateString();
  const dateFolder = await ensureBackupDateFolder({
    backupRootFolderId: env.GOOGLE_BACKUP_FOLDER_ID,
    date
  });

  const results: BackupResult[] = [];
  for (const source of dedupeSources(buildBackupSources())) {
    try {
      results.push(
        await copySpreadsheetToBackup({
          source,
          dateFolderId: dateFolder.id,
          date
        })
      );
    } catch (error) {
      results.push({
        label: source.label,
        status: "failed",
        reason: error instanceof Error ? error.message : "Unknown backup error."
      });
    }
  }

  return {
    date,
    folderId: dateFolder.id,
    folderName: dateFolder.name,
    results
  };
}
