import type { OpcionPropuesta } from "@/lib/types";

export function OpcionesPropuestasView({ opciones }: { opciones: OpcionPropuesta[] }) {
  return (
    <div className="space-y-3">
      <label className="font-medium block">Opciones propuestas</label>
      {opciones.map((opcion) => (
        <div key={opcion.id} className="border border-gray-300 rounded p-3 space-y-1">
          <p className="font-semibold">{opcion.titulo}</p>
          <p className="text-sm text-gray-700">{opcion.resumen}</p>
        </div>
      ))}
    </div>
  );
}
