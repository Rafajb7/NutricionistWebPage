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
  getCommunityCommentById,
  softDeleteCommunityComment,
  updateCommunityCommentContent
} from "@/lib/google/community";
import { logError, logInfo } from "@/lib/logger";

const patchSchema = z.object({
  content: z.string().trim().min(1).max(2000)
});

type RouteContext = {
  params: Promise<{
    commentId: string;
  }>;
};

export async function PATCH(req: NextRequest, context: RouteContext) {
  const auth = await requireSession();
  if (!auth.session) return auth.response;

  try {
    const { commentId } = await context.params;
    const parsed = patchSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
    }

    const comment = await getCommunityCommentById(commentId);
    if (!comment) {
      return NextResponse.json({ error: "Comment not found." }, { status: 404 });
    }
    if (comment.status !== "active") {
      return NextResponse.json({ error: "Comment is not active." }, { status: 409 });
    }

    const nowIso = new Date().toISOString();
    const isAdmin = auth.session.permission === "admin";
    const isAuthor =
      normalizeCommunityUsername(comment.authorUsername) ===
      normalizeCommunityUsername(auth.session.username);
    const canEdit = isAdmin || (isAuthor && canAuthorEditUntil(comment.createdAt, nowIso));
    if (!canEdit) {
      return NextResponse.json(
        { error: "No tienes permiso para editar este comentario." },
        { status: 403 }
      );
    }

    const updated = await updateCommunityCommentContent({
      commentId,
      content: parsed.data.content,
      updatedAt: nowIso
    });
    if (!updated) {
      return NextResponse.json({ error: "Comment not found." }, { status: 404 });
    }

    await appendCommunityAuditEvent({
      eventId: createCommunityId("audit"),
      timestamp: nowIso,
      actorUsername: auth.session.username,
      actorRole: permissionToActorRole(auth.session.permission),
      entityType: "comment",
      entityId: commentId,
      action: "edit",
      snapshotJson: safeSnapshotJson({
        commentId,
        previousContent: comment.content,
        nextContent: parsed.data.content
      })
    });

    logInfo("Community comment edited", {
      username: auth.session.username,
      commentId
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    logError("Failed to edit community comment", {
      username: auth.session.username,
      error
    });
    return NextResponse.json({ error: "Could not edit comment." }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
  const auth = await requireSession();
  if (!auth.session) return auth.response;

  try {
    const { commentId } = await context.params;
    const comment = await getCommunityCommentById(commentId);
    if (!comment) {
      return NextResponse.json({ error: "Comment not found." }, { status: 404 });
    }

    const isAdmin = auth.session.permission === "admin";
    const isAuthor =
      normalizeCommunityUsername(comment.authorUsername) ===
      normalizeCommunityUsername(auth.session.username);

    if (!isAdmin && !isAuthor) {
      return NextResponse.json(
        { error: "No tienes permiso para eliminar este comentario." },
        { status: 403 }
      );
    }

    if (comment.status !== "active") {
      return NextResponse.json({ error: "Comment already removed." }, { status: 409 });
    }

    const nowIso = new Date().toISOString();
    const deleted = await softDeleteCommunityComment({
      commentId,
      deletedByUsername: auth.session.username,
      deletedByRole: permissionToActorRole(auth.session.permission),
      timestamp: nowIso
    });
    if (!deleted) {
      return NextResponse.json({ error: "Comment not found." }, { status: 404 });
    }

    await appendCommunityAuditEvent({
      eventId: createCommunityId("audit"),
      timestamp: nowIso,
      actorUsername: auth.session.username,
      actorRole: permissionToActorRole(auth.session.permission),
      entityType: "comment",
      entityId: commentId,
      action: isAdmin ? "delete_admin" : "delete_author",
      snapshotJson: safeSnapshotJson({
        commentId,
        previousStatus: comment.status,
        nextStatus: deleted.status
      })
    });

    logInfo("Community comment soft deleted", {
      username: auth.session.username,
      commentId,
      byRole: auth.session.permission
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    logError("Failed to delete community comment", {
      username: auth.session.username,
      error
    });
    return NextResponse.json({ error: "Could not delete comment." }, { status: 500 });
  }
}
