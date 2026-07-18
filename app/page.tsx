"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AdminLink } from "@/components/AdminLink";
import { InformeInputForm } from "@/components/InformeInputForm";

export default function HomePage() {
  const router = useRouter();
  const [textoLibre, setTextoLibre] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = (textoLibre.trim().length > 0 || file !== null) && !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      let parseRes: Response;
      if (file) {
        const form = new FormData();
        form.append("file", file);
        parseRes = await fetch("/api/informes/parse", { method: "POST", body: form });
      } else {
        parseRes = await fetch("/api/informes/parse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ texto_libre: textoLibre }),
        });
      }
      const parseData = await parseRes.json();
      if (!parseRes.ok) throw new Error(parseData.error ?? `HTTP ${parseRes.status}`);

      const runRes = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startup_id: parseData.startup_id,
          opciones_propuestas: parseData.opciones_propuestas,
        }),
      });
      const runData = await runRes.json();
      if (!runRes.ok) throw new Error(runData.error ?? `HTTP ${runRes.status}`);

      router.push(`/runs/${runData.run_id}`);
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

      <form onSubmit={handleSubmit} className="space-y-6">
        <InformeInputForm
          textoLibre={textoLibre}
          onTextoLibreChange={setTextoLibre}
          file={file}
          onFileChange={setFile}
          disabled={submitting}
        />

        {error && <p className="text-red-600 text-sm">{error}</p>}

        <button
          type="submit"
          disabled={!canSubmit}
          className="px-4 py-2 rounded bg-black text-white disabled:opacity-40"
        >
          {submitting ? "Iniciando..." : "Iniciar"}
        </button>
      </form>
    </main>
  );
}
