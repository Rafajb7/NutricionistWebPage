import * as React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NutritionGuidanceEditor } from "@/components/admin/nutrition-guidance-editor";
import type { NutritionGuidanceCopySource } from "@/components/admin/nutrition-guidance-copy";
import type { NutritionPlanSummary } from "@/lib/nutrition/types";

const fields = [
  { field: "notes", title: "Observaciones" },
  { field: "supplementation", title: "Suplementación" },
  { field: "recommendations", title: "Recomendaciones" }
] as const;
type Guidance = Pick<NutritionPlanSummary, NutritionGuidanceCopySource["field"]>;
const initial: Guidance = {
  notes: "Mis observaciones",
  supplementation: "Mi suplementación",
  recommendations: "Mis recomendaciones"
};

function plan(
  id: string,
  username: string,
  changes: Partial<NutritionPlanSummary> = {}
): NutritionPlanSummary {
  return {
    id,
    athleteUsername: username,
    athleteName: username,
    name: `Plan ${id}`,
    status: "review",
    targetProteinG: 100,
    targetCarbsG: 150,
    targetFatG: 50,
    targetCaloriesKcal: 1450,
    notes: `Observación ${id}\nSegunda observación ${id}`,
    supplementation: `Suplementación ${id}`,
    recommendations: `Recomendación ${id}`,
    createdAt: "2026-10-01",
    updatedAt: "2026-10-14",
    publishedAt: "",
    publishedFileId: "",
    versionNumber: 0,
    ...changes
  };
}

let renderer: ReactTestRenderer;
beforeEach(() => {
  vi.stubGlobal("React", React);
});
afterEach(() => {
  if (renderer) act(() => renderer.unmount());
  vi.unstubAllGlobals();
});

function mount(sources = [plan("ana", "ana"), plan("bea", "bea")], disabled = false) {
  let current = initial;
  const changed = vi.fn();
  function Harness(props: { sources: NutritionPlanSummary[]; disabled: boolean }) {
    const [value, setValue] = React.useState(initial);
    current = value;
    return React.createElement(
      React.Fragment,
      null,
      ...fields.map(({ field, title }) =>
        React.createElement(NutritionGuidanceEditor, {
          key: field,
          title,
          value: value[field],
          disabled: props.disabled,
          copyFrom: { field, athleteUsername: "@CURRENT", plans: props.sources },
          onChange: (text) => {
            changed(field, text);
            setValue((previous) => ({ ...previous, [field]: text }));
          }
        })
      )
    );
  }
  act(() => {
    renderer = create(React.createElement(Harness, { sources, disabled }));
  });
  return {
    get value() {
      return current;
    },
    changed,
    update(nextSources: NutritionPlanSummary[], nextDisabled = false) {
      act(() =>
        renderer.update(
          React.createElement(Harness, { sources: nextSources, disabled: nextDisabled })
        )
      );
    }
  };
}
function click(label: string) {
  act(() => renderer.root.findByProps({ "aria-label": label }).props.onClick());
}
function select(label: string, value: string) {
  act(() =>
    renderer.root.findByProps({ "aria-label": label }).props.onChange({ target: { value } })
  );
}
function open(title: string, username?: string) {
  click(`Copiar ${title} de otro usuario`);
  if (username) select(`Usuario de origen para ${title}`, username);
}

describe("copying nutrition guidance between users", () => {
  it.each(fields)(
    "copies only $title and preserves the other fields and the source",
    ({ field, title }) => {
      const source = plan("source", "ana");
      const originalSource = structuredClone(source);
      const editor = mount([source]);
      open(title, "ana");
      const preview = renderer.root.findByProps({ "aria-label": `Vista previa de ${title}` });
      expect(preview.findAllByType("li").map((node) => node.children.join(""))).toEqual(
        source[field].split("\n")
      );
      expect(editor.changed).not.toHaveBeenCalled();
      click(`Aplicar copia de ${title}`);
      expect(editor.value).toEqual({ ...initial, [field]: source[field] });
      expect(source).toEqual(originalSource);
      expect(renderer.root.findByProps({ "aria-label": `${title}: entrada 1` }).props.value).toBe(
        source[field].split("\n")[0]
      );
    }
  );

  it("keeps the three origin selections independent and allows different users and plans", () => {
    const anaOld = plan("ana-old", "ana", { updatedAt: "2026-10-01" });
    const anaNew = plan("ana-new", "ana", { updatedAt: "2026-10-14" });
    const bea = plan("bea", "bea");
    const editor = mount([anaOld, bea, anaNew]);
    open("Observaciones", "ana");
    expect(
      renderer.root.findByProps({ "aria-label": "Plan de origen para Observaciones" }).props.value
    ).toBe(anaNew.id);
    select("Plan de origen para Observaciones", anaOld.id);
    open("Suplementación", "bea");
    open("Recomendaciones", "ana");
    click("Aplicar copia de Suplementación");
    expect(
      renderer.root.findByProps({ "aria-label": "Plan de origen para Observaciones" }).props.value
    ).toBe(anaOld.id);
    click("Aplicar copia de Observaciones");
    click("Aplicar copia de Recomendaciones");
    expect(editor.value).toEqual({
      notes: anaOld.notes,
      supplementation: bea.supplementation,
      recommendations: anaNew.recommendations
    });
  });

  it("excludes all plans of the current user and fields with no content", () => {
    const editor = mount([
      plan("current-other", " current "),
      plan("empty", "empty", { notes: " \n " }),
      plan("ana", "ana")
    ]);
    open("Observaciones");
    const userOptions = renderer.root
      .findByProps({ "aria-label": "Usuario de origen para Observaciones" })
      .findAllByType("option");
    expect(userOptions.map((option) => option.props.value)).toEqual(["", "ana"]);
    const apply = renderer.root.findByProps({ "aria-label": "Aplicar copia de Observaciones" });
    expect(apply.props.disabled).toBe(true);
    click("Aplicar copia de Observaciones");
    expect(editor.changed).not.toHaveBeenCalled();
  });

  it("resets the source plan when switching users and does not write on cancel", () => {
    const editor = mount();
    open("Observaciones", "ana");
    select("Usuario de origen para Observaciones", "bea");
    expect(
      renderer.root.findByProps({ "aria-label": "Plan de origen para Observaciones" }).props.value
    ).toBe("bea");
    click("Copiar Observaciones de otro usuario");
    expect(editor.value).toEqual(initial);
    expect(editor.changed).not.toHaveBeenCalled();
  });

  it("handles empty lists and does not offer an empty replacement", () => {
    mount([plan("empty", "ana", { notes: "", supplementation: "", recommendations: "" })]);
    open("Observaciones");
    expect(renderer.root.findAllByType("select")).toHaveLength(0);
    expect(
      renderer.root.findAllByProps({ "aria-label": "Aplicar copia de Observaciones" })
    ).toHaveLength(0);
  });

  it("disables an origin that disappears while its preview is open", () => {
    const sources = [plan("ana", "ana"), plan("bea", "bea")];
    const editor = mount(sources);
    open("Observaciones", "ana");
    editor.update([sources[1]]);
    expect(
      renderer.root.findByProps({ "aria-label": "Aplicar copia de Observaciones" }).props.disabled
    ).toBe(true);
    expect(
      renderer.root.findAllByProps({ "aria-label": "Vista previa de Observaciones" })
    ).toHaveLength(0);
    click("Aplicar copia de Observaciones");
    expect(editor.changed).not.toHaveBeenCalled();
  });

  it("preserves the field when the source exceeds the storage limit", () => {
    const editor = mount([plan("long", "ana", { notes: "a".repeat(3001) })]);
    open("Observaciones", "ana");
    expect(
      renderer.root.findByProps({ "aria-label": "Aplicar copia de Observaciones" }).props.disabled
    ).toBe(true);
    expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(1);
    click("Aplicar copia de Observaciones");
    expect(editor.value).toEqual(initial);
    editor.update([plan("long", "ana", { notes: "a".repeat(3000) })]);
    click("Aplicar copia de Observaciones");
    expect(editor.value.notes).toHaveLength(3000);
  });

  it("protects published plans, including switching modes with a preview open", () => {
    const sources = [plan("ana", "ana")];
    const editor = mount(sources, true);
    expect(
      renderer.root.findByProps({ "aria-label": "Copiar Observaciones de otro usuario" }).props
        .disabled
    ).toBe(true);
    click("Copiar Observaciones de otro usuario");
    expect(renderer.root.findAllByType("select")).toHaveLength(0);
    editor.update(sources, false);
    open("Observaciones", "ana");
    editor.update(sources, true);
    expect(
      renderer.root.findAllByProps({ "aria-label": "Aplicar copia de Observaciones" })
    ).toHaveLength(0);
    expect(editor.changed).not.toHaveBeenCalled();
  });
});
