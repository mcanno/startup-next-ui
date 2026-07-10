"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type AllowedEmail = { id: string; email: string; createdAt: string };

// La lista inicial llega como prop desde el server component (app/admin/page.tsx),
// no se pide de nuevo al montar -- sin useEffect + fetch en mount, router.refresh()
// re-corre el server component y trae datos frescos después de agregar/quitar.
export function AllowedEmailsManager({ initialEmails }: { initialEmails: AllowedEmail[] }) {
  const router = useRouter();
  const [newEmail, setNewEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newEmail.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/allowed-emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: newEmail.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setNewEmail("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(email: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/allowed-emails/${encodeURIComponent(email)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleAdd} className="flex gap-2">
        <input
          type="email"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          placeholder="nuevo@email.com"
          className="flex-1 border border-gray-300 rounded px-2 py-1"
        />
        <button
          type="submit"
          disabled={busy || !newEmail.trim()}
          className="px-4 py-1 rounded bg-black text-white disabled:opacity-40"
        >
          Agregar
        </button>
      </form>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      {initialEmails.length === 0 && <p className="text-gray-500 text-sm">No hay emails permitidos todavía.</p>}

      {initialEmails.length > 0 && (
        <ul className="divide-y divide-gray-200 border border-gray-200 rounded">
          {initialEmails.map((e) => (
            <li key={e.id} className="flex items-center justify-between px-3 py-2">
              <span className="text-sm">{e.email}</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => handleRemove(e.email)}
                className="text-sm text-red-600 hover:underline disabled:opacity-40"
              >
                quitar
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
