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
import {
  appendCommunityAuditEvent,
  createCommunityComment,
  getCommunityPostById,
  listCommunityComments
} from "@/lib/google/community";
import { logError, logInfo } from "@/lib/logger";

const querySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  includeModerated: z.enum(["0", "1"]).optional()
});

const createCommentSchema = z.object({
  content: z.string().trim().min(1).max(2000)
});

type RouteContext = {
  params: Promise<{
    postId: string;
  }>;
};

function toCommentPermissions(input: {
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

export async function GET(req: NextRequest, context: RouteContext) {
  const auth = await requireSession();
  if (!auth.session) return auth.response;

  try {
    const { postId } = await context.params;
    const post = await getCommunityPostById(postId);
    if (!post) {
      return NextResponse.json({ error: "Post not found." }, { status: 404 });
    }
    if (post.status !== "active" && auth.session.permission !== "admin") {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

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
    const comments = await listCommunityComments({
      postId,
      limit: parsed.data.limit,
      cursor: parsed.data.cursor ?? null,
      includeModerated
    });

    return NextResponse.json({
      items: comments.items.map((item) => ({
        ...item,
        permissions: toCommentPermissions({
          status: item.status,
          authorUsername: item.authorUsername,
          createdAt: item.createdAt,
          viewerUsername: auth.session.username,
          viewerPermission: auth.session.permission,
          nowIso
        })
      })),
      nextCursor: comments.nextCursor
    });
  } catch (error) {
    logError("Failed to load post comments", {
      username: auth.session.username,
      error
    });
    return NextResponse.json({ error: "Could not load comments." }, { status: 500 });
  }
}

export async function POST(req: NextRequest, context: RouteContext) {
  const auth = await requireSession();
  if (!auth.session) return auth.response;

  try {
    const { postId } = await context.params;
    const post = await getCommunityPostById(postId);
    if (!post) {
      return NextResponse.json({ error: "Post not found." }, { status: 404 });
    }
    if (post.status !== "active") {
      return NextResponse.json({ error: "No se puede comentar un post eliminado." }, { status: 409 });
    }

    const parsed = createCommentSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
    }

    const nowIso = new Date().toISOString();
    const commentId = createCommunityId("comment");
    await createCommunityComment({
      commentId,
      postId,
      createdAt: nowIso,
      updatedAt: nowIso,
      authorUsername: auth.session.username,
      authorName: auth.session.name,
      content: parsed.data.content
    });

    await appendCommunityAuditEvent({
      eventId: createCommunityId("audit"),
      timestamp: nowIso,
      actorUsername: auth.session.username,
      actorRole: permissionToActorRole(auth.session.permission),
      entityType: "comment",
      entityId: commentId,
      action: "create",
      snapshotJson: safeSnapshotJson({
        postId,
        commentId,
        contentLength: parsed.data.content.length
      })
    });

    logInfo("Community comment created", {
      username: auth.session.username,
      postId,
      commentId
    });

    return NextResponse.json({
      ok: true,
      comment: {
        commentId,
        postId,
        createdAt: nowIso,
        updatedAt: nowIso,
        status: "active",
        authorUsername: normalizeCommunityUsername(auth.session.username),
        authorName: auth.session.name,
        content: parsed.data.content,
        deletedAt: "",
        deletedByUsername: "",
        permissions: {
          canEdit: true,
          canDelete: true,
          canModerate: auth.session.permission === "admin"
        }
      }
    });
  } catch (error) {
    logError("Failed to create community comment", {
      username: auth.session.username,
      error
    });
    return NextResponse.json({ error: "Could not create comment." }, { status: 500 });
  }
}
