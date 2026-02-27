import { z } from "zod";
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { getEnv } from "@/lib/env";
import { uploadPhotoToDrive } from "@/lib/google/drive";
import { appendRevisionRows } from "@/lib/google/sheets";
import { deleteMemoryCache } from "@/lib/cache/memory-cache";
import { logError, logInfo } from "@/lib/logger";

const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

const labelsSchema = z.array(z.string().min(1).max(80)).max(10);

export async function POST(req: Request) {
  const auth = await requireSession();
  if (!auth.session) return auth.response;

  try {
    const formData = await req.formData();
    const rawFiles = formData.getAll("photos");
    const files = rawFiles.filter((item): item is File => item instanceof File);
    const labelsRaw = formData.get("labels");

    if (!files.length) {
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
    const fecha = new Date().toISOString().slice(0, 10);
    const rows: Array<{
      nombre: string;
      fecha: string;
      usuario: string;
      pregunta: string;
      respuesta: string;
    }> = [];

    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      if (!allowedMimeTypes.has(file.type)) {
        return NextResponse.json(
          { error: `Tipo no permitido: ${file.name}` },
          { status: 400 }
        );
      }

      if (file.size > maxBytes) {
        return NextResponse.json(
          { error: `Archivo demasiado grande: ${file.name}` },
          { status: 400 }
        );
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const uploaded = await uploadPhotoToDrive({
        userName: auth.session.name,
        originalFileName: file.name,
        mimeType: file.type,
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
    return NextResponse.json({ error: "Could not upload photos." }, { status: 500 });
  }
}
