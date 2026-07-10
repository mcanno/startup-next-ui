import { NextResponse } from "next/server";
import { signSessionToken, verifyLinkToken } from "@/lib/magicLink";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");

  if (!token) {
    return NextResponse.redirect(`${url.origin}/login?error=missing_token`);
  }

  const email = await verifyLinkToken(token);
  if (!email) {
    return NextResponse.redirect(`${url.origin}/login?error=invalid_token`);
  }

  const sessionToken = await signSessionToken(email);
  const response = NextResponse.redirect(`${url.origin}/`);
  response.cookies.set("session", sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
