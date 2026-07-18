"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

function LoginForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(
    searchParams.get("error") ? "El enlace expiró o no es válido — pide uno nuevo." : null,
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/request-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      setMessage(data.message ?? "Si tu email está autorizado, te va a llegar un enlace en unos minutos.");
    } catch {
      setMessage("Hubo un error de red. Prueba de nuevo.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="max-w-sm mx-auto p-6 space-y-6">
      <h1 className="text-xl font-semibold">Ingresar — startup-next</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="tu@email.com"
          className="w-full border border-gray-300 rounded px-2 py-1"
        />
        <button
          type="submit"
          disabled={submitting}
          className="px-4 py-2 rounded bg-black text-white disabled:opacity-40"
        >
          {submitting ? "Enviando..." : "Enviarme un enlace"}
        </button>
      </form>
      {message && <p className="text-sm text-gray-700">{message}</p>}
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
