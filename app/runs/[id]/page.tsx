"use client";

import { use, useEffect, useState } from "react";
import { AccionNextCard } from "@/components/AccionNextCard";
import { InformeFinalView } from "@/components/InformeFinalView";
import { NoRespuestaView } from "@/components/NoRespuestaView";
import type { Run } from "@/lib/types";

const POLL_INTERVAL_MS = 3000;

export default function RunStatusPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [respuesta, setRespuesta] = useState("");
  const [respondiendo, setRespondiendo] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(`/api/runs/${id}`, { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        if (!cancelled) setRun(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    }

    poll();
    const interval = setInterval(() => {
      // Dejar de pollear una vez que el run llegó a un estado terminal.
      if (run && !["draft", "running", "needs_clarification"].includes(run.status)) return;
      poll();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, run?.status]);

  async function handleRespond(e: React.FormEvent) {
    e.preventDefault();
    if (!respuesta.trim()) return;
    setRespondiendo(true);
    try {
      const res = await fetch(`/api/runs/${id}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ respuesta }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setRun(data);
      setRespuesta("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRespondiendo(false);
    }
  }

  if (error) {
    return (
      <main className="max-w-2xl mx-auto p-6">
        <p className="text-red-600">{error}</p>
      </main>
    );
  }

  if (!run) {
    return (
      <main className="max-w-2xl mx-auto p-6">
        <p className="text-gray-500">Cargando...</p>
      </main>
    );
  }

  return (
    <main className="max-w-2xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Run {run.run_id}</h1>
        <span className="text-sm px-2 py-1 rounded bg-gray-100 border border-gray-300">{run.status}</span>
      </div>

      {run.accion_next && (
        <AccionNextCard accionNext={run.accion_next} cycle={run.cycle} maxCycles={run.max_cycles} />
      )}

      {run.status === "needs_clarification" && (
        <form onSubmit={handleRespond} className="border border-blue-300 rounded p-4 space-y-2">
          <p className="font-medium">{run.pregunta}</p>
          <textarea
            value={respuesta}
            onChange={(e) => setRespuesta(e.target.value)}
            rows={3}
            className="w-full border border-gray-300 rounded px-2 py-1"
            placeholder="Tu respuesta..."
          />
          <button
            type="submit"
            disabled={respondiendo || !respuesta.trim()}
            className="px-4 py-2 rounded bg-black text-white disabled:opacity-40"
          >
            {respondiendo ? "Enviando..." : "Responder"}
          </button>
        </form>
      )}

      {run.status === "approved" && run.informe_final && <InformeFinalView informeFinal={run.informe_final} />}

      {(run.status === "max_cycles_reached" ||
        run.status === "sin_especialista" ||
        run.status === "peticion_incoherente") &&
        run.no_respuesta && <NoRespuestaView noRespuesta={run.no_respuesta} />}

      {run.status === "max_cycles_reached" && run.informe_final && (
        <InformeFinalView informeFinal={run.informe_final} />
      )}

      {run.status === "failed" && (
        <div className="border border-red-300 rounded p-4 text-red-700 text-sm">
          El run falló. Revisa los logs de startup-next para más detalle.
        </div>
      )}
    </main>
  );
}
