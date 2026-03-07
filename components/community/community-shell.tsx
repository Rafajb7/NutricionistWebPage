"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  FileText,
  Image as ImageIcon,
  LogOut,
  MessageCircle,
  Pencil,
  Shield,
  Trash2,
  Upload,
  X
} from "lucide-react";
import { toast } from "sonner";
import { BrandLogo } from "@/components/brand-logo";
import { BrandButton } from "@/components/ui/brand-button";
import { MotionPage } from "@/components/ui/motion-page";
import { Skeleton } from "@/components/ui/skeleton";

type SessionUser = { username: string; name: string; permission: "user" | "admin" };
type CommunityShellProps = { user: SessionUser };

type CommunityPost = {
  postId: string;
  createdAt: string;
  updatedAt: string;
  status: "active" | "deleted_by_author" | "deleted_by_admin";
  authorUsername: string;
  authorName: string;
  content: string;
  attachment: { fileId: string; kind: "image" | "pdf"; name: string } | null;
  commentCount: number;
  permissions: { canEdit: boolean; canDelete: boolean; canModerate: boolean };
};

type CommunityComment = {
  commentId: string;
  postId: string;
  createdAt: string;
  status: "active" | "deleted_by_author" | "deleted_by_admin";
  authorUsername: string;
  authorName: string;
  content: string;
  permissions: { canEdit: boolean; canDelete: boolean; canModerate: boolean };
};

type CommentState = {
  open: boolean;
  loading: boolean;
  loadingMore: boolean;
  sending: boolean;
  input: string;
  cursor: string | null;
  items: CommunityComment[];
};

const EMPTY_COMMENT_STATE: CommentState = {
  open: false,
  loading: false,
  loadingMore: false,
  sending: false,
  input: "",
  cursor: null,
  items: []
};

function toRelative(value: string): string {
  const parsed = new Date(value).getTime();
  if (!Number.isFinite(parsed)) return "";
  const diffMin = Math.floor((Date.now() - parsed) / 60_000);
  if (diffMin < 1) return "ahora";
  if (diffMin < 60) return `hace ${diffMin} min`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `hace ${diffHours} h`;
  return `hace ${Math.floor(diffHours / 24)} d`;
}

function isAllowedFile(file: File): boolean {
  return ["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(file.type);
}

export function CommunityShell({ user }: CommunityShellProps) {
  const router = useRouter();
  const isAdmin = user.permission === "admin";

  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [feedLoadingMore, setFeedLoadingMore] = useState(false);
  const [feedCursor, setFeedCursor] = useState<string | null>(null);
  const [includeModerated, setIncludeModerated] = useState(false);

  const [postText, setPostText] = useState("");
  const [postFile, setPostFile] = useState<File | null>(null);
  const [publishing, setPublishing] = useState(false);

  const [commentsByPost, setCommentsByPost] = useState<Record<string, CommentState>>({});

  const hasMore = Boolean(feedCursor);
  const postFileLabel = useMemo(() => (postFile ? postFile.name : ""), [postFile]);

  useEffect(() => {
    router.prefetch("/dashboard");
    router.prefetch("/tools");
  }, [router]);

  useEffect(() => {
    void loadFeed(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeModerated]);

  function commentState(postId: string): CommentState {
    return commentsByPost[postId] ?? EMPTY_COMMENT_STATE;
  }

  function patchCommentState(postId: string, next: Partial<CommentState>) {
    setCommentsByPost((prev) => ({
      ...prev,
      [postId]: { ...EMPTY_COMMENT_STATE, ...(prev[postId] ?? {}), ...next }
    }));
  }

  async function loadFeed(reset: boolean) {
    if (reset) setFeedLoading(true);
    else setFeedLoadingMore(true);

    try {
      const params = new URLSearchParams();
      params.set("limit", "12");
      if (!reset && feedCursor) params.set("cursor", feedCursor);
      if (isAdmin && includeModerated) params.set("includeModerated", "1");

      const res = await fetch(`/api/community/posts?${params.toString()}`, { cache: "no-store" });
      if (res.status === 401) return void (window.location.href = "/login");
      const json = (await res.json()) as { items?: CommunityPost[]; nextCursor?: string | null; error?: string };
      if (!res.ok) return void toast.error(json.error ?? "No se pudo cargar la comunidad.");

      const nextItems = Array.isArray(json.items) ? json.items : [];
      setPosts((prev) => (reset ? nextItems : [...prev, ...nextItems]));
      setFeedCursor(json.nextCursor ?? null);
    } catch (error) {
      console.error(error);
      toast.error("Error cargando publicaciones.");
    } finally {
      setFeedLoading(false);
      setFeedLoadingMore(false);
    }
  }

  async function publishPost() {
    const content = postText.trim();
    if (!content) return void toast.error("Escribe contenido para publicar.");
    if (postFile && !isAllowedFile(postFile)) return void toast.error("Archivo no permitido.");

    setPublishing(true);
    try {
      const form = new FormData();
      form.append("content", content);
      if (postFile) form.append("attachment", postFile);

      const res = await fetch("/api/community/posts", { method: "POST", body: form });
      if (res.status === 401) return void (window.location.href = "/login");
      const json = (await res.json()) as { post?: CommunityPost; error?: string };
      if (!res.ok) return void toast.error(json.error ?? "No se pudo publicar.");

      if (json.post) setPosts((prev) => [json.post as CommunityPost, ...prev]);
      setPostText("");
      setPostFile(null);
      toast.success("Publicacion creada.");
    } catch (error) {
      console.error(error);
      toast.error("Error publicando.");
    } finally {
      setPublishing(false);
    }
  }

  async function editPost(post: CommunityPost) {
    const nextContent = window.prompt("Editar publicacion", post.content);
    if (nextContent === null) return;
    const trimmed = nextContent.trim();
    if (!trimmed) return void toast.error("El contenido no puede estar vacío.");

    const res = await fetch(`/api/community/posts/${post.postId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: trimmed })
    });
    const json = (await res.json()) as { error?: string };
    if (!res.ok) return void toast.error(json.error ?? "No se pudo editar.");
    setPosts((prev) => prev.map((item) => (item.postId === post.postId ? { ...item, content: trimmed } : item)));
  }

  async function removePost(postId: string) {
    if (!window.confirm("¿Eliminar esta publicacion?")) return;
    const res = await fetch(`/api/community/posts/${postId}`, { method: "DELETE" });
    const json = (await res.json()) as { error?: string };
    if (!res.ok) return void toast.error(json.error ?? "No se pudo eliminar.");
    await loadFeed(true);
  }

  async function toggleComments(postId: string) {
    const state = commentState(postId);
    patchCommentState(postId, { open: !state.open });
    if (state.open || state.items.length) return;
    await loadComments(postId, true);
  }

  async function loadComments(postId: string, reset: boolean) {
    const state = commentState(postId);
    patchCommentState(postId, reset ? { loading: true } : { loadingMore: true });
    try {
      const params = new URLSearchParams();
      params.set("limit", "20");
      if (!reset && state.cursor) params.set("cursor", state.cursor);
      if (isAdmin && includeModerated) params.set("includeModerated", "1");
      const res = await fetch(`/api/community/posts/${postId}/comments?${params.toString()}`, {
        cache: "no-store"
      });
      const json = (await res.json()) as { items?: CommunityComment[]; nextCursor?: string | null; error?: string };
      if (!res.ok) return void toast.error(json.error ?? "No se pudieron cargar comentarios.");
      const items = Array.isArray(json.items) ? json.items : [];
      patchCommentState(postId, {
        items: reset ? items : [...state.items, ...items],
        cursor: json.nextCursor ?? null
      });
    } catch (error) {
      console.error(error);
      toast.error("Error cargando comentarios.");
    } finally {
      patchCommentState(postId, { loading: false, loadingMore: false });
    }
  }

  async function sendComment(postId: string) {
    const state = commentState(postId);
    const content = state.input.trim();
    if (!content) return;
    patchCommentState(postId, { sending: true });
    try {
      const res = await fetch(`/api/community/posts/${postId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content })
      });
      const json = (await res.json()) as { comment?: CommunityComment; error?: string };
      if (!res.ok) return void toast.error(json.error ?? "No se pudo publicar comentario.");
      patchCommentState(postId, {
        items: json.comment ? [json.comment, ...commentState(postId).items] : commentState(postId).items,
        input: ""
      });
      setPosts((prev) => prev.map((item) => (item.postId === postId ? { ...item, commentCount: item.commentCount + 1 } : item)));
    } catch (error) {
      console.error(error);
      toast.error("Error al comentar.");
    } finally {
      patchCommentState(postId, { sending: false });
    }
  }

  async function editComment(postId: string, comment: CommunityComment) {
    const next = window.prompt("Editar comentario", comment.content);
    if (next === null) return;
    const content = next.trim();
    if (!content) return;
    const res = await fetch(`/api/community/comments/${comment.commentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content })
    });
    const json = (await res.json()) as { error?: string };
    if (!res.ok) return void toast.error(json.error ?? "No se pudo editar comentario.");
    patchCommentState(postId, {
      items: commentState(postId).items.map((item) =>
        item.commentId === comment.commentId ? { ...item, content } : item
      )
    });
  }

  async function removeComment(postId: string, commentId: string) {
    if (!window.confirm("¿Eliminar comentario?")) return;
    const res = await fetch(`/api/community/comments/${commentId}`, { method: "DELETE" });
    const json = (await res.json()) as { error?: string };
    if (!res.ok) return void toast.error(json.error ?? "No se pudo eliminar comentario.");
    await loadComments(postId, true);
    setPosts((prev) =>
      prev.map((item) =>
        item.postId === postId ? { ...item, commentCount: Math.max(0, item.commentCount - 1) } : item
      )
    );
  }

  async function handleLogout() {
    const res = await fetch("/api/logout", { method: "POST" });
    if (!res.ok) return void toast.error("No se pudo cerrar la sesion.");
    window.location.href = "/login";
  }

  return (
    <MotionPage>
      <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 md:px-8">
        <header className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4 backdrop-blur">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <BrandLogo />
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
              <Link href="/dashboard"><BrandButton variant="ghost" className="w-full justify-center px-4 py-2 sm:w-auto">Dashboard</BrandButton></Link>
              <Link href="/tools"><BrandButton variant="ghost" className="w-full justify-center px-4 py-2 sm:w-auto">Herramientas</BrandButton></Link>
              <Link href="/community"><BrandButton className="w-full justify-center px-4 py-2 sm:w-auto">Comunidad</BrandButton></Link>
              <BrandButton variant="ghost" className="w-full justify-center px-4 py-2 sm:w-auto" onClick={handleLogout}><LogOut className="mr-2 h-4 w-4" />Logout</BrandButton>
            </div>
          </div>
        </header>

        <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl border border-brand-accent/25 bg-brand-surface/85 p-4 shadow-glow">
          <div className="flex items-start justify-between gap-3">
            <div><p className="text-xs uppercase tracking-[0.22em] text-brand-muted">Comunidad</p><h1 className="mt-1 text-2xl font-bold text-brand-text">Muro global</h1></div>
            {isAdmin ? <label className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-black/25 px-3 py-2 text-xs text-brand-muted"><input type="checkbox" checked={includeModerated} onChange={(event) => setIncludeModerated(event.target.checked)} className="h-4 w-4 rounded border-white/20 bg-black/20 accent-brand-accent" /><Shield className="h-3.5 w-3.5 text-brand-accent" />Ver moderados</label> : null}
          </div>
          <textarea value={postText} onChange={(event) => setPostText(event.target.value)} rows={4} maxLength={5000} placeholder="Comparte avances, dudas o aprendizajes..." className="mt-4 w-full resize-y rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-brand-text outline-none transition focus:border-brand-accent/60" />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-white/20 bg-black/25 px-3 py-2 text-xs text-brand-text transition hover:bg-black/35">
                <Upload className="h-4 w-4 text-brand-accent" />
                Adjuntar imagen/PDF
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    if (file && !isAllowedFile(file)) {
                      toast.error("Archivo no permitido.");
                      return;
                    }
                    setPostFile(file);
                  }}
                />
              </label>
              {postFile ? (
                <span className="inline-flex items-center gap-2 rounded-xl border border-brand-accent/35 bg-brand-accent/10 px-3 py-2 text-xs text-brand-text">
                  {postFile.type === "application/pdf" ? (
                    <FileText className="h-3.5 w-3.5" />
                  ) : (
                    <ImageIcon className="h-3.5 w-3.5" />
                  )}
                  {postFileLabel}
                  <button
                    type="button"
                    onClick={() => setPostFile(null)}
                    className="inline-flex h-5 w-5 items-center justify-center rounded-md border border-white/20 hover:bg-black/30"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ) : null}
            </div>
            <BrandButton onClick={publishPost} disabled={publishing}>{publishing ? "Publicando..." : "Publicar"}</BrandButton>
          </div>
        </motion.section>

        {feedLoading ? <section className="space-y-3">{Array.from({ length: 3 }).map((_, index) => <div key={index} className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4"><Skeleton className="h-5 w-40" /><Skeleton className="mt-3 h-4 w-full" /><Skeleton className="mt-2 h-4 w-2/3" /></div>)}</section> : (
          <section className="space-y-4">
            {posts.map((post) => {
              const cState = commentState(post.postId);
              return (
                <article key={post.postId} className="rounded-2xl border border-white/10 bg-brand-surface/75 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div><p className="text-sm font-semibold text-brand-text">{post.authorName} <span className="text-brand-muted">@{post.authorUsername}</span></p><p className="text-xs text-brand-muted">{toRelative(post.createdAt)}</p></div>
                    <div className="flex items-center gap-2">
                      {(isAdmin || post.status !== "active") ? <span className="rounded-lg border border-white/15 bg-black/30 px-2 py-1 text-[11px] text-brand-muted">{post.status}</span> : null}
                      {post.permissions.canEdit ? <button type="button" onClick={() => editPost(post)} className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-brand-text hover:bg-white/10"><Pencil className="h-3.5 w-3.5" />Editar</button> : null}
                      {post.permissions.canDelete ? <button type="button" onClick={() => removePost(post.postId)} className="inline-flex items-center gap-1 rounded-lg border border-red-300/30 bg-red-500/10 px-2.5 py-1.5 text-xs text-red-200 hover:bg-red-500/20"><Trash2 className="h-3.5 w-3.5" />Eliminar</button> : null}
                    </div>
                  </div>
                  <div className="mt-3 overflow-hidden rounded-2xl border border-white/10 bg-black/20">
                    <div className="p-3 sm:p-4">
                      {post.status === "active" ? (
                        <p className="whitespace-pre-wrap text-sm leading-relaxed text-brand-text">{post.content}</p>
                      ) : (
                        <p className="text-sm italic text-brand-muted">Publicación moderada/eliminada.</p>
                      )}
                    </div>
                    {post.attachment ? (
                      post.attachment.kind === "image" ? (
                        <img
                          src={`/api/community/files/${post.attachment.fileId}`}
                          alt={post.attachment.name}
                          className="max-h-[520px] w-full border-t border-white/10 object-cover"
                        />
                      ) : (
                        <div className="flex items-center justify-between border-t border-white/10 p-3 sm:p-4">
                          <div className="inline-flex items-center gap-2 text-sm text-brand-text">
                            <FileText className="h-4 w-4 text-brand-accent" />
                            {post.attachment.name}
                          </div>
                          <a
                            href={`/api/community/files/${post.attachment.fileId}`}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-lg border border-brand-accent/35 px-3 py-1.5 text-xs text-brand-text"
                          >
                            Abrir PDF
                          </a>
                        </div>
                      )
                    ) : null}
                  </div>
                  <div className="mt-3 border-t border-white/10 pt-3"><button type="button" onClick={() => toggleComments(post.postId)} className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-black/20 px-3 py-1.5 text-xs text-brand-text"><MessageCircle className="h-3.5 w-3.5 text-brand-accent" />{cState.open ? "Ocultar" : "Ver"} comentarios ({post.commentCount})</button></div>
                  {cState.open ? <div className="mt-3 space-y-3 rounded-xl border border-white/10 bg-black/15 p-3">
                    {cState.loading ? <Skeleton className="h-14 w-full" /> : cState.items.length === 0 ? <p className="text-sm text-brand-muted">Sin comentarios.</p> : cState.items.map((comment) => <article key={comment.commentId} className="rounded-lg border border-white/10 bg-black/25 p-3"><div className="flex items-start justify-between gap-2"><p className="text-xs text-brand-muted"><span className="font-semibold text-brand-text">{comment.authorName}</span> @{comment.authorUsername} · {toRelative(comment.createdAt)}</p><div className="flex items-center gap-2">{comment.permissions.canEdit ? <button type="button" onClick={() => editComment(post.postId, comment)} className="inline-flex items-center gap-1 rounded-md border border-white/15 px-2 py-1 text-[11px] text-brand-text"><Pencil className="h-3 w-3" />Editar</button> : null}{comment.permissions.canDelete ? <button type="button" onClick={() => removeComment(post.postId, comment.commentId)} className="inline-flex items-center gap-1 rounded-md border border-red-300/30 bg-red-500/10 px-2 py-1 text-[11px] text-red-200"><Trash2 className="h-3 w-3" />Eliminar</button> : null}</div></div><p className="mt-2 whitespace-pre-wrap text-sm text-brand-text">{comment.status === "active" ? comment.content : "Comentario eliminado."}</p></article>)}
                    {cState.cursor ? <div className="flex justify-center"><BrandButton variant="ghost" onClick={() => loadComments(post.postId, false)} disabled={cState.loadingMore}>{cState.loadingMore ? "Cargando..." : "Cargar más comentarios"}</BrandButton></div> : null}
                    {post.status === "active" ? <div className="rounded-xl border border-white/10 bg-black/20 p-3"><textarea value={cState.input} onChange={(event) => patchCommentState(post.postId, { input: event.target.value })} rows={3} maxLength={2000} placeholder="Escribe un comentario..." className="w-full resize-y rounded-lg border border-white/10 bg-black/25 px-2.5 py-2 text-sm text-brand-text outline-none transition focus:border-brand-accent/60" /><div className="mt-2 flex justify-end"><BrandButton onClick={() => sendComment(post.postId)} disabled={cState.sending}>{cState.sending ? "Enviando..." : "Comentar"}</BrandButton></div></div> : null}
                  </div> : null}
                </article>
              );
            })}
            <div className="flex justify-center">{hasMore ? <BrandButton variant="ghost" onClick={() => loadFeed(false)} disabled={feedLoadingMore}>{feedLoadingMore ? "Cargando..." : "Cargar más publicaciones"}</BrandButton> : <p className="text-sm text-brand-muted">No hay más publicaciones.</p>}</div>
          </section>
        )}
      </div>
    </MotionPage>
  );
}
