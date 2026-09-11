// Deteccion de documento: encontrar el ticket dentro de la foto, enderezarlo y
// tirar el fondo. Es lo que hace el escaner de Drive.
//
// Sin OpenCV. Son ocho megas para el movil y aqui basta una tuberia clasica que
// cabe en este archivo:
//
//   0. Color    el papel es blanco: muy claro Y poco saturado. La piel de la mano
//               es naranja y pasa cualquier umbral de brillo, asi que sin mirar
//               la saturacion la mancha se come los dedos.
//   1. Otsu     dos veces. La primera separa claro de oscuro; la segunda, dentro
//               de lo claro, separa el papel del aluminio y de la tela beige,
//               que tambien son neutros pero menos brillantes.
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

// ---------- 1 bis. Mascara de papel a partir de pixeles RGBA ----------
// Devuelve una mascara 0/255 y el umbral final, listo para mayorMancha.
export function mascaraPapel(rgba, an, al, satMax = 60) {
  const n = an * al;
  const brillo = new Uint8ClampedArray(n);
  const sat = new Uint8ClampedArray(n);
  for (let p = 0; p < n; p++) {
    const r = rgba[p * 4], g = rgba[p * 4 + 1], b = rgba[p * 4 + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    brillo[p] = max;
    sat[p] = max ? (((max - min) * 255) / max) | 0 : 0;
  }

  const u1 = otsu(brillo);
  // Segundo Otsu solo sobre los candidatos a papel. Sin esto, el aluminio de un
  // portatil o una silla clara entran en la mancha y se fusionan con el ticket.
  const claros = [];
  for (let p = 0; p < n; p++) if (brillo[p] > u1 && sat[p] < satMax) claros.push(brillo[p]);
  const u2 = claros.length > 50 ? otsu(new Uint8ClampedArray(claros)) : u1;

  const m = new Uint8ClampedArray(n);
  for (let p = 0; p < n; p++) m[p] = brillo[p] > u2 && sat[p] < satMax ? 255 : 0;
  return { mascara: m, umbral: u2, brillo };
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


// ---------- 6. Saber cuando NO se ha encontrado el ticket ----------
// Recortar mal es peor que no recortar: si la mancha se fusiona con el fondo, el
// recorte tira media hoja. Ante la duda se manda la foto entera, que el modelo
// aun puede leer. Estas tres condiciones cazan los casos reales que fallaban.
export function plausible(esq, an, al, cobertura) {
  if (!esq) return { ok: false, motivo: "no encontré ningún documento" };

  const xs = esq.map((p) => p[0]), ys = esq.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);

  // Tocar el borde del encuadre delata que la mancha se ha ido por la foto:
  // es lo que pasa cuando el ticket esta sobre una superficie clara y grande.
  const margen = 3;
  if (x0 <= margen || y0 <= margen || x1 >= an - 1 - margen || y1 >= al - 1 - margen)
    return { ok: false, motivo: "la silueta se sale del encuadre" };

  // Un ticket es una tira: claramente mas alto que ancho.
  const prop = (y1 - y0) / Math.max(1, x1 - x0);
  if (prop < 1.5) return { ok: false, motivo: `la silueta sale demasiado ancha (${prop.toFixed(1)})` };

  if (cobertura > 0.75) return { ok: false, motivo: "la silueta ocupa casi toda la foto" };
  if (cobertura < 0.05) return { ok: false, motivo: "la silueta es demasiado pequeña" };

  return { ok: true, proporcion: prop };
}
