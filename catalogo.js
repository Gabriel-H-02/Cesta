// El nombre con el que se agrupa un articulo lo propone el modelo, y cambia de
// una lectura a otra: "perlas de mozzarella" la primera vez y "mozzarella en
// perlas" la segunda, leyendo el mismo ticket con minutos de diferencia. Diez de
// catorce articulos cambiaron de nombre en la prueba del 2 de octubre.
//
// Como informe.js agrupa por ese nombre, sin catalogo el mismo articulo de dos
// meses cuenta como dos, nunca junta dos observaciones y el indice de precios a
// doce meses no puede formarse. Ni la aritmetica ni la doble lectura lo cazan,
// porque los importes estan bien.
//
// Lo estable es la descripcion impresa en el papel: el modelo la transcribe, no
// la redacta. Es la clave. La primera vez que aparece se congela el nombre y la
// categoria que propuso el modelo; a partir de ahi mandan los del catalogo y da
// igual lo que escriba en lecturas posteriores.

import { CATALOGO_LS } from "./config.js";

// Insensible a acentos, mayusculas y espacios de mas: dos bandas distintas
// pueden transcribir JAMON y JAMÓN, y es el mismo articulo.
export const clave = (descripcion) =>
  String(descripcion ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase().replace(/\s+/g, " ").trim();

export function leerCatalogo() {
  try { return JSON.parse(localStorage.getItem(CATALOGO_LS)) || {}; }
  catch { return {}; }
}

function escribir(c) {
  localStorage.setItem(CATALOGO_LS, JSON.stringify(c));
}

// Se devuelve una funcion y no se resuelve linea a linea para no releer y
// reparsear el catalogo entero una vez por articulo.
export function resolutor() {
  const c = leerCatalogo();
  return (l) => {
    const e = c[clave(l.descripcion)];
    return e ? { ...l, producto: e.producto, categoria: e.categoria } : l;
  };
}

// Se llama al guardar un ticket, no al leerlo: si descartas la lectura, el
// catalogo no se queda con nombres de un ticket que nunca entro.
export function registrar(ticket) {
  const c = leerCatalogo();
  const nuevos = [];
  for (const l of ticket.lineas || []) {
    const k = clave(l.descripcion);
    if (!k || c[k]) continue;
    c[k] = {
      descripcion: l.descripcion,
      producto: l.producto || l.descripcion,
      categoria: l.categoria || "otros",
      unidad: l.unidad_norm || "ud",
      desde: (ticket.fecha || "").slice(0, 10),
    };
    nuevos.push(k);
  }
  if (nuevos.length) escribir(c);
  return nuevos;
}

export function entradas() {
  return Object.entries(leerCatalogo())
    .map(([k, e]) => ({ clave: k, ...e }))
    .sort((a, b) => a.producto.localeCompare(b.producto, "es") ||
                    a.descripcion.localeCompare(b.descripcion, "es"));
}

export function renombrar(claves, producto, categoria) {
  const c = leerCatalogo();
  for (const k of claves) {
    if (!c[k]) continue;
    if (producto != null) c[k].producto = producto;
    if (categoria != null) c[k].categoria = categoria;
  }
  escribir(c);
}

export function olvidar(k) {
  const c = leerCatalogo();
  delete c[k];
  escribir(c);
}

// Dos descripciones distintas que ya apuntan al mismo nombre son el mismo
// articulo. Es lo que la pantalla ensena agrupado, para que se vea de un vistazo
// lo que falta por unificar.
export function porNombre() {
  const por = {};
  for (const e of entradas()) (por[e.producto] ||= []).push(e);
  return Object.entries(por)
    .map(([producto, filas]) => ({ producto, filas }))
    .sort((a, b) => a.producto.localeCompare(b.producto, "es"));
}
