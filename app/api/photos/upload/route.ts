import { z } from "zod";
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { getEnv } from "@/lib/env";
import { uploadPhotoToDrive } from "@/lib/google/drive";
import {
  appendRevisionRows,
  recordAppEventLog,
  recordRevisionIssueLog
} from "@/lib/google/sheets";
import { deleteMemoryCache } from "@/lib/cache/memory-cache";
import { logError, logInfo } from "@/lib/logger";
import {
  getAcceptedRevisionPhotoMimeTypes,
  isAcceptedRevisionPhotoFileName,
  normalizeRevisionPhotoMimeType,
  resolveRevisionPhotoTypeFromFileName,
  resolveRevisionPhotoMimeType
} from "@/lib/revision-photos";

const allowedMimeTypes = getAcceptedRevisionPhotoMimeTypes();

const labelsSchema = z.array(z.string().min(1).max(80)).max(10);
const revisionDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function getTodayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

export async function POST(req: Request) {
  const auth = await requireSession();
  if (!auth.session) return auth.response;

  let revisionDateForLog = getTodayDateString();
  try {
    const formData = await req.formData();
    const rawFiles = formData.getAll("photos");
    const files = rawFiles.filter((item): item is File => item instanceof File);
    const labelsRaw = formData.get("labels");
    const revisionDateRaw = formData.get("revisionDate");
    const parsedRevisionDate =
      typeof revisionDateRaw === "string" ? revisionDateSchema.safeParse(revisionDateRaw) : null;
    const fecha = parsedRevisionDate?.success ? parsedRevisionDate.data : getTodayDateString();
    revisionDateForLog = fecha;

    if (!files.length) {
      await recordAppEventLog({
        level: "warn",
        category: "revision-photo-empty-upload",
        path: "/api/photos/upload",
        username: auth.session.username,
        message: `Intento sin archivos para la revision del ${fecha}.`,
        context: {
          revisionDate: fecha
        }
      });
      await recordRevisionIssueLog({
        username: auth.session.username,
        message: `Intento sin archivos al subir fotos para la revision del ${fecha}.`
      });
      return NextResponse.json({ error: "No files uploaded." }, { status: 400 });
    }

    let labels: string[] = [];
    if (typeof labelsRaw === "string") {
      const parsedLabels = labelsSchema.safeParse(JSON.parse(labelsRaw));
      if (parsedLabels.success) {
        labels = parsedLabels.data;
      }
    }

    const maxBytes = getEnv().MAX_UPLOAD_MB * 1024 * 1024;
    const rows: Array<{
      nombre: string;
      fecha: string;
      usuario: string;
      pregunta: string;
      respuesta: string;
    }> = [];

    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      const declaredMimeType = normalizeRevisionPhotoMimeType(file.type);

      if (file.size > maxBytes) {
        await recordAppEventLog({
          level: "warn",
          category: "revision-photo-too-large",
          path: "/api/photos/upload",
          username: auth.session.username,
          message: `Foto rechazada por tamano: ${file.name}`,
          context: {
            fileName: file.name,
            revisionDate: fecha,
            sizeBytes: file.size
          }
        });
        await recordRevisionIssueLog({
          username: auth.session.username,
          message:
            `Archivo demasiado grande al subir fotos para la revision del ${fecha}: ` +
            `${file.name} (${file.size} bytes).`
        });
        return NextResponse.json(
          { error: `Archivo demasiado grande: ${file.name}` },
          { status: 400 }
        );
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const resolvedPhotoType =
        resolveRevisionPhotoMimeType({
          buffer,
          declaredMimeType
        }) ?? resolveRevisionPhotoTypeFromFileName(file.name);

      if (
        !resolvedPhotoType &&
        !allowedMimeTypes.has(declaredMimeType) &&
        !isAcceptedRevisionPhotoFileName(file.name)
      ) {
        await recordRevisionIssueLog({
          username: auth.session.username,
          message:
            `Tipo de archivo no permitido al subir fotos para la revision del ${fecha}: ` +
            `${file.name} (${declaredMimeType || "sin mime"}).`
        });
        await recordAppEventLog({
          level: "warn",
          category: "revision-photo-rejected",
          path: "/api/photos/upload",
          username: auth.session.username,
          message: `Foto rechazada por formato no compatible: ${file.name}`,
          context: {
            declaredMimeType,
            fileName: file.name,
            revisionDate: fecha,
            sizeBytes: file.size
          }
        });
        return NextResponse.json(
          { error: `Formato no permitido: ${file.name}` },
          { status: 400 }
        );
      }

      if (
        resolvedPhotoType &&
        declaredMimeType &&
        resolvedPhotoType.mimeType !== declaredMimeType
      ) {
        await recordAppEventLog({
          level: "warn",
          category: "revision-photo-mime-mismatch",
          path: "/api/photos/upload",
          username: auth.session.username,
          message: `Discrepancia de MIME detectada en foto de revision: ${file.name}`,
          context: {
            declaredMimeType,
            detectedMimeType: resolvedPhotoType.mimeType,
            detectedFormat: resolvedPhotoType.format,
            fileName: file.name,
            revisionDate: fecha,
            sizeBytes: file.size
          }
        });
      }

      const uploaded = await uploadPhotoToDrive({
        username: auth.session.username,
        originalFileName: file.name,
        mimeType: resolvedPhotoType?.mimeType ?? declaredMimeType,
        buffer
      });
      const label = labels[i] ?? "Imagen adjunta";
      rows.push({
        nombre: auth.session.name,
        fecha,
        usuario: auth.session.username,
        pregunta: label,
        respuesta: uploaded.publicUrl
      });
    }

    await appendRevisionRows(rows);
    deleteMemoryCache(`revisions:${auth.session.username.trim().toLowerCase()}`);
    logInfo("Photos uploaded and stored", {
      username: auth.session.username,
      files: files.length
    });

    return NextResponse.json({
      ok: true,
      uploaded: rows.map((row) => ({
        label: row.pregunta,
        url: row.respuesta
      }))
    });
  } catch (error) {
    logError("Photo upload failed", error);
    await recordAppEventLog({
      level: "error",
      category: "revision-photo-upload-failed",
      path: "/api/photos/upload",
      username: auth.session.username,
      message: getErrorMessage(error),
      context: {
        revisionDate: revisionDateForLog
      }
    });
    await recordRevisionIssueLog({
      username: auth.session.username,
      message:
        `Error al subir fotos para la revision del ${revisionDateForLog}: ` +
        getErrorMessage(error)
    });
    return NextResponse.json({ error: "Could not upload photos." }, { status: 500 });
  }
}
