// De la foto del ticket a las bandas que se le mandan al modelo.
//
// Por que trocear: la API reescala cualquier imagen que pase de ~1,15 megapixeles
// o de 1568 px en su lado largo. Un ticket es estrecho y muy alto, asi que ese
// reescalado le come casi la mitad del ancho y con el la letra. Cortandolo en
// bandas que solapan, cada trozo llega a resolucion completa.

import { CONFIG } from "./config.js";

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
