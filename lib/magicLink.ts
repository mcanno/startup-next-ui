// Login liviano por magic link (sección 9 del diseño de startup-next):
// sin base de datos — el link y la sesión son JWT autoverificables
// (jose), firmados con un secreto server-side. `purpose` distingue un
// token de link (corta vida, un solo propósito: canjearse por sesión) de
// un token de sesión (vida más larga) — sin esto, un link interceptado
// podría reusarse directamente como sesión, dándole más vida útil de la
// que un magic link de 15 minutos debería tener.

import "server-only";
import { SignJWT, jwtVerify } from "jose";

const LINK_TOKEN_TTL = "15m";
const SESSION_TOKEN_TTL = "30d";

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  return new TextEncoder().encode(secret);
}

export async function signLinkToken(email: string): Promise<string> {
  return new SignJWT({ email, purpose: "magic-link" })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(LINK_TOKEN_TTL)
    .sign(getSecret());
}

export async function verifyLinkToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (payload.purpose !== "magic-link" || typeof payload.email !== "string") return null;
    return payload.email;
  } catch {
    return null;
  }
}

export async function signSessionToken(email: string): Promise<string> {
  return new SignJWT({ email, purpose: "session" })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(SESSION_TOKEN_TTL)
    .sign(getSecret());
}

export async function verifySessionToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (payload.purpose !== "session" || typeof payload.email !== "string") return null;
    return payload.email;
  } catch {
    return null;
  }
}
