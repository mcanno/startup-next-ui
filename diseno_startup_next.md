# Diseño propuesto: Startup-Next

> Borrador de trabajo. Responde a las 6 preguntas abiertas del documento de
> traspaso. Todo aquí es propuesta, no decisión cerrada — pensado para
> discutir y ajustar antes de empezar a construir.

> ⚠️ **Aviso de lectura**: las secciones 1-7 documentan el diseño y la
> implementación de los Hitos 1-3. **La sección 8** (al final) introduce
> un cambio de fondo, ya implementado y cerrado por completo: la
> separación real entre `startup-advisor` y `startup-next` (bases de
> datos físicamente aisladas) y un modo genérico de consulta a la
> ontología que no depende de hechos reales de ninguna startup. Con esto,
> lo que la sección 7 documenta como validación real contra la ontología
> (`hallazgos_ontologia` con hechos de una startup concreta) pasó a ser
> la **capa opcional enriquecida** (activada por detección automática),
> no la base — el modo base (genérico, `PREREQUISITO_GENERICO`) es el
> comportamiento por defecto real desde la sección 8. Leer la sección 8
> para el estado actual; 1-7 quedan como registro histórico y referencia
> de contratos de API/esquema/arquitectura de agentes, no como el
> comportamiento vigente sin más.

---

## 1. Contrato de entrada/salida

El flujo que describiste tiene dos pasos separados de cara a quien invoca
(app o Hermes), no una única llamada: primero se fija el contexto de
entrada (informe + comentario opcional), y solo entonces se dispara el
pipeline. Se traduce en dos endpoints:

### Paso 1 — crear el run con su contexto

`POST /runs`

```json
{
  "startup_id": "uuid",
  "informe_situacion_ref": {
    "report_id": "uuid",
    "source": "startup-advisor",
    "opciones_propuestas": [
      { "id": "opt_1", "titulo": "string", "resumen": "string" },
      { "id": "opt_2", "titulo": "string", "resumen": "string" }
    ]
  },
  "comentario_asesor": {
    "texto": "string libre, opcional",
    "autor": "string opcional (nombre del asesor)",
    "aplica_a": ["opt_1"]
  },
  "requested_by": "app | hermes",
  "callback_url": "string, opcional — webhook, payload fino {run_id, status}"
}
```

- **`opciones_propuestas` llega siempre como campo estructurado desde
  `startup-advisor`**, no texto libre a interpretar. Startup-Next puede
  asumir esa forma sin necesidad de parser ni fallback — es
  responsabilidad de `startup-advisor` garantizar que `ReportContent`
  entregue el array con `id`/`titulo`/`resumen` por opción. Si hoy ese
  campo todavía no existe en `ReportContent`, es trabajo previo en ese
  repo antes de integrar, pero el contrato ya queda fijado: Startup-Next
  no debe construir lógica para interpretar informes con opciones en
  prosa libre.
- **`informe_situacion_ref` es preceptivo, no opcional.** Ambos
  invocadores (app y asistente tipo Hermes/OpenClaw) deben referenciar
  siempre un informe generado por `startup-advisor` — `POST /runs` debe
  rechazar (400) cualquier request sin este campo. Lo único opcional es
  `comentario_asesor`: el fundador puede pedir "qué hago ahora" sin que
  haya opinión de un asesor humano, pero nunca sin informe de base.
- `aplica_a` en el comentario del asesor identifica sobre qué opción(es)
  opina. Puede ser una sola, varias, o venir vacío/ausente si el asesor
  opina en general sin referirse a una opción concreta — el orquestador
  debe poder interpretar los tres casos.

Esta llamada **no dispara el pipeline todavía** — solo dis a `next_action_runs`
en estado `draft`. Es el punto de corte que corresponde a "adjuntas el
informe, opcionalmente añades la opinión del asesor" antes de pedirle al
sistema que actúe.

Respuesta:

```json
{ "run_id": "uuid", "status": "draft" }
```

### Paso 2 — invocar al orquestador (llamada única)

`POST /runs/{run_id}/start`

Aunque la API mantiene los dos pasos (crear contexto, luego arrancar), el
trabajo de **resolver cuál es la acción prioritaria es una sola invocación**
al agente orquestador — no una llamada por cada opción del informe. El
orquestador recibe de una vez: todas las `opciones_propuestas`, el
`comentario_asesor` completo (con su `aplica_a`), y consulta el estado
actual de la startup en el ontology-engine (`GET /startups/{id}/graph` y/o
`validate()`) para tener contexto de qué hipótesis/experimentos/métricas ya
están registrados. Con eso decide, en un solo turno de razonamiento, cuál
de las opciones es la prioritaria — sopesando la opinión del asesor y el
estado metodológico real, no solo el texto del informe.

El resultado de ese razonamiento es una **acción-next final**, deliberadamente
concisa y sin ambigüedad, para que el especialista no tenga que
reinterpretar nada:

```json
"accion_next": {
  "id": "opt_2",
  "titulo": "string corto",
  "descripcion": "1-2 frases, sin ambigüedad, foco en la tarea a resolver",
  "justificacion": "por qué se priorizó esta y no las otras, citando comentario del asesor y/o estado de la ontología",
  "opciones_descartadas": ["opt_1", "opt_3"],
  "validado_contra_ontologia": true,
  "hallazgos_ontologia": [ { "rule_id": "string", "hallazgos": "string" } ],
  "conflicto_comentario_asesor": { "detectado": false }
}
```

`validado_contra_ontologia` es lo que pediste explícitamente: antes de
enrutar al especialista, el orquestador comprueba que la acción elegida
tiene sentido dado el estado ya registrado (por ejemplo, no tiene sentido
priorizar "buscar financiación" si `R1_hipotesis_sin_experimento` está
activa sobre la hipótesis central — el orquestador puede señalarlo en
`hallazgos_ontologia` y ajustar la prioridad en consecuencia). El mismo
chequeo se aplica al comentario del asesor cuando existe — ver detalle en
la sección 5, "la ontología es una restricción dura sobre el comentario".

**Caso borde: ninguna opción supera la validación de la ontología.** No
hace falta una rama especial para esto — el orquestador enruta igual la
opción menos conflictiva (`validado_contra_ontologia: false`,
`hallazgos_ontologia` poblado), y es el mismo mecanismo de 3 ciclos
especialista↔validador el que decide si, aun así, se puede construir una
respuesta razonable dado ese conflicto, o si termina en
`max_cycles_reached` con la `no_respuesta` argumentada (ver sección 2). No
se necesita un estado nuevo para esto: el conflicto ya viaja en
`accion_next` desde el principio y el validador lo vuelve a chequear en
cada ciclo vía `coherencia_ontologia`.

**Bucle de aclaración (opcional, máximo 2 preguntas).** Si el orquestador
no puede resolver una prioridad clara (opciones empatadas, comentario del
asesor ambiguo o contradictorio), en vez de forzar una elección puede
pausar y preguntarle al fundador/Hermes — hasta 2 veces. Esto se modela
como un estado intermedio:

`GET /runs/{run_id}` puede devolver:

```json
{ "status": "needs_clarification", "pregunta": "string" }
```

y el cliente responde con:

`POST /runs/{run_id}/respond`
```json
{ "respuesta": "string libre" }
```

lo que reinvoca al orquestador con la respuesta añadida al contexto. Este
intercambio puede repetirse **hasta 2 veces** — al llegar a la segunda
respuesta sin una prioridad clara, el orquestador ya no vuelve a preguntar:
decide con lo que tiene, marcando `accion_next.resuelto_sin_aclaracion_completa:
true` para que quede explícito que la elección se hizo sin ambigüedad
totalmente resuelta. Este límite **no consume ciclos** del contador de
`max_cycles` — ese contador es exclusivamente para el ciclo
orquestador→especialista→validador que viene después. Una vez el
orquestador tiene una `accion_next` clara (o forzada tras las 2 preguntas)
y validada contra la ontología, recién ahí arranca el primer ciclo real.

Respuesta inmediata cuando no hace falta aclaración (202, no bloqueante):

```json
{
  "run_id": "uuid",
  "status": "running",
  "accion_next": { "...": "..." },
  "cycle": 1,
  "max_cycles": 3
}
```

> **Nota de implementación (Hito 2 → resuelto y verificado en vivo).** La
> primera versión del grafo corría síncrona de punta a punta (20-26s
> bloqueado con el especialista mock). Corregido con el mecanismo de
> streaming + iterador manual descrito en la sección 7: `POST
> /runs/{id}/start` ahora devuelve control apenas se resuelve `accion_next`
> — verificado en 14s (`cycle: 0` en la respuesta, confirmando que se
> soltó antes del primer ciclo), con el resto de los ciclos corriendo en
> background y `GET /runs/{id}` reflejando el progreso hasta el estado
> terminal.

Separar creación de arranque tiene una ventaja práctica: si el fundador
adjunta el informe, lo piensa, y añade el comentario del asesor un rato
después (no en el mismo instante), el estado ya vive en el servidor —
ningún cliente tiene que retener ese contexto localmente entre los dos
pasos.

### Consulta de resultado (salida)

`GET /runs/{run_id}`

```json
{
  "run_id": "uuid",
  "startup_id": "uuid",
  "status": "draft | needs_clarification | running | approved | max_cycles_reached | sin_especialista | failed",
  "pregunta": "string, solo si status = needs_clarification",
  "accion_next": { "id": "opt_2", "titulo": "string", "descripcion": "string" },
  "cycle": 2,
  "max_cycles": 3,
  "especialista_usado": "mvp | financiacion | modelo_negocio | ideacion | escalado | organizacion | administracion",
  "informe_final": {
    "recomendaciones": [ { "titulo": "string", "detalle": "string", "fuentes": ["string"] } ],
    "consideraciones_metodologicas": [ { "rule_id": "string", "hallazgos": "string" } ]
  },
  "no_respuesta": {
    "tipo": "ontologia | sin_especialista | peticion_incoherente",
    "especialista_faltante": "string, solo si tipo = sin_especialista",
    "motivo_principal": "string, en lo posible basado en un hallazgo de la ontología",
    "hallazgos_ontologia": [ { "rule_id": "string", "hallazgos": "string" } ],
    "otros_motivos": ["string"],
    "ciclos_intentados": 3
  },
  "created_at": "iso8601",
  "updated_at": "iso8601"
}
```

- Mientras `status` sea `draft`, `needs_clarification` o `running`,
  `informe_final` y `no_respuesta` son `null`. `accion_next` aparece en
  cuanto el orquestador la resuelve, antes incluso de que termine el primer
  ciclo — así el cliente puede mostrarle al fundador "esto es lo que se va
  a trabajar" aunque el especialista todavía no haya respondido.
- Si `status = approved`, viene `informe_final` poblado y `no_respuesta`
  en `null`.
- Si `status = max_cycles_reached`, es al revés: `informe_final` en `null`
  y `no_respuesta` poblado — construido a partir de los `hallazgos_ontologia`
  acumulados en `next_action_cycles.validacion` a lo largo de los 3
  intentos, priorizando el hallazgo metodológico más recurrente como
  `motivo_principal`.
- Si se llega a `max_cycles_reached` sin aprobación del validador, se
  devuelve igualmente el último borrador generado, marcado explícitamente
  como no validado (`aprobado: false` dentro de `informe_final`), en vez de
  fallar sin más — el fundador decide si le sirve igual.
- Webhook opcional (`callback_url` en el POST inicial) para quien prefiera
  no hacer polling — pensado sobre todo para Hermes.

---

## 2. Esquema de tablas nuevas

Propuesta mínima, ampliable:

```sql
CREATE TABLE next_action_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  startup_id uuid NOT NULL REFERENCES startups(id),
  informe_situacion_ref jsonb NOT NULL,   -- objeto completo: report_id, source, opciones_propuestas
  comentario_asesor text,
  comentario_asesor_autor text,
  comentario_asesor_aplica_a jsonb,       -- array de ids de opciones, o null
  comentario_asesor_tags jsonb,           -- array de tags, o null (ver sección 5)
  requested_by text NOT NULL,             -- 'app' | 'hermes'
  callback_url text,                      -- webhook opcional, payload fino {run_id, status}
  status text NOT NULL DEFAULT 'draft',   -- draft|needs_clarification|running|approved|max_cycles_reached|sin_especialista|failed
  accion_next jsonb,                      -- resuelta por el orquestador antes del primer ciclo
  cycle int NOT NULL DEFAULT 0,
  max_cycles int NOT NULL DEFAULT 3,
  max_clarifications int NOT NULL DEFAULT 2,  -- tope de preguntas de aclaración, no cuenta como ciclo
  ciclos jsonb NOT NULL DEFAULT '[]',     -- historial completo de ciclos, ver estructura abajo
  especialista_usado text,
  resultado jsonb,                        -- informe_final si approved; no_respuesta si max_cycles_reached
  error text,                             -- si status = failed
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE next_action_clarifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES next_action_runs(id),
  pregunta text NOT NULL,
  respuesta text,                         -- null hasta que el fundador conteste
  created_at timestamptz NOT NULL DEFAULT now()
);
```

Cada elemento del array `ciclos` tiene esta forma:

```json
{
  "cycle": 2,
  "accion_decidida": { "...": "copia de accion_next vigente en este ciclo" },
  "especialista": "mvp",
  "borrador": { "...": "salida del especialista antes de validar" },
  "validacion": {
    "aprobado": false,
    "fidelidad_a_la_accion": { "cumple": true, "notas": "el borrador atiende la accion_next asignada" },
    "coherencia_ontologia": { "cumple": false, "hallazgos_ontologia": [ { "rule_id": "string", "hallazgos": "string" } ] },
    "calidad_y_fuentes": { "cumple": true, "notas": "estilo claro, fuentes verificadas contra el rag" },
    "observaciones": "string, resumen de por qué no se aprobó este ciclo"
  },
  "created_at": "iso8601"
}
```

**El validador armoniza tres variables**, no solo "calidad" en general:

1. **`fidelidad_a_la_accion`** — ¿el borrador del especialista responde
   efectivamente a la `accion_next` que fijó el orquestador, o se desvía
   hacia otra cosa? Esto es lo que evita que un especialista "se vaya por
   las ramas" respecto a la acción concreta que se le asignó.
2. **`coherencia_ontologia`** — ¿el borrador es coherente con el estado
   actual registrado, reusando `validate()` del ontology-engine? Mismo
   mecanismo que ya se usa para validar `accion_next` antes de enrutar,
   pero aplicado ahora a la salida del especialista.
3. **`calidad_y_fuentes`** — claridad, estructura, y verificación de que
   las fuentes citadas realmente vienen de chunks recuperados del RAG, no
   inventadas.

`aprobado` es `true` solo si las tres se cumplen. Si el validador no logra
armonizar las tres tras 3 ciclos, el run pasa a `max_cycles_reached` y
`no_respuesta.hallazgos_ontologia` (ver sección 2, más abajo) se construye
priorizando las dimensiones que fallaron de forma consistente en los 3
intentos — con `coherencia_ontologia` como argumento principal cuando
aparece, según lo ya decidido en la pregunta 8.

- Se prefirió el array jsonb sobre una tabla separada: como máximo son 3
  elementos por run, no hay necesidad de consultarlos individualmente con
  SQL (siempre se leen completos junto con el resto del run), y evita un
  JOIN para algo que en la práctica siempre se pide junto. Si más adelante
  se necesita analítica cruzada sobre ciclos (ej. "qué regla de la
  ontología causa más rechazos en general"), se puede migrar a tabla en
  ese momento sin romper el contrato de `GET /runs`, que ya devuelve el
  array tal cual.

- `draft`: run creado (paso 1), pendiente de arranque.
- `needs_clarification`: el orquestador pausó a preguntarle al fundador
  antes de fijar la `accion_next` — no consume ciclos.
- `running`: `accion_next` ya está fijada, dentro de un ciclo
  (especialista → validador).
- `approved`: el validador certificó calidad en algún ciclo ≤3; `resultado`
  poblado.
- `max_cycles_reached`: se agotaron los 3 ciclos sin que el validador
  lograra armonizar las tres dimensiones (`fidelidad_a_la_accion`,
  `coherencia_ontologia`, `calidad_y_fuentes`). **Esto es un estado
  terminal válido, no un error** — el sistema comunica explícitamente que
  no obtuvo una respuesta adecuada, en vez de forzar una. `resultado` lleva
  una **no-respuesta argumentada**: por qué no se llegó a una respuesta
  válida, priorizando como justificación los `hallazgos_ontologia` que
  motivaron el rechazo en cada ciclo (por ejemplo, "se propuso X pero la
  ontología marca `R2_pivote_sin_aprendizaje` activa sobre esta startup, y
  ningún borrador logró resolver esa contradicción en 3 intentos") por
  encima de razones de las otras dos dimensiones (desvío respecto a la
  acción asignada, o estilo/fuentes). Esto le da al fundador algo
  accionable — no solo "no hubo suerte", sino qué condición metodológica
  está bloqueando una respuesta, y qué otros argumentos jugaron un papel
  secundario en cada intento.

  > **Nota de implementación (Hito 2):** cuando no hay `hallazgos_ontologia`
  > recurrente en los 3 ciclos (porque la dimensión que realmente falló fue
  > otra), `motivo_principal` usa las notas reales de la dimensión que sí
  > falló (típicamente `fidelidad_a_la_accion.notas` del último ciclo) en
  > vez de una frase genérica de relleno. El orden de prioridad completo:
  > (1) `hallazgos_ontologia` si los hay, (2) notas reales de la dimensión
  > que falló de forma consistente, nunca un texto genérico inventado.
- `failed`: error técnico (LLM caído, ontology-engine inalcanzable, etc.),
  distinto de "no se encontró una respuesta válida".
- `sin_especialista`: la `accion_next` requiere un rol que todavía no está
  implementado en esta fase (cualquiera distinto de MVP). Terminal
  inmediato, sin ciclos consumidos — el orquestador nunca llega a invocar
  al especialista; es el validador quien formaliza la no-respuesta.
- `next_action_clarifications` guarda el intercambio pregunta/respuesta
  previo a fijar `accion_next` — útil para auditar por qué se eligió una
  opción y no otra cuando hubo ida y vuelta con el fundador.
- El array `ciclos` guarda el registro de cada ciclo por separado: la
  `accion_next` vigente en ese momento, a qué especialista fue, qué
  devolvió, y qué dijo el validador — incluyendo los hallazgos que vengan
  de reusar `validate()` del ontology-engine. Esto es lo que permite
  auditar por qué el validador rechazó un ciclo y qué cambió en el
  siguiente, y es también la fuente para construir `no_respuesta` cuando
  se llega a `max_cycles_reached`.
- `informe_situacion_ref` se guarda completo como jsonb (no solo un id):
  desde la pregunta 11, el payload de `POST /runs` ya trae
  `opciones_propuestas` embebidas, así que no hace falta resolverlo con una
  llamada aparte a `startup-advisor` — se persiste tal cual llega.

---

## 3. Autenticación entre invocadores

**Decisión final (implementada en Hito 1): API key por invocador vía
variables de entorno**, no una tabla en base de datos. Se descarta la
tabla `next_action_api_keys` que se había propuesto originalmente —
con solo dos invocadores confirmados y sin necesidad de scopes ni
revocación self-service, una tabla con hash y `revoked_at` es
complejidad que no se traduce en ningún beneficio real aquí.

- `API_KEY_APP` y `API_KEY_HERMES` como variables de entorno del
  servicio, una por invocador.
- Cada request lleva `Authorization: Bearer <key>`; el servidor compara
  contra las dos env vars conocidas.
- **Confirmado: solo dos invocadores**, sin previsión de un tercero —
  una key para el invocador "app" (server-side, nunca expuesta al
  navegador), otra para el asistente agéntico local tipo Hermes/OpenClaw.
  **El invocador "app" se implementó como `startup-next-ui`** — repo
  propio y separado (sibling de `startup-next/`, no una integración
  dentro de `startup-advisor`), Next.js mínimo con rutas API que hacen de
  backend-for-frontend: la `API_KEY_APP` vive ahí server-side, el
  navegador nunca la ve. Formulario con pegado manual del informe
  (`startup_id` y `opciones_propuestas` a mano, sin lectura automática
  desde la tabla `reports` todavía) — decisión deliberada de v1 para
  priorizar velocidad de construcción sobre integración real; una mejora
  natural de v2 sería leer el informe real desde la Neon compartida.
- Sin scopes — cualquier key válida puede operar sobre cualquier
  `startup_id`. Si más adelante el asistente local debe limitarse a las
  startups de un fundador concreto, se resuelve por convención (el
  asistente siempre pasa el `startup_id` de su usuario local, no hay
  multi-tenancy real en ese cliente) antes que añadiendo scopes a las keys.
- **Rotación = cambiar la env var + redeploy.** Esto es aceptable en este
  proyecto porque el despliegue ya es manual por norma (`flyctl deploy`) —
  no se pierde nada respecto a la alternativa de tabla, que igual hubiera
  requerido intervención manual para revocar. Si en el futuro se necesita
  revocar sin redeploy (ej. si el número de invocadores crece más allá de
  estos dos), ahí sí se justifica migrar a una tabla — no antes.

---

## 4. RAG compilado

- **Fase previa: un único agente especialista, concretamente MVP.** El
  orquestador ya implementa la lógica de clasificación (analiza informe +
  comentario del asesor y decide "la próxima acción"), pero en esta fase
  toda decisión se enruta al especialista de **MVP** — el rol más frecuente
  al cerrar una entrevista según lo verificado en Fase 2 — en vez de a los
  siete roles descritos (ideación, MVP, financiación, modelo de negocio,
  escalado, organización, administración). Los otros 6 quedan sin cubrir
  hasta la siguiente iteración.
- **Si la `accion_next` decidida pertenece a otro rol distinto de MVP: el
  orquestador no llama al especialista en absoluto.** En vez de forzar un
  intento con MVP (que no tiene el encaje ni el RAG adecuado) o dejarlo
  como `needs_clarification`, el orquestador se lo comunica directamente
  al **validador**, y es el validador quien emite la no-respuesta formal
  — manteniendo al validador como única autoridad que produce el mensaje
  final hacia el fundador, sea aprobado o no. Esto es inmediato, **no
  consume ciclos** (el especialista nunca llegó a intentarlo):

  ```json
  "accion_next": {
    "...": "...",
    "especialista_requerido": "financiacion",
    "especialista_disponible": false
  }
  ```

  El run pasa directo a un nuevo estado terminal `sin_especialista`, con
  `resultado.no_respuesta` poblado así:

  ```json
  "no_respuesta": {
    "tipo": "sin_especialista",
    "especialista_faltante": "financiacion",
    "motivo_principal": "la acción prioritaria requiere el especialista de financiación, que todavía no está implementado en esta fase",
    "hallazgos_ontologia": [],
    "ciclos_intentados": 0
  }
  ```

  Este `tipo: "sin_especialista"` se distingue del `tipo: "ontologia"` que
  aplica cuando sí hubo intentos reales del especialista MVP pero no se
  logró armonizar las tres dimensiones tras 3 ciclos (pregunta 13).
- **Ingesta offline y reutilizable, no un servicio en producción.**
  Empaquetada como **contenedor Docker independiente** (`rag-ingest/`,
  imagen propia, no un endpoint de `startup-next`), invocado a mano cada
  vez que se añade o cambia una fuente — no como parte del servicio en
  producción. `startup-next` en producción nunca invoca a MinerU/Voyage en
  caliente — solo lee de `rag_chunks` ya poblada. Esto evita el mismo
  problema de latencia que ya causó el incidente de Fase 2 (llamadas
  pesadas dentro de una request síncrona).

  **Por qué contenedor y no notebook/Colab suelto** (decisión tomada tras
  una sesión real de ingesta que encontró deriva de entorno: versiones de
  `transformers`/`huggingface-hub` que cambiaban según el día, un crash
  nativo de memoria por threading de librerías de inferencia en CPU, y un
  asistente de IA de Colab parchando el notebook por su cuenta sin que
  quedara reconciliado en ningún lado): una imagen Docker con las
  versiones exactas ya fijadas congela ese trabajo para siempre — nadie
  vuelve a redescubrirlo. **No vive dentro de `startup-next`** por lo
  mismo que se decidió no correr MinerU en caliente en producción: es
  Python (MinerU, mammoth, `voyageai`), mientras que `startup-next` es
  Node/TypeScript — meter esto ahí sería o cruzar lenguajes sin necesidad,
  o reescribir un pipeline que no tiene equivalente directo en Node.

  **Dos subcomandos de la misma imagen, no una única operación de punta a
  punta** — separar "generar" de "cargar":

  ```bash
  # 1. Parsear + trocear + embeber → un archivo, sin tocar la base todavía
  docker run --env-file .env rag-ingest parse \
    --file sources/libro.pdf --libro "Nombre" --tags mvp \
    --out /salida/libro.jsonl

  # 2. Cargar ese archivo a rag_chunks (upsert + resync)
  docker run --env-file .env rag-ingest load --file /salida/libro.jsonl
  ```

  `parse` no toca la base para nada — produce un `.jsonl` con un chunk por
  línea (`libro`, `capitulo`, `seccion`, `indice_en_seccion`, `texto`,
  `embedding`, `especialista_tags`). `load` es el paso liviano que sí
  escribe, leyendo ese archivo. Ventajas concretas sobre una sola
  operación: si `load` falla (un corte de red hacia Neon, por ejemplo), se
  reintenta solo `load` — no se vuelve a pagar el parseo con MinerU, que
  es la parte lenta y la que más veces falló en la sesión que motivó esta
  decisión; el `.jsonl` además queda como evidencia auditable de qué se
  ingirió y cuándo, sin tener que reconstruirlo consultando la base.

  **Disciplina operativa** (no solo tooling — esto es lo que realmente
  costó tiempo real):
  - **Un libro/fuente a la vez**, nunca los N de punta a punta en una sola
    corrida — si algo falla a mitad de camino, se pierde una fuente, no
    toda la sesión.
  - El `Dockerfile` versionado en el repo es la única fuente de verdad. Si
    se corre en algún entorno interactivo (Colab u otro) para explorar o
    depurar, **nunca aceptar un auto-fix de un asistente de ese entorno
    como versión final** — cualquier fix real se aplica al `Dockerfile`/
    código versionado, no a una copia suelta que diverge en silencio.

  **Prerrequisitos de la imagen, ya descubiertos y fijados (no
  especulativos)**:
  - `transformers>=4.57.3,<5.0.0` — MinerU lo declara en su
    `pyproject.toml`; en un entorno sin este pin explícito (ej. una imagen
    base que trae una versión más nueva preinstalada) el backend
    `pipeline` falla al inicializar el modelo de reconocimiento de
    fórmulas (`ImportError: cannot import name
    'find_pruneable_heads_and_indices'` — la serie 5.x de `transformers`
    movió/eliminó esa función). Instalar con
    `pip install "mineru[pipeline]" --upgrade` resuelve toda la cadena de
    un saque (incluye `huggingface-hub` en el rango correcto) en vez de
    fijar cada librería por separado.
  - **Límite de threads nativos**, para evitar un crash de memoria
    (`free(): invalid pointer`) observado en inferencia CPU con `torch` +
    `onnxruntime` + `opencv-python` compartiendo el mismo proceso — fijar
    antes de cualquier `import`:
    ```python
    os.environ["OMP_NUM_THREADS"] = "1"
    os.environ["MKL_NUM_THREADS"] = "1"
    os.environ["OPENBLAS_NUM_THREADS"] = "1"
    ```
    En la imagen Docker, se fija como `ENV` a nivel de imagen (no dentro
    del script Python) — se aplica antes de que el intérprete arranque
    siquiera, más robusto que fijarlo al inicio del script.
  - **`six` (dependencia de runtime no declarada)**: el backend
    `pipeline` (OCR adaptado de PaddleOCR) lo importa en tiempo de
    ejecución, pero no queda declarado como dependencia resuelta de
    `mineru[pipeline]` — sin esto, falla en el primer `parse` real con
    `ModuleNotFoundError: No module named 'six'`, no en el análisis de
    dependencias declaradas. Línea exacta del Dockerfile:
    ```dockerfile
    # six: el backend pipeline (OCR adaptado de PaddleOCR) lo importa en
    # tiempo de ejecución pero no queda declarado como dependencia resuelta
    # de mineru[pipeline] — sin esto, falla en el primer parse real con
    # ModuleNotFoundError: No module named 'six'.
    RUN pip install --no-cache-dir voyageai "psycopg[binary]" pgvector click six
    ```
  - **`torch`/`torchvision` CPU-only, instalados ANTES de
    `mineru[pipeline]`**: por defecto (`backend=pipeline`, sin GPU),
    `mineru[pipeline]` arrastra igual el wheel GPU de `torch` desde PyPI
    — varios GB de paquetes `nvidia_*` nunca usados, dado que esta imagen
    fuerza CPU de todos modos (ver límite de threads arriba). Instalarlo
    primero funciona porque el "upgrade-strategy" por defecto de `pip` es
    `only-if-needed`: si el `torch` ya instalado satisface el rango que
    pide `mineru`, el `--upgrade` posterior no lo toca ni lo reemplaza.
    Línea exacta del Dockerfile:
    ```dockerfile
    # torch/torchvision CPU-only, ANTES de mineru[pipeline] — por defecto
    # (backend=pipeline, sin GPU) mineru arrastra el wheel GPU de torch desde
    # PyPI (varios GB de paquetes nvidia_* nunca usados, ver ENV de threads
    # arriba: esta imagen fuerza CPU de todos modos). Instalarlo primero
    # funciona porque el "upgrade-strategy" por defecto de pip es
    # "only-if-needed": si torch ya instalado satisface el rango que pide
    # mineru, el --upgrade de abajo no lo toca ni lo reemplaza.
    RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu
    ```
  - Backend `-b pipeline`, no el backend VLM por defecto — el VLM
    descarga un modelo desde HuggingFace en el momento de la ingesta,
    dependencia de red externa que puede fallar por certificados SSL
    según la máquina/red; `pipeline` es el backend clásico (layout+OCR,
    sin VLM) y no depende de esa descarga.
  - **Modelos de layout/OCR/fórmulas bakeados en build time, confirmado
    viable**: `mineru-models-download -s modelscope -m pipeline` como
    `RUN` del Dockerfile — existe exactamente para esto. Elimina tanto la
    descarga en caliente como el problema de certificados SSL contra
    `huggingface.co` ya diagnosticado, moviendo esa dependencia de red al
    momento de build de la imagen (una sola vez) en vez de a cada
    ingesta. Verificar con una build completa + un `parse` real de punta
    a punta como primera prueba, no solo confirmar que el flag existe —
    es el paso que de verdad cierra el problema de red que costó más
    tiempo en la sesión de ingesta real.

  **Prerrequisitos del entorno host (Docker Desktop / WSL2 en Windows),
  descubiertos en la corrida real de los 3 libros**:
  - **`MSYS_NO_PATHCONV=1`** como prefijo de cualquier `docker run` desde
    Git Bash en Windows — sin esto, Git Bash reescribe rutas destino
    dentro del contenedor (ej. `/app/sources`) como si fueran rutas de
    Windows (`C:/Program Files/Git/app/sources`), rompiendo los `-v`.
  - **`MINERU_TASK_RESULT_TIMEOUT_SECONDS`** — el default (3600s = 1h) no
    alcanza para libros grandes en el backend `pipeline` con un solo
    hilo (forzado por el límite de threads nativos de arriba). Ajustar
    según el tamaño esperado del documento más grande del corpus — 14400
    (4h) resultó suficiente para un libro de 448 páginas.
  - **Límite de memoria de la VM de WSL2**: el default de Docker Desktop
    (~7.7GB, la mitad del host sin `.wslconfig`) puede no alcanzar para
    libros largos — se manifiesta como un crash sin traceback de Python
    (proceso muerto por el kernel, no una excepción atrapada), en un
    punto **variable** entre corridas idénticas (no en la misma página
    cada vez) — esa variabilidad es la señal de presión de memoria, no de
    un problema de contenido específico de una página. Confirmado en la
    práctica: subir a `memory=12GB`... *(ajustado en la corrida real a
    10GB, ver `%UserProfile%\.wslconfig`)* resolvió el crash de un libro
    de 448 páginas que fallaba de forma reproducible con el default.
    ```ini
    [wsl2]
    memory=10GB
    ```
    (requiere `wsl --shutdown` + reiniciar Docker Desktop para aplicarse)

  **Pasos internos del subcomando `parse`** (la lógica ya validada en la
  sesión de prueba real):
  1. Cargar el PDF de origen.
  2. Parsear con MinerU → salida estructurada (markdown/JSON con
     jerarquía de encabezados, tablas, pies de figura).
  3. Trocear por sección real (no por tamaño fijo de caracteres),
     preservando la jerarquía `libro` / `capitulo` / `seccion`.
  4. Generar embeddings por chunk con **Voyage AI** (`voyage-4`) — ver
     justificación abajo.
  5. Escribir el `.jsonl` de salida (`libro`, `capitulo`, `seccion`,
     `indice_en_seccion`, `texto`, `embedding`, `especialista_tags` — sin
     `chunk_id` todavía) — nada se escribe en `pgvector` en este paso.

  **Pasos internos del subcomando `load`**:
  1. Leer el `.jsonl`.
  2. **Calcular `chunk_id` acá, no en `parse`**:
     `sha256(f"{libro}::{capitulo}::{seccion}::{indice_en_seccion}")` (hash
     de la ruta estructural, no del texto). Deliberado: si el algoritmo
     del hash cambia algún día, alcanza con re-correr `load` contra el
     mismo `.jsonl` ya generado, sin volver a pagar el parseo con MinerU
     — misma razón por la que se separaron `parse`/`load` en primer
     lugar, extendida más allá de la resiliencia a fallos de red.
  3. Cargar a `rag_chunks` (columna `vector` nativa de Drizzle — la
     dimensión de `voyage-4` se confirma empíricamente en la primera
     llamada real, no se asume, antes de fijarla en la migración) —
     upsert por `chunk_id`.
  4. **Resync por libro**: tras upsertear todos los chunks vigentes de un
     libro, borrar cualquier fila de `rag_chunks` de ese libro cuyo
     `chunk_id` no esté en el set de la corrida actual — así, re-ingerir
     tras **cambiar el chunking** (no solo repetirlo igual) no deja
     chunks huérfanos de la versión anterior.
  5. Verificación rápida al final: unos pocos queries de prueba contra
     los embeddings recién cargados, antes de dar la ingesta por buena.

  **Estructura de módulos** (la lógica del notebook se traslada, no se
  reescribe):
  ```
  rag-ingest/
    Dockerfile
    requirements.txt
    rag_ingest/
      cli.py           # click.group() con los subcomandos parse/load
      mineru_runner.py # run_mineru + load_content_blocks
      chunking.py      # chunk_by_section (compute_chunk_id vive en load.py)
      voyage_client.py # embed vía voyageai (SDK Python, no el REST de src/lib/voyage.ts)
      db.py            # conexión psycopg + register_vector
      load.py          # compute_chunk_id + upsert_chunks + resync_book + verify_ingestion
  ```
  CLI: **Click** — ya es dependencia transitiva de `mineru[pipeline]`
  (confirmado instalado en la sesión real), no suma una librería nueva;
  mismo criterio ya aplicado en el resto del proyecto (SQL crudo en vez
  de sumar un ORM, fetch directo en vez de un SDK adicional).

- **Pipeline resultante**: PDF original → `rag-ingest parse` (MinerU +
  chunking + Voyage) → `.jsonl` → `rag-ingest load` (upsert + resync en
  `pgvector`) — todo dentro del contenedor, ejecutado offline.

> **Nota de transición**: `notebooks/` (notebook + venv local) queda
> reemplazado por `rag-ingest/` — **confirmado funcionando de punta a
> punta con el corpus real**, ya se puede eliminar.

> **Estado real del corpus: cargado y verificado, no ya pendiente.**
> 1.126 chunks en `rag_chunks`, en 3 fuentes (no las "3 libros base
> originales" tal cual se planteó al principio — una se reemplazó por un
> documento derivado, ver más abajo):
> - Lean Startup — 158 chunks.
> - Guía Didáctica del Modelo Canvas (basada en Business Model Canvas, A.
>   Osterwalder) — 190 chunks. **Reemplaza al PDF original** de
>   Osterwalder (107MB, cargado de gráficos que el backend `pipeline` no
>   interpreta semánticamente de todos modos) por un resumen de técnicas
>   de un tercero, más denso en contenido accionable para el especialista
>   MVP. El campo `libro` deja explícita la naturaleza derivada del
>   documento — no dice simplemente "Business Model Canvas" para evitar
>   atribuir al fundador una cita como si fuera de Osterwalder cuando en
>   realidad es de una guía derivada.
> - Customer Development — 778 chunks (el libro más largo del corpus,
>   448 páginas — el que forzó a descubrir y resolver el límite de
>   memoria de WSL2 de arriba).

> **Validación end-to-end confirmada, sin ningún componente mockeado**
> (orquestador, especialista, validador, todos reales, corpus completo
> detrás): 4 corridas MVP, las 4 aprobadas en el primer ciclo (0
> rechazos). La recuperación por similitud discrimina correctamente entre
> fuentes — las 5 citas de cada corrida vinieron de Customer Development,
> coherente con que la consulta (validar la hipótesis de valor con
> clientes reales) mapea directamente al contenido de descubrimiento de
> CD, no al de Lean Startup ni la guía de Canvas — señal de que la
> recuperación es semánticamente selectiva, no ruido. Tiempo real de un
> ciclo completo aprobado: ~65s de punta a punta (`accion_next` resuelto
> en ~7.9s, incluyendo el round-trip real a `ontology-engine`). El camino
> `sin_especialista` y la detección de `conflicto_comentario_asesor`
> también se reconfirmaron bajo condiciones reales (no mockeadas): con
> una opción de financiación, el orquestador detectó correctamente que el
> comentario del asesor (priorizar financiación) contradecía un hallazgo
> real de la ontología (4 hipótesis sin validar), con una `descripcion`
> sustancial explicando la contradicción.

### Proveedor de embeddings: Voyage AI

**Decisión: Voyage AI, modelo `voyage-4`**, uno solo tanto para indexar
como para consultar (sin la optimización de "modelo grande para indexar,
modelo liviano para consultar" que ofrece la familia Voyage 4 compartiendo
espacio vectorial — es una optimización de escala que no hace falta
todavía). Razonamiento:

- **Claude no genera embeddings** — es un proveedor nuevo inevitable, no
  una elección de conveniencia. La documentación oficial de Claude
  Platform recomienda directamente a Voyage AI como proveedor para esto,
  con soporte de cookbooks oficiales de Anthropic — es el camino con menos
  fricción de integración, no una elección de benchmark.
- **El costo es irrelevante a esta escala.** Los primeros 200 millones de
  tokens de texto están gratis en cada cuenta para los modelos principales
  de Voyage — con 3 libros trocéados por sección (un par de miles de
  chunks, según la estimación de esta misma sección), la ingesta inicial
  cuesta, en la práctica, cero. Alternativas como Google
  text-embedding-005, OpenAI o Cohere existen y son más baratas por millón
  de tokens, pero esa diferencia no se traduce en nada real a este volumen
  — incluso a 100 millones de tokens mensuales, la opción más cara
  (Voyage) cuesta 18 dólares al mes.
- **Una API key nueva, inevitable**: `VOYAGE_API_KEY`. A diferencia de
  otras decisiones de este documento donde se evitó sumar un proveedor
  nuevo (pregunta 4, `pgvector` vs. vector store dedicado), aquí no hay
  forma de evitarlo — Claude no cubre esto y algún proveedor externo hace
  falta sí o sí. Se acepta como el único costo de integración
  estrictamente necesario para el RAG.

- **Decisión: `pgvector` sobre la misma Neon**, no un vector store dedicado
  (Pinecone, Qdrant). Justificación:
  - **Escala real es pequeña.** 3 libros base trocéados por sección dan del
    orden de unos pocos cientos a un par de miles de chunks, no millones.
    A ese volumen, el índice HNSW o IVFFlat de `pgvector` responde en
    milisegundos — la ventaja de rendimiento de un vector store dedicado
    (pensado para decenas de millones de vectores o alto QPS) no se nota en
    absoluto aquí.
  - **Consistencia con la pregunta 6** (Neon compartida con schema propio):
    si de todos modos hay una conexión abierta a esa misma base, añadir la
    tabla de embeddings ahí es una tabla más, no un servicio más. Un vector
    store dedicado suma: otra cuenta, otro proveedor, otra credencial que
    gestionar (relevante dado que la autenticación entre servicios ya es un
    punto sensible en este proyecto — ver Fase 1/2 con `ONTOLOGY_ENGINE_URL`
    fallando en silencio cuando falta configuración), y otro punto de fallo
    en el camino crítico del especialista.
  - **Encaja con el resto del stack**: Drizzle ya modela el resto de tablas
    sobre esa Neon; una tabla `rag_chunks` con columna `vector` es
    consistente con ese mismo ORM, sin introducir un cliente/SDK adicional
    solo para esto.
  - **Cuándo reconsiderar**: si el corpus crece mucho al sumar fuentes por
    especialista (¿decenas de libros por rol × 7 roles?) o si aparecen
    requisitos de latencia muy estrictos bajo carga concurrente alta,
    ahí sí vale la pena evaluar un vector store dedicado — pero no como
    decisión de diseño inicial, sino como optimización posterior con datos
    reales de uso.
- **Metadata por chunk**: `libro`, `capitulo/seccion` (heredada de la
  jerarquía que devuelve MinerU), y `especialista_tags` para cuando existan
  varios especialistas y cada uno deba consultar solo su porción relevante
  del corpus.
- El validador reutiliza esta metadata para su chequeo de "verificación de
  fuentes" — comprobar que las citas del informe realmente vienen de chunks
  recuperados, no inventadas — y además reusa `validate()` del
  ontology-engine para el chequeo de coherencia metodológica (que no haya,
  por ejemplo, una recomendación que contradiga una regla ya disparada
  sobre esa startup, como una hipótesis sin experimento pendiente).

> **Nota de implementación (Hito 1):** el `validate()` real del
> ontology-engine devuelve `hallazgos` como **array por regla**, no como
> string único tal como sugería el ejemplo de contrato en este documento.
> `src/lib/ontologyEngine.ts` en `startup-next` ya incluye un adaptador
> `toHallazgosOntologia()` que normaliza esto a la forma
> `{ rule_id, hallazgos }` usada en `accion_next` y `no_respuesta`. Cuando
> se implemente el orquestador/validador reales (no mockeados), deben
> pasar siempre por ese adaptador en vez de asumir el shape crudo de la
> API de `ontology-engine`.

### Especialista MVP real (Hito 3, confirmado)

- **Búsqueda de similitud**: SQL crudo de Drizzle con el operador `<=>`
  (distancia coseno), embedding de la consulta bindeado como parámetro
  (no interpolado), filtrado por `especialista_tags @> '["mvp"]'` — esta
  versión de `drizzle-orm` no trae un helper (`cosineDistance`) todavía.
- **Generación**: `.withStructuredOutput()` sobre un schema acotado — al
  modelo se le pasan los chunks ya recuperados (texto + `chunk_id`) y se
  le pide `recomendaciones` con `detalle` y, por cada una, qué
  `chunk_id`s de los recuperados usó realmente. No se le pide que
  reproduzca el texto de los chunks (ya se tiene).
- **Mapeo de `chunk_id` → cita legible, obligatorio antes de exponer al
  fundador.** El contrato de `informe_final.recomendaciones[].fuentes`
  (sección 2) son strings de cita legibles (ej. "Lean Startup — Cap. 4"),
  no hashes internos. Al sincronizar el borrador aprobado hacia
  `informe_final`, cada `chunk_id` citado se traduce a su cita legible
  usando la metadata (`libro`/`capitulo/seccion`) ya guardada en
  `rag_chunks` — en código, no con otra llamada a Claude. **Confirmado con
  el corpus real** (1.126 chunks, no los 3 sembrados a mano del Hito 3):
  `translateFuentes()` produce citas correctas a esa escala, ej.
  `"Customer Development — Descubrimiento de clientes, fase 2: «Salir a
  la calle» para confirmar el problema: «¿Le importa a la gente?»"`.

  > **Observación de calidad, no un bug**: algunos `capitulo` de las
  > citas de Customer Development son oraciones de cuerpo de texto en vez
  > de títulos de capítulo reales (ej. "Los programas de retención se
  > mantienen vivos..."), probablemente porque MinerU etiquetó un bloque
  > de encabezado con nivel atípico como nivel 1 durante la ingesta de
  > ese PDF puntual. No rompe la trazabilidad (el `chunk_id` sigue
  > siendo correcto y verificable), solo hace que algunas citas se vean
  > menos prolijas que otras. Diferido — no vale la pena volver a pagar
  > el parseo de 448 páginas por un problema cosmético, salvo que el uso
  > real muestre que molesta de verdad.
- **`calidad_y_fuentes`: resuelto en código, no con otra llamada a
  Claude.** Verificar que cada `chunk_id` citado en el borrador esté
  efectivamente dentro del set de chunks recuperados en esa búsqueda es un
  hecho determinístico (pertenencia de conjunto) — pedirle a un LLM que
  juzgue si las fuentes "parecen reales" sería más caro y menos confiable
  que la comparación exacta que ya se puede hacer con el dato disponible.
  **Alcance deliberadamente diferido**: el documento original describía
  esta dimensión como "claridad, estructura, **y** verificación de
  fuentes" — este enfoque cubre solo la verificación de fuentes. La
  evaluación de calidad de redacción/estructura queda explícitamente sin
  cubrir por ahora, no perdida en silencio: se añade en una iteración
  futura solo si el uso real muestra que hace falta, no de forma
  especulativa.
- **Modelo: `claude-sonnet-5`** (mismo nivel que el validador) — síntesis
  fundamentada sobre contexto ya recuperado, no razonamiento abierto como
  el orquestador. Configurable vía `SPECIALIST_MODEL` /
  `SPECIALIST_ANTHROPIC_API_KEY` en `src/config/models.ts`, mismo patrón
  que orquestador/validador — si la calidad de redacción decepciona en
  uso real, subir a `claude-opus-4-8` es cambiar una variable de entorno,
  no tocar código.

> **Estado real del corpus (Hito 3): pendiente de ingesta.** El notebook
> de ingesta está escrito pero **no ejecutado contra los 3 libros reales**
> — no había PDFs disponibles al momento de construirlo. Lo verificado en
> el Hito 3 es la tubería completa (embeber → recuperar → generar →
> mapear a cita legible → validar) con 3 chunks sembrados a mano, uno por
> libro — suficiente para confirmar que el mecanismo funciona, pero
> **no** una prueba real de calidad de recuperación: con solo 3 chunks
> cualquier búsqueda por similitud los encuentra casi trivialmente. La
> prueba real de si el RAG recupera los fragmentos correctos entre miles
> de chunks recién es posible una vez cargado el corpus completo. No dar
> este hito por productivo hasta correr el notebook contra los PDFs
> reales y volver a probar con el corpus completo.

> **Notas de implementación (Hito 3) — convenciones permanentes del
> proyecto:**
> 1. **`thinking` debe desactivarse explícitamente
>    (`{ type: "disabled" }`) en cualquier nodo que use
>    `.withStructuredOutput()`.** Anthropic no permite forzar
>    `tool_choice` con thinking habilitado, y Sonnet 5 corre en modo
>    `adaptive` por defecto si el campo simplemente se omite — no alcanza
>    con no mencionarlo, hay que apagarlo a mano. Aplica a los tres nodos
>    del grafo (orquestador, validador, especialista) y a cualquier nodo
>    nuevo que se agregue después.
> 2. **El shape real de la respuesta REST de Voyage AI es `{ data: [{
>    embedding: [...] }] }`**, no `{ embeddings: [...] }` como sugería la
>    documentación resumida — descubierto probando el endpoint en vivo.
>    Corregido en `src/lib/voyage.ts` (cliente TypeScript vía REST, usado
>    por el especialista en tiempo de ejecución para embeber la consulta).
>    **Importante**: el notebook de ingesta usa el paquete oficial
>    `voyageai` de Python (`client.embed(...).embeddings`), una interfaz
>    distinta — no asumir que el mismo bug aplica ahí; queda como parte de
>    la verificación pendiente cuando el notebook corra por primera vez
>    contra datos reales.
> 3. **Los schemas de `.withStructuredOutput()` necesitan al menos dos
>    campos de nivel superior — evitar un schema cuyo único campo sea un
>    array.** Con un solo array de nivel superior, Claude puede devolver
>    el array doblemente serializado como string anidado, rompiendo el
>    parseo. Solución aplicada: agregar un segundo campo con contenido
>    real (no relleno vacío) — en este caso `resumen_estrategia` en el
>    schema del especialista. Aplica a cualquier schema nuevo que se
>    diseñe para los nodos del grafo.
>
>    **Confirmado que se repite (paso 3)**: `informeParseDecisionSchema`
>    (endpoint `POST /informes/parse`) tenía el mismo problema —
>    `opciones` como único campo de nivel superior, mismo colapso a
>    string anidado, mismo 500. Arreglado igual: `resumen_fuente` como
>    segundo campo. Ya no es un incidente aislado — es un patrón real de
>    `.withStructuredOutput()` en este proyecto, no una casualidad del
>    especialista.
>
>    **La teoría original era incompleta — refinada con evidencia real**
>    (bloqueando el 100% de los runs hasta encontrarla): un segundo campo
>    de nivel superior previene que el **objeto completo** colapse a
>    string, pero **no protege un campo array-de-objetos específico**
>    dentro de ese objeto — `recomendaciones` en
>    `specialistDecisionSchema` seguía serializándose como string
>    (con `chunk_ids_citados` y todo el contenido anidado adentro) pese
>    a ya tener `resumen_estrategia` como campo hermano. Capturado con
>    `includeRaw: true` antes del parseo de Zod, no supuesto. Medido con
>    32 llamadas reales (mismo prompt/schema/chunks, contenido variado):
>    **~6% de fallo por llamada**, estocástico (mismo input, resultado
>    distinto entre corridas) — no ligado a un contenido puntual.
>    Patrón real: **cualquier campo array-de-objetos complejos tiene
>    probabilidad no nula de emitirse como JSON-dentro-de-string, con o
>    sin campos hermanos** — la regla de "dos campos" reduce el riesgo,
>    no lo elimina.
>
>    **Fix**: capa de reparación determinística en
>    `structuredOutputRetry.ts`, genérica (no específica de
>    `specialist.ts`), antes de gastar un reintento completo (nueva
>    llamada a Claude, misma probabilidad de fallar de nuevo): si un
>    campo esperado como array/objeto llegó como string, intentar
>    `JSON.parse()` sobre ese campo específico y re-validar contra el
>    mismo schema — si pasa, se usa sin gastar reintento ni llamada
>    nueva. Cubre preventivamente también `informeParseDecisionSchema`
>    (mismo patrón estructural en `opciones`, no había fallado todavía
>    ahí). Las reparaciones exitosas quedan logueadas de forma
>    distinguible del camino feliz normal, para poder confirmar con
>    datos reales de producción (no solo la muestra sintética de 32
>    llamadas) si la tasa real coincide con el ~6% medido — hay una
>    tensión estadística abierta y honestamente no resuelta (2/2 fallos
>    de reintento agotado en las únicas 2 pruebas reales, cuando la
>    probabilidad esperada con 6%/llamada sería ~0.02% — podría ser
>    ruido de muestra chica, o que el contexto real de producción tenga
>    tasa de fallo más alta que el prompt sintético usado para medir).
>
>    **Implementado y verificado en 3 niveles, incluyendo un end-to-end
>    limpio sin ningún bypass manual**: (1) offline contra el caso real
>    capturado, repara correctamente con log distintivo; (2) 8 llamadas
>    reales a `runMvpSpecialist` en producción, sin romper nada; (3) run
>    real por la UI → `approved` en el primer poll → PDF descargado por
>    la ruta real, con recomendaciones y fuentes reales del corpus — el
>    camino feliz completo del producto, confirmado de punta a punta por
>    primera vez sin ningún atajo de base de datos.
>
>    **Segundo subtipo de fallo real, distinto e identificado, no
>    reparado a propósito**: a veces `recomendaciones` llega como string
>    pero con JSON genuinamente corrupto/mal cerrado (no una estructura
>    válida mal tipada, sino contenido roto). La reparación intenta
>    `JSON.parse()`, falla con excepción, y cae al reintento normal — es
>    la decisión correcta: reconstruir datos corruptos a ciegas habría
>    podido producir contenido plausible pero falso, en silencio. El fix
>    reduce la tasa de `failed`, no la elimina al 100%. De paso se
>    corrigió el logueo de errores (reconstruye el diagnóstico con
>    `schema.safeParse()` cuando `parsingError` de LangChain viene vacío,
>    que es justo lo que pasa en este segundo subtipo) — un fallo futuro
>    ya no necesita un script de debug aparte para diagnosticarse.
>
>    Con el logueo de reparaciones ya en producción, queda pendiente de
>    observación natural (no una tarea a resolver ahora): comparar la
>    tasa real de reparaciones contra el ~6% sintético medido, y la
>    frecuencia del segundo subtipo no reparable — esa sería la señal
>    real de si hace falta ir más profundo (ej. si es específico de
>    `claude-sonnet-5` a este tamaño de schema, o bajar el máximo de
>    recomendaciones).

---

## 5. Formato del comentario del asesor

Sigue siendo **opcional** — el fundador puede pedir "qué hago ahora" sin
que haya opinión de un asesor humano. Punto de partida para el formato:
**texto libre**, como ya estaba anotado. Propuesta concreta para no
dejarlo completamente sin estructura:

```json
{
  "texto": "string libre, obligatorio si el campo está presente",
  "autor": "string, opcional",
  "aplica_a": ["opt_1"],
  "tags": ["string"]   // opcional, ej. ["urgente", "revisar_financiacion"]
}
```

- `tags` es opcional, pero en la práctica **sí es una señal que el
  orquestador puede usar** para ayudar a determinar `especialista_requerido`
  (ej. un tag como `revisar_financiacion` puede ser el disparador para
  detectar que la acción prioritaria pertenece a un rol sin especialista
  implementado — ver `sin_especialista` en la sección 4). No gobierna el
  enrutamiento por sí solo — el clasificador sigue decidiendo en base al
  informe completo —, pero es un dato de entrada real, no un extra
  descartable como se pensaba originalmente.

> **Nota de implementación (Hito 1):** el esquema SQL original de la
> sección 2 no tenía columna para `tags` — se perdía al persistir, lo que
> en la práctica hacía inalcanzable el camino `sin_especialista` (nunca
> había señal suficiente para detectarlo). Corregido con la columna
> `comentario_asesor_tags jsonb`, aplicada en la migración
> `0001_add_comentario_asesor_tags.sql` sobre la Neon real (la `0000` ya
> estaba aplicada, así que se sumó como migración nueva en vez de editarla).
- No se valida contenido ni longitud del texto libre por ahora; si el
  comentario es demasiado largo, es el orquestador quien decide cómo
  resumirlo antes de pasarlo al especialista, no el servicio de entrada.

**La ontología es una restricción dura sobre el comentario, no un dato
más a ponderar.** Antes de que el orquestador adopte la prioridad sugerida
por el asesor, debe contrastarla contra el estado actual (mismo mecanismo
que valida `accion_next`, `GET /startups/{id}/graph` + `validate()`). Si el
comentario del asesor empuja hacia una dirección que contradice una regla
activa sobre esa startup — por ejemplo, el asesor sugiere "vayan ya a por
inversión" pero `R1_hipotesis_sin_experimento` está activa sobre la
hipótesis central —, el orquestador **no puede simplemente adoptar esa
opinión como prioridad**: la ontología prevalece sobre la opinión humana en
ese punto. Esto no significa ignorar al asesor — se registra el conflicto
explícitamente:

```json
"conflicto_comentario_asesor": {
  "detectado": true,
  "rule_id": "R1_hipotesis_sin_experimento",
  "descripcion": "el comentario prioriza X, pero la ontología marca Y como bloqueante"
}
```

y ese conflicto forma parte de la `justificacion` dentro de `accion_next` —
el fundador ve tanto lo que sugirió el asesor como por qué el sistema no lo
siguió al pie de la letra. Si no hay contradicción, el comentario pesa
normalmente en la decisión de prioridad, como se describió en el paso 2.

---

## 6. Postgres compartida vs. almacenamiento propio

**Decisión: compartir la misma Neon**, con su propio schema/prefijo de
tablas (`next_action_*`), no una base independiente. Razonamiento:

- **Integridad referencial real.** `next_action_runs.startup_id` puede ser
  una FK real hacia `startups.id` en vez de un identificador externo sin
  garantías — si Startup-Next viviera en otra base, cualquier startup
  borrada o cualquier inconsistencia de id solo se detectaría en tiempo de
  ejecución, no por el propio motor de base de datos.
- **Ya hay un precedente que funcionó**: `ontology-engine` es un servicio
  independiente en Fly.io (igual que se propone para Startup-Next) y sin
  embargo comparte la misma Neon, con sus propias tablas
  (`ontology_concepts`, `startup_facts`, etc.). El patrón ya está probado
  en este proyecto — no hay una razón nueva para romperlo aquí.
- **El histórico completo de una startup queda en un solo lugar.** Reports,
  hechos de la ontología, y ahora runs de Startup-Next conviven en la misma
  base — cualquier vista futura tipo "todo lo que sabemos de esta startup"
  no necesita agregar datos de dos proveedores distintos.
- **Costo operativo marginal**: una conexión más a una instancia que ya
  existe, sin nueva cuenta, sin nueva credencial que gestionar (mismo
  argumento que en la pregunta 4 sobre `pgvector`) y sin un nuevo punto de
  fallo del estilo `ONTOLOGY_ENGINE_URL` que ya causó un incidente real en
  Fase 2 por depender de configuración de un servicio externo.
- **Contra a vigilar, no a resolver ahora**: si el volumen de escritura de
  Startup-Next crece mucho (3 ciclos × varias llamadas a LLM por run,
  multiplicado por muchas startups activas), podría competir por
  conexiones con `startup-advisor` y `ontology-engine`. Esto se resuelve
  con un pool de conexiones o un branch de Neon dedicado cuando aparezca
  el problema — no antes, no como diseño especulativo.

### Aclaración importante: repositorio independiente, no subcarpeta

A diferencia de `ontology-engine` (que es una subcarpeta del mismo repo
`startup-advisor`), **Startup-Next vive en su propio repositorio git**
(`github.com/mcanno/startup-next`), con ciclo de vida de CI/deploy
totalmente separado. Comparte la Neon, pero no el repo. Esto es una
decisión distinta a la de `ontology-engine` y conviene tenerla explícita
para no repetir la confusión que ya surgió una vez al empezar a
implementar.

Consecuencia técnica directa: **Startup-Next necesita su propia
herramienta de migraciones**, apuntando al mismo `DATABASE_URL` de Neon
pero sin depender del Drizzle que vive en el repo de `startup-advisor`
(no hay forma limpia de compartir ese código entre repos sin publicarlo
como paquete, y no vale la pena para esto). Con **Node/TypeScript** ya
confirmado como stack de Startup-Next (igual que `startup-advisor`), la
vía es: un Drizzle propio y separado dentro de `startup-next`, con su
propia carpeta `drizzle/`, su propio `drizzle.config.ts`, y su propio
schema TypeScript (`next_action_runs`, `next_action_clarifications`) —
totalmente independiente del Drizzle de `startup-advisor` en cuanto a
código e historial de migraciones, aunque ambos apunten a la misma
`DATABASE_URL` física. Drizzle soporta esto sin conflicto porque cada
proyecto lleva su propio registro de qué migraciones ya corrió.

Mismo criterio para el cliente HTTP hacia `ontology-engine`: se escribe
en TypeScript replicando el patrón de `src/lib/ontologyEngine.ts` (mismo
lenguaje que el original, más fácil de mantener el paralelismo), pero como
código propio de `startup-next` — no se importa el archivo real porque
vive en otro repo.

**Framework HTTP: Fastify + Zod**, confirmado durante la implementación.
Mantiene el mismo paralelismo con `ontology-engine` que el resto de estas
decisiones: schema de payload declarado una vez (Zod), validación 400
automática (ej. `informe_situacion_ref` faltante) sin código manual de
validación repetido en cada handler — el equivalente más cercano en
Node/TypeScript a FastAPI + Pydantic. Se descarta Express + validación
manual por la misma razón que se descartó un vector store dedicado en la
pregunta 4: no aporta nada aquí y suma código a mantener sin necesidad.

> **Convención de implementación (Hito 1) — leer env vars de forma
> perezosa, no en consts de módulo.** En ESM, los módulos importados se
> evalúan antes que el código propio del módulo que los importa — así que
> si `main.ts` carga `dotenv` y luego importa las rutas, cualquier módulo
> importado que capture `process.env.X` en una const de nivel superior lo
> ve como `undefined`, sin importar que `.env.local` sí se cargue después.
> Esto rompió `auth.ts` en el Hito 1 (`401 invalid API key` con una key
> correcta). La convención en este proyecto, ya seguida por `db/index.ts`
> y ahora también por `auth.ts` y `ontologyEngine.ts`: **leer
> `process.env` dentro de las funciones que lo necesitan, nunca en una
> const de módulo.** Aplica también al orquestador real del Hito 2, que va
> a necesitar leer la API key de Claude.

Cualquiera de las dos piezas (Drizzle propio, cliente HTTP propio) es
segura porque las tablas están namespaced bajo `next_action_*` — no hay
riesgo de colisión con las tablas de `startup-advisor` u
`ontology-engine`, solo dos historiales de migración independientes
conviviendo en la misma base física.

**Para que Claude Code pueda revisar el código real de `ontology-engine`
como referencia de patrón** (cliente HTTP, estructura de servicio
Fly.io, etc.) sin necesidad de fusionar repos, la vía correcta es **"Add
Folder to Workspace"** en VS Code: añades la carpeta del clon local de
`startup-advisor` como una segunda raíz del workspace, junto a la de
`startup-next`. Claude Code puede leer ambas carpetas para consulta, pero
solo escribe/genera archivos dentro de `startup-next` — así no hay
ambigüedad de en qué repo termina cada cambio.

---

## 7. Arquitectura de agentes: LangGraph.js + LangChain.js (Hito 2)

**Decisión: el orquestador, el especialista y el validador se implementan
como nodos de un grafo LangGraph.js**, no como funciones sueltas
encadenadas a mano. Encaja con lo ya diseñado, no es una capa añadida por
capricho:

- El **límite de 3 ciclos** especialista↔validador es exactamente lo que
  LangGraph modela de forma nativa como aristas condicionales cíclicas —
  no hace falta un contador manual, es la forma estándar de trabajar de la
  librería.
- El **bucle de `needs_clarification`** se implementa con `interrupt()`:
  el nodo del orquestador llama a `interrupt(pregunta)` cuando no puede
  resolver una prioridad clara; el grafo se pausa y persiste su estado
  solo. `POST /runs/{id}/respond` retoma el grafo con
  `Command({ resume: respuesta })` en el mismo `thread_id` — que es
  literalmente el `run_id`. No hay que construir un mecanismo de
  pausa/resume propio, es el que ya trae la librería.
- **`.withStructuredOutput(zodSchema)`** sobre `ChatAnthropic`
  (`@langchain/anthropic`) para cada salida de nodo (`accion_next`,
  `validacion`) — reutiliza los mismos schemas Zod que ya validan los
  payloads de Fastify, en vez de definir la forma dos veces.

### Persistencia del grafo: checkpointer propio, separado del contrato de API

LangGraph necesita su propio *checkpointer* Postgres
(`@langchain/langgraph-checkpoint-postgres`, paquete `PostgresSaver`) para
persistir el estado del grafo entre la petición que dispara
`needs_clarification` y la que la resuelve — sin esto, el `interrupt()` no
sobrevive a que la API sea *stateless* entre requests.

- Apunta al mismo `DATABASE_URL` de Neon (mismo criterio que el resto del
  proyecto), pero con sus propias tablas (`checkpoints`,
  `checkpoint_blobs`, `checkpoint_writes`) namespaced en su **propio
  schema de Postgres** (ej. `langgraph`, vía la opción `schema` de
  `PostgresSaver.fromConnString`) — no en `public`, para no mezclarse
  visualmente con `next_action_*`.
- `checkpointer.setup()` crea esas tablas la primera vez — se ejecuta como
  paso explícito de migración/arranque, **no dentro del runtime normal de
  la app** (mismo principio que ya se sigue con Drizzle: las migraciones
  son un paso aparte, no algo que corre en cada request).

**Importante — el checkpointer de LangGraph no reemplaza
`next_action_runs`.** Son dos capas distintas a propósito:

- El checkpointer guarda el estado interno de ejecución del grafo (formato
  específico de LangGraph, mensajes, versiones de canal) — es
  implementación, no contrato.
- `next_action_runs` (con su columna `ciclos` y el resto del esquema de la
  sección 2) sigue siendo **el único contrato que expone `GET /runs/{id}`**.
  Después de cada `invoke`/resume del grafo, se sincroniza lo relevante
  (`status`, `accion_next`, un nuevo elemento en `ciclos`, `resultado`)
  hacia `next_action_runs`. Esto es deliberado: si el día de mañana se
  cambia de framework de orquestación, el contrato de API documentado en
  este archivo no se entera — solo cambia lo que hay detrás del
  sincronizador.

### Modelo por nodo (confirmado)

- **Orquestador → `claude-opus-4-8`.** Razonamiento abierto: pondera
  opciones + comentario del asesor + hallazgos de la ontología, detecta
  ambigüedad real (para decidir si dispara `interrupt()`) y detecta
  conflicto comentario-vs-ontología.
- **Validador → `claude-sonnet-5`.** Juicio acotado contra datos ya
  explícitos (`fidelidad_a_la_accion`, `coherencia_ontologia`), no una
  decisión abierta — no se gana nada usando Opus aquí.

Estos son los valores por defecto, no valores fijos — ver la subsección
siguiente.

### Configuración de modelos: swappable por archivo de configuración, con API key propia por nodo

**El modelo de cada nodo (y su API key) tienen que poder cambiarse sin
tocar código**, vía un archivo de configuración propio — no hardcodeado
dentro de `orchestrator.ts`/`validator.ts`, y no disperso como lecturas
sueltas de `process.env` en cada archivo.

- **`src/config/models.ts`** como única fuente de verdad: exporta
  funciones tipadas (ej. `getOrchestratorModelConfig()`,
  `getValidatorModelConfig()`) que devuelven `{ model: string; apiKey:
  string }`. Cada nodo del grafo construye su `ChatAnthropic` a partir de
  esta función — ningún nodo lee `process.env` directamente ni tiene un
  string de modelo escrito a mano.
- **Env vars por nodo**, con default a lo ya confirmado si no están
  seteadas:
  - `ORCHESTRATOR_MODEL` (default `claude-opus-4-8`)
  - `VALIDATOR_MODEL` (default `claude-sonnet-5`)
- **API key propia por nodo**, no necesariamente compartida:
  - `ORCHESTRATOR_ANTHROPIC_API_KEY` — si no está seteada, cae a una
    `ANTHROPIC_API_KEY` general compartida.
  - `VALIDATOR_ANTHROPIC_API_KEY` — mismo criterio de fallback.
  - Esto deja preparada la estructura para separar cuentas/billing por
    nodo el día que haga falta (ej. si el orquestador con Opus se vuelve
    el grueso del costo y se quiere aislar en otra cuenta), sin tener que
    tocar código entonces — solo configuración.
- Lectura **perezosa** dentro de las funciones (misma convención ya
  registrada en la sección 6 tras el bug de ESM del Hito 1), no en consts
  de nivel de módulo.

### Multi-proveedor, no solo multi-modelo — verificado con Gemma 4 26B (Google)

Lo anterior asumía siempre `ChatAnthropic`. Se extendió con una
**función factory `getChatModel(config, opts)`** en el mismo
`src/config/models.ts` que encapsula el *branching* por proveedor — cada
nodo la llama en vez de construir `ChatAnthropic` a mano, así que el
código del nodo no necesita saber qué proveedor está activo:

- `ModelConfig = { provider: "anthropic" | "google", model, apiKey }`.
- Nuevas env vars: `ORCHESTRATOR_PROVIDER` (default `"anthropic"`),
  `ORCHESTRATOR_GOOGLE_API_KEY` (no reemplaza
  `ORCHESTRATOR_ANTHROPIC_API_KEY`, coexisten según el `provider` activo).
  Sin default cross-provider: si `provider="google"`, `ORCHESTRATOR_MODEL`
  tiene que venir seteado explícito.
- `getValidatorModelConfig()`/`getSpecialistModelConfig()` devuelven la
  forma completa `ModelConfig` aunque sigan fijas en `provider:
  "anthropic"` por ahora — agregarles otro proveedor más adelante no
  rompe nada que ya use `getChatModel()`.

> **Hallazgo real, al revés de lo esperado**: se probó `ORCHESTRATOR_MODEL
> = gemma-4-26b-a4b-it` (Gemma 4 26B, Mixture-of-Experts ~4B activos por
> token, vía la API de Gemini de Google, no local) para verificar que el
> mecanismo de swap funciona de verdad con un proveedor distinto, no solo
> con la función de configuración en verde. La sospecha inicial era que
> `thinking`/structured-output volviera a chocar como con Claude — pero
> el problema real fue otro: **Gemma 4 no soporta ningún valor de
> `thinkingConfig`** (Google solo documenta *thinking* para la familia
> Gemini 2.5/3.x) — cualquier valor explícito devuelve `400 Bad Request`.
> `getChatModel()` omite `thinkingConfig` por completo cuando el proveedor
> es `google`, con la razón documentada in-line para que no se repita el
> intento.
>
> **E2E completa verificada con Gemma 4**: 0 fallos de parseo en el log
> del servidor (el retry layer no hizo falta), aprobó en ciclo 1 igual
> que con Opus, timing comparable (`accion_next` en 12.6s, run completo
> en 66s). La calidad de `justificacion` es correcta pero notablemente
> menos granular que la de Opus — decide bien, no articula el "por qué
> no" de cada opción descartada con el mismo detalle (consistente con un
> MoE ~4B activos vs. un modelo de razonamiento abierto). Anecdótico
> (n=1): un desliz gramatical menor en español (subjuntivo incorrecto)
> que no había aparecido en ninguna salida de Claude en este proyecto.

### Prueba obligatoria: cambio de modelo (parte del Definition of Done del Hito 2)

No es opcional ni un nice-to-have — **el hito no se considera cerrado sin
este test**, exactamente como pediste. Cubre:

1. Sin ninguna env var seteada → `getOrchestratorModelConfig()` /
   `getValidatorModelConfig()` devuelven los defaults confirmados
   (`claude-opus-4-8` / `claude-sonnet-5`) y `apiKey` cae a
   `ANTHROPIC_API_KEY`.
2. Con `ORCHESTRATOR_MODEL` / `VALIDATOR_MODEL` seteadas a otro modelo
   válido → la función devuelve exactamente ese valor, no el default —
   confirma que el cambio de modelo por configuración realmente surte
   efecto, no solo que existe la variable.
3. Con `ORCHESTRATOR_ANTHROPIC_API_KEY` seteada → se usa esa, no la
   general — confirma el aislamiento de key por nodo.
4. Con `ORCHESTRATOR_ANTHROPIC_API_KEY` ausente → cae correctamente a
   `ANTHROPIC_API_KEY`.

No hace falta invocar al LLM real en este test — es una prueba sobre la
función de configuración, no sobre la respuesta del modelo. El proyecto
todavía no tiene test runner fijado; se propone **vitest** por defecto
(nativo en ESM, coherente con Node 22 + Fastify ya usados, y evita el
mismo tipo de sorpresa de orden de evaluación que ya mordió una vez en el
Hito 1) — a confirmar o cambiar si se prefiere otra cosa antes de que
Claude Code lo instale.


`comentarioAsesor?`, `maxCycles`, `maxClarifications`,
`hallazgosOntologia` (se refetch en cada nodo que lo necesita, no se
cachea una sola vez), `accionNext?`, `borrador?` (transitorio, seteado por
`specialist`, leído por `validator`), `cycle` (default 0), `ciclos`
(reducer: concat, default `[]`), `status`, `resultado?`.

Nodos:
- **`orchestrator`**: si `state.accionNext` ya existe (reentrada tras
  rechazo del validador), es un *pass-through sin LLM* — no vuelve a
  decidir la prioridad, solo re-enruta. Si no existe todavía, llama al
  LLM; si hay ambigüedad real, `interrupt({pregunta})` (hasta 2 veces,
  contado internamente); al resolver, si `especialista_disponible` es
  `false`, fija `status: "sin_especialista"` + `resultado.no_respuesta`
  directo, sin gastar ciclos.
- **`specialist`**: sigue siendo el mock existente en este hito. **Regla
  añadida**: cuando `cycle > 0`, recibe también la `validacion` del ciclo
  anterior (`state.ciclos[cycle - 1].validacion`) como parte de su input
  — para que el especialista real (Hito 3) pueda corregirse en vez de
  repetir el mismo borrador a ciegas. Con el mock esto no cambia el
  resultado observable, pero el cableado debe existir desde ahora.
- **`validator`**: llamada real a Claude (`fidelidad_a_la_accion` +
  `coherencia_ontologia`); `calidad_y_fuentes` sigue mock. `aprobado =
  fidelidad.cumple && coherencia.cumple`. Arma el `Ciclo` y lo agrega a
  `state.ciclos`.

Aristas:
```
START → orchestrator
orchestrator → (status === "running" ? "specialist" : END)              [condicional, lista negativa — ver nota]
specialist → validator                                                  [fija]
validator → (aprobado ? END : cycle >= maxCycles ? END : "orchestrator") [condicional]
```

> **Hallazgo real y convención resultante (pieza `peticion_incoherente`,
> sección 9)**: la primera versión de la arista `orchestrator →
> specialist` chequeaba explícitamente `status === "sin_especialista"`
> para cortar a `END` — una **lista positiva** de un solo status
> terminal. Al agregar `peticion_incoherente` como segundo status
> terminal, cualquier status que no fuera exactamente
> `"sin_especialista"` caía por default a `specialist`, que explotaba
> sin `accionNext`. **Convención adoptada**: la condición se invirtió a
> lista negativa — solo avanza a `specialist` si `status === "running"`,
> cualquier otro valor (los terminales actuales y cualquiera que se
> agregue después) va a `END` por default. Evita que agregar un status
> terminal nuevo en el futuro repita este mismo bug por omisión.

El orquestador **no re-razona la prioridad en cada reentrada** — el
`accion_next` ya fue validado contra la ontología una vez al principio del
run; lo que necesita mejorar en un reintento es la ejecución del
especialista, no la elección de qué trabajar. Por eso la reentrada es
pass-through, apoyada en la regla de feedback de arriba para que el
reintento tenga sentido.

### Estrategia de schemas: subconjunto, no la forma completa

`AccionNext`, `Ciclo`, etc. migran de interfaces TS planas
(`src/types.ts`) a Zod (`src/schemas.ts`, con los tipos TS inferidos vía
`z.infer`, no escritos a mano). Pero **`.withStructuredOutput()` se aplica
sobre un subconjunto de esos schemas, no la forma completa**: al
orquestador no se le pide que devuelva `hallazgos_ontologia` ni
`opciones_descartadas` — esos ya se conocen de datos reales
(`ontology-engine`, las opciones del informe); pedírselos al modelo sería
invitarlo a inventarlos. Solo se le pide lo que realmente decide:
`elegido_id`, `justificacion`, `especialista_requerido`, y el flag de
conflicto con la ontología. El código completa el resto. Mismo criterio
para el validador: solo `fidelidad.cumple/notas` y
`coherencia.cumple/notas` — `calidad_y_fuentes` sigue mock y
`hallazgos_ontologia` reales se inyectan desde el ontology-engine, no se
piden de vuelta al modelo.

### Reintento de structured output (capa de robustez permanente)

`src/lib/structuredOutputRetry.ts` envuelve las tres llamadas
`.withStructuredOutput()` (orquestador, especialista, validador): hasta 3
intentos, pero **solo** ante `OutputParserException`/
`lc_error_code === "OUTPUT_PARSING_FAILURE"` — cualquier otro tipo de
error (auth, red, rate limit) se propaga de inmediato sin reintentar, para
no esconder fallas reales detrás de un reintento ciego.

Motivado por un bug real encontrado con el corpus completo: con contenido
denso (5 recomendaciones sustanciosas contra chunks reales, no las 3
sembradas a mano del Hito 3), la llamada del especialista omitió
intermitentemente el campo requerido `resumen_estrategia` del structured
output, y ese fallo de parseo escalaba directo a `status: "failed"` —
la misma categoría que usábamos para errores técnicos reales
(`ontology-engine` caído, etc.), cuando en realidad es una categoría
distinta: fiabilidad puntual de una llamada a un LLM, no un fallo del
sistema.

> **Caveat honesto, no ocultado**: en las 4 corridas de prueba
> posteriores al fix, el bug **no volvió a reproducirse** (0 fallos de
> parseo en los logs) — la capa de reintento quedó instalada como red de
> seguridad, pero nunca se ejercitó de verdad. No se puede afirmar que
> "arregló" este fallo intermitente específico, solo que existe como
> mitigación razonable si vuelve a ocurrir. Se prefirió documentarlo así,
> con la incertidumbre explícita, en vez de reclamar una corrección
> verificada que no se probó.

> **Actualización (aislamiento de Neon, paso 2)**: el retry **sí se
> ejercitó** por primera vez en una prueba de humo con una "opción"
> autorreferencial (una descripción de la propia prueba de
> infraestructura, no una tarea real de fundador) — y los 3 intentos
> fallaron por igual. Esto no contradice el diseño, lo precisa: el
> reintento ayuda contra fallos **probabilísticos** (el modelo omite un
> campo al azar con contenido normal, visto en las corridas con datos
> reales), pero no contra fallos **determinísticos** provocados por un
> input inusual — si el contenido mismo confunde al modelo de forma
> consistente, repetir la misma llamada 3 veces produce el mismo
> resultado roto las 3 veces. La prueba E2E con contenido realista
> (opciones reales de fundador) corrió limpia, sin reintentos visibles —
> el problema apareció específicamente con contenido meta/de prueba, no
> con el tipo de entrada que va a recibir en producción.

### Sincronización hacia `next_action_runs`

Después de cada `invoke`/resume del grafo:
- Si el resultado trae `__interrupt__` → persiste la pregunta en
  `next_action_clarifications` y pone `status: "needs_clarification"`.
- Si el grafo llegó a `END` → lee el estado final y pisa `status`,
  `accion_next`, `ciclos`, `resultado`, `especialista_usado`, `cycle` en
  `next_action_runs` tal cual.

### Ejecución asíncrona real + webhook (confirmado e implementado)

**Verificado en vivo contra Neon y Claude reales**: `POST
/runs/{id}/start` devolvió control en 14s (la decisión propia del
orquestador) en vez de los 20-26s previos que incluían los 3 ciclos
completos; `GET /runs/{id}` reflejó el progreso en background hasta
`max_cycles_reached`; el webhook recibió exactamente un POST con
`{"run_id": "...", "status": "max_cycles_reached"}` en el momento
correcto.

**Mecanismo: streaming con iterador manual y consumo desacoplado**,
descartadas las otras dos opciones evaluadas:

- **Descartada: dos invocaciones separadas del grafo vía
  `interruptAfter: ["orchestrator"]`.** Pausaría en cada paso por ese
  nodo, incluidas las reentradas pass-through tras un rechazo del
  validador (que también pasan por `orchestrator` antes de reenrutar a
  `specialist`) — necesitaría lógica extra para distinguir "primera
  resolución" de "reentrada", y cada continuación implicaría invocar el
  grafo completo de nuevo.
- **Descartada: cola de trabajo.** Es infraestructura nueva (persistencia
  de jobs, workers) para un problema que no la necesita todavía — un solo
  proceso Node, sin réplicas ni necesidad de reintentos distribuidos.
  Sería la respuesta correcta si el servicio escalara horizontalmente,
  pero no está en el radar de este hito.
- **Elegida: `getGraph().stream(input, { streamMode: "values",
  configurable: { thread_id } })`**, consumido con el iterador manual
  (`stream[Symbol.asyncIterator]()`) en vez de `for await...of` — así se
  puede parar de leer sin matar el generador (un `break` en `for await`
  le manda `.return()` y lo corta) y retomarlo después. No toca nada de
  cómo ya funcionan `interrupt()`/`Command({resume})` — es el mismo
  mecanismo de ejecución, solo cambia cómo se consume:
  1. Lee chunks hasta el primer punto de "soltar": el chunk trae
     `__interrupt__`, o trae `accion_next` ya resuelto (con o sin
     `especialista_disponible`). Ahí responde el HTTP.
  2. Sigue drenando el mismo iterador en una función async sin
     awaitear (fire-and-forget) — cada chunk siguiente se sincroniza a
     `next_action_runs` (`GET /runs/{id}` refleja `cycle: 2 de 3, status:
     running` mientras el loop sigue). Al llegar el iterador a `END`, si
     hay `callback_url`, dispara el webhook.
  3. `/start` y `/respond` usan el mismo patrón — no hace falta tratarlos
     distinto.

**Webhook — payload fino, confirmado**: `{ run_id, status }`, nada más.
Consistente con el criterio ya seguido en todo este documento de mantener
`GET /runs/{id}` como única fuente de verdad del contrato completo — un
payload rico duplicaría la forma de `accion_next`/`informe_final`/
`no_respuesta` en un segundo lugar a mantener sincronizado. El costo de un
round-trip extra para quien reciba el webhook es bajo comparado con eso.

- `callback_url` como columna nueva (`text`, opcional) en
  `next_action_runs`, aceptado opcionalmente en `POST /runs`.

### Paquetes nuevos

```
@langchain/langgraph
@langchain/core
@langchain/anthropic
@langchain/langgraph-checkpoint-postgres
```

---

## Resumen de decisiones pendientes de tu validación

1. ~~Confirmada~~ — `GET /runs/{run_id}` + webhook opcional es suficiente,
   incluido el ida-y-vuelta extra por `needs_clarification`.
2. ~~Resuelta~~ — el histórico de ciclos se guarda como array jsonb
   (`ciclos`) dentro de `next_action_runs`, no como tabla separada.
3. ~~Resuelta~~ — solo dos invocadores confirmados (app y asistente tipo
   Hermes/OpenClaw), ambos con informe de `startup-advisor` preceptivo;
   solo el comentario del asesor es opcional.
4. ~~Resuelta (decisión mía)~~ — `pgvector` sobre la misma Neon. La escala
   del corpus (pocos miles de chunks, no millones) no justifica un vector
   store dedicado, y mantiene todo bajo el mismo ORM/conexión que el resto
   del stack. Detalle y condición de reversión en la sección 4.
5. ~~Resuelta~~ — el comentario del asesor sigue siendo opcional, pero la
   ontología actúa como restricción dura sobre él: si sugiere una dirección
   que contradice una regla activa, el orquestador no la adopta sin más;
   registra el conflicto en `accion_next.conflicto_comentario_asesor` y lo
   explica en la `justificacion`.
6. ~~Resuelta (decisión mía)~~ — Neon compartida con schema propio
   (`next_action_*`), siguiendo el mismo patrón que `ontology-engine`.
   Detalle y condición de reversión en la sección 6.
7. ~~Resuelta~~ — dos endpoints (`crear` + `start`), pero la resolución de
   la acción prioritaria es una única llamada al orquestador.
8. ~~Resuelta~~ — `max_cycles_reached` devuelve una `no_respuesta`
   argumentada, priorizando los `hallazgos_ontologia` acumulados en los 3
   ciclos como motivo principal, por encima de razones genéricas del
   validador.
9. ~~Resuelta~~ — MinerU corre offline en un notebook reutilizable, no
   como servicio; el runtime de `startup-next` solo lee de `pgvector` ya
   poblado.
10. ~~Resuelta~~ — especialista único de esta fase: **MVP**. Nueva
    sub-pregunta que se abre a partir de esto: si la `accion_next` que
    decide el orquestador realmente pertenece a otro rol (ej.
    financiación), esta fase previa no tiene especialista adecuado —
    ¿se enruta igual a MVP con una nota de que no es el encaje ideal, o se
    trata como `needs_clarification` explicándole la limitación al
    fundador?
11. ~~Resuelta~~ — `opciones_propuestas` es siempre un campo estructurado
    provisto por `startup-advisor`; Startup-Next no necesita parsear
    informes en prosa libre. Si el campo aún no existe en `ReportContent`,
    queda como trabajo previo en ese repo, pero el contrato de forma ya
    está fijado.
12. ~~Resuelta~~ — máximo 2 preguntas de aclaración. Si tras la segunda
    respuesta sigue sin haber prioridad clara, el orquestador decide con lo
    que tiene y lo marca explícitamente
    (`accion_next.resuelto_sin_aclaracion_completa: true`), sin volver a
    preguntar. No consume ciclos del contador de `max_cycles`.
13. ~~Resuelta~~ — el validador armoniza tres variables en cada ciclo:
    fidelidad de la respuesta del especialista respecto a la `accion_next`
    asignada, coherencia con la ontología, y calidad/fuentes. Si no logra
    armonizarlas tras 3 ciclos, la `no_respuesta` final explica cuál de las
    tres falló y con qué argumentos, priorizando los de la ontología.

---

## 8. Próxima fase: separación real de módulos + modo genérico de la ontología

### Por qué esta sección reencuadra todo lo anterior

Las secciones 1-7 se construyeron asumiendo que `startup-next` podía
apoyarse en el estado real de una startup concreta — vía Neon compartida
(pregunta 6) y llamadas reales a `ontology-engine` con hechos ya
registrados por `startup-advisor` (Fase 2). Eso es lo que se probó y
funcionó en el Hito 3 (`hallazgos_ontologia` con UUIDs reales de
hipótesis, `conflicto_comentario_asesor` contra hechos reales).

**Esa dependencia nunca debió ser obligatoria.** La intención real, ahora
explícita: `startup-advisor` y `startup-next` son **dos módulos
independientes que hacen cosas distintas** —
`startup-advisor` diagnostica el estado actual de una startup a partir de
una conversación guiada + la ontología; `startup-next` ayuda a identificar
los requisitos de la *siguiente tarea*, sin necesitar saber (ni tener
acceso a) el estado real de ninguna startup en particular. Pueden
relacionarse, pero **la relación es opcional, no estructural**.

### El modelo correcto: un modo base + un enriquecimiento opcional

**Modo base (siempre disponible, para cualquier invocación)**: dada una
tarea X — venga de un PDF de `startup-advisor`, de texto libre del
fundador, o de un comentario del asesor —, el orquestador consulta a la
ontología **en abstracto**: ¿qué fases/estados presupone metodológicamente
la tarea X, según la estructura del TBox (43 conceptos, 21 relaciones)?
No verifica si *esta* startup en particular cumple esas fases — no tiene
forma de saberlo, ni debe tenerla. Devuelve esa lista de prerrequisitos
como información — nunca como bloqueo, nunca como juicio.
`Startup-Next no fuerza, ni presupone, ni juzga. Solo informa y aconseja.`
Esto aplica igual si el comentario del asesor sugiere algo distinto: no se
lo contrasta contra hechos reales (no los hay), se informa igual cuáles
son las fases que la metodología presupone para X, dejando que el
fundador/asesor reconcilien con lo que saben de su situación real.

**Enriquecimiento opcional (solo si se comparte un `startup_id` real con
hechos registrados en `ontology-engine`)**: si en algún momento se decide
vincular la invocación a una startup con historial real (decisión del
fundador o de Hermes, nunca automática ni obligatoria), el orquestador
puede además consultar `validate()`/`graph` para esa startup puntual y
enriquecer la respuesta con hallazgos reales — esto es exactamente lo que
ya se construyó y probó en el Hito 2/3. Sigue siendo válido como
mecanismo, pero pasa a ser **una mejora sobre el modo base, no el modo
base en sí**.

### Trabajo pendiente para el modo base — investigado y diseñado, pendiente de implementar

El modo base depende de una capacidad que `ontology-engine` no tiene hoy:
razonar sobre el TBox en abstracto ("¿qué precede al concepto/tarea X?")
sin referencia a hechos de ninguna startup — los endpoints actuales
(`GET /concepts/{id}`, `GET /concepts/{id}/subclasses`,
`GET /startups/{id}/graph`, `validate()`) trabajan sobre conceptos
individuales o sobre hechos de una startup específica, no sobre esto.

**Investigación real completada** (no se asumió la forma del grafo de
memoria — se verificó `domain_ontology.py`, `graph.py` y `rules.py`
directamente):

- Existe una relación de precedencia explícita pero angosta (`precede_a`/
  `precede_a_2`/`precede_a_3`, solo 3 aristas, encadenando las 4 fases de
  Customer Development) y una cadena de precedencia **implícita** más
  rica pero sin etiquetar como tal (`Hypothesis --se_testea_con-->
  Experiment --produce--> MVP --se_mide_con--> Metric
  --genera_aprendizaje--> ValidatedLearning
  --informa_decision_pivot/perseverar--> Pivot/Persevere`) — confirmada
  como precedencia real porque `R1`/`R2` de `rules.py` ya la tratan así
  en la práctica (sobre hechos, nunca en abstracto todavía).
- `graph.py` ya carga el TBox puro (`load_tbox()`) independiente de
  cualquier startup — no hace falta construir el grafo, solo una forma
  nueva de recorrerlo. `ancestors()` solo hace BFS sobre `es_subclase_de`
  (taxonomía); `neighbors_via()` es de un solo salto. Ninguna de las dos
  sirve tal cual para "qué precede a X" de forma transitiva y
  multi-relación.
- De los 7 roles de especialista, solo **2 tienen ancla directa** en el
  TBox hoy: `mvp` → `MVP`, `modelo_negocio` → `BusinessModelCanvas`.
  `escalado` tiene ancla parcial (`EngineOfGrowth`/`InnovationAccounting`,
  aproximación razonable, no match exacto). Los otros 4
  (`ideacion`, `financiacion`, `organizacion`, `administracion`) **no
  tienen ningún concepto de anclaje todavía** — no bloquea nada ahora
  (solo el especialista MVP está construido), pero cada uno de esos 4
  necesita modelado nuevo en el TBox el día que se implemente ese
  especialista.

**Decisiones de diseño confirmadas**:

1. **`is_sequential: bool` en el dataclass `Relation`**, no una allowlist
   hardcodeada en la función de traversal — la marca de si una relación
   es de orden vive junto a la relación misma, no en un archivo aparte
   que alguien tiene que recordar sincronizar cada vez que se agregue una
   relación nueva.
2. **Relaciones marcadas `is_sequential=True`**, según la evidencia real
   de `rules.py`: `precede_a`, `precede_a_2`, `precede_a_3`,
   `se_testea_con`, `produce`, `se_mide_con`, `genera_aprendizaje`,
   `informa_decision_pivot`, `informa_decision_perseverar`. El resto de
   las 21 queda en `False`.
3. **Función nueva de traversal**, `precedents_of(concept_id) ->
   list[Concept]` en `graph.py`: BFS/DFS multi-relación filtrando solo
   `is_sequential=True`, verificando primero (no asumiendo) que la
   dirección origen→destino significa "origen precede a destino" de
   forma consistente en las 6 relaciones de la cadena.
4. **Endpoint nuevo**: `GET /concepts/{id}/prerequisitos`, devuelve
   `{ concept_id, prerequisitos: [{ concept_id, relacion, distancia }] }`
   — `prerequisitos: []` si no hay precedentes o el id no existe, nunca
   un error (es información, no una validación que pueda fallar).

### Secuencia de trabajo acordada

1. **`ontology-engine` — cerrado de verdad: código, datos y despliegue,
   los tres verificados contra producción real.**
   `is_sequential: bool` en `Relation` (9 relaciones marcadas, basado en
   evidencia real de `rules.py`), `precedents_of()` en `graph.py`
   (BFS/DFS multi-relación sobre el TBox ya cargado por `load_tbox()`,
   devuelve `list[dict]` con `concept_id`/`relacion`/`distancia` —
   deliberadamente no `list[Concept]`, para no ensuciar el tipo de
   dominio con campos que solo tienen sentido en el contexto de esta
   consulta puntual, y porque `graph.py` está desacoplado a propósito de
   `domain_ontology.py` para poder testearse sin Postgres). Endpoint
   `GET /concepts/{id}/prerequisitos` confirmado con datos reales:
   `MVP` → `Experiment` (distancia 1) → `Hypothesis` (distancia 2) — el
   gap exacto que la investigación había detectado (con solo `precede_a`
   literal esto era `[]`); `CompanyBuilding` confirma que la cadena
   explícita de Customer Development sigue funcionando en paralelo sin
   pisar la implementación nueva; conceptos sin precedentes o
   inexistentes devuelven `prerequisitos: []`, nunca error. Migración
   SQL + `seed.py` corridos contra la Postgres real de `ontology-engine`
   (la compartida con `startup-advisor` — no la que se va a aislar en el
   paso 2, esa es la de `startup-next`).

   > ⚠️→✅ **Gap real descubierto y cerrado**: la primera verificación
   > (Postgres real + instancia local) nunca había llegado a
   > `ontology-engine.fly.dev`, la instancia real que `startup-next`
   > consulta en producción — la primera prueba de modo base contra el
   > servicio desplegado devolvió `hallazgos_ontologia: []` por un 404
   > silencioso (`getPrerequisitos()` degradando con gracia, diseñado
   > para fallos de red, no para distinguir "no desplegado" de "sin
   > prerrequisitos"). Exactamente el patrón de incidente que el
   > documento de traspaso original de este proyecto ya advertía
   > ("código con fix nunca desplegado"). **Ya resuelto**: `flyctl
   > deploy` corrido (bloqueado primero por Avast interceptando TLS
   > tanto en el build remoto como en `pip` local — mismo root CA en
   > los dos casos, confirmado antes de pausarlo; ya reactivado
   > después), y verificado en vivo contra
   > `https://ontology-engine.fly.dev` real, byte a byte idéntico a lo
   > visto local en los 4 casos (`MVP`, `Founder`, `NoExiste`,
   > `CompanyBuilding`).
2. **Aislamiento de Neon — implementado y verificado.** Proyecto Neon
   nuevo y físicamente separado (`ep-flat-cell-asie5u6x`), pgvector
   0.8.1 habilitado, migración generada desde cero sin ninguna FK
   externa (solo la interna `clarifications→runs`), `rag_chunks` con
   HNSW, schema `langgraph` del checkpointer, corpus recargado vía
   `rag-ingest load` contra los `.jsonl` ya existentes (sin repetir
   `parse`) — 1.126 chunks confirmados, mismo número exacto que antes.
   Smoke test con `startup_id` inventado (sin ninguna startup real
   detrás): `201`/`202`, sin errores de FK ni "startup no encontrada".
   E2E completa contra la base aislada: `approved` en ciclo 1, fuentes
   legibles reales. El aislamiento es real, no solo de intención.
3. **Punto de entrada ergonómico — decisiones confirmadas, pendiente de
   implementar**:
   - **`POST /informes/parse`, endpoint separado** (no embebido en
     `POST /runs`): recibe PDF (multipart) o texto libre (JSON), sin
     comentario del asesor en esta llamada — el comentario y su
     `aplica_a` se agregan después, en `POST /runs`, una vez que ya
     existen ids de opciones reales contra qué aplicarlos. Devuelve
     `{ opciones_propuestas: [...] }` — una sola opción si vino texto
     libre (la intención declarada, sin nada que elegir), varias si vino
     PDF. Reusable tal cual por la UI web y por Hermes, sin que cada uno
     reimplemente su propio parseo.
   - **Detección automática para el modo enriquecido, no un flag
     explícito**: el orquestador consulta `GET /startups/{id}/graph`
     (`getStartupGraph()`) con el `startup_id` recibido; si
     `individuals.length > 0`, usa el modo enriquecido (Hito 2/3, ya
     construido, incluyendo `validate()`); si `individuals.length === 0`,
     cae solo al modo base vía `GET /concepts/{id}/prerequisitos` — sin
     que ningún invocador tenga que declarar explícitamente cuál modo
     quiere. Compensa menos superficie de API nueva a cambio de que
     compartir un `startup_id` real (aunque sea sin querer) activa el
     enriquecimiento sin aviso explícito — decisión de privacidad
     tomada conscientemente, no un descuido.

     > **Hallazgo real (paso 3)**: la señal de "vacío" no puede ser
     > `validate()` — `rules.py` (R1-R4) evalúa reglas sobre individuos
     > existentes, así que una startup **sin ningún individuo
     > registrado** devuelve `hallazgos: []`, exactamente igual que una
     > startup real que cumple todo perfecto. `validate()` no puede
     > distinguir "no hay datos" de "hay datos y están bien". La señal
     > correcta es `graph().individuals.length > 0` — y solo se llama a
     > `validate()` después de confirmar que sí hay individuos, lo que
     > además ahorra una llamada HTTP en modo base.
   - de ahí en más usa el pipeline ya construido sin cambios.

**Nada de las secciones 1-7 se descarta** — el contrato de API, el
esquema de `next_action_runs`, el `StateGraph` de LangGraph, el
especialista real con RAG, todo sigue siendo la base sobre la que se
construye esto. Lo que cambia es qué se le pide a la ontología por
defecto, y de dónde vienen los datos que hoy se comparten por Neon.

### Secuencia completa — cerrada, con evidencia real en cada paso

- **Paso 1** (`ontology-engine`): código + datos + despliegue,
  verificados los tres contra producción real
  (`https://ontology-engine.fly.dev`).
- **Paso 2** (aislamiento de Neon): proyecto físicamente separado, sin
  FK a `startups`, corpus recargado (1.126 chunks), smoke test con
  `startup_id` inventado y E2E completa confirmados.
- **Paso 3** (punto de entrada + modo base/enriquecido): `POST
  /informes/parse` (PDF y texto libre) y la detección automática de modo
  en el orquestador, probados lado a lado — y la pieza que dependía del
  despliegue del paso 1 (`PREREQUISITO_GENERICO` en modo base) confirmada
  contra el servicio real, no degradada a `[]`.

`startup-next` y `startup-advisor` quedan, a partir de acá, genuinamente
independientes: ninguna credencial de uno alcanza los datos del otro, la
relación entre ambos es opcional (vía `startup_id` compartido a
propósito, detectado automáticamente) y nunca estructural.

---

## 9. Simplificación de la entrada + identificación de usuario — implementado y probado

**Estado: implementado y verificado en ambos repos.** Backend:
`peticion_incoherente` cableado de punta a punta (schema, prompt, grafo,
`no_respuesta`), confirmado con una entrada real incoherente (una
factura) devolviendo `status: "peticion_incoherente"` con
`ciclos_intentados: 0`, y regresión del camino feliz confirmada aparte
(no rompió nada). Frontend: login por magic link (`jose` + `resend`,
`ALLOWED_EMAILS` como lista de restricción real, misma respuesta exista o
no el email en la lista — confirmado con dos requests idénticas),
`middleware.ts` gateando `/` y `/runs/*` (confirmado con curl: sin cookie
→ 307, con cookie → 200), `comentario_asesor` retirado del formulario
(sigue existiendo como opcional en el backend, decisión B). Único
pendiente: `RESEND_API_KEY` real para probar el envío efectivo de
emails — el resto de la cadena (generación/verificación de tokens,
cookie de sesión) ya está confirmado funcionando.

### Administración dinámica de emails permitidos — implementado y probado

`ALLOWED_EMAILS` como env var resuelve la restricción real de acceso,
pero cualquier cambio (agregar/sacar un email) exige editar
`.env.local` y reiniciar/redesplegar — demasiada fricción si la lista
cambia con cierta frecuencia. Se reemplaza por una tabla + un rol de
superadministrador, sin inventar un mecanismo de auth nuevo — reusa el
login por magic link ya construido, con un chequeo de rol encima.

- **Tabla `allowed_emails`** en la Neon propia de `startup-next` (la ya
  aislada del paso 2) — no en `startup-next-ui`, que nunca toca una base
  de datos directamente, solo habla con la API del backend. Sin prefijo
  `next_action_` (mismo criterio que `rag_chunks`: el prefijo es para la
  familia de tablas del ciclo de vida de un run, no para todo lo que
  vive en esta Neon — esto es un concern de auth).
- **`SUPERADMIN_EMAIL`** en `startup-next-ui/.env.local` — un email que
  siempre puede pedir el magic link, sin importar el contenido de la
  tabla (resuelve el problema del huevo y la gallina: si la tabla
  arranca vacía, alguien tiene que poder entrar para poblarla). Al
  loguearse con ese email exacto, la UI muestra una sección
  "Administrar accesos" que nadie más ve.
- **Endpoints en `startup-next` (backend), confirmados con 11 chequeos
  reales contra la Neon aislada**: separación de keys verificada en
  ambos sentidos (`API_KEY_ADMIN` contra `/check` → 401,
  `API_KEY_APP` contra `/list` → 401), round-trip completo
  (check→add→check→list→add repetido idempotente→delete→check→delete
  repetido → 404 correcto):
  - `GET /admin/allowed-emails/check?email=...` → `{ allowed: bool }` —
    protegido con `API_KEY_APP`.
  - `GET /admin/allowed-emails`, `POST /admin/allowed-emails`,
    `DELETE /admin/allowed-emails/{email}` — protegidos con
    **`API_KEY_ADMIN`**, cuarta credencial nueva, distinta de
    `API_KEY_APP`/`API_KEY_HERMES`.
  - Guard por ruta (`requireApiKey` factory), no por plugin — a
    diferencia de `/runs/*`/`/informes/*` (guard único vía
    `addHook("preHandler", ...)` a nivel de plugin, porque comparten el
    mismo requisito), las 4 rutas de `/admin/*` necesitan guards
    distintos entre sí.
- **Del lado de `startup-next-ui`**: `API_KEY_ADMIN` server-side en
  `.env.local`, usada solo por rutas API nuevas
  (`/api/admin/allowed-emails*`) que la sección de administración llama.
  `/admin` como ruta separada (no una sección condicional en `/`, que
  tiene un solo trabajo). Server Components + `router.refresh()` para
  las mutaciones, en vez de `useEffect`+`fetch` en cliente — arquitectura
  más simple (sin round-trip extra en la carga inicial) que además
  resolvió de raíz un error de lint (`react-hooks/set-state-in-effect`)
  que ya había aparecido antes en este mismo proyecto (`app/login/page.tsx`).

  > **Hallazgo de seguridad real, encontrado y corregido sin que se
  > pidiera explícitamente**: gatear el acceso solo en `/admin/page.tsx`
  > no alcanza — cualquiera con acceso de red podría llamar directo a
  > `/api/admin/allowed-emails*` sin pasar nunca por la página, sin
  > ningún chequeo de sesión, y el proxy reenviaría igual con
  > `API_KEY_ADMIN` server-side. El chequeo de superadmin se agregó
  > **dentro de cada ruta API también**, no solo en la página — defensa
  > en cada capa, no en un solo punto de entrada asumido como suficiente.

  Confirmado en navegador con 6 chequeos reales: sin sesión → redirect a
  `/login`; sesión no-superadmin → "No autorizado" y sin link visible;
  superadmin → lista vacía inicial, agregar funciona, link visible.

  > Nota no bloqueante: Next.js 16.2.10 marca `middleware.ts` como
  > convención deprecada a favor de `proxy.ts` — sigue funcionando, es
  > solo warning, pendiente de migrar sin apuro.

Con esto, **todo lo confirmado en esta sección (comentario del asesor
retirado de la UI, PDF/texto excluyentes, dos secciones distinguidas en
el informe, `peticion_incoherente`, login por magic link, y la
administración dinámica de accesos) está implementado y probado de
punta a punta en ambos repos.**


Tras cerrar la secuencia de separación de módulos, revisando la UI
reactivada surgieron 4 decisiones que simplifican la entrada y cierran
un gap de identificación que había quedado abierto:

### Sin control de acceso por startup

Se evaluó y **se descartó** un modelo de roles
(`founder`/`advisor`, `allowed_startup_ids`) para restringir qué
`startup_id` puede consultar cada usuario — `startup-next` no necesita
eso. Solo hace falta saber **quién puede usar la herramienta en
general**, no qué startup puede tocar cada quien. Esto también descarta,
por ahora, el endpoint `GET /runs` (listado) y cualquier vista de
dashboard multi-startup que se había considerado para un rol asesor —
no hacen falta si no hay control de acceso por startup que dashboard-ear.

### Identificación de usuario: login liviano por email (magic link)

Proporcional al riesgo real: la respuesta de `startup-next` vía la UI
es **puramente informativa** (el fundador la lee, no dispara ninguna
acción por sí sola) — no hace falta autenticación fuerte, alcanza con
saber quién preguntó. Login sin contraseña por email (magic link) antes
de acceder al formulario, sin tabla de permisos por startup.

**Vía Hermes, la identificación fuerte se resuelve en Hermes, no en
`startup-next`.** Justificación: si la respuesta puede derivar en un
conjunto de acciones que Hermes ejecuta autónomamente (no solo
información leída por una persona), el riesgo es mayor — pero ese
riesgo se gestiona en el sistema que va a actuar (Hermes, que ya es
privado/personal del fundador por diseño), no reimplementado en
`startup-next`. `startup-next` sigue confiando en la llamada de Hermes
vía `API_KEY_HERMES` (ya existente), sin reverificar al fundador de
nuevo de este lado.

### Entrada simplificada: PDF *o* texto libre, excluyentes, sin comentario del asesor en la UI ni en Hermes

- **PDF y texto libre son mutuamente excluyentes** en ambos invocadores
  (UI y Hermes) — llenar uno inhabilita el otro. Ya no hay ninguna
  combinación de "ambos a la vez" que soportar en `/informes/parse`.
- **El comentario del asesor se retira de los dos flujos de entrada
  actuales** (no aparece en el formulario web ni en la entrada esperada
  de Hermes) — "si se quiere otra opinión, que se haga otra petición o
  se discuta previamente, no manchar la entrada". **El campo
  `comentario_asesor` sigue existiendo como opcional en el contrato de
  `POST /runs`** (no se retira del backend, del orquestador, ni de la
  restricción dura de la sección 5) — decisión (B): más barato que sacar
  código ya probado, y no cierra la puerta a que una futura vía de
  entrada distinta sí lo use.
- **El informe final se centra en dos componentes**, ya existentes en
  el contrato, sin estructura nueva que diseñar: `recomendaciones` (qué
  acciones llevar a cabo) y `hallazgos_ontologia` (en qué estado debería
  encontrarse la startup para que la actividad sea coherente — modo base
  o enriquecido, sección 8). La UI debe mostrar estos dos con claridad,
  sin ruido adicional.

> **Especificación de UI (`startup-next-ui`), formalizada aquí tras un
> gap real de continuidad entre sesiones de Claude Code — no estaba
> documentada, solo discutida en chat, y una sesión nueva no tenía
> forma de recuperarla.** El formulario de `/` debe ser **un solo paso,
> sin pantalla de revisión intermedia**:
> - Dos campos simultáneamente visibles: texto libre (textarea) y PDF
>   (input file) — **mutuamente excluyentes**: llenar uno deshabilita
>   el otro (no radio buttons de "elegir método", no botón "Extraer
>   opciones" separado).
> - Sin campo de comentario del asesor (ver arriba).
> - **Sin campo `startup_id` manual** — eliminado del formulario (ver
>   subsección de firma criptográfica más abajo: el id real, cuando
>   existe, viaja dentro del propio PDF firmado, no se pide al usuario).
> - Texto aclaratorio junto al input de PDF: *"El PDF debe ser el
>   informe generado por startup-advisor. Si no dispones de uno, usa la
>   opción de texto libre en su lugar."* — indicación para el usuario,
>   no una validación técnica (la validación real es la firma).
> - **Un único botón "Iniciar"**, habilitado cuando el texto tiene
>   contenido o hay un PDF seleccionado. Al pulsarlo, la secuencia
>   completa ocurre internamente, sin mostrar ningún paso intermedio al
>   usuario: `POST /informes/parse` → armar `comentario_asesor` omitido
>   → `POST /runs` (crear+arrancar, `startup_id` ya resuelto por el
>   backend) → navegar a `/runs/[id]`. Si `informes/parse` falla, el
>   error se muestra inline en la misma pantalla, sin navegar a ningún
>   lado.
> - Componentes que **no deben existir** en este flujo:
>   `OpcionesPropuestasView.tsx`, el link "usar otro informe", cualquier
>   checkbox de `aplica_a`, el botón "Extraer opciones" como paso
>   separado del de "Iniciar".
>
> Si en algún momento el código no refleja esto, es porque quedó
> pendiente de una sesión anterior sin ejecutar — no es una regresión
> intencional, hay que implementarlo desde este documento como fuente
> de verdad, no desde el historial de chat de una sesión que ya no
> existe.

### Firma criptográfica del PDF: reemplaza el `startup_id` manual (confirmado, cruza a `startup-advisor`)

**Origen de la decisión**: al independizar los módulos, el campo
`startup_id` manual quedó como el único vestigio de acoplamiento en la
UI — pedirle al usuario un dato que en la práctica nadie recuerda de
memoria, solo para activar el modo enriquecido (sección 8). Se reemplaza
por un mecanismo que **extrae el id automáticamente del propio PDF**,
cuando ese PDF es genuinamente de `startup-advisor` — sin campo manual,
sin base de datos compartida entre los dos módulos.

- **Bloque de texto visible al final del PDF** (no metadatos — se
  evaluó esa vía y se descartó por simplicidad: exige que ambos lados
  verifiquen soporte real de metadatos personalizados en sus
  respectivas librerías antes de nada, capa extra de riesgo sin
  necesidad), con este formato exacto:
  ```
  ---
  startup-next-verification
  startup_id: <uuid>
  report_id: <uuid>
  timestamp: <iso8601>
  signature: <base64>
  ```
- **Firma Ed25519** (módulo `crypto` nativo de Node, sin librería nueva
  en ningún lado) sobre la cadena canónica
  `${startupId}|${reportId}|${timestamp}`. `startup-advisor` guarda la
  clave privada (nunca sale de ese sistema); `startup-next` solo
  necesita la clave pública (`PDF_SIGNING_PUBLIC_KEY`, no es secreta)
  para verificar.
- **En `/informes/parse`**: al procesar un PDF, buscar ese bloque en el
  texto extraído. Si aparece y la firma verifica con la clave pública →
  usar ese `startup_id` real, modo enriquecido automático. Si no
  aparece, o la firma no verifica (PDF ajeno, corrupto, o falsificado a
  mano) → generar un UUID al azar, modo base — **sin error, sin
  bloquear nada**, mismo criterio de degradación elegante ya aplicado
  en todo el resto del sistema (`getPrerequisitos()` ante un 404,
  `graph().individuals.length` ante una startup sin hechos).
- **Texto libre nunca tiene id que extraer** — siempre modo base con
  UUID generado, no hay forma de evitarlo sin pedir un campo manual que
  ya se descartó.
- Esto es intencionalmente **verificación de origen real** (nadie sin
  la clave privada puede fabricar una firma válida), no la heurística
  blanda ni el marcador de texto simple que se habían evaluado antes
  como alternativas más débiles — se optó directamente por la opción
  fuerte porque de todos modos había que tocar el código de exportación
  de `startup-advisor`.

> **Cruza a otro repositorio** — lado de `startup-advisor`: **implementado
> y verificado de punta a punta con código de producción real** (no un
> PDF descartable): claves Ed25519 generadas una sola vez
> (`scripts/generate-signing-keypair.ts`), firma en
> `src/lib/pdf-signing.ts`, bloque de verificación en página final
> dedicada (`src/lib/report-pdf.tsx`). Prueba real: render → extracción
> con `unpdf` (misma llamada que usa `startup-next`) → regex ancladas →
> `crypto.verify()` con la clave pública real → `true`.
>
> **Hallazgo real durante la implementación**: `@react-pdf/renderer`
> hifena automáticamente cadenas largas sin espacios cuando no caben en
> el ancho de página — la firma base64 (88 caracteres) se partía en dos
> con un `-` inyectado en medio, rompiendo la verificación en el primer
> intento. Corregido con
> `Font.registerHyphenationCallback((word) => [word])` (palabras
> indivisibles) + tamaño de fuente reducido (8pt) para el bloque.
>
> **Clave pública real, para `PDF_SIGNING_PUBLIC_KEY` en `startup-next`**:
> ```
> -----BEGIN PUBLIC KEY-----
> MCowBQYDK2VwAyEAPaNh84Y9RGT2Sn48zqAQs4r6ik0phNT9lz3KS/R87RA=
> -----END PUBLIC KEY-----
> ```
>
> **Corrección al plan original de extracción** (afecta al lado de
> `startup-next`, todavía pendiente de implementar): `unpdf` colapsa
> los saltos de línea a espacios — el bloque de 6 líneas llega como una
> sola línea continua. No usar `texto.split("\n")` esperando cada campo
> en su propia línea; usar regex ancladas sobre el texto aplanado:
> ```
> startup_id:\s*(\S+)
> report_id:\s*(\S+)
> timestamp:\s*(\S+)
> signature:\s*(\S+)
> ```
> Seguro porque ninguno de los 4 valores contiene espacios internos.
> Verificar primero que el marcador `startup-next-verification` aparece
> en el texto extraído, antes de intentar los 4 regex — evita falsos
> positivos de un PDF que por casualidad contenga alguna de esas
> palabras sin ser un bloque real. `report_id` = `reports.id` (el
> informe en sí, no la entrevista que lo generó).

> **Segundo incidente real de despliegue manual en este proyecto**
> (el primero fue `ontology-engine`, sección 8 paso 1): el código de la
> firma existía en `startup-advisor` pero nunca se había commiteado
> (estaba en la rama `phase-1-ontology-engine`, sin commit) ni
> desplegado — el último deployment de producción en Vercel era 6 días
> anterior a que ese código existiera. `startup-advisor`, igual que
> `startup-next`/`ontology-engine`, tiene despliegue manual sin
> integración Git↔Vercel — mergear no despliega nada por sí solo.
> Resuelto: commit de solo los 4 archivos de la firma (dejando afuera
> cambios sin terminar de otra rama), `vercel --prod`, verificado que el
> working tree coincide exactamente con el commit desplegado y que ese
> código exacto produce un PDF válido (marcador, 4 campos,
> `crypto.verify() → true`). **Limitación conocida y aceptada, no
> maquillada**: no se confirmó por HTTP real contra la URL de
> producción (bloqueado por el *handshake* de autenticación de Clerk en
> modo test, esfuerzo desproporcionado para el riesgo residual) — la
> confirmación final queda pendiente de la primera descarga real de un
> usuario desde el navegador.
>
> **Dos incidentes idénticos en el mismo proyecto es una señal, no una
> coincidencia** — vale la pena que cualquier sesión futura que toque
> despliegues en `startup-advisor`, `startup-next`, u `ontology-engine`
> verifique el deployment activo (fecha/commit) antes de asumir que un
> cambio de código ya está en producción, en vez de descubrirlo por un
> síntoma confuso más adelante.

> **Hallazgo de fiabilidad real en `ontology-engine`, correctamente
> descartado como relacionado con la migración `is_sequential`/paso 1**:
> `GET /startups/{id}/graph` falló con `500` en producción
> (`SSL connection has been closed unexpectedly`) — investigado con
> evidencia real, no supuesto: el traceback señala un fallo de conexión
> a nivel `psycopg`, no de query; `load_startup_graph()` no toca la
> columna `is_sequential` en ningún punto (esa columna solo la lee
> `load_tbox()`, función distinta, para un endpoint distinto); y la
> siguiente request al mismo `startup_id` 30 segundos después devolvió
> `200` — confirma conexión obsoleta en el pool (`autosuspend`/idle
> timeout de Neon cerrando la conexión del lado servidor, mientras el
> pool de `ontology-engine`, vivo desde días atrás sin reiniciar,
> todavía la creía válida), no un bug de datos. **Corregido**:
> `ConnectionPool(check=ConnectionPool.check_connection)` al crear el
> pool en el `lifespan` de `main.py` — valida la conexión antes de
> entregarla, la descarta/recrea si Neon ya la cerró. Sin dependencias
> nuevas, usa una capacidad ya existente de `psycopg_pool`.
>
> **Desplegado y verificado en producción real** (v4,
> `check=ConnectionPool.check_connection`, commit `47eb443`
> bundleado con el trabajo del paso 1 que estaba deployado pero nunca
> commiteado): `GET /health`, `GET /startups/{id}/graph` (7 individuos
> reales), `GET /concepts/MVP/prerequisitos` — los tres responden `200`
> contra la URL pública. **No verificado**: el escenario real de
> inactividad prolongada que originó el bug (llevaría horas
> reproducirlo a propósito) — queda pendiente de confirmación natural
> la próxima vez que el servicio esté inactivo un rato largo; si
> reaparece el mismo error, el fix no fue suficiente y hay que mirar
> `max_idle`/`reconnect_timeout`.

> **Nota de entorno, no de código**: Avast interceptó TLS en al menos 3
> builds/deploys distintos de este proyecto (el build de `rag-ingest`
> contra PyPI, el primer deploy de `ontology-engine` del paso 1, y este)
> — patrón recurrente, no incidentes aislados. Recomendado: excepción
> permanente en Avast para Docker Desktop/WSL2 y `flyctl`, en vez de
> pausar y reactivar manualmente cada vez.

> **Verificación del lado de `startup-next` — implementada y verificada
> con un PDF real** (no armado a mano, generado por el código de
> producción real de `startup-advisor` con la clave privada real):
> `src/lib/pdfVerification.ts` (`resolveStartupIdFromPdfText()`), ambos
> caminos de `POST /informes/parse` devuelven `startup_id` junto a
> `opciones_propuestas`. No hizo falta tocar `orchestrator.ts` —
> `resolveOntologyContext()` ya decide el modo automáticamente según si
> ese id tiene hechos reales, sin cambios.
>
> Casos probados, los tres con evidencia real: (1) PDF real con firma
> válida → `startup_id` recuperado coincide exactamente con el firmado;
> (2) bloque alterado (firmado para un id, impreso otro) → no verifica,
> UUID al azar, sin excepción; (3) PDF real ajeno (un libro del corpus
> RAG, sin marcador) → UUID al azar, sin excepción. Cualquier fallo
> (marcador ausente, campo faltante, firma inválida, excepción de
> `crypto.verify` con datos corruptos) degrada a `crypto.randomUUID()`
> — nunca lanza error, mismo criterio de degradación elegante de todo
> el sistema.
>
> Con esto, **la pieza de la firma criptográfica queda cerrada por
> completo, en los tres repositorios** (`startup-advisor`,
> `startup-next`, `startup-next-ui`). Confirmado en `startup-next-ui`:
> campo `startup_id` manual eliminado (de paso resolvió el bug del botón
> "Iniciar" que no se habilitaba, que dependía de ese campo ya
> inexistente), texto aclaratorio añadido junto al PDF, y **prueba
> final definitiva**: un PDF real firmado, para un `startup_id` con 7
> individuos reales ya registrados de sesiones anteriores, activó el
> modo enriquecido automáticamente — `hallazgos_ontologia` con
> `R1_hipotesis_sin_experimento` y `R4_startup_sin_fundador` reales, sin
> ningún campo manual en ningún punto del flujo.

> **Hallazgo aparte, no bloqueante, para investigar en otro momento**:
> `POST /startups/{id}/individuals` en `ontology-engine` devolvió
> `500 Internal Server Error` sin detalle al intentar registrar un
> individuo para un `startup_id` nuevo. No se persiguió (fuera del
> alcance de este cambio, y había una alternativa con un id ya
> poblado), pero queda anotado como posible bug real de ese endpoint.

### Nuevo estado terminal: `peticion_incoherente`

Si el orquestador no reconoce un esquema lógico de tarea de startup en
la entrada (PDF o texto que no describe ninguna intención de negocio
real — una factura, contenido no relacionado, un PDF corrupto), rechaza
de inmediato, mismo patrón que `sin_especialista`: sin gastar ciclos,
`status: "peticion_incoherente"`, `no_respuesta.tipo:
"peticion_incoherente"` con `motivo_principal` explicando la causa
concreta identificada. Se evalúa en el mismo razonamiento que ya hace
el orquestador al decidir `accion_next` — no es una llamada a LLM nueva,
es una pregunta más dentro de la que ya existe.
