import { Buffer } from "node:buffer";
import { google } from "googleapis";
import { getEnv } from "@/lib/env";
import { getGoogleAuth } from "@/lib/google/auth";

export type CommunityAttachmentKind = "image" | "pdf" | "none";
export type CommunityEntityStatus = "active" | "deleted_by_author" | "deleted_by_admin";
export type CommunityActorRole = "user" | "admin";

export type CommunityPost = {
  postId: string;
  createdAt: string;
  updatedAt: string;
  status: CommunityEntityStatus;
  authorUsername: string;
  authorName: string;
  content: string;
  attachmentFileId: string;
  attachmentKind: CommunityAttachmentKind;
  attachmentName: string;
  attachmentMimeType: string;
  attachmentSizeBytes: number | null;
  deletedAt: string;
  deletedByUsername: string;
  commentCount: number;
};

export type CommunityComment = {
  commentId: string;
  postId: string;
  createdAt: string;
  updatedAt: string;
  status: CommunityEntityStatus;
  authorUsername: string;
  authorName: string;
  content: string;
  deletedAt: string;
  deletedByUsername: string;
};

type CommunityPostSheetRow = Omit<CommunityPost, "commentCount"> & {
  rowNumber: number;
};

type CommunityCommentSheetRow = CommunityComment & {
  rowNumber: number;
};

export type CommunityAuditEvent = {
  eventId: string;
  timestamp: string;
  actorUsername: string;
  actorRole: CommunityActorRole;
  entityType: "post" | "comment" | "attachment";
  entityId: string;
  action: "create" | "edit" | "delete_author" | "delete_admin";
  snapshotJson: string;
};

type CommunitySheetInfo = {
  spreadsheetId: string;
  postsWorksheetName: string;
  commentsWorksheetName: string;
  auditWorksheetName: string;
};

type CursorPayload = {
  createdAt: string;
  id: string;
};

export type CommunityFeedResult = {
  items: CommunityPost[];
  nextCursor: string | null;
};

export type CommunityCommentsResult = {
  items: CommunityComment[];
  nextCursor: string | null;
};

const spreadsheetIdCache = new Map<string, string>();
const worksheetTitleCache = new Map<string, string>();
const worksheetNamesCache = new Map<string, Set<string>>();
const communitySheetInitCache = new Map<string, Promise<CommunitySheetInfo>>();

const POSTS_HEADERS = [
  "postId",
  "createdAt",
  "updatedAt",
  "status",
  "authorUsername",
  "authorName",
  "content",
  "attachmentFileId",
  "attachmentKind",
  "attachmentName",
  "attachmentMimeType",
  "attachmentSizeBytes",
  "deletedAt",
  "deletedByUsername"
];

const COMMENTS_HEADERS = [
  "commentId",
  "postId",
  "createdAt",
  "updatedAt",
  "status",
  "authorUsername",
  "authorName",
  "content",
  "deletedAt",
  "deletedByUsername"
];

const AUDIT_HEADERS = [
  "eventId",
  "timestamp",
  "actorUsername",
  "actorRole",
  "entityType",
  "entityId",
  "action",
  "snapshotJson"
];

function escapeQueryValue(value: string): string {
  return value.replace(/'/g, "\\'");
}

function normalizeUsername(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase();
}

function parseNumber(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value.replace(",", ".").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function parseAttachmentKind(value: string | undefined): CommunityAttachmentKind {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "image") return "image";
  if (normalized === "pdf") return "pdf";
  return "none";
}

function parseEntityStatus(value: string | undefined): CommunityEntityStatus {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "deleted_by_author") return "deleted_by_author";
  if (normalized === "deleted_by_admin") return "deleted_by_admin";
  return "active";
}

function indexToA1Column(index: number): string {
  let result = "";
  let n = index + 1;
  while (n > 0) {
    const mod = (n - 1) % 26;
    result = String.fromCharCode(65 + mod) + result;
    n = Math.floor((n - mod) / 26);
  }
  return result;
}

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | null | undefined): CursorPayload | null {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = JSON.parse(raw) as CursorPayload;
    if (!parsed?.createdAt || !parsed?.id) return null;
    return {
      createdAt: String(parsed.createdAt),
      id: String(parsed.id)
    };
  } catch {
    return null;
  }
}

function compareDescByCreatedAtAndId(
  aCreatedAt: string,
  aId: string,
  bCreatedAt: string,
  bId: string
): number {
  const byCreatedAt = bCreatedAt.localeCompare(aCreatedAt);
  if (byCreatedAt !== 0) return byCreatedAt;
  return bId.localeCompare(aId);
}

function isAfterCursor(item: CursorPayload, cursor: CursorPayload | null): boolean {
  if (!cursor) return true;
  return compareDescByCreatedAtAndId(item.createdAt, item.id, cursor.createdAt, cursor.id) > 0;
}

async function getDriveClient() {
  const auth = getGoogleAuth(["https://www.googleapis.com/auth/drive"]);
  return google.drive({ version: "v3", auth });
}

async function getSheetsClient() {
  const auth = getGoogleAuth(["https://www.googleapis.com/auth/spreadsheets"]);
  return google.sheets({ version: "v4", auth });
}

function isValidSpreadsheetId(value: string | undefined): value is string {
  if (!value) return false;
  return /^[A-Za-z0-9-_]{20,}$/.test(value.trim());
}

async function resolveSpreadsheetIdByName(
  name: string,
  options?: {
    createIfMissing?: boolean;
    initialWorksheetTitle?: string;
  }
): Promise<string> {
  const cached = spreadsheetIdCache.get(name);
  if (cached) return cached;

  const drive = await getDriveClient();
  const query =
    `name='${escapeQueryValue(name)}' and ` +
    "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false";
  const res = await drive.files.list({
    q: query,
    fields: "files(id,name,modifiedTime)",
    orderBy: "modifiedTime desc",
    pageSize: 10
  });
  const match = res.data.files?.[0];
  if (match?.id) {
    spreadsheetIdCache.set(name, match.id);
    return match.id;
  }

  if (!options?.createIfMissing) {
    throw new Error(`Spreadsheet "${name}" not found in Google Drive.`);
  }

  const sheets = await getSheetsClient();
  const initialTitle = options.initialWorksheetTitle?.trim() || "Sheet1";
  const created = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: name },
      sheets: [{ properties: { title: initialTitle } }]
    },
    fields: "spreadsheetId"
  });
  const createdId = created.data.spreadsheetId;
  if (!createdId) {
    throw new Error(`Failed to create spreadsheet "${name}".`);
  }

  spreadsheetIdCache.set(name, createdId);
  worksheetTitleCache.set(createdId, initialTitle);
  worksheetNamesCache.set(createdId, new Set([initialTitle]));
  return createdId;
}

async function getWorksheetTitles(spreadsheetId: string): Promise<Set<string>> {
  const cached = worksheetNamesCache.get(spreadsheetId);
  if (cached) return cached;

  const sheets = await getSheetsClient();
  const response = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties.title"
  });

  const titles = new Set<string>();
  for (const sheet of response.data.sheets ?? []) {
    const title = sheet.properties?.title?.trim();
    if (title) titles.add(title);
  }

  if (!titles.size) {
    throw new Error(`Spreadsheet "${spreadsheetId}" has no worksheets.`);
  }

  worksheetNamesCache.set(spreadsheetId, titles);
  worksheetTitleCache.set(spreadsheetId, Array.from(titles)[0]);
  return titles;
}

async function ensureWorksheetExists(spreadsheetId: string, worksheetTitle: string): Promise<void> {
  const normalizedTitle = worksheetTitle.trim();
  if (!normalizedTitle) throw new Error("Worksheet title cannot be empty.");

  const titles = await getWorksheetTitles(spreadsheetId);
  if (titles.has(normalizedTitle)) return;

  const sheets = await getSheetsClient();
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: {
              title: normalizedTitle
            }
          }
        }
      ]
    }
  });

  const refreshed = new Set(titles);
  refreshed.add(normalizedTitle);
  worksheetNamesCache.set(spreadsheetId, refreshed);
}

async function resolveWorksheetName(input: {
  spreadsheetId: string;
  preferredName: string;
}): Promise<string> {
  const preferred = input.preferredName.trim();
  if (!preferred) {
    throw new Error("Worksheet preferredName cannot be empty.");
  }
  await ensureWorksheetExists(input.spreadsheetId, preferred);
  return preferred;
}

async function ensureHeaderRow(input: {
  spreadsheetId: string;
  worksheetName: string;
  headers: string[];
}): Promise<void> {
  const sheets = await getSheetsClient();
  const endCol = indexToA1Column(input.headers.length - 1);
  const range = `'${input.worksheetName}'!A1:${endCol}1`;
  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId: input.spreadsheetId,
    range
  });
  const firstRow = (existing.data.values?.[0] as string[] | undefined) ?? [];
  const hasAnyValue = firstRow.some((cell) => String(cell).trim().length > 0);
  if (hasAnyValue) return;

  await sheets.spreadsheets.values.update({
    spreadsheetId: input.spreadsheetId,
    range,
    valueInputOption: "RAW",
    requestBody: {
      values: [input.headers]
    }
  });
}

async function getWorksheetMetadataByTitle(input: {
  spreadsheetId: string;
  worksheetName: string;
}): Promise<{ sheetId: number; title: string }> {
  const sheets = await getSheetsClient();
  const response = await sheets.spreadsheets.get({
    spreadsheetId: input.spreadsheetId,
    fields: "sheets.properties.sheetId,sheets.properties.title"
  });

  for (const sheet of response.data.sheets ?? []) {
    const title = sheet.properties?.title?.trim();
    const sheetId = sheet.properties?.sheetId;
    if (!title || sheetId === undefined || sheetId === null) continue;
    if (title === input.worksheetName.trim()) return { sheetId, title };
  }

  throw new Error(
    `Worksheet "${input.worksheetName}" not found in spreadsheet "${input.spreadsheetId}".`
  );
}

async function ensureCommunitySheetReady(): Promise<CommunitySheetInfo> {
  const env = getEnv();
  const directId = env.GOOGLE_COMMUNITY_SPREADSHEET_ID?.trim();
  const hasDirectId = isValidSpreadsheetId(directId);
  const cacheKey = [
    hasDirectId ? directId : "",
    env.GOOGLE_COMMUNITY_SHEET_NAME,
    env.GOOGLE_COMMUNITY_POSTS_WORKSHEET_NAME,
    env.GOOGLE_COMMUNITY_COMMENTS_WORKSHEET_NAME,
    env.GOOGLE_COMMUNITY_AUDIT_WORKSHEET_NAME
  ].join("::");

  let pending = communitySheetInitCache.get(cacheKey);
  if (!pending) {
    pending = (async () => {
      const spreadsheetId = hasDirectId
        ? (directId as string)
        : await resolveSpreadsheetIdByName(env.GOOGLE_COMMUNITY_SHEET_NAME, {
            createIfMissing: true,
            initialWorksheetTitle: env.GOOGLE_COMMUNITY_POSTS_WORKSHEET_NAME
          });

      const postsWorksheetName = await resolveWorksheetName({
        spreadsheetId,
        preferredName: env.GOOGLE_COMMUNITY_POSTS_WORKSHEET_NAME
      });

      const commentsWorksheetName = await resolveWorksheetName({
        spreadsheetId,
        preferredName: env.GOOGLE_COMMUNITY_COMMENTS_WORKSHEET_NAME
      });

      const auditWorksheetName = await resolveWorksheetName({
        spreadsheetId,
        preferredName: env.GOOGLE_COMMUNITY_AUDIT_WORKSHEET_NAME
      });

      await Promise.all([
        ensureHeaderRow({
          spreadsheetId,
          worksheetName: postsWorksheetName,
          headers: POSTS_HEADERS
        }),
        ensureHeaderRow({
          spreadsheetId,
          worksheetName: commentsWorksheetName,
          headers: COMMENTS_HEADERS
        }),
        ensureHeaderRow({
          spreadsheetId,
          worksheetName: auditWorksheetName,
          headers: AUDIT_HEADERS
        })
      ]);

      return {
        spreadsheetId,
        postsWorksheetName,
        commentsWorksheetName,
        auditWorksheetName
      };
    })();
    communitySheetInitCache.set(cacheKey, pending);
  }

  try {
    return await pending;
  } catch (error) {
    communitySheetInitCache.delete(cacheKey);
    throw error;
  }
}

async function listPostSheetRows(): Promise<CommunityPostSheetRow[]> {
  const info = await ensureCommunitySheetReady();
  const sheets = await getSheetsClient();
  const values = await sheets.spreadsheets.values.get({
    spreadsheetId: info.spreadsheetId,
    range: `'${info.postsWorksheetName}'!A2:N`,
    valueRenderOption: "FORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING"
  });
  const rows = (values.data.values as string[][] | undefined) ?? [];
  const parsed: CommunityPostSheetRow[] = [];
  rows.forEach((row, index) => {
    const postId = String(row[0] ?? "").trim();
    if (!postId) return;
    parsed.push({
      rowNumber: index + 2,
      postId,
      createdAt: String(row[1] ?? "").trim(),
      updatedAt: String(row[2] ?? "").trim(),
      status: parseEntityStatus(row[3]),
      authorUsername: normalizeUsername(String(row[4] ?? "")),
      authorName: String(row[5] ?? "").trim(),
      content: String(row[6] ?? ""),
      attachmentFileId: String(row[7] ?? "").trim(),
      attachmentKind: parseAttachmentKind(row[8]),
      attachmentName: String(row[9] ?? "").trim(),
      attachmentMimeType: String(row[10] ?? "").trim(),
      attachmentSizeBytes: parseNumber(row[11]),
      deletedAt: String(row[12] ?? "").trim(),
      deletedByUsername: normalizeUsername(String(row[13] ?? ""))
    });
  });
  return parsed;
}

async function listCommentSheetRows(): Promise<CommunityCommentSheetRow[]> {
  const info = await ensureCommunitySheetReady();
  const sheets = await getSheetsClient();
  const values = await sheets.spreadsheets.values.get({
    spreadsheetId: info.spreadsheetId,
    range: `'${info.commentsWorksheetName}'!A2:J`,
    valueRenderOption: "FORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING"
  });
  const rows = (values.data.values as string[][] | undefined) ?? [];
  const parsed: CommunityCommentSheetRow[] = [];
  rows.forEach((row, index) => {
    const commentId = String(row[0] ?? "").trim();
    if (!commentId) return;
    parsed.push({
      rowNumber: index + 2,
      commentId,
      postId: String(row[1] ?? "").trim(),
      createdAt: String(row[2] ?? "").trim(),
      updatedAt: String(row[3] ?? "").trim(),
      status: parseEntityStatus(row[4]),
      authorUsername: normalizeUsername(String(row[5] ?? "")),
      authorName: String(row[6] ?? "").trim(),
      content: String(row[7] ?? ""),
      deletedAt: String(row[8] ?? "").trim(),
      deletedByUsername: normalizeUsername(String(row[9] ?? ""))
    });
  });
  return parsed;
}

function toPost(row: CommunityPostSheetRow, commentCount: number): CommunityPost {
  return {
    postId: row.postId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    status: row.status,
    authorUsername: row.authorUsername,
    authorName: row.authorName,
    content: row.content,
    attachmentFileId: row.attachmentFileId,
    attachmentKind: row.attachmentKind,
    attachmentName: row.attachmentName,
    attachmentMimeType: row.attachmentMimeType,
    attachmentSizeBytes: row.attachmentSizeBytes,
    deletedAt: row.deletedAt,
    deletedByUsername: row.deletedByUsername,
    commentCount
  };
}

function toComment(row: CommunityCommentSheetRow): CommunityComment {
  return {
    commentId: row.commentId,
    postId: row.postId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    status: row.status,
    authorUsername: row.authorUsername,
    authorName: row.authorName,
    content: row.content,
    deletedAt: row.deletedAt,
    deletedByUsername: row.deletedByUsername
  };
}

function sortPostsDesc(rows: CommunityPostSheetRow[]): CommunityPostSheetRow[] {
  return [...rows].sort((a, b) =>
    compareDescByCreatedAtAndId(a.createdAt, a.postId, b.createdAt, b.postId)
  );
}

function sortCommentsDesc(rows: CommunityCommentSheetRow[]): CommunityCommentSheetRow[] {
  return [...rows].sort((a, b) =>
    compareDescByCreatedAtAndId(a.createdAt, a.commentId, b.createdAt, b.commentId)
  );
}

function buildActiveCommentCountMap(comments: CommunityCommentSheetRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of comments) {
    if (item.status !== "active") continue;
    map.set(item.postId, (map.get(item.postId) ?? 0) + 1);
  }
  return map;
}

export async function listCommunityFeed(input: {
  limit: number;
  cursor?: string | null;
  includeModerated?: boolean;
}): Promise<CommunityFeedResult> {
  const limit = Math.min(Math.max(Math.trunc(input.limit || 0), 1), 50);
  const cursor = decodeCursor(input.cursor ?? null);

  const [posts, comments] = await Promise.all([listPostSheetRows(), listCommentSheetRows()]);
  const commentCounts = buildActiveCommentCountMap(comments);

  const visiblePosts = (input.includeModerated ? posts : posts.filter((item) => item.status === "active"))
    .filter((item) => isAfterCursor({ createdAt: item.createdAt, id: item.postId }, cursor));

  const sorted = sortPostsDesc(visiblePosts);
  const page = sorted.slice(0, limit);
  const nextItem = sorted[limit];
  const nextCursor = nextItem
    ? encodeCursor({ createdAt: nextItem.createdAt, id: nextItem.postId })
    : null;

  return {
    items: page.map((item) => toPost(item, commentCounts.get(item.postId) ?? 0)),
    nextCursor
  };
}

export async function listCommunityComments(input: {
  postId: string;
  limit: number;
  cursor?: string | null;
  includeModerated?: boolean;
}): Promise<CommunityCommentsResult> {
  const limit = Math.min(Math.max(Math.trunc(input.limit || 0), 1), 100);
  const cursor = decodeCursor(input.cursor ?? null);

  const comments = await listCommentSheetRows();
  const filtered = comments
    .filter((item) => item.postId === input.postId)
    .filter((item) => input.includeModerated || item.status === "active")
    .filter((item) => isAfterCursor({ createdAt: item.createdAt, id: item.commentId }, cursor));

  const sorted = sortCommentsDesc(filtered);
  const page = sorted.slice(0, limit);
  const nextItem = sorted[limit];
  const nextCursor = nextItem
    ? encodeCursor({ createdAt: nextItem.createdAt, id: nextItem.commentId })
    : null;

  return {
    items: page.map(toComment),
    nextCursor
  };
}

export async function getCommunityPostById(postId: string): Promise<CommunityPost | null> {
  const [posts, comments] = await Promise.all([listPostSheetRows(), listCommentSheetRows()]);
  const match = posts.find((item) => item.postId === postId);
  if (!match) return null;
  const commentCount = comments.filter((item) => item.postId === postId && item.status === "active").length;
  return toPost(match, commentCount);
}

export async function getCommunityCommentById(commentId: string): Promise<CommunityComment | null> {
  const comments = await listCommentSheetRows();
  const match = comments.find((item) => item.commentId === commentId);
  if (!match) return null;
  return toComment(match);
}

export async function createCommunityPost(input: {
  postId: string;
  createdAt: string;
  updatedAt: string;
  authorUsername: string;
  authorName: string;
  content: string;
  attachmentFileId?: string;
  attachmentKind?: CommunityAttachmentKind;
  attachmentName?: string;
  attachmentMimeType?: string;
  attachmentSizeBytes?: number | null;
}): Promise<void> {
  const info = await ensureCommunitySheetReady();
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: info.spreadsheetId,
    range: `'${info.postsWorksheetName}'!A:N`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [
        [
          input.postId,
          input.createdAt,
          input.updatedAt,
          "active",
          normalizeUsername(input.authorUsername),
          input.authorName.trim(),
          input.content,
          input.attachmentFileId ?? "",
          input.attachmentKind ?? "none",
          input.attachmentName ?? "",
          input.attachmentMimeType ?? "",
          input.attachmentSizeBytes ?? "",
          "",
          ""
        ]
      ]
    }
  });
}

async function updatePostSheetRow(row: CommunityPostSheetRow): Promise<void> {
  const info = await ensureCommunitySheetReady();
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: info.spreadsheetId,
    range: `'${info.postsWorksheetName}'!A${row.rowNumber}:N${row.rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [
        [
          row.postId,
          row.createdAt,
          row.updatedAt,
          row.status,
          row.authorUsername,
          row.authorName,
          row.content,
          row.attachmentFileId,
          row.attachmentKind,
          row.attachmentName,
          row.attachmentMimeType,
          row.attachmentSizeBytes ?? "",
          row.deletedAt,
          row.deletedByUsername
        ]
      ]
    }
  });
}

async function findPostSheetRow(postId: string): Promise<CommunityPostSheetRow | null> {
  const rows = await listPostSheetRows();
  return rows.find((item) => item.postId === postId) ?? null;
}

async function findCommentSheetRow(commentId: string): Promise<CommunityCommentSheetRow | null> {
  const rows = await listCommentSheetRows();
  return rows.find((item) => item.commentId === commentId) ?? null;
}

export async function updateCommunityPostContent(input: {
  postId: string;
  content: string;
  updatedAt: string;
}): Promise<CommunityPost | null> {
  const row = await findPostSheetRow(input.postId);
  if (!row) return null;
  row.content = input.content;
  row.updatedAt = input.updatedAt;
  await updatePostSheetRow(row);
  return toPost(row, 0);
}

export async function softDeleteCommunityPost(input: {
  postId: string;
  deletedByUsername: string;
  deletedByRole: CommunityActorRole;
  timestamp: string;
}): Promise<CommunityPost | null> {
  const row = await findPostSheetRow(input.postId);
  if (!row) return null;
  row.status = input.deletedByRole === "admin" ? "deleted_by_admin" : "deleted_by_author";
  row.updatedAt = input.timestamp;
  row.deletedAt = input.timestamp;
  row.deletedByUsername = normalizeUsername(input.deletedByUsername);
  await updatePostSheetRow(row);
  return toPost(row, 0);
}

export async function createCommunityComment(input: {
  commentId: string;
  postId: string;
  createdAt: string;
  updatedAt: string;
  authorUsername: string;
  authorName: string;
  content: string;
}): Promise<void> {
  const info = await ensureCommunitySheetReady();
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: info.spreadsheetId,
    range: `'${info.commentsWorksheetName}'!A:J`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [
        [
          input.commentId,
          input.postId,
          input.createdAt,
          input.updatedAt,
          "active",
          normalizeUsername(input.authorUsername),
          input.authorName.trim(),
          input.content,
          "",
          ""
        ]
      ]
    }
  });
}

async function updateCommentSheetRow(row: CommunityCommentSheetRow): Promise<void> {
  const info = await ensureCommunitySheetReady();
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: info.spreadsheetId,
    range: `'${info.commentsWorksheetName}'!A${row.rowNumber}:J${row.rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [
        [
          row.commentId,
          row.postId,
          row.createdAt,
          row.updatedAt,
          row.status,
          row.authorUsername,
          row.authorName,
          row.content,
          row.deletedAt,
          row.deletedByUsername
        ]
      ]
    }
  });
}

export async function updateCommunityCommentContent(input: {
  commentId: string;
  content: string;
  updatedAt: string;
}): Promise<CommunityComment | null> {
  const row = await findCommentSheetRow(input.commentId);
  if (!row) return null;
  row.content = input.content;
  row.updatedAt = input.updatedAt;
  await updateCommentSheetRow(row);
  return toComment(row);
}

export async function softDeleteCommunityComment(input: {
  commentId: string;
  deletedByUsername: string;
  deletedByRole: CommunityActorRole;
  timestamp: string;
}): Promise<CommunityComment | null> {
  const row = await findCommentSheetRow(input.commentId);
  if (!row) return null;
  row.status = input.deletedByRole === "admin" ? "deleted_by_admin" : "deleted_by_author";
  row.updatedAt = input.timestamp;
  row.deletedAt = input.timestamp;
  row.deletedByUsername = normalizeUsername(input.deletedByUsername);
  await updateCommentSheetRow(row);
  return toComment(row);
}

export async function appendCommunityAuditEvent(event: CommunityAuditEvent): Promise<void> {
  const info = await ensureCommunitySheetReady();
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: info.spreadsheetId,
    range: `'${info.auditWorksheetName}'!A:H`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [
        [
          event.eventId,
          event.timestamp,
          normalizeUsername(event.actorUsername),
          event.actorRole,
          event.entityType,
          event.entityId,
          event.action,
          event.snapshotJson
        ]
      ]
    }
  });
}

export async function getCommunityPostSheetMetadata() {
  const info = await ensureCommunitySheetReady();
  return {
    ...info,
    worksheetMeta: await getWorksheetMetadataByTitle({
      spreadsheetId: info.spreadsheetId,
      worksheetName: info.postsWorksheetName
    })
  };
}
