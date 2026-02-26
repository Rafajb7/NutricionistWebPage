import { extractImageUrl } from "@/lib/parse-image-formula";
import type { RevisionEntry, RevisionRow } from "@/lib/google/types";

export function buildRevisionRows(input: {
  nombre: string;
  usuario: string;
  fecha: string;
  answers: Array<{ pregunta: string; respuesta: string }>;
}): RevisionRow[] {
  return input.answers.map((item) => ({
    nombre: input.nombre,
    fecha: input.fecha,
    usuario: input.usuario,
    pregunta: item.pregunta,
    respuesta: item.respuesta
  }));
}

export function toRevisionEntry(row: RevisionRow): RevisionEntry {
  const imageUrl = extractImageUrl(row.respuesta);
  return {
    ...row,
    imageUrl
  };
}
