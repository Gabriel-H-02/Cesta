import { CLAVE_LS, DATOS_LS } from "./config.js";
import { cargarImagen, trocear } from "./imagen.js";
import { analizarTicket, coste } from "./parser.js";
import { verificar, guardar, leerTodos, exportar, eur } from "./almacen.js";
import { resumen, meses, mesLargo, precios, porTienda, compararTiendas } from "./informe.js";
import { Camara } from "./camara.js";

const $ = (s) => document.querySelector(s);
let bandas = null, ultimo = null, mesActivo = null;

/* ---------- navegacion ---------- */
document.querySelectorAll("nav button").forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll("nav button").forEach((x) => x.classList.toggle("activo", x === b));
    for (const v of ["Escanear", "Informe", "Ajustes"])
      $("#vista" + v).classList.toggle("oculto", v !== b.dataset.vista);
    if (b.dataset.vista === "Informe") pintarInforme();
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
    estado("bien", `Imagen lista, ${img.naturalWidth}×${img.naturalHeight}. ${
      t.n === 1 ? "Cabe en una banda." : `Cortada en ${t.n} bandas para no perder resolución.`}`);
  } catch (err) {
    estado("mal", "No se pudo leer la imagen: " + err.message);
  }
}

// 1. Camara en vivo con disparo automatico.
const zona = $("#zonaEscaner");
const camara = new Camara($("#video"), pintarEstadoCamara, (archivo) => {
  cerrarCamara();
  procesarArchivo(archivo);
});

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
      : err.message);
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
    } catch (err) { estado("mal", "No se pudo cargar el ejemplo: " + err.message); }
  };
  $("#atajos").append(b);
}

$("#botonAnalizar").addEventListener("click", async () => {
  if (!bandas) return;
  $("#botonAnalizar").disabled = true;
  estado("trabajando", "Leyendo el ticket. Suele tardar entre veinte segundos y un minuto.");
  try {
    const r = await analizarTicket(bandas);
    ultimo = r.datos;
    pintarTicket(r.datos, r.uso, r);
  } catch (err) {
    estado("mal", err.message);
    $("#botonAnalizar").disabled = false;
  }
});

function pintarTicket(d, uso, extra = {}) {
  const v = verificar(d);
  const avisos = [...v.avisos];
  if (extra.dobleLectura === "discrepan")
    avisos.push("Las dos lecturas no coinciden:<br>" + extra.discrepancias.join("<br>"));

  const limpio = v.ok && extra.dobleLectura !== "discrepan";
  estado(limpio ? "bien" : "mal",
    limpio
      ? "Las líneas cuadran con el total y con el desglose de IVA." +
        (extra.dobleLectura === "coinciden" ? " Dos lecturas independientes dan lo mismo." : "")
      : avisos.join("<br>"));

  const filas = d.lineas.map((l) => `
    <tr>
      <td>${l.cantidad > 1 ? `<b>${l.cantidad}×</b> ` : ""}${l.descripcion}
        <div class="etiqueta">${l.categoria.replace(/_/g, " ")} · IVA ${Math.round(l.iva * 100)}%</div></td>
      <td class="num">${eur(l.importe)}</td>
    </tr>`).join("");

  $("#resultado").innerHTML = `
    <div class="tarjeta">
      <h2>${d.comercio} · ${new Date(d.fecha).toLocaleDateString("es-ES",
        { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}</h2>
      <table>${filas}
        <tr class="totalfila"><td>Total</td><td class="num">${eur(d.total)}</td></tr>
      </table>
      <button class="principal" id="botonGuardar">
        ${limpio ? "Guardar" : "Guardar de todas formas"}
      </button>
      <p class="nota">${d.lineas.length} líneas${coste(uso) === 0 ? " · lectura gratuita" : uso ? ` · ${(coste(uso) * 100).toFixed(1)} céntimos` : ""}<br>
        Compara las líneas con la foto antes de guardar: la suma de control caza
        omisiones y dígitos mal leídos, pero no dos errores que se compensen.</p>
    </div>`;

  $("#botonGuardar").onclick = () => {
    const r = guardar({ ...d, verificado: limpio });
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
  $("#categorias").innerHTML = r.categorias.map((c) => `
    <div class="barra">
      <div class="cab"><span>${c.nombre}</span>
        <span>${eur(c.importe)} <span style="color:var(--tenue)">${Math.round(c.importe / r.total * 100)}%</span></span></div>
      <div class="canal"><div class="relleno" style="width:${c.importe / tope * 100}%"></div></div>
    </div>`).join("");

  // Por supermercado
  const ts = porTienda(mesActivo);
  const topeT = ts[0]?.importe || 1;
  $("#tiendas").innerHTML = ts.length > 1 || ts[0]?.comercio
    ? ts.map((t) => `
      <div class="barra">
        <div class="cab"><span style="text-transform:capitalize">${t.comercio}</span>
          <span>${eur(t.importe)} <span style="color:var(--tenue)">${t.compras} ${t.compras === 1 ? "compra" : "compras"}</span></span></div>
        <div class="canal"><div class="relleno" style="width:${t.importe / topeT * 100}%"></div></div>
      </div>`).join("")
    : '<div class="vacio">Todavía no hay compras.</div>';

  // Comparativa entre cadenas
  const cs = compararTiendas();
  $("#comparativa").innerHTML = cs.length ? cs.slice(0, 12).map((c) => `
      <div class="barra">
        <div class="cab"><span>${c.producto}</span>
          <span class="bajar">−${eur(c.diferencia)}/${c.unidad}</span></div>
        <div style="font-size:.8rem;color:var(--tenue);text-transform:capitalize">
          ${c.filas.map((f, i) => `${i === 0 ? "✓ " : ""}${f.comercio} ${eur(f.precio)}`).join(" · ")}
          <span style="text-transform:none"> · ${Math.round(c.porcentaje * 100)}% más caro en ${c.cara.comercio}</span></div>
      </div>`).join("")
    : `<div class="vacio">Hace falta comprar el mismo producto en dos cadenas distintas.
       ${ts.length < 2 ? "De momento solo has escaneado en una." : ""}</div>`;

  const ps = precios();
  $("#preciosLista").innerHTML = ps.length ? ps.slice(0, 15).map((p) => {
    const pct = p.variacion * 100;
    const signo = pct > 0 ? "+" : "";
    return `<div class="barra"><div class="cab">
        <span>${p.producto}</span>
        <span class="${pct > 0.5 ? "subir" : pct < -0.5 ? "bajar" : ""}">
          ${eur(p.ultimo)}/${p.unidad} <b>${signo}${pct.toFixed(1)}%</b></span>
      </div><div style="font-size:.78rem;color:var(--tenue)">
        ${p.puntos.length} observaciones desde ${p.puntos[0].fecha}</div></div>`;
  }).join("") : '<div class="vacio">Hacen falta dos compras del mismo producto para comparar.</div>';
}

/* ---------- ajustes ---------- */
function pintarAjustes() {
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
