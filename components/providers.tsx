"use client";

import { Toaster } from "sonner";

export function Providers() {
  return (
    <Toaster
      richColors
      theme="dark"
      position="top-right"
      toastOptions={{
        style: {
          background: "var(--brand-surface)",
          border: "1px solid color-mix(in srgb, var(--brand-accent) 35%, transparent)",
          color: "var(--brand-text)"
        }
      }}
    />
  );
}
