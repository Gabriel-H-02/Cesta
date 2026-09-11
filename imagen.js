// De la foto del ticket a las bandas que se le mandan al modelo.
//
// Por que trocear: la API reescala cualquier imagen que pase de ~1,15 megapixeles
// o de 1568 px en su lado largo. Un ticket es estrecho y muy alto, asi que ese
// reescalado le come casi la mitad del ancho y con el la letra. Cortandolo en
// bandas que solapan, cada trozo llega a resolucion completa.

import { CONFIG } from "./config.js";
import { mascaraPapel, mayorMancha, casco, esquinas, plausible, homografia, aplicar, tamanoSalida } from "./documento.js";

function dibujar(fuente, ancho, alto, sx, sy, sAncho, sAlto) {
  const lienzo = document.createElement("canvas");
  lienzo.width = ancho;
  lienzo.height = alto;
  const ctx = lienzo.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(fuente, sx, sy, sAncho, sAlto, 0, 0, ancho, alto);
  return lienzo;
}

function aBase64(lienzo) {
  return lienzo.toDataURL("image/jpeg", CONFIG.calidadJpeg).split(",")[1];
}

export async function cargarImagen(archivo) {
  const url = URL.createObjectURL(archivo);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    // El objeto sigue vivo hasta que la imagen se decodifica; liberarlo despues.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

// Busca el ticket dentro de la foto y lo endereza, tirando el fondo.
// Devuelve un lienzo con solo el papel, o null si no encuentra nada que valga.
export function enderezar(fuente) {
  const anF = fuente.naturalWidth || fuente.width;
  const alF = fuente.naturalHeight || fuente.height;

  // La deteccion corre sobre una copia diminuta: es igual de fiable para
  // encontrar la silueta y cuesta una fraccion.
  const anD = 240, alD = Math.max(1, Math.round(anF ? anD * alF / anF : 1));
  const chico = document.createElement("canvas");
  chico.width = anD; chico.height = alD;
  const cx = chico.getContext("2d", { willReadFrequently: true });
  cx.drawImage(fuente, 0, 0, anD, alD);
  const d = cx.getImageData(0, 0, anD, alD).data;

  const { mascara } = mascaraPapel(d, anD, alD);
  const mancha = mayorMancha(mascara, anD, alD, 0);
  const cobertura = mancha ? mancha.n / (anD * alD) : 0;
  const esq = mancha ? esquinas(casco(mancha.puntos)) : null;

  // Recortar mal es peor que no recortar.
  const juicio = plausible(esq, anD, alD, cobertura);
  if (!juicio.ok) return { fallo: juicio.motivo };

  // Esquinas de vuelta a la resolucion original.
  const k = anF / anD;
  const grandes = esq.map(([x, y]) => [x * k, y * k]);

  const { an, al } = tamanoSalida(grandes, CONFIG.anchoMax);
  // Del rectangulo de salida al cuadrilatero de origen: se recorre el destino
  // y se va a buscar el pixel que le toca, que es como no dejar huecos.
  const h = homografia([[0, 0], [an, 0], [an, al], [0, al]], grandes);
  if (!h) return { fallo: "no se pudo enderezar la perspectiva" };

  const origen = document.createElement("canvas");
  origen.width = anF; origen.height = alF;
  origen.getContext("2d", { willReadFrequently: true }).drawImage(fuente, 0, 0);
  const src = origen.getContext("2d").getImageData(0, 0, anF, alF).data;

  const salida = document.createElement("canvas");
  salida.width = an; salida.height = al;
  const ctxS = salida.getContext("2d");
  const img = ctxS.createImageData(an, al);
  const out = img.data;

  for (let y = 0; y < al; y++) {
    for (let x = 0; x < an; x++) {
      const [sx, sy] = aplicar(h, x + 0.5, y + 0.5);
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      const o = (y * an + x) * 4;
      if (x0 < 0 || y0 < 0 || x0 >= anF - 1 || y0 >= alF - 1) {
        out[o] = out[o + 1] = out[o + 2] = 255; out[o + 3] = 255;
        continue;
      }
      // Bilineal: sin esto el texto pequeno sale con dientes al girar.
      const fx = sx - x0, fy = sy - y0;
      const i00 = (y0 * anF + x0) * 4, i10 = i00 + 4;
      const i01 = i00 + anF * 4, i11 = i01 + 4;
      for (let c = 0; c < 3; c++) {
        const arriba = src[i00 + c] * (1 - fx) + src[i10 + c] * fx;
        const abajo = src[i01 + c] * (1 - fx) + src[i11 + c] * fx;
        out[o + c] = arriba * (1 - fy) + abajo * fy;
      }
      out[o + 3] = 255;
    }
  }
  ctxS.putImageData(img, 0, 0);
  return { lienzo: salida, esquinas: grandes, cobertura };
}

// Devuelve { bandas: [base64...], vistaPrevia: dataURL }
export function trocear(img) {
  const escala = Math.min(1, CONFIG.anchoMax / img.naturalWidth);
  const ancho = Math.round(img.naturalWidth * escala);
  const alto = Math.round(img.naturalHeight * escala);

  const completa = dibujar(img, ancho, alto, 0, 0, img.naturalWidth, img.naturalHeight);
  const vistaPrevia = completa.toDataURL("image/jpeg", 0.7);

  if (alto <= CONFIG.altoBanda) {
    return { bandas: [aBase64(completa)], vistaPrevia, n: 1 };
  }

  const paso = CONFIG.altoBanda - CONFIG.solape;
  const bandas = [];
  for (let y = 0; y < alto; y += paso) {
    const h = Math.min(CONFIG.altoBanda, alto - y);
    if (h < CONFIG.solape && bandas.length) break; // resto ya cubierto por el solape
    bandas.push(aBase64(dibujar(completa, ancho, h, 0, y, ancho, h)));
    if (y + h >= alto) break;
  }
  return { bandas, vistaPrevia, n: bandas.length };
}
