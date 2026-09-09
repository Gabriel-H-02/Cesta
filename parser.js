// El adaptador. Todo lo que sabe del modelo esta detras de analizarTicket().
// Cambiar de 'directo' a 'servidor' no toca ni la interfaz ni el almacen.

import Anthropic from "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.122.0/+esm";
import { CONFIG, CLAVE_LS } from "./config.js";
import { PETICION_BASE } from "./contrato.js";

function contenido(bandas) {
  const bloques = bandas.map((b) => ({
    type: "image",
    source: { type: "base64", media_type: "image/jpeg", data: b },
  }));
  bloques.push({
    type: "text",
    text: bandas.length === 1
      ? "Ticket completo en una sola imagen. Extrae sus lineas."
      : `Ticket repartido en ${bandas.length} bandas horizontales consecutivas, de arriba abajo, con solape entre bandas contiguas. Reconstruyelo y extrae sus lineas sin duplicar las que salgan dos veces.`,
  });
  return bloques;
}

async function viaNavegador(bandas) {
  const apiKey = localStorage.getItem(CLAVE_LS);
  if (!apiKey) throw new Error("Falta la clave de API. Abre los ajustes.");

  const cliente = new Anthropic({
    apiKey,
    dangerouslyAllowBrowser: true,
    defaultHeaders: { "anthropic-dangerous-direct-browser-access": "true" },
  });

  const r = await cliente.messages.create({
    ...PETICION_BASE,
    messages: [{ role: "user", content: contenido(bandas) }],
  });

  const texto = r.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  if (!texto) throw new Error("El modelo no devolvio texto. stop_reason: " + r.stop_reason);
  return { datos: JSON.parse(texto), uso: r.usage };
}

// Sin implementar a proposito. Cuando exista el backend, su unica obligacion es
// aceptar { bandas: [base64...] } y devolver el mismo { datos, uso } de arriba,
// reutilizando contrato.js sin cambiarlo.
async function viaServidor(bandas) {
  const r = await fetch(CONFIG.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bandas }),
  });
  if (!r.ok) throw new Error(`El servidor respondio ${r.status}`);
  return r.json();
}

function huella(d) {
  // Lo que dos lecturas del mismo ticket tienen que reproducir igual.
  return JSON.stringify({
    total: d.total,
    lineas: (d.lineas || [])
      .map((l) => [l.descripcion.trim().toUpperCase(), l.cantidad, l.importe])
      .sort((a, b) => String(a).localeCompare(String(b))),
  });
}

function discrepancias(a, b) {
  const clave = (l) => `${l.descripcion.trim().toUpperCase()}|${l.cantidad}|${l.importe}`;
  const enA = new Set(a.lineas.map(clave));
  const enB = new Set(b.lineas.map(clave));
  const fuera = [];
  for (const k of enA) if (!enB.has(k)) fuera.push(`solo en la 1.\u00aa lectura: ${k.split("|")[0]}`);
  for (const k of enB) if (!enA.has(k)) fuera.push(`solo en la 2.\u00aa lectura: ${k.split("|")[0]}`);
  if (a.total !== b.total) fuera.push(`totales distintos: ${a.total} y ${b.total}`);
  return fuera;
}

async function unaLectura(bandas) {
  return CONFIG.modo === "servidor" ? viaServidor(bandas) : viaNavegador(bandas);
}

export async function analizarTicket(bandas) {
  if (!CONFIG.dobleLectura) return unaLectura(bandas);

  const [a, b] = await Promise.all([unaLectura(bandas), unaLectura(bandas)]);
  const uso = {
    input_tokens: (a.uso?.input_tokens || 0) + (b.uso?.input_tokens || 0),
    output_tokens: (a.uso?.output_tokens || 0) + (b.uso?.output_tokens || 0),
  };
  if (huella(a.datos) === huella(b.datos))
    return { datos: a.datos, uso, dobleLectura: "coinciden" };
  return { datos: a.datos, uso, dobleLectura: "discrepan",
           discrepancias: discrepancias(a.datos, b.datos) };
}

// Precios de Claude Opus 5: 5 $/Mtok de entrada, 25 $/Mtok de salida.
export function coste(uso) {
  if (!uso) return null;
  const entrada = (uso.input_tokens || 0) / 1e6 * 5;
  const salida = (uso.output_tokens || 0) / 1e6 * 25;
  return entrada + salida;
}
