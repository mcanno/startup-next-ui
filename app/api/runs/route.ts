import { NextResponse } from "next/server";
import { createRun, startRun } from "@/lib/startupNextClient";
import type { CreateRunInput } from "@/lib/types";

// Bundlea POST /runs + POST /runs/{id}/start de startup-next en un solo
// paso — el formulario de esta UI junta todo antes del submit, no hay
// flujo de "guardar borrador" en v1. Si hace falta ese flujo más adelante,
// separar en dos rutas es cambio de bajo costo.
export async function POST(req: Request) {
  const body = (await req.json()) as CreateRunInput;

  if (!body.startup_id || !body.opciones_propuestas?.length) {
    return NextResponse.json({ error: "startup_id y opciones_propuestas son obligatorios" }, { status: 400 });
  }

  try {
    const created = await createRun({
      startupId: body.startup_id,
      opciones: body.opciones_propuestas,
      comentarioAsesor: body.comentario_asesor,
    });
    const started = await startRun(created.run_id);
    return NextResponse.json(started, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
