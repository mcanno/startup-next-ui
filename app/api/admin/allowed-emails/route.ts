import { NextResponse } from "next/server";
import { addAllowedEmail } from "@/lib/startupNextClient";
import { getSessionEmail, isSuperadminEmail } from "@/lib/session";

// Gate acá adentro, no solo en /admin/page.tsx: esta ruta es alcanzable
// directo (fetch/curl) sin pasar nunca por esa página, y de lo contrario
// reenviaría al backend con API_KEY_ADMIN sin ningún chequeo de sesión.
//
// Sin GET acá: la lista inicial la trae app/admin/page.tsx directo del
// server component (listAllowedEmails()), no por esta ruta -- evita un
// round-trip extra y un useEffect de fetch-on-mount en el cliente.
async function requireSuperadmin() {
  const email = await getSessionEmail();
  return isSuperadminEmail(email);
}

export async function POST(req: Request) {
  if (!(await requireSuperadmin())) {
    return NextResponse.json({ error: "no autorizado" }, { status: 403 });
  }
  const body = (await req.json()) as { email?: string };
  if (!body.email?.trim()) {
    return NextResponse.json({ error: "email es obligatorio" }, { status: 400 });
  }
  try {
    await addAllowedEmail(body.email.trim().toLowerCase());
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
