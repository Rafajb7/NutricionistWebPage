import Link from "next/link";
import { ResetPasswordForm } from "@/components/password/reset-password-form";

type ResetPasswordPageProps = {
  searchParams: Promise<{
    token?: string;
  }>;
};

export default async function ResetPasswordPage(props: ResetPasswordPageProps) {
  const searchParams = await props.searchParams;
  const token = searchParams.token?.trim() ?? "";

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4">
      <div className="pointer-events-none absolute inset-0 bg-brand-gradient opacity-80" />
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[560px] w-[560px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-accent/10 blur-3xl" />
      <div className="relative z-10 w-full max-w-md">
        {token ? (
          <ResetPasswordForm token={token} />
        ) : (
          <div className="rounded-3xl border border-brand-accent/25 bg-brand-surface/90 p-7 text-center shadow-glow">
            <h1 className="text-2xl font-bold text-brand-text">Enlace no valido</h1>
            <p className="mt-2 text-sm text-brand-muted">
              Falta el token de recuperación. Solicita un nuevo enlace.
            </p>
            <Link
              href="/password/forgot"
              className="mt-4 inline-block text-sm text-brand-accent transition hover:opacity-80"
            >
              Ir a restablecer contraseña
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
