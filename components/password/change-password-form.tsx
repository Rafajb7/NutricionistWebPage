"use client";

import { type FormEvent, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { BrandLogo } from "@/components/brand-logo";
import { BrandButton } from "@/components/ui/brand-button";

export function ChangePasswordForm() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/password/change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, confirmPassword })
      });

      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(json.error ?? "No se pudo cambiar la contraseña.");
        return;
      }

      toast.success("Contraseña actualizada");
      window.location.href = "/dashboard";
    } catch (error) {
      console.error(error);
      toast.error("Error de conexion.");
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
      <BrandLogo href="/password/change" showText />

      <div className="mt-8">
        <h1 className="text-2xl font-bold text-brand-text">Cambia tu contraseña</h1>
        <p className="mt-2 text-sm text-brand-muted">
          Es tu primer acceso. Debes definir una nueva contraseña antes de continuar.
        </p>
      </div>

      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <div>
          <label className="mb-2 block text-xs uppercase tracking-[0.2em] text-brand-muted">
            Nueva contraseña
          </label>
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-xl border border-white/15 bg-black/25 px-4 py-3 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
            placeholder="Minimo 8 caracteres"
          />
        </div>
        <div>
          <label className="mb-2 block text-xs uppercase tracking-[0.2em] text-brand-muted">
            Repite contraseña
          </label>
          <input
            type="password"
            required
            minLength={8}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            className="w-full rounded-xl border border-white/15 bg-black/25 px-4 py-3 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
            placeholder="Repite la nueva contraseña"
          />
        </div>
        <BrandButton className="w-full" disabled={loading}>
          {loading ? "Guardando..." : "Actualizar contraseña"}
        </BrandButton>
      </form>
    </motion.div>
  );
}
