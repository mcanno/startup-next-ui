import { NextResponse } from "next/server";
import { getSessionEmail, isSuperadminEmail } from "@/lib/session";

// Le permite a page.tsx (client component) saber quién es el usuario
// logueado sin poder leer la cookie httpOnly directamente -- nunca expone
// SUPERADMIN_EMAIL en sí, solo si el email de ESTA sesión coincide.
export async function GET() {
  const email = await getSessionEmail();
  return NextResponse.json({ email, isSuperadmin: isSuperadminEmail(email) });
}
