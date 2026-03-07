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
  getCommunityPostById,
  softDeleteCommunityPost,
  updateCommunityPostContent
} from "@/lib/google/community";
import { logError, logInfo } from "@/lib/logger";

const patchSchema = z.object({
  content: z.string().trim().min(1).max(5000)
});

type RouteContext = {
  params: Promise<{
    postId: string;
  }>;
};

export async function PATCH(req: NextRequest, context: RouteContext) {
  const auth = await requireSession();
  if (!auth.session) return auth.response;

  try {
    const { postId } = await context.params;
    const parsed = patchSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
    }

    const post = await getCommunityPostById(postId);
    if (!post) {
      return NextResponse.json({ error: "Post not found." }, { status: 404 });
    }
    if (post.status !== "active") {
      return NextResponse.json({ error: "Post is not active." }, { status: 409 });
    }

    const nowIso = new Date().toISOString();
    const isAdmin = auth.session.permission === "admin";
    const isAuthor =
      normalizeCommunityUsername(post.authorUsername) ===
      normalizeCommunityUsername(auth.session.username);
    const canEdit = isAdmin || (isAuthor && canAuthorEditUntil(post.createdAt, nowIso));
    if (!canEdit) {
      return NextResponse.json(
        { error: "No tienes permiso para editar esta publicacion." },
        { status: 403 }
      );
    }

    const updated = await updateCommunityPostContent({
      postId,
      content: parsed.data.content,
      updatedAt: nowIso
    });
    if (!updated) {
      return NextResponse.json({ error: "Post not found." }, { status: 404 });
    }

    await appendCommunityAuditEvent({
      eventId: createCommunityId("audit"),
      timestamp: nowIso,
      actorUsername: auth.session.username,
      actorRole: permissionToActorRole(auth.session.permission),
      entityType: "post",
      entityId: postId,
      action: "edit",
      snapshotJson: safeSnapshotJson({
        postId,
        previousContent: post.content,
        nextContent: parsed.data.content
      })
    });

    logInfo("Community post edited", {
      username: auth.session.username,
      postId
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    logError("Failed to edit community post", {
      username: auth.session.username,
      error
    });
    return NextResponse.json({ error: "Could not edit post." }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
  const auth = await requireSession();
  if (!auth.session) return auth.response;

  try {
    const { postId } = await context.params;
    const post = await getCommunityPostById(postId);
    if (!post) {
      return NextResponse.json({ error: "Post not found." }, { status: 404 });
    }

    const isAdmin = auth.session.permission === "admin";
    const isAuthor =
      normalizeCommunityUsername(post.authorUsername) ===
      normalizeCommunityUsername(auth.session.username);

    if (!isAdmin && !isAuthor) {
      return NextResponse.json(
        { error: "No tienes permiso para eliminar esta publicacion." },
        { status: 403 }
      );
    }

    if (post.status !== "active") {
      return NextResponse.json({ error: "Post already removed." }, { status: 409 });
    }

    const nowIso = new Date().toISOString();
    const deleted = await softDeleteCommunityPost({
      postId,
      deletedByUsername: auth.session.username,
      deletedByRole: permissionToActorRole(auth.session.permission),
      timestamp: nowIso
    });
    if (!deleted) {
      return NextResponse.json({ error: "Post not found." }, { status: 404 });
    }

    await appendCommunityAuditEvent({
      eventId: createCommunityId("audit"),
      timestamp: nowIso,
      actorUsername: auth.session.username,
      actorRole: permissionToActorRole(auth.session.permission),
      entityType: "post",
      entityId: postId,
      action: isAdmin ? "delete_admin" : "delete_author",
      snapshotJson: safeSnapshotJson({
        postId,
        previousStatus: post.status,
        nextStatus: deleted.status
      })
    });

    logInfo("Community post soft deleted", {
      username: auth.session.username,
      postId,
      byRole: auth.session.permission
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    logError("Failed to delete community post", {
      username: auth.session.username,
      error
    });
    return NextResponse.json({ error: "Could not delete post." }, { status: 500 });
  }
}
