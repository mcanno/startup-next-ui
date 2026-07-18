// Formateo compartido de HallazgoOntologia para los 4 puntos donde se
// renderiza (AccionNextCard, InformeFinalView, NoRespuestaView,
// informe-pdf) — antes cada uno hacía `{h.rule_id}: {h.hallazgos}` por su
// cuenta, mostrando el rule_id técnico crudo (ej. "PREREQUISITO_GENERICO:")
// delante de un texto que, para ese caso puntual, ya trae su propio
// encuadre en lenguaje natural (ver orchestratorModoBase.ts en startup-next).
import type { HallazgoOntologia } from "./types";

export function formatHallazgo(h: HallazgoOntologia): string {
  return h.rule_id === "PREREQUISITO_GENERICO" ? h.hallazgos : `${h.rule_id}: ${h.hallazgos}`;
}
