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

// Precio por unidad normalizada de cada producto a lo largo del tiempo.
// Solo devuelve los que tienen dos observaciones o mas: con una no hay nada que comparar.
export function precios() {
  const por = {};
  for (const t of leerTodos()) {
    for (const l of t.lineas) {
      const cantidad = l.cantidad_norm || l.peso_kg;
      if (!cantidad || cantidad <= 0) continue;
      const unidades = (l.cantidad || 1) * cantidad;   // p.ej. 2 bolsas x 0,25 kg
      const unitario = l.importe / unidades;
      (por[l.producto] ||= { producto: l.producto, unidad: l.unidad_norm, puntos: [] })
        .puntos.push({ fecha: t.fecha.slice(0, 10), precio: unitario });
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
