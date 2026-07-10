import "server-only";
import { Resend } from "resend";

function getResendClient(): Resend {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY is not set");
  return new Resend(apiKey);
}

export async function sendMagicLinkEmail(email: string, link: string): Promise<void> {
  const from = process.env.EMAIL_FROM;
  if (!from) throw new Error("EMAIL_FROM is not set");

  const { error } = await getResendClient().emails.send({
    from,
    to: [email],
    subject: "Tu enlace de acceso a Startup-Next",
    html: `<p>Hacé clic para acceder:</p><p><a href="${link}">${link}</a></p><p>Este enlace expira en 15 minutos.</p>`,
  });

  if (error) throw new Error(`resend: ${JSON.stringify(error)}`);
}
