import { redirect } from "next/navigation";
import { getSessionFromCookies } from "@/lib/auth/session";

export default async function HomePage() {
  const session = await getSessionFromCookies();
  redirect(session ? "/dashboard" : "/login");
}
