// Guardado y, sobre todo, verificacion. La aritmetica del modelo no se cree:
// se comprueba aqui, en centimos enteros, para que no la estropeen los flotantes.

import { DATOS_LS } from "./config.js";

const cent = (x) => Math.round((Number(x) || 0) * 100);
export const eur = (x) => (x || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" });

export function verificar(d) {
  const lineas = d.lineas || [];
  const sumaLineas = lineas.reduce((a, l) => a + cent(l.importe), 0);
  const total = cent(d.total);

  const tramos = (d.desglose_iva || []).map((t) => {
    const bruto = cent(t.base) + cent(t.cuota);
    const asignado = lineas
      .filter((l) => Math.round(l.iva * 1000) === Math.round(t.tipo * 1000))
      .reduce((a, l) => a + cent(l.importe), 0);
    return { tipo: t.tipo, bruto, asignado, cuadra: bruto === asignado };
  });

  const sumaIva = (d.desglose_iva || []).reduce((a, t) => a + cent(t.base) + cent(t.cuota), 0);

  const avisos = [];
  if (sumaLineas !== total)
    avisos.push(`Las lineas suman ${eur(sumaLineas / 100)} y el total impreso es ${eur(total / 100)}.`);
  if (sumaIva !== total)
    avisos.push(`El desglose de IVA suma ${eur(sumaIva / 100)}, no ${eur(total / 100)}.`);
  for (const t of tramos)
    if (!t.cuadra)
      avisos.push(`IVA ${Math.round(t.tipo * 100)}%: las lineas asignadas suman ${eur(t.asignado / 100)} y el tramo pide ${eur(t.bruto / 100)}.`);

  return {
    ok: avisos.length === 0,
    cuadraTotal: sumaLineas === total,
    sumaLineas: sumaLineas / 100,
    tramos,
    avisos,
  };
}

export function leerTodos() {
  try { return JSON.parse(localStorage.getItem(DATOS_LS)) || []; }
  catch { return []; }
}

export function guardar(ticket) {
  const todos = leerTodos();
  const id = `${ticket.fecha}|${ticket.factura || ticket.total}`;
  if (todos.some((t) => t.id === id)) return { duplicado: true, total: todos.length };
  todos.push({ ...ticket, id, guardadoEl: new Date().toISOString() });
  todos.sort((a, b) => a.fecha.localeCompare(b.fecha));
  localStorage.setItem(DATOS_LS, JSON.stringify(todos));
  return { duplicado: false, total: todos.length };
}

export function borrar(id) {
  localStorage.setItem(DATOS_LS, JSON.stringify(leerTodos().filter((t) => t.id !== id)));
}

export function exportar() {
  const blob = new Blob([JSON.stringify(leerTodos(), null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `cesta-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
