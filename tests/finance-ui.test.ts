import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminFinanceShell } from "@/components/admin/admin-finance-shell";
import { addDays, buildFinanceDashboard, todayIsoDate } from "@/lib/finance/calculations";
import { DEFAULT_FINANCE_INVOICE_SETTINGS, DEFAULT_FINANCE_PLAN_OPTIONS } from "@/lib/finance/types";
import type { FinancePayment } from "@/lib/finance/types";

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
});
afterEach(() => { if (renderer) act(() => renderer.unmount()); vi.unstubAllGlobals(); });
async function mount(section: "overview" | "invoices" = "overview") {
  await act(async () => { renderer = create(React.createElement(AdminFinanceShell, { user: { username: "admin", name: "Admin" }, section })); });
}
function field(label: string, type: React.ElementType = "input") {
  return renderer.root.findAllByType("label").find(item => item.children.some(child => typeof child === "string" && child.trim() === label))!.findByType(type);
}

describe("finance user flows", () => {
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
