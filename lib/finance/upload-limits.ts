// Leave room for multipart metadata below Vercel's 4.5 MB request limit.
// https://vercel.com/docs/functions/limitations
export const MAX_FINANCE_INVOICE_MB = 4;
export const MAX_FINANCE_INVOICE_BYTES = MAX_FINANCE_INVOICE_MB * 1024 * 1024;
