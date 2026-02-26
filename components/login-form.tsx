"use client";

import { type FormEvent, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { BrandLogo } from "@/components/brand-logo";
import { BrandButton } from "@/components/ui/brand-button";

export function LoginForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });

      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(json.error ?? "No se pudo iniciar sesión.");
        return;
      }

      toast.success("Sesión iniciada");
      window.location.href = "/dashboard";
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
        <h1 className="text-2xl font-bold text-brand-text">Acceso privado</h1>
        <p className="mt-2 text-sm text-brand-muted">
          Plataforma de seguimiento nutricional para powerlifting.
        </p>
      </div>

      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <div>
          <label className="mb-2 block text-xs uppercase tracking-[0.2em] text-brand-muted">
            Usuario
          </label>
          <input
            required
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            className="w-full rounded-xl border border-white/15 bg-black/25 px-4 py-3 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
            placeholder="usuario"
          />
        </div>
        <div>
          <label className="mb-2 block text-xs uppercase tracking-[0.2em] text-brand-muted">
            Contraseña
          </label>
          <input
            type="password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-xl border border-white/15 bg-black/25 px-4 py-3 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
            placeholder="••••••••"
          />
        </div>
        <BrandButton className="w-full" disabled={loading}>
          {loading ? "Entrando..." : "Iniciar sesión"}
        </BrandButton>
      </form>
    </motion.div>
  );
}
