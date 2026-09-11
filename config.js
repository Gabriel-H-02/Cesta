// La puerta que se deja abierta.
// modo 'directo'  -> el movil llama a la API con tu clave. Cero infraestructura.
// modo 'servidor' -> el movil manda la imagen a tu backend y este llama a la API.
//                    La clave deja de vivir en el telefono y la app se puede publicar.
// Para cambiar de uno a otro se toca solo este archivo.

export const CONFIG = {
  // Quien lee el ticket.
  //   'gemini'    Google AI Studio. Nivel gratuito permanente, sin tarjeta.
  //   'anthropic' Claude. Mejor lector, pero se paga por uso.
  // Se cambia solo aqui: el resto de la app no sabe quien hay detras.
  proveedor: "gemini",
  modelo: { gemini: "gemini-3.8-flash", anthropic: "claude-opus-5" },

  modo: "directo",
  endpoint: "/api/ticket",   // solo se usa en modo 'servidor'
  anchoMax: 1000,            // px, ancho al que se reduce la foto antes de trocearla
  altoBanda: 1100,           // px, alto de cada banda
  solape: 160,               // px que comparten dos bandas seguidas

  // Doble lectura: analiza el ticket dos veces, por separado, y compara.
  // La suma de control caza omisiones y digitos mal leidos, pero NO caza dos
  // errores que se compensan (leer 4,20 como 3,20 e inventar una linea de 1,00
  // cuadra igual de bien). Que dos lecturas independientes cometan el mismo par
  // de errores compensados es practicamente imposible, asi que esto si lo caza.
  // Cuesta el doble: unos 16 centimos por ticket en vez de 8.
  dobleLectura: false,

  // Cuanto se espera antes de rendirse. Sin esto, una peticion que se cuelga
  // deja la pantalla girando para siempre y no hay forma de saber que pasa.
  esperaMax: 90000,

  // Profundidad de razonamiento de Gemini: 'low' | 'medium' | 'high'.
  // En 'low' responde bastante antes. Para leer un ticket sobra, porque la
  // aritmetica no la creemos: la comprobamos aqui.
  razonamiento: "low",

  calidadJpeg: 0.8,
};

export const CLAVE_LS = "cesta.apiKey";
export const DATOS_LS = "cesta.tickets";
