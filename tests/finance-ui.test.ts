import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminFinanceShell } from "@/components/admin/admin-finance-shell";
import { AdminToolsShell } from "@/components/admin/admin-tools-shell";
import { addDays, buildFinanceDashboard, todayIsoDate, formatCents } from "@/lib/finance/calculations";
import { DEFAULT_FINANCE_INVOICE_SETTINGS, DEFAULT_FINANCE_PLAN_OPTIONS } from "@/lib/finance/types";
import type { FinancePayment } from "@/lib/finance/types";
import { expense, invoice, payment as collectedPayment, contract } from "./fixtures/finance";

vi.mock("next/link", () => ({ default: (props: React.ComponentProps<"a">) => React.createElement("a", props) }));
vi.mock("@/components/brand-logo", () => ({ BrandLogo: () => null }));
vi.mock("@/components/ui/motion-page", () => ({ MotionPage: ({ children }: React.PropsWithChildren) => React.createElement("main", null, children) }));
vi.mock("@/components/ui/brand-button", () => ({ BrandButton: (props: React.ComponentProps<"button">) => React.createElement("button", props) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

let renderer: ReactTestRenderer;
const today = todayIsoDate();
const payment: FinancePayment = { id: "today", contractId: "contract", athleteUsername: "cliente", athleteName: "Cliente", planLabel: "Plan", dueDate: today, expectedAmountCents: 20000, paidAmountCents: 0, paidAt: "", status: "pending", sequenceIndex: 1, sequenceCount: 1, notes: "", createdAt: "", updatedAt: "" };
const payments = [payment, { ...payment, id: "30-days", dueDate: addDays(today, 30) }, { ...payment, id: "31-days", dueDate: addDays(today, 31) }, { ...payment, id: "overdue", dueDate: addDays(today, -1) }, { ...payment, id: "paid", status: "paid" as const, paidAt: today, paidAmountCents: 20000 }];
const dataset = { athletes: [{ username: "cliente", name: "Cliente", email: "" }], contracts: [], payments, expenses: [], expenseInvoiceFiles: [], invoices: [], invoiceSettings: DEFAULT_FINANCE_INVOICE_SETTINGS, planOptions: DEFAULT_FINANCE_PLAN_OPTIONS, dashboard: buildFinanceDashboard({ contracts: [], payments, today }) };

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => dataset }));
  vi.stubGlobal("window", { confirm: vi.fn().mockReturnValue(true), setInterval: vi.fn(), clearInterval: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("document", { getElementById: () => ({ scrollIntoView: vi.fn() }), addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => { if (renderer) act(() => renderer.unmount()); vi.unstubAllGlobals(); });
async function mount(section: "overview" | "invoices" | "quarterly" = "overview") {
  await act(async () => { renderer = create(React.createElement(AdminFinanceShell, { user: { username: "admin", name: "Admin" }, section })); });
}
function field(label: string, type: React.ElementType = "input") {
  return renderer.root.findAllByType("label").find(item => item.children.some(child => typeof child === "string" && child.trim() === label))!.findByType(type);
}

describe("finance user flows", () => {
  it("autocompletes installments in athlete registration as price and count change", async () => {
    await act(async () => { renderer = create(React.createElement(AdminToolsShell, { user: { username: "admin", name: "Admin" } })); });
    act(() => renderer.root.findByProps({ type: "checkbox" }).props.onChange({ target: { checked: true } }));
    act(() => field("Pago fraccionado", "select").props.onChange({ target: { value: "yes" } }));
    expect(field("Importe por pago").props).toMatchObject({ value: "", readOnly: true });
    act(() => {
      field("Precio total / cuota").props.onChange({ target: { value: "1.200,00" } });
      field("Numero pagos").props.onChange({ target: { value: "5" } });
    });
    expect(field("Importe por pago").props.value).toBe("240,00");
    act(() => field("Precio total / cuota").props.onChange({ target: { value: "100" } }));
    act(() => field("Numero pagos").props.onChange({ target: { value: "3" } }));
    expect(field("Importe por pago").props.value).toBe("33,34");
    for (const value of ["", "0", "2.5"]) {
      act(() => field("Numero pagos").props.onChange({ target: { value } }));
      expect(field("Importe por pago").props.value).toBe("");
    }
    act(() => field("Numero pagos").props.onChange({ target: { value: "2" } }));
    expect(field("Importe por pago").props.value).toBe("50,00");
    act(() => field("Precio total / cuota").props.onChange({ target: { value: "" } }));
    expect(field("Importe por pago").props.value).toBe("");
  });

  it("submits the price and count for server-calculated installments and resets the preview after registration", async () => {
    await act(async () => { renderer = create(React.createElement(AdminToolsShell, { user: { username: "admin", name: "Admin" } })); });
    act(() => {
      for (const [label, value] of [["Nombre", "Atleta de prueba"], ["Usuario", "atleta-prueba"], ["Contraseña inicial", "test-password"], ["Fecha nacimiento", "1990-01-01"], ["Altura (cm)", "180"]]) field(label).props.onChange({ target: { value } });
      field("Sexo", "select").props.onChange({ target: { value: "male" } });
      renderer.root.findByProps({ type: "checkbox" }).props.onChange({ target: { checked: true } });
    });
    act(() => {
      field("Precio total / cuota").props.onChange({ target: { value: "600" } });
      field("Forma de Pago", "select").props.onChange({ target: { value: "bank_transfer" } });
      field("Pago fraccionado", "select").props.onChange({ target: { value: "yes" } });
    });
    act(() => field("Numero pagos").props.onChange({ target: { value: "3" } }));
    expect(field("Importe por pago").props.value).toBe("200,00");
    await act(async () => { await renderer.root.findAllByType("button").find(item => item.children.includes("Crear usuario"))!.props.onClick(); });
    const posted = vi.mocked(fetch).mock.calls.find(([url, init]) => url === "/api/admin/users" && init?.method === "POST")!;
    const finance = JSON.parse(String(posted[1]?.body)).finance;
    expect(finance).toMatchObject({ totalAmount: "600", paymentCount: 3, financed: true });
    expect(finance).not.toHaveProperty("paymentAmount");
    act(() => renderer.root.findByProps({ type: "checkbox" }).props.onChange({ target: { checked: true } }));
    act(() => field("Pago fraccionado", "select").props.onChange({ target: { value: "yes" } }));
    expect(field("Importe por pago").props.value).toBe("");
  });

  it("shows gross deductible and non-deductible spending in each invoice-page quarter and respects the year filter", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ ...dataset, expenses: [expense, { ...expense, id: "non-deductible", vatDeductible: false, amountCents: 24200 }, { ...expense, id: "old-expense", date: "2025-03-31", amountCents: 5000 }] }) } as Response);
    await mount("invoices");
    act(() => renderer.root.findByProps({ "aria-label": "Ejercicio del IVA" }).props.onChange({ target: { value: "2026" } }));
    const firstQuarter = () => renderer.root.findAllByType("h3").find(item => item.children.join("") === "Trimestre 1")!.parent!;
    const lines = () => firstQuarter().findAllByType("p").map(item => item.children.join(""));
    expect(lines()).toEqual([`IVA Repercutido: ${formatCents(0)}`, `IVA Deducible: ${formatCents(2100)}`, `TOTAL Deducible: ${formatCents(12100)}`, `TOTAL No deducible: ${formatCents(24200)}`]);
    expect(lines()).toContain(`TOTAL No deducible: ${formatCents(24200)}`);
    expect(lines()).toContain(`IVA Deducible: ${formatCents(2100)}`);
    act(() => renderer.root.findByProps({ "aria-label": "Ejercicio del IVA" }).props.onChange({ target: { value: "2025" } }));
    expect(lines()).toContain(`TOTAL Deducible: ${formatCents(5000)}`);
    expect(lines()).toContain(`TOTAL No deducible: ${formatCents(0)}`);
  });
  it("requires an explicit payment method when creating a contract", async () => {
    await mount();
    expect(field("Forma de Pago", "select").props).toMatchObject({ required: true, value: "" });
    expect(field("Forma de Pago", "select").findAllByType("option").map(option => option.props.value)).toEqual(["", "cash", "bank_transfer"]);
    act(() => {
      field("Atleta", "select").props.onChange({ target: { value: "cliente" } });
      field("Precio total / cuota").props.onChange({ target: { value: "200" } });
    });
    const button = renderer.root.findAllByType("button").find(item => item.children.includes("Crear contrato"))!;
    await act(async () => { await button.props.onClick(); });
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    act(() => field("Forma de Pago", "select").props.onChange({ target: { value: "cash" } }));
    await act(async () => { await button.props.onClick(); });
    const posted = vi.mocked(fetch).mock.calls.find(([url, init]) => url === "/api/admin/finance/contracts" && init?.method === "POST")!;
    expect(JSON.parse(String(posted[1]?.body))).toMatchObject({ paymentMethod: "cash", athleteUsername: "cliente" });
  });

  it.each([false, true])("edits every historical expense and preserves an optional PDF (attached=%s)", async attached => {
    const expenses = Array.from({ length: 12 }, (_, index) => ({ ...expense, id: `expense-${index}`, description: `Gasto ${index}` }));
    const files = attached ? [{ id: "invoice-file", expenseId: "expense-11", driveFileId: "drive-id", fileName: "Factura.pdf", status: "expense-created" }] : [];
    let current = { ...dataset, expenses, expenseInvoiceFiles: files };
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (init?.method === "PATCH") {
        const payload = JSON.parse(String(init.body));
        const updated = { ...expenses[11], description: payload.description };
        current = { ...current, expenses: current.expenses.map(item => item.id === updated.id ? updated : item) };
        return { ok: true, json: async () => ({ expense: updated }) } as Response;
      }
      return { ok: true, json: async () => current } as Response;
    });
    await mount("invoices");
    expect(renderer.root.findAllByType("button").filter(item => item.props["aria-label"]?.startsWith("Editar gasto "))).toHaveLength(12);
    act(() => renderer.root.findByProps({ "aria-label": "Editar gasto Gasto 11" }).props.onClick());
    expect(field("Descripcion").props.value).toBe("Gasto 11");
    expect(field("Importe bruto (IVA incluido)").props.value).toBe("121,00");
    expect(field("IVA aplicado (%)").props.value).toBe("21");
    act(() => field("Descripcion").props.onChange({ target: { value: "Gasto editado" } }));
    const save = renderer.root.findAllByType("button").find(item => item.children.includes("Guardar cambios del gasto"))!;
    await act(async () => { await save.props.onClick(); });
    expect(vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "PATCH")?.[0]).toBe("/api/admin/finance/expenses/expense-11");
    expect(current.expenses).toHaveLength(12);
    expect(current.expenseInvoiceFiles).toEqual(files);
    expect(renderer.root.findAllByType("h2").some(item => item.children.includes("Nuevo gasto"))).toBe(true);
  });

  it("confirms before deleting a standalone expense and removes it only after success", async () => {
    vi.mocked(fetch).mockImplementation(async (_url, init) => ({ ok: true, json: async () => init?.method === "DELETE" ? { expenses: [], expenseInvoiceFiles: [] } : { ...dataset, expenses: [expense] } }) as Response);
    await mount("invoices");
    vi.mocked(window.confirm).mockReturnValue(false);
    await act(async () => { await renderer.root.findByProps({ "aria-label": "Eliminar gasto Alquiler" }).props.onClick(); });
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("Alquiler"));
    vi.mocked(window.confirm).mockReturnValue(true);
    await act(async () => { await renderer.root.findByProps({ "aria-label": "Eliminar gasto Alquiler" }).props.onClick(); });
    expect(vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "DELETE")?.[0]).toBe(`/api/admin/finance/expenses/${expense.id}`);
    expect(renderer.root.findAllByProps({ "aria-label": "Eliminar gasto Alquiler" })).toHaveLength(0);
  });

  it("keeps the expense and entered changes when saving fails", async () => {
    vi.mocked(fetch).mockImplementation(async (_url, init) => ({ ok: init?.method !== "PATCH", json: async () => init?.method === "PATCH" ? { error: "No guardado" } : { ...dataset, expenses: [expense] } }) as Response);
    await mount("invoices");
    act(() => renderer.root.findByProps({ "aria-label": "Editar gasto Alquiler" }).props.onClick());
    act(() => field("Descripcion").props.onChange({ target: { value: "Conservar esta edición" } }));
    await act(async () => { await renderer.root.findAllByType("button").find(item => item.children.includes("Guardar cambios del gasto"))!.props.onClick(); });
    expect(field("Descripcion").props.value).toBe("Conservar esta edición");
    expect(renderer.root.findByProps({ "aria-label": "Editar gasto Alquiler" })).toBeDefined();
  });

  it("keeps quarterly totals and filters without the removed sections", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ ...dataset, contracts: [contract], invoices: [invoice, { ...invoice, id: "old-invoice", operationDate: "2025-12-31" }], expenses: [expense], payments: [collectedPayment] }) } as Response);
    await mount("quarterly");
    const year = renderer.root.findByProps({ "aria-label": "Año del análisis trimestral" });
    act(() => year.props.onChange({ target: { value: "2026" } }));
    act(() => renderer.root.findByProps({ "aria-label": "Ver trimestre 1" }).props.onClick());
    const detail = renderer.root.findByProps({ "aria-label": "Detalle del trimestre 1" });
    expect(detail.findAllByType("h3").map(item => item.children.join(" ")).join(" ")).toContain("Total Recibido en Efectivo");
    expect(detail.findAllByType("article")[0].findAllByType("p")[0].children.join("")).toBe(formatCents(121000));
    expect(detail.findAllByType("figure")).toHaveLength(0);
    expect(detail.findAllByType("details")).toHaveLength(0);
    expect(detail.findAllByType("h3").map(item => item.children.join(" "))).not.toContain("Trazabilidad del efectivo");
    expect(renderer.root.findAllByProps({ id: "new-contract" })).toHaveLength(0);
    act(() => year.props.onChange({ target: { value: "2025" } }));
    act(() => renderer.root.findByProps({ "aria-label": "Ver trimestre 4" }).props.onClick());
    expect(renderer.root.findByProps({ "aria-label": "Detalle del trimestre 4" }).findAllByType("article")[0].findAllByType("p")[0].children.join("")).toBe(formatCents(121000));
  });
  it("recalculates the displayed installment as total, reservation and count change", async () => {
    await mount();
    act(() => {
      field("Precio total / cuota").props.onChange({ target: { value: "1200" } });
      field("Reserva").props.onChange({ target: { value: "200" } });
      field("Pago fraccionado", "select").props.onChange({ target: { value: "yes" } });
    });
    act(() => field("Numero de pagos").props.onChange({ target: { value: "5" } }));
    expect(field("Importe por pago (automático)").props).toMatchObject({ value: "200,00", readOnly: true });
    act(() => field("Reserva").props.onChange({ target: { value: "300" } }));
    expect(field("Importe por pago (automático)").props.value).toBe("180,00");
  });
  it("shows only unpaid collections within 30 days beside the payment table", async () => {
    await mount();
    const heading = renderer.root.findAllByType("h2").find(item => item.children.join("").includes("Próximos cobros"))!;
    expect(heading.parent!.findAllByType("button")).toHaveLength(2);
    const layout = renderer.root.findByProps({ "aria-label": "Contratos y cobros" });
    expect(layout.props.className).toContain("lg:grid-cols-3");
    expect(heading.parent!.parent!.findByProps({ id: "new-contract" })).toBeDefined();
    expect(layout.findAllByType("section").some(item => item.props.className?.includes("lg:col-span-2"))).toBe(true);
    expect(renderer.root.findByProps({ "aria-label": "Calendario financiero" }).props.className).toBe("w-full min-w-0");
    expect(renderer.root.findAllByType("th").map(item => item.children.join(""))).not.toContain("Acciones");
    expect(renderer.root.findAllByType("button").filter(item => item.props.title === "Modificar pago")).toHaveLength(5);
    for (const button of renderer.root.findAllByType("button").filter(item => item.props.title === "Modificar pago")) {
      expect(button.parent).toBe(button.parent!.parent!.findAllByType("td").at(-1));
    }
    expect(renderer.root.findAllByType("h2").map(item => item.children.join(""))).not.toContain("Generador de facturas");
  });
  it("uses compact monthly and annual groups with four cards and no reporting currency selector", async () => {
    await mount();
    const summary = renderer.root.findByProps({ "aria-label": "Resumen financiero" });
    expect(summary.props.className).toContain("lg:grid-cols-2");
    expect(summary.findAllByType("article")).toHaveLength(8);
    expect(summary.findAllByType("h2").map(item => item.children.join(""))).toEqual(["Mensual", "Anual"]);
    expect(summary.findByProps({ "aria-label": "Ejercicio" }).props.className).toContain("w-24");
    expect(summary.findAllByType("select")).toHaveLength(1);
    expect(summary.findAllByType("article").find(item => item.props.title === "Pagos pendientes con vencimiento este mes")!.findAllByType("p")[1].children.join("")).toBe(new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(payments.filter(item => item.status === "pending" && item.dueDate.startsWith(today.slice(0, 7))).length * 200));
    expect(summary.findAllByType("p").map(item => item.children.join("")).join(" ")).not.toContain("Previsto mes");
    expect(summary.findAllByType("p").map(item => item.children.join("")).join(" ")).toContain("Bruto anual");
  });
  it("keeps invoices on their own page with manual VAT, currency and attachment inputs", async () => {
    await mount("invoices");
    const headings = renderer.root.findAllByType("h2").map(item => item.children.join(""));
    expect(headings).toContain("Generador de facturas");
    expect(headings).toContain("Facturas PDF cargadas");
    expect(headings).not.toContain("Nuevo contrato");
    expect(renderer.root.findAllByProps({ "aria-label": "Resumen financiero" })).toHaveLength(0);
    expect(renderer.root.findByProps({ "aria-label": "Ejercicio del IVA" })).toBeDefined();
    expect(field("Moneda", "select").findAllByType("option")).toHaveLength(50);
    expect(field("IVA aplicado (%)").props.value).toBe("0");
    expect(renderer.root.findAllByType("input").some(item => item.props.type === "file")).toBe(true);
    act(() => {
      field("Moneda", "select").props.onChange({ target: { value: "USD" } });
      field("Importe bruto (IVA incluido)").props.onChange({ target: { value: "100" } });
    });
    expect(renderer.root.findAllByType("p").some(item => item.children.includes("Equivalente en euros: "))).toBe(true);
  });
});
