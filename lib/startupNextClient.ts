// Cliente hacia startup-next — solo se usa desde las API routes (server-side
// de este mismo Next.js), nunca desde el navegador: las API keys viven acá,
// no se exponen al cliente.

import "server-only";
import type { ComentarioAsesor, OpcionPropuesta, Run } from "./types";

function getBaseUrl(): string {
  const baseUrl = process.env.STARTUP_NEXT_URL;
  if (!baseUrl) throw new Error("STARTUP_NEXT_URL is not set");
  return baseUrl;
}

function getAppApiKey(): string {
  const apiKey = process.env.API_KEY_APP;
  if (!apiKey) throw new Error("API_KEY_APP is not set");
  return apiKey;
}

// Solo para /admin/allowed-emails (no /check) — API_KEY_APP no sirve ahí,
// startup-next rechaza con 401 (sección 9: keys separadas a propósito).
function getAdminApiKey(): string {
  const apiKey = process.env.API_KEY_ADMIN;
  if (!apiKey) throw new Error("API_KEY_ADMIN is not set");
  return apiKey;
}

async function request<T>(path: string, apiKey: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${getBaseUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      // Content-Type solo si hay body Y no es FormData: startup-next
      // (Fastify) rechaza con FST_ERR_CTP_EMPTY_JSON_BODY un POST sin
      // cuerpo si el header dice application/json (/runs/{id}/start no
      // manda body). Para FormData (PDF de informes/parse), fetch tiene
      // que fijar su propio Content-Type con el boundary del multipart —
      // forzar application/json ahí mandaría el archivo mal etiquetado.
      ...(init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`startup-next ${path} -> ${res.status}: ${body}`);
  }
  // DELETE /admin/allowed-emails/{email} devuelve 204 sin body.
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export async function createRun(input: {
  startupId: string;
  opciones: OpcionPropuesta[];
  comentarioAsesor?: ComentarioAsesor;
}): Promise<{ run_id: string; status: string }> {
  return request("/runs", getAppApiKey(), {
    method: "POST",
    body: JSON.stringify({
      startup_id: input.startupId,
      informe_situacion_ref: {
        report_id: crypto.randomUUID(),
        source: "startup-next-ui",
        opciones_propuestas: input.opciones,
      },
      comentario_asesor: input.comentarioAsesor,
      requested_by: "app",
    }),
  });
}

export async function startRun(runId: string): Promise<Run> {
  return request(`/runs/${runId}/start`, getAppApiKey(), { method: "POST" });
}

export async function getRun(runId: string): Promise<Run> {
  return request(`/runs/${runId}`, getAppApiKey(), { method: "GET" });
}

export async function respondToRun(runId: string, respuesta: string): Promise<Run> {
  return request(`/runs/${runId}/respond`, getAppApiKey(), {
    method: "POST",
    body: JSON.stringify({ respuesta }),
  });
}

type InformeParseResponse = { opciones_propuestas: OpcionPropuesta[]; startup_id: string };

export async function parseInformePdf(file: Blob, filename: string): Promise<InformeParseResponse> {
  const form = new FormData();
  form.append("file", file, filename);
  return request("/informes/parse", getAppApiKey(), { method: "POST", body: form });
}

export async function parseInformeTexto(textoLibre: string): Promise<InformeParseResponse> {
  return request("/informes/parse", getAppApiKey(), {
    method: "POST",
    body: JSON.stringify({ texto_libre: textoLibre }),
  });
}

export async function checkAllowedEmail(email: string): Promise<boolean> {
  const data = await request<{ allowed: boolean }>(
    `/admin/allowed-emails/check?email=${encodeURIComponent(email)}`,
    getAppApiKey(),
  );
  return data.allowed;
}

export type AllowedEmail = { id: string; email: string; createdAt: string };

export async function listAllowedEmails(): Promise<AllowedEmail[]> {
  const data = await request<{ emails: AllowedEmail[] }>("/admin/allowed-emails", getAdminApiKey());
  return data.emails;
}

export async function addAllowedEmail(email: string): Promise<void> {
  await request("/admin/allowed-emails", getAdminApiKey(), {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export async function removeAllowedEmail(email: string): Promise<void> {
  await request(`/admin/allowed-emails/${encodeURIComponent(email)}`, getAdminApiKey(), { method: "DELETE" });
}
