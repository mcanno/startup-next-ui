import { Document, Page, Text, View, StyleSheet, Font } from "@react-pdf/renderer";
import { formatHallazgo } from "@/lib/hallazgos";
import type { InformeFinal } from "@/lib/types";

// Sin esto, react-pdf hifena palabras largas sin espacios (visto en
// startup-advisor con la firma base64 del PDF exportado) insertando un
// "-" en medio de la cadena al no caber en el ancho de pagina. Acá no hay
// firma que embeber, pero fuentes/hallazgos podrian traer un token largo
// sin espacios -- mas barato prevenirlo desde el primer commit que
// redescubrir el mismo bug.
Font.registerHyphenationCallback((word) => [word]);

const styles = StyleSheet.create({
  page: {
    paddingVertical: 40,
    paddingHorizontal: 48,
    fontSize: 11,
    fontFamily: "Helvetica",
    color: "#27272a",
  },
  badge: {
    fontSize: 9,
    color: "#71717a",
    marginBottom: 10,
    textTransform: "uppercase",
  },
  title: {
    fontSize: 20,
    fontWeight: 700,
    marginBottom: 24,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
    color: "#6b7280",
    marginBottom: 10,
  },
  recomendacion: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 4,
    padding: 10,
    marginBottom: 8,
  },
  recomendacionTitulo: {
    fontSize: 11.5,
    fontWeight: 700,
    marginBottom: 4,
  },
  recomendacionDetalle: {
    lineHeight: 1.4,
    marginBottom: 6,
  },
  fuente: {
    fontSize: 9,
    color: "#6b7280",
  },
  hallazgosBox: {
    borderWidth: 1,
    borderColor: "#fcd34d",
    backgroundColor: "#fffbeb",
    borderRadius: 4,
    padding: 10,
  },
  hallazgo: {
    fontSize: 10,
    lineHeight: 1.4,
    marginBottom: 4,
  },
});

export function InformePdf({ informeFinal }: { informeFinal: InformeFinal }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.badge}>{informeFinal.aprobado ? "Aprobado" : "No aprobado"}</Text>
        <Text style={styles.title}>Informe final</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Qué hacer</Text>
          {informeFinal.recomendaciones.map((r, i) => (
            <View key={i} style={styles.recomendacion}>
              <Text style={styles.recomendacionTitulo}>{r.titulo}</Text>
              <Text style={styles.recomendacionDetalle}>{r.detalle}</Text>
              {r.fuentes.map((f, j) => (
                <Text key={j} style={styles.fuente}>
                  {f}
                </Text>
              ))}
            </View>
          ))}
        </View>

        {informeFinal.consideraciones_metodologicas.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>En qué estado debería estar tu startup</Text>
            <View style={styles.hallazgosBox}>
              {informeFinal.consideraciones_metodologicas.map((h) => (
                <Text key={h.rule_id} style={styles.hallazgo}>
                  {formatHallazgo(h)}
                </Text>
              ))}
            </View>
          </View>
        )}
      </Page>
    </Document>
  );
}
