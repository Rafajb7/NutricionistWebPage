"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Upload, CheckCircle2 } from "lucide-react";
import { BrandButton } from "@/components/ui/brand-button";
import { Skeleton } from "@/components/ui/skeleton";
import { MotionPage } from "@/components/ui/motion-page";

const photoLabels = ["Frente", "Perfil izquierdo", "Perfil derecho", "Espalda"];

type WizardStage = "questions" | "photos" | "done";

export function RevisionWizard() {
  const [questions, setQuestions] = useState<string[]>([]);
  const [loadingQuestions, setLoadingQuestions] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<string[]>([]);
  const [stage, setStage] = useState<WizardStage>("questions");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [finalizingRevision, setFinalizingRevision] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const res = await fetch("/api/questions");
        if (res.status === 401) {
          window.location.href = "/login";
          return;
        }
        if (!res.ok) throw new Error("No se pudieron cargar preguntas.");
        const json = (await res.json()) as { questions: string[] };
        if (!active) return;
        const loaded = json.questions ?? [];
        setQuestions(loaded);
        setAnswers(new Array(loaded.length).fill(""));
      } catch (error) {
        console.error(error);
        toast.error("Error al cargar las preguntas.");
      } finally {
        if (active) setLoadingQuestions(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, []);

  const progress = useMemo(() => {
    if (!questions.length) return 0;
    return ((currentIndex + 1) / questions.length) * 100;
  }, [questions.length, currentIndex]);

  const isLastQuestion = currentIndex === questions.length - 1;
  const currentAnswer = answers[currentIndex] ?? "";

  function updateCurrentAnswer(value: string) {
    setAnswers((prev) => {
      const clone = [...prev];
      clone[currentIndex] = value;
      return clone;
    });
  }

  function getRevisionDateString(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function getNormalizedAnswers() {
    return questions.map((question, index) => ({
      question,
      answer: (answers[index] ?? "").trim()
    }));
  }

  function validateAllAnswers() {
    const normalizedAnswers = getNormalizedAnswers();
    if (normalizedAnswers.some((entry) => !entry.answer)) {
      toast.error("Todas las preguntas son obligatorias.");
      return null;
    }
    return normalizedAnswers;
  }

  function moveToPhotosStage() {
    const normalizedAnswers = validateAllAnswers();
    if (!normalizedAnswers) return;
    setStage("photos");
  }

  async function finalizeRevision(options?: { skipPhotos?: boolean }) {
    const normalizedAnswers = validateAllAnswers();
    if (!normalizedAnswers) return;

    if (!options?.skipPhotos && selectedFiles.length > 4) {
      toast.error("Máximo 4 fotos.");
      return;
    }

    const revisionDate = getRevisionDateString();
    setFinalizingRevision(true);
    try {
      const answersRes = await fetch("/api/revisions/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          revisionDate,
          answers: normalizedAnswers
        })
      });
      if (answersRes.status === 401) {
        window.location.href = "/login";
        return;
      }
      const answersJson = (await answersRes.json()) as { error?: string };
      if (!answersRes.ok) {
        toast.error(answersJson.error ?? "No se pudo guardar la revisión.");
        return;
      }

      if (!options?.skipPhotos && selectedFiles.length) {
        const form = new FormData();
        selectedFiles.forEach((file) => form.append("photos", file));
        form.append("labels", JSON.stringify(photoLabels.slice(0, selectedFiles.length)));
        form.append("revisionDate", revisionDate);

        const photosRes = await fetch("/api/photos/upload", {
          method: "POST",
          body: form
        });
        if (photosRes.status === 401) {
          window.location.href = "/login";
          return;
        }
        const photosJson = (await photosRes.json()) as { error?: string };
        if (!photosRes.ok) {
          toast.error(photosJson.error ?? "No se pudieron subir las fotos.");
          return;
        }
      }

      toast.success("Revisión completada.");
      setStage("done");
    } catch (error) {
      console.error(error);
      toast.error("Error finalizando la revisión.");
    } finally {
      setFinalizingRevision(false);
    }
  }
  return (
    <MotionPage>
      <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8 md:px-8">
        <div className="flex items-center justify-between">
          <Link href="/dashboard" className="text-sm text-brand-muted hover:text-brand-text">
            <ArrowLeft className="mr-1 inline-block h-4 w-4" />
            Volver al dashboard
          </Link>
          <p className="text-xs uppercase tracking-[0.2em] text-brand-muted">Nueva revisión</p>
        </div>

        {loadingQuestions ? (
          <div className="rounded-3xl border border-white/10 bg-brand-surface/80 p-6">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="mt-4 h-10 w-full" />
            <Skeleton className="mt-3 h-32 w-full" />
          </div>
        ) : stage === "questions" ? (
          <div className="rounded-3xl border border-white/10 bg-brand-surface/80 p-6">
            <div className="mb-5 h-2 w-full overflow-hidden rounded-full bg-white/10">
              <motion.div
                className="h-full bg-brand-accent"
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.35 }}
              />
            </div>
            <p className="text-xs uppercase tracking-[0.2em] text-brand-muted">
              Pregunta {currentIndex + 1} de {questions.length}
            </p>

            <AnimatePresence mode="wait">
              <motion.div
                key={currentIndex}
                initial={{ opacity: 0, x: 22 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
              >
                <h1 className="mt-3 text-2xl font-semibold text-brand-text">{questions[currentIndex]}</h1>
                <textarea
                  value={currentAnswer}
                  onChange={(event) => updateCurrentAnswer(event.target.value)}
                  rows={6}
                  className="mt-4 w-full rounded-xl border border-white/10 bg-black/30 p-4 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                  placeholder="Escribe tu respuesta..."
                />
              </motion.div>
            </AnimatePresence>

            <div className="mt-6 flex justify-between gap-2">
              <BrandButton
                variant="ghost"
                disabled={currentIndex === 0}
                onClick={() => setCurrentIndex((idx) => Math.max(0, idx - 1))}
              >
                <ArrowLeft className="mr-1 h-4 w-4" />
                Anterior
              </BrandButton>
              {isLastQuestion ? (
                <BrandButton onClick={moveToPhotosStage}>
                  Continuar
                </BrandButton>
              ) : (
                <BrandButton
                  onClick={() => {
                    if (!currentAnswer.trim()) {
                      toast.error("Responde antes de continuar.");
                      return;
                    }
                    setCurrentIndex((idx) => Math.min(questions.length - 1, idx + 1));
                  }}
                >
                  Siguiente
                  <ArrowRight className="ml-1 h-4 w-4" />
                </BrandButton>
              )}
            </div>
          </div>
        ) : stage === "photos" ? (
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-3xl border border-white/10 bg-brand-surface/80 p-6"
          >
            <h2 className="text-2xl font-semibold text-brand-text">Subida de fotos (opcional)</h2>
            <p className="mt-2 text-sm text-brand-muted">
              Puedes subir hasta 4 imágenes: Frente, Perfil izquierdo, Perfil derecho y Espalda.
            </p>

            <label className="mt-5 flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-brand-accent/40 bg-black/20 p-6 text-sm text-brand-muted hover:border-brand-accent/70">
              <Upload className="h-4 w-4" />
              Seleccionar fotos
              <input
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  setSelectedFiles(files.slice(0, 4));
                }}
              />
            </label>

            {selectedFiles.length ? (
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {selectedFiles.map((file, index) => (
                  <div key={file.name + index} className="rounded-lg border border-white/10 bg-black/20 p-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-brand-muted">
                      {photoLabels[index] ?? `Foto ${index + 1}`}
                    </p>
                    <p className="mt-1 truncate text-sm text-brand-text">{file.name}</p>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="mt-6 flex flex-wrap gap-2">
              <BrandButton disabled={finalizingRevision} onClick={() => finalizeRevision()}>
                {finalizingRevision ? "Finalizando..." : "Finalizar revisión"}
              </BrandButton>
              <BrandButton variant="ghost" disabled={finalizingRevision} onClick={() => finalizeRevision({ skipPhotos: true })}>
                Omitir fotos
              </BrandButton>
            </div>
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            className="rounded-3xl border border-brand-accent/30 bg-brand-surface/80 p-8 text-center shadow-glow"
          >
            <CheckCircle2 className="mx-auto h-12 w-12 text-brand-accent" />
            <h2 className="mt-4 text-2xl font-semibold text-brand-text">Revisión completada</h2>
            <p className="mt-2 text-brand-muted">
              Tus respuestas se guardaron correctamente y el histórico ya está actualizado.
            </p>
            <Link href="/dashboard" className="mt-5 inline-block">
              <BrandButton>Volver al dashboard</BrandButton>
            </Link>
          </motion.div>
        )}
      </div>
    </MotionPage>
  );
}


