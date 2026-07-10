"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AdminLink } from "@/components/AdminLink";
import { InformeInputForm } from "@/components/InformeInputForm";
import { OpcionesPropuestasView } from "@/components/OpcionesPropuestasView";
import type { OpcionPropuesta } from "@/lib/types";

type Paso = "metodo" | "revision";

export default function HomePage() {
  const router = useRouter();
  const [paso, setPaso] = useState<Paso>("metodo");
  const [startupId, setStartupId] = useState("");
  const [opciones, setOpciones] = useState<OpcionPropuesta[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = startupId.trim().length > 0 && opciones.length > 0 && !submitting;

  function handleOpciones(nuevasOpciones: OpcionPropuesta[]) {
    setOpciones(nuevasOpciones);
    setPaso("revision");
  }

  function handleUsarOtroInforme() {
    setOpciones([]);
    setPaso("metodo");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startup_id: startupId.trim(),
          opciones_propuestas: opciones,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      router.push(`/runs/${data.run_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <main className="max-w-2xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Nuevo run — startup-next</h1>
        <AdminLink />
      </div>

      {paso === "metodo" && <InformeInputForm onOpciones={handleOpciones} />}

      {paso === "revision" && (
        <form onSubmit={handleSubmit} className="space-y-6">
          <OpcionesPropuestasView opciones={opciones} />
          <button type="button" onClick={handleUsarOtroInforme} className="text-sm text-gray-600 hover:underline">
            usar otro informe
          </button>

          <div className="space-y-2">
            <label className="font-medium block">startup_id (UUID)</label>
            <input
              type="text"
              value={startupId}
              onChange={(e) => setStartupId(e.target.value)}
              placeholder="e9f55b30-f9a7-47ab-a4e3-41971751a613"
              className="w-full border border-gray-300 rounded px-2 py-1 font-mono text-sm"
            />
          </div>

          {error && <p className="text-red-600 text-sm">{error}</p>}

          <button
            type="submit"
            disabled={!canSubmit}
            className="px-4 py-2 rounded bg-black text-white disabled:opacity-40"
          >
            {submitting ? "Iniciando..." : "Iniciar"}
          </button>
        </form>
      )}
    </main>
  );
}
