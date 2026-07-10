import { NextResponse } from "next/server";
import { parseInformePdf, parseInformeTexto } from "@/lib/startupNextClient";

export async function POST(req: Request) {
  const contentType = req.headers.get("content-type") ?? "";

  try {
    if (contentType.startsWith("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "no se recibió ningún archivo" }, { status: 400 });
      }
      const result = await parseInformePdf(file, file.name);
      return NextResponse.json(result);
    }

    const body = (await req.json()) as { texto_libre?: string };
    if (!body.texto_libre?.trim()) {
      return NextResponse.json({ error: "texto_libre es obligatorio" }, { status: 400 });
    }
    const result = await parseInformeTexto(body.texto_libre);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
