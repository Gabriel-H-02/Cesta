// El informe que se va armando solo. Se recalcula entero cada vez que entra
// un ticket, que con estos volumenes es instantaneo y no puede desincronizarse.

import { leerTodos, eur } from "./almacen.js";

const NOMBRES = {
  frutas_verduras: "Fruta y verdura", carne: "Carne", pescado: "Pescado",
  lacteos_huevos: "Lacteos y huevos", panaderia: "Panaderia", despensa: "Despensa",
  congelados: "Congelados", bebidas: "Bebidas", dulces_snacks: "Dulces y snacks",
  platos_preparados: "Preparados", higiene_personal: "Higiene", limpieza_hogar: "Hogar",
  mascotas: "Mascotas", otros: "Otros",
};

const mesDe = (iso) => iso.slice(0, 7);
export const mesLargo = (m) =>
  new Date(m + "-01T12:00").toLocaleDateString("es-ES", { month: "long", year: "numeric" });

export function resumen(mes) {
  const tickets = leerTodos().filter((t) => !mes || mesDe(t.fecha) === mes);
  const lineas = tickets.flatMap((t) => t.lineas.map((l) => ({ ...l, fecha: t.fecha })));

  const porCategoria = {};
  for (const l of lineas) porCategoria[l.categoria] = (porCategoria[l.categoria] || 0) + l.importe;

  const categorias = Object.entries(porCategoria)
    .map(([k, v]) => ({ clave: k, nombre: NOMBRES[k] || k, importe: v }))
    .sort((a, b) => b.importe - a.importe);

  const total = lineas.reduce((a, l) => a + l.importe, 0);
  return { tickets, lineas, categorias, total, nCompras: tickets.length };
}

export function meses() {
  return [...new Set(leerTodos().map((t) => mesDe(t.fecha)))].sort().reverse();
}

// Gasto por cadena. Sale del campo 'comercio', que hasta ahora se guardaba y no
// se usaba para nada.
export function porTienda(mes) {
  const { tickets, total } = resumen(mes);
  const por = {};
  for (const t of tickets) {
    const c = t.comercio || "sin identificar";
    (por[c] ||= { comercio: c, importe: 0, compras: 0 });
    por[c].importe += t.lineas.reduce((a, l) => a + l.importe, 0);
    por[c].compras++;
  }
  return Object.values(por)
    .map((x) => ({ ...x, cuota: total ? x.importe / total : 0, medio: x.importe / x.compras }))
    .sort((a, b) => b.importe - a.importe);
}

// Precio unitario de una linea, normalizado a euro por kilo, litro o unidad.
// Devuelve null cuando no se puede saber cuanto producto habia.
function unitario(l) {
  const cantidad = l.cantidad_norm || l.peso_kg;
  if (!cantidad || cantidad <= 0 || l.importe <= 0) return null;
  return l.importe / ((l.cantidad || 1) * cantidad);
}

// La comparacion entre supermercados. Para cada producto comprado en dos cadenas
// o mas, cuanto cuesta la unidad en cada una y cuanto te ahorras yendo a la barata.
//
// Se usa la MEDIANA y no la media: una oferta puntual no puede decidir por si sola
// que una cadena es la barata.
export function compararTiendas() {
  const por = {};
  for (const t of leerTodos()) {
    for (const l of t.lineas) {
      const u = unitario(l);
      if (u === null) continue;
      const p = (por[l.producto] ||= { producto: l.producto, unidad: l.unidad_norm, tiendas: {} });
      (p.tiendas[t.comercio || "sin identificar"] ||= []).push(u);
    }
  }

  const mediana = (xs) => {
    const o = [...xs].sort((a, b) => a - b);
    const m = Math.floor(o.length / 2);
    return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
  };

  return Object.values(por)
    .map((p) => {
      const filas = Object.entries(p.tiendas)
        .map(([comercio, precios]) => ({ comercio, precio: mediana(precios), n: precios.length }))
        .sort((a, b) => a.precio - b.precio);
      if (filas.length < 2) return null;
      const barata = filas[0], cara = filas[filas.length - 1];
      return {
        producto: p.producto, unidad: p.unidad, filas, barata, cara,
        diferencia: cara.precio - barata.precio,
        porcentaje: barata.precio ? (cara.precio - barata.precio) / barata.precio : 0,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.porcentaje - a.porcentaje);
}

// Precio por unidad normalizada de cada producto a lo largo del tiempo.
// Solo devuelve los que tienen dos observaciones o mas: con una no hay nada que comparar.
export function precios() {
  const por = {};
  for (const t of leerTodos()) {
    for (const l of t.lineas) {
      const u = unitario(l);
      if (u === null) continue;
      (por[l.producto] ||= { producto: l.producto, unidad: l.unidad_norm, puntos: [] })
        .puntos.push({ fecha: t.fecha.slice(0, 10), precio: u, comercio: t.comercio });
    }
  }
  return Object.values(por)
    .map((p) => {
      p.puntos.sort((a, b) => a.fecha.localeCompare(b.fecha));
      const primero = p.puntos[0].precio;
      const ultimo = p.puntos[p.puntos.length - 1].precio;
      return { ...p, primero, ultimo, variacion: primero ? (ultimo - primero) / primero : 0 };
    })
    .filter((p) => p.puntos.length >= 2)
    .sort((a, b) => Math.abs(b.variacion) - Math.abs(a.variacion));
}

export { eur };
