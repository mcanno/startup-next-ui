// Recreado a mano desde el contrato de startup-next (src/schemas.ts,
// diseno_startup_next.md secciones 1-2). Sin paquete compartido entre los
// dos repos por decisión explícita — el contrato ya está congelado, la
// duplicación es aceptable.

export type OpcionPropuesta = {
  id: string;
  titulo: string;
  resumen: string;
};

export type ComentarioAsesor = {
  texto: string;
  autor?: string;
  aplica_a?: string[];
  tags?: string[];
};

export type EspecialistaRole =
  | "ideacion"
  | "mvp"
  | "financiacion"
  | "modelo_negocio"
  | "escalado"
  | "organizacion"
  | "administracion";

export type HallazgoOntologia = {
  rule_id: string;
  hallazgos: string;
};

export type ConflictoComentarioAsesor =
  | { detectado: false }
  | { detectado: true; rule_id: string; descripcion: string };

export type AccionNext = {
  id: string;
  titulo: string;
  descripcion: string;
  justificacion: string;
  opciones_descartadas: string[];
  validado_contra_ontologia: boolean;
  hallazgos_ontologia: HallazgoOntologia[];
  conflicto_comentario_asesor: ConflictoComentarioAsesor;
  especialista_requerido: EspecialistaRole;
  especialista_disponible: boolean;
  resuelto_sin_aclaracion_completa?: boolean;
};

export type RunStatus =
  | "draft"
  | "needs_clarification"
  | "running"
  | "approved"
  | "max_cycles_reached"
  | "sin_especialista"
  | "peticion_incoherente"
  | "failed";

export type Recomendacion = {
  titulo: string;
  detalle: string;
  fuentes: string[];
};

export type InformeFinal = {
  recomendaciones: Recomendacion[];
  consideraciones_metodologicas: HallazgoOntologia[];
  aprobado: boolean;
};

export type NoRespuesta = {
  tipo: "ontologia" | "sin_especialista" | "peticion_incoherente";
  especialista_faltante?: string;
  motivo_principal: string;
  hallazgos_ontologia: HallazgoOntologia[];
  otros_motivos?: string[];
  ciclos_intentados: number;
};

// Forma que devuelve GET/POST /runs/{id} de startup-next (src/routes/runs.ts
// serializeRun) — no el modelo de tabla completo, solo el contrato público.
export type Run = {
  run_id: string;
  startup_id: string;
  status: RunStatus;
  accion_next?: AccionNext;
  cycle: number;
  max_cycles: number;
  especialista_usado?: string;
  informe_final: InformeFinal | null;
  no_respuesta: NoRespuesta | null;
  created_at: string;
  updated_at: string;
  pregunta?: string;
};

export type CreateRunInput = {
  startup_id: string;
  opciones_propuestas: OpcionPropuesta[];
  comentario_asesor?: ComentarioAsesor;
};
