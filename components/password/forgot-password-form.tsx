"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { BrandLogo } from "@/components/brand-logo";
import { BrandButton } from "@/components/ui/brand-button";

type ForgotPasswordResponse = {
  error?: string;
  warning?: string;
  developmentResetLink?: string;
};

export function ForgotPasswordForm() {
  const [identifier, setIdentifier] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/password/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier })
      });

      const json = (await res.json()) as ForgotPasswordResponse;
      if (!res.ok) {
        toast.error(json.error ?? "No se pudo enviar el correo.");
        return;
      }

      if (json.developmentResetLink) {
        if (json.warning) {
          toast.warning(json.warning);
        }
        toast.success("Modo desarrollo: abriendo enlace directo para restablecer contraseña.");
        window.location.href = json.developmentResetLink;
        return;
      }

      toast.success(
        "Correo enviado correctamente. Revisa tu bandeja de entrada y la carpeta de spam."
      );
      setIdentifier("");
    } catch (error) {
      console.error(error);
      toast.error("Error de conexión.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="w-full max-w-md rounded-3xl border border-brand-accent/25 bg-brand-surface/90 p-7 shadow-glow backdrop-blur"
    >
      <BrandLogo href="/login" showText />

      <div className="mt-8">
        <h1 className="text-2xl font-bold text-brand-text">Restablecer contraseña</h1>
        <p className="mt-2 text-sm text-brand-muted">
          Introduce tu usuario o email y te enviaremos un enlace para cambiar la contraseña.
        </p>
      </div>

      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <div>
          <label className="mb-2 block text-xs uppercase tracking-[0.2em] text-brand-muted">
            Usuario o email
          </label>
          <input
            required
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            className="w-full rounded-xl border border-white/15 bg-black/25 px-4 py-3 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
            placeholder="@usuario o correo@dominio.com"
          />
        </div>
        <BrandButton className="w-full" disabled={loading}>
          {loading ? "Enviando..." : "Enviar enlace"}
        </BrandButton>
      </form>

      <div className="mt-4 text-center">
        <Link href="/login" className="text-xs text-brand-muted transition hover:text-brand-accent">
          Volver al login
        </Link>
      </div>
    </motion.div>
  );
}
