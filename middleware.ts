import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth/jwt";

const protectedPrefixes = ["/dashboard", "/revision", "/tools", "/password/change"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;

  const isProtected = protectedPrefixes.some((prefix) => pathname.startsWith(prefix));
  if (isProtected && !session) {
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  if (session?.mustChangePassword) {
    const isChangePasswordPath = pathname.startsWith("/password/change");
    const isProtectedAppPath = ["/dashboard", "/revision", "/tools"].some((prefix) =>
      pathname.startsWith(prefix)
    );

    if (isProtectedAppPath && !isChangePasswordPath) {
      return NextResponse.redirect(new URL("/password/change", req.url));
    }
  }

  if (pathname === "/login" && session) {
    const redirectPath = session.mustChangePassword ? "/password/change" : "/dashboard";
    return NextResponse.redirect(new URL(redirectPath, req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/login", "/dashboard/:path*", "/revision/:path*", "/tools/:path*", "/password/change"]
};
