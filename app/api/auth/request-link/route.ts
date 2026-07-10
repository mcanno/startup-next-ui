import { NextResponse } from "next/server";
import { sendMagicLinkEmail } from "@/lib/email";
import { signLinkToken } from "@/lib/magicLink";
import { checkAllowedEmail } from "@/lib/startupNextClient";

// Misma respuesta exista o no el email autorizado (decisión explícita,
// sección 9): no confirmar ni negar si un email puntual está autorizado,
// para no filtrar esa información a quien pruebe emails al azar.
const GENERIC_MESSAGE = "Si tu email está autorizado, te va a llegar un enlace en unos minutos.";

// SUPERADMIN_EMAIL siempre pasa, sin consultar el backend (bootstrap: sin
// esto, si allowed_emails está vacía nadie podría loguearse para agregar
// el primer email — huevo y gallina).
async function isAllowed(email: string): Promise<boolean> {
  const superadmin = process.env.SUPERADMIN_EMAIL?.trim().toLowerCase();
  if (superadmin && email === superadmin) return true;

  try {
    return await checkAllowedEmail(email);
  } catch (err) {
    console.error("error consultando allowed_emails:", err);
    return false;
  }
}

export async function POST(req: Request) {
  const body = (await req.json()) as { email?: string };
  const email = body.email?.trim().toLowerCase();

  if (!email) {
    return NextResponse.json({ error: "email es obligatorio" }, { status: 400 });
  }

  if (await isAllowed(email)) {
    try {
      const token = await signLinkToken(email);
      const origin = new URL(req.url).origin;
      const link = `${origin}/api/auth/verify?token=${encodeURIComponent(token)}`;
      await sendMagicLinkEmail(email, link);
    } catch (err) {
      // No se propaga al cliente -- misma respuesta genérica pase lo que pase.
      console.error("error enviando magic link:", err);
    }
  }

  return NextResponse.json({ message: GENERIC_MESSAGE });
}
