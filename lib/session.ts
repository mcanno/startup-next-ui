// Lectura de sesión compartida entre /api/auth/me, /admin/page.tsx, y el
// gate de las rutas /api/admin/* — un solo lugar que sabe leer la cookie
// y verificarla, para no repetir el parseo en cada uno.

import "server-only";
import { cookies } from "next/headers";
import { verifySessionToken } from "./magicLink";

export async function getSessionEmail(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("session")?.value;
  return token ? verifySessionToken(token) : null;
}

export function isSuperadminEmail(email: string | null): boolean {
  const superadmin = process.env.SUPERADMIN_EMAIL?.trim().toLowerCase();
  return Boolean(email && superadmin && email === superadmin);
}
