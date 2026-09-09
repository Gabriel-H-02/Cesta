// Contrato con el modelo: prompt y esquema de salida.
// Vive aparte a proposito. El dia que el parseo se mueva a un servidor,
// este archivo se copia tal cual y no hay nada que reescribir.

export const CATEGORIAS = [
  "frutas_verduras", "carne", "pescado", "lacteos_huevos", "panaderia",
  "despensa", "congelados", "bebidas", "dulces_snacks", "platos_preparados",
  "higiene_personal", "limpieza_hogar", "mascotas", "otros",
];

export const ESQUEMA = {
  type: "object",
  additionalProperties: false,
  required: ["comercio", "tienda", "fecha", "factura", "lineas", "total", "desglose_iva"],
  // desglose_iva puede venir vacio: hay cadenas que no lo desglosan por tramos.
  properties: {
    comercio: { type: "string", description: "Nombre de la cadena, normalizado y estable entre tickets: mercadona, carrefour, dia, lidl, aldi, alcampo, eroski... En minusculas y sin S.A. ni razon social." },
    tienda: { type: ["string", "null"], description: "Direccion o localidad del establecimiento concreto, si aparece." },
    fecha: { type: "string", description: "ISO 8601, p.ej. 2026-08-31T14:23" },
    factura: { type: ["string", "null"], description: "Numero de factura simplificada" },
    total: { type: "number" },
    lineas: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["cantidad", "descripcion", "producto", "peso_kg",
                   "precio_unit", "importe", "categoria", "iva",
                   "cantidad_norm", "unidad_norm"],
        properties: {
          cantidad: { type: "number", description: "Unidades. 1 si no se indica otra cosa." },
          descripcion: { type: "string", description: "Texto literal del ticket, sin corregir ni expandir." },
          producto: { type: "string", description: "Nombre legible y estable del producto, en minusculas. Es la clave con la que se agrupa el mismo articulo entre meses, asi que tiene que salir igual aunque el ticket abrevie distinto." },
          peso_kg: { type: ["number", "null"], description: "Solo si el articulo se vende a peso y el ticket imprime los kg." },
          precio_unit: { type: ["number", "null"], description: "Columna P. Unit. Suele venir vacia cuando la cantidad es 1; en ese caso null." },
          importe: { type: "number", description: "Columna Imp. (EUR) de esa linea." },
          categoria: { type: "string", enum: CATEGORIAS },
          iva: { type: "number", description: "0.04, 0.10 o 0.21" },
          cantidad_norm: { type: ["number", "null"], description: "Cantidad en la unidad normalizada. 'ICEBERG 250 GR' son 0.25 con unidad kg. Null si no se puede deducir del nombre." },
          unidad_norm: { type: "string", enum: ["kg", "l", "ud"] },
        },
      },
    },
    desglose_iva: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["tipo", "base", "cuota"],
        properties: {
          tipo: { type: "number", description: "0.04, 0.10 o 0.21" },
          base: { type: "number" },
          cuota: { type: "number" },
        },
      },
    },
  },
};

export const SISTEMA = `Extraes las lineas de un ticket de supermercado a datos estructurados.
Funcionas con cualquier cadena: Mercadona, Carrefour, Dia, Lidl, Aldi, Alcampo,
Eroski, Consum, o la tienda del barrio. No supongas un formato concreto: lee el
que tengas delante.

FORMATO DE ENTRADA
Recibes una o varias imagenes. Cuando son varias son BANDAS HORIZONTALES CONSECUTIVAS
del mismo ticket, de arriba abajo, y se solapan entre si a proposito. Las lineas que
aparezcan en dos bandas son la misma linea: cuentala UNA sola vez. Reconstruye el
ticket entero antes de escribir nada.

COMO LEER LAS LINEAS
Los formatos varian mucho. Lo habitual es cantidad, descripcion y a la derecha uno o
dos numeros: el precio unitario y el importe de la linea. Cuando solo hay un numero,
ese es el importe y precio_unit va a null. Cuando la cantidad es 1 muchas cadenas
dejan el precio unitario vacio.
Los articulos a peso suelen llevar una linea adicional con los kilos y el precio por
kilo; usala para peso_kg.
Ojo con lo que NO es una linea de producto: descuentos, promociones, puntos de
fidelizacion, bolsas y redondeos aparecen mezclados. Un descuento va como linea con
importe negativo, no se omite, porque si no las cuentas no cuadran.
Las descripciones llevan acentos, la enye y simbolos como % o + dentro del nombre.
Transcribelas literalmente en 'descripcion'; el nombre limpio y estable va en
'producto'. Ese nombre es la clave con la que se compara el mismo articulo entre
meses Y ENTRE CADENAS, asi que escribelo generico: "leche semidesnatada" y no
"LECHE SEMI HACENDADO 1L".

IVA
En Espana: 4% alimentos basicos (pan, leche, queso, huevos, fruta, verdura, legumbre,
tuberculo, cereal), 10% el resto de alimentos y bebidas sin alcohol, 21% alcohol y
todo lo que no es comida. Asigna a cada articulo el tipo que le corresponde por ley.

ARITMETICA, LO MAS IMPORTANTE
Antes de responder comprueba tu propio trabajo:
1. La suma de los importes de todas las lineas tiene que dar exactamente el TOTAL
   impreso. Los descuentos restan.
2. Si el ticket trae desglose de IVA por tramos, para cada tipo la suma de los
   importes de las lineas que le has asignado tiene que dar base + cuota de ese tramo.
   Si el ticket NO lo trae, deja desglose_iva como lista vacia. No lo inventes ni lo
   calcules tu: solo se transcribe si esta impreso.
Si alguna comprobacion no cuadra, vuelve a mirar las imagenes: te has saltado una
linea, has leido mal un digito, has olvidado un descuento, o has clasificado mal un
articulo. Corrigelo y repite. No entregues numeros que no cuadren y no inventes una
linea para forzar el cuadre.

Devuelve solo los datos que se leen en el ticket.`;

export const PETICION_BASE = {
  model: "claude-opus-5",
  max_tokens: 16000,
  system: SISTEMA,
  thinking: { type: "adaptive" },
  output_config: { format: { type: "json_schema", schema: ESQUEMA } },
};
