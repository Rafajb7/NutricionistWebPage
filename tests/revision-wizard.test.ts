import * as React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { NextRequest } from "next/server";
import { RevisionWizard } from "@/components/revision/revision-wizard";
import { CycleQuestion } from "@/components/revision/cycle-question";
import { buildRevisionQuestions } from "@/lib/revision-questions";
import { CYCLE_QUESTION, WEEKLY_REVIEW_QUESTIONS, SHEET_QUESTIONS } from "@/tests/fixtures/revision-questions";
import { emptyRevisionCycleAnswer, type RevisionCycleAnswer } from "@/lib/revision-cycle";
import { toRevisionEntry } from "@/lib/revisions";

const mocks = vi.hoisted(() => ({ save: vi.fn(), tracker: vi.fn() }));
vi.mock("next/link", () => ({ default: "a" }));
vi.mock("framer-motion", () => ({
  motion: { button: "button", div: "div" },
  AnimatePresence: ({ children }: React.PropsWithChildren) => children
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/auth/require-session", () => ({
  requireSession: async () => ({ session: { username: "test-user", name: "Test" } })
}));
vi.mock("@/lib/google/sheets", () => ({
  upsertRevisionRows: mocks.save,
  recordAppEventLog: vi.fn(),
  recordRevisionIssueLog: vi.fn()
}));
vi.mock("@/lib/google/achievements", () => ({ upsertDailyTrackerEntry: mocks.tracker }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn(), logInfo: vi.fn() }));
import { POST } from "@/app/api/revisions/submit/route";

let renderer: ReactTestRenderer;
function text(node: ReactTestInstance): string {
  return node.children.map((child) => (typeof child === "string" ? child : text(child))).join(" ");
}
function button(label: string) {
  return renderer.root.findAllByType("button").find((node) => text(node).trim() === label)!;
}
async function click(label: string) {
  await act(async () => button(label).props.onClick());
}
function day(date: string) {
  return renderer.root
    .findAllByType("button")
    .find((node) => String(node.props["aria-label"] ?? "").startsWith(date))!;
}
function change(node: ReactTestInstance, value: string) {
  act(() => node.props.onChange({ target: { value } }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("React", React);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-14T12:00:00"));
  mocks.save.mockResolvedValue(undefined);
  mocks.tracker.mockResolvedValue(undefined);
});
afterEach(() => {
  if (renderer) act(() => renderer.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("revision calendar interactions", () => {
  function mount(value = emptyRevisionCycleAnswer()) {
    let current = value;
    function Harness() {
      const [state, setState] = React.useState(value);
      current = state;
      return React.createElement(CycleQuestion, { value: state, onChange: setState });
    }
    act(() => {
      renderer = create(React.createElement(Harness));
    });
    return () => current;
  }

  it("selects two differently marked dates in one calendar and allows editing them", async () => {
    const current = mount();
    await click("Menstrual");
    act(() => day("12/10/2026").props.onClick());
    act(() => day("17/10/2026").props.onClick());
    expect(current()).toMatchObject({
      phase: "menstrual",
      menstruating: "yes",
      periodStart: "2026-10-12",
      periodEnd: "2026-10-17"
    });
    expect(day("12/10/2026").props.className).toContain("rose");
    expect(day("17/10/2026").props.className).toContain("violet");
    expect(renderer.root.findAllByProps({ "aria-label": "Días del mes" })).toHaveLength(1);
    act(() => renderer.root.findByProps({ "aria-label": "Seleccionar inicio" }).props.onClick());
    act(() => day("13/10/2026").props.onClick());
    expect(current().periodStart).toBe("2026-10-13");
    expect(current().periodEnd).toBe("2026-10-17");
  });

  it("handles month and year boundaries in the same calendar", () => {
    const current = mount({ ...emptyRevisionCycleAnswer(), periodStart: "2025-12-29" });
    act(() => day("29/12/2025").props.onClick());
    act(() => renderer.root.findByProps({ "aria-label": "Mes siguiente" }).props.onClick());
    act(() => day("03/01/2026").props.onClick());
    expect(current()).toMatchObject({ periodStart: "2025-12-29", periodEnd: "2026-01-03" });
    act(() => renderer.root.findByProps({ "aria-label": "Mes anterior" }).props.onClick());
    expect(day("29/12/2025").props["aria-pressed"]).toBe(true);
  });

  it("rejects a future start or reversed interval without corrupting the existing dates", () => {
    const current = mount();
    act(() => day("15/10/2026").props.onClick());
    expect(current().periodStart).toBe("");
    expect(text(renderer.root.findByProps({ role: "alert" }))).toContain("futuro");
    act(() => day("12/10/2026").props.onClick());
    act(() => day("11/10/2026").props.onClick());
    expect(current().periodEnd).toBe("");
    expect(text(renderer.root.findByProps({ role: "alert" }))).toContain("posterior");
  });

  it("can mark start and end on the same day", () => {
    const current = mount();
    act(() => day("12/10/2026").props.onClick());
    act(() => day("12/10/2026").props.onClick());
    expect(current().periodStart).toBe(current().periodEnd);
    expect(day("12/10/2026").props["aria-label"]).toContain("Inicio, Fin previsto");
  });
});

describe("complete revision flow", () => {
  async function mount(sex: "female" | "male" | "" = "female") {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, options?: RequestInit) => {
        if (url === "/api/questions")
          return Response.json({ questions: buildRevisionQuestions(SHEET_QUESTIONS, sex) });
        if (url === "/api/revisions/submit")
          return POST(new NextRequest("http://localhost/api/revisions/submit", {
            method: options?.method,
            headers: options?.headers,
            body: options?.body
          }));
        throw new Error(`Unexpected request: ${url}`);
      })
    );
    await act(async () => {
      renderer = create(React.createElement(RevisionWizard));
    });
  }
  async function completeFixedAndSheetQuestions() {
    change(renderer.root.findByType("input"), "70");
    await click("Siguiente");
    change(renderer.root.findByType("input"), "8000");
    await click("Siguiente");
    change(renderer.root.findByType("input"), "74,5");
    await click("Siguiente");
  }
  async function completeTextQuestion(title: string, last = false) {
    expect(text(renderer.root.findByType("h1"))).toBe(title);
    change(renderer.root.findByType("textarea"), "Respuesta de prueba");
    await click(last ? "Continuar" : "Siguiente");
  }

  it("keeps cycle choices when going back and saves all answers through the existing route", async () => {
    await mount();
    await completeFixedAndSheetQuestions();
    for (const q of WEEKLY_REVIEW_QUESTIONS.slice(0, 8)) await completeTextQuestion(q.title);
    expect(text(renderer.root.findByType("h1"))).toBe(CYCLE_QUESTION);
    await click("Siguiente");
    expect(toast.error).toHaveBeenCalled();
    expect(text(renderer.root.findByType("h1"))).toBe(CYCLE_QUESTION);
    await click("Menstrual");
    act(() => day("12/10/2026").props.onClick());
    act(() => day("17/10/2026").props.onClick());
    await click("Siguiente");
    await click("Anterior");
    expect(day("12/10/2026").props["aria-pressed"]).toBe(true);
    expect(button("Menstrual").props["aria-pressed"]).toBe(true);
    await click("Siguiente");
    await completeTextQuestion(WEEKLY_REVIEW_QUESTIONS[9].title);
    await completeTextQuestion(WEEKLY_REVIEW_QUESTIONS[10].title, true);
    expect(text(renderer.root)).toContain("Subida de fotos (opcional)");
    expect(renderer.root.findByProps({ type: "file" }).props.multiple).toBe(true);
    await click("Omitir fotos");
    expect(text(renderer.root)).toContain("Revisión completada");
    const rows = mocks.save.mock.calls[0][0];
    expect(rows).toHaveLength(14);
    expect(rows.map((row: { pregunta: string }) => row.pregunta)).toEqual(
      buildRevisionQuestions(SHEET_QUESTIONS, "female").map((question) => question.title)
    );
    expect(rows[0].respuesta).toBe("70 kg (70)");
    expect(rows[1].respuesta).toBe("8000 pasos");
    expect(rows[2].respuesta).toBe("74,5");
    const cycleEntry = toRevisionEntry(
      rows.find((row: { pregunta: string }) => row.pregunta === CYCLE_QUESTION)
    );
    expect(cycleEntry.respuesta).toContain("Fase del ciclo: Menstrual");
    expect(cycleEntry.respuesta).toContain("Inicio de la menstruación: 12/10/2026");
    expect(cycleEntry.respuesta).toContain("Fin previsto de la menstruación: 17/10/2026");
    expect(cycleEntry.imageUrl).toBeNull();
    expect(mocks.tracker).toHaveBeenCalledWith(
      expect.objectContaining({ metric: "steps", value: 8000 })
    );
  });

  it.each(["male", ""] as const)(
    "finishes without requesting or saving cycle data for sex %s",
    async (sex) => {
      await mount(sex);
      await completeFixedAndSheetQuestions();
      for (const q of WEEKLY_REVIEW_QUESTIONS.filter((q) => q.title !== CYCLE_QUESTION)) {
        await completeTextQuestion(q.title, q === WEEKLY_REVIEW_QUESTIONS[10]);
      }
      await click("Omitir fotos");
      expect(mocks.save.mock.calls[0][0]).toHaveLength(13);
      expect(
        mocks.save.mock.calls[0][0].some(
          (row: { pregunta: string }) => row.pregunta === CYCLE_QUESTION
        )
      ).toBe(false);
    }
  );

  it("shows a retry if questions fail instead of allowing an empty revision", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({}, { status: 500 }))
        .mockResolvedValueOnce(Response.json({ questions: buildRevisionQuestions([], "male") }))
    );
    await act(async () => {
      renderer = create(React.createElement(RevisionWizard));
    });
    expect(renderer.root.findAllByType("h1")).toHaveLength(0);
    await click("Reintentar");
    expect(text(renderer.root.findByType("h1"))).toBe("PESO MEDIO SEMANAL (KG)");
  });
});
