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
          border: "1px solid rgba(247,204,47,0.25)",
          color: "var(--brand-text)"
        }
      }}
    />
  );
}
