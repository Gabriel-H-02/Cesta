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

// Una peticion a Gemini con tiempo maximo y mensajes de error que dicen algo.
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// Fallos de los que merece la pena reintentar con el mismo modelo, frente a los
// que piden cambiar de modelo o rendirse.
const SATURADO = new Set([500, 502, 503, 504]);

async function pedirAGemini(cuerpo, avisar = () => {}, espera = CONFIG.esperaMax) {
  const apiKey = localStorage.getItem(CLAVE_LS);
  if (!apiKey) throw new Error("Falta la clave de Google AI Studio. Abre los ajustes.");

  const corte = new AbortController();
  const reloj = setTimeout(() => corte.abort(), espera);
  const t0 = performance.now();

  let r;
  try {
    avisar("subiendo");
    r = await fetch(GEMINI, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(cuerpo),
      signal: corte.signal,
    });
    avisar("leyendo");
  } catch (e) {
    clearTimeout(reloj);
    if (e.name === "AbortError")
      throw new Error(`Google no respondió en ${Math.round(espera / 1000)} segundos. Puede ser la cobertura, o que el ticket sea muy largo. Prueba otra vez con mejor señal.`);
    throw new Error("No se pudo conectar con Google. Revisa la conexión.");
  } finally {
    clearTimeout(reloj);
  }

  const texto = await r.text();
  const segundos = ((performance.now() - t0) / 1000).toFixed(1);

  if (!r.ok) {
    const e = new Error();
    e.estado = r.status;
    e.cuerpo = texto;
    if (r.status === 429) {
      // Puede ser el limite por minuto o el del dia. La respuesta no siempre lo
      // dice, asi que no se afirma cual es.
      e.message = "Límite de peticiones alcanzado en este modelo.";
      throw e;
    }
    if (r.status === 401) e.message = `La clave no autentica (401). Es un problema conocido de algunas claves nuevas de AI Studio. ${texto.slice(0, 140)}`;
    else if (r.status === 403) e.message = `Google rechaza la clave (403). ${texto.slice(0, 140)}`;
    else if (r.status === 404) e.message = "Ese modelo no existe o no está disponible para tu cuenta.";
    else if (r.status === 400) e.message = `Petición rechazada (400). ${texto.slice(0, 220)}`;
    else if (SATURADO.has(r.status)) e.message = `El modelo está saturado ahora mismo (${r.status}).`;
    else e.message = `Gemini respondió ${r.status} tras ${segundos}s. ${texto.slice(0, 200)}`;
    throw e;
  }
  return { json: JSON.parse(texto), segundos };
}

// Recorre la cadena de modelos. Con un modelo saturado reintenta una vez tras
// una pausa, porque Google dice que esos picos son temporales; si sigue caido,
// o no hay cuota, o no existe, baja al siguiente.
async function conCadena(construir, avisar) {
  const cadena = [].concat(CONFIG.modelo.gemini);
  let ultimo;
  for (let i = 0; i < cadena.length; i++) {
    const modelo = cadena[i];
    for (let intento = 0; intento < 2; intento++) {
      try {
        avisar(intento || i ? `probando ${modelo}` : "subiendo");
        const r = await pedirAGemini(construir(modelo), avisar);
        return { ...r, modelo };
      } catch (e) {
        ultimo = e;
        const saturado = SATURADO.has(e.estado);
        if (saturado && intento === 0) { await esperar(2500); continue; }
        if (saturado || e.estado === 429 || e.estado === 404) break;  // siguiente modelo
        throw e;                                                      // clave, red, peticion: no insistir
      }
    }
  }
  ultimo.message = `Ningún modelo disponible. Probé ${cadena.join(", ")}. Último error: ${ultimo.message}`;
  throw ultimo;
}

async function viaGemini(bandas, avisar) {
  const entrada = bandas.map((b) => ({ type: "image", data: b, mime_type: "image/jpeg" }));
  entrada.push({ type: "text", text: instrucciones(bandas.length) });

  const { json, segundos, modelo } = await conCadena((model) => ({
    model,
    system_instruction: SISTEMA,
    input: entrada,
    generation_config: { thinking_level: CONFIG.razonamiento },
    response_format: { type: "text", mime_type: "application/json", schema: ESQUEMA },
  }), avisar);

  const texto = textoDe(json);
  if (!texto)
    throw new Error("Gemini respondió, pero no encuentro el texto en su respuesta. Claves recibidas: " + Object.keys(json).join(", "));

  let datos;
  try { datos = JSON.parse(texto); }
  catch { throw new Error("Gemini devolvió algo que no es JSON válido: " + texto.slice(0, 160)); }

  return { datos, uso: json.usage ?? null, gratis: true, segundos, modelo };
}

// Diagnostico: la llamada mas pequena posible, sin imagenes. Separa un problema
// de clave o de red de uno de imagenes pesadas o de modelo lento.
export async function probarClave() {
  const t0 = performance.now();
  const { json, modelo } = await conCadena((model) => ({
    model,
    input: "Responde unicamente con la palabra: bien",
  }), () => {});
  return { texto: textoDe(json).trim(), modelo,
           segundos: ((performance.now() - t0) / 1000).toFixed(1) };
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

async function unaLectura(bandas, avisar) {
  if (CONFIG.modo === "servidor") return viaServidor(bandas);
  return CONFIG.proveedor === "gemini" ? viaGemini(bandas, avisar) : viaAnthropic(bandas);
}

export async function analizarTicket(bandas, avisar = () => {}) {
  if (!CONFIG.dobleLectura) return unaLectura(bandas, avisar);

  const [a, b] = await Promise.all([unaLectura(bandas, avisar), unaLectura(bandas, avisar)]);
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
