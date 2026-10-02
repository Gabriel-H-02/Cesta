import { CLAVE_LS, DATOS_LS, CONFIG } from "./config.js";
import { cargarImagen, trocear, enderezar } from "./imagen.js";
import { analizarTicket, coste, probarClave } from "./parser.js";
import { verificar, guardar, problemaFecha, leerTodos, exportar, eur } from "./almacen.js";
import { resumen, meses, mesLargo, precios, porTienda, compararTiendas, porProducto, NOMBRE_CATEGORIA, CATEGORIAS } from "./informe.js";
import { entradas, porNombre, renombrar, clave as claveCatalogo } from "./catalogo.js";
import { Camara } from "./camara.js";
import { VERSION, CONSTRUIDA } from "./version.js";

const $ = (s) => document.querySelector(s);

// Todo lo que sale del modelo o de un servidor pasa por aqui antes de tocar
// innerHTML. Un ticket con un nombre de producto trucado, o una respuesta
// manipulada, podria colar etiquetas y desde ellas leer la clave guardada en
// este navegador. Es rebuscado, y cuesta cinco lineas cerrarlo.
const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]);
let bandas = null, ultimo = null, mesActivo = null, categoriaAbierta = null;

// En hora local, no en UTC: a las 00:30 del dia 2, toISOString todavia dice dia 1
// y el selector no te dejaria poner la compra de hoy.
const hoy = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

/* ---------- navegacion ---------- */
document.querySelectorAll("nav button").forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll("nav button").forEach((x) => x.classList.toggle("activo", x === b));
    for (const v of ["Escanear", "Informe", "Catalogo", "Ajustes"])
      $("#vista" + v).classList.toggle("oculto", v !== b.dataset.vista);
    if (b.dataset.vista === "Informe") pintarInforme();
    if (b.dataset.vista === "Catalogo") pintarCatalogo();
    if (b.dataset.vista === "Ajustes") pintarAjustes();
  };
});

function estado(clase, html) {
  $("#estado").innerHTML = clase
    ? `<div class="estado ${clase}">${clase === "trabajando" ? '<div class="girando"></div>' : ""}<div>${html}</div></div>`
    : "";
}

/* ---------- escanear ---------- */
/* La imagen puede entrar por cuatro vias. El dialogo de archivos falla dentro
   de algunos webviews, asi que ninguna de las otras tres depende de el. */

async function procesarArchivo(archivo) {
  if (!archivo) return;
  if (!archivo.type.startsWith("image/")) {
    estado("mal", `Eso no es una imagen (${archivo.type || "tipo desconocido"}). Si tienes el ticket en PDF, ábrelo y haz una captura.`);
    return;
  }
  estado("trabajando", "Preparando la imagen…");
  $("#resultado").innerHTML = "";
  try {
    const img = await cargarImagen(archivo);
    const t = trocear(img);
    bandas = t.bandas;
    zona.classList.add("lleno");
    $("#textoEscaner").innerHTML = `<img src="${t.vistaPrevia}" alt="Ticket">`;
    $("#botonAnalizar").disabled = false;
    estado("bien", `${recorte?.lienzo
      ? `Ticket recortado y enderezado a ${recorte.lienzo.width}×${recorte.lienzo.height}, fondo fuera.`
      : `Va la foto entera (${img.naturalWidth}×${img.naturalHeight}): ${esc(recorte?.fallo || "sin bordes claros")}.`} ${
      t.n === 1 ? "Cabe en una banda." : `Cortada en ${t.n} bandas.`}`);
  } catch (err) {
    estado("mal", "No se pudo leer la imagen: " + esc(err.message));
  }
}

// 1. Camara en vivo con disparo automatico.
const zona = $("#zonaEscaner");
const camara = new Camara($("#video"), pintarEstadoCamara, (archivo) => {
  cerrarCamara();
  procesarArchivo(archivo);
}, $("#silueta"));

function pintarEstadoCamara(e) {
  zona.dataset.estado = e.clave;
  const p = $("#pista");
  p.dataset.texto = e.texto;
  p.style.setProperty("--avance", `${Math.round((e.progreso || 0) * 100)}%`);
}

async function abrirCamara() {
  try {
    $("#video").classList.remove("oculto");
    $("#textoEscaner").classList.add("oculto");
    zona.classList.add("grabando");
    $("#botonManual").classList.remove("oculto");
    $("#botonCancelar").classList.remove("oculto");
    estado("");
    await camara.arrancar();
  } catch (err) {
    cerrarCamara();
    estado("mal", err.name === "NotAllowedError"
      ? "No has dado permiso a la cámara. Puedes elegir una imagen del carrete."
      : esc(err.message));
  }
}

function cerrarCamara() {
  camara.parar();
  $("#video").classList.add("oculto");
  $("#textoEscaner").classList.remove("oculto");
  zona.classList.remove("grabando");
  delete zona.dataset.estado;
  $("#botonManual").classList.add("oculto");
  $("#botonCancelar").classList.add("oculto");
}

zona.addEventListener("click", () => { if (!camara.activa) abrirCamara(); });
$("#botonManual").onclick = () => camara.disparar();
$("#botonCancelar").onclick = () => { cerrarCamara(); estado(""); };

// 2. Selector de archivos, para el escritorio y por si la camara falla.
const entrada = $("#ficheroTicket");
entrada.addEventListener("change", (e) => procesarArchivo(e.target.files[0]));
$("#botonArchivo").onclick = (e) => { e.stopPropagation(); entrada.click(); };

// 3. Arrastrar y soltar.
["dragenter", "dragover"].forEach((ev) => zona.addEventListener(ev, (e) => {
  e.preventDefault(); zona.style.borderColor = "var(--acento)";
}));
["dragleave", "drop"].forEach((ev) => zona.addEventListener(ev, (e) => {
  e.preventDefault(); zona.style.borderColor = "";
}));
zona.addEventListener("drop", (e) => procesarArchivo(e.dataTransfer.files[0]));

// 4. Pegar del portapapeles.
addEventListener("paste", (e) => {
  const it = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
  if (it) procesarArchivo(it.getAsFile());
});

// 5. El ticket de ejemplo, para probar el circuito en local sin camara.
if (["localhost", "127.0.0.1"].includes(location.hostname) || location.hostname.startsWith("172.")) {
  const b = document.createElement("button");
  b.className = "fino";
  b.textContent = "Ticket de ejemplo";
  b.onclick = async (e) => {
    e.stopPropagation();
    estado("trabajando", "Cargando el ticket de ejemplo…");
    try {
      const r = await fetch("muestra.jpg");
      if (!r.ok) throw new Error("no se encontró muestra.jpg");
      await procesarArchivo(new File([await r.blob()], "muestra.jpg", { type: "image/jpeg" }));
    } catch (err) { estado("mal", "No se pudo cargar el ejemplo: " + esc(err.message)); }
  };
  $("#atajos").append(b);
}

$("#botonAnalizar").addEventListener("click", async () => {
  if (!bandas) return;
  $("#botonAnalizar").disabled = true;
  const pesoKB = Math.round(bandas.reduce((s, b) => s + b.length, 0) * 0.75 / 1024);
  const t0 = performance.now();
  const reloj = setInterval(() => {
    const s = Math.round((performance.now() - t0) / 1000);
    const el = document.querySelector("#estado .estado div:last-child");
    if (el) el.innerHTML = `${el.dataset.base || ""} · ${s}s`;
  }, 1000);
  const avisar = (fase) => {
    const textos = {
      subiendo: `Enviando ${bandas.length} bandas, ${pesoKB} KB`,
      leyendo: "Enviado. Google está leyendo el ticket",
    };
    const t = textos[fase] || (fase.startsWith("probando")
      ? `El modelo anterior no estaba disponible. ${esc(fase)}`
      : esc(fase));
    estado("trabajando", t);
    const el = document.querySelector("#estado .estado div:last-child");
    if (el) el.dataset.base = t;
  };

  avisar("subiendo");
  try {
    const r = await analizarTicket(bandas, avisar);
    clearInterval(reloj);
    ultimo = r.datos;
    pintarTicket(r.datos, r.uso, r);
  } catch (err) {
    clearInterval(reloj);
    estado("mal", esc(err.message));
    $("#botonAnalizar").disabled = false;
  }
});

function pintarTicket(d, uso, extra = {}) {
  const v = verificar(d);
  const avisos = [...v.avisos];
  if (extra.dobleLectura === "discrepan")
    avisos.push("Las dos lecturas no coinciden:<br>" + extra.discrepancias.join("<br>"));

  // El IVA ya no lo decide el modelo. Si la aritmetica tuvo que mover lineas, o
  // si el desglose admite mas de un reparto, hay que decirlo: es la unica pista
  // de que la clasificacion podria no ser la que toca.
  if (extra.iva?.ambiguo)
    avisos.push("El desglose de IVA admite más de un reparto. El elegido cuadra, pero revisa los tipos.");

  const limpio = v.ok && extra.dobleLectura !== "discrepan";
  estado(limpio ? "bien" : "mal",
    limpio
      ? "Las líneas cuadran con el total y con el desglose de IVA." +
        (extra.dobleLectura === "coinciden" ? " Dos lecturas independientes dan lo mismo." : "")
      : avisos.join("<br>"));

  // La fecha es editable a proposito. El modelo la lee de la letra pequena de la
  // cabecera, asi que es donde mas se equivoca, y de ella depende el mes del
  // informe. Tambien es la via para meter un ticket viejo que se quedo sin
  // escanear: se corrige aqui y entra en su mes, no en el de hoy.
  const dia = problemaFecha(d.fecha) ? "" : d.fecha.slice(0, 10);
  // La hora de la compra se conserva tal cual venga; solo se toca el dia.
  const hora = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(d.fecha || "") ? d.fecha.slice(11, 16) : "12:00";

  const filas = d.lineas.map((l) => `
    <tr>
      <td>${l.cantidad > 1 ? `<b>${l.cantidad}×</b> ` : ""}${esc(l.descripcion)}
        <div class="etiqueta">${esc(l.categoria).replace(/_/g, " ")} · IVA ${Math.round(l.iva * 100)}%</div></td>
      <td class="num">${eur(l.importe)}</td>
    </tr>`).join("");

  $("#resultado").innerHTML = `
    <div class="tarjeta">
      <h2>${esc(d.comercio)}</h2>
      <label class="campofecha">Fecha de la compra
        <input type="date" id="campoFecha" value="${dia}" max="${hoy()}">
      </label>
      <div class="etiqueta" id="destinoMes"></div>
      <table>${filas}
        <tr class="totalfila"><td>Total</td><td class="num">${eur(d.total)}</td></tr>
      </table>
      <button class="principal" id="botonGuardar">
        ${limpio ? "Guardar" : "Guardar de todas formas"}
      </button>
      <p class="nota">${d.lineas.length} líneas${extra.segundos ? ` · ${extra.segundos}s` : ""}${extra.modelo ? ` · ${esc(extra.modelo)}` : ""}${extra.iva?.resuelto && extra.iva.cambiadas ? ` · IVA recolocado en ${extra.iva.cambiadas} ${extra.iva.cambiadas === 1 ? "línea" : "líneas"}` : ""}${coste(uso) === 0 ? " · lectura gratuita" : uso ? ` · ${(coste(uso) * 100).toFixed(1)} céntimos` : ""}<br>
        Compara las líneas con la foto antes de guardar: la suma de control caza
        omisiones y dígitos mal leídos, pero no dos errores que se compensen.</p>
    </div>`;

  const campoFecha = $("#campoFecha");
  const destino = $("#destinoMes");

  // Que se vea a que mes va antes de darle a guardar, que es justo lo que no se
  // puede comprobar despues sin abrir el informe.
  const repintarDestino = () => {
    const iso = campoFecha.value ? `${campoFecha.value}T${hora}` : "";
    const mal = problemaFecha(iso);
    destino.textContent = mal
      ? `La fecha ${mal}. Ponla a mano para poder guardar.`
      : `Entrará en el informe de ${mesLargo(iso.slice(0, 7))}`;
    destino.classList.toggle("alerta", Boolean(mal));
    $("#botonGuardar").disabled = Boolean(mal);
    return iso;
  };
  campoFecha.oninput = repintarDestino;
  repintarDestino();

  $("#botonGuardar").onclick = () => {
    const r = guardar({ ...d, fecha: repintarDestino(), verificado: limpio });
    if (r.error) return estado("mal", esc(r.error));
    estado(r.duplicado ? "mal" : "bien",
      r.duplicado ? "Este ticket ya estaba guardado." : `Guardado. Llevas ${r.total} tickets.`);
    $("#botonGuardar").disabled = true;
    cabecera();
  };
}

/* ---------- informe ---------- */
function pintarInforme() {
  const ms = meses();
  if (!ms.length) {
    $("#selectorMeses").innerHTML = "";
    $("#gastoMes").textContent = "—";
    $("#detalleMes").textContent = "Todavía no hay ningún ticket.";
    $("#categorias").innerHTML = '<div class="vacio">Escanea el primero y esto se llena solo.</div>';
    $("#preciosLista").innerHTML = '<div class="vacio">Hacen falta dos compras del mismo producto para comparar.</div>';
    $("#tiendas").innerHTML = '<div class="vacio">Sin compras todavía.</div>';
    $("#comparativa").innerHTML = '<div class="vacio">Escanea en dos supermercados distintos y aquí verás dónde sale más barato cada cosa.</div>';
    return;
  }
  if (!ms.includes(mesActivo)) mesActivo = ms[0];

  $("#selectorMeses").innerHTML = ms.map((m) =>
    `<button class="fino ${m === mesActivo ? "principal" : ""}" data-mes="${m}"
       style="${m === mesActivo ? "width:auto;margin:0;padding:8px 12px;font-size:.85rem" : ""}">${mesLargo(m)}</button>`).join("");
  $("#selectorMeses").querySelectorAll("button").forEach((b) =>
    b.onclick = () => { mesActivo = b.dataset.mes; pintarInforme(); });

  const r = resumen(mesActivo);
  $("#gastoMes").textContent = eur(r.total);
  $("#detalleMes").textContent =
    `${r.nCompras} ${r.nCompras === 1 ? "compra" : "compras"} · ${r.lineas.length} artículos · ${eur(r.total / r.nCompras)} de media`;

  const tope = r.categorias[0]?.importe || 1;
  $("#categorias").innerHTML = r.categorias.map((c) => {
    const abierta = c.clave === categoriaAbierta;
    return `
    <div class="barra pulsable ${abierta ? "abierta" : ""}" data-cat="${esc(c.clave)}" role="button" tabindex="0">
      <div class="cab"><span>${esc(c.nombre)}</span>
        <span>${eur(c.importe)} <span style="color:var(--tenue)">${Math.round(c.importe / r.total * 100)}%</span></span></div>
      <div class="canal"><div class="relleno" style="width:${c.importe / tope * 100}%"></div></div>
    </div>
    ${abierta ? detalleDe(c.clave, c.importe) : ""}`;
  }).join("");

  $("#categorias").querySelectorAll(".pulsable").forEach((el) => {
    const abrir = () => {
      categoriaAbierta = categoriaAbierta === el.dataset.cat ? null : el.dataset.cat;
      pintarInforme();
    };
    el.onclick = abrir;
    el.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); abrir(); } };
  });

  // Por supermercado
  const ts = porTienda(mesActivo);
  const topeT = ts[0]?.importe || 1;
  $("#tiendas").innerHTML = ts.length > 1 || ts[0]?.comercio
    ? ts.map((t) => `
      <div class="barra">
        <div class="cab"><span style="text-transform:capitalize">${esc(t.comercio)}</span>
          <span>${eur(t.importe)} <span style="color:var(--tenue)">${t.compras} ${t.compras === 1 ? "compra" : "compras"}</span></span></div>
        <div class="canal"><div class="relleno" style="width:${t.importe / topeT * 100}%"></div></div>
      </div>`).join("")
    : '<div class="vacio">Todavía no hay compras.</div>';

  // Comparativa entre cadenas
  const cs = compararTiendas();
  $("#comparativa").innerHTML = cs.length ? cs.slice(0, 12).map((c) => `
      <div class="barra">
        <div class="cab"><span>${esc(c.producto)}</span>
          <span class="bajar">−${eur(c.diferencia)}/${c.unidad}</span></div>
        <div style="font-size:.8rem;color:var(--tenue);text-transform:capitalize">
          ${c.filas.map((f, i) => `${i === 0 ? "✓ " : ""}${esc(f.comercio)} ${eur(f.precio)}`).join(" · ")}
          <span style="text-transform:none"> · ${Math.round(c.porcentaje * 100)}% más caro en ${esc(c.cara.comercio)}</span></div>
      </div>`).join("")
    : `<div class="vacio">Hace falta comprar el mismo producto en dos cadenas distintas.
       ${ts.length < 2 ? "De momento solo has escaneado en una." : ""}</div>`;

  const ps = precios();
  $("#preciosLista").innerHTML = ps.length ? ps.slice(0, 15).map((p) => {
    const pct = p.variacion * 100;
    const signo = pct > 0 ? "+" : "";
    return `<div class="barra"><div class="cab">
        <span>${esc(p.producto)}</span>
        <span class="${pct > 0.5 ? "subir" : pct < -0.5 ? "bajar" : ""}">
          ${eur(p.ultimo)}/${p.unidad} <b>${signo}${pct.toFixed(1)}%</b></span>
      </div><div style="font-size:.78rem;color:var(--tenue)">
        ${p.puntos.length} observaciones desde ${p.puntos[0].fecha}</div></div>`;
  }).join("") : '<div class="vacio">Hacen falta dos compras del mismo producto para comparar.</div>';
}

// Lo que hay dentro de una categoría, al desplegarla.
function detalleDe(clave, totalCategoria) {
  const ps = porProducto(mesActivo, clave);
  if (!ps.length) return "";
  const filas = ps.map((p) => `
    <tr>
      <td>${esc(p.producto)}
        <span class="sub">${p.unidades > 1 ? `${p.unidades} uds · ` : ""}${
          p.veces > 1 ? `en ${p.veces} compras` : "una compra"}${
          p.ultimoPrecio ? ` · último ${eur(p.ultimoPrecio)}/${esc(p.unidad || "ud")}` : ""}</span></td>
      <td class="num">${eur(p.importe)}
        <span class="sub">${Math.round(p.importe / totalCategoria * 100)}%</span></td>
    </tr>`).join("");
  return `<div class="detalle"><table>${filas}</table></div>`;
}

/* ---------- version ---------- */
const fechaLarga = (iso) => new Date(iso).toLocaleString("es-ES",
  { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

function pintarVersion() {
  const enDesarrollo = VERSION === "desarrollo";
  $("#version").innerHTML = `
    <b>${esc(VERSION)}</b><br>
    <span>${CONSTRUIDA ? "Publicada el " + fechaLarga(CONSTRUIDA)
                       : "Servida desde tu ordenador, sin sellar"}</span><br>
    <span>Lector: <code>${esc(CONFIG.proveedor)}</code> · Modelos: <code>${
      esc([].concat(CONFIG.modelo[CONFIG.proveedor]).join(", "))}</code></span>`;
  return enDesarrollo;
}

// Pregunta a la red si hay algo mas nuevo que lo que esta cargado ahora mismo.
// La comparacion es contra el archivo publicado, no contra el cache, para que
// no pueda decir que estas al dia cuando no lo estas.
// Espera a que el service worker nuevo llegue a mandar, o se rinde.
function esperarRelevo(reg, ms = 8000) {
  return new Promise((listo) => {
    let resuelto = false;
    const acabar = (v) => { if (!resuelto) { resuelto = true; listo(v); } };
    navigator.serviceWorker.addEventListener("controllerchange", () => acabar(true), { once: true });
    reg.addEventListener("updatefound", () => {
      const nuevoSW = reg.installing;
      nuevoSW?.addEventListener("statechange", () => {
        if (nuevoSW.state === "installed") reg.waiting?.postMessage({ tipo: "saltar" });
        if (nuevoSW.state === "activated") acabar(true);
      });
    });
    reg.waiting?.postMessage({ tipo: "saltar" });
    setTimeout(() => acabar(false), ms);
  });
}

// Ultimo recurso: borrar el service worker y todos los caches, y recargar con
// la URL cambiada para saltarse tambien el cache del navegador. Esto siempre
// funciona, a costa de volver a descargar los 70 KB.
async function reinstalarTodo() {
  const regs = (await navigator.serviceWorker?.getRegistrations()) || [];
  await Promise.all(regs.map((r) => r.unregister()));
  const claves = await caches.keys();
  await Promise.all(claves.map((k) => caches.delete(k)));
  location.replace(location.pathname + "?v=" + Date.now());
}

$("#botonActualizar").onclick = async () => {
  const b = $("#botonActualizar");
  const salida = $("#resultadoActualizar");
  b.disabled = true; b.textContent = "Comprobando…";
  const decir = (clase, html) => salida.innerHTML = `<div class="estado ${clase}"><div>${html}</div></div>`;

  try {
    const r = await fetch(`version.js?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) throw new Error(`el servidor respondió ${r.status}`);
    const txt = await r.text();
    const vRemota = txt.match(/VERSION = "([^"]*)"/)?.[1];
    const fRemota = txt.match(/CONSTRUIDA = "([^"]*)"/)?.[1];

    if (vRemota === VERSION && fRemota === CONSTRUIDA) {
      decir("bien", "Estás en la última versión.");
      b.disabled = false; b.textContent = "Buscar actualización";
      return;
    }

    decir("trabajando", `Hay una versión nueva (<b>${esc(vRemota || "?")}</b>). Instalando…`);
    const reg = await navigator.serviceWorker?.getRegistration();
    if (!reg) return reinstalarTodo();

    await reg.update();
    if (await esperarRelevo(reg)) { location.reload(); return; }

    // No se relevó en ocho segundos. No se insiste: se arrasa y se recarga.
    decir("trabajando", "El instalador se resistía. Reinstalando desde cero…");
    await reinstalarTodo();
  } catch (err) {
    decir("mal", `${esc(err.message)}<br>Si se repite, pulsa «Reinstalar desde cero».`);
    b.disabled = false; b.textContent = "Buscar actualización";
  }
};

$("#botonReinstalar").onclick = async () => {
  if (!confirm("Se borra la copia local de la app y se descarga de nuevo. Tus tickets y tu clave NO se tocan. ¿Seguir?")) return;
  $("#botonReinstalar").disabled = true;
  $("#botonReinstalar").textContent = "Reinstalando…";
  await reinstalarTodo();
};

/* ---------- catalogo ---------- */
// Aqui se arregla en frio lo que al escanear se acepta sin preguntar: el modelo
// propone un nombre la primera vez que ve un articulo, y dos descripciones que
// son el mismo producto pueden haber entrado con nombres distintos. Unificarlas
// reordena el historico entero, porque el informe resuelve el nombre contra el
// catalogo en cada calculo y no lo lleva escrito dentro de cada ticket.
let seleccion = new Set();

function pintarCatalogo() {
  const grupos = porNombre();
  const total = entradas().length;

  // Cuantas veces ha aparecido cada descripcion, para saber cual es el nombre
  // con mas peso cuando hay que elegir entre dos.
  const usos = {};
  for (const t of leerTodos())
    for (const l of t.lineas || []) usos[claveCatalogo(l.descripcion)] = (usos[claveCatalogo(l.descripcion)] || 0) + 1;

  $("#resumenCatalogo").textContent = total
    ? `${total} ${total === 1 ? "descripción" : "descripciones"} del ticket en ${grupos.length} ${grupos.length === 1 ? "producto" : "productos"}. ` +
      "Marca las que sean el mismo artículo y únelas: el informe y la serie de precios se recalculan solos."
    : "Vacío por ahora. Se llena solo con el primer ticket que guardes.";

  $("#listaCatalogo").innerHTML = total
    ? grupos.map((g) => `
        <div class="grupo">
          <input type="text" class="nombre" data-claves="${esc(g.filas.map((f) => f.clave).join("\u0001"))}"
                 value="${esc(g.producto)}" aria-label="Nombre del producto">
          ${g.filas.map((f) => `
            <label class="desc">
              <input type="checkbox" data-clave="${esc(f.clave)}" ${seleccion.has(f.clave) ? "checked" : ""}>
              <span>${esc(f.descripcion)}</span>
              <span class="etiqueta">${esc(NOMBRE_CATEGORIA(f.categoria))}${usos[f.clave] ? ` · ${usos[f.clave]}×` : " · sin usar"}</span>
            </label>`).join("")}
        </div>`).join("")
    : '<div class="vacio">Escanea un ticket y aquí aparecerán sus artículos.</div>';

  $("#listaCatalogo").querySelectorAll("input.nombre").forEach((i) => {
    i.onchange = () => {
      const nombre = i.value.trim();
      if (!nombre) return pintarCatalogo();
      renombrar(i.dataset.claves.split("\u0001"), nombre, null);
      pintarCatalogo();
    };
  });
  $("#listaCatalogo").querySelectorAll('input[type=checkbox]').forEach((c) => {
    c.onchange = () => {
      c.checked ? seleccion.add(c.dataset.clave) : seleccion.delete(c.dataset.clave);
      botonesSeleccion();
    };
  });
  botonesSeleccion();
}

function botonesSeleccion() {
  const n = seleccion.size;
  $("#botonUnificar").disabled = n < 2;
  $("#botonNada").disabled = n === 0;
  $("#botonUnificar").textContent = n < 2 ? "Unificar seleccionados" : `Unificar ${n} en uno`;
}

$("#botonNada").onclick = () => { seleccion.clear(); pintarCatalogo(); };

$("#botonUnificar").onclick = () => {
  const elegidas = entradas().filter((e) => seleccion.has(e.clave));
  if (elegidas.length < 2) return;
  // Se propone el nombre que mas se repite entre los seleccionados, que suele
  // ser el bueno, pero se puede escribir otro.
  const cuenta = {};
  for (const e of elegidas) cuenta[e.producto] = (cuenta[e.producto] || 0) + 1;
  const sugerido = Object.entries(cuenta).sort((a, b) => b[1] - a[1])[0][0];

  $("#resumenCatalogo").insertAdjacentHTML("afterend", `
    <div class="tarjeta" id="cajaUnificar" style="margin-top:12px">
      <p class="nota" style="margin-top:0">Las ${elegidas.length} descripciones pasarán a contar como un solo producto.</p>
      <input type="text" id="nombreUnificado" value="${esc(sugerido)}" aria-label="Nombre unificado">
      <select id="categoriaUnificada" style="margin-top:8px">
        ${CATEGORIAS.map((c) => `<option value="${esc(c)}" ${c === elegidas[0].categoria ? "selected" : ""}>${esc(NOMBRE_CATEGORIA(c))}</option>`).join("")}
      </select>
      <div class="fila" style="margin-top:12px">
        <button class="fino" id="confirmarUnificar">Unificar</button>
        <button class="fino" id="cancelarUnificar">Cancelar</button>
      </div>
    </div>`);

  const cerrar = () => $("#cajaUnificar")?.remove();
  $("#cancelarUnificar").onclick = cerrar;
  $("#confirmarUnificar").onclick = () => {
    const nombre = $("#nombreUnificado").value.trim();
    if (!nombre) return;
    renombrar([...seleccion], nombre, $("#categoriaUnificada").value);
    seleccion.clear();
    cerrar();
    pintarCatalogo();
  };
};

/* ---------- ajustes ---------- */
function pintarAjustes() {
  pintarVersion();
  $("#campoClave").value = localStorage.getItem(CLAVE_LS) || "";
  const t = leerTodos();
  $("#notaDatos").textContent = t.length
    ? `${t.length} tickets guardados, del ${t[0].fecha.slice(0, 10)} al ${t[t.length - 1].fecha.slice(0, 10)}.`
    : "Todavía no hay datos guardados.";
}
$("#botonGuardarClave").onclick = () => {
  const v = $("#campoClave").value.trim();
  v ? localStorage.setItem(CLAVE_LS, v) : localStorage.removeItem(CLAVE_LS);
  $("#botonGuardarClave").textContent = "Guardada";
  setTimeout(() => ($("#botonGuardarClave").textContent = "Guardar en este teléfono"), 1600);
};
$("#botonProbar").onclick = async () => {
  const b = $("#botonProbar");
  b.disabled = true; b.textContent = "Probando…";
  const salida = $("#resultadoPrueba");
  try {
    const r = await probarClave();
    salida.innerHTML = `<div class="estado bien"><div>La clave funciona. Respondió «${esc(r.texto)}» en ${r.segundos}s usando <b>${esc(r.modelo)}</b>.<br>
      Si la lectura de tickets falla igualmente, el problema son las imágenes o el modelo, no la clave ni la red.</div></div>`;
  } catch (err) {
    salida.innerHTML = `<div class="estado mal"><div>${esc(err.message)}</div></div>`;
  }
  b.disabled = false; b.textContent = "Probar la clave";
};
$("#botonExportar").onclick = exportar;
$("#botonVaciar").onclick = () => {
  if (!confirm("Se borran todos los tickets guardados en este teléfono. ¿Seguro?")) return;
  localStorage.removeItem(DATOS_LS); pintarAjustes(); cabecera();
};

/* ---------- arranque ---------- */
function cabecera() {
  const ms = meses();
  if (!ms.length) return ($("#cabResumen").textContent = "");
  $("#cabResumen").textContent = `${eur(resumen(ms[0]).total)} en ${mesLargo(ms[0])}`;
}
cabecera();
if ("serviceWorker" in navigator)
  navigator.serviceWorker.register("sw.js").catch(() => {});
