# Finanzas

La interfaz principal está en `/tools/finance`; la gestión de facturas está en `/tools/finance/invoices`. Ambas requieren sesión de administrador. Los datos siguen en Google Sheets y los adjuntos en Google Drive.

- Reserva: se guarda como pago cobrado en la fecha de inicio. Las cuotas distribuyen el total menos la reserva desde la fecha del primer pago; cualquier resto de céntimos se reparte entre las primeras cuotas. Una reserva del total no genera cuotas de importe cero.
- Cash collector: cobros registrados del mes y desde el 1 de enero hasta hoy. El perfil 360 muestra lo cobrado y los pagos pendientes del cliente.
- Bruta anual: cobros por fecha de cobro del año natural seleccionado. Neta anual: esos cobros menos los gastos del mismo año. Toda la contabilidad se muestra en EUR. El bloque mensual contiene cash collector, pendiente del mes, gastos y neto; el anual contiene cash collector del año actual, pendiente del ejercicio, bruta y neta.
- Facturas recibidas: registro manual del importe bruto (IVA incluido), porcentaje de IVA, moneda y si el IVA es deducible. Los PDF se guardan en `GOOGLE_DRIVE_ROOT_FOLDER_ID/Facturas` con nombre `Descripción AAAA-MM-DD.pdf` y se consultan mediante una ruta autenticada, sin hacer públicos los archivos.
- El límite del adjunto es 4 MB (o `MAX_UPLOAD_MB` si es menor), dejando espacio al formulario dentro del [límite de Vercel](https://vercel.com/docs/functions/limitations).
- IVA trimestral: IVA de facturas emitidas, por fecha de operación, menos IVA incluido en los gastos marcados como deducibles, convertido a EUR. Es una estimación: no incorpora compensaciones de otros periodos, prorrata ni regímenes especiales. La marca de deducibilidad es manual; no se infiere que todos los gastos sean deducibles. Referencia: [instrucciones de la AEAT del modelo 303](https://sede.agenciatributaria.gob.es/Sede/todas-gestiones/impuestos-tasas/iva/modelo-303-iva-autoliquidacion_/instrucciones-2026.html).

## Conversión de facturas recibidas

`exchange-rates-snapshot.json` contiene las 50 conversiones verificadas el **8 de octubre de 2026**: euros por una unidad de moneda extranjera. Fuente: [ExchangeRate-API](https://www.exchangerate-api.com/docs/free), con actualización diaria y atribución visible en la aplicación. Las cotizaciones del proveedor están expresadas en unidades por euro; se invierten antes de multiplicar el importe y redondear a céntimos.

El servidor consulta la lista actual con caché de una hora. Si la consulta falla conserva la última lista disponible (o la lista inicial); se muestra y guarda su fecha real, sin presentarla como una cotización de hoy. El formulario permite consultar la lista y muestra el equivalente en euros antes de registrar el gasto.

Cada nuevo gasto conserva importe y moneda originales, importe en EUR, cambio aplicado y fecha del cambio. Estos tres últimos campos se añaden al final de `FinanceExpenses`. Un gasto guardado no se revaloriza al actualizarse la lista. Las filas antiguas sin conversión usan la lista inicial fechada, no el cambio diario. Se emiten nuevos contratos y facturas exclusivamente en EUR.

La inicialización de Sheets añade las columnas `Reserva cents` al final de `FinanceContracts`, e `IVA %` e `IVA deducible` al final de `FinanceExpenses`. Las filas antiguas conservan sus posiciones y se leen con reserva cero e IVA sin deducibilidad. Los contratos y cuotas existentes no se recalculan.

Pruebas: `npx vitest run tests/finance-calculations.test.ts tests/finance-reporting.test.ts tests/finance-expense-routes.test.ts tests/finance-ui.test.ts tests/finance-exchange-rates.test.ts`.
