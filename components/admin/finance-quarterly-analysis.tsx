"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Banknote, Landmark, ReceiptText } from "lucide-react";
import { formatCents, isIsoDate } from "@/lib/finance/calculations";
import { buildQuarterlyFinanceReport, financeReportYears } from "@/lib/finance/quarterly-report";
import { financePaymentMethodLabel } from "@/lib/finance/payment-methods";
import type { FinanceManagementData } from "@/lib/finance/types";

const PERIODS = ["Enero – marzo", "Abril – junio", "Julio – septiembre", "Octubre – diciembre"];
const AEAT_303 =
  "https://sede.agenciatributaria.gob.es/Sede/todas-gestiones/impuestos-tasas/iva/modelo-303-iva-autoliquidacion_/instrucciones-2026.html";
const AEAT_CASH =
  "https://sede.agenciatributaria.gob.es/Sede/colaborar-agencia-tributaria/denuncias/denuncia-pagos-efectivo.html";
const AEAT_DEDUCTION =
  "https://sede.agenciatributaria.gob.es/Sede/iva/que-iva-soportado-puedo-deducir/que-actividades-derecho-deduccion.html";
function monthLabel(month: string) {
  return new Intl.DateTimeFormat("es-ES", { month: "long" }).format(
    new Date(`${month}-15T12:00:00`)
  );
}
function balanceLabel(balance: number) {
  return balance > 0 ? "A ingresar" : balance < 0 ? "A compensar" : "Resultado cero";
}

export function FinanceQuarterlyAnalysis({ data }: { data: FinanceManagementData }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [quarterNumber, setQuarterNumber] = useState(Math.floor(new Date().getMonth() / 3) + 1);
  const quarters = useMemo(() => buildQuarterlyFinanceReport(data, year), [data, year]);
  const years = financeReportYears(data);
  const quarter = quarters[quarterNumber - 1];
  const chartMax = Math.max(
    1,
    ...quarter.months.flatMap((month) => [month.incomeGrossCents, month.expenseGrossCents])
  );
  const cashCollections = quarter.collections.filter((collection) => collection.method === "cash");
  const unclassified = quarter.collections.filter((collection) => !collection.method);
  const undatedCount = data.payments.filter(
    (payment) => payment.status === "paid" && !isIsoDate(payment.paidAt)
  ).length;
  const cashShare =
    quarter.collectedCents > 0 ? Math.round((quarter.cashCents * 100) / quarter.collectedCents) : 0;

  return (
    <div className="space-y-5" aria-label="Análisis Trimestral">
      <section className="flex flex-col justify-between gap-4 rounded-2xl border border-white/10 bg-brand-surface/70 p-5 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-lg font-semibold text-brand-text">
            Tu actividad, trimestre a trimestre
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-brand-muted">
            Facturación por fecha de operación y cobros por su fecha real. Todos los importes se
            muestran en euros.
          </p>
        </div>
        <label className="text-sm text-brand-muted">
          Año fiscal
          <select
            aria-label="Año del análisis trimestral"
            value={year}
            onChange={(event) => setYear(Number(event.target.value))}
            className="ml-3 rounded-xl border border-white/15 bg-[#181818] px-4 py-2.5 text-brand-text"
          >
            {years.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </section>

      <div
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
        role="group"
        aria-label="Seleccionar trimestre"
      >
        {quarters.map((item) => (
          <button
            key={item.quarter}
            type="button"
            aria-pressed={quarterNumber === item.quarter}
            aria-label={`Ver trimestre ${item.quarter}`}
            onClick={() => setQuarterNumber(item.quarter)}
            className={`rounded-2xl border p-5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent ${quarterNumber === item.quarter ? "border-brand-accent/60 bg-brand-accent/10" : "border-white/10 bg-brand-surface/70 hover:border-white/30"}`}
          >
            <span className="text-xl font-semibold text-brand-text">
              T{item.quarter}{" "}
              <span className="text-xs font-normal text-brand-muted">/ Q{item.quarter}</span>
            </span>
            <span className="mt-1 block text-xs text-brand-muted">{PERIODS[item.quarter - 1]}</span>
            <span className="mt-4 flex justify-between gap-2 text-xs text-brand-muted">
              Facturación{" "}
              <strong className="text-emerald-300">{formatCents(item.incomeGrossCents)}</strong>
            </span>
            <span className="mt-2 flex justify-between gap-2 text-xs text-brand-muted">
              Gastos{" "}
              <strong className="text-rose-300">{formatCents(item.expenseGrossCents)}</strong>
            </span>
            <span className="mt-4 block border-t border-white/10 pt-3 text-xs text-brand-muted">
              IVA · {balanceLabel(item.balanceCents)}{" "}
              <strong className="mt-1 block text-lg text-brand-text">
                {formatCents(Math.abs(item.balanceCents))}
              </strong>
            </span>
          </button>
        ))}
      </div>

      <section aria-label={`Detalle del trimestre ${quarterNumber}`} className="space-y-4">
        <h2 className="text-xl font-semibold text-brand-text">
          T{quarterNumber} · {PERIODS[quarterNumber - 1]} de {year}
        </h2>
        <div className="grid gap-4 lg:grid-cols-3">
          <article className="rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-5">
            <ArrowUpRight className="mb-3 h-5 w-5 text-emerald-300" />
            <h3 className="text-sm text-brand-muted">Facturación total (ingresos)</h3>
            <p className="mt-2 text-3xl font-semibold text-brand-text">
              {formatCents(quarter.incomeGrossCents)}
            </p>
            <dl className="mt-4 space-y-2 text-sm">
              <Amount label="Base imponible / importe sin IVA" value={quarter.incomeBaseCents} />
              <Amount label="IVA repercutido" value={quarter.outputVatCents} />
            </dl>
            <p className="mt-4 text-xs text-brand-muted">
              {quarter.invoiceCount} facturas emitidas · Bruto antes de retenciones de IRPF.
            </p>
          </article>
          <article className="rounded-2xl border border-rose-400/20 bg-rose-400/5 p-5">
            <ArrowDownLeft className="mb-3 h-5 w-5 text-rose-300" />
            <h3 className="text-sm text-brand-muted">Gastos totales</h3>
            <p className="mt-2 text-3xl font-semibold text-brand-text">
              {formatCents(quarter.expenseGrossCents)}
            </p>
            <dl className="mt-4 space-y-2 text-sm">
              <Amount label="Base de gastos" value={quarter.expenseBaseCents} />
              <Amount label="IVA soportado" value={quarter.inputVatCents} />
            </dl>
            <p className="mt-4 text-xs text-brand-muted">
              {quarter.expenseCount} gastos registrados · Conversión guardada para gastos en otras
              monedas.
            </p>
          </article>
          <article className="rounded-2xl border border-brand-accent/40 bg-brand-accent/10 p-5">
            <Landmark className="mb-3 h-5 w-5 text-brand-accent" />
            <h3 className="text-sm text-brand-muted">Estimación de IVA · Modelo 303</h3>
            <p className="mt-2 text-3xl font-semibold text-brand-text">
              {formatCents(Math.abs(quarter.balanceCents))}
            </p>
            <p className="mt-1 font-medium text-brand-accent">
              {balanceLabel(quarter.balanceCents)}
            </p>
            <dl className="mt-4 space-y-2 text-sm">
              <Amount label="IVA repercutido" value={quarter.outputVatCents} />
              <Amount label="− IVA soportado deducible" value={quarter.deductibleVatCents} />
            </dl>
            <p className="mt-4 text-xs text-brand-muted">
              {quarter.balanceCents < 0 && quarterNumber === 4
                ? "En el último trimestre se puede optar por compensar o solicitar devolución, si procede."
                : "Resultado del trimestre, antes de compensaciones de periodos anteriores."}
            </p>
          </article>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <article className="rounded-2xl border border-white/10 bg-brand-surface/70 p-5">
            <h3 className="flex items-center gap-2 font-semibold text-brand-text">
              <ReceiptText className="h-4 w-4 text-brand-accent" /> Gastos con IVA deducible
            </h3>
            <p className="mt-2 text-xs text-brand-muted">
              Solo los gastos que has marcado como deducibles para el IVA de tu actividad.
            </p>
            <dl className="mt-4 space-y-2 text-sm">
              <Amount label="Importe bruto" value={quarter.deductibleExpenseGrossCents} />
              <Amount label="Base" value={quarter.deductibleExpenseBaseCents} />
              <Amount label="IVA deducible" value={quarter.deductibleVatCents} />
            </dl>
          </article>
          <article className="rounded-2xl border border-sky-400/25 bg-sky-400/5 p-5">
            <h3 className="flex items-center gap-2 font-semibold text-brand-text">
              <Banknote className="h-5 w-5 text-sky-300" /> Total Recibido en Efectivo
            </h3>
            <p className="mt-2 text-3xl font-semibold text-sky-200">
              {formatCents(quarter.cashCents)}
            </p>
            <p className="mt-1 text-xs text-brand-muted">
              {cashCollections.length} cobros · {cashShare}% del total cobrado en el trimestre.
            </p>
            <dl className="mt-4 space-y-2 text-sm">
              <Amount label="Transferencias recibidas" value={quarter.transferCents} />
              <Amount label="Cobros sin forma de pago" value={quarter.unspecifiedMethodCents} />
            </dl>
          </article>
        </div>

        <figure className="rounded-2xl border border-white/10 bg-brand-surface/70 p-5">
          <figcaption className="font-semibold text-brand-text">
            Ingresos vs. gastos por mes
          </figcaption>
          <p className="mt-1 text-xs text-brand-muted">
            Importes brutos con IVA · Los ingresos corresponden a las facturas emitidas.
          </p>
          <div className="mt-4 flex gap-5 text-xs text-brand-muted">
            <span>
              <span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm bg-emerald-400" />
              Ingresos
            </span>
            <span>
              <span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm bg-rose-400" />
              Gastos
            </span>
          </div>
          <div
            aria-hidden="true"
            className="mt-6 grid grid-cols-3 gap-4 border-b border-white/15 pb-3"
          >
            {quarter.months.map((month) => (
              <div key={month.month} className="min-w-0">
                <div className="flex h-44 items-end justify-center gap-2 sm:gap-4">
                  <div
                    title={`Ingresos: ${formatCents(month.incomeGrossCents)}`}
                    className="w-7 rounded-t-md bg-emerald-400/85 sm:w-12"
                    style={{ height: `${(month.incomeGrossCents / chartMax) * 100}%` }}
                  />
                  <div
                    title={`Gastos: ${formatCents(month.expenseGrossCents)}`}
                    className="w-7 rounded-t-md bg-rose-400/85 sm:w-12"
                    style={{ height: `${(month.expenseGrossCents / chartMax) * 100}%` }}
                  />
                </div>
                <p className="mt-3 text-center text-xs capitalize text-brand-muted">
                  {monthLabel(month.month)}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Importes mensuales del gráfico en euros</caption>
              <thead className="text-brand-muted">
                <tr>
                  <th scope="col" className="py-2">
                    Mes
                  </th>
                  <th scope="col" className="text-right">
                    Ingresos
                  </th>
                  <th scope="col" className="text-right">
                    Gastos
                  </th>
                </tr>
              </thead>
              <tbody>
                {quarter.months.map((month) => (
                  <tr key={month.month} className="border-t border-white/5 text-brand-text">
                    <th scope="row" className="py-2 font-normal capitalize">
                      {monthLabel(month.month)}
                    </th>
                    <td className="text-right tabular-nums">
                      {formatCents(month.incomeGrossCents)}
                    </td>
                    <td className="text-right tabular-nums">
                      {formatCents(month.expenseGrossCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </figure>

        <section className="rounded-2xl border border-white/10 bg-brand-surface/70 p-5">
          <h3 className="font-semibold text-brand-text">Trazabilidad del efectivo</h3>
          <p className="mt-2 text-sm text-brand-muted">
            El límite general de efectivo se aplica a operaciones de importe igual o superior a
            1.000 €, sumando sus pagos fraccionados. El total trimestral sirve para controlar tus
            cobros.{" "}
            <a
              href={AEAT_CASH}
              target="_blank"
              rel="noreferrer"
              className="text-brand-accent underline"
            >
              Límites y excepciones de la AEAT
            </a>
            .
          </p>
          {cashCollections.length ? (
            <ul className="mt-4 divide-y divide-white/10">
              {cashCollections.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
                >
                  <div>
                    <p className="font-medium text-brand-text">
                      {item.athleteName} · {item.planLabel}
                    </p>
                    <p className="mt-1 text-xs text-brand-muted">
                      {item.date.split("-").reverse().join("/")} ·{" "}
                      {financePaymentMethodLabel(item.method)}
                    </p>
                    {item.contractAmountCents !== null && item.contractAmountCents >= 100000 ? (
                      <p className="mt-1 text-xs text-amber-200">
                        Revisar: importe total del contrato {formatCents(item.contractAmountCents)};
                        alcanza el límite general por operación.
                      </p>
                    ) : null}
                  </div>
                  <strong className="text-sky-200">{formatCents(item.amountCents)}</strong>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-brand-muted">
              Sin cobros registrados en efectivo en este trimestre.
            </p>
          )}
          {unclassified.length ? (
            <p className="mt-4 rounded-xl bg-amber-400/10 p-3 text-sm text-amber-100">
              Hay {unclassified.length} cobros sin forma de pago. Completa el dato desde «Modificar
              pago» en{" "}
              <Link href="/tools/finance" className="underline">
                Finanzas
              </Link>{" "}
              para completar el desglose.
            </p>
          ) : null}
          {undatedCount ? (
            <p className="mt-3 text-xs text-brand-muted">
              Hay {undatedCount} cobros históricos sin fecha real válida. Completa su fecha para
              asignarlos a un trimestre.
            </p>
          ) : null}
        </section>

        <details className="rounded-2xl border border-white/10 bg-brand-surface/70 p-5 text-sm text-brand-muted">
          <summary className="cursor-pointer font-medium text-brand-text">
            Criterios del cálculo y configuración fiscal
          </summary>
          <div className="mt-4 space-y-3">
            <p>
              El IVA se toma de cada factura emitida y de cada gasto. Tu IVA por defecto para nuevas
              facturas es {data.invoiceSettings.defaultVatRate}%; puedes cambiarlo en{" "}
              <Link href="/tools/finance/invoices" className="text-brand-accent underline">
                Datos fiscales del emisor
              </Link>
              . Las facturas al 0% conservan cuota cero. La exención depende del servicio prestado.
            </p>
            <p>
              La facturación suma base e IVA antes de IRPF. Los cobros de contratos se presentan
              como tesorería y no se vuelven a sumar a las facturas. Registra las facturas de tus
              servicios y anticipos para que el cálculo fiscal esté completo.
            </p>
            <p>
              La asistencia sanitaria exenta no da derecho a deducir el IVA de sus gastos. Marca
              «IVA deducible» solo cuando corresponda a tu actividad.{" "}
              <a
                href={AEAT_DEDUCTION}
                target="_blank"
                rel="noreferrer"
                className="text-brand-accent underline"
              >
                Criterios de deducción de la AEAT
              </a>
              .
            </p>
            <p>
              Estimación de régimen general a partir de los datos registrados: no incorpora
              compensaciones anteriores, prorrata, regularizaciones, criterio de caja ni operaciones
              intracomunitarias. Un saldo negativo suele quedar a compensar; la solicitud de
              devolución depende del periodo y régimen.{" "}
              <a
                href={AEAT_303}
                target="_blank"
                rel="noreferrer"
                className="text-brand-accent underline"
              >
                Instrucciones del modelo 303
              </a>
              .
            </p>
          </div>
        </details>
      </section>
    </div>
  );
}

function Amount({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-brand-muted">{label}</dt>
      <dd className="shrink-0 font-medium tabular-nums text-brand-text">{formatCents(value)}</dd>
    </div>
  );
}
