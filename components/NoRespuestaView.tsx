import { formatHallazgo } from "@/lib/hallazgos";
import type { NoRespuesta } from "@/lib/types";

const TIPO_LABEL: Record<NoRespuesta["tipo"], string> = {
  sin_especialista: "especialista no disponible",
  ontologia: "ontología",
  peticion_incoherente: "petición incoherente",
};

export function NoRespuestaView({ noRespuesta }: { noRespuesta: NoRespuesta }) {
  return (
    <div className="border border-gray-300 rounded p-4 space-y-2">
      <h2 className="font-medium">Sin respuesta ({TIPO_LABEL[noRespuesta.tipo]})</h2>
      <p className="text-sm text-gray-700">{noRespuesta.motivo_principal}</p>
      {noRespuesta.especialista_faltante && (
        <p className="text-sm text-gray-600">
          especialista faltante: <strong>{noRespuesta.especialista_faltante}</strong>
        </p>
      )}
      <p className="text-sm text-gray-600">ciclos intentados: {noRespuesta.ciclos_intentados}</p>

      {noRespuesta.hallazgos_ontologia.length > 0 && (
        <div className="text-sm pt-2">
          <p className="text-gray-600">Hallazgos de la ontología:</p>
          <ul className="list-disc list-inside">
            {noRespuesta.hallazgos_ontologia.map((h) => (
              <li key={h.rule_id}>{formatHallazgo(h)}</li>
            ))}
          </ul>
        </div>
      )}

      {noRespuesta.otros_motivos && noRespuesta.otros_motivos.length > 0 && (
        <div className="text-sm pt-2">
          <p className="text-gray-600">Otros motivos:</p>
          <ul className="list-disc list-inside">
            {noRespuesta.otros_motivos.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
