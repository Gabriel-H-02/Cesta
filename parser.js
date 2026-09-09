// El adaptador. Todo lo que sabe del modelo esta detras de analizarTicket().
// Cambiar de 'directo' a 'servidor' no toca ni la interfaz ni el almacen.

import { CONFIG, CLAVE_LS } from "./config.js";
import { PETICION_BASE, SISTEMA, ESQUEMA } from "./contrato.js";

function instrucciones(n) {
  return n === 1
    ? "Ticket completo en una sola imagen. Extrae sus lineas."
    : `Ticket repartido en ${n} bandas horizontales consecutivas, de arriba abajo, con solape entre bandas contiguas. Reconstruyelo y extrae sus lineas sin duplicar las que salgan dos veces.`;
}

function contenido(bandas) {
  const bloques = bandas.map((b) => ({
    type: "image",
    source: { type: "base64", media_type: "image/jpeg", data: b },
  }));
  bloques.push({ type: "text", text: instrucciones(bandas.length) });
  return bloques;
}


// ---------------------------------------------------------------- Gemini
// API de Interactions, comprobada contra la documentacion el 9 sep 2026.
//   POST https://generativelanguage.googleapis.com/v1beta/interactions
//   cabecera x-goog-api-key
//   input: lista de bloques {type:"text"|"image"}
//   response_format: {type:"text", mime_type:"application/json", schema}
// El CORS lo permite desde el navegador: comprobado contra el propio servidor.

const GEMINI = "https://generativelanguage.googleapis.com/v1beta/interactions";

// El texto generado. Los SDK lo exponen como output_text; en REST crudo la
// forma exacta no la he podido verificar sin clave, asi que si no viene ese
// atajo se recorre la respuesta recogiendo los bloques de texto.
function textoDe(r) {
  if (typeof r.output_text === "string" && r.output_text) return r.output_text;
  const trozos = [];
  (function andar(x) {
    if (!x || typeof x !== "object") return;
    if (Array.isArray(x)) return x.forEach(andar);
    if (x.type === "text" && typeof x.text === "string") trozos.push(x.text);
    for (const v of Object.values(x)) andar(v);
  })(r.output ?? r);
  return trozos.join("");
}

async function viaGemini(bandas) {
  const apiKey = localStorage.getItem(CLAVE_LS);
  if (!apiKey) throw new Error("Falta la clave de Google AI Studio. Abre los ajustes.");

  const entrada = bandas.map((b) => ({ type: "image", data: b, mime_type: "image/jpeg" }));
  entrada.push({ type: "text", text: instrucciones(bandas.length) });

  const r = await fetch(GEMINI, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      model: CONFIG.modelo.gemini,
      system_instruction: SISTEMA,
      input: entrada,
      response_format: { type: "text", mime_type: "application/json", schema: ESQUEMA },
    }),
  });

  if (!r.ok) {
    const cuerpo = await r.text();
    if (r.status === 429)
      throw new Error("Has agotado la cuota gratuita de hoy. Vuelve a intentarlo mañana.");
    if (r.status === 400 && cuerpo.includes("API key"))
      throw new Error("La clave no es válida. Revísala en Ajustes.");
    throw new Error(`Gemini respondió ${r.status}. ${cuerpo.slice(0, 200)}`);
  }

  const datos = await r.json();
  const texto = textoDe(datos);
  if (!texto) throw new Error("Gemini no devolvió texto que se pueda leer.");
  return { datos: JSON.parse(texto), uso: datos.usage ?? null, gratis: true };
}

// El SDK son 175 KB del CDN. Se carga solo si de verdad se usa Claude, para que
// la via de Gemini no arrastre ninguna dependencia externa.
let Anthropic = null;

async function viaAnthropic(bandas) {
  const apiKey = localStorage.getItem(CLAVE_LS);
  if (!apiKey) throw new Error("Falta la clave de Anthropic. Abre los ajustes.");
  Anthropic ??= (await import("https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.122.0/+esm")).default;

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
  if (CONFIG.modo === "servidor") return viaServidor(bandas);
  return CONFIG.proveedor === "gemini" ? viaGemini(bandas) : viaAnthropic(bandas);
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

// Coste de una lectura. Con Gemini en el nivel gratuito no hay ninguno.
// Con Claude Opus 5: 5 $/Mtok de entrada, 25 $/Mtok de salida.
export function coste(uso) {
  if (CONFIG.proveedor === "gemini") return 0;
  if (!uso) return null;
  return (uso.input_tokens || 0) / 1e6 * 5 + (uso.output_tokens || 0) / 1e6 * 25;
}
