"use client";

import { useState } from "react";
import type { OpcionPropuesta } from "@/lib/types";

type Metodo = "pdf" | "texto";

export function InformeInputForm({ onOpciones }: { onOpciones: (opciones: OpcionPropuesta[]) => void }) {
  const [metodo, setMetodo] = useState<Metodo>("pdf");
  const [file, setFile] = useState<File | null>(null);
  const [textoLibre, setTextoLibre] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = metodo === "pdf" ? file !== null : textoLibre.trim().length > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      let res: Response;
      if (metodo === "pdf" && file) {
        const form = new FormData();
        form.append("file", file);
        res = await fetch("/api/informes/parse", { method: "POST", body: form });
      } else {
        res = await fetch("/api/informes/parse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ texto_libre: textoLibre }),
        });
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      onOpciones(data.opciones_propuestas);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-1">
          <input type="radio" checked={metodo === "pdf"} onChange={() => setMetodo("pdf")} />
          Subir PDF
        </label>
        <label className="flex items-center gap-1">
          <input type="radio" checked={metodo === "texto"} onChange={() => setMetodo("texto")} />
          Escribir texto libre
        </label>
      </div>

      {metodo === "pdf" ? (
        <input
          type="file"
          accept="application/pdf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block text-sm"
        />
      ) : (
        <textarea
          value={textoLibre}
          onChange={(e) => setTextoLibre(e.target.value)}
          rows={5}
          placeholder="Describí la tarea o intención..."
          className="w-full border border-gray-300 rounded px-2 py-1"
        />
      )}

      {error && <p className="text-red-600 text-sm">{error}</p>}

      <button
        type="submit"
        disabled={!canSubmit || loading}
        className="px-4 py-2 rounded bg-black text-white disabled:opacity-40"
      >
        {loading ? "Extrayendo..." : "Extraer opciones"}
      </button>
    </form>
  );
}
