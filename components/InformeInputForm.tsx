"use client";

type Props = {
  textoLibre: string;
  onTextoLibreChange: (texto: string) => void;
  file: File | null;
  onFileChange: (file: File | null) => void;
  disabled?: boolean;
};

export function InformeInputForm({ textoLibre, onTextoLibreChange, file, onFileChange, disabled }: Props) {
  const textoDisabled = disabled || file !== null;
  const fileDisabled = disabled || textoLibre.trim().length > 0;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="font-medium block">Texto libre</label>
        <textarea
          value={textoLibre}
          onChange={(e) => onTextoLibreChange(e.target.value)}
          disabled={textoDisabled}
          rows={5}
          placeholder="Describe la tarea o intención..."
          className="w-full border border-gray-300 rounded px-2 py-1 disabled:bg-gray-100 disabled:text-gray-400"
        />
      </div>

      <div className="space-y-2">
        <label className="font-medium block">PDF</label>
        <input
          type="file"
          accept="application/pdf"
          onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
          disabled={fileDisabled}
          className="block text-sm disabled:opacity-40"
        />
        <p className="text-sm text-gray-500">
          El PDF debe ser el informe generado por startup-advisor. Si no dispones de uno, usa la opción de texto
          libre en su lugar.
        </p>
      </div>
    </div>
  );
}
