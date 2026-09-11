// Deteccion de documento: encontrar el ticket dentro de la foto, enderezarlo y
// tirar el fondo. Es lo que hace el escaner de Drive.
//
// Sin OpenCV. Son ocho megas para el movil y aqui basta una tuberia clasica que
// cabe en este archivo:
//
//   1. Otsu     separa papel de fondo con un umbral calculado de la propia foto,
//               no fijo. Este es el cambio que hace que funcione en la calle:
//               un umbral fijo solo acierta sobre fondo negro de estudio.
//   2. Mancha   la mayor region clara conectada. El ticket es la mancha grande;
//               los reflejos y las baldosas son manchas pequenas.
//   3. Casco    envolvente convexa de esa mancha, para tener su silueta.
//   4. Esquinas las cuatro del casco, que dan la inclinacion y la perspectiva.
//   5. Homografia y remuestreo: el cuadrilatero se estira a un rectangulo recto.

// ---------- 1. Umbral de Otsu ----------
// Elige el corte que mas separa las dos poblaciones de brillo de la imagen.
export function otsu(gris) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gris.length; i++) hist[gris[i]]++;
  const total = gris.length;
  let suma = 0;
  for (let v = 0; v < 256; v++) suma += v * hist[v];

  let sumaB = 0, pesoB = 0, mejor = 0, umbral = 127;
  for (let v = 0; v < 256; v++) {
    pesoB += hist[v];
    if (!pesoB) continue;
    const pesoF = total - pesoB;
    if (!pesoF) break;
    sumaB += v * hist[v];
    const mediaB = sumaB / pesoB;
    const mediaF = (suma - sumaB) / pesoF;
    const entre = pesoB * pesoF * (mediaB - mediaF) ** 2;
    if (entre > mejor) { mejor = entre; umbral = v; }
  }
  return umbral;
}

// ---------- 2. Mayor region clara conectada ----------
// Recorrido iterativo con pila: en un movil no se puede recursar sobre un millon
// de pixeles sin reventar la pila de llamadas.
export function mayorMancha(gris, an, al, umbral) {
  const visto = new Uint8Array(an * al);
  const pila = new Int32Array(an * al);
  let mejor = null;

  for (let s = 0; s < gris.length; s++) {
    if (visto[s] || gris[s] <= umbral) continue;
    let cima = 0, n = 0;
    pila[cima++] = s;
    visto[s] = 1;
    const puntos = [];
    while (cima) {
      const i = pila[--cima];
      const x = i % an, y = (i / an) | 0;
      puntos.push(x, y);
      n++;
      if (x > 0 && !visto[i - 1] && gris[i - 1] > umbral) { visto[i - 1] = 1; pila[cima++] = i - 1; }
      if (x < an - 1 && !visto[i + 1] && gris[i + 1] > umbral) { visto[i + 1] = 1; pila[cima++] = i + 1; }
      if (y > 0 && !visto[i - an] && gris[i - an] > umbral) { visto[i - an] = 1; pila[cima++] = i - an; }
      if (y < al - 1 && !visto[i + an] && gris[i + an] > umbral) { visto[i + an] = 1; pila[cima++] = i + an; }
    }
    if (!mejor || n > mejor.n) mejor = { n, puntos };
  }
  return mejor;
}

// ---------- 3. Envolvente convexa (marcha de Andrew) ----------
export function casco(puntos) {
  const p = [];
  for (let i = 0; i < puntos.length; i += 2) p.push([puntos[i], puntos[i + 1]]);
  p.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cruz = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const media = (orden) => {
    const s = [];
    for (const q of orden) {
      while (s.length >= 2 && cruz(s[s.length - 2], s[s.length - 1], q) <= 0) s.pop();
      s.push(q);
    }
    s.pop();
    return s;
  };
  return [...media(p), ...media([...p].reverse())];
}

// ---------- 4. Las cuatro esquinas ----------
// De todo el casco, los puntos extremos en las cuatro diagonales. Para una hoja
// rectangular, aunque este girada o en perspectiva, son sus vertices.
export function esquinas(hull) {
  if (hull.length < 4) return null;
  const extremo = (f) => hull.reduce((a, b) => (f(b) > f(a) ? b : a));
  const supIzq = extremo(([x, y]) => -(x + y));
  const infDer = extremo(([x, y]) => x + y);
  const supDer = extremo(([x, y]) => x - y);
  const infIzq = extremo(([x, y]) => y - x);
  const c = [supIzq, supDer, infDer, infIzq];
  // Degenerado: si dos esquinas coinciden, no es un cuadrilatero util.
  for (let i = 0; i < 4; i++)
    for (let j = i + 1; j < 4; j++)
      if (Math.hypot(c[i][0] - c[j][0], c[i][1] - c[j][1]) < 4) return null;
  return c;
}

// ---------- 5. Homografia ----------
// Ocho incognitas, ocho ecuaciones (dos por esquina), Gauss con pivoteo.
export function homografia(origen, destino) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = origen[i], [u, v] = destino[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  for (let col = 0; col < 8; col++) {
    let piv = col;
    for (let f = col + 1; f < 8; f++) if (Math.abs(A[f][col]) > Math.abs(A[piv][col])) piv = f;
    if (Math.abs(A[piv][col]) < 1e-10) return null;
    [A[col], A[piv]] = [A[piv], A[col]];
    [b[col], b[piv]] = [b[piv], b[col]];
    for (let f = 0; f < 8; f++) {
      if (f === col) continue;
      const k = A[f][col] / A[col][col];
      if (!k) continue;
      for (let c = col; c < 8; c++) A[f][c] -= k * A[col][c];
      b[f] -= k * b[col];
    }
  }
  const h = b.map((v, i) => v / A[i][i]);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

export function aplicar(h, x, y) {
  const w = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
}

// Lado medio entre dos esquinas, para calcular el tamano de salida.
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export function tamanoSalida([si, sd, id, ii], anchoMax) {
  const ancho = Math.max(dist(si, sd), dist(ii, id));
  const alto = Math.max(dist(si, ii), dist(sd, id));
  const an = Math.min(anchoMax, Math.round(ancho));
  return { an, al: Math.max(1, Math.round(an * alto / ancho)) };
}
