import { NextResponse } from "next/server";
import { respondToRun } from "@/lib/startupNextClient";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json()) as { respuesta?: string };

  if (!body.respuesta?.trim()) {
    return NextResponse.json({ error: "respuesta es obligatoria" }, { status: 400 });
  }

  try {
    const run = await respondToRun(id, body.respuesta);
    return NextResponse.json(run);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
