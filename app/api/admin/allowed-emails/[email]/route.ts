import { NextResponse } from "next/server";
import { removeAllowedEmail } from "@/lib/startupNextClient";
import { getSessionEmail, isSuperadminEmail } from "@/lib/session";

export async function DELETE(_req: Request, { params }: { params: Promise<{ email: string }> }) {
  const email = await getSessionEmail();
  if (!isSuperadminEmail(email)) {
    return NextResponse.json({ error: "no autorizado" }, { status: 403 });
  }

  const { email: targetEmail } = await params;
  try {
    await removeAllowedEmail(decodeURIComponent(targetEmail));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
