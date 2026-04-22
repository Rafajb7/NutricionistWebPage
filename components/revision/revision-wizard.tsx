"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Upload, CheckCircle2, Trash2, Plus } from "lucide-react";
import { BrandButton } from "@/components/ui/brand-button";
import { Skeleton } from "@/components/ui/skeleton";
import { MotionPage } from "@/components/ui/motion-page";
import { readResponseErrorMessage, reportClientEvent } from "@/lib/client-events";
import {
  isLikelyAcceptedRevisionPhotoFile,
  REVISION_PHOTO_ACCEPT_ATTRIBUTE,
  REVISION_PHOTO_MAX_FILES
} from "@/lib/revision-photos";
import {
  isRevisionMeasurementQuestion,
  normalizeRevisionMeasurementAnswer,
  parseRevisionMeasurementValue
} from "@/lib/revision-measurements";

const photoLabels = ["Frente", "Perfil izquierdo", "Perfil derecho", "Espalda"];
const WEIGHT_AVERAGE_QUESTION = "PESO MEDIO SEMANAL (KG)";
const STEPS_AVERAGE_QUESTION = "NUMERO DE PASOS";
const PREVIOUS_WEEK_DAY_NAMES = [
  "Lunes",
  "Martes",
  "Miercoles",
  "Jueves",
  "Viernes",
  "Sabado",
  "Domingo"
];

type WizardStage = "questions" | "photos" | "done";
type WeeklyStepEntry = { date: string; steps: number };

function normalizeQuestionKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function toLocalIsoDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatShortDate(value: Date): string {
  const day = String(value.getDate()).padStart(2, "0");
  const month = String(value.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}`;
}

function getPreviousWeekDates(referenceDate = new Date()): Array<{ date: string; label: string }> {
  const localToday = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate()
  );
  const daysSinceMonday = (localToday.getDay() + 6) % 7;
  const currentWeekMonday = new Date(localToday);
  currentWeekMonday.setDate(localToday.getDate() - daysSinceMonday);

  const previousWeekMonday = new Date(currentWeekMonday);
  previousWeekMonday.setDate(currentWeekMonday.getDate() - 7);

  return PREVIOUS_WEEK_DAY_NAMES.map((dayName, index) => {
    const day = new Date(previousWeekMonday);
    day.setDate(previousWeekMonday.getDate() + index);
    return {
      date: toLocalIsoDate(day),
      label: `${dayName} ${formatShortDate(day)}`
    };
  });
}

export function RevisionWizard() {
  const previousWeekDates = useMemo(() => getPreviousWeekDates(), []);
  const [questions, setQuestions] = useState<string[]>([]);
  const [loadingQuestions, setLoadingQuestions] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<string[]>([]);
  const [weightEntries, setWeightEntries] = useState<string[]>([""]);
  const [stepsEntries, setStepsEntries] = useState<string[]>(() =>
    Array.from({ length: 7 }, () => "")
  );
  const [stage, setStage] = useState<WizardStage>("questions");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [finalizingRevision, setFinalizingRevision] = useState(false);
  const [completionMessage, setCompletionMessage] = useState(
    "Tus respuestas se guardaron correctamente y el historico ya esta actualizado."
  );

  const isWeightQuestion = questions[currentIndex] === WEIGHT_AVERAGE_QUESTION;
  const isStepsQuestion = questions[currentIndex] === STEPS_AVERAGE_QUESTION;
  const isMeasurementQuestion = isRevisionMeasurementQuestion(questions[currentIndex] ?? "");

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
        const loadedFromSheet = json.questions ?? [];
        const reservedQuestions = new Set([
          normalizeQuestionKey(WEIGHT_AVERAGE_QUESTION),
          normalizeQuestionKey(STEPS_AVERAGE_QUESTION)
        ]);
        const loaded = [
          WEIGHT_AVERAGE_QUESTION,
          STEPS_AVERAGE_QUESTION,
          ...loadedFromSheet.filter(
            (question) => !reservedQuestions.has(normalizeQuestionKey(question))
          )
        ];
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

  function parseWeightValue(raw: string): number | null {
    const normalized = raw.replace(",", ".").trim();
    if (!normalized) return null;
    const value = Number(normalized);
    if (!Number.isFinite(value)) return null;
    if (value <= 0 || value > 800) return null;
    return value;
  }

  function getValidWeightValues(): number[] {
    return weightEntries
      .map((value) => parseWeightValue(value))
      .filter((value): value is number => value !== null);
  }

  function getWeightAverage(): number | null {
    const values = getValidWeightValues();
    if (!values.length) return null;
    const sum = values.reduce((acc, value) => acc + value, 0);
    return sum / values.length;
  }

  function validateWeightEntries(): boolean {
    if (!weightEntries.length) {
      toast.error("Debes registrar al menos un pesaje.");
      return false;
    }
    const hasEmpty = weightEntries.some((value) => value.trim().length === 0);
    if (hasEmpty) {
      toast.error("Completa todos los pesajes antes de continuar.");
      return false;
    }
    const values = getValidWeightValues();
    if (values.length !== weightEntries.length) {
      toast.error("Introduce pesos validos entre 1 y 800 kg.");
      return false;
    }
    return true;
  }

  function parseStepsValue(raw: string): number | null {
    const normalized = raw.replace(",", ".").trim();
    if (!normalized) return null;
    const value = Number(normalized);
    if (!Number.isFinite(value) || !Number.isInteger(value)) return null;
    if (value < 0 || value > 100000) return null;
    return value;
  }

  function getNormalizedStepEntries(): WeeklyStepEntry[] | null {
    if (stepsEntries.length !== previousWeekDates.length) return null;

    const normalized = stepsEntries.map((value, index) => {
      const parsed = parseStepsValue(value);
      const date = previousWeekDates[index]?.date ?? "";
      if (parsed === null || !date) return null;
      return { date, steps: parsed };
    });

    if (normalized.some((item) => item === null)) return null;
    return normalized.filter((item): item is WeeklyStepEntry => item !== null);
  }

  function getStepsAverage(): number | null {
    const entries = getNormalizedStepEntries();
    if (!entries?.length) return null;
    const sum = entries.reduce((acc, entry) => acc + entry.steps, 0);
    return sum / entries.length;
  }

  function validateStepsEntries(): boolean {
    if (stepsEntries.length !== previousWeekDates.length) {
      toast.error("Debes registrar los pasos de los 7 dias.");
      return false;
    }
    const hasEmpty = stepsEntries.some((value) => value.trim().length === 0);
    if (hasEmpty) {
      toast.error("Completa los pasos diarios antes de continuar.");
      return false;
    }
    const normalizedEntries = getNormalizedStepEntries();
    if (!normalizedEntries || normalizedEntries.length !== previousWeekDates.length) {
      toast.error("Introduce pasos validos entre 0 y 100000.");
      return false;
    }
    return true;
  }

  function getNormalizedAnswers() {
    const weightAverage = getWeightAverage();
    const stepsAverage = getStepsAverage();
    return questions.map((question, index) => ({
      question,
      answer:
        question === WEIGHT_AVERAGE_QUESTION
          ? (weightAverage === null ? "" : `${weightAverage.toFixed(2)} kg`)
          : question === STEPS_AVERAGE_QUESTION
            ? (stepsAverage === null ? "" : `${Math.round(stepsAverage)} pasos`)
            : isRevisionMeasurementQuestion(question)
              ? normalizeRevisionMeasurementAnswer(answers[index] ?? "")
              : (answers[index] ?? "").trim()
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
    if (!validateWeightEntries()) return;
    if (!validateStepsEntries()) return;
    const normalizedAnswers = validateAllAnswers();
    if (!normalizedAnswers) return;
    setStage("photos");
  }

  async function finalizeRevision(options?: { skipPhotos?: boolean }) {
    if (!validateWeightEntries()) return;
    if (!validateStepsEntries()) return;
    const normalizedAnswers = validateAllAnswers();
    if (!normalizedAnswers) return;
    const normalizedStepEntries = getNormalizedStepEntries();
    if (!normalizedStepEntries) {
      toast.error("No se pudieron normalizar los pasos diarios de la semana pasada.");
      return;
    }

    if (!options?.skipPhotos && selectedFiles.length > REVISION_PHOTO_MAX_FILES) {
      toast.error(`Maximo ${REVISION_PHOTO_MAX_FILES} fotos.`);
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
          answers: normalizedAnswers,
          stepsDailyEntries: normalizedStepEntries
        })
      });
      if (answersRes.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!answersRes.ok) {
        const message = await readResponseErrorMessage(
          answersRes,
          "No se pudo guardar la revision."
        );
        await reportClientEvent({
          level: "warn",
          category: "revision-submit-failed",
          path: "/revision/new",
          message,
          context: {
            revisionDate,
            selectedFiles: selectedFiles.map((file) => ({
              name: file.name,
              sizeBytes: file.size,
              type: file.type || ""
            })),
            status: answersRes.status
          }
        });
        toast.error(message);
        return;
      }

      const failedPhotoUploads: string[] = [];
      if (!options?.skipPhotos && selectedFiles.length) {
        for (let index = 0; index < selectedFiles.length; index += 1) {
          const file = selectedFiles[index];
          try {
            const form = new FormData();
            form.append("photos", file);
            form.append("labels", JSON.stringify([photoLabels[index] ?? `Foto ${index + 1}`]));
            form.append("revisionDate", revisionDate);

            const photosRes = await fetch("/api/photos/upload", {
              method: "POST",
              body: form
            });
            if (photosRes.status === 401) {
              window.location.href = "/login";
              return;
            }
            if (photosRes.ok) {
              continue;
            }

            const message = await readResponseErrorMessage(
              photosRes,
              `No se pudo subir la foto ${file.name}.`
            );
            failedPhotoUploads.push(file.name);
            await reportClientEvent({
              level: "warn",
              category: "revision-photo-upload-failed",
              path: "/revision/new",
              message,
              context: {
                fileName: file.name,
                declaredMimeType: file.type || "",
                label: photoLabels[index] ?? `Foto ${index + 1}`,
                responseContentType: photosRes.headers.get("content-type") ?? "",
                revisionDate,
                sizeBytes: file.size,
                status: photosRes.status
              }
            });
          } catch (error) {
            failedPhotoUploads.push(file.name);
            await reportClientEvent({
              level: "error",
              category: "revision-photo-upload-client-error",
              path: "/revision/new",
              message: error instanceof Error ? error.message : String(error),
              context: {
                fileName: file.name,
                declaredMimeType: file.type || "",
                label: photoLabels[index] ?? `Foto ${index + 1}`,
                revisionDate,
                sizeBytes: file.size
              }
            });
          }
        }
      }

      if (failedPhotoUploads.length) {
        setCompletionMessage(
          "La revision se guardo, pero algunas fotos no se pudieron subir. Puedes anadirlas despues desde el dashboard."
        );
        toast.error(
          failedPhotoUploads.length === 1
            ? `La revision se guardo, pero fallo 1 foto: ${failedPhotoUploads[0]}.`
            : `La revision se guardo, pero fallaron ${failedPhotoUploads.length} fotos.`
        );
      } else {
        setCompletionMessage(
          "Tus respuestas se guardaron correctamente y el historico ya esta actualizado."
        );
        toast.success("Revision completada.");
      }
      setStage("done");
    } catch (error) {
      console.error(error);
      await reportClientEvent({
        level: "error",
        category: "revision-finalize-client-error",
        path: "/revision/new",
        message: error instanceof Error ? error.message : String(error),
        context: {
          selectedFiles: selectedFiles.map((file) => ({
            name: file.name,
            sizeBytes: file.size,
            type: file.type || ""
          }))
        }
      });
      toast.error("Error finalizando la revision.");
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
                {isWeightQuestion ? (
                  <div className="mt-4 space-y-3">
                    <p className="text-sm text-brand-muted">
                      Registra tus pesajes de la semana. Puedes añadir todos los que quieras.
                    </p>
                    <div className="overflow-hidden rounded-xl border border-white/10">
                      <table className="w-full text-sm">
                        <thead className="bg-black/30 text-xs uppercase tracking-[0.16em] text-brand-muted">
                          <tr>
                            <th className="px-3 py-2 text-left">Pesaje</th>
                            <th className="px-3 py-2 text-left">Peso (kg)</th>
                            <th className="px-3 py-2 text-left">Accion</th>
                          </tr>
                        </thead>
                        <tbody>
                          {weightEntries.map((value, index) => (
                            <tr key={index} className="border-t border-white/10">
                              <td className="px-3 py-2 text-brand-text">Pesaje {index + 1}</td>
                              <td className="px-3 py-2">
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  step="0.1"
                                  min="1"
                                  max="800"
                                  value={value}
                                  onChange={(event) => {
                                    const next = [...weightEntries];
                                    next[index] = event.target.value;
                                    setWeightEntries(next);
                                  }}
                                  placeholder="Ej: 78.4"
                                  className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                                />
                              </td>
                              <td className="px-3 py-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setWeightEntries((prev) =>
                                      prev.length <= 1
                                        ? prev
                                        : prev.filter((_, rowIndex) => rowIndex !== index)
                                    )
                                  }
                                  disabled={weightEntries.length <= 1}
                                  className="inline-flex items-center gap-1 rounded-lg border border-red-400/40 bg-red-500/10 px-2 py-1 text-xs text-red-200 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  Eliminar
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <BrandButton
                        variant="ghost"
                        onClick={() => setWeightEntries((prev) => [...prev, ""])}
                      >
                        <Plus className="mr-1 h-4 w-4" />
                        Añadir pesaje
                      </BrandButton>
                      <p className="text-sm text-brand-muted">
                        Media registrada:{" "}
                        <span className="font-semibold text-brand-text">
                          {getWeightAverage() === null ? "-" : `${getWeightAverage()!.toFixed(2)} kg`}
                        </span>
                      </p>
                    </div>
                  </div>
                ) : isStepsQuestion ? (
                  <div className="mt-4 space-y-3">
                    <p className="text-sm text-brand-muted">
                      Registra los pasos de lunes a domingo de la semana pasada. La media se calcula automaticamente entre 7.
                    </p>
                    <div className="overflow-hidden rounded-xl border border-white/10">
                      <table className="w-full text-sm">
                        <thead className="bg-black/30 text-xs uppercase tracking-[0.16em] text-brand-muted">
                          <tr>
                            <th className="px-3 py-2 text-left">Fecha</th>
                            <th className="px-3 py-2 text-left">Pasos</th>
                          </tr>
                        </thead>
                        <tbody>
                          {stepsEntries.map((value, index) => (
                            <tr key={previousWeekDates[index]?.date ?? String(index)} className="border-t border-white/10">
                              <td className="px-3 py-2 text-brand-text">
                                {previousWeekDates[index]?.label ?? "-"}
                              </td>
                              <td className="px-3 py-2">
                                <input
                                  type="number"
                                  inputMode="numeric"
                                  step="1"
                                  min="0"
                                  max="100000"
                                  value={value}
                                  onChange={(event) => {
                                    const next = [...stepsEntries];
                                    next[index] = event.target.value;
                                    setStepsEntries(next);
                                  }}
                                  placeholder="Ej: 8500"
                                  className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-sm text-brand-muted">
                      Media registrada:{" "}
                      <span className="font-semibold text-brand-text">
                        {getStepsAverage() === null ? "-" : `${Math.round(getStepsAverage()!)} pasos`}
                      </span>
                    </p>
                  </div>
                ) : isMeasurementQuestion ? (
                  <div className="mt-4 space-y-3">
                    <p className="text-sm text-brand-muted">
                      Introduce una medida numerica en centimetros. Puedes escribir con coma o con punto y se guardara normalizada para Google Sheets.
                    </p>
                    <label className="block rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-brand-muted transition focus-within:border-brand-accent/60">
                      <span className="text-xs uppercase tracking-[0.16em] text-brand-muted">
                        Medida corporal
                      </span>
                      <div className="mt-2 flex items-center gap-2">
                        <input
                          value={currentAnswer}
                          onChange={(event) =>
                            updateCurrentAnswer(event.target.value.replace(/[^\d.,]/g, ""))
                          }
                          inputMode="decimal"
                          placeholder="Ej: 74,5"
                          className="w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                        />
                        <span className="rounded-md border border-white/15 bg-black/20 px-2 py-1 text-xs text-brand-muted">
                          cm
                        </span>
                      </div>
                    </label>
                  </div>
                ) : (
                  <textarea
                    value={currentAnswer}
                    onChange={(event) => updateCurrentAnswer(event.target.value)}
                    rows={6}
                    className="mt-4 w-full rounded-xl border border-white/10 bg-black/30 p-4 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                    placeholder="Escribe tu respuesta..."
                  />
                )}
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
                    if (isWeightQuestion) {
                      if (!validateWeightEntries()) return;
                    } else if (isStepsQuestion) {
                      if (!validateStepsEntries()) return;
                    } else if (isMeasurementQuestion) {
                      if (parseRevisionMeasurementValue(currentAnswer) === null) {
                        toast.error("Introduce una medida valida en centimetros.");
                        return;
                      }
                    } else if (!currentAnswer.trim()) {
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
                accept={REVISION_PHOTO_ACCEPT_ATTRIBUTE}
                className="hidden"
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  const invalidFile = files.find(
                    (file) => !isLikelyAcceptedRevisionPhotoFile(file)
                  );
                  if (invalidFile) {
                    toast.error(`Formato no compatible: ${invalidFile.name}`);
                    return;
                  }
                  setSelectedFiles(files.slice(0, REVISION_PHOTO_MAX_FILES));
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
            <p className="mt-2 text-brand-muted">{completionMessage}</p>
            <Link href="/dashboard" className="mt-5 inline-block">
              <BrandButton>Volver al dashboard</BrandButton>
            </Link>
          </motion.div>
        )}
      </div>
    </MotionPage>
  );
}


