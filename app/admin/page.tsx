import { AllowedEmailsManager } from "@/components/AllowedEmailsManager";
import { getSessionEmail, isSuperadminEmail } from "@/lib/session";
import { listAllowedEmails } from "@/lib/startupNextClient";

export default async function AdminPage() {
  const email = await getSessionEmail();

  if (!isSuperadminEmail(email)) {
    return (
      <main className="max-w-2xl mx-auto p-6">
        <p className="text-red-600">No autorizado.</p>
      </main>
    );
  }

  const emails = await listAllowedEmails();

  return (
    <main className="max-w-2xl mx-auto p-6 space-y-6">
      <h1 className="text-xl font-semibold">Administrar accesos</h1>
      <AllowedEmailsManager initialEmails={emails} />
    </main>
  );
}
