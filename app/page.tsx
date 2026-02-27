import { redirect } from "next/navigation";
import { getSessionFromCookies } from "@/lib/auth/session";

export default async function HomePage() {
  const session = await getSessionFromCookies();
  if (!session) {
    redirect("/login");
  }
  redirect(session.mustChangePassword ? "/password/change" : "/dashboard");
}
