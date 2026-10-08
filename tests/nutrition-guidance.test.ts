import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import PDFDocument from "pdfkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NutritionGuidanceEditor } from "@/components/admin/nutrition-guidance-editor";
import { parseGuidanceEntries, serializeGuidanceEntries } from "@/lib/nutrition/guidance";
import { drawGuidanceSection } from "@/lib/nutrition/pdf-guidance";

vi.stubGlobal("React", React);
let renderer: TestRenderer.ReactTestRenderer;
afterEach(() => { if (renderer) act(() => renderer.unmount()); });

function mount(value = "Primera\nSegunda", disabled = false) {
  const onChange = vi.fn();
  act(() => { renderer = TestRenderer.create(React.createElement(NutritionGuidanceEditor, {
    title: "Observaciones", value, disabled, onChange
  })); });
  return onChange;
}
function click(label: string) {
  act(() => renderer.root.findByProps({ "aria-label": label }).props.onClick());
}

describe("nutrition guidance entries", () => {
  it("loads legacy paragraphs and preserves their order in storage", () => {
    expect(parseGuidanceEntries(" Primera \r\n\r\nSegunda ")).toEqual(["Primera", "Segunda"]);
    expect(serializeGuidanceEntries(["Primera", "", "Segunda "])).toBe("Primera\nSegunda");
  });

  it("keeps blank rows editable and adds, reorders and removes persisted entries", () => {
    const changed = mount();
    click("Añadir entrada en Observaciones");
    expect(renderer.root.findAllByType("input")).toHaveLength(3);
    expect(changed).not.toHaveBeenCalled();
    act(() => renderer.root.findByProps({ "aria-label": "Observaciones: entrada 3" }).props.onChange({ target: { value: "Tercera" } }));
    expect(changed).toHaveBeenLastCalledWith("Primera\nSegunda\nTercera");
    click("Subir entrada 3 de Observaciones");
    expect(changed).toHaveBeenLastCalledWith("Primera\nTercera\nSegunda");
    click("Eliminar entrada 1 de Observaciones");
    expect(changed).toHaveBeenLastCalledWith("Tercera\nSegunda");
  });

  it("refreshes rows when restoring a draft and protects published plans", () => {
    const changed = mount();
    act(() => renderer.update(React.createElement(NutritionGuidanceEditor, {
      title: "Observaciones", value: "Restaurada", disabled: true, onChange: changed
    })));
    expect(renderer.root.findAllByType("input")).toHaveLength(1);
    expect(renderer.root.findByType("input").props.value).toBe("Restaurada");
    expect(renderer.root.findByType("input").props.disabled).toBe(true);
    expect(renderer.root.findAllByType("button").every((button) => button.props.disabled)).toBe(true);
    click("Eliminar entrada 1 de Observaciones");
    expect(changed).not.toHaveBeenCalled();
  });

  it("does not emit a value exceeding the storage limit", () => {
    const changed = mount("a".repeat(3000));
    act(() => renderer.root.findByType("input").props.onChange({ target: { value: "b".repeat(3001) } }));
    expect(changed).not.toHaveBeenCalled();
    expect(renderer.root.findByType("input").props.value).toHaveLength(3000);
  });

  it("draws exactly one yellow bullet per entry, even across pages", () => {
    const doc = new PDFDocument({ autoFirstPage: false });
    const rect = vi.spyOn(doc, "rect");
    const fill = vi.spyOn(doc, "fill");
    const addPage = vi.spyOn(doc, "addPage");
    doc.resume();
    drawGuidanceSection(doc, "Observaciones", "ACLARACIONES", `Primera\n${"Texto largo ".repeat(400)}\nTercera`, "Sin entradas.");
    expect(addPage.mock.calls.length).toBeGreaterThan(1);
    expect(rect.mock.calls.filter((args) => args[2] === 4 && args[3] === 4)).toHaveLength(3);
    expect(fill).toHaveBeenCalledWith("#FFD21C");
    doc.end();
  });
});
