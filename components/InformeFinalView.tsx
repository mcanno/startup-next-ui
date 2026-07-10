import type { InformeFinal } from "@/lib/types";

// Sección 9: el informe final se centra en dos componentes con propósitos
// distintos — recomendaciones (qué hacer) y hallazgos_ontologia (en qué
// estado debería estar la startup para que esa acción tenga sentido). Se
// muestran como dos secciones separadas, con su propio título, no
// mezcladas ni una como nota al pie de la otra.
export function InformeFinalView({ informeFinal }: { informeFinal: InformeFinal }) {
  return (
    <div className="space-y-6">
      <h2 className="font-medium text-lg">
        Informe final — {informeFinal.aprobado ? "aprobado" : "no aprobado"}
      </h2>

      <div className="space-y-3">
        <h3 className="font-medium text-sm uppercase tracking-wide text-gray-500">Qué hacer</h3>
        {informeFinal.recomendaciones.map((r, i) => (
          <div key={i} className="border border-gray-300 rounded p-4 space-y-2">
            <p className="font-semibold">{r.titulo}</p>
            <p className="text-sm text-gray-700">{r.detalle}</p>
            {r.fuentes.length > 0 && (
              <ul className="text-xs text-gray-500 list-disc list-inside">
                {r.fuentes.map((f, j) => (
                  <li key={j}>{f}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      {informeFinal.consideraciones_metodologicas.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-medium text-sm uppercase tracking-wide text-gray-500">
            En qué estado debería estar tu startup
          </h3>
          <div className="border border-amber-300 bg-amber-50 rounded p-4">
            <ul className="text-sm text-gray-700 list-disc list-inside space-y-1">
              {informeFinal.consideraciones_metodologicas.map((h) => (
                <li key={h.rule_id}>
                  <strong>{h.rule_id}</strong>: {h.hallazgos}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
