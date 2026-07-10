import type { AccionNext } from "@/lib/types";

export function AccionNextCard({ accionNext, cycle, maxCycles }: { accionNext: AccionNext; cycle: number; maxCycles: number }) {
  return (
    <div className="border border-gray-300 rounded p-4 space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Acción priorizada</h2>
        <span className="text-sm text-gray-500">
          ciclo {cycle} / {maxCycles}
        </span>
      </div>
      <p className="font-semibold">{accionNext.titulo}</p>
      <p className="text-sm text-gray-700">{accionNext.descripcion}</p>
      <p className="text-sm text-gray-600 italic">{accionNext.justificacion}</p>

      <div className="text-sm flex flex-wrap gap-x-4 gap-y-1 pt-2">
        <span>
          especialista: <strong>{accionNext.especialista_requerido}</strong>{" "}
          {accionNext.especialista_disponible ? "(disponible)" : "(no disponible)"}
        </span>
      </div>

      {accionNext.conflicto_comentario_asesor.detectado && (
        <div className="text-sm bg-yellow-50 border border-yellow-300 rounded p-2 mt-2">
          <strong>Conflicto con el comentario del asesor</strong> ({accionNext.conflicto_comentario_asesor.rule_id}):{" "}
          {accionNext.conflicto_comentario_asesor.descripcion}
        </div>
      )}

      {accionNext.hallazgos_ontologia.length > 0 && (
        <div className="text-sm pt-2">
          <p className="text-gray-600">Hallazgos de la ontología:</p>
          <ul className="list-disc list-inside">
            {accionNext.hallazgos_ontologia.map((h) => (
              <li key={h.rule_id}>
                <strong>{h.rule_id}</strong>: {h.hallazgos}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
