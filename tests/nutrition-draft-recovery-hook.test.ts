import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { useNutritionDraftRecovery } from "@/components/admin/use-nutrition-draft-recovery";
import { listNutritionDraftRecoveries } from "@/lib/nutrition/draft-recovery";
import type { NutritionDraftRecovery, NutritionDraftStorage } from "@/lib/nutrition/draft-recovery";
import type { NutritionPlanFull } from "@/lib/nutrition/types";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

class BrowserStorage implements NutritionDraftStorage {
  readonly values = new Map<string, string>();
  failWrites = false;
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new DOMException("Storage full", "QuotaExceededError");
    this.values.set(key, value);
  }
  removeItem(key: string) { this.values.delete(key); }
}

function planWithNotes(notes: string): NutritionPlanFull {
  return {
    id: "plan", athleteUsername: "athlete", athleteName: "Atleta", name: "",
    status: "review", targetProteinG: 100, targetCarbsG: 180, targetFatG: 60,
    targetCaloriesKcal: 1660, notes, supplementation: "", recommendations: "",
    createdAt: "", updatedAt: "", publishedAt: "", publishedFileId: "",
    versionNumber: 1, versions: [], meals: [],
  };
}

const renderers: ReactTestRenderer[] = [];

function mountEditor(adminUsername = "nutritionist") {
  let current: ReturnType<typeof useNutritionDraftRecovery>;
  function Harness(props: { username: string }) {
    current = useNutritionDraftRecovery(props.username);
    return null;
  }
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(createElement(Harness, { username: adminUsername }));
  });
  renderers.push(renderer);
  return {
    get state() { return current!; },
    unmount() { act(() => renderer.unmount()); },
    switchAdmin(username: string) {
      act(() => renderer.update(createElement(Harness, { username })));
    },
  };
}

function protect(editor: ReturnType<typeof mountEditor>, plan: NutritionPlanFull) {
  let snapshot: NutritionDraftRecovery | null = null;
  act(() => { snapshot = editor.state.protectDraft(plan); });
  return snapshot as NutritionDraftRecovery | null;
}

describe("nutrition recovery in the React editor", () => {
  let storage: BrowserStorage;
  let browserWindow: EventTarget;

  beforeEach(() => {
    storage = new BrowserStorage();
    browserWindow = Object.assign(new EventTarget(), { localStorage: storage });
    let nextSession = 0;
    vi.stubGlobal("window", browserWindow);
    vi.stubGlobal("crypto", { randomUUID: () => `editor-session-${++nextSession}` });
    vi.clearAllMocks();
  });

  afterEach(() => {
    act(() => { renderers.splice(0).forEach((renderer) => renderer.unmount()); });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("offers unfinished work after leaving and reopening the editor", () => {
    const firstEditor = mountEditor();
    const plan = planWithNotes("Treinta minutos de trabajo sin guardar");
    const snapshot = protect(firstEditor, plan);
    expect(snapshot?.plan).toEqual(plan);
    firstEditor.unmount();

    const reopenedEditor = mountEditor();
    expect(reopenedEditor.state.drafts).toEqual([snapshot]);
    expect(reopenedEditor.state.backupUnavailable).toBe(false);
    expect(reopenedEditor.state.sessionId.current).toBe("");
  });

  it("keeps a write failure visible across focus and storage events until protection succeeds", () => {
    const editor = mountEditor();
    const oldCopy = protect(editor, planWithNotes("Copia anterior"));
    storage.failWrites = true;
    expect(protect(editor, planWithNotes("Ultimos cambios"))).toBeNull();
    expect(editor.state.backupUnavailable).toBe(true);

    act(() => {
      browserWindow.dispatchEvent(new Event("focus"));
      browserWindow.dispatchEvent(new Event("storage"));
    });
    expect(editor.state.backupUnavailable).toBe(true);
    expect(editor.state.drafts).toEqual([oldCopy]);
    expect(protect(editor, planWithNotes("Mas cambios"))).toBeNull();
    expect(toast.error).toHaveBeenCalledTimes(1);

    storage.failWrites = false;
    const latest = protect(editor, planWithNotes("Ultima version protegida"));
    expect(editor.state.backupUnavailable).toBe(false);
    expect(editor.state.drafts).toEqual([latest]);
  });

  it("preserves changes made during a save when the earlier response removes its snapshot", () => {
    const editor = mountEditor();
    const submitted = protect(editor, planWithNotes("Version enviada al servidor"));
    expect(submitted).not.toBeNull();
    const editedDuringSave = protect(editor, planWithNotes("Trabajo posterior a la peticion"));
    act(() => editor.state.removeDraft(submitted!));
    expect(editor.state.drafts).toEqual([editedDuringSave]);
    expect(listNutritionDraftRecoveries(storage, "nutritionist").drafts).toEqual([editedDuringSave]);

    act(() => editor.state.removeDraft(editedDuringSave!));
    expect(editor.state.drafts).toEqual([]);
  });

  it("does not delete another tab's unsaved plan after saving this tab", () => {
    const firstTab = mountEditor();
    const secondTab = mountEditor();
    const first = protect(firstTab, planWithNotes("Primera pestana"));
    const second = protect(secondTab, planWithNotes("Segunda pestana"));
    expect(first!.sessionId).not.toBe(second!.sessionId);
    act(() => {
      browserWindow.dispatchEvent(new Event("storage"));
      firstTab.state.removeDraft(first!);
      browserWindow.dispatchEvent(new Event("storage"));
    });
    expect(firstTab.state.drafts).toEqual([second]);
    expect(secondTab.state.drafts).toEqual([second]);
  });

  it("keeps the previous active copy when restoring another snapshot into a new session", () => {
    const oldEditor = mountEditor();
    const recoverable = protect(oldEditor, planWithNotes("Borrador abandonado"));
    oldEditor.unmount();
    const activeEditor = mountEditor();
    const activeCopy = protect(activeEditor, planWithNotes("Cambios actuales que tambien deben conservarse"));
    activeEditor.state.sessionId.current = "new-restoration-session";
    const restoredCopy = protect(activeEditor, recoverable!.plan);
    act(() => activeEditor.state.removeDraft(recoverable!));

    expect(activeEditor.state.drafts).toHaveLength(2);
    expect(activeEditor.state.drafts).toEqual(expect.arrayContaining([activeCopy, restoredCopy]));
    expect(activeEditor.state.drafts.some((draft) => draft.sessionId === recoverable!.sessionId)).toBe(false);
  });

  it("refreshes recovery records for the signed-in administrator only", () => {
    const editor = mountEditor("first-admin");
    const firstAdminCopy = protect(editor, planWithNotes("Datos del primer administrador"));
    editor.switchAdmin("second-admin");
    expect(editor.state.drafts).toEqual([]);
    const secondAdminCopy = protect(editor, planWithNotes("Datos del segundo administrador"));
    expect(editor.state.drafts).toEqual([secondAdminCopy]);
    editor.switchAdmin("first-admin");
    expect(editor.state.drafts).toEqual([firstAdminCopy]);
  });

  it("detaches browser listeners on unmount", () => {
    const removeListener = vi.spyOn(browserWindow, "removeEventListener");
    const editor = mountEditor();
    editor.unmount();
    expect(removeListener).toHaveBeenCalledWith("storage", expect.any(Function));
    expect(removeListener).toHaveBeenCalledWith("focus", expect.any(Function));
  });
});
