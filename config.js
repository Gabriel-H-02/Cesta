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
  // Cadena de modelos, en orden. Se prueba el primero y se baja al siguiente si
  // viene saturado, sin cuota o sin existir.
  //
  // El de moda NO va el primero a proposito: gemini-3.8-flash es el modelo
  // estrella, se satura y su cuota gratuita es minima. Los de una generacion
  // atras y los 'lite' estan mucho mas libres y para leer un ticket dan de
  // sobra, porque las cuentas no se las creemos: las comprobamos aqui. Medido
  // el 2 de octubre: 3.8-flash devolvio 503 a la primera, y 3.6-flash leyo el
  // ticket entero bien seis veces de seis.
  //
  // gemini-2.5-flash estaba aqui y era un eslabon muerto: Google lo retiro para
  // cuentas nuevas y devuelve 404 siempre. Lo sustituye 3.8-flash, que al menos
  // responde cuando no esta saturado.
  modelo: {
    gemini: ["gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.8-flash"],
    anthropic: "claude-opus-5",
  },

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

  // Profundidad de razonamiento de Gemini: 'minimal' | 'low' | 'medium' | 'high'.
  //
  // Medido el 2 de octubre con el ticket del 31 de agosto, seis lecturas: las 14
  // lineas y el total salen bien SIEMPRE, con cualquier modelo y con cualquier
  // razonamiento. Leer el ticket no necesita pensar. Lo unico que lo necesitaba
  // era cuadrar los tramos de IVA, y eso costaba de 15 a 22 segundos en vez de 10.
  //
  // Ya no se le pide: el reparto del IVA lo resuelve iva.js contra el desglose
  // impreso, y la propuesta del modelo solo sirve para elegir entre las
  // combinaciones que cuadran. Con eso 'minimal' basta.
  //
  // No todos los modelos lo admiten: gemini-3.8-flash devuelve 400. parser.js lo
  // detecta y le repite sin pedir nivel, en vez de tirar la cadena entera.
  razonamiento: "minimal",

  calidadJpeg: 0.8,
};

export const CLAVE_LS = "cesta.apiKey";
export const DATOS_LS = "cesta.tickets";
export const CATALOGO_LS = "cesta.catalogo";
