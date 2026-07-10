import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifySessionToken } from "@/lib/magicLink";

export async function middleware(req: NextRequest) {
  const token = req.cookies.get("session")?.value;
  const email = token ? await verifySessionToken(token) : null;
  if (email) return NextResponse.next();

  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = {
  matcher: ["/", "/runs/:path*", "/admin"],
};
