// Camara en vivo con disparo automatico.
//
// No detecta los bordes del ticket. Eso pide vision por computador de verdad y
// ocho megas de OpenCV cargando en el movil. Mide tres cosas que predicen mejor
// que la foto salga legible, y son baratas de calcular sobre un fotograma
// diminuto:
//
//   COBERTURA  cuanto encuadre ocupa la mancha clara del papel. Poca significa
//              que estas lejos; demasiada, que te has comido los bordes.
//   NITIDEZ    varianza del laplaciano. Es la medida clasica de desenfoque y la
//              que de verdad decide si el modelo puede leer los digitos.
//   QUIETUD    diferencia media entre fotogramas seguidos. Con el pulso movido
//              sale trepidada aunque este enfocada.
//
// Cuando las tres se cumplen durante ESTABLES comprobaciones seguidas, dispara.

export const UMBRALES = {
  coberturaMin: 0.18,
  coberturaMax: 0.94,
  nitidez: 90,      // varianza del laplaciano sobre gris 0-255
  movimiento: 7,    // diferencia media por pixel, 0-255
  estables: 5,      // comprobaciones seguidas en verde antes de disparar
  cadaMs: 160,
  analisis: 192,    // ancho del fotograma de analisis
};

export class Camara {
  constructor(video, alCambiarEstado, alCapturar) {
    this.video = video;
    this.alCambiarEstado = alCambiarEstado;
    this.alCapturar = alCapturar;
    this.lienzo = document.createElement("canvas");
    this.ctx = this.lienzo.getContext("2d", { willReadFrequently: true });
    this.previo = null;
    this.buenos = 0;
    this.timer = null;
    this.stream = null;
    this.auto = true;
  }

  async arrancar() {
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error("Este navegador no da acceso a la cámara. Usa el selector de archivos.");
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" },
               width: { ideal: 1920 }, height: { ideal: 1440 } },
      audio: false,
    });
    this.video.srcObject = this.stream;
    await this.video.play();
    this.previo = null;
    this.buenos = 0;
    this.timer = setInterval(() => this.mirar(), UMBRALES.cadaMs);
  }

  parar() {
    clearInterval(this.timer);
    this.timer = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  // Gris reducido del fotograma actual.
  gris() {
    const v = this.video;
    if (!v.videoWidth) return null;
    const an = UMBRALES.analisis;
    const al = Math.round(an * v.videoHeight / v.videoWidth);
    this.lienzo.width = an; this.lienzo.height = al;
    this.ctx.drawImage(v, 0, 0, an, al);
    const d = this.ctx.getImageData(0, 0, an, al).data;
    const g = new Uint8ClampedArray(an * al);
    for (let i = 0, p = 0; i < d.length; i += 4, p++)
      g[p] = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
    return { g, an, al };
  }

  mirar() {
    const f = this.gris();
    if (!f) return;
    const { g, an, al } = f;

    // Cobertura: pixeles claramente mas brillantes que la mediana de la escena.
    // La mediana sale de un histograma de 256 cubos, no de ordenar el fotograma:
    // esto corre seis veces por segundo y ordenar 27.000 valores cada vez sobra.
    const hist = new Uint32Array(256);
    for (let i = 0; i < g.length; i++) hist[g[i]]++;
    let acumulado = 0, mediana = 0;
    for (let v = 0; v < 256; v++) {
      acumulado += hist[v];
      if (acumulado >= g.length / 2) { mediana = v; break; }
    }
    const corte = Math.max(mediana + 28, 118);
    let claros = 0;
    for (let i = 0; i < g.length; i++) if (g[i] > corte) claros++;
    const cobertura = claros / g.length;

    // Nitidez: varianza del laplaciano, medida solo sobre la zona clara.
    let suma = 0, suma2 = 0, n = 0;
    for (let y = 1; y < al - 1; y++) {
      for (let x = 1; x < an - 1; x++) {
        const i = y * an + x;
        if (g[i] <= corte) continue;
        const lap = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - an] - g[i + an];
        suma += lap; suma2 += lap * lap; n++;
      }
    }
    const nitidez = n > 40 ? suma2 / n - (suma / n) ** 2 : 0;

    // Quietud contra el fotograma anterior.
    let movimiento = 0;
    if (this.previo && this.previo.length === g.length) {
      let acc = 0;
      for (let i = 0; i < g.length; i += 3) acc += Math.abs(g[i] - this.previo[i]);
      movimiento = acc / (g.length / 3);
    } else movimiento = 999;
    this.previo = g;

    const U = UMBRALES;
    let estado;
    if (cobertura < U.coberturaMin) estado = { clave: "lejos", texto: "Acerca el ticket" };
    else if (cobertura > U.coberturaMax) estado = { clave: "cerca", texto: "Sepáralo un poco" };
    else if (movimiento > U.movimiento) estado = { clave: "movido", texto: "Mantén el pulso" };
    else if (nitidez < U.nitidez) estado = { clave: "borroso", texto: "Enfocando…" };
    else estado = { clave: "listo", texto: "Listo" };

    this.buenos = estado.clave === "listo" ? this.buenos + 1 : 0;
    estado.progreso = Math.min(1, this.buenos / U.estables);
    estado.medidas = { cobertura, nitidez, movimiento };
    this.alCambiarEstado(estado);

    if (this.auto && this.buenos >= U.estables) this.disparar();
  }

  get activa() {
    return !!this.stream;
  }

  // Captura a resolucion completa, no la del analisis.
  async disparar() {
    if (!this.stream) return;
    clearInterval(this.timer);
    this.timer = null;
    const v = this.video;
    const l = document.createElement("canvas");
    l.width = v.videoWidth; l.height = v.videoHeight;
    l.getContext("2d").drawImage(v, 0, 0);
    const blob = await new Promise((r) => l.toBlob(r, "image/jpeg", 0.92));
    this.parar();
    this.alCambiarEstado({ clave: "capturada", texto: "Capturada", progreso: 1 });
    const archivo = new File([blob], "ticket.jpg", { type: "image/jpeg" });
    this.alCapturar?.(archivo);
    return archivo;
  }
}
