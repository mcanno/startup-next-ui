import { renderToBuffer } from "@react-pdf/renderer";
import { InformePdf } from "@/components/informe-pdf";
import { getRun } from "@/lib/startupNextClient";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  try {
    const run = await getRun(id);
    if (!run.informe_final) {
      return Response.json({ error: "este run todavía no tiene informe_final" }, { status: 409 });
    }

    const pdfBuffer = await renderToBuffer(InformePdf({ informeFinal: run.informe_final }));

    return new Response(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="informe-${id}.pdf"`,
      },
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
