import { Readable } from "node:stream";
import { google } from "googleapis";
import { getEnv } from "@/lib/env";
import { getGoogleAuth } from "@/lib/google/auth";

type UploadPhotoInput = {
  userName: string;
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
  const userFolderId = await ensureDriveFolder(drive, fotosFolderId, input.userName);

  const now = Date.now();
  const safeName = input.originalFileName.replace(/[^\w.-]/g, "_");
  const driveFileName = `${now}_${safeName}`;

  const created = await drive.files.create({
    requestBody: {
      name: driveFileName,
      parents: [userFolderId]
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

  await drive.permissions.create({
    fileId,
    requestBody: {
      type: "anyone",
      role: "reader"
    }
  });

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
