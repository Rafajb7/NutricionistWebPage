import * as React from "react";
import { toast } from "sonner";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminNutritionManagementShell } from "@/components/admin/admin-nutrition-management-shell";
import { listNutritionDraftRecoveries, writeNutritionDraftRecovery } from "@/lib/nutrition/draft-recovery";
import type { NutritionDraftStorage } from "@/lib/nutrition/draft-recovery";
import type { NutritionPlanFull } from "@/lib/nutrition/types";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("next/link", () => ({ default: "a" }));
vi.mock("@/components/brand-logo", () => ({ BrandLogo: () => null }));
vi.mock("framer-motion", () => ({ motion: { button: "button", div: "div" } }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));

function makePlan(id: string): NutritionPlanFull {
  return {
    id: `plan-000${id}`, athleteUsername: "athlete", athleteName: "Atleta", name: `Plan ${id}`,
    status: "review", targetProteinG: 100, targetCarbsG: 180, targetFatG: 60,
    targetCaloriesKcal: 1660, notes: `Servidor ${id}`, supplementation: "", recommendations: "",
    createdAt: "2026-09-22T09:00:00.000Z", updatedAt: "2026-09-22T09:00:00.000Z",
    publishedAt: "", publishedFileId: "", versionNumber: 1, versions: [], meals: [{
      id: `meal-${id}`, planId: `plan-000${id}`, name: "Comida", position: 1, included: true,
      notes: "", createdAt: "", updatedAt: "", entries: [],
    }],
  };
}

function visibleText(node: ReactTestInstance): string {
  return node.children.map((child) => typeof child === "string" ? child : visibleText(child)).join(" ");
}

describe("nutrition editor saves with concurrent editing", () => {
  let renderer: ReactTestRenderer | undefined;
  let storage: NutritionDraftStorage;
  let submitted: NutritionPlanFull | null;
  let completeSave: (response: Response) => void;
  let completePublication: (response: Response) => void;
  let completePlanLoad: (response: Response) => void;
  let publishedAvailable: boolean;
  let delayPlanB: boolean;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    const stored = new Map<string, string>();
    storage = {
      get length() { return stored.size; },
      key(index) { return [...stored.keys()][index] ?? null; },
      getItem(key) { return stored.get(key) ?? null; },
      setItem(key, value) { stored.set(key, value); },
      removeItem(key) { stored.delete(key); },
    };
    vi.stubGlobal("React", React);
    vi.stubGlobal("window", Object.assign(new EventTarget(), {
      localStorage: storage, setTimeout, clearTimeout, setInterval, clearInterval,
    }));
    vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
    let sessionNumber = 0;
    vi.stubGlobal("crypto", { randomUUID: () => `session-${++sessionNumber}` });
    const athlete = {
      username: "athlete", name: "Atleta", email: "athlete@example.test",
      birthDate: "1990-01-01", sex: "male", heightCm: 180,
    };
    submitted = null;
    publishedAvailable = false;
    delayPlanB = false;
    vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
      if (options?.method === "PUT") {
        submitted = JSON.parse(String(options.body)) as NutritionPlanFull;
        return new Promise<Response>((resolve) => { completeSave = resolve; });
      }
      if (url === "/api/admin/nutrition-management") {
        return Response.json({ athletes: [athlete], plans: [makePlan("A"), makePlan("B")], foods: [] });
      }
      if (url.endsWith("/energy-data")) return Response.json({ athlete, latestRevision: { weightKg: { value: 80 } } });
      if (url.endsWith("/plans/plan-000A")) return Response.json({
        plan: makePlan("A"),
        publishedPlan: publishedAvailable ? { ...makePlan("A"), status: "published" } : null,
      });
      if (url.endsWith("/plans/plan-000B")) {
        if (delayPlanB) return new Promise<Response>((resolve) => { completePlanLoad = resolve; });
        return Response.json({ plan: makePlan("B") });
      }
      if (url.endsWith("/pdf")) return new Response("test-pdf", { headers: { "Content-Type": "application/pdf" } });
      if (url.endsWith("/publish")) return new Promise<Response>((resolve) => { completePublication = resolve; });
      if (url === "/api/admin/nutrition-change-requests") return Response.json({ requests: [] });
      throw new Error(`Unexpected request in editor test: ${url}`);
    }));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function openEditor() {
    await act(async () => {
      renderer = create(React.createElement(AdminNutritionManagementShell, {
        user: { username: "nutritionist", name: "Nutricionista" },
      }));
    });
    expect(renderer!.root.findAllByType("input").some((input) => input.props.value === "Plan A")).toBe(true);
  }

  function notesInput() {
    return renderer!.root.findAllByType("label")
      .find((label) => label.children.some((child) => child === "Observaciones"))!
      .findByType("textarea");
  }

  function editNotes(notes: string) {
    act(() => notesInput().props.onChange({ target: { value: notes } }));
  }

  function startSave() {
    const button = renderer!.root.findAllByType("button")
      .find((item) => visibleText(item).includes("Guardar revision"))!;
    expect(button.props.disabled).toBe(false);
    act(() => button.props.onClick());
    expect(submitted).not.toBeNull();
  }

  async function selectSecondPlan() {
    const button = renderer!.root.findAllByType("button")
      .find((item) => visibleText(item).includes("Plan B"))!;
    await act(async () => button.props.onClick());
    expect(notesInput().props.value).toBe("Servidor B");
  }

  async function respondToSave(status = 200) {
    await act(async () => {
      completeSave(status === 200
        ? Response.json({ plan: { ...submitted, updatedAt: "2026-09-22T10:00:00.000Z" } })
        : Response.json({ error: "Google ha limitado temporalmente las solicitudes." }, { status }));
    });
  }

  it("keeps edits made after pressing save, with their recovery copy and dirty state", async () => {
    await openEditor();
    editNotes("Version enviada");
    startSave();
    editNotes("Nuevos cambios mientras Google responde");
    await respondToSave();

    expect(notesInput().props.value).toBe("Nuevos cambios mientras Google responde");
    expect(visibleText(renderer!.root)).toContain("Cambios pendientes");
    expect(listNutritionDraftRecoveries(storage, "nutritionist").drafts[0].plan.notes)
      .toBe("Nuevos cambios mientras Google responde");
  });

  it("keeps the selected plan when an earlier plan's save finishes", async () => {
    await openEditor();
    editNotes("Version enviada de A");
    startSave();
    editNotes("Cambios posteriores de A");
    await selectSecondPlan();
    await respondToSave();

    expect(notesInput().props.value).toBe("Servidor B");
    expect(renderer!.root.findAllByType("input").some((input) => input.props.value === "Plan B")).toBe(true);
    expect(listNutritionDraftRecoveries(storage, "nutritionist").drafts
      .find((draft) => draft.plan.id === "plan-000A")?.plan.notes).toBe("Cambios posteriores de A");
  });

  it("preserves the latest backup when a save fails after switching to another plan", async () => {
    await openEditor();
    editNotes("Version enviada de A");
    startSave();
    editNotes("Trabajo mas reciente de A");
    await selectSecondPlan();
    await respondToSave(429);

    expect(notesInput().props.value).toBe("Servidor B");
    expect(listNutritionDraftRecoveries(storage, "nutritionist").drafts
      .find((draft) => draft.plan.id === "plan-000A")?.plan.notes).toBe("Trabajo mas reciente de A");
    expect(visibleText(renderer!.root)).not.toContain("Error de guardado");
  });

  it("removes the local snapshot once its complete current content is saved", async () => {
    await openEditor();
    editNotes("Cambios guardados en el servidor");
    startSave();
    await respondToSave();

    expect(notesInput().props.value).toBe("Cambios guardados en el servidor");
    expect(visibleText(renderer!.root)).toContain("Guardado");
    expect(listNutritionDraftRecoveries(storage, "nutritionist").drafts).toEqual([]);
  });

  it("restores the selected plan without overwriting its other unsaved work or reloading stale server data", async () => {
    writeNutritionDraftRecovery(storage, "nutritionist", "previous-session", {
      ...makePlan("A"), notes: "Trabajo recuperado de una sesion anterior",
    });
    await openEditor();
    editNotes("Trabajo de la sesion actual que tambien debe conservarse");

    const restoreButton = renderer!.root.findAllByType("button")
      .find((button) => visibleText(button).includes("Recuperar borrador"))!;
    expect(restoreButton.props.disabled).toBe(false);
    await act(async () => restoreButton.props.onClick());

    expect(notesInput().props.value).toBe("Trabajo recuperado de una sesion anterior");
    const remaining = listNutritionDraftRecoveries(storage, "nutritionist").drafts;
    expect(remaining).toHaveLength(2);
    expect(remaining.map((draft) => draft.plan.notes)).toEqual(expect.arrayContaining([
      "Trabajo recuperado de una sesion anterior",
      "Trabajo de la sesion actual que tambien debe conservarse",
    ]));
    expect(remaining.some((draft) => draft.sessionId === "previous-session")).toBe(false);
    expect(visibleText(renderer!.root)).toContain("Cambios pendientes");
  });

  function putCount() {
    return vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === "PUT").length;
  }

  async function advance(ms: number) {
    await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  }

  it("autosaves at 30 seconds and continuous edits do not postpone the timer", async () => {
    await openEditor();
    editNotes("Primer cambio");
    await advance(15_000);
    editNotes("Ultimo cambio antes de guardar");
    await advance(14_999);
    expect(putCount()).toBe(0);
    await advance(1);
    expect(putCount()).toBe(1);
    expect(submitted?.notes).toBe("Ultimo cambio antes de guardar");
    await respondToSave();
    expect(listNutritionDraftRecoveries(storage, "nutritionist").drafts).toEqual([]);
    await advance(60_000);
    expect(putCount()).toBe(1);
  });

  it("does not call Google when the loaded plan has no changes", async () => {
    await openEditor();
    await advance(90_000);
    expect(putCount()).toBe(0);
  });

  it("retries failed autosaves at the next interval while retaining the local copy", async () => {
    await openEditor();
    editNotes("Trabajo protegido");
    await advance(30_000);
    await respondToSave(429);
    expect(listNutritionDraftRecoveries(storage, "nutritionist").drafts[0].plan.notes).toBe("Trabajo protegido");
    expect(toast.error).toHaveBeenCalledTimes(1);
    await advance(30_000);
    expect(putCount()).toBe(2);
    await respondToSave(429);
    expect(toast.error).toHaveBeenCalledTimes(1);
    await advance(30_000);
    expect(putCount()).toBe(3);
    await respondToSave();
    expect(listNutritionDraftRecoveries(storage, "nutritionist").drafts).toEqual([]);
  });

  it("autosaves newer edits on the next tick without letting a stale response replace them", async () => {
    await openEditor();
    editNotes("Version enviada automaticamente");
    await advance(30_000);
    editNotes("Cambios posteriores al autoguardado");
    await respondToSave();
    expect(notesInput().props.value).toBe("Cambios posteriores al autoguardado");
    expect(visibleText(renderer!.root)).toContain("Cambios pendientes");
    await advance(30_000);
    expect(submitted?.notes).toBe("Cambios posteriores al autoguardado");
    await respondToSave();
    expect(listNutritionDraftRecoveries(storage, "nutritionist").drafts).toEqual([]);
  });

  it("does not overlap manual and automatic requests", async () => {
    await openEditor();
    editNotes("Guardado manual");
    startSave();
    editNotes("Mas cambios durante la espera");
    await advance(30_000);
    expect(putCount()).toBe(1);
    await respondToSave();
    await advance(30_000);
    expect(putCount()).toBe(2);
    const manualButton = renderer!.root.findAllByType("button")
      .find((button) => visibleText(button).includes("Guardar revision"))!;
    expect(manualButton.props.disabled).toBe(true);
    act(() => manualButton.props.onClick());
    expect(putCount()).toBe(2);
    await respondToSave();
  });

  it("protects unfinished plans locally until their fields are valid", async () => {
    await openEditor();
    const nameInput = renderer!.root.findAllByType("input").find((input) => input.props.value === "Plan A")!;
    act(() => nameInput.props.onChange({ target: { value: "" } }));
    await advance(30_000);
    expect(putCount()).toBe(0);
    expect(visibleText(renderer!.root)).toContain("Autoguardado pendiente");
    expect(listNutritionDraftRecoveries(storage, "nutritionist").drafts[0].plan.name).toBe("");
    act(() => nameInput.props.onChange({ target: { value: "Plan corregido" } }));
    await advance(30_000);
    expect(putCount()).toBe(1);
    await respondToSave();
  });

  it("keeps an incomplete decimal in its input after automatic save", async () => {
    await openEditor();
    editNotes("Cambio que activa el autoguardado");
    const input = renderer!.root.findByProps({ "aria-label": "Proteinas en gramos por kg" });
    expect(input.props.disabled).toBe(false);
    act(() => input.props.onChange({ target: { value: "1," } }));
    await advance(30_000);
    await respondToSave();
    expect(input.props.value).toBe("1,");
  });

  it("autosaves recovered work and stops its timer on unmount", async () => {
    writeNutritionDraftRecovery(storage, "nutritionist", "previous-session", {
      ...makePlan("A"), notes: "Trabajo pendiente recuperado",
    });
    await openEditor();
    const button = renderer!.root.findAllByType("button")
      .find((item) => visibleText(item).includes("Recuperar borrador"))!;
    await act(async () => button.props.onClick());
    await advance(30_000);
    expect(submitted?.notes).toBe("Trabajo pendiente recuperado");
    await respondToSave();
    expect(listNutritionDraftRecoveries(storage, "nutritionist").drafts).toEqual([]);
    act(() => renderer!.unmount());
    renderer = undefined;
    expect(vi.getTimerCount()).toBe(0);
  });


  it("pauses autosave in published mode even with pending review changes", async () => {
    publishedAvailable = true;
    await openEditor();
    const modeSelect = renderer!.root.findAllByType("select").find((select) => select.props.value === "published")!;
    act(() => modeSelect.props.onChange({ target: { value: "review" } }));
    editNotes("Revision pendiente");
    act(() => modeSelect.props.onChange({ target: { value: "published" } }));
    await advance(30_000);
    expect(putCount()).toBe(0);
    expect(listNutritionDraftRecoveries(storage, "nutritionist").drafts[0].plan.notes).toBe("Revision pendiente");
    act(() => modeSelect.props.onChange({ target: { value: "review" } }));
    await advance(30_000);
    expect(putCount()).toBe(1);
    expect(submitted?.notes).toBe("Revision pendiente");
    await respondToSave();
  });

  it("does not autosave the old plan while a different plan is loading", async () => {
    await openEditor();
    editNotes("Trabajo pendiente de A");
    delayPlanB = true;
    const button = renderer!.root.findAllByType("button").find((item) => visibleText(item).includes("Plan B"))!;
    await act(async () => button.props.onClick());
    await advance(30_000);
    expect(putCount()).toBe(0);
    await act(async () => completePlanLoad(Response.json({ plan: makePlan("B") })));
    await advance(30_000);
    expect(putCount()).toBe(0);
    expect(listNutritionDraftRecoveries(storage, "nutritionist").drafts[0].plan.notes).toBe("Trabajo pendiente de A");
  });

  it("does not autosave while publication is in progress", async () => {
    await openEditor();
    editNotes("Version que se publicara");
    const preview = renderer!.root.findAllByType("button").find((item) => visibleText(item).includes("Generar PDF"))!;
    await act(async () => preview.props.onClick());
    const publish = renderer!.root.findAllByType("button").find((item) => visibleText(item).includes("Publicar"))!;
    act(() => { void publish.props.onClick(); });
    await respondToSave();
    editNotes("Cambios nuevos durante la publicacion");
    await advance(30_000);
    expect(putCount()).toBe(1);
    await act(async () => completePublication(Response.json({ plan: { ...submitted, status: "published" } })));
    expect(notesInput().props.value).toBe("Cambios nuevos durante la publicacion");
    await advance(30_000);
    expect(putCount()).toBe(2);
    await respondToSave();
  });

});
