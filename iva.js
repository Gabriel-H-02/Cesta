// Quien asigna el tipo de IVA a cada linea.
//
// Antes lo hacia el modelo, y era lo unico que le obligaba a razonar: leer el
// ticket le sale perfecto sin pensar, pero cuadrar los tramos no. Medido el 2 de
// octubre sobre el ticket del 31 de agosto, seis lecturas: las 14 lineas y el
// total salieron bien las seis veces con cualquier modelo y cualquier nivel de
// razonamiento; el IVA solo cuadraba con razonamiento, y eso costaba de quince a
// veintidos segundos en vez de diez.
//
// Asi que el modelo propone el tipo de cada articulo, que es conocimiento suyo y
// no requiere calculo, y el reparto exacto se resuelve aqui contra el desglose
// impreso. El desglose NO determina el tipo de cada linea por si solo (para ese
// ticket hay seis particiones validas y solo tres lineas quedan fijadas), pero
// entre todas las particiones validas se elige la que menos contradice al modelo.
// Es la combinacion de las dos cosas la que da una respuesta unica.

const cent = (x) => Math.round((Number(x) || 0) * 100);

// Mas alla de esto el reparto se deja como venga. Un ticket normal no se acerca:
// el del 31 de agosto genera unos pocos cientos de estados.
const MAX_ESTADOS = 300000;

export function resolverIva(lineas, desgloseIva) {
  const tramos = (desgloseIva || []).map((t) => ({ tipo: t.tipo, bruto: cent(t.base) + cent(t.cuota) }));

  // Sin desglose impreso no hay nada contra lo que resolver: se respeta al modelo.
  if (!tramos.length) return { lineas, resuelto: false, motivo: "el ticket no trae desglose de IVA" };
  if (tramos.length > 3) return { lineas, resuelto: false, motivo: "demasiados tramos de IVA" };

  const importes = lineas.map((l) => cent(l.importe));
  if (importes.reduce((a, b) => a + b, 0) !== tramos.reduce((a, t) => a + t.bruto, 0))
    return { lineas, resuelto: false, motivo: "las lineas no suman lo que suma el desglose" };

  // Un solo tramo: todas las lineas van a el, sin nada que decidir.
  if (tramos.length === 1)
    return { lineas: lineas.map((l) => ({ ...l, iva: tramos[0].tipo })), resuelto: true, cambiadas: 0, ambiguo: false };

  // Coste de poner la linea i en el tramo j: 0 si es lo que propuso el modelo.
  const coste = (i, j) => (Math.round((lineas[i].iva ?? -1) * 1000) === Math.round(tramos[j].tipo * 1000) ? 0 : 1);

  // Programacion dinamica sobre las sumas acumuladas de los primeros tramos; el
  // ultimo sale por diferencia. Estados dispersos en un Map porque un descuento
  // trae importes negativos y los indices de un array no valen.
  const ultimo = tramos.length - 1;
  // Se llevan las sumas de los primeros tramos; el ultimo sale por diferencia.
  // Con dos tramos eso es una sola suma, no dos: la clave inicial tiene que
  // tener tantos ceros como tramos se siguen, o el destino no se alcanza nunca.
  const META = tramos.slice(0, ultimo).map((t) => t.bruto).join("|");
  let capa = new Map([[new Array(ultimo).fill(0).join("|"), { coste: 0, soluciones: 1, de: null, eleccion: -1 }]]);
  const capas = [capa];

  for (let i = 0; i < importes.length; i++) {
    const siguiente = new Map();
    for (const [clave, est] of capa) {
      const sumas = clave.split("|").map(Number);
      for (let j = 0; j < tramos.length; j++) {
        const nuevas = [...sumas];
        if (j !== ultimo) {
          nuevas[j] += importes[i];
          // Podar: una suma no puede pasarse de lo que pide su tramo. Solo vale
          // si no hay descuentos, que podrian bajarla despues.
          if (importes.every((x) => x >= 0) && nuevas[j] > tramos[j].bruto) continue;
        }
        const k = nuevas.join("|");
        const c = est.coste + coste(i, j);
        const previo = siguiente.get(k);
        if (!previo || c < previo.coste)
          siguiente.set(k, { coste: c, soluciones: est.soluciones, de: clave, eleccion: j });
        else if (c === previo.coste)
          previo.soluciones = Math.min(previo.soluciones + est.soluciones, 1e9);
      }
    }
    if (siguiente.size > MAX_ESTADOS)
      return { lineas, resuelto: false, motivo: "demasiadas combinaciones posibles" };
    capa = siguiente;
    capas.push(capa);
  }

  // El estado bueno es aquel en que cada tramo tiene exactamente lo suyo.
  const destino = capa.get(META);
  if (!destino) return { lineas, resuelto: false, motivo: "ninguna asignacion hace cuadrar los tramos" };

  // Camino de vuelta: de la ultima capa a la primera.
  const elecciones = new Array(importes.length);
  let clave = META;
  for (let i = importes.length; i > 0; i--) {
    const est = capas[i].get(clave);
    elecciones[i - 1] = est.eleccion;
    clave = est.de;
  }

  return {
    lineas: lineas.map((l, i) => ({ ...l, iva: tramos[elecciones[i]].tipo })),
    resuelto: true,
    cambiadas: destino.coste,
    ambiguo: destino.soluciones > 1,
  };
}
