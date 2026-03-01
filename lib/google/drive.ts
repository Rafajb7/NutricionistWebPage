import { Readable } from "node:stream";
import { google } from "googleapis";
import { getEnv } from "@/lib/env";
import { getGoogleAuth } from "@/lib/google/auth";

type UploadPhotoInput = {
  username: string;
  originalFileName: string;
  mimeType: string;
  buffer: Buffer;
};

type UploadNutritionPlanInput = {
  username: string;
  originalFileName: string;
  mimeType: string;
  buffer: Buffer;
};

export type NutritionPlanFile = {
  id: string;
  name: string;
  mimeType: string;
  createdTime: string | null;
  modifiedTime: string | null;
  sizeBytes: number | null;
};

function escapeDriveQuery(value: string): string {
  return value.replace(/'/g, "\\'");
}

async function getDriveClient() {
  const auth = getGoogleAuth(["https://www.googleapis.com/auth/drive"]);
  return google.drive({ version: "v3", auth });
}

async function getDriveReadOnlyClient() {
  const auth = getGoogleAuth(["https://www.googleapis.com/auth/drive.readonly"]);
  return google.drive({ version: "v3", auth });
}

export async function ensureDriveFolder(
  drive: Awaited<ReturnType<typeof getDriveClient>>,
  parentId: string,
  folderName: string
): Promise<string> {
  const query = [
    `'${parentId}' in parents`,
    `name='${escapeDriveQuery(folderName)}'`,
    "mimeType='application/vnd.google-apps.folder'",
    "trashed=false"
  ].join(" and ");

  const list = await drive.files.list({
    q: query,
    fields: "files(id,name)",
    pageSize: 10
  });

  const existing = list.data.files?.[0];
  if (existing?.id) return existing.id;

  const create = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId]
    },
    fields: "id"
  });

  if (!create.data.id) {
    throw new Error(`Failed to create folder "${folderName}".`);
  }

  return create.data.id;
}

export async function uploadPhotoToDrive(input: UploadPhotoInput): Promise<{
  publicUrl: string;
  webViewLink: string | null;
}> {
  const env = getEnv();
  const drive = await getDriveClient();
  const rootId = env.GOOGLE_DRIVE_ROOT_FOLDER_ID;

  const fotosFolderId = await ensureDriveFolder(drive, rootId, "Fotos");
  const normalizedUsername = normalizeUserFolderKey(input.username);
  if (!normalizedUsername) {
    throw new Error("Invalid username for photo upload.");
  }
  const userFolderId = await ensureDriveFolder(drive, fotosFolderId, normalizedUsername);

  const now = Date.now();
  const safeName = input.originalFileName.replace(/[^\w.-]/g, "_");
  const driveFileName = `${now}_${safeName}`;

  const created = await drive.files.create({
    requestBody: {
      name: driveFileName,
      parents: [userFolderId],
      appProperties: {
        matUsername: normalizedUsername,
        matFileType: "revision-photo"
      }
    },
    media: {
      mimeType: input.mimeType,
      body: Readable.from(input.buffer)
    },
    fields: "id,webViewLink"
  });

  const fileId = created.data.id;
  if (!fileId) {
    throw new Error("Drive upload failed: missing file id.");
  }

  const publicUrl = `https://drive.google.com/uc?id=${fileId}`;
  return {
    publicUrl,
    webViewLink: created.data.webViewLink ?? null
  };
}

function normalizeUserFolderKey(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase();
}

async function findUserFolderInRoot(
  drive: Awaited<ReturnType<typeof getDriveReadOnlyClient>>,
  rootFolderId: string,
  username: string
): Promise<string | null> {
  const list = await drive.files.list({
    q: [
      `'${rootFolderId}' in parents`,
      "mimeType='application/vnd.google-apps.folder'",
      "trashed=false"
    ].join(" and "),
    fields: "files(id,name)",
    pageSize: 300
  });

  const target = normalizeUserFolderKey(username);
  const folder = (list.data.files ?? []).find(
    (item) => item.id && item.name && normalizeUserFolderKey(item.name) === target
  );

  return folder?.id ?? null;
}

async function ensureUserFolderInRoot(
  drive: Awaited<ReturnType<typeof getDriveClient>>,
  rootFolderId: string,
  username: string
): Promise<string> {
  const normalized = normalizeUserFolderKey(username);
  if (!normalized) {
    throw new Error("Invalid username for nutrition plan upload.");
  }
  return ensureDriveFolder(drive, rootFolderId, normalized);
}

function sanitizeDriveFileName(value: string): string {
  return value.replace(/[^\w.\- ]+/g, "_").trim() || "plan.pdf";
}

export async function listNutritionPlanPdfsForUser(username: string): Promise<NutritionPlanFile[]> {
  const env = getEnv();
  const drive = await getDriveReadOnlyClient();
  const userFolderId = await findUserFolderInRoot(
    drive,
    env.GOOGLE_NUTRITION_PLANS_ROOT_FOLDER_ID,
    username
  );

  if (!userFolderId) return [];

  const list = await drive.files.list({
    q: [`'${userFolderId}' in parents`, "trashed=false"].join(" and "),
    fields: "files(id,name,mimeType,createdTime,modifiedTime,size,shortcutDetails)",
    orderBy: "modifiedTime desc",
    pageSize: 200
  });

  const seen = new Set<string>();
  const out: NutritionPlanFile[] = [];

  for (const item of list.data.files ?? []) {
    const mimeType = String(item.mimeType ?? "");
    const name = String(item.name ?? "");
    const shortcutTargetId = item.shortcutDetails?.targetId ?? null;
    const shortcutTargetMime = item.shortcutDetails?.targetMimeType ?? "";

    const isPdfFile =
      mimeType === "application/pdf" ||
      /\.pdf$/i.test(name) ||
      (mimeType === "application/vnd.google-apps.shortcut" &&
        shortcutTargetMime === "application/pdf");

    if (!isPdfFile) continue;

    const resolvedId = shortcutTargetId ?? item.id;
    if (!resolvedId || seen.has(resolvedId)) continue;
    seen.add(resolvedId);

    out.push({
      id: String(resolvedId),
      name,
      mimeType: mimeType || "application/pdf",
      createdTime: item.createdTime ?? null,
      modifiedTime: item.modifiedTime ?? null,
      sizeBytes: item.size ? Number(item.size) : null
    });
  }

  return out;
}

export async function uploadNutritionPlanPdfForUser(
  input: UploadNutritionPlanInput
): Promise<NutritionPlanFile> {
  const env = getEnv();
  const drive = await getDriveClient();
  const userFolderId = await ensureUserFolderInRoot(
    drive,
    env.GOOGLE_NUTRITION_PLANS_ROOT_FOLDER_ID,
    input.username
  );

  const safeOriginal = sanitizeDriveFileName(input.originalFileName);
  const hasPdfExtension = /\.pdf$/i.test(safeOriginal);
  const driveFileName = hasPdfExtension ? safeOriginal : `${safeOriginal}.pdf`;

  const created = await drive.files.create({
    requestBody: {
      name: driveFileName,
      parents: [userFolderId]
    },
    media: {
      mimeType: input.mimeType || "application/pdf",
      body: Readable.from(input.buffer)
    },
    fields: "id,name,mimeType,createdTime,modifiedTime,size"
  });

  if (!created.data.id) {
    throw new Error("Nutrition plan upload failed: missing file id.");
  }

  return {
    id: String(created.data.id),
    name: String(created.data.name ?? driveFileName),
    mimeType: String(created.data.mimeType ?? "application/pdf"),
    createdTime: created.data.createdTime ?? null,
    modifiedTime: created.data.modifiedTime ?? null,
    sizeBytes: created.data.size ? Number(created.data.size) : null
  };
}

export async function downloadDriveFile(fileId: string): Promise<{
  data: Buffer;
  name: string;
  mimeType: string;
}> {
  const drive = await getDriveReadOnlyClient();
  const [metadata, media] = await Promise.all([
    drive.files.get({ fileId, fields: "name,mimeType" }),
    drive.files.get(
      { fileId, alt: "media" },
      {
        responseType: "arraybuffer"
      }
    )
  ]);

  return {
    data: Buffer.from(media.data as ArrayBuffer),
    name: metadata.data.name ?? `${fileId}.bin`,
    mimeType: metadata.data.mimeType ?? "application/octet-stream"
  };
}

export async function getDriveFileThumbnail(fileId: string): Promise<{
  data: Buffer;
  mimeType: string;
} | null> {
  const auth = getGoogleAuth(["https://www.googleapis.com/auth/drive.readonly"]);

  const metadata = await auth.request<{ thumbnailLink?: string }>({
    url: `https://www.googleapis.com/drive/v3/files/${fileId}?fields=thumbnailLink`,
    method: "GET"
  });

  const thumbnailLink = metadata.data?.thumbnailLink;
  if (!thumbnailLink) return null;

  const thumbResponse = await auth.request<ArrayBuffer>({
    url: thumbnailLink,
    method: "GET",
    responseType: "arraybuffer"
  });

  const mimeType = String(thumbResponse.headers["content-type"] ?? "image/jpeg");
  return {
    data: Buffer.from(thumbResponse.data as ArrayBuffer),
    mimeType
  };
}

export async function canUserAccessNutritionPlanFile(input: {
  username: string;
  permission: "user" | "admin";
  fileId: string;
}): Promise<boolean> {
  if (input.permission === "admin") return true;
  const plans = await listNutritionPlanPdfsForUser(input.username);
  return plans.some((plan) => plan.id === input.fileId);
}

export async function canUserAccessPhotoFile(input: {
  username: string;
  name: string;
  permission: "user" | "admin";
  fileId: string;
}): Promise<boolean> {
  if (input.permission === "admin") return true;

  const drive = await getDriveReadOnlyClient();
  const normalizedUsername = normalizeUserFolderKey(input.username);
  const normalizedName = normalizeUserFolderKey(input.name);

  try {
    const file = await drive.files.get({
      fileId: input.fileId,
      fields: "parents,appProperties,trashed"
    });
    if (file.data.trashed) return false;

    const ownerInProperties = normalizeUserFolderKey(file.data.appProperties?.matUsername ?? "");
    if (ownerInProperties && ownerInProperties === normalizedUsername) {
      return true;
    }

    const userFolderId = file.data.parents?.[0];
    if (!userFolderId) return false;

    const userFolder = await drive.files.get({
      fileId: userFolderId,
      fields: "name,mimeType,parents,trashed"
    });
    if (userFolder.data.trashed) return false;
    if (userFolder.data.mimeType !== "application/vnd.google-apps.folder") return false;

    const folderOwner = normalizeUserFolderKey(userFolder.data.name ?? "");
    if (!folderOwner) return false;
    if (folderOwner !== normalizedUsername && folderOwner !== normalizedName) return false;

    const fotosFolderId = userFolder.data.parents?.[0];
    if (!fotosFolderId) return false;

    const fotosFolder = await drive.files.get({
      fileId: fotosFolderId,
      fields: "name,trashed"
    });
    if (fotosFolder.data.trashed) return false;

    return normalizeUserFolderKey(fotosFolder.data.name ?? "") === "fotos";
  } catch {
    return false;
  }
}
