import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import {
  canAuthorEditUntil,
  createCommunityId,
  normalizeCommunityUsername,
  permissionToActorRole,
  safeSnapshotJson
} from "@/lib/community";
import { getEnv } from "@/lib/env";
import {
  appendCommunityAuditEvent,
  createCommunityPost,
  listCommunityFeed
} from "@/lib/google/community";
import {
  deleteDriveFileById,
  uploadCommunityAttachmentToDrive
} from "@/lib/google/drive";
import { logError, logInfo } from "@/lib/logger";

const querySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(15),
  includeModerated: z.enum(["0", "1"]).optional()
});

const allowedAttachmentMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf"
]);

function toPostPermissions(input: {
  status: "active" | "deleted_by_author" | "deleted_by_admin";
  authorUsername: string;
  createdAt: string;
  viewerUsername: string;
  viewerPermission: "user" | "admin";
  nowIso: string;
}) {
  const isAdmin = input.viewerPermission === "admin";
  const isAuthor = normalizeCommunityUsername(input.authorUsername) === normalizeCommunityUsername(input.viewerUsername);
  const isActive = input.status === "active";

  return {
    canEdit: isActive && (isAdmin || (isAuthor && canAuthorEditUntil(input.createdAt, input.nowIso))),
    canDelete: isActive && (isAdmin || isAuthor),
    canModerate: isAdmin
  };
}

export async function GET(req: NextRequest) {
  const auth = await requireSession();
  if (!auth.session) return auth.response;

  try {
    const parsed = querySchema.safeParse({
      cursor: req.nextUrl.searchParams.get("cursor") ?? undefined,
      limit: req.nextUrl.searchParams.get("limit") ?? undefined,
      includeModerated: req.nextUrl.searchParams.get("includeModerated") ?? undefined
    });
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid query." }, { status: 400 });
    }

    const includeModerated =
      auth.session.permission === "admin" && parsed.data.includeModerated === "1";
    const nowIso = new Date().toISOString();
    const feed = await listCommunityFeed({
      limit: parsed.data.limit,
      cursor: parsed.data.cursor ?? null,
      includeModerated
    });

    const items = feed.items.map((item) => ({
      postId: item.postId,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      status: item.status,
      authorUsername: item.authorUsername,
      authorName: item.authorName,
      content: item.content,
      attachment:
        item.attachmentKind === "none"
          ? null
          : {
              fileId: item.attachmentFileId,
              kind: item.attachmentKind,
              name: item.attachmentName,
              mimeType: item.attachmentMimeType,
              sizeBytes: item.attachmentSizeBytes
            },
      deletedAt: item.deletedAt,
      deletedByUsername: item.deletedByUsername,
      commentCount: item.commentCount,
      permissions: toPostPermissions({
        status: item.status,
        authorUsername: item.authorUsername,
        createdAt: item.createdAt,
        viewerUsername: auth.session.username,
        viewerPermission: auth.session.permission,
        nowIso
      })
    }));

    return NextResponse.json({
      items,
      nextCursor: feed.nextCursor
    });
  } catch (error) {
    logError("Failed to load community feed", {
      username: auth.session.username,
      error
    });
    return NextResponse.json({ error: "Could not load community feed." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireSession();
  if (!auth.session) return auth.response;

  let uploadedAttachmentId: string | null = null;

  try {
    const formData = await req.formData();
    const contentRaw = formData.get("content");
    const attachmentRaw = formData.get("attachment");
    const content = typeof contentRaw === "string" ? contentRaw.trim() : "";

    if (!content || content.length > 5000) {
      return NextResponse.json(
        { error: "El contenido es obligatorio (1-5000 caracteres)." },
        { status: 400 }
      );
    }

    const postId = createCommunityId("post");
    const nowIso = new Date().toISOString();
    const maxBytes = getEnv().MAX_UPLOAD_MB * 1024 * 1024;

    let attachment: {
      fileId: string;
      kind: "image" | "pdf";
      name: string;
      mimeType: string;
      sizeBytes: number;
    } | null = null;

    if (attachmentRaw instanceof File && attachmentRaw.size > 0) {
      if (!allowedAttachmentMimeTypes.has(attachmentRaw.type)) {
        return NextResponse.json({ error: "Tipo de archivo no permitido." }, { status: 400 });
      }
      if (attachmentRaw.size > maxBytes) {
        return NextResponse.json({ error: "Archivo demasiado grande." }, { status: 400 });
      }

      const uploaded = await uploadCommunityAttachmentToDrive({
        username: auth.session.username,
        postId,
        originalFileName: attachmentRaw.name,
        mimeType: attachmentRaw.type,
        buffer: Buffer.from(await attachmentRaw.arrayBuffer())
      });
      uploadedAttachmentId = uploaded.id;
      attachment = {
        fileId: uploaded.id,
        kind: uploaded.kind,
        name: uploaded.name,
        mimeType: uploaded.mimeType,
        sizeBytes: uploaded.sizeBytes
      };
    }

    await createCommunityPost({
      postId,
      createdAt: nowIso,
      updatedAt: nowIso,
      authorUsername: auth.session.username,
      authorName: auth.session.name,
      content,
      attachmentFileId: attachment?.fileId,
      attachmentKind: attachment?.kind ?? "none",
      attachmentName: attachment?.name,
      attachmentMimeType: attachment?.mimeType,
      attachmentSizeBytes: attachment?.sizeBytes ?? null
    });

    await appendCommunityAuditEvent({
      eventId: createCommunityId("audit"),
      timestamp: nowIso,
      actorUsername: auth.session.username,
      actorRole: permissionToActorRole(auth.session.permission),
      entityType: "post",
      entityId: postId,
      action: "create",
      snapshotJson: safeSnapshotJson({
        postId,
        contentLength: content.length,
        hasAttachment: Boolean(attachment)
      })
    });

    if (attachment) {
      await appendCommunityAuditEvent({
        eventId: createCommunityId("audit"),
        timestamp: nowIso,
        actorUsername: auth.session.username,
        actorRole: permissionToActorRole(auth.session.permission),
        entityType: "attachment",
        entityId: attachment.fileId,
        action: "create",
        snapshotJson: safeSnapshotJson({
          postId,
          kind: attachment.kind,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes
        })
      });
    }

    logInfo("Community post created", {
      username: auth.session.username,
      postId,
      hasAttachment: Boolean(attachment)
    });

    return NextResponse.json({
      ok: true,
      post: {
        postId,
        createdAt: nowIso,
        updatedAt: nowIso,
        status: "active",
        authorUsername: normalizeCommunityUsername(auth.session.username),
        authorName: auth.session.name,
        content,
        attachment,
        deletedAt: "",
        deletedByUsername: "",
        commentCount: 0,
        permissions: {
          canEdit: true,
          canDelete: true,
          canModerate: auth.session.permission === "admin"
        }
      }
    });
  } catch (error) {
    if (uploadedAttachmentId) {
      try {
        await deleteDriveFileById(uploadedAttachmentId);
      } catch (cleanupError) {
        logError("Failed to cleanup uploaded community attachment", {
          username: auth.session.username,
          uploadedAttachmentId,
          cleanupError
        });
      }
    }

    logError("Failed to create community post", {
      username: auth.session.username,
      error
    });
    return NextResponse.json({ error: "Could not create post." }, { status: 500 });
  }
}
