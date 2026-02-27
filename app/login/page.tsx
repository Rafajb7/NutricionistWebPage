import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { getSessionFromCookies } from "@/lib/auth/session";

export default async function LoginPage() {
  const session = await getSessionFromCookies();
  if (session) redirect(session.mustChangePassword ? "/password/change" : "/dashboard");

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4">
      <div className="pointer-events-none absolute inset-0 bg-brand-gradient opacity-80" />
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[560px] w-[560px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-accent/10 blur-3xl" />
      <div className="relative z-10 w-full max-w-md">
        <LoginForm />
      </div>
    </main>
  );
}
