// ============================================================
// Respuestas automáticas del bot (intents básicos en español).
// Todo el texto visible al cliente está en español y usa los datos
// reales del negocio definidos en config.js (NEGOCIO).
// Negocio: JMP Concrete and Dispatch LLC — venta de concreto
// por yarda cúbica en Dallas–Fort Worth.
//
// FLUJO DE COTIZACIÓN/PEDIDO (proceso real del dueño):
// cuando un cliente quiere cotizar u ordenar, el bot junta los datos
// EN ORDEN — 1) cuántas yardas, 2) qué mix, 3) la dirección,
// 4) día y hora de la entrega — con estado por conversación
// (conv.flow en db.js). En el paso del mix se pregunta también si
// el concreto va «con aire o no aire»; enseguida se pregunta si va
// a ocupar alguna pompa: si dice que SÍ, se le dan las opciones
// (boom pump o small line pump; la trailer es la misma small
// line) y el paso no se completa hasta que elija; si dice que NO,
// queda «sin pompa» y la orden sigue con la dirección (regla del
// dueño, 2026-10-30). Y AL FINAL, ya
// con la orden completa y ANTES del cierre, el bot pide UNO POR
// VEZ: 5) el nombre de la persona, 6) el nombre de su compañía
// (si no tiene compañía, queda «Particular») y 7) la forma de pago
// (Zelle, tarjeta de débito, tarjeta de crédito o efectivo). Los datos que
// el cliente ya dio no se vuelven a pedir, y las respuestas cortas
// a mitad del flujo se interpretan como el dato que se está
// pidiendo (jamás se responde el menú genérico a mitad del flujo).
// En el cierre se aclara UNA sola vez que el pago es POR
// ADELANTADO (regla del dueño): en cuanto se confirme el pago se
// carga la orden; el bot todavía NO pide ni envía datos de cobro.
// EFECTIVO: es un método más, SIN regla especial — el dueño
// mandó OLVIDAR la regla de «efectivo antes de cargar» el
// 2026-10-31 («Quiero que olvides la regla de cash o efectivo
// antes de cargar»): no se le pide pagarlo por adelantado ni
// encontrarse con un encargado; se registra solo «Efectivo».
// Al completar todos los datos, el bot:
//   a) le responde al cliente un cierre corto con el resumen, y
//   b) deja ARMADA en la conversación (la guarda el webhook como
//      mensaje del BOT) la confirmación con el formato exacto del
//      dueño, lista para enviársela al cliente; Jesus completa a
//      mano el número de orden. La planta NO se incluye (regla
//      del dueño: el cliente directo no debe saber de dónde carga
//      el concreto); solo aparecería si Jesus la agrega a mano.
// El slump se captura SOLO si el cliente lo menciona (no es una
// quinta pregunta obligatoria).
// PRECIO (regla del dueño): el bot NUNCA da ni inventa precios —
// el precio sale de la cotización de la planta. Si el cliente
// pregunta el precio («¿cuánto?», «cuánto cuesta», «precio»,
// «how much»…) en cualquier momento — antes del flujo, a mitad o
// al final — se le responde en corto que el precio depende de la
// planta y del mix y que con los datos de su orden se lo confirman
// enseguida, y el flujo CONTINÚA donde iba (si no había empezado,
// arranca pidiendo las yardas).
// ============================================================
const { NEGOCIO, avisoApertura } = require('../config');
const db = require('../db');
const { cfg } = require('../config');

// ---- Normalización: minúsculas y sin acentos para comparar ----
function normalizar(texto) {
  return (texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

// ---- Definición de intents por palabras clave ----
const INTENTS = [
  {
    id: 'humano',
    label: '🙋 Hablar con un especialista',
    topic: 'hablar con un especialista',
    keywords: [
      'hablar con alguien', 'quiero hablar', 'una persona', 'humano',
      'agente', 'asesor', 'operador', 'alguien que me atienda',
      'me atienda alguien', 'persona real', 'especialista',
      'hablar con una persona', 'necesito ayuda', 'i need help',
      'help me', 'speak to someone', 'talk to a person',
      'real person', 'representative',
      // OJO: «jesus» y «morillo» NO van aquí a propósito — son el
      // nombre del dueño y de posibles clientes; si el cliente se
      // llama Jesús, su nombre jamás debe disparar el pase a humano
      // (falla real del 2026-10-19: la orden moría en el último paso).
    ],
  },
  {
    id: 'faq_pagos',
    label: '💳 ¿Aceptan tarjeta? (formas de pago)',
    topic: 'las formas de pago',
    keywords: [
      'aceptan tarjeta', 'acepta tarjeta', 'aceptan zelle',
      'formas de pago', 'forma de pago', 'puedo pagar con',
      'do you accept', 'how can i pay',
      // Efectivo/cash: entran por esta FAQ de formas de pago
      // (el efectivo ya no lleva regla especial, 2026-10-31).
      'efectivo', 'cash',
    ],
  },
  {
    id: 'faq_minimo',
    label: '📏 ¿Cuál es el mínimo de yardas?',
    topic: 'el mínimo de yardas',
    keywords: ['minimo', 'mínimo', 'minimum'],
  },
  {
    id: 'faq_bomba',
    label: '🚧 ¿Tienen bomba?',
    topic: 'la bomba de concreto',
    keywords: ['tienen bomba', 'bomba', 'pump'],
  },
  {
    id: 'cotizacion',
    label: '💲 Cotización',
    topic: 'una cotización',
    keywords: [
      'precio', 'costo', 'cuanto cuesta', 'cuánto cuesta',
      'tarifa', 'cobran', 'vale', 'presupuesto', 'cotizacion',
      'cotización', 'cotizar', 'presio', 'cuanto sale', 'cuanto vale',
      'price', 'cost', 'how much',
    ],
  },
  {
    id: 'pedido',
    label: '🧾 Hacer un pedido',
    topic: 'hacer un pedido',
    keywords: [
      'pedido', 'pedir', 'ordenar', 'quiero concreto', 'quiero yardas',
      'necesito concreto', 'necesito yardas', 'agendar entrega',
      // La gente también pide «cemento» (y mal escrito «semento», o
      // «hormigón»): es lo mismo que concreto y debe abrir el pedido.
      'quiero cemento', 'necesito cemento', 'ocupo cemento',
      'quiero semento', 'necesito semento', 'ocupo semento',
      'quiero hormigon', 'necesito hormigon', 'ocupo hormigon',
      'programar', 'apartar', 'quiero comprar', 'me manda', 'envieme',
      'i need concrete', 'i want concrete', 'need concrete',
      'we need concrete', 'order concrete',
    ],
  },
  {
    id: 'entrega',
    label: '🚚 Estatus de entrega',
    topic: 'el estatus de una entrega',
    keywords: [
      'entrega', 'camion', 'camión', 'truck', 'mixer', 'cuando llega',
      'cuándo llega', 'cuanto llega', 'cuánto llega', 'a que hora llega',
      'cuando viene', 'ya viene', 'donde viene', 'estatus', 'status',
      'retraso', 'atrasado', 'llego', 'llegó', 'en camino',
    ],
  },
  {
    id: 'pago',
    label: '💳 Pagos',
    topic: 'un pago',
    keywords: [
      'pago', 'pagar', 'zelle', 'factura', 'invoice', 'cuenta',
      'debo', 'saldo', 'metodo de pago', 'cómo pago', 'como pago',
    ],
  },
  {
    id: 'horario',
    label: '🕐 Horario',
    topic: 'los horarios',
    keywords: [
      'horario', 'hora abren', 'hora cierran', 'abren', 'cierran',
      'abierto', 'cerrado', 'a que hora', 'qué días', 'que dias',
      'fines de semana', 'domingo',
    ],
  },
  {
    id: 'zona',
    label: '📍 Zona de cobertura',
    topic: 'la zona de entrega',
    keywords: [
      'donde', 'dónde', 'direccion', 'dirección', 'ubicacion',
      'ubicación', 'zona', 'area', 'área', 'cubren', 'llegan',
      'dallas', 'fort worth', 'entregan',
    ],
  },
  {
    id: 'gracias',
    label: '🙏 Cuando dan las gracias',
    topic: 'un agradecimiento',
    keywords: ['gracias', 'thank you', 'mil gracias', 'te agradezco'],
  },
  {
    id: 'adios',
    label: '👋 Despedida',
    topic: 'una despedida',
    keywords: ['adios', 'adiós', 'bye', 'nos vemos', 'hasta luego', 'chao'],
  },
  {
    id: 'saludo',
    label: '👋 Saludo inicial',
    topic: 'su saludo',
    // Saludos en TRES registros (orden del dueño, 2026-10-27,
    // caso real Cheko Alvarado: escribió «Dimelo» y el bot no lo
    // reconoció): FORMALES, INFORMALES y COLOQUIALES. El saludo
    // es el ÚLTIMO intent de la lista a propósito: cualquier
    // saludo que venga con un pedido, un precio o una pregunta
    // concreta lo gana el intent fuerte, y el saludo solo se
    // queda con los mensajes que son saludo y nada más.
    // OJO con las palabras cortas peligrosas como substring
    // («epa» está en «separado», «alo» en «valor», «dime» en
    // «dime el precio»): esas NO van aquí; se reconocen solo
    // como mensaje completo o al inicio, vía FRASES_SALUDO /
    // esSaludoPuro / empiezaConSaludo.
    keywords: [
      // Formales
      'buenos dias', 'buenas tardes', 'buenas noches', 'buen dia',
      'buen día', 'muy buenas', 'saludos cordiales', 'buenas dias',
      // Informales
      'hola', 'buenas', 'hey', 'saludos', 'que tal', 'qué tal',
      'hola buenas', 'hello', 'hi', 'good morning', 'good afternoon',
      'good evening', 'hey there', 'howdy',
      // Coloquiales
      'dimelo', 'que onda', 'que mas', 'que hubo', 'quiubo',
      'que hay', 'que paso', 'que tranza', 'wenas', 'buenas buenas',
    ],
  },
];

/** Palabras clave efectivas: las editadas en el panel mandan sobre las de fábrica. */
function keywordsEfectivas(intent) {
  const ov = db.getReplyOverrides()[intent.id];
  return (ov && Array.isArray(ov.keywords) && ov.keywords.length) ? ov.keywords : intent.keywords;
}

/** Detecta el intent de un mensaje del cliente. */
function detectarIntent(texto) {
  const t = ` ${normalizar(texto)} `;
  // Prioridad de llegada sobre precio: «¿en cuánto llega mi cemento?»
  // o «¿cuándo llega mi camión?» son ESTATUS DE ENTREGA, no precio,
  // aunque lleven «cuánto». Solo si hay palabras de precio claras
  // (cuesta, sale, vale, precio, costo…) manda el precio.
  const tn = normalizar(texto);
  const esLlegada =
    /\b(cuanto|cuando|a que hora)\b[^.?!]*\b(llega|llegan|viene|vienen)\b/.test(tn) ||
    /\ben camino\b/.test(tn);
  const precioClaro =
    /\b(precio|precios|price|costo|cost|tarifa|cuesta|cuestan|sale|salen|vale|valen)\b/.test(tn);
  if (esLlegada && !precioClaro) {
    const entrega = INTENTS.find((i) => i.id === 'entrega');
    if (entrega) return entrega;
  }
  for (const intent of INTENTS) {
    if (keywordsEfectivas(intent).some((k) => t.includes(normalizar(k)))) {
      return intent;
    }
  }
  return { id: 'otro', topic: 'su mensaje', keywords: [] };
}

/**
 * Idioma del mensaje: 'en' si es claramente inglés, 'es' en otro
 * caso. Muchos contratistas de DFW escriben en inglés: el bot debe
 * saludar, correr el flujo y cerrar en su idioma.
 */
function detectarIdioma(texto) {
  const t = ` ${normalizar(texto)} `;
  const enWords = [
    ' i ', ' you ', ' the ', ' and ', ' for ', ' to ', ' my ', ' me ',
    ' need ', ' want ', ' please ', ' thanks ', ' thank ', ' how ',
    ' much ', ' many ', ' yards ', ' yard ', ' concrete ', ' with ',
    ' without ', ' tomorrow ', ' today ', ' name ', ' is ', ' are ',
    ' do ', ' does ', ' can ', ' delivery ', ' address ', ' company ',
    ' debit ', ' credit ', ' card ', ' when ', ' where ', ' what ',
    ' monday ', ' tuesday ', ' wednesday ', ' thursday ', ' friday ',
    ' saturday ', ' sunday ', ' air ',
  ];
  const esWords = [
    ' quiero ', ' necesito ', ' gracias ', ' yardas ', ' concreto ',
    ' cemento ', ' manana ', ' direccion ', ' compania ', ' para ',
    ' el ', ' la ', ' los ', ' las ', ' una ', ' por ', ' con ',
    ' sin ', ' aire ', ' dia ', ' hora ', ' nombre ', ' pago ',
    ' pagar ', ' cuanto ', ' cuesta ', ' llega ', ' obra ',
  ];
  let en = 0;
  let es = 0;
  for (const w of enWords) if (t.includes(w)) en += 1;
  for (const w of esWords) if (t.includes(w)) es += 1;
  if (/\b(hello|good morning|good afternoon|good evening)\b/.test(t)) en += 2;
  return en >= 2 && en > es ? 'en' : 'es';
}

/**
 * Texto efectivo de una respuesta: si el dueño editó el texto en el panel,
 * se usa ese (con variables {nombre}, {negocio}, {zona}, {telefono}, {horario});
 * si no, el texto de fábrica de construirRespuesta().
 */
function textoEfectivo(intentId, nombre, idioma = 'es') {
  const ov = db.getReplyOverrides()[intentId];
  if (ov && typeof ov.text === 'string' && ov.text.trim()) {
    return ov.text
      .replaceAll('{nombre}', nombre || '')
      .replaceAll('{negocio}', NEGOCIO.nombre)
      .replaceAll('{zona}', NEGOCIO.zona)
      .replaceAll('{telefono}', NEGOCIO.whatsapp)
      .replaceAll('{horario}', NEGOCIO.horarioTexto)
      .replace(/  +/g, ' ')
      .trim();
  }
  return construirRespuesta(intentId, nombre, idioma);
}

/** Lista completa para el editor del panel: textos y palabras clave, de fábrica y efectivos. */
function listarRespuestas() {
  const overrides = db.getReplyOverrides();
  const items = INTENTS.map((intent) => {
    const ov = overrides[intent.id] || {};
    return {
      id: intent.id,
      label: intent.label || intent.id,
      topic: intent.topic,
      keywords: keywordsEfectivas(intent),
      keywordsDefault: intent.keywords,
      text: textoEfectivo(intent.id, ''),
      defaultText: construirRespuesta(intent.id, ''),
      edited: Boolean(ov.text || ov.keywords),
    };
  });
  const ovOtro = overrides['otro'] || {};
  items.push({
    id: 'otro',
    label: '💬 Cuando no entiende el mensaje',
    topic: 'su mensaje',
    keywords: [],
    keywordsDefault: [],
    text: textoEfectivo('otro', ''),
    defaultText: construirRespuesta('otro', ''),
    edited: Boolean(ovOtro.text),
  });
  return items;
}

function esIntentValido(id) {
  return id === 'otro' || INTENTS.some((i) => i.id === id);
}

/** Datos que se piden para cotizar o pedir concreto. */
function datosNecesarios() {
  return (
    `Para ayudarle necesito estos datos:\n` +
    `1️⃣ ¿Cuántas yardas necesita?\n` +
    `2️⃣ ¿Qué resistencia (PSI) o tipo de mezcla?\n` +
    `3️⃣ Dirección de la obra\n` +
    `4️⃣ ¿Para qué fecha lo necesita?`
  );
}

function datosNecesariosEN() {
  return (
    `To help you I need these details:\n` +
    `1️⃣ How many yards do you need?\n` +
    `2️⃣ What strength (PSI) or mix type?\n` +
    `3️⃣ Job site address\n` +
    `4️⃣ What date do you need it?`
  );
}

const ZONA_EN = 'Dallas–Fort Worth, TX and surrounding areas';

// ============================================================
// EFECTIVO SIN REGLA DE ADELANTO: el dueño mandó OLVIDAR la
// regla de «cash o efectivo antes de cargar» el 2026-10-31
// 19:49 («Quiero que olvides la regla de cash o efectivo
// antes de cargar»). El efectivo se registra solo como
// «Efectivo», sin nota ni aviso especial. El valor largo
// viejo puede venir en órdenes guardadas de antes: se sigue
// reconociendo al leerlas (esPagoEfectivo), pero jamás se
// vuelve a escribir ni a decir su regla.
// ============================================================
const PAGO_EFECTIVO = 'Efectivo';
const PAGO_EFECTIVO_LEGADO = 'Efectivo (por adelantado, con un encargado)';

/** ¿El valor de pago dado es el efectivo (actual o legado)? */
function esPagoEfectivo(pago) {
  return pago === PAGO_EFECTIVO || pago === PAGO_EFECTIVO_LEGADO;
}

// ============================================================
// REGLAS DE PAGO POR MÉTODO (órdenes del dueño, 2026-10-31
// 18:04-18:06): «Si es tarjeta de crédito se le suman cargos
// por procesamientos» — Jesus fijó el recargo en 4% (tope que
// publican las compañías de tarjetas). «Si es cheque se
// colocan los taxes» — el concreto premezclado lleva tax en
// Texas: 6.25% estatal + 2% local = 8.25% en Dallas (fuente:
// Texas Comptroller). «Si es Zelle tiene que enviarlo antes de
// cargar el concrete» — al Zelle de la compañía, el correo
// Jmpconcreteanddispatchllc@gmail.com (el número de WhatsApp
// NO recibe Zelle, como dicen las facturas de JMP).
// ============================================================
const PAGO_CHEQUE = 'Cheque';
const RECARGO_CREDITO_PCT = 4;
const TAXES_TX = '8.25%';
const ZELLE_JMP = 'Jmpconcreteanddispatchllc@gmail.com';

/** Nota corta del método de pago para el cliente (o null). */
function notaMetodoPago(pago, idioma) {
  if (pago === 'Tarjeta de crédito') {
    return idioma === 'en'
      ? `Credit card payments have a ${RECARGO_CREDITO_PCT}% processing surcharge added.`
      : `A los pagos con tarjeta de crédito se les suma un cargo por procesamiento del ${RECARGO_CREDITO_PCT}%.`;
  }
  if (pago === PAGO_CHEQUE) {
    return idioma === 'en'
      ? `Check payments have taxes (${TAXES_TX}) added.`
      : `A los pagos con cheque se les suman los taxes (${TAXES_TX}).`;
  }
  if (pago === 'Zelle') {
    return idioma === 'en'
      ? `The Zelle payment must be sent *before* we load the concrete, to: ${ZELLE_JMP} (this WhatsApp number does not receive Zelle).`
      : `El pago por Zelle tiene que enviarlo *antes* de que carguemos el concreto, a: ${ZELLE_JMP} (este número de WhatsApp no recibe Zelle).`;
  }
  return null;
}

/** Construye la respuesta en español para cada intent. */
function construirRespuesta(intentId, nombre, idioma = 'es') {
  if (idioma === 'en') return construirRespuestaEN(intentId, nombre);
  const n = nombre && nombre !== '' ? ` ${nombre}` : '';
  const C = NEGOCIO;
  switch (intentId) {
    case 'saludo':
      return (
        `¡Hola${n}! 🏗️ Bienvenido(a) a *${C.nombre}*.\n` +
        `Vendemos concreto por yarda cúbica en ${C.zona}.\n` +
        `¿En qué le ayudamos? Puede pedir una *cotización*, hacer un *pedido*, ` +
        `preguntar por una *entrega* o un *pago*.`
      );
    case 'cotizacion':
      return (
        `Con gusto le cotizamos 🏗️.\n` +
        `El precio por yarda depende de la dirección del trabajo y la mezcla, ` +
        `así que le preparamos su cotización a la medida:\n\n` +
        `${datosNecesarios()}\n\n` +
        `Mándenos esos datos y le respondemos rapidito.`
      );
    case 'pedido':
      return (
        `¡Perfecto, le tomamos su pedido! 🏗️\n\n` +
        `${datosNecesarios()}\n\n` +
        `Con esos datos un especialista le confirma disponibilidad y precio ` +
        `por aquí mismo.`
      );
    case 'entrega':
      return (
        `Le revisamos el estatus de su entrega 🚚.\n` +
        `¿Me confirma su nombre y la dirección de la obra? ` +
        `Un especialista le responde enseguida con la información.`
      );
    case 'pago':
      return (
        `Con gusto le ayudamos con su pago 💳.\n` +
        `Escríbanos su nombre o número de factura y le pasamos los datos ` +
        `para pagar. También puede llamarnos al ${C.whatsapp}.`
      );
    case 'horario':
      return (
        `Trabajamos *${C.horarioTexto}* 🏗️\n` +
        `Las entregas se coordinan según disponibilidad de planta; ` +
        `escríbanos cuando guste.\n\n` +
        `${avisoApertura()}`
      );
    case 'zona':
      return (
        `Cubrimos *${C.zona}* 🏗️.\n` +
        `¿Dónde es su obra? Le confirmamos la entrega.`
      );
    case 'humano':
      return (
        `Con gusto 🙏. Un especialista le atenderá en breve por este mismo chat. ` +
        `Gracias por su paciencia.`
      );
    case 'faq_pagos':
      // Formas de pago reales del negocio (sin pedir datos de cobro):
      // las CUATRO opciones del dueño (2026-10-21) — Zelle, tarjeta
      // de débito, tarjeta de crédito y efectivo. El efectivo ya no
      // lleva regla especial (el dueño la mandó olvidar el 2026-10-31).
      return (
        `¡Claro! 🙏 Aceptamos *Zelle*, *tarjeta de débito*, *tarjeta de crédito* y *efectivo*.\n` +
        `El pago es por adelantado: en cuanto se confirme su pago, cargamos su orden.`
      );
    case 'faq_minimo':
      // El mínimo real depende de la dirección del trabajo: NO se inventa cifra.
      return (
        `El mínimo de yardas lo confirma el especialista, porque depende de la dirección ` +
        `del trabajo 🙏\n` +
        `Dígame cuántas yardas necesita y la dirección, y se lo confirmamos enseguida.`
      );
    case 'faq_bomba':
      // La bomba se coordina por obra: no se promete sin confirmar.
      return (
        `La bomba se coordina según su obra y la confirmamos con su orden 🙏\n` +
        `Cuéntenos los datos de su colado y un especialista le confirma la disponibilidad.`
      );
    case 'gracias':
      return (
        `¡Con mucho gusto${n}! 🏗️ Estamos para servirle.\n` +
        `Cuando necesite concreto, aquí estamos: ${C.whatsapp}.`
      );
    case 'adios':
      return (
        `¡Gracias por escribirnos${n}! 🏗️ Que tenga un excelente día. ` +
        `Aquí estamos cuando necesite concreto.`
      );
    default:
      // Fallback «no entendí» (fuera del flujo): español correcto, sin
      // la frase enredada anterior; ofrece repetir o pasar a un humano.
      return (
        `Disculpe, no le entendí bien 🙏\n` +
        `¿Me lo puede repetir, por favor? También puede pedirme una ` +
        `*cotización*, hacer un *pedido*, preguntar por una *entrega* ` +
        `o un *pago*.\n` +
        `Y si prefiere, escriba *especialista* y le atiende una persona enseguida.`
      );
  }
}

/** Construye la respuesta en inglés para cada intent. */
function construirRespuestaEN(intentId, nombre) {
  const n = nombre && nombre !== '' ? ` ${nombre}` : '';
  const C = NEGOCIO;
  switch (intentId) {
    case 'saludo':
      return (
        `Hello${n}! 🏗️ Welcome to *${C.nombre}*.\n` +
        `We sell concrete by the cubic yard in ${ZONA_EN}.\n` +
        `How can we help? You can ask for a *quote*, place an *order*, ` +
        `or ask about a *delivery* or a *payment*.`
      );
    case 'cotizacion':
      return (
        `Happy to help with your quote 🏗️.\n` +
        `Pricing per yard depends on the job address and the mix, ` +
        `so we prepare your quote to order:\n\n` +
        `${datosNecesariosEN()}\n\n` +
        `Send us those details and we'll get right back to you.`
      );
    case 'pedido':
      return (
        `Perfect, we'll take your order! 🏗️\n\n` +
        `${datosNecesariosEN()}\n\n` +
        `With those details a specialist confirms availability and price ` +
        `right here.`
      );
    case 'entrega':
      return (
        `We'll check the status of your delivery 🚚.\n` +
        `Could you confirm your name and the job site address? ` +
        `A specialist will reply right away with the information.`
      );
    case 'pago':
      return (
        `Of course, we can help with your payment 💳.\n` +
        `Send us your name or invoice number and we'll send you the ` +
        `payment details. You can also call us at ${C.whatsapp}.`
      );
    case 'horario':
      return (
        `We work *24/7, every day* 🏗️\n` +
        `Deliveries are coordinated based on plant availability — ` +
        `just message us anytime.`
      );
    case 'zona':
      return (
        `We cover *${ZONA_EN}* 🏗️.\n` +
        `Where is your job site? We'll confirm delivery.`
      );
    case 'humano':
      return (
        `Of course 🙏 A specialist will be with you shortly in this ` +
        `same chat. Thanks for your patience.`
      );
    case 'faq_pagos':
      return (
        `Yes 🙏 We accept *Zelle*, *debit card*, *credit card* and *cash*.\n` +
        `Payment is in advance: as soon as your payment is confirmed, ` +
        `we load your order.`
      );
    case 'faq_minimo':
      return (
        `The minimum yardage is confirmed by the specialist, since it ` +
        `depends on the job address 🙏\n` +
        `Tell me how many yards you need and the address, and we'll ` +
        `confirm right away.`
      );
    case 'faq_bomba':
      return (
        `A pump is coordinated based on your job, and we confirm it ` +
        `with your order 🙏\n` +
        `Tell us the details of your pour and a specialist will ` +
        `confirm availability.`
      );
    case 'gracias':
      return (
        `You're very welcome${n}! 🏗️ Happy to help.\n` +
        `Whenever you need concrete, we're here: ${C.whatsapp}.`
      );
    case 'adios':
      return (
        `Thanks for messaging us${n}! 🏗️ Have a great day. ` +
        `We're here whenever you need concrete.`
      );
    default:
      return (
        `Sorry, I didn't quite get that 🙏\n` +
        `Could you please repeat it? You can ask me for a *quote*, ` +
        `place an *order*, or ask about a *delivery* or a *payment*.\n` +
        `And if you prefer, type *specialist* and a person will help ` +
        `you right away.`
      );
  }
}

// ============================================================
// FLUJO DE COTIZACIÓN / PEDIDO — recolección de los 4 datos
// ============================================================

/**
 * Orden exacto en que el dueño pide los datos. Al final van, UNO
 * POR VEZ: el nombre, la compañía y la forma de pago.
 */
const PASOS_FLUJO = ['yardas', 'mix', 'direccion', 'fecha', 'hora', 'nombre', 'compania', 'pago'];

function datosVacios() {
  return {
    yardas: null, // { cantidad: '10', plus: false }
    mix: null,
    mixesCotizacion: null, // ['3000 psi', '3500 psi'] cuando el cliente pide precio de 2+ mixes: son 2+ COTIZACIONES con todo lo demás igual y solo cambia el mix (regla del dueño, 2026-10-31 19:03); mientras exista el par, el paso del mix cuenta como dado y NO se obliga al cliente a elegir uno
    aire: null, // 'con aire' | 'no aire' — se pide junto con el mix
    pompa: null, // null = aún no se preguntó · 'pendiente' = dijo que sí ocupa y falta que elija · 'Sin pompa' = dijo que no · 'Boom pump' | 'Small line / Trailer pump' (small line y trailer son la misma) — se pregunta tras el aire (regla del dueño, 2026-10-30)
    direccion: null,
    fecha: null, // texto tal como lo dio el cliente («mañana», «10/20/26»…)
    hora: null, // texto tal como lo dio el cliente («7 am», «10:00 pm»…)
    slump: null,
    inspeccion: false,
    nota: null, // nota libre del cliente para la orden (ej. el reparto de una tirada grande en varios días): viaja en la orden para el dueño («Nota:»), no es un paso del flujo
    nombre: null, // nombre de la persona — se pide AL FINAL, con la orden completa
    compania: null, // nombre de su compañía, o «Particular» si no tiene
    pago: null, // forma de pago: «Zelle» | «Tarjeta de débito» | «Tarjeta de crédito» | «Tarjeta» | «Efectivo» | «Cheque»
  };
}

/** Primer dato que falta según el orden del flujo (null si está completo). */
function pasoActual(flow) {
  return (
    PASOS_FLUJO.find((p) => {
      // El paso del mix exige mix, aire («aire o no aire») Y la
      // respuesta de la pompa: tras el aire se pregunta si va a
      // ocupar alguna pompa; si dice que no, queda «Sin pompa»
      // y la orden sigue; si dice que sí, debe elegir el tipo
      // (boom o small line/trailer, que son la misma) — regla
      // del dueño, 2026-10-30.
      if (p === 'mix') return !(flow.datos.mix || flow.datos.mixesCotizacion) || !flow.datos.aire || !flow.datos.pompa || flow.datos.pompa === 'pendiente';
      return !flow.datos[p];
    }) || null
  );
}

/**
 * Captura la dirección dentro de un mensaje más largo: busca el número
 * de la calle seguido (en pocas palabras) por el tipo de vía y toma
 * hasta el ZIP, recortando la fecha/hora si venían en el mismo mensaje.
 * Devuelve null si no encuentra una dirección clara.
 */
function capturarDireccion(raw) {
  const m = raw.match(
    /(\d+\s+(?:(?:[A-Za-zÁÉÍÓÚÑáéíóúñ.'-]+|\d+(?:st|nd|rd|th))\s+){0,4}?(?:st|street|ave|avenue|dr|drive|blvd|ln|lane|rd|road|hwy|fwy|ct|court|way|trl|trail)\b[^,;]*)/i
  );
  if (!m) return null;
  let dir = m[1];
  dir = dir.replace(/\s+(pasado\s+mañana|mañana|hoy|lunes|martes|miércoles|jueves|viernes|sábado|domingo)\b[\s\S]*$/i, '');
  dir = dir.replace(/\s+a las\s+\d[\s\S]*$/i, '');
  dir = dir.replace(/\s+\d{1,2}(?::\d{2})?\s*(?:a\.?\s?m\.?|p\.?\s?m\.?)[\s\S]*$/i, '');
  return dir.trim().replace(/[. ]+$/, '');
}

/** ¿Parece una dirección de obra? (número + tipo de vía, o ZIP con número). */
function pareceDireccion(raw) {
  return (
    /\d+\s+\S+.*\b(st|street|ave|avenue|dr|drive|blvd|ln|lane|rd|road|hwy|fwy|ct|court|way|trl|trail)\b/i.test(raw) ||
    (/\b\d{5}\b/.test(raw) && /\d+\s+[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(raw))
  );
}

/**
 * ¿El mensaje ES una dirección suelta, aunque la calle no traiga
 * sufijo reconocido ni ZIP ni etiqueta? («4215 N Beltwood Dallas
 * Tx»: número de casa + solo palabras de calle/ciudad/estado y un
 * ZIP opcional al final, sin NINGÚN otro dato del flujo).
 * Falla real del 2026-10-31 16:21 (captura de Jesus, minutos
 * después del despliegue 2f18d5cd): con el flujo en la pregunta
 * del aire — que vive dentro del paso 'mix' — el número de casa
 * 4215 caía en la red del PSI inválido (\b\d{4}\b del paso del
 * mix) porque pareceDireccion no reconoce «Beltwood», y el bot
 * soltaba «Ese mix no está disponible» ante una dirección; la
 * dirección además se perdía (no se capturaba). REGLA: un número
 * que forma parte de una dirección NUNCA se evalúa como mix.
 * Conservadora a propósito: mensaje de UNA línea que empieza con
 * el número de casa y sigue SOLO con palabras (u ordinales tipo
 * «42nd»); cualquier palabra de dato del flujo (yardas, psi,
 * slump, aire, pompa, precio, días…) la descalifica, y un número
 * pelado sin palabras («4215» solo) NO es dirección: en el paso
 * del mix sigue tratándose como intento de mix, como hoy.
 */
function pareceDireccionSuelta(raw) {
  if (/\n/.test(raw)) return false; // multilínea: la cubre la línea etiquetada «Dirección»
  const t = raw.trim().replace(/[. ]+$/, '');
  const m = t.match(/^(\d{1,5})\s+(.+)$/);
  if (!m) return false;
  const resto = m[2].trim().replace(/\s+\d{5}(-\d{4})?$/, ''); // ZIP final opcional
  const tokens = resto.split(/\s+/);
  if (tokens.length < 1 || tokens.length > 6) return false;
  const NO_CALLE = new Set([
    'de', 'del', 'y', 'con', 'sin', 'para', 'por', 'el', 'la', 'los', 'las', 'un', 'una',
    'yardas', 'yarda', 'yards', 'yard', 'yds', 'yd', 'psi', 'libras', 'libra', 'slump', 'aire', 'pompa',
    'bomba', 'pump', 'mix', 'mezcla', 'concreto', 'precio', 'dolares', 'dollars',
    'pesos', 'hoy', 'manana', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes',
    'sabado', 'domingo', 'am', 'pm', 'hora', 'horas', 'dia', 'dias', 'quiero',
    'ocupo', 'necesito', 'the', 'of', 'at', 'in', 'on', 'for', 'and', 'or',
  ]);
  return tokens.every(
    (tok) =>
      /^\d+(st|nd|rd|th)$/i.test(tok) ||
      (/^[A-Za-zÁÉÍÓÚÑáéíóúñ.'-]+$/.test(tok) && !NO_CALLE.has(normalizar(tok)))
  );
}

/**
 * Detecta si el cliente dijo que el concreto va con aire o sin aire.
 * Devuelve 'con aire', 'no aire' o null. Las formas negativas mandan
 * («sin aire», «no aire», «no lleva aire», «non air», «no air»…).
 */
function extraerAire(raw) {
  if (
    /\b(sin aire|no aire|no lleva aire|sin entrained air|non[-\s]?air|no air|without air)\b/i.test(raw)
  ) {
    return 'no aire';
  }
  if (/\b(con aire|lleva aire|air[-\s]?entrained|with air)\b/i.test(raw) || /\baire\b/i.test(raw) || /\bair\b/i.test(raw)) {
    return 'con aire';
  }
  return null;
}

/**
 * ¿El cliente va a ocupar alguna pompa? (regla del dueño,
 * 2026-10-30): tras el aire se pregunta primero si ocupa pompa.
 * Devuelve true («sí, ocupo pompa»), false («no») o null si el
 * mensaje no lo dice. Formas: sí / yes / afirmaciones claras con
 * «pompa/bomba/pump»; no / no ocupo / sin pompa / no ocupa /
 * ninguna / negaciones claras de pompa. OJO: «boom», «trailer»
 * o «small line» NO son un «sí» aquí — son el TIPO de pompa y
 * los captura extraerPompa; esta función es solo para el
 * sí/no desnudo de la pregunta directa.
 */
function extraerOcupaPompa(raw) {
  const t = ` ${normalizar(raw).replace(/[¿?¡!.,;:]/g, ' ').replace(/\s+/g, ' ')} `;
  if (
    /\bno\b[^.]*\b(ocupo|ocupa|ocupamos|necesito|necesita|quiero|requiero|requiere|lleva|usa|usamos)\b/.test(t) ||
    /\bno\b[^.]*\bpompa\b/.test(t) ||
    /\bsin pompa\b/.test(t) ||
    /\bninguna\b/.test(t) ||
    /\bno\b/.test(t) ||
    /\bnope\b/.test(t) ||
    /\bnone\b/.test(t)
  ) {
    return false;
  }
  if (
    /^\s*(si|yes|yeah|yep|claro|afirmativo|correcto|asi es)\b/.test(t) ||
    /\b(si|yes)\b[^.]*\b(ocupo|ocupa|ocupamos|necesito|necesita|quiero|requiero|lleva)\b/.test(t) ||
    /\bocupo\b[^.]*\b(pompa|bomba|pump)\b/.test(t) ||
    /\b(necesito|quiero|requiero|ocupo)\b[^.]*\b(pompa|bomba|pump)\b/.test(t)
  ) {
    return true;
  }
  return null;
}

/**
 * Tipo de pompa del trabajo (regla del dueño, 2026-10-30): se
 * pregunta tras confirmar que el cliente SÍ ocupa pompa. Antes
 * la pregunta era directa por el tipo; ahora primero va el
 * sí/no y solo si dice que sí se le dan las opciones. OJO
 * (aclaración del dueño, mismo día): la
 * small line pump y la trailer pump SON LA MISMA pompa — por
 * eso «trailer», «de arrastre», «small line» y «línea pequeña»
 * se anotan con una sola etiqueta. Se captura si el cliente lo
 * menciona en cualquier mensaje. «Pompa» a secas NO captura
 * nada (es ambiguo).
 */
function extraerPompa(raw) {
  const t = normalizar(raw);
  if (/\bboom\b/.test(t) || /\bpluma\b/.test(t)) return 'Boom pump';
  if (
    /\btrailer\b/.test(t) ||
    /\barrastre\b/.test(t) ||
    /small\s*line/.test(t) ||
    /linea\s+pequena/.test(t)
  ) {
    return 'Small line / Trailer pump';
  }
  return null;
}

/** Quita las frases de aire de un texto (para que no queden dentro del mix). */
function quitarFrasesAire(texto) {
  return (texto || '')
    .replace(/\b(sin aire|no aire|no lleva aire|con aire|lleva aire|non[-\s]?air|no air|without air|with air|air[-\s]?entrained)\b/gi, ' ')
    .replace(/\baire\b/gi, ' ')
    .replace(/\bair\b/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,;./-]+|[\s,;./-]+$/g, '')
    .trim();
}

/**
 * Texto «limpio» para interpretar el sí/no de la POMPA: se quitan
 * las frases de OTROS temas que traen su propia negación (el aire
 * y la inspección), porque cada «no» vale SOLO para la pregunta a
 * la que responde (falla real del 2026-10-31 16:35: el cliente
 * respondió «No aire» y el bot anotó TAMBIÉN «sin pompa» — el
 * «No» era del aire y se filtró al patrón pelado de
 * extraerOcupaPompa; la pompa jamás se había preguntado).
 */
function quitarNegacionesDeOtrosTemas(texto) {
  return quitarFrasesAire(texto)
    .replace(/\b(no|sin|without)\s+(inspecci[oó]n|inspection)\b/gi, ' ')
    .replace(/\b(inspecci[oó]n|inspection)\b/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * ¿El mensaje ES la respuesta a la pregunta de la pompa (sí/no),
 * en español o en inglés, llegue en el paso que llegue? Solo
 * cuenta si el mensaje NOMBRA la pompa (pompa/bomba/pump/boom)
 * junto a su negación o su afirmación: «no pump», «no pompa»,
 * «sin pompa», «no boom», «no ocupo pompa», «yes pump»…
 * Devuelve false (no ocupa), true (sí ocupa) o null (el mensaje
 * no es esa respuesta). Un «no» PELADO sin nombrar la pompa NO
 * es respuesta de la pompa fuera de su paso: ese «no» puede ser
 * de cualquier otra pregunta (falla real del 2026-10-31 16:35:
 * «No pump» en el paso del día se guardó como si fuera la FECHA).
 */
function detectarRespuestaPompa(raw) {
  const t = ` ${normalizar(raw).replace(/[¿?¡!.,;:]/g, ' ').replace(/\s+/g, ' ')} `;
  if (!/\b(pompa|bomba|pump|boom)\b/.test(t)) return null;
  if (
    /\b(no|sin|nunca|never)\b[^.]*\b(pompa|bomba|pump|boom)\b/.test(t) ||
    /\b(pompa|bomba|pump)\b[^.]*\bno\b/.test(t)
  ) {
    return false;
  }
  if (
    /\b(si|yes|yeah|yep|claro)\b[^.]*\b(pompa|bomba|pump|boom)\b/.test(t) ||
    /\b(ocupo|ocupa|ocupamos|necesito|necesita|quiero|requiero)\b[^.]*\b(pompa|bomba|pump|boom)\b/.test(t)
  ) {
    return true;
  }
  return null;
}

/**
 * ¿El texto PARECE una fecha? (día de semana, hoy/mañana/pasado
 * mañana, fecha numérica M/D, «D de mes», día del mes suelto o
 * referencias tipo «la próxima semana»). Es la validación del
 * paso de la fecha: el respaldo de texto libre SOLO puede
 * guardar como día algo que parece un día — jamás la respuesta
 * de otro dato (falla real del 2026-10-31 16:35: «No pump»
 * quedó anotado como el día de la obra).
 */
function pareceFechaTexto(raw) {
  const t = ` ${normalizar(raw)} `;
  return (
    /\b(hoy|pasado manana|manana|today|tomorrow)\b/.test(t) ||
    /\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(t) ||
    /\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/.test(t) ||
    /\b\d{1,2}\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/.test(t) ||
    /\b\d{1,2}\b/.test(t) ||
    /\b(semana|quincena|fin de mes|proxima|proximo|siguiente|week|month)\b/.test(t)
  );
}

/** Limpia un nombre/compañía capturado (espacios y punto final). */
function limpiarNombre(s) {
  return (s || '').replace(/\s{2,}/g, ' ').replace(/[. ]+$/, '').trim();
}

/**
 * ¿El cliente está diciendo que NO tiene compañía (que es
 * particular)? Detector robusto para el paso de la compañía
 * (falla real del 2026-10-31: el cliente respondió «no tengo»
 * varias veces y el bot repetía la pregunta, porque el patrón
 * viejo exigía «no tengo compañía» completo). Acepta TODAS las
 * palabras y frases con ese significado, en español e inglés,
 * con la comparación normalizada (minúsculas, sin acentos, sin
 * puntuación pegada).
 *
 * OJO con los falsos positivos: si el mensaje PRESENTA una
 * compañía con nombre («mi compañía es ABC Construction», «la
 * empresa se llama XYZ», «company is ABC») manda eso — no es
 * «sin compañía» aunque traiga un «no» suelto. Y si el texto
 * suena a nombre de compañía (trae las palabras típicas:
 * construction, concrete, LLC, services…), es un nombre.
 */
function esSinCompania(raw) {
  const t = normalizar(raw)
    .replace(/[^a-z0-9']+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return false;
  // Presenta una compañía con nombre: «…es X» / «se llama X».
  if (
    /\b(compania|empresa|negocio|company|business)\s+(es|se llama|is)\s+[a-z0-9]/.test(t)
  ) {
    return false;
  }
  // Suena a nombre de compañía (nombre propio con giro).
  if (
    /\b(concrete|construction|construccion|constructora|llc|inc|corp|services|servicios|contractors?|builders?|remodeling|roofing|landscaping|trucking|grupo|group)\b/.test(
      t
    )
  ) {
    return false;
  }
  // Respuestas completas exactas.
  if (
    ['no', 'nope', 'nada', 'na', 'n a', 'none', 'no tengo', 'no company'].includes(t)
  ) {
    return true;
  }
  return (
    // --- Español ---
    /\bno tengo\b/.test(t) || // «no tengo», «no tengo ninguna compañía»…
    /\bno cuento con\b/.test(t) ||
    /\bno (es|soy) (empresa|compania|negocio|contratista)\b/.test(t) ||
    /\bno aplica\b/.test(t) ||
    /\bsin (compania|empresa|negocio)\b/.test(t) ||
    /\bningun[oa]\b/.test(t) ||
    /\bparticular\b/.test(t) ||
    /\bpersonal\b/.test(t) ||
    /\bindependiente\b/.test(t) ||
    /\bpor mi cuenta\b/.test(t) || // «trabajo por mi cuenta»
    /\bcuenta propia\b/.test(t) ||
    /\bpara mi\b/.test(t) || // «es para mí», «es para mi casa»
    /\bmi casa\b/.test(t) ||
    /\bsolo yo\b/.test(t) ||
    /\bsoy yo mismo\b/.test(t) ||
    // --- Inglés ---
    /\bno (company|business)\b/.test(t) ||
    /\b(don'?t|do not) have\b/.test(t) || // «i don't have one/a company»
    /\bself employed\b/.test(t) || // «self employed» y «self-employed»
    /\bhomeowner\b/.test(t) ||
    /\bjust me\b/.test(t) ||
    /\bnot a (company|business|contractor)\b/.test(t)
  );
}

/**
 * Interpreta la respuesta a los pasos FINALES de datos del cliente.
 * El bot pregunta el nombre y la compañía UNO POR VEZ (primero
 * «¿A nombre de quién queda la orden?» y después «¿Y cuál es el
 * nombre de su compañía?»), pero esta interpretación acepta que el
 * cliente dé los dos juntos en un mismo mensaje: acepta marcadores
 * («a nombre de X, compañía Y», «nombre: X, empresa: Y»), el
 * formato simple «Nombre, Compañía» y respuestas de un solo dato.
 * Si el cliente dice que no tiene compañía o es particular, la
 * compañía queda «Particular» (no se insiste).
 */
function extraerNombreCompania(raw) {
  const out = {};
  const t = (raw || '').trim();
  if (!t) return out;
  const esParticular = esSinCompania(t);
  const mNombre = t.match(/(?:a nombre de|mi nombre es|my name is|soy|nombre)\s*[:\-]?\s*([^,;]+)/i);
  const mComp = t.match(/(?:compa[ñn][ií]a|empresa|negocio|company)\s*(?:es|se llama)?\s*[:\-]?\s*(.+)$/i);
  if (mComp && !esParticular) out.compania = limpiarNombre(mComp[1]);
  if (mNombre) {
    const candidato = limpiarNombre(
      mNombre[1].replace(/(?:compa[ñn][ií]a|empresa|negocio|company).*$/i, '')
    );
    // «soy particular» / «soy independiente» NO son un nombre:
    // son la respuesta de «sin compañía».
    if (candidato && !esSinCompania(candidato)) out.nombre = candidato;
  }
  if (!out.nombre && !out.compania) {
    const partes = t.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    if (partes.length >= 2) {
      const primera = limpiarNombre(partes[0].replace(/^a nombre de\s*/i, ''));
      if (primera && !esSinCompania(primera)) out.nombre = primera;
      if (!esParticular) {
        out.compania = limpiarNombre(
          partes.slice(1).join(', ').replace(/^(?:compa[ñn][ií]a|empresa|negocio)\s*(?:es|se llama)?\s*[:\-]?\s*/i, '')
        );
      }
    } else if (!esParticular) {
      // Un solo dato: si suena a empresa es la compañía; si no, el nombre.
      const limpio = limpiarNombre(t.replace(/^a nombre de\s*/i, ''));
      if (limpio) {
        if (/\b(concrete|construction|constru\w+|llc|inc\.?|corp|company|grupo|services|servicios)\b/i.test(limpio)) {
          out.compania = limpio;
        } else {
          out.nombre = limpio;
        }
      }
    }
  }
  if (esParticular) out.compania = 'Particular';
  if (out.nombre === '') delete out.nombre;
  if (out.compania === '') delete out.compania;
  return out;
}

/**
 * ¿El cliente quiere pagar en EFECTIVO? Incluye las variantes de
 * «pago en el sitio»: «cash», «en efectivo», «pago cuando
 * lleguen», «cash al entregar»… Se registra solo como
 * «Efectivo», sin regla especial (el dueño mandó olvidar la
 * regla de «efectivo antes de cargar» el 2026-10-31).
 */
function esPagoEfectivo(raw) {
  const t = normalizar(raw);
  return (
    /\b(cash|efectivo)\b/.test(t) ||
    /\b(al entregar|a la entrega|cuando lleguen|cuando entreguen|on delivery|upon delivery)\b/.test(t)
  );
}

/**
 * Interpreta la respuesta al paso de la FORMA DE PAGO (el último
 * del flujo): «¿Cómo va a pagar: efectivo, tarjeta de débito, tarjeta
 * de crédito o efectivo?» (las cuatro opciones del dueño,
 * 2026-10-21). Devuelve el valor normalizado — «Zelle», «Tarjeta
 * de débito» o «Tarjeta de crédito» —, o «Tarjeta» a secas si el
 * cliente dijo solo «tarjeta»/«card» sin aclarar (el flujo le
 * pregunta «¿Débito o crédito?» una sola vez), o «Efectivo» si
 * pidió pagar en efectivo, o null si no se entiende ninguna
 * forma de pago.
 */
function extraerPago(raw) {
  const t = normalizar(raw);
  // El efectivo manda sobre las demás palabras: quien dice
  // «efectivo» (o «cash», «pago cuando lleguen»…) quiere pagar
  // en efectivo, y se registra solo como «Efectivo».
  if (esPagoEfectivo(raw)) return PAGO_EFECTIVO;
  if (/\bzelle\b/.test(t)) return 'Zelle';
  // Cheque (orden del dueño, 2026-10-31): método aceptado; se
  // le suman los taxes. \bcheck\b no casa «checking» (cuenta de
  // cheques/débito), solo la palabra suelta.
  if (/\b(cheque|check)\b/.test(t)) return PAGO_CHEQUE;
  const debito = /\b(debito|debit)\b/.test(t);
  const credito = /\b(credito|credit)\b/.test(t);
  if (debito && !credito) return 'Tarjeta de débito';
  if (credito && !debito) return 'Tarjeta de crédito';
  if (/\b(tarjeta|card)\b/.test(t)) return 'Tarjeta';
  return null;
}

/**
 * ¿La respuesta es solo relleno («ok», «sí», «va», «mmm no sé»…)?
 * Eso NUNCA es un dato válido de fecha, hora, nombre, compañía ni
 * mix: antes el bot anotaba «ok» como fecha y el cliente quedaba
 * atrapado en un bucle.
 */
const PALABRAS_RELLENO = new Set([
  'ok', 'okay', 'si', 'va', 'bueno', 'bien', 'sale', 'orale', 'dale',
  'yes', 'yeah', 'yep', 'aja', 'mmm', 'hmm', 'no', 'se', 'eh', 'ah',
]);
function esRespuestaVaga(texto) {
  const t = normalizar(texto)
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return true;
  const tokens = t.split(' ');
  return tokens.length <= 3 && tokens.every((tok) => PALABRAS_RELLENO.has(tok));
}

/** ¿El texto parece un mix de concreto? (para no anotar «gracias» como mix). */
function pareceMix(texto) {
  if (/\d/.test(texto)) return true;
  return /\b(mix|mezcla|psi|libras|resistencia|high early|reforzado|fibra|fiber)\b/i.test(
    normalizar(texto)
  );
}

/**
 * PRODUCTOS que el cliente puede pedir EN VEZ de un mix con PSI
 * (vocabulario del dueño, 2026-10-21): pea gravel, flowable fill
 * y grout también son «ingredientes»/productos del concreto. Si
 * el cliente nombra uno, ESE producto es la mezcla elegida: se
 * guarda con su nombre canónico y el flujo sigue igual (el
 * producto ocupa el lugar del mix, también en la confirmación).
 * Devuelve 'Pea gravel' | 'Flowable fill' | 'Grout' | null.
 */
function detectarProducto(texto) {
  const t = normalizar(texto);
  if (/\bpea\s?gravel\b/.test(t) || /\bgrava\b/.test(t)) return 'Pea gravel';
  if (/\bflowable(\s+fill)?\b/.test(t) || /\bclsm\b/.test(t) || /\brelleno fluido\b/.test(t)) {
    return 'Flowable fill';
  }
  if (/\bgrout\b/.test(t) || /\blechada\b/.test(t)) return 'Grout';
  return null;
}

/**
 * POMPA MIX 50-50 (regla del dueño, 2026-10-30 20:12): el mix
 * para pompas de arrastre. Es un mix válido más, junto a los
 * seis por PSI. Se pide como «pompa mix 50-50», «50-50»,
 * «50/50», «5050» o «mix para pompa».
 */
function detectarPompaMix(texto) {
  const t = normalizar(texto);
  if (/\b5050\b/.test(t)) return true;
  if (/\b50\s*[-/]\s*50\b/.test(t)) return true;
  if (/\bpompa\s+mix\b/.test(t)) return true;
  if (/\bmix\s+(?:de\s+|para\s+)?pompa\b/.test(t)) return true;
  if (/\b50\s+50\b/.test(t) && /\bmix\b/.test(t)) return true;
  return false;
}

/** ¿El mensaje es una CORRECCIÓN de un dato ya dado? («mejor 15 yardas», «eran 12»…). */
function esCorreccion(texto) {
  const t = normalizar(texto);
  return /\b(mejor|eran|en realidad|perdon|correccion|me equivoque|cambialo|quise decir|actually|i meant)\b/.test(t);
}

/**
 * ¿El cliente está CANCELANDO? («ya no necesito nada», «cancela»,
 * «olvídalo», «mejor no», «never mind»…). OJO: «mejor no» cancela,
 * pero «mejor 15 yardas» es corrección — por eso «mejor no» solo
 * cuenta si es el mensaje completo o casi.
 */
function esCancelacion(texto) {
  const t = normalizar(texto).replace(/\s+/g, ' ').trim();
  if (
    /\b(ya no necesito|ya no quiero|no lo necesito|no necesito|ya no lo ocupo|ya no me interesa|cancela|cancelar|cancel|olvidalo|olvida eso|olvidenlo|never mind|nevermind|forget it|don'?t need|no longer need)\b/.test(t)
  ) {
    return true;
  }
  if (t === 'ya no' || t === 'mejor no') return true;
  if (/\bya no\b/.test(t) && t.length <= 30) return true;
  if (/^mejor no\b/.test(t) && t.length <= 30) return true;
  return false;
}

/** Despedida amable al cancelar (el cliente cerró la conversación). */
function despedidaCancelacion(idioma) {
  return idioma === 'en'
    ? "Got it, no problem 🙏 We'll leave it here for now. Whenever you need concrete, we're here to help. Have a great day!"
    : 'Entendido, sin problema 🙏 Lo dejamos aquí por ahora. Cuando necesite concreto, aquí estamos para servirle. ¡Que tenga un excelente día!';
}

/**
 * Preguntas frecuentes sueltas que el bot debe responder sin
 * guardarlas como dato del flujo. Solo cuentan si suenan a
 * PREGUNTA (para no robarle el dato a «quiero concreto con bomba»).
 * Devuelve el id de intent FAQ o null.
 */
function detectarFAQ(texto) {
  const t = normalizar(texto);
  const suenaPregunta =
    /\?/.test(texto) ||
    /^(cual|cuanto|cuanta|cuantos|que|como|tienen|tiene|hay|aceptan|acepta|puedo|se puede|do|does|can|what|how)\b/.test(t);
  if (!suenaPregunta) return null;
  if (
    /\bacepta(n)?\b[^.?!]*\b(tarjeta|zelle|pago|debito|credito|card)\b/.test(t) ||
    /\b(formas?|metodos?) de pago\b/.test(t) ||
    /\bpuedo pagar con\b/.test(t) ||
    /\b(efectivo|cash)\b/.test(t) ||
    /\bdo you accept\b/.test(t) ||
    /\bhow can i pay\b/.test(t)
  ) {
    return 'faq_pagos';
  }
  if (/\bminimo\b/.test(t) || /\bminimum\b/.test(t)) return 'faq_minimo';
  if (/\bbomba\b/.test(t) || /\bpump\b/.test(t)) return 'faq_bomba';
  return null;
}

// ---- Cobertura por ciudad (DFW): confirmar «Sí llegamos a X» ----
const CIUDADES_DFW = {
  'fort worth': 'Fort Worth', 'grand prairie': 'Grand Prairie',
  'farmers branch': 'Farmers Branch', 'north richland hills': 'North Richland Hills',
  'highland village': 'Highland Village', 'flower mound': 'Flower Mound',
  'lake dallas': 'Lake Dallas', 'the colony': 'The Colony',
  'little elm': 'Little Elm', 'cedar hill': 'Cedar Hill',
  'red oak': 'Red Oak', dallas: 'Dallas', arlington: 'Arlington',
  irving: 'Irving', garland: 'Garland', plano: 'Plano',
  mesquite: 'Mesquite', carrollton: 'Carrollton', richardson: 'Richardson',
  lewisville: 'Lewisville', allen: 'Allen', frisco: 'Frisco',
  mckinney: 'McKinney', denton: 'Denton', coppell: 'Coppell',
  euless: 'Euless', bedford: 'Bedford', hurst: 'Hurst', keller: 'Keller',
  southlake: 'Southlake', grapevine: 'Grapevine', mansfield: 'Mansfield',
  burleson: 'Burleson', desoto: 'DeSoto', duncanville: 'Duncanville',
  lancaster: 'Lancaster', waxahachie: 'Waxahachie', midlothian: 'Midlothian',
  ennis: 'Ennis', weatherford: 'Weatherford', azle: 'Azle',
  saginaw: 'Saginaw', haltom: 'Haltom City', watauga: 'Watauga',
  prosper: 'Prosper', celina: 'Celina', anna: 'Anna', melissa: 'Melissa',
  rockwall: 'Rockwall', rowlett: 'Rowlett', wylie: 'Wylie',
  sachse: 'Sachse', murphy: 'Murphy', corinth: 'Corinth',
  sanger: 'Sanger', decatur: 'Decatur', cleburne: 'Cleburne',
};
/** Si el mensaje nombra una ciudad del área DFW, devuelve su nombre bonito. */
function detectarCiudad(texto) {
  const t = ` ${normalizar(texto)} `;
  const claves = Object.keys(CIUDADES_DFW).sort((a, b) => b.length - a.length);
  for (const k of claves) {
    if (t.includes(` ${k} `) || t.includes(` ${k},`) || t.includes(` ${k}.`) || t.includes(` ${k}?`)) {
      return CIUDADES_DFW[k];
    }
  }
  return null;
}
/** ¿El mensaje PREGUNTA por cobertura nombrando una ciudad? Devuelve la ciudad o null. */
function preguntaCoberturaCiudad(texto) {
  const ciudad = detectarCiudad(texto);
  if (!ciudad) return null;
  const t = normalizar(texto);
  // «Vienen», «viene» y «atienden» también son pregunta de
  // cobertura (falla real 2026-10-22: «¿Vienen hasta Denton?»
  // no se detectaba y la pregunta se guardó como la dirección).
  if (
    /\b(llegan|llega|entregan|entrega|cubren|cubre|vienen|viene|van a|atienden|atiende|deliver|delivers|cover|covers|go to|come to|reach|serve)\b/.test(t)
  ) {
    return ciudad;
  }
  return null;
}
function lineaCiudad(ciudad, idioma) {
  return idioma === 'en'
    ? `Yes! We do deliver to *${ciudad}* 🏗️`
    : `¡Claro! Sí llegamos a *${ciudad}* 🏗️`;
}

/** ¿El cliente dice que no sabe cuántas yardas necesita? */
function esNoSabeYardas(texto) {
  const t = normalizar(texto).replace(/\s+/g, ' ').trim();
  if (t === 'no se') return true;
  return (
    /\bno se\b[^.?!]*\byardas?\b/.test(t) ||
    /\bno tengo idea\b/.test(t) ||
    /\bdon'?t know\b[^.?!]*\byards?\b/.test(t) ||
    /\bnot sure\b[^.?!]*\byards?\b/.test(t)
  );
}
function lineaNoSabeYardas(idioma) {
  return idioma === 'en'
    ? "No problem! 📐 We can figure it out from the measurements of your job: tell me the *length* and *width* in feet and the *thickness* in inches (4 is standard). For example: “20 by 30 feet, 4 inches thick”."
    : '¡Sin problema! 📐 Se lo calculamos con las medidas de su trabajo: dígame el *largo* y el *ancho* en pies y el *grosor* en pulgadas (lo normal son 4). Por ejemplo: «20 por 30 pies, de 4 pulgadas».';
}
function lineaMedidas(m, idioma) {
  return idioma === 'en'
    ? `With those measurements (${m.largo} × ${m.ancho} ft and ${m.grosor} inches thick) that comes to about *${m.calculado} yards*, already including the 10% extra 📐 I wrote them down; if the thickness is different, tell me and I'll adjust it.`
    : `Con esas medidas (${m.largo} × ${m.ancho} pies y ${m.grosor} pulgadas de grosor) serían unas *${m.calculado} yardas*, ya con el 10% extra 📐 Quedan anotadas; si el grosor es otro, dígamelo y lo ajustamos.`;
}

/**
 * Corrección cuando el cliente pide un PSI que NO existe
 * (regla del dueño, 2026-10-30, lista exacta dada a las 20:03):
 * los ÚNICOS mixes que existen son 3000, 3500, 3600, 4000, 4500
 * y 5000 psi. Cualquier otro número (2500, 5500, 6000…) no
 * existe. La pregunta del paso (qué mix necesita) va enseguida,
 * como siempre, al final de la respuesta.
 */
function lineaPsiInvalido(numero, idioma) {
  // Regla del dueño (2026-10-30 21:12): de los mixes que no
  // existen NO se nombran ni se recita la lista; se dice que no
  // están disponibles y que algo especial requiere solicitar un
  // mix design o submittal. El número pedido no se repite.
  return lineaMixInvalido(idioma);
}

/**
 * Corrección cuando el cliente da un mix por nombre de diseño
 * de una planta (regla del dueño, 2026-10-30 20:06): esos mixes
 * de diseño («275-P», «260-0»…) son de una planta específica y
 * NO se utilizan; solo se trabaja con los seis mixes por PSI.
 * El dato no se anota y el flujo vuelve a pedir el mix.
 */
function lineaMixInvalido(idioma) {
  return idioma === 'en'
    ? 'That mix is not available. If you need something special, you will need to request a mix design or submittal.'
    : 'Ese mix no está disponible. Si necesitas algo especial, tienes que solicitar un mix design o submittal.';
}

/**
 * Captura ADELANTADA de nombre/compañía cuando el cliente los da
 * sin que se le estén pidiendo («…, soy Juan Pérez, particular»):
 * solo con marcadores claros, para no capturar cualquier texto.
 */
function extraerNombreAdelantado(raw) {
  const out = {};
  const mN = raw.match(
    /(?:^|[,;\n]\s*|\s)(?:soy|mi nombre es|a nombre de|my name is)\s+([^,;\n]+)/i
  );
  if (mN) {
    const stop = new Set([
      'de', 'en', 'para', 'con', 'y', 'pago', 'particular', 'necesito',
      'quiero', 'the', 'in', 'at', 'from',
    ]);
    const tokens = mN[1].trim().split(/\s+/);
    const nombreTokens = [];
    for (const tok of tokens) {
      const limpio = tok.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ.'-]/g, '');
      if (!limpio || stop.has(normalizar(limpio)) || nombreTokens.length >= 3) break;
      nombreTokens.push(limpio);
    }
    if (nombreTokens.length) out.nombre = limpiarNombre(nombreTokens.join(' '));
  }
  if (
    /\b(particular|no tengo compan\w*|no tengo empresa|no company|just personal|es personal)\b/i.test(
      normalizar(raw)
    )
  ) {
    out.compania = 'Particular';
  } else {
    const mC = raw.match(
      /(?:compa[ñn][ií]a|empresa|negocio|company)\s*(?:es|se llama|is)\s*[:\-]?\s*([^,;\n]+)/i
    );
    if (mC) out.compania = limpiarNombre(mC[1]);
  }
  if (out.nombre === '') delete out.nombre;
  if (out.compania === '') delete out.compania;
  return out;
}

/**
 * Captura de nombre/compañía en un mensaje GRANDE multilínea
 * («todo en uno», falla real del 2026-10-31): el cliente suelta
 * todos sus datos de golpe, con el nombre y la compañía en
 * líneas sueltas SIN marcadores («Juan Escalante» / «Vince
 * Construction LLC» / …), y la captura adelantada — que exige
 * «soy…» o «compañía es…» — no los veía: la orden avanzaba
 * sin nombre ni compañía. Solo líneas limpias: la compañía
 * trae una palabra de giro (construction, LLC…) y el nombre
 * son 2–3 palabras propias capitalizadas; cualquier línea con
 * dígitos o con palabras de la orden (psi, slump, yardas,
 * precio, inspección…) se excluye una por una.
 */
function extraerNombreCompaniaMultilinea(raw) {
  const out = {};
  if (!raw || !/[\n;]/.test(raw)) return out;
  const RE_GIRO =
    /\b(concrete|construction|constru\w+|llc|inc\.?|corp|company|grupo|services|servicios|contractors?|builders?)\b/i;
  const RE_DATOS =
    /\b(psi|libras|slump|yardas?|yds?|precio|precios|aire|pompa|bomba|pump|inspecci[oó]n|inspection|tirar|d[ií]as?|direcci[oó]n|address|pago|pagar|zelle)\b/i;
  for (const lineaCruda of raw.split(/[\n;]/)) {
    const linea = lineaCruda.trim();
    if (!linea || /\d/.test(linea) || RE_DATOS.test(linea) || esSaludoPuro(linea)) continue;
    if (!out.compania && RE_GIRO.test(linea)) {
      out.compania = limpiarNombre(linea);
      continue;
    }
    if (!out.nombre) {
      const palabras = linea.split(/\s+/);
      if (
        palabras.length >= 2 &&
        palabras.length <= 3 &&
        palabras.every((p) => /^[A-ZÁÉÍÓÚÑ][a-záéíóúñ.'-]+$/.test(p))
      ) {
        out.nombre = limpiarNombre(linea);
      }
    }
    if (out.nombre && out.compania) break;
  }
  if (out.nombre === '') delete out.nombre;
  if (out.compania === '') delete out.compania;
  return out;
}

/**
 * Extrae del mensaje del cliente los datos de la orden que vengan
 * escritos. `paso` es el dato que el bot está pidiendo (si hay flujo):
 * las respuestas cortas se interpretan como ese dato.
 * Devuelve un objeto parcial con solo lo detectado.
 */
function extraerDatos(texto, paso) {
  const raw = (texto || '').trim();
  const d = {};
  if (!raw) return d;
  const correccion = esCorreccion(raw);
  if (correccion) d.correccion = true;
  const vaga = esRespuestaVaga(raw);

  // --- Yardas (+ plus) ---
  // RANGO DE YARDAS (regla del dueño, 2026-10-31 17:33): si el
  // cliente da un rango («90-100 yardas», «90 a 100 yardas»,
  // «de noventa a cien yardas»), JAMÁS se anota el número alto:
  // se anota el MENOR y el bot pregunta «¿Son 90 o son 100
  // yardas?» (la pregunta la arma manejarFlujo con
  // d.rangoYardas). ¿Por qué? Palabra del dueño: si se le ponen
  // las 100 y no las necesita, no las paga — él está eligiendo
  // la cantidad menor. (Antes la captura normal tomaba el
  // número pegado a «yardas», que en un rango es el ALTO.)
  const NUMEROS_PALABRA_YDS = {
    diez: 10, veinte: 20, treinta: 30, cuarenta: 40, cincuenta: 50,
    sesenta: 60, setenta: 70, ochenta: 80, noventa: 90, cien: 100, ciento: 100,
  };
  const fmtYds = (n) => (Number.isInteger(n) ? String(n) : String(n));
  const mRangoYds =
    raw.match(/(\d+(?:[.,]\d+)?)\s*(?:-|a)\s*(\d+(?:[.,]\d+)?)\s*(?:yds?|yards?|yardas?)\b/i) ||
    raw.match(/entre\s+(\d+(?:[.,]\d+)?)\s+y\s+(\d+(?:[.,]\d+)?)\s*(?:yds?|yards?|yardas?)\b/i);
  const mRangoYdsPalabras = !mRangoYds
    ? raw.match(/\b(diez|veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien|ciento)\s+a\s+(diez|veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien|ciento)\s+(?:yardas?|yds?|yards?)\b/i)
    : null;
  if (mRangoYds || mRangoYdsPalabras) {
    const v1 = mRangoYds
      ? parseFloat(mRangoYds[1].replace(',', '.'))
      : NUMEROS_PALABRA_YDS[mRangoYdsPalabras[1].toLowerCase()];
    const v2 = mRangoYds
      ? parseFloat(mRangoYds[2].replace(',', '.'))
      : NUMEROS_PALABRA_YDS[mRangoYdsPalabras[2].toLowerCase()];
    const bajo = Math.min(v1, v2);
    const alto = Math.max(v1, v2);
    if (alto > bajo) {
      d.yardas = { cantidad: fmtYds(bajo), plus: /\bplus\b/i.test(raw) || raw.includes('+') };
      d.rangoYardas = { bajo: fmtYds(bajo), alto: fmtYds(alto) };
    }
  }
  const mYds = raw.match(/(\d+(?:[.,]\d+)?)\s*(?:yds?|yards?|yardas?)\b/i);
  if (!d.yardas && mYds) {
    d.yardas = {
      cantidad: mYds[1].replace(',', '.'),
      plus: /\bplus\b/i.test(raw) || raw.includes('+'),
    };
  } else if (!d.yardas && paso === 'yardas') {
    const mNum = raw.match(/^[^0-9]*(\d+(?:[.,]\d+)?)[^0-9]*$/);
    if (mNum) {
      // OJO (falla real 2026-10-22): un número PEGADO a «psi» o
      // «libras» es el MIX, nunca la cantidad — «¿en cuánto tiene
      // la yarda del 3000psi?» dejó anotadas «3000 yds» porque el
      // único número del mensaje era el del mix. Si el número va
      // con psi/libras, las yardas NO se capturan: el flujo las
      // pregunta como debe ser.
      const idxNum = raw.indexOf(mNum[1]);
      const despuesNum = raw.slice(idxNum + mNum[1].length);
      if (!/^\s*(psi|libras)\b/i.test(despuesNum)) {
        d.yardas = { cantidad: mNum[1].replace(',', '.'), plus: /\bplus\b/i.test(raw) };
      }
    }
  }

  // --- Medidas → cálculo de yardas (largo × ancho × grosor, +10%) ---
  // Cuando el cliente no sabe las yardas y da las medidas del
  // trabajo («20 por 30 pies, de 4 pulgadas»), se calculan como en
  // la calculadora del sitio: volumen en pies³ / 27, con 10% extra,
  // redondeado a media yarda. Sin grosor se usa el normal: 4".
  if (!d.yardas) {
    const mMed = raw.match(/(\d+(?:[.,]\d+)?)\s*(?:x|por|\*)\s*(\d+(?:[.,]\d+)?)/i);
    if (mMed) {
      const largo = parseFloat(mMed[1].replace(',', '.'));
      const ancho = parseFloat(mMed[2].replace(',', '.'));
      const mGrosor =
        raw.match(/(\d+(?:[.,]\d+)?)\s*(?:pulgadas|inches|de grosor)/i) ||
        raw.match(/grosor(?:\s+de)?\s*(\d+(?:[.,]\d+)?)/i) ||
        raw.match(/\b(\d+(?:[.,]\d+)?)\s*(?:in\b|")/i);
      const grosor = mGrosor ? parseFloat(mGrosor[1].replace(',', '.')) : 4;
      if (largo > 0 && ancho > 0 && grosor > 0 && grosor <= 24) {
        const bruto = ((largo * ancho * (grosor / 12)) / 27) * 1.1;
        const redondeo = Math.max(1, Math.round(bruto * 2) / 2);
        const cantidad = Number.isInteger(redondeo) ? String(redondeo) : String(redondeo);
        d.yardas = { cantidad, plus: false };
        d.medidas = { largo, ancho, grosor, calculado: cantidad };
      }
    }
  }

  // --- Slump e inspección (transversales: solo si el cliente los menciona) ---
  // SLUMP (falla real del 2026-10-31): el patrón viejo buscaba
  // primero el número DESPUÉS de la palabra «slump» con
  // \D{0,4}, que cruzaba el salto de línea y robaba el primer
  // número siguiente del mensaje — con «5 slump / 90-100
  // yardas» anotó slump 90, que era el inicio del rango de
  // yardas. Regla: el slump EXPLÍCITO («5 slump») manda
  // siempre; la forma «slump 5» solo vale en la MISMA línea
  // ([ \t], jamás \s, que cruza líneas) — un rango de yardas
  // nunca alimenta el slump.
  const mSlump =
    raw.match(/(\d+(?:[.,]\d+)?)[ \t]*(?:de[ \t]+)?slump\b/i) ||
    raw.match(/slump[ \t]*(?:de[ \t]+)?[:#]?[ \t]*(\d+(?:[.,]\d+)?)/i);
  if (mSlump) d.slump = mSlump[1].replace(',', '.');
  // INSPECCIÓN: la negación manda — «No inspection» / «sin
  // inspección» es inspeccion = false, NO true (antes la
  // mención a secas lo marcaba como pedido y la orden salía
  // con «(inspection)» contra lo que el cliente dijo).
  if (/\b(no|sin|without)\s+(inspecci[oó]n|inspection)\b/i.test(raw)) d.inspeccion = false;
  else if (/\binspecci[oó]n\b|\binspection\b/i.test(raw)) d.inspeccion = true;

  // --- Reparto de una tirada en varios días → NOTA de la orden ---
  // «Si se puede tirar en 2 días 50 y 50» (falla real del
  // 2026-10-31): el cliente reparte una tirada grande entre
  // días. No hay ninguna fecha concreta que inventar: se deja
  // constancia en datos.nota, tal como lo escribió, y la orden
  // del dueño la lleva en una línea «Nota:». (Si las partes del
  // reparto son iguales, la cantidad pasa a ser la de cada día
  // «plus» y el rango no manda: ver el bloque siguiente.)
  const mRepartoDiasPrimero = raw.match(
    /tirar(?:lo|la)?\s+en\s+(\d+)\s+d[ií]as?\b[^.\n]*?(\d+)\s*(?:y|\+)\s*(\d+)/i
  );
  const mRepartoParesPrimero = mRepartoDiasPrimero
    ? null
    : raw.match(/(\d+)\s*(?:y|\+)\s*(\d+)[^.\n]*?\ben\s+(\d+)\s+d[ií]as?\b/i);
  if (mRepartoDiasPrimero) {
    d.nota = `Reparto: tirar en ${mRepartoDiasPrimero[1]} días, ${mRepartoDiasPrimero[2]} y ${mRepartoDiasPrimero[3]}`;
  } else if (mRepartoParesPrimero) {
    d.nota = `Reparto: tirar en ${mRepartoParesPrimero[3]} días, ${mRepartoParesPrimero[1]} y ${mRepartoParesPrimero[2]}`;
  }
  // REPARTO CON PARTES IGUALES = CANTIDAD POR DÍA «PLUS»
  // (palabra del dueño, 2026-10-31 18:50: «Entonces serían 50
  // yds plus»): si el cliente reparte la tirada en días con
  // partes IGUALES («en 2 días 50 y 50»), el mensaje YA trae la
  // cantidad que manda: la de CADA DÍA, y va «plus» porque cada
  // tirada puede crecer un poco. La cantidad de la orden pasa a
  // ser esa parte (50 plus), el rango «90-100» deja de mandar y
  // NO se pregunta «¿son 90 o 100 yardas?» — el cliente ya lo
  // contestó con el reparto. El total estimado (la suma) queda
  // visible en la nota del reparto. Con partes DESIGUALES
  // («60 y 40») no se toca nada: manda la regla del rango.
  const partesReparto = mRepartoDiasPrimero
    ? [mRepartoDiasPrimero[2], mRepartoDiasPrimero[3]]
    : mRepartoParesPrimero
      ? [mRepartoParesPrimero[1], mRepartoParesPrimero[2]]
      : null;
  if (
    partesReparto &&
    parseFloat(partesReparto[0]) > 0 &&
    parseFloat(partesReparto[0]) === parseFloat(partesReparto[1])
  ) {
    d.yardas = { cantidad: fmtYds(parseFloat(partesReparto[0])), plus: true };
    delete d.rangoYardas;
  }

  // --- Hora ---
  // FORMAS NATURALES Y ERRORES DE TECLADO (falla real del
  // 2026-10-31 16:55): el cliente respondió «7:00 an» (la «n»
  // por la «m» de «am») y el bot NO lo reconoció: repitió la
  // pregunta de la hora como si no hubiera respondido. Un
  // cliente real escribe rápido y con errores; la hora se
  // acepta en todas sus formas razonables:
  //  1) con la parte del día en palabras: «7 de la mañana»,
  //     «7:00 en la tarde», «7 por la noche», «7 in the
  //     morning» — se guarda la frase tal cual;
  //  2) con error de teclado en el sufijo, pegado a una hora
  //     con minutos: «7:00 an» = 7:00 am, «10:30 pn» = 10:30 pm
  //     — se guarda CORREGIDO (am/pm), no con el error;
  //  3) con la letra sola al final: «7:00 a» / «7:00 p»;
  //  4) la forma normal «7 am», «10:30 pm», «a las 7».
  // OJO: en «7 de la mañana» la palabra «mañana» es la MAÑANA,
  // no el día de mañana — por eso la fecha se busca sobre una
  // copia del texto sin esas construcciones (ver textoFecha).
  const mHoraParteDia =
    raw.match(
      /(?:\ba\s+las\s+|\blas\s+)?((?:1[0-2]|0?[1-9])(?::\d{2})?\s+(?:de|en|por)\s+la\s+(?:mañana|tarde|noche))/i
    ) ||
    raw.match(
      /((?:1[0-2]|0?[1-9])(?::\d{2})?\s+in\s+the\s+(?:morning|afternoon|evening))/i
    );
  const mHoraErrorTeclado = mHoraParteDia
    ? null
    : raw.match(/((?:1[0-2]|0?[1-9]):\d{2})\s*(an|pn)\b/i);
  const mHoraLetraSola =
    mHoraParteDia || mHoraErrorTeclado
      ? null
      : raw.match(/((?:1[0-2]|0?[1-9]):\d{2})[ \t]+([ap])[.\s]*$/im);
  const mHora =
    mHoraParteDia || mHoraErrorTeclado || mHoraLetraSola
      ? null
      : raw.match(/(\d{1,2}(?::\d{2})?\s*(?:a\.?\s?m\.?|p\.?\s?m\.?))/i) ||
        raw.match(/a las\s+(\d{1,2}(?::\d{2})?)/i);
  if (mHoraParteDia) d.hora = mHoraParteDia[1].trim();
  else if (mHoraErrorTeclado)
    d.hora = `${mHoraErrorTeclado[1]} ${mHoraErrorTeclado[2].toLowerCase() === 'an' ? 'am' : 'pm'}`;
  else if (mHoraLetraSola)
    d.hora = `${mHoraLetraSola[1]} ${mHoraLetraSola[2].toLowerCase() === 'a' ? 'am' : 'pm'}`;
  else if (mHora) d.hora = mHora[1].trim();
  else if (paso === 'hora') {
    // HORA SUELTA SIN SUFIJO (falla real del 2026-10-31 17:18):
    // a la pregunta «¿A qué hora lo necesita en la obra?» el
    // cliente respondió solo «7» y el bot repitió la pregunta
    // como si no hubiera respondido — el cliente NO va a
    // escribir todo perfecto. Si el bot acaba de preguntar la
    // hora y TODO el mensaje es un número de hora válido
    // («7», «7:00», «12», «14»), eso ES la hora y se guarda
    // tal cual (como ya se guarda «a las 7» → «7»). Solo en
    // este paso: en cualquier otro, un número suelto puede ser
    // yardas, slump u otra cosa. «7 yardas» o un rango no
    // entran (la expresión va anclada a todo el mensaje), y un
    // número fuera de 0-23 o con minutos >59 no es hora.
    const mHoraSuelta = raw
      .trim()
      .replace(/[. ]+$/, '')
      .match(/^(\d{1,2})(?::(\d{2}))?$/);
    if (mHoraSuelta) {
      const hNum = parseInt(mHoraSuelta[1], 10);
      const minNum =
        mHoraSuelta[2] === undefined ? null : parseInt(mHoraSuelta[2], 10);
      if (hNum <= 23 && (minNum === null || minNum <= 59)) {
        d.hora = mHoraSuelta[0];
      }
    }
  }

  // --- Fecha (día de la entrega) ---
  // La fecha se busca sobre textoFecha: el mismo mensaje SIN
  // las construcciones «de/en/por la mañana» (ahí «mañana» es
  // la parte del día de la HORA, no el día de mañana). Sin
  // esta limpieza, «7 de la mañana» guardaba fecha = «mañana»
  // (mañana = tomorrow) sin que el cliente diera ningún día.
  // Un «mañana» suelto («mañana a las 7 de la mañana») SÍ se
  // sigue detectando como el día: solo se neutraliza el que
  // va pegado a «de/en/por la».
  const textoFecha = raw.replace(
    /(\b(?:de|en|por)\s+la\s+)mañana\b/gi,
    '$1jornada'
  );
  const mFecha =
    textoFecha.match(/\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/) ||
    textoFecha.match(/\d{1,2}\s+de\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)/i) ||
    textoFecha.match(/pasado\s+mañana|mañana|hoy|lunes|martes|miércoles|jueves|viernes|sábado|domingo|tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday/i);
  if (mFecha) {
    d.fecha = mFecha[0].trim();
  } else if (
    paso === 'fecha' && !d.hora && !d.yardas && !pareceDireccion(raw) &&
    !esPreguntaPrecio(raw) && !preguntaSobreAire(raw) &&
    !preguntaCuandoPedir(raw) && !preguntaPagoAdelantado(raw) &&
    !correccion && !vaga &&
    detectarRespuestaPompa(raw) === null && pareceFechaTexto(raw)
  ) {
    // Respuesta corta al «¿para qué día?»: se toma tal cual
    // (una pregunta de precio jamás se toma como fecha, y un
    // «ok» tampoco es una fecha). REGLA GENERAL (2026-10-22):
    // un campo solo se llena con una RESPUESTA del cliente,
    // nunca con una PREGUNTA suya — «quiero hacerlo la semana
    // que viene, ¿cuándo debo pedirlo?» no es una fecha, y
    // «¿cuándo se paga?» tampoco.
    // VALIDACIÓN (2026-10-31 16:35): el texto además debe
    // PARECER fecha (pareceFechaTexto) y NO ser la respuesta de
    // otro dato: «No pump» es el sí/no de la POMPA y se rutea a
    // ese campo en su sección — jamás se guarda como día (es la
    // misma clase de defecto ya corregido con «¿Puedo pagarlo…?»
    // tragado como fecha). Lo que no parece fecha no se guarda:
    // el bot repite la pregunta del día.
    d.fecha = raw.replace(/[. ]+$/, '');
  }

  // Dirección con MARCADOR («Dirección 4215 N Beltwood Dallas
  // Tx»): el cliente la etiqueta él mismo, así que la línea se
  // toma tal cual aunque la calle no traiga un sufijo
  // reconocido ni ZIP (falla real del 2026-10-31: «Beltwood»
  // no es st/ave/dr… y pareceDireccion no la reconocía — la
  // dirección se perdía entera en el mensaje grande).
  const mDirMarcada = raw.match(
    /(?:^|\n)[ \t]*(?:direcci[oó]n|address)[ \t]*[:\-]?[ \t]*([^\n]+)/i
  );
  let direccionMarcada = null;
  if (mDirMarcada) {
    const cand = mDirMarcada[1].trim().replace(/[. ]+$/, '');
    if (/\d/.test(cand) && cand.length >= 6) direccionMarcada = cand;
  }

  // Dirección suelta sin sufijo ni etiqueta («4215 N Beltwood
  // Dallas Tx»): también ES dirección a todos los efectos — su
  // número de casa jamás se evalúa como mix (falla del 2026-10-31
  // 16:21) y la dirección se captura (ver la sección Dirección).
  const dirSuelta = pareceDireccionSuelta(raw);
  const esDireccion = pareceDireccion(raw) || !!direccionMarcada || dirSuelta;

  // --- Aire (va junto con el mix: «aire o no aire») ---
  // Si el mensaje PREGUNTA sobre el aire («¿qué es el aire?»), la
  // palabra «aire» es parte de la pregunta, no una respuesta: no se
  // captura como dato (el bot explica y vuelve a preguntar).
  const aire = preguntaSobreAire(raw) ? null : extraerAire(raw);
  if (aire) d.aire = aire;

  // Respuesta EXPLÍCITA a la pregunta de la pompa (sí/no CON la
  // pompa nombrada, ES/EN): vale en CUALQUIER paso del flujo —
  // también en el de la fecha, donde «No pump» se guardaba como
  // día — y manda sobre la captura del tipo: «No boom» NO es
  // «boom pump». Si además nombra el OTRO tipo («no boom, mejor
  // la trailer»), manda el tipo nombrado, no la negación.
  const respPompa = detectarRespuestaPompa(raw);
  const esPregunta =
    esPreguntaPrecio(raw) || preguntaSobreAire(raw) || preguntaCuandoPedir(raw) || preguntaPagoAdelantado(raw);
  const mencionaOtroTipo = /\b(trailer|arrastre|small\s*line|linea\s*pequena)\b/.test(normalizar(raw));
  // Tipo de pompa (boom / small line / trailer): se captura si
  // el cliente lo menciona en cualquier momento del flujo.
  const pompaTipo =
    respPompa === false && !mencionaOtroTipo ? null : extraerPompa(raw);
  if (respPompa === false && !mencionaOtroTipo && !esPregunta) {
    d.pompa = 'Sin pompa';
  } else if (pompaTipo) {
    d.pompa = pompaTipo;
  } else if (!d.pompa) {
    // ¿Ocupa pompa? (regla del dueño, 2026-10-30): el sí/no se
    // interpreta SOLO si el mensaje es del tema del mix: o ya
    // estamos en el paso del mix, o el mensaje mismo trae mix o
    // aire (el caso «todo en uno»: «10 yardas de 4000 con aire
    // sin pompa» llega con el paso todavía en yardas). Nunca se
    // adivina un «no» suelto en otros pasos. Y no debe ser un
    // dato de otro paso posterior (dirección, fecha, hora o
    // pago) ni una pregunta. OJO: el aire de ESTE mensaje quedó
    // en `aire` (variable local), no en d.aire — la fusión con
    // el flujo ocurre después, en fusionarDatos. Si dice que
    // sí: 'pendiente' (le tocan las opciones); si dice que no:
    // 'Sin pompa' y la orden sigue con la dirección.
    // Una corrección explícita que menciona la pompa («mejor
    // sin pompa») también cuenta como mensaje del tema, llegue
    // en el paso que llegue.
    const esDelMix =
      paso === 'mix' || !!d.mix || !!aire || (/\b(pompa|bomba|pump)\b/.test(raw) && d.correccion);
    const esOtroDato = !!d.fecha || !!d.hora || !!d.pago || pareceDireccion(raw);
    // VOLCADO DE DATOS (principio del dueño, 2026-10-31 16:09):
    // si el mensaje NOMBRA la pompa con su sí/no («No ocupo
    // pompa», «sin pompa», «sí ocupo pompa»), la respuesta es
    // EXPLÍCITA y se captura aunque el mismo mensaje traiga
    // además dirección, día u hora. La guarda de esOtroDato
    // solo frena el «no» suelto y ambiguo de otros pasos, no
    // la frase completa sobre la pompa.
    const mencionaPompa = /\b(pompa|bomba|pump)\b/.test(normalizar(raw));
    if ((esDelMix && !esOtroDato && !esPregunta) || (mencionaPompa && !esPregunta)) {
      // El sí/no se interpreta sobre el texto SIN las negaciones
      // de otros temas (quitarNegacionesDeOtrosTemas): cada «no»
      // vale solo para su pregunta — «No aire» NO marca la pompa
      // (falla real del 2026-10-31 16:35: el bot dio la pompa
      // por respondida con el «No» del aire y saltó al día).
      const ocupa = extraerOcupaPompa(quitarNegacionesDeOtrosTemas(raw));
      if (ocupa === true) d.pompa = 'pendiente';
      else if (ocupa === false) d.pompa = 'Sin pompa';
    }
  }
  // Una respuesta EXPLÍCITA de la pompa (la nombra con su sí/no)
  // manda sobre un valor anterior distinto de ese mismo campo:
  // es el cliente corrigiendo ESE dato, llegue en el paso que
  // llegue (fusionarDatos lo aplica como corrección solo para
  // la pompa, sin tocar la regla general de los demás campos).
  if (respPompa !== null && d.pompa) d.pompaExplicita = true;

  // --- Mix ---
  // Primero los PRODUCTOS sin PSI (pea gravel, flowable fill,
  // grout): si el cliente nombra uno, ese producto ES la mezcla
  // — en el paso del mix y también en un mensaje «todo en uno»
  // («necesito 10 yardas de flowable fill para mañana»).
  // La resistencia se pide como «4000 psi», «3000 libras», «de
  // 3000» o el número solo («cemento 4000»): todas se entienden
  // como el mix. El número solo NO se captura si el mensaje parece
  // una dirección (podría ser el número de la calle), pero «de
  // 3000» o «3000 con aire» SÍ se capturan aunque venga la
  // dirección en el mismo mensaje (antes ese mix se perdía).
  // REGLA DEL DUEÑO (2026-10-30, lista exacta de las 20:03): los
  // ÚNICOS mixes que existen son 3000, 3500, 3600, 4000, 4500 y
  // 5000 psi. Cualquier otro PSI (2500, 5500, 6000…) se marca
  // d.psiInvalido y el bot corrige al cliente con la lista real,
  // sin anotarlo como mix.
  const NUMS_MIX = '3000|3500|3600|4000|4500|5000';
  const MIXES_PSI = new Set([3000, 3500, 3600, 4000, 4500, 5000]);
  const producto = detectarProducto(raw);
  // Menciones EXPLÍCITAS de PSI en el mensaje («3,000 psi»,
  // «3500 libras»…), con la coma de miles normalizada ANTES
  // de comparar contra la lista: el patrón viejo (\d{3,5})
  // calzaba la COLA «000» de «3,000 psi» y un mix que SÍ
  // existe salía corregido como «no disponible» (falla real
  // del 2026-10-31: «Ocupo precio de 3,000 psi y otro de
  // 3,500 psi»). Y si el mensaje trae DOS O MÁS mixes
  // DISTINTOS, es una comparación o pregunta de precios:
  // NINGUNO se marca inválido — la frase de mix no
  // disponible SOLO sale cuando el cliente pide UN ÚNICO
  // mix que no existe — y los válidos se guardan como
  // COTIZACIONES (el par, más abajo): no hay que elegir uno.
  const mencionesPsi = [
    ...raw.matchAll(/(\d{1,3}(?:,\d{3})+|\d{3,5})\s*(?:psi|libras)\b/gi),
  ].map((m) => parseInt(m[1].replace(/,/g, ''), 10));
  const variosMixes = new Set(mencionesPsi).size > 1;
  const mPsi =
    raw.match(/(\d{1,3}(?:,\d{3})+|\d{3,5})\s*(?:psi|libras)\b/i) ||
    raw.match(new RegExp(`\\bde\\s+(${NUMS_MIX})\\b`, 'i')) ||
    raw.match(new RegExp(`\\b(${NUMS_MIX})\\s+(?:con|sin)\\s+aire\\b`, 'i')) ||
    raw.match(new RegExp(`\\b(?:mix|mezcla)\\s*(?:de\\s*)?(${NUMS_MIX})\\b`, 'i')) ||
    (!esDireccion ? raw.match(new RegExp(`\\b(${NUMS_MIX})\\b`)) : null);
  // POMPA MIX 50-50: mix válido para pompas de arrastre (regla
  // del dueño, 2026-10-30). Si el mensaje parece una dirección,
  // el «5050» suelto puede ser el número de la calle: en ese
  // caso solo cuenta si el cliente menciona la pompa.
  const pompa =
    detectarPompaMix(raw) && (!esDireccion || /\bpompa\b/.test(normalizar(raw)));
  if (pompa) {
    d.mix = 'Pompa mix 50-50';
  } else if (producto) {
    d.mix = producto;
  } else if (mPsi) {
    // Con DOS O MÁS mixes distintos en el mensaje (comparación
    // o pregunta de precios, variosMixes) no se marca ninguno
    // como inválido: esa detección manda. Y los mixes VÁLIDOS
    // pedidos se guardan como COTIZACIONES (regla del dueño,
    // 2026-10-31 19:03: «recuerda que está pidiendo precio,
    // entonces tienes que hacer 2 cotizaciones — con el mix
    // diferente pero todo lo demás [igual]»): el cliente NO
    // tiene que elegir uno; la orden lleva el par y se cotiza
    // cada mix con los mismos demás datos.
    if (variosMixes) {
      const validos = [...new Set(mencionesPsi.filter((n) => MIXES_PSI.has(n)))].sort((a, b) => a - b);
      if (validos.length > 1) d.mixesCotizacion = validos.map((n) => `${n} psi`);
    } else {
      const nPsi = parseInt(mPsi[1].replace(/,/g, ''), 10);
      if (!MIXES_PSI.has(nPsi)) {
        // PSI que no existe (ej. «quiero 2500 psi», «5500 psi»):
        // NO se anota como mix; se marca para que el bot corrija
        // al cliente con los únicos mixes que hay.
        d.psiInvalido = String(nPsi);
      } else {
        d.mix = `${nPsi} psi`;
      }
    }
  } else if (paso === 'mix' && !esDireccion && !d.fecha && !d.hora && !correccion && !vaga) {
    // En el paso del mix, el mensaje puede traer un nombre de
    // diseño de planta (ej. «mix 275-P»): regla del dueño
    // (2026-10-30) — esos NO se utilizan ni se anotan; solo los
    // seis mixes por PSI. Se marca d.mixInvalido para corregir
    // al cliente con la lista. Y SOLO si parece un mix de
    // verdad: «gracias» o texto basura NO disparan la corrección
    // (se re-pregunta con ejemplos). Una pregunta de precio o
    // sobre el aire tampoco es un mix.
    const mixTexto = esPreguntaPrecio(raw) || preguntaSobreAire(raw) ? '' : quitarFrasesAire(raw);
    // Un número SOLO como respuesta («2500», «de 2500»): si no
    // está en la lista de mixes que existen (3000, 3500, 3600,
    // 4000, 4500, 5000) es el mismo PSI que no existe — se marca
    // inválido en vez de anotarlo como mix de texto libre.
    const soloNum = mixTexto.match(/^\s*(?:de\s+)?(\d{3,5})\s*(?:psi|libras)?\s*$/i);
    const numEnTexto = mixTexto.match(/\b(\d{4})\b/);
    if (soloNum && !MIXES_PSI.has(parseInt(soloNum[1], 10))) {
      d.psiInvalido = soloNum[1];
    } else if (numEnTexto && !MIXES_PSI.has(parseInt(numEnTexto[1], 10))) {
      // «un mix de 2500» como respuesta al paso del mix: el
      // número de 4 cifras que no está en la lista dentro del
      // texto es el PSI inválido, no un nombre de diseño
      // («mix 275-P» o «260-0» no traen 4 cifras seguidas y no
      // se tocan).
      d.psiInvalido = numEnTexto[1];
    } else if (mixTexto && pareceMix(mixTexto)) {
      // Parece un mix, pero es un nombre de diseño de una planta
      // (ej. «mix 275-P», «260-0»): NO se anota como mix; se
      // marca para corregir al cliente con la lista de los seis.
      d.mixInvalido = mixTexto.replace(/[. ]+$/, '');
    }
  } else {
    const mMix = raw.match(/\b(?:mix|mezcla)\b[^,.;]*/i);
    if (mMix) {
      const textoMix = quitarFrasesAire(mMix[0]).replace(/[. ]+$/, '');
      // «mix de 2500» sin la palabra psi: un número de 4 cifras
      // que no está en la lista de mixes dentro del texto es el
      // mismo PSI inválido. Un nombre de diseño («mix 275-P»,
      // «260-0», «high early») es un mix que NO se utiliza: se
      // marca mixInvalido (solo si trae dígitos o «early», para
      // no disparar la corrección con una pregunta sobre mixes).
      const nMix = textoMix.match(/\b(\d{4})\b/);
      if (nMix && !MIXES_PSI.has(parseInt(nMix[1], 10))) d.psiInvalido = nMix[1];
      else if (/\d/.test(textoMix) || /early/i.test(textoMix)) d.mixInvalido = textoMix;
    }
  }

  // Si el PSI inválido era el ÚNICO número del mensaje, la
  // captura de yardas (un número suelto en el paso de yardas se
  // toma como cantidad) pudo anotarlo como yardas («un mix de
  // 2500» dejaba «2500 yds»): ese número era el PSI, no las
  // yardas — se deshace esa captura.
  if (d.psiInvalido && d.yardas && d.yardas.cantidad === d.psiInvalido) {
    delete d.yardas;
  }

  // --- Dirección ---
  if (direccionMarcada) {
    // La línea que el cliente etiquetó «Dirección»/«Address»
    // manda sobre la heurística de sufijos de calle.
    d.direccion = direccionMarcada;
  } else if (esDireccion) {
    // capturarDireccion exige sufijo de calle: si el mensaje ES
    // una dirección suelta sin sufijo («4215 N Beltwood…»), el
    // mensaje completo ES la dirección y se toma tal cual.
    const dir = capturarDireccion(raw) || (dirSuelta ? raw.trim().replace(/[. ]+$/, '') : null);
    if (dir) d.direccion = dir;
  } else if (
    paso === 'direccion' &&
    !d.mix &&
    !d.yardas &&
    !d.fecha &&
    !d.hora &&
    !esPreguntaPrecio(raw) &&
    !preguntaSobreAire(raw) &&
    !preguntaCoberturaCiudad(raw) &&
    !preguntaCuandoPedir(raw) &&
    !preguntaPagoAdelantado(raw) &&
    !correccion &&
    !vaga
  ) {
    // Respuesta corta al «¿cuál es la dirección?»: se toma tal cual
    // (conserva saltos de línea, ej. la línea «Estados Unidos»).
    // Una pregunta de precio jamás se toma como dirección — y
    // una pregunta de COBERTURA («¿vienen hasta Denton?»),
    // tampoco: es una pregunta, no la dirección (falla real
    // 2026-10-22).
    d.direccion = raw.replace(/[. ]+$/, '');
  }

  // --- Nombre y compañía ---
  // Se piden UNO POR VEZ al final (primero el nombre, después la
  // compañía), pero si el cliente da los dos juntos se capturan
  // ambos. Un «ok» jamás es un nombre. Y en CUALQUIER paso, si el
  // cliente da su nombre/compañía por adelantado con marcadores
  // claros («soy Juan Pérez, particular»), se guardan y no se le
  // vuelven a preguntar.
  if ((paso === 'nombre' || paso === 'compania') && !esPreguntaPrecio(raw) && !preguntaSobreAire(raw)) {
    const hayMarcador =
      /a nombre de|mi nombre es|my name is|nombre\s*[:\-]|compa[ñn]|empresa|negocio|company|particular|soy\b/i.test(raw);
    // En el paso de la compañía, un «no» suelto (o cualquier
    // frase de «sin compañía») SÍ es la respuesta, aunque sea
    // «vaga» para los demás pasos: si no, el bot repite la
    // pregunta para siempre (falla real del 2026-10-31).
    const sinCompania = paso === 'compania' && esSinCompania(raw);
    if ((sinCompania || !vaga) && (sinCompania || !correccion || hayMarcador)) {
      const cli = extraerNombreCompania(raw);
      if (cli.nombre) d.nombre = cli.nombre;
      if (cli.compania) d.compania = cli.compania;
    }
  } else if (!esPreguntaPrecio(raw) && !preguntaSobreAire(raw)) {
    const adelantado = extraerNombreAdelantado(raw);
    if (adelantado.nombre) d.nombre = adelantado.nombre;
    if (adelantado.compania) d.compania = adelantado.compania;
  }
  // Nombre/compañía en LÍNEAS SUELTAS de un mensaje grande
  // multilínea («todo en uno»): se capturan aunque el mensaje
  // traiga además una pregunta de precio u otros datos — el
  // helper excluye las líneas de datos una por una. Solo
  // llena lo que falte; lo capturado por las rutas de arriba
  // (pasos nombre/compañía o marcadores) manda.
  if (!d.nombre || !d.compania) {
    const multi = extraerNombreCompaniaMultilinea(raw);
    if (!d.nombre && multi.nombre) d.nombre = multi.nombre;
    if (!d.compania && multi.compania) d.compania = multi.compania;
  }

  // --- Forma de pago ---
  // En el paso del pago: si dice solo «tarjeta»/«card» sin
  // aclarar, se marca genérica (d.pagoGenerica) y el flujo
  // pregunta «¿Débito o crédito?» una sola vez. En cualquier otro
  // paso, una forma de pago ESPECÍFICA dada por adelantado
  // («pago por zelle») se guarda y no se vuelve a preguntar.
  const pagoDetectado = extraerPago(raw);
  if (paso === 'pago' && !esPreguntaPrecio(raw) && !preguntaSobreAire(raw)) {
    if (pagoDetectado === 'Tarjeta') d.pagoGenerica = true;
    else if (pagoDetectado) {
      d.pago = pagoDetectado;
      // Efectivo: se marca para que la línea genérica de «pago
      // por adelantado» no se le repita en este turno (la regla
      // propia del efectivo se olvidó el 2026-10-31).
      if (pagoDetectado === PAGO_EFECTIVO) d.pagoEfectivo = true;
    }
  } else if (
    pagoDetectado &&
    pagoDetectado !== 'Tarjeta' &&
    /\b(pago|pagar|pay|zelle|debito|debit|credito|credit|efectivo|cash|cheque|check)\b/i.test(normalizar(raw))
  ) {
    d.pago = pagoDetectado;
    if (pagoDetectado === PAGO_EFECTIVO) d.pagoEfectivo = true;
  }

  return d;
}

/**
 * Fusiona los datos detectados en el flujo. Devuelve
 * { aplicados, corregidos }: los datos nuevos y los que eran una
 * CORRECCIÓN de un dato ya dado («mejor 15 yardas», «mejor sin
 * aire»): una corrección actualiza el dato correcto — jamás se
 * guarda como el dato del paso actual — y el bot la confirma.
 */
function fusionarDatos(flow, d) {
  const aplicados = [];
  const corregidos = [];
  for (const campo of ['yardas', 'mix', 'aire', 'pompa', 'direccion', 'fecha', 'hora', 'slump', 'nombre', 'compania', 'pago', 'nota']) {
    if (!d[campo]) continue;
    // 'pendiente' en pompa no es un dato: es la marca de «dijo
    // que sí ocupa y falta que elija el tipo» — elegir el tipo
    // la reemplaza como dato nuevo, no como corrección.
    const habia = campo === 'pompa' && flow.datos[campo] === 'pendiente' ? null : flow.datos[campo];
    if (!habia) {
      flow.datos[campo] = d[campo];
      aplicados.push(campo);
    } else if (JSON.stringify(habia) !== JSON.stringify(d[campo])) {
      if (campo === 'yardas' || d.correccion || (campo === 'pompa' && d.pompaExplicita)) {
        flow.datos[campo] = d[campo];
        corregidos.push(campo);
      }
    }
  }
  // COTIZACIONES POR MIX (regla del dueño, 2026-10-31 19:03):
  // si el cliente pidió precio de 2+ mixes, la orden lleva el
  // par como mix visible (2 cotizaciones, todo lo demás igual)
  // y NO se le obliga a elegir uno — el campo 'mix' de las
  // confirmaciones representa al par. Si después el cliente
  // elige UN solo mix (llega d.mix), el par se descarta y
  // manda ese mix.
  if (d.mixesCotizacion) {
    const antesMix = flow.datos.mixesCotizacion
      ? flow.datos.mixesCotizacion.join('|')
      : flow.datos.mix || null;
    const nuevoMix = d.mixesCotizacion.join('|');
    flow.datos.mixesCotizacion = d.mixesCotizacion;
    flow.datos.mix = null;
    if (!antesMix) aplicados.push('mix');
    else if (antesMix !== nuevoMix && !corregidos.includes('mix')) corregidos.push('mix');
  } else if (d.mix && flow.datos.mixesCotizacion) {
    flow.datos.mixesCotizacion = null;
  }
  // Inspección: la mención explícita manda en AMBOS sentidos —
  // «No inspection» la deja en false, no solo se enciende.
  if (d.inspeccion !== undefined) flow.datos.inspeccion = d.inspeccion;
  return { aplicados, corregidos };
}

/** Muestra el aire en el idioma del cliente (el dato guardado es el del dueño). */
function aireDisplay(aire, idioma) {
  if (idioma !== 'en') return aire;
  return aire === 'con aire' ? 'with air' : aire === 'no aire' ? 'no air' : aire;
}
/** Muestra la forma de pago en el idioma del cliente. */
function pagoDisplay(pago, idioma) {
  if (idioma !== 'en') return pago;
  if (pago === 'Tarjeta de débito') return 'Debit card';
  if (pago === 'Tarjeta de crédito') return 'Credit card';
  if (pago === PAGO_CHEQUE) return 'Check';
  if (esPagoEfectivo(pago)) return 'Cash';
  return pago;
}

/**
 * Texto del par (o más) de mixes pedidos como cotizaciones:
 * «3000 psi y 3500 psi (2 cotizaciones)» — con el mix
 * diferente pero todo lo demás igual (regla del dueño,
 * 2026-10-31 19:03).
 */
function textoMixesCotizacion(mixes, idioma = 'es') {
  const lista = mixes.join(idioma === 'en' ? ' and ' : ' y ');
  return idioma === 'en'
    ? `${lista} (${mixes.length} quotes)`
    : `${lista} (${mixes.length} cotizaciones)`;
}

/** Lista de mixes del par, sin el conteo: «3000 psi y 3500 psi». */
function listaMixesCotizacion(mixes, idioma = 'es') {
  return mixes.join(idioma === 'en' ? ' and ' : ' y ');
}

/** El mix visible de la orden: el único elegido, o el par de cotizaciones. */
function mixVisible(datos, idioma = 'es') {
  if (datos.mixesCotizacion && datos.mixesCotizacion.length) {
    return textoMixesCotizacion(datos.mixesCotizacion, idioma);
  }
  return datos.mix;
}

/** Confirmación breve de un dato recién capturado. */
function confirmacionDe(campo, datos, idioma = 'es') {
  if (idioma === 'en') {
    switch (campo) {
      case 'yardas':
        return `got it: *${datos.yardas.cantidad} yds${datos.yardas.plus ? ' plus' : ''}*`;
      case 'mix':
        return datos.mixesCotizacion
          ? `got the *${datos.mixesCotizacion.length} quotes: ${listaMixesCotizacion(datos.mixesCotizacion, 'en')}*`
          : `got the mix: *${datos.mix}*`;
      case 'aire':
        return `noted: concrete *${aireDisplay(datos.aire, idioma)}*`;
      case 'pompa':
        if (datos.pompa === 'pendiente') return 'noted: *pump needed*';
        return datos.pompa === 'Sin pompa'
          ? 'noted: *no pump*'
          : `noted the pump: *${datos.pompa}*`;
      case 'direccion':
        return `got the *address*`;
      case 'fecha':
        return `noted the day: *${datos.fecha}*`;
      case 'hora':
        return `noted the time: *${datos.hora}*`;
      case 'slump':
        return `noted the slump: *${datos.slump}*`;
      case 'nombre':
        return `noted the name: *${datos.nombre}*`;
      case 'compania':
        return datos.compania === 'Particular'
          ? 'noted: *personal* (no company)'
          : `noted the company: *${datos.compania}*`;
      case 'pago':
        return `noted the payment: *${pagoDisplay(datos.pago, idioma)}*`;
      case 'nota':
        return `noted: *${datos.nota}*`;
      default:
        return 'noted';
    }
  }
  switch (campo) {
    case 'yardas':
      return `anotadas las *${datos.yardas.cantidad} yds${datos.yardas.plus ? ' plus' : ''}*`;
    case 'mix':
      return datos.mixesCotizacion
        ? `anotadas las *${datos.mixesCotizacion.length} cotizaciones: ${listaMixesCotizacion(datos.mixesCotizacion, 'es')}*`
        : `anotado el mix: *${datos.mix}*`;
    case 'aire':
      return `anotado: concreto *${datos.aire}*`;
    case 'pompa':
      if (datos.pompa === 'pendiente') return 'anotado: *sí, ocupa pompa*';
      return datos.pompa === 'Sin pompa'
        ? 'anotado: *sin pompa*'
        : `anotada la pompa: *${datos.pompa}*`;
    case 'direccion':
      return `anotada la *dirección*`;
    case 'fecha':
      return `anotado el día: *${datos.fecha}*`;
    case 'hora':
      return `anotada la hora: *${datos.hora}*`;
    case 'slump':
      return `anotado el slump: *${datos.slump}*`;
    case 'nombre':
      return `anotado el nombre: *${datos.nombre}*`;
    case 'compania':
      return datos.compania === 'Particular'
        ? 'anotado: queda como *particular* (sin compañía)'
        : `anotada la compañía: *${datos.compania}*`;
    case 'pago':
      return `anotado el pago: *${datos.pago}*`;
    case 'nota':
      return `anotada la nota: *${datos.nota}*`;
    default:
      return 'anotado';
  }
}

/** Confirmación de un dato CORREGIDO por el cliente («lo dejo en…»). */
function confirmacionCorreccionDe(campo, datos, idioma = 'es') {
  if (idioma === 'en') {
    switch (campo) {
      case 'yardas':
        return `changed to *${datos.yardas.cantidad} yds${datos.yardas.plus ? ' plus' : ''}*`;
      case 'mix':
        return datos.mixesCotizacion
          ? `changed to the *${datos.mixesCotizacion.length} quotes: ${listaMixesCotizacion(datos.mixesCotizacion, 'en')}*`
          : `changed to the mix: *${datos.mix}*`;
      case 'aire':
        return `changed to: concrete *${aireDisplay(datos.aire, idioma)}*`;
      case 'pompa':
        if (datos.pompa === 'pendiente') return 'changed to: *pump needed*';
        return datos.pompa === 'Sin pompa'
          ? 'changed to: *no pump*'
          : `changed to the pump: *${datos.pompa}*`;
      case 'direccion':
        return `changed to the address: *${datos.direccion}*`;
      case 'fecha':
        return `changed to the day: *${datos.fecha}*`;
      case 'hora':
        return `changed to the time: *${datos.hora}*`;
      case 'nombre':
        return `changed to the name: *${datos.nombre}*`;
      case 'compania':
        return `changed to the company: *${datos.compania}*`;
      case 'pago':
        return `changed to the payment: *${pagoDisplay(datos.pago, idioma)}*`;
      case 'nota':
        return `updated: *${datos.nota}*`;
      default:
        return 'updated';
    }
  }
  switch (campo) {
    case 'yardas':
      return `lo dejo en *${datos.yardas.cantidad} yds${datos.yardas.plus ? ' plus' : ''}*`;
    case 'mix':
      return datos.mixesCotizacion
        ? `lo dejo en las *${datos.mixesCotizacion.length} cotizaciones: ${listaMixesCotizacion(datos.mixesCotizacion, 'es')}*`
        : `lo dejo en el mix: *${datos.mix}*`;
    case 'aire':
      return `lo dejo: concreto *${datos.aire}*`;
    case 'pompa':
      if (datos.pompa === 'pendiente') return 'lo dejo: *sí, ocupa pompa*';
      return datos.pompa === 'Sin pompa'
        ? 'lo dejo: *sin pompa*'
        : `lo dejo en la pompa: *${datos.pompa}*`;
    case 'direccion':
      return `lo dejo en la dirección: *${datos.direccion}*`;
    case 'fecha':
      return `lo dejo para el día: *${datos.fecha}*`;
    case 'hora':
      return `lo dejo a la hora: *${datos.hora}*`;
    case 'slump':
      return `lo dejo en el slump: *${datos.slump}*`;
    case 'nombre':
      return `lo dejo a nombre de: *${datos.nombre}*`;
    case 'compania':
      return datos.compania === 'Particular'
        ? 'lo dejo como *particular* (sin compañía)'
        : `lo dejo en la compañía: *${datos.compania}*`;
    case 'pago':
      return `lo dejo en el pago: *${datos.pago}*`;
    case 'nota':
      return `lo dejo anotado: *${datos.nota}*`;
    default:
      return 'lo dejo anotado';
  }
}

/**
 * Frases de saludo en los TRES registros (formal, informal y
 * coloquial), ordenadas de la más larga a la más corta para que
 * la frase completa gane sobre su prefijo («hola buenas» antes
 * que «hola», «que mas pues» antes que «que mas», «dimelo»
 * antes que «dime»). Incluye a propósito las cortas peligrosas
 * como SUBSTRING («epa», «alo», «dime», «ola»): aquí solo se
 * comparan como mensaje completo o como inicio con frontera de
 * palabra, nunca sueltas en medio del texto, así «está
 * separado» o «el valor» jamás cuentan como saludo.
 */
const FRASES_SALUDO = [
  'saludos cordiales',
  'good afternoon',
  'buenas noches', 'buenas tardes', 'buenas buenas',
  'good evening', 'good morning', 'que mas pues',
  'buenos dias', 'buenas dias', 'hola buenas',
  'que tranza', 'muy buenas',
  'hey there', 'que rollo',
  'buen dia', 'que show', 'que onda', 'que hubo', 'que paso',
  'dimelo', 'que tal', 'que mas', 'que hay', 'saludos',
  'quiubo', 'buenas',
  'hello', 'wenas', 'howdy',
  'hola', 'holi', 'dime',
  'hey', 'epa', 'alo', 'ola',
  'hi',
];

/**
 * ¿El mensaje es SOLO un saludo? («hola», «buenas», «hello»,
 * «buenas tardes», «hola buenas», «Dimelo»…). Cuando un cliente
 * retoma una conversación a mitad del flujo y escribe un saludo,
 * el bot debe RETOMAR donde iba (volver a preguntar el dato que
 * falta), nunca guardar el saludo como si fuera un dato (mix,
 * dirección, fecha o nombre) ni mandar la bienvenida de nuevo.
 */
function esSaludoPuro(texto) {
  const t = normalizar(texto)
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return false;
  const frases = FRASES_SALUDO;
  let resto = t;
  let consumio = false;
  let avance = true;
  while (resto && avance) {
    avance = false;
    for (const f of frases) {
      if (resto === f || resto.startsWith(f + ' ')) {
        resto = resto.slice(f.length).trim();
        consumio = true;
        avance = true;
        break;
      }
    }
  }
  return consumio && resto === '';
}

/**
 * ¿El mensaje EMPIEZA con un saludo? («buenas, ocupo cemento»,
 * «dimelo, necesito 10 yardas»…). El saludo debe coincidir como
 * frase completa al inicio, con frontera de palabra (la frase
 * seguida de un espacio o el mensaje entero): así «epa» no se
 * dispara con «epale…» ni «alo» con «alonso…». Se usa solo como
 * red de rescate cuando ningún intent fuerte reconoció el
 * mensaje: si el cliente escribió un pedido detectable, el
 * intent del pedido ya ganó antes y esto ni se evalúa.
 */
function empiezaConSaludo(texto) {
  const t = normalizar(texto)
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return false;
  return FRASES_SALUDO.some((f) => t === f || t.startsWith(f + ' '));
}

/**
 * ¿El cliente está preguntando el PRECIO? Para el dueño, el
 * «¿cuánto?» del cliente es el precio — EXCEPTO cuando pregunta
 * por la LLEGADA («¿en cuánto llega…?», «¿cuánto tarda…?»): eso
 * es estatus de entrega, no precio.
 */
function esPreguntaPrecio(texto) {
  const t = normalizar(texto);
  const precioExplicito =
    /\b(precio|precios|price|prices|costo|cost|tarifa|cuesta|cuestan|how much|charge|cuanto cuesta|cuanto sale|cuanto vale)\b/.test(t);
  if (precioExplicito) return true;
  const llegada =
    /\b(llega|llegan|llegue|llegada|viene|vienen|en camino|tarda|tardan|demora|demoran|dura|duran|tiempo)\b/.test(t);
  if (llegada) return false;
  if (/\bcuanto\b/.test(t)) return true;
  return false;
}

/** Respuesta corta sobre el precio: jamás se da un número. */
const LINEA_PRECIO =
  'El precio depende de la dirección del trabajo y del mix. Con los datos de su orden se lo confirmamos enseguida.';
const LINEA_PRECIO_EN =
  "Price depends on the job address and the mix. With your order details we'll confirm it right away.";

/**
 * ¿El cliente pregunta QUÉ ES el aire o para qué sirve? Mucha gente
 * no sabe: hay que explicarlo simple y volver a preguntar.
 * Devuelve 'es', 'en' o null.
 */
function preguntaSobreAire(texto) {
  const t = normalizar(texto);
  if (
    /\bwhat is (the )?air\b/.test(t) ||
    /\bwhat'?s air\b/.test(t) ||
    /\bwhat does air (do|mean)\b/.test(t)
  ) {
    return 'en';
  }
  if (
    /\b(que es|para que es|para que sirve|que significa|que quiere decir)\b[^.?!]*\baire\b/.test(t) ||
    /\baire\b[^.?!]*\b(que es|para que es|para que sirve)\b/.test(t)
  ) {
    return 'es';
  }
  // CONSEJO sobre el aire (falla real 2026-10-22): «¿mi garaje
  // necesitará aire? Es cerrado bajo techo» — el cliente está
  // PREGUNTANDO si su trabajo necesita aire, no respondiendo
  // «con aire»; antes la palabra «aire» se capturaba como el
  // dato y la pregunta quedaba sin responder. Solo cuenta en
  // forma de pregunta (con «?» o abriendo con el verbo), para
  // no robar respuestas-orden como «necesito el concreto con
  // aire».
  const esPregunta =
    /\?/.test(texto) ||
    /^(necesita|necesito|necesitara|necesitaria|requiere|does|do|should|will)\b/.test(t);
  if (
    esPregunta &&
    (/\b(necesita|necesito|necesitara|necesitaria|necesitan|requiere|requiero|lleva|debe|debo|conviene|hace falta|es necesario|es necesaria)\b[^.?!]*\baire\b/.test(t) ||
      /\b(mejor|recomendado|recomienda|recomiendas)\b[^.?!]*\baire\b/.test(t))
  ) {
    return 'es';
  }
  if (
    esPregunta &&
    (/\b(need|needs|needed|require|requires|should)\b[^.?!]*\bair\b/.test(t) ||
      /\bdoes\b[^.?!]*\b(need|require)\b[^.?!]*\bair\b/.test(t))
  ) {
    return 'en';
  }
  return null;
}

/** Explicación simple del aire en el concreto (sin tecnicismos ni precios). */
const EXPLICACION_AIRE_ES =
  'El aire en el concreto son unas burbujitas microscópicas que se agregan a la mezcla. ' +
  'Sirven para que el concreto aguante mejor el frío y los cambios de temperatura sin agrietarse; ' +
  'se usa sobre todo en trabajos de exterior como entradas, patios y banquetas. ' +
  'Para pisos de interior o acabados muy lisos, normalmente se pide sin aire, porque queda más fuerte y liso.';

const EXPLICACION_AIRE_EN =
  'Air in concrete is made of tiny microscopic bubbles that are added to the mix. ' +
  'They help the concrete hold up better against cold and temperature changes without cracking; ' +
  "it's used mostly for outdoor work like driveways, patios and sidewalks. " +
  "For indoor floors or very smooth finishes, it's normally ordered without air, because it comes out stronger and smoother.";

/**
 * Recomendación breve del aire según el trabajo que el cliente
 * describe al preguntar (misma guía simple de la explicación):
 * interior bajo techo → normalmente SIN aire; exterior → CON
 * aire. Devuelve null si el mensaje no deja claro el tipo de
 * trabajo (entonces solo va la explicación y la pregunta).
 */
function recomendacionAire(texto, idioma = 'es') {
  const t = normalizar(texto);
  const interior =
    /\b(bajo techo|interior|interiores|adentro|dentro|cerrado|cerrada|garaje|garage|cochera|indoor|inside|enclosed|under (a )?roof)\b/.test(t);
  const exterior =
    /\b(exterior|exteriores|afuera|fuera|patio|entrada|driveway|banqueta|banquetas|sidewalk|sidewalks|acera|outdoor|outside)\b/.test(t);
  if (interior && !exterior) {
    return idioma === 'en'
      ? "For indoor work under a roof like yours, it's normally ordered *without air*."
      : 'Para un trabajo de interior bajo techo como el suyo, lo normal es pedirlo *sin aire*.';
  }
  if (exterior && !interior) {
    return idioma === 'en'
      ? "For outdoor work like yours, it's normally ordered *with air*."
      : 'Para un trabajo de exterior como el suyo, lo normal es pedirlo *con aire*.';
  }
  return null;
}

/**
 * ¿El cliente pregunta CUÁNDO debe pedir el concreto? («quiero
 * hacerlo la semana que viene, ¿cuándo debo pedirlo?») — es una
 * PREGUNTA sobre el proceso, no la fecha de la orden: jamás se
 * guarda como el dato del día (falla real 2026-10-22, donde la
 * frase completa quedó anotada como la fecha).
 */
function preguntaCuandoPedir(texto) {
  const t = normalizar(texto);
  return (
    /\bcuando\b[^.?!]*\b(pedir|pido|pedirlo|pedirla|ordeno|ordenar|encargo|encargar|hacer el pedido|order)\b/.test(t) ||
    /\b(debo|tengo que|hay que|se debe)\b[^.?!]*\bpedir(lo|la)?\b/.test(t) ||
    /\bcon cuanto tiempo\b[^.?!]*\b(pedir|anticipacion|antes|anticipado)\b/.test(t) ||
    /\bcuanto tiempo antes\b/.test(t) ||
    /\bwhen\b[^.?!]*\b(should|do|can|must)\b[^.?!]*\border\b/.test(t) ||
    /\bhow (far )?in advance\b[^.?!]*\border\b/.test(t) ||
    /\bhow soon\b[^.?!]*\border\b/.test(t)
  );
}

/** Respuesta a «¿cuándo debo pedirlo?» (sin precios, regla del dueño). */
const LINEA_CUANDO_PEDIR_ES =
  'Puede pedirlo desde hoy mismo: en cuanto se confirma su pago por adelantado, su orden queda agendada para el día que usted elija.';
const LINEA_CUANDO_PEDIR_EN =
  'You can order starting today: as soon as your advance payment is confirmed, your order is scheduled for the day you choose.';

/**
 * ¿El cliente pregunta por el MOMENTO del pago? («¿pago el día
 * del trabajo o debo pagar antes?») — pregunta directa sobre la
 * regla del dueño (el pago es POR ADELANTADO): se responde
 * directo y el flujo retoma el paso en que iba; antes la
 * pregunta se ignoraba y el bot seguía con otra cosa (falla
 * real 2026-10-22).
 */
function preguntaPagoAdelantado(texto) {
  const t = normalizar(texto);
  return (
    /\bdebo pagar\b/.test(t) ||
    /\b(pago|pagar(?:lo|la|le|los|las)?|pagaria|se paga|hay que pagar|tengo que pagar|puedo pagar(?:lo|la|le)?)\b[^.?!]*\b(por adelantado|adelantado|anticipado|antes|el dia|ese dia|el mismo dia|al entregar|a la entrega|cuando lleguen|cuando entreguen|despues|al final)\b/.test(t) ||
    /\bcuando\b[^.?!]*\b(se paga|hay que pagar|pago|pagar(?:lo|la|le)?)\b/.test(t) ||
    /\bdo i pay\b/.test(t) ||
    /\bwhen do i pay\b/.test(t) ||
    /\bcan i pay\b/.test(t) ||
    /\bpay it\b[^.?!]*\b(before|in advance|upfront|on the day|that day)\b/.test(t) ||
    /\b(pay|payment)\b[^.?!]*\b(in advance|upfront)\b/.test(t) ||
    /\bin advance\b[^.?!]*\b(pay|payment)\b/.test(t)
  );
}

/**
 * Respuesta a la pregunta del momento del pago: es el mismo
 * texto del cierre aprobado por el dueño (ver resumenCliente y
 * la FAQ de pagos).
 */
const LINEA_PAGO_ADELANTADO_ES =
  'El pago es por adelantado: en cuanto se confirme su pago, cargamos su orden.';
const LINEA_PAGO_ADELANTADO_EN =
  'Payment is in advance: as soon as your payment is confirmed, we load your order.';

/**
 * La pregunta por el dato que falta, en el orden del dueño.
 * `conEjemplo` agrega un ejemplo concreto (se usa cuando el
 * cliente no atinó la respuesta: re-preguntar UNA vez con
 * ejemplos, en vez de repetir la misma pregunta en bucle).
 */
function preguntaPara(paso, datos, idioma = 'es', conEjemplo = false) {
  if (idioma === 'en') {
    switch (paso) {
      case 'yardas':
        return conEjemplo
          ? 'How many yards do you need? For example: 10 yards, or 10 yards plus if you might need a little more.'
          : 'How many yards do you need?';
      case 'mix':
        if ((datos.mix || datos.mixesCotizacion) && !datos.aire) {
          return conEjemplo
            ? 'Does the concrete need air or no air? Air helps against cold weather in outdoor work; indoor floors are usually ordered without air.'
            : 'And does the concrete need it with air or no air?';
        }
        if ((datos.mix || datos.mixesCotizacion) && datos.aire && !datos.pompa) {
          // Tras el aire se pregunta si va a ocupar alguna
          // pompa (regla del dueño, 2026-10-30): si dice que no,
          // la orden sigue; solo si dice que sí se le dan las
          // opciones de pompa.
          return 'Will you need a pump for this job?';
        }
        if ((datos.mix || datos.mixesCotizacion) && datos.aire && datos.pompa === 'pendiente') {
          return 'What kind of pump: boom pump or small line pump (trailer pump)?';
        }
        if (!datos.mix && !datos.mixesCotizacion && datos.aire) {
          return conEjemplo
            ? 'What mix or strength (PSI) do you need? For example: 3000 psi or 4000 psi.'
            : 'What mix or strength (PSI) do you need?';
        }
        return conEjemplo
          ? 'What mix or strength (PSI) do you need? For example: 3000 psi or 4000 psi. And does it need air or no air?'
          : 'What mix or strength (PSI) do you need? And does it need air or no air?';
      case 'direccion':
        return conEjemplo
          ? "What's the full address of the job site? For example: 4500 Main St, Dallas, TX."
          : "What's the full address of the job site?";
      case 'fecha':
        return datos.hora
          ? conEjemplo
            ? 'What day do you need it? For example: tomorrow, this Friday, or 10/25.'
            : 'What day do you need it?'
          : conEjemplo
            ? 'What day do you need it, and at what time at the job site? For example: tomorrow at 7 am.'
            : 'What day do you need it, and at what time at the job site?';
      case 'hora':
        return conEjemplo
          ? 'At what time do you need it at the job site? For example: 7 am or 10:30 am.'
          : 'At what time do you need it at the job site?';
      case 'nombre':
        return conEjemplo
          ? 'Almost done 🙏 Whose name should we put on the order? For example: John Smith.'
          : 'Almost done 🙏 Whose name should we put on the order?';
      case 'compania':
        return "And what's the name of your company? If you don't have one and it's personal, just let me know and we'll leave it that way.";
      case 'pago':
        return 'How will you pay: cash, debit card, credit card or Zelle?';
      default:
        return '';
    }
  }
  switch (paso) {
    case 'yardas':
      return conEjemplo
        ? '¿Cuántas yardas necesita? Por ejemplo: 10 yardas, o 10 yardas plus si puede necesitar un poco más.'
        : '¿Cuántas yardas necesita?';
    case 'mix':
      // Con el mix se pregunta también el aire («aire o no aire»);
      // si ya está uno de los dos, se pregunta solo el que falta.
      // El par de cotizaciones cuenta como mix dado: no se
      // vuelve a pedir que elija un mix (regla del dueño,
      // 2026-10-31 19:03).
      if ((datos.mix || datos.mixesCotizacion) && !datos.aire) {
        return conEjemplo
          ? '¿El concreto va con aire o no aire? El aire ayuda contra el frío en trabajos de exterior; para interiores suele pedirse sin aire.'
          : '¿Y el concreto va con aire o no aire?';
      }
      if ((datos.mix || datos.mixesCotizacion) && datos.aire && !datos.pompa) {
        // Tras el aire se pregunta si va a ocupar alguna pompa
        // (regla del dueño, 2026-10-30): si dice que no, la
        // orden sigue; solo si dice que sí se le dan las
        // opciones de pompa.
        return '¿Va a ocupar alguna pompa para este trabajo?';
      }
      if ((datos.mix || datos.mixesCotizacion) && datos.aire && datos.pompa === 'pendiente') {
        return '¿Qué pompa ocupa: boom pump o small line pump (trailer pump)?';
      }
      if (!datos.mix && !datos.mixesCotizacion && datos.aire) {
        return conEjemplo
          ? '¿Qué mix o resistencia (PSI) necesita? Por ejemplo: 3000 psi o 4000 psi.'
          : '¿Qué mix o resistencia (PSI) necesita?';
      }
      return conEjemplo
        ? '¿Qué mix o resistencia (PSI) necesita? Por ejemplo: 3000 psi o 4000 psi. ¿Y el concreto va con aire o no aire?'
        : '¿Qué mix o resistencia (PSI) necesita? ¿Y el concreto va con aire o no aire?';
    case 'direccion':
      return conEjemplo
        ? '¿Cuál es la dirección completa de la obra? Por ejemplo: 4500 Main St, Dallas, TX.'
        : '¿Cuál es la dirección completa de la obra?';
    case 'fecha':
      // Si ya dio la hora, solo falta el día; si no, se piden juntos,
      // que es como el dueño pregunta («la hora» = día y hora).
      return datos.hora
        ? conEjemplo
          ? '¿Para qué día lo necesita? Por ejemplo: mañana, este viernes o 10/25/26.'
          : '¿Para qué día lo necesita?'
        : conEjemplo
          ? '¿Para qué día lo necesita y a qué hora en la obra? Por ejemplo: mañana a las 7 am.'
          : '¿Para qué día lo necesita y a qué hora en la obra?';
    case 'hora':
      return conEjemplo
        ? '¿A qué hora lo necesita en la obra? Por ejemplo: 7 am o 10:30 am.'
        : '¿A qué hora lo necesita en la obra?';
    case 'nombre':
      // Nombre y compañía se piden UNO POR VEZ (orden del dueño):
      // primero solo el nombre…
      return conEjemplo
        ? 'Ya casi terminamos 🙏 ¿A nombre de quién queda la orden? Por ejemplo: Juan Pérez.'
        : 'Ya casi terminamos 🙏 ¿A nombre de quién queda la orden?';
    case 'compania':
      // …y en cuanto da el nombre, solo la compañía.
      return '¿Y cuál es el nombre de su compañía? Si no tiene compañía y es particular, dígamelo y así lo dejamos.';
    case 'pago':
      // Último dato: la forma de pago (sin pedir datos de cobro).
      // La pregunta ofrece SOLO estas opciones y en este orden
      // (palabra del dueño, 2026-10-31 19:51: «Después que
      // tengas toda la order lista vas a preguntar cómo vas a
      // pagar cash debit card credit card o zelle»): efectivo,
      // débito, crédito, Zelle. El CHEQUE no se ofrece en la
      // pregunta, pero sigue ACEPTADO si el cliente lo nombra
      // (se sumó el 2026-10-31; se le suman los taxes).
      return '¿Cómo va a pagar: efectivo, tarjeta de débito, tarjeta de crédito o Zelle?';
    default:
      return '';
  }
}

/** Fecha corta M/D/AA de la entrega, para la línea 1 de la confirmación. */
function fechaCortaEntrega(fechaTexto) {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: NEGOCIO.zonaHoraria,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const Y = +partes.find((p) => p.type === 'year').value;
  const M = +partes.find((p) => p.type === 'month').value;
  const D = +partes.find((p) => p.type === 'day').value;
  const base = Date.UTC(Y, M - 1, D);
  const fmt = (ms) => {
    const f = new Date(ms);
    return `${f.getUTCMonth() + 1}/${f.getUTCDate()}/${String(f.getUTCFullYear()).slice(2)}`;
  };
  const t = normalizar(fechaTexto || '');

  const mNum = t.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (mNum) {
    const yy = mNum[3]
      ? mNum[3].length === 4
        ? mNum[3].slice(2)
        : mNum[3]
      : String(Y).slice(2);
    return `${+mNum[1]}/${+mNum[2]}/${yy}`;
  }
  if (/pasado manana/.test(t)) return fmt(base + 2 * 86400000);
  if (/\bmanana\b/.test(t) || /\btomorrow\b/.test(t)) return fmt(base + 86400000);
  if (/\bhoy\b/.test(t) || /\btoday\b/.test(t)) return fmt(base);

  const dias = {
    domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6,
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  };
  for (const [nombreDia, num] of Object.entries(dias)) {
    if (new RegExp(`\\b${nombreDia}\\b`).test(t)) {
      const hoyDia = new Date(base).getUTCDay();
      return fmt(base + ((num - hoyDia + 7) % 7) * 86400000);
    }
  }
  const meses = {
    enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
    julio: 6, agosto: 7, septiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,
    january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
    july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  };
  const mMes = t.match(/(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)/);
  if (mMes) {
    let ms = Date.UTC(Y, meses[mMes[2]], +mMes[1]);
    if (ms < base) ms = Date.UTC(Y + 1, meses[mMes[2]], +mMes[1]);
    return fmt(ms);
  }
  const mMesEN = t.match(/(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})/);
  if (mMesEN) {
    let ms = Date.UTC(Y, meses[mMesEN[1]], +mMesEN[2]);
    if (ms < base) ms = Date.UTC(Y + 1, meses[mMesEN[1]], +mMesEN[2]);
    return fmt(ms);
  }
  return fmt(base); // no se pudo interpretar: se deja la fecha de hoy
}

/**
 * PRECIOS DE LOS MIXES (dictados por el dueño, 2026-10-31
 * 15:36–15:42, por yarda, SOLO DALLAS): Jesus los dictó para
 * que el bot cotice — «los precios tú ya los tienes de los
 * mixes» (2026-10-31 19:22). El SERVICIO de pompa (boom /
 * small line-trailer) sigue SIN precio definido (0 a
 * propósito): una orden que ocupa el servicio cierra sin
 * total y el equipo lo confirma.
 */
const PRECIOS_MIX = {
  '3000 psi': 160,
  '3500 psi': 165,
  '3600 psi': 170,
  '4000 psi': 170,
  '4500 psi': 175,
  '5000 psi': 180,
};
const PRECIOS_POMPA_SERVICIO = {
  'Boom pump': 0,
  'Small line / Trailer pump': 0,
};
/** Taxes de Texas que lleva TODO cálculo (regla del dueño, 2026-10-31 18:17). */
const IMPUESTOS_PCT = 8.25;

function formatearDinero(n) {
  return Number(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * ¿La dirección del trabajo es en DALLAS? La tabla de precios
 * es SOLO para Dallas (orden del dueño, 2026-10-31 15:38):
 * solo cuenta la ciudad «Dallas» exacta («Lake Dallas» es
 * otra ciudad); si la ciudad no se puede determinar, NO es
 * Dallas a efectos del total.
 */
function direccionEsDallas(direccion) {
  if (!direccion) return false;
  return detectarCiudad(direccion) === 'Dallas';
}

/**
 * TOTAL de la orden para UN mix dado, con la tabla de precios
 * y los taxes del 8.25% incluidos. Devuelve null (sin total:
 * el equipo lo confirma) si la dirección no es de Dallas, si
 * el mix no tiene precio en la tabla (productos sin PSI,
 * «Pompa mix 50-50» sin base) o si la orden ocupa un servicio
 * de pompa aún sin precio definido.
 */
function calcularTotalParaMix(datos, mix) {
  if (!datos || !datos.yardas || !mix) return null;
  if (!direccionEsDallas(datos.direccion)) return null;
  const yardas = parseFloat(String(datos.yardas.cantidad).replace(',', '.'));
  if (!isFinite(yardas) || yardas <= 0) return null;
  if (mix === 'Pompa mix 50-50') return null;
  const precioYarda = PRECIOS_MIX[mix];
  if (!(precioYarda > 0)) return null;
  let total = yardas * precioYarda;
  if (datos.pompa && datos.pompa !== 'Sin pompa' && datos.pompa !== 'pendiente') {
    const precioPompa = PRECIOS_POMPA_SERVICIO[datos.pompa];
    if (!(precioPompa > 0)) return null;
    total += precioPompa;
  }
  total *= 1 + IMPUESTOS_PCT / 100;
  return Math.round(total * 100) / 100;
}

/**
 * Totales de la orden: { uno: total } si hay un solo mix, o
 * { par: [{mix, total}…] } si la orden lleva las cotizaciones
 * (2+ mixes, mismo todo — ronda 10). Null si algún total no
 * se puede calcular: no se muestra ninguno a medias.
 */
function totalesCotizacion(datos) {
  if (datos.mixesCotizacion && datos.mixesCotizacion.length) {
    const par = datos.mixesCotizacion.map((mix) => ({ mix, total: calcularTotalParaMix(datos, mix) }));
    if (par.some((p) => p.total === null)) return null;
    return { par };
  }
  const total = calcularTotalParaMix(datos, datos.mix);
  return total === null ? null : { uno: total };
}

/** Bloque de precios para el resumen al cliente (null si no hay total). */
function bloquePreciosResumen(datos, idioma = 'es') {
  const tot = totalesCotizacion(datos);
  if (!tot) return null;
  if (idioma === 'en') {
    if (tot.par) {
      return (
        '💰 *Your quote prices (8.25% taxes included):*\n' +
        tot.par.map((p) => `• ${p.mix}: $${formatearDinero(p.total)}`).join('\n')
      );
    }
    return `💰 *Total: $${formatearDinero(tot.uno)}* (includes 8.25% taxes)`;
  }
  if (tot.par) {
    return (
      '💰 *Precios de sus cotizaciones (incluyen los taxes del 8.25%):*\n' +
      tot.par.map((p) => `• ${p.mix}: $${formatearDinero(p.total)}`).join('\n')
    );
  }
  return `💰 *Total: $${formatearDinero(tot.uno)}* (incluye los taxes del 8.25%)`;
}

/**
 * Arma el texto de CONFIRMACIÓN PARA EL CLIENTE con el formato exacto
 * del dueño (texto plano, una línea por dato, en este orden):
 *   {fecha M/D/AA} {nombre de la orden}{ / compañía, si la dio}
 *   {cantidad} yds{ plus si aplica}
 *   {mix tal como lo dio el cliente}{ con aire|no aire}
 *   {dirección completa}
 *   {hora} jobsite
 *   Slump {slump}{ (inspection) si pidió inspección}
 *   Order number
 *   Pago: {forma de pago que eligió el cliente}
 * La línea de la planta se OMITE siempre (regla del dueño: el cliente
 * directo no debe saber de dónde carga el concreto) y la línea
 * «Order number» va sin número: Jesus lo completa a mano al apartar
 * en la planta, antes de enviarle esta confirmación al cliente.
 * El bot NO la envía solo: la deja guardada en la conversación.
 */
function armarConfirmacion(datos, conversacion) {
  // Primera línea: fecha + nombre de la orden + compañía. El nombre
  // manda el que el cliente dio para la orden (paso final del flujo);
  // si no lo dio, se cae al nombre de WhatsApp, como antes.
  const nombreCliente =
    datos.nombre ||
    (conversacion.name && conversacion.name !== conversacion.waId
      ? conversacion.name
      : conversacion.waId);
  const lineas = [
    `${fechaCortaEntrega(datos.fecha)} ${nombreCliente}${datos.compania ? ` / ${datos.compania}` : ''}`,
    `${datos.yardas.cantidad} yds${datos.yardas.plus ? ' plus' : ''}`,
    `${mixVisible(datos, 'es')}${datos.aire ? ` ${datos.aire}` : ''}${datos.pompa && datos.pompa !== 'pendiente' ? ` (${datos.pompa})` : ''}`,
    `${datos.direccion}`,
    `${datos.hora} jobsite`,
    `Slump${datos.slump ? ` ${datos.slump}` : ''}${datos.inspeccion ? ' (inspection)' : ''}`,
    'Order number',
  ];
  // Al final va la forma de pago que eligió el cliente (línea
  // nueva; las líneas del formato del dueño no cambian).
  if (datos.pago) lineas.push(`Pago: ${datos.pago}`);
  // TOTAL(ES) de la orden con la tabla de precios del dueño
  // (ronda 11, 2026-10-31 19:22): con las cotizaciones va un
  // total por mix; si ningún total se puede calcular, la
  // orden va SIN línea de total — jamás un total inventado.
  const totArmada = totalesCotizacion(datos);
  if (totArmada) {
    if (totArmada.par) {
      for (const p of totArmada.par) lineas.push(`Total ${p.mix}: $${formatearDinero(p.total)}`);
    } else {
      lineas.push(`Total: $${formatearDinero(totArmada.uno)}`);
    }
  }
  // Fuera de Dallas (o ciudad no determinable) no hay total
  // con la tabla: la orden lo dice claro para el dueño.
  if (!direccionEsDallas(datos.direccion)) {
    lineas.push('⚠ Fuera de Dallas: el precio lo confirma Jesus');
  }
  // Nota del cliente (ej. el reparto de la tirada en varios
  // días, «tirar en 2 días, 50 y 50»): va al final de la orden
  // para que el dueño la vea tal como el cliente la pidió.
  if (datos.nota) {
    lineas.push(`Nota: ${datos.nota}`);
  }
  return lineas.join('\n');
}

/** Cierre corto al cliente cuando el flujo queda completo. */
function resumenCliente(datos, nombre, idioma = 'es') {
  const n = nombre && nombre !== '' ? ` ${nombre}` : '';
  // Precios de la orden (ronda 11): si la tabla permite el
  // total, el resumen lo trae (ya no se dice «le confirmamos
  // el precio» cuando el precio YA va en la orden).
  const bloquePrecios = bloquePreciosResumen(datos, idioma);
  if (idioma === 'en') {
    return (
      `All set${n}! ✅ Your order is registered:\n` +
      `• ${datos.yardas.cantidad} yds${datos.yardas.plus ? ' plus' : ''}\n` +
      `• Mix: ${mixVisible(datos, 'en')}${datos.aire ? `, ${aireDisplay(datos.aire, idioma)}` : ''}\n` +
      (datos.pompa && datos.pompa !== 'Sin pompa' && datos.pompa !== 'pendiente' ? `• Pump: ${datos.pompa}\n` : '') +
      `• Address: ${datos.direccion}\n` +
      `• Day: ${datos.fecha} — ${datos.hora}\n` +
      (datos.pago ? `• Payment: ${pagoDisplay(datos.pago, idioma)}\n` : '') +
      (bloquePrecios
        ? `\n${bloquePrecios}\n` + `A specialist will help you right here. 🙏\n`
        : `\nWe'll confirm price and availability right away. ` +
          `A specialist will help you right here. 🙏\n`) +
      // Same rule as in Spanish: payment is IN ADVANCE, said once.
      (esPagoEfectivo(datos.pago)
        ? ''
        : `Payment is in advance: as soon as your payment is confirmed, we load your order. 🚛`) +
      // Nota del método (crédito/cheque/Zelle), si aplica.
      (notaMetodoPago(datos.pago, 'en') ? `\n${notaMetodoPago(datos.pago, 'en')}` : '')
    );
  }
  return (
    `¡Listo${n}! ✅ Ya quedó registrada su orden:\n` +
    `• ${datos.yardas.cantidad} yds${datos.yardas.plus ? ' plus' : ''}\n` +
    `• Mix: ${mixVisible(datos, 'es')}${datos.aire ? `, ${datos.aire}` : ''}\n` +
    (datos.pompa && datos.pompa !== 'Sin pompa' && datos.pompa !== 'pendiente' ? `• Pompa: ${datos.pompa}\n` : '') +
    `• Dirección: ${datos.direccion}\n` +
    `• Día: ${datos.fecha} — ${datos.hora}\n` +
    (datos.pago ? `• Pago: ${datos.pago}\n` : '') +
    (bloquePrecios
      ? `\n${bloquePrecios}\n` + `Un especialista le atiende por aquí mismo. 🙏\n`
      : `\nLe confirmamos precio y disponibilidad en seguida. ` +
        `Un especialista le atiende por aquí mismo. 🙏\n`) +
    // Regla del dueño: el pago es POR ADELANTADO. Se avisa UNA
    // sola vez, aquí en el cierre (no en la pregunta del pago);
    // el bot todavía no pide ni envía datos de cobro.
    (esPagoEfectivo(datos.pago)
      ? ''
      : `El pago es por adelantado: en cuanto se confirme su pago, cargamos su orden. 🚛`) +
    // Nota del método (crédito: recargo 4%; cheque: taxes
    // 8.25%; Zelle: enviarlo antes de cargar, al correo de JMP).
    (notaMetodoPago(datos.pago, 'es') ? `\n${notaMetodoPago(datos.pago, 'es')}` : '')
  );
}

/**
 * Cierre cuando la orden YA se le mostró al cliente (ronda 11:
 * la orden va primero y la pregunta del pago después): al
 * responder el método no se repite toda la orden; se confirma
 * el pago con su nota (crédito 4% / cheque taxes / Zelle antes
 * de cargar) y la regla del pago por adelantado. La orden
 * completa, con «Pago:» y totales, queda en la confirmación
 * armada para el dueño.
 */
function textoCierreTrasOrden(datos, nombre, idioma = 'es') {
  const n = nombre && nombre !== '' ? ` ${nombre}` : '';
  if (idioma === 'en') {
    return (
      `All set${n}! ✅ Your order is registered with payment by *${pagoDisplay(datos.pago, 'en')}*.` +
      (notaMetodoPago(datos.pago, 'en') ? `\n${notaMetodoPago(datos.pago, 'en')}` : '') +
      (esPagoEfectivo(datos.pago)
        ? ''
        : `\nPayment is in advance: as soon as your payment is confirmed, we load your order. 🚛`) +
      `\nA specialist will help you right here. 🙏`
    );
  }
  return (
    `¡Listo${n}! ✅ Ya quedó registrada su orden con pago en *${datos.pago}*.` +
    (notaMetodoPago(datos.pago, 'es') ? `\n${notaMetodoPago(datos.pago, 'es')}` : '') +
    (esPagoEfectivo(datos.pago)
      ? ''
      : `\nEl pago es por adelantado: en cuanto se confirme su pago, cargamos su orden. 🚛`) +
    `\nUn especialista le atiende por aquí mismo. 🙏`
  );
}

/**
 * Avanza el flujo con un mensaje del cliente.
 * `esNuevo` = el flujo se acaba de abrir con este mensaje.
 * Devuelve la decisión de respuesta (mismo formato que decidirRespuesta),
 * con `confirmacionArmada` cuando el flujo se completa.
 */
/** Lista oficial de mixes por PSI que existen (regla del dueño,
 * 2026-10-30): la misma que valida extraerDatos en la captura;
 * aquí a nivel de módulo para la guarda invariante de
 * manejarFlujo. La POMPA MIX 50-50 va aparte (no es un psi). */
const MIXES_PSI_VALIDOS = new Set([3000, 3500, 3600, 4000, 4500, 5000]);

/** Prefijos de continuación: se rotan para no repetir el mismo en cada turno. */
function prefijoContinuacion(flow, idioma) {
  const turno = flow.turnos || 0;
  if (idioma === 'en') {
    const vars =
      flow.tipo === 'pedido'
        ? ["Let's keep going with your order", 'Continuing with your order', "Let's continue with your order"]
        : ["Let's keep going with your quote", 'Continuing with your quote', "Let's continue with your quote"];
    return vars[turno % vars.length];
  }
  const vars =
    flow.tipo === 'pedido'
      ? ['Sigamos con su pedido', 'Continuamos con su pedido', 'Seguimos con su pedido', 'Vamos con su pedido']
      : ['Sigamos con su cotización', 'Continuamos con su cotización', 'Seguimos con su cotización', 'Vamos con su cotización'];
  return vars[turno % vars.length];
}

/**
 * Texto anti-bucle: tras 2 intentos fallidos en el mismo paso, el
 * bot cambia la redacción, pregunta CON EJEMPLO y ofrece pasar
 * con un especialista (antes repetía la misma pregunta para
 * siempre y el cliente quedaba atrapado).
 */
function textoEscalado(paso, datos, idioma) {
  const ejemplo = preguntaPara(paso, datos, idioma, true);
  return idioma === 'en'
    ? `Sorry for the back-and-forth 🙏 Let me ask with an example: ${ejemplo}\nOr if you prefer, type *specialist* and a person will help you right away.`
    : `Disculpe la vuelta 🙏 Mejor se lo pregunto con un ejemplo: ${ejemplo}\nO si prefiere, escriba *especialista* y le atiende una persona enseguida.`;
}

/**
 * Minutos desde medianoche de una hora ya capturada («7 am»,
 * «7:00 pm», «7 de la tarde», «7 de la mañana», «19:00», «7»),
 * o null si no se puede interpretar.
 */
function horaAMinutos(texto) {
  if (!texto) return null;
  const t = String(texto).toLowerCase();
  const m = /(\d{1,2})(?::(\d{2}))?/.exec(t);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  if (min > 59) return null;
  const esPm =
    /\bp\.?\s?m\.?\b/.test(t) || /\b(tarde|noche|afternoon|evening|night)\b/.test(t);
  const esAm =
    /\ba\.?\s?m\.?\b/.test(t) || /\b(mañana|manana|morning)\b/.test(t);
  if (esPm) {
    if (h < 12) h += 12;
  } else if (esAm) {
    if (h === 12) h = 0;
  } else if (h > 23) return null;
  return h * 60 + min;
}

/** ¿La hora guardada es un número suelto 1-12 sin calificador («7», «7:00», «12»)? */
function esHoraSueltaAmbigua(texto) {
  const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(String(texto || '').trim());
  if (!m) return false;
  const h = parseInt(m[1], 10);
  return h >= 1 && h <= 12;
}

/**
 * Interpreta la respuesta a la pregunta «¿Esa hora es am o pm?»:
 * 'am', 'pm' o null. «mañana» aquí es LA MAÑANA (la parte del
 * día), no el día de mañana — por eso esta interpretación corre
 * ANTES de la captura normal, que guardaría «mañana» como fecha.
 */
function interpretarAmPm(texto) {
  const t = ` ${normalizar(texto)} `;
  const pm = /\bp\.?\s?m\.?\b/.test(t) || /\b(tarde|noche|afternoon|evening|night)\b/.test(t);
  const am = /\ba\.?\s?m\.?\b/.test(t) || /\b(manana|morning)\b/.test(t);
  if (pm && !am) return 'pm';
  if (am && !pm) return 'am';
  return null;
}

function textoPreguntaAmPm(idioma) {
  return idioma === 'en' ? 'Is that time *am* or *pm*?' : '¿Esa hora es *am* o *pm*?';
}

/**
 * Oferta cuando la hora pedida cae con la planta cerrada
 * (regla del dueño, 2026-10-31): no se rechaza al cliente, se
 * le busca una opción — las 7 am del día siguiente.
 */
function textoPlantaCerrada7am(idioma) {
  return idioma === 'en'
    ? 'The plant is already closed at that time 🏭 I can place it at *7 am the next day*. Does that work for you?'
    : 'A esa hora la planta ya está cerrada 🏭 Se la puedo colocar a las *7 am del día siguiente*. ¿Le sirve?';
}

function textoPreguntaRangoYardas(rango, idioma) {
  return idioma === 'en'
    ? `Is it *${rango.bajo}* or *${rango.alto}* yards?`
    : `¿Son *${rango.bajo}* o *${rango.alto}* yardas?`;
}

/**
 * ACLARACIÓN DEL RANGO DE YARDAS (regla del dueño, 2026-10-31
 * 17:33): el cliente dio un rango («90-100 yardas») y ya se
 * anotó el número MENOR; el bot preguntó «¿Son 90 o son 100
 * yardas?». Aquí se interpreta la respuesta: un número suelto
 * (el que sea) queda como la cantidad; «la mayor» sube al
 * alto; «la menor» confirma el bajo. Cualquier otra cosa (el
 * cliente siguió con otro dato) NO es respuesta al rango: se
 * deja el número menor anotado y el flujo normal procesa el
 * mensaje (null).
 */
function manejarRangoYardas(conversacion, textoCliente, idioma, intentDetectado) {
  const flow = conversacion.flow;
  const rango = flow.rangoYardasPendiente;
  if (!rango) return null;
  const guardar = () => {
    db.setConversationFlow(conversacion.id, flow);
    conversacion.flow = flow;
  };
  const decision = (texto) => ({
    responder: true,
    texto,
    intent: flow.tipo,
    topic: flow.tipo === 'pedido' ? 'su pedido' : 'su cotización',
    intentDetectado,
  });
  const confirmarYSiguiente = () => {
    const paso = pasoActual(flow);
    const conf = `Perfecto, ${confirmacionDe('yardas', flow.datos, idioma)}.`;
    if (paso === 'pago' && !flow.ordenMostrada) {
      // Ronda 11: al completarse la orden, va primero la orden
      // (con precios) y después la pregunta del pago.
      flow.ordenMostrada = true;
      guardar();
      return decision(
        `${conf}\n${resumenCliente(flow.datos, flow.datos.nombre || conversacion.name, idioma)}\n${preguntaPara('pago', flow.datos, idioma)}`
      );
    }
    guardar();
    return decision(paso ? `${conf}\n${preguntaPara(paso, flow.datos, idioma)}` : conf);
  };
  const t = ` ${normalizar(textoCliente)} `;
  if (/\b(mayor|mas alta|la alta|maximo|mas grande)\b/.test(t)) {
    flow.datos.yardas = { ...(flow.datos.yardas || { plus: false }), cantidad: rango.alto };
    flow.rangoYardasPendiente = null;
    return confirmarYSiguiente();
  }
  if (/\b(menor|mas baja|la baja|minimo|mas pequena)\b/.test(t)) {
    flow.rangoYardasPendiente = null;
    return confirmarYSiguiente();
  }
  const mSolo = textoCliente
    .trim()
    .replace(/[. ]+$/, '')
    .match(/^(?:las?\s+)?(\d+(?:[.,]\d+)?)\s*(?:yardas?|yds?|yards?)?$/i);
  if (mSolo) {
    flow.datos.yardas = {
      ...(flow.datos.yardas || { plus: false }),
      cantidad: mSolo[1].replace(',', '.'),
    };
    flow.rangoYardasPendiente = null;
    return confirmarYSiguiente();
  }
  // No fue respuesta al rango: queda el número menor y el
  // mensaje se procesa como dato normal del flujo.
  flow.rangoYardasPendiente = null;
  guardar();
  return null;
}

/**
 * ACLARACIÓN DE LA HORA (regla del dueño, 2026-10-31 17:27):
 * si el cliente da una hora 1-12 sin decir am o pm, el bot
 * PREGUNTA «¿am o pm?» en vez de guardarla a ciegas. Si la
 * respuesta cae después de las 5:00 pm, la planta ya está
 * cerrada: se le ofrece tirarla a las 7 am del día siguiente
 * («buscándole opciones al cliente») y, si acepta, la orden
 * queda a las 7 am con la nota de lo pedido. Devuelve la
 * decisión ya armada, o null si el mensaje no es respuesta a
 * la aclaración (trae otra hora, una pregunta de precio…) y el
 * flujo normal debe procesarlo.
 */
function manejarAclaracionHora(conversacion, textoCliente, idioma, intentDetectado) {
  const flow = conversacion.flow;
  const guardar = () => {
    db.setConversationFlow(conversacion.id, flow);
    conversacion.flow = flow;
  };
  const decision = (texto) => ({
    responder: true,
    texto,
    intent: flow.tipo,
    topic: flow.tipo === 'pedido' ? 'su pedido' : 'su cotización',
    intentDetectado,
  });
  const confirmarHoraYSiguiente = () => {
    const paso = pasoActual(flow);
    const conf = `Perfecto, ${confirmacionDe('hora', flow.datos, idioma)}.`;
    if (paso === 'pago' && !flow.ordenMostrada) {
      // Ronda 11: al completarse la orden, va primero la orden
      // (con precios) y después la pregunta del pago.
      flow.ordenMostrada = true;
      guardar();
      return decision(
        `${conf}\n${resumenCliente(flow.datos, flow.datos.nombre || conversacion.name, idioma)}\n${preguntaPara('pago', flow.datos, idioma)}`
      );
    }
    guardar();
    return decision(paso ? `${conf}\n${preguntaPara(paso, flow.datos, idioma)}` : conf);
  };

  if (flow.esperaAceptacion7am) {
    const oferta = flow.esperaAceptacion7am;
    // Si trae OTRA hora completa, manda esa: se procesa normal.
    if (extraerDatos(textoCliente, 'hora').hora) {
      flow.esperaAceptacion7am = null;
      guardar();
      return null;
    }
    const t = ` ${normalizar(textoCliente)} `;
    if (/\b(si|ok|dale|claro|sale|bueno|perfecto|yes|yeah|me sirve|esta bien|de acuerdo)\b/.test(t)) {
      flow.esperaAceptacion7am = null;
      flow.datos.hora = '7 am';
      const notaNueva =
        idioma === 'en'
          ? `Asked for ${oferta.original} (plant closed); accepted 7 am the next day`
          : `Pidió ${oferta.original} (planta cerrada); aceptó 7 am del día siguiente`;
      flow.datos.nota = flow.datos.nota ? `${flow.datos.nota}; ${notaNueva}` : notaNueva;
      return confirmarHoraYSiguiente();
    }
    if (/^\s*no\b/i.test(textoCliente) || /\bno me sirve\b/.test(t)) {
      flow.esperaAceptacion7am = null;
      guardar();
      return decision(preguntaPara('hora', flow.datos, idioma, true));
    }
    if (esPreguntaPrecio(textoCliente) || detectarFAQ(textoCliente)) {
      guardar();
      return null;
    }
    guardar();
    return decision(textoPlantaCerrada7am(idioma));
  }

  if (flow.horaPendiente) {
    const base = flow.horaPendiente;
    // Si trae OTRA hora completa («mejor a las 8 am»), manda esa.
    if (extraerDatos(textoCliente, pasoActual(flow)).hora) {
      flow.horaPendiente = null;
      guardar();
      return null;
    }
    const resp = interpretarAmPm(textoCliente);
    if (resp === 'am') {
      flow.horaPendiente = null;
      flow.datos.hora = `${base} am`;
      return confirmarHoraYSiguiente();
    }
    if (resp === 'pm') {
      const horaTexto = `${base} pm`;
      const mins = horaAMinutos(horaTexto);
      flow.horaPendiente = null;
      if (mins !== null && mins > 17 * 60) {
        // Después de las 5:00 pm la planta está cerrada: se
        // ofrece la opción de las 7 am del día siguiente.
        flow.esperaAceptacion7am = { original: horaTexto };
        guardar();
        return decision(textoPlantaCerrada7am(idioma));
      }
      flow.datos.hora = horaTexto;
      return confirmarHoraYSiguiente();
    }
    if (esPreguntaPrecio(textoCliente) || detectarFAQ(textoCliente)) {
      guardar();
      return null;
    }
    guardar();
    return decision(textoPreguntaAmPm(idioma));
  }
  return null;
}

function manejarFlujo(conversacion, textoCliente, esNuevo, intentDetectado) {
  const flow = conversacion.flow;
  if (!flow.idioma) flow.idioma = detectarIdioma(textoCliente);
  const idioma = flow.idioma;
  flow.turnos = (flow.turnos || 0) + 1;
  const pasoPedido = pasoActual(flow);

  // ACLARACIÓN DEL RANGO DE YARDAS en curso («¿son 90 o son
  // 100?»): un número suelto como respuesta es la cantidad
  // elegida, jamás otro dato del flujo.
  if (flow.rangoYardasPendiente) {
    const rRango = manejarRangoYardas(conversacion, textoCliente, idioma, intentDetectado);
    if (rRango) return rRango;
  }

  // ACLARACIÓN DE LA HORA en curso (¿am o pm? / oferta de las
  // 7 am del día siguiente): la respuesta del cliente se
  // interpreta ANTES de la captura normal — un «mañana» como
  // respuesta a «¿am o pm?» es la mañana, jamás la fecha.
  if (flow.horaPendiente || flow.esperaAceptacion7am) {
    const rAclaracion = manejarAclaracionHora(conversacion, textoCliente, idioma, intentDetectado);
    if (rAclaracion) return rAclaracion;
  }

  // Mensajes que NO son un dato del paso actual: saludo puro
  // (retoma), pregunta frecuente, pregunta de cobertura por
  // ciudad, o «no sé cuántas yardas» sin medidas. Esos textos
  // jamás se guardan como mix, dirección, fecha ni nombre.
  const saludoPuro = esSaludoPuro(textoCliente);
  const faq = saludoPuro ? null : detectarFAQ(textoCliente);
  const ciudad = !saludoPuro && !faq ? preguntaCoberturaCiudad(textoCliente) : null;
  const noSabe = pasoPedido === 'yardas' && !saludoPuro && esNoSabeYardas(textoCliente);
  // REGLA GENERAL (2026-10-22): si el mensaje del cliente en un
  // paso es una PREGUNTA (cobertura, cuándo pedir, momento del
  // pago, consejo del aire), el bot la RESPONDE breve y simple y
  // después retoma la pregunta del paso actual. Un campo del
  // flujo solo se llena con una RESPUESTA del cliente, nunca
  // con una pregunta suya.
  const cuandoPedir = !saludoPuro && !faq && !ciudad ? preguntaCuandoPedir(textoCliente) : null;
  const pagoAdelantado = !saludoPuro && !faq ? preguntaPagoAdelantado(textoCliente) : null;

  let detectados = {};
  let omitirCaptura = saludoPuro || !!faq || !!ciudad;
  if (!omitirCaptura) {
    detectados = extraerDatos(textoCliente, pasoPedido);
    if (noSabe && !detectados.medidas) {
      // «No sé cuántas yardas» sin medidas: no es un dato; la
      // respuesta ofrece el cálculo por medidas.
      detectados = {};
      omitirCaptura = true;
    }
  }
  // PREGUNTA DE CUÁNDO PEDIR sin día concreto en el mensaje:
  // no se captura NADA de ella (la frase completa no es la
  // fecha); se responde la pregunta y el flujo vuelve a pedir
  // el día concreto. Si el mensaje SÍ trae un día u hora, ese
  // dato se captura y la respuesta a la pregunta se agrega.
  const preguntaPedido = !!cuandoPedir && !detectados.fecha && !detectados.hora;
  if (preguntaPedido) {
    detectados = {};
    omitirCaptura = true;
  }
  const { aplicados: nuevos, corregidos } = omitirCaptura
    ? { aplicados: [], corregidos: [] }
    : fusionarDatos(flow, detectados);

  // INVARIANTE DE MIXES (red de seguridad permanente, 2026-10-31):
  // ningún psi fuera de la lista oficial {3000, 3500, 3600, 4000,
  // 4500, 5000} puede quedar guardado como mix — ni por una ruta
  // de captura presente o futura, ni por ESTADO VIEJO guardado de
  // versiones anteriores del bot (caso real: un flujo guardado con
  // «4300 psi» por una versión sin validación se reanudó días
  // después y la orden cerró con ese mix). Si un psi inválido
  // aparece en flow.datos.mix, se anula aquí mismo, el turno se
  // trata como psi inválido (la respuesta lleva la redacción
  // oficial de mix no disponible) y el paso del mix queda abierto:
  // una orden JAMÁS cierra con un mix que no existe. La POMPA MIX
  // 50-50 y los productos sin psi no coinciden con el patrón
  // «número + psi» y no se tocan.
  {
    const mGuard = /^(\d{3,5})\s*psi$/i.exec(String(flow.datos.mix || '').trim());
    if (mGuard && !MIXES_PSI_VALIDOS.has(parseInt(mGuard[1], 10))) {
      flow.datos.mix = null;
      if (!detectados.psiInvalido) detectados.psiInvalido = mGuard[1];
      const ixC = corregidos.indexOf('mix');
      if (ixC >= 0) corregidos.splice(ixC, 1);
      const ixN = nuevos.indexOf('mix');
      if (ixN >= 0) nuevos.splice(ixN, 1);
    }
  }

  // INVARIANTE DE FECHA (misma red, 2026-10-31 18:03): la
  // orden de una prueba de Jesus cerró con «Día: No pump» —
  // un «No pump» guardado como día por una versión anterior
  // del bot (antes del arreglo de la ronda 3) quedó en el
  // estado guardado y se reanudó sin validación, igual que el
  // mix 4300. Si la fecha guardada no parece una fecha
  // (pareceFechaTexto), se anula aquí mismo y el paso del día
  // vuelve a quedar abierto: una orden JAMÁS cierra con un
  // «día» que no es un día.
  if (flow.datos.fecha && !pareceFechaTexto(flow.datos.fecha)) {
    flow.datos.fecha = null;
    const ixCF = corregidos.indexOf('fecha');
    if (ixCF >= 0) corregidos.splice(ixCF, 1);
    const ixNF = nuevos.indexOf('fecha');
    if (ixNF >= 0) nuevos.splice(ixNF, 1);
  }

  // HORA AMBIGUA Y HORA CON LA PLANTA CERRADA (regla del
  // dueño, 2026-10-31 17:27): cuando el cliente responde a la
  // pregunta del día/hora (pasos 'fecha' u 'hora') con una hora
  // 1-12 SIN decir am o pm («7», «a las 7»), NO se guarda a
  // ciegas: se deja pendiente y el bot pregunta «¿Esa hora es
  // am o pm?». Y si la hora recién anotada cae DESPUÉS de las
  // 5:00 pm («8 pm», «7 de la noche»), la planta ya está
  // cerrada: no se anota y se le ofrece al cliente tirarla a
  // las 7 am del día siguiente. Solo en la etapa día/hora: un
  // volcado de datos en otro paso (ej. «mañana a las 7:00 pm»
  // junto con la dirección) se anota tal cual, como siempre.
  let preguntaAmPm = false;
  let oferta7am = false;
  if (
    !omitirCaptura && detectados.hora && flow.datos.hora === detectados.hora &&
    (pasoPedido === 'hora' || pasoPedido === 'fecha')
  ) {
    const hTxt = String(detectados.hora).trim();
    const quitarHoraDeListas = () => {
      for (const lista of [nuevos, corregidos]) {
        const ix = lista.indexOf('hora');
        if (ix >= 0) lista.splice(ix, 1);
      }
    };
    if (esHoraSueltaAmbigua(hTxt)) {
      flow.datos.hora = null;
      quitarHoraDeListas();
      flow.horaPendiente = hTxt;
      preguntaAmPm = true;
    } else {
      const mins = horaAMinutos(hTxt);
      if (mins !== null && mins > 17 * 60) {
        flow.datos.hora = null;
        quitarHoraDeListas();
        flow.esperaAceptacion7am = { original: hTxt };
        oferta7am = true;
      }
    }
  }

  // RANGO DE YARDAS recién anotado (regla del dueño,
  // 2026-10-31 17:33): la cantidad ya quedó en el número MENOR
  // (eso lo hizo extraerDatos); aquí se deja la pregunta
  // «¿Son X o Y yardas?» como la pregunta de este turno. Si el
  // flujo se completa en este mismo turno, no hay pregunta:
  // manda el número menor.
  let preguntaRangoYardas = false;
  if (
    !omitirCaptura && detectados.rangoYardas &&
    (nuevos.includes('yardas') || corregidos.includes('yardas'))
  ) {
    flow.rangoYardasPendiente = detectados.rangoYardas;
    preguntaRangoYardas = true;
  }

  // Regla del efectivo registrada en ESTE turno: el aviso va en
  // la respuesta de este turno — y también en el cierre si el
  // flujo se completa aquí mismo (el pago es el último paso). Si
  // el efectivo se registró en un turno anterior, ya se avisó
  // entonces y no se repite.
  const avisoEfectivo = !omitirCaptura && !!detectados.pagoEfectivo;

  // Forma de pago genérica («tarjeta» sin decir débito o crédito):
  // se pregunta «¿Débito o crédito?» UNA sola vez; si el cliente
  // insiste sin aclarar, se guarda «Tarjeta» y el flujo sigue.
  let preguntaAclararPago = false;
  if (pasoPedido === 'pago' && detectados.pagoGenerica && !flow.datos.pago) {
    if (flow.pagoAclaracionPedida) {
      flow.datos.pago = 'Tarjeta';
      nuevos.push('pago');
    } else {
      flow.pagoAclaracionPedida = true;
      preguntaAclararPago = true;
    }
  }

  const paso = pasoActual(flow);
  if (paso) {
    // Pregunta sobre el aire («¿qué es el aire?», «what is air?»):
    // se explica en lenguaje simple y se vuelve a preguntar, SIN
    // perder el paso del flujo en el que íbamos.
    const idiomaAire = preguntaSobreAire(textoCliente);
    if (idiomaAire) {
      db.setConversationFlow(conversacion.id, flow);
      conversacion.flow = flow;
      const partesAire = [];
      if (corregidos.length) {
        partesAire.push(
          `${idioma === 'en' ? 'Got it, updated' : 'Perfecto, lo corrijo'}: ${corregidos.map((c) => confirmacionCorreccionDe(c, flow.datos, idioma)).join('; ')}.`
        );
      }
      if (nuevos.length) {
        partesAire.push(`Perfecto, ${nuevos.map((c) => confirmacionDe(c, flow.datos, idioma)).join('; ')}.`);
      }
      partesAire.push(idiomaAire === 'en' ? EXPLICACION_AIRE_EN : EXPLICACION_AIRE_ES);
      // Si el cliente describió su trabajo (ej. «mi garaje es
      // cerrado bajo techo», o un patio exterior), va además la
      // recomendación para SU caso antes de volver a preguntar:
      // la explicación sola no le respondía «¿el mío lleva?».
      const recAire = recomendacionAire(textoCliente, idioma);
      if (recAire) partesAire.push(recAire);
      partesAire.push(
        flow.datos.aire
          ? preguntaPara(paso, flow.datos, idioma)
          : idiomaAire === 'en'
            ? 'Does your concrete need it with air or no air?'
            : '¿Su concreto lo necesita con aire o no aire?'
      );
      return {
        responder: true,
        texto: partesAire.join('\n'),
        intent: flow.tipo,
        topic: flow.tipo === 'pedido' ? 'su pedido' : 'su cotización',
        intentDetectado,
      };
    }
  }
  if (!paso) {
    // Flujo completo: cierre al cliente + confirmación armada.
    const datos = flow.datos;
    const confirmacionArmada = armarConfirmacion(datos, conversacion);
    // Ronda 11: si la orden ya se le mostró al cliente al
    // llegar al paso del pago (la orden va primero), el cierre
    // al responder el método es corto y no repite la orden.
    const ordenYaMostrada = !!flow.ordenMostrada;
    db.setConversationFlow(conversacion.id, null);
    conversacion.flow = null;
    const textoResumen = ordenYaMostrada
      ? textoCierreTrasOrden(datos, datos.nombre || conversacion.name, idioma)
      : resumenCliente(datos, datos.nombre || conversacion.name, idioma);
    return {
      responder: true,
      texto: textoResumen,
      intent: flow.tipo,
      topic: flow.tipo === 'pedido' ? 'su pedido' : 'su cotización',
      confirmacionArmada,
      // TARJETA DE CRÉDITO (orden de Jesus, 2026-10-21): el
      // webhook envía AUTOMÁTICAMENTE la forma de autorización
      // como documento de WhatsApp y abre la espera de documentos
      // (conv.docsTarjeta). Débito, Zelle y efectivo: sin forma.
      formaTarjeta: datos.pago === 'Tarjeta de crédito',
      idiomaForma: idioma,
    };
  }

  // ---- Anti-bucle: contar intentos fallidos en el MISMO paso ----
  const huboAvance =
    nuevos.length > 0 || corregidos.length > 0 || preguntaAclararPago || preguntaAmPm || oferta7am || preguntaRangoYardas || paso !== pasoPedido;
  const preguntaLegitima =
    saludoPuro || !!faq || !!ciudad || (noSabe && !detectados.medidas) ||
    esPreguntaPrecio(textoCliente) || !!preguntaSobreAire(textoCliente) || !!detectados.medidas ||
    preguntaPedido || !!pagoAdelantado || !!detectados.psiInvalido || !!detectados.mixInvalido;
  if (huboAvance) {
    flow.intentos = 0;
    flow.intentosPaso = paso;
  } else if (preguntaLegitima) {
    // El cliente no está atorado: está PREGUNTANDO algo (precio,
    // aire, cobertura, cuándo pedir, el momento del pago…). Se
    // le responde y el contador de intentos se reinicia, para
    // que la retomada del paso no salga con el texto de
    // «disculpe la vuelta» como si no hubiera sabido responder.
    flow.intentos = 0;
    flow.intentosPaso = paso;
  } else if (!preguntaLegitima) {
    if (flow.intentosPaso === paso) flow.intentos = (flow.intentos || 0) + 1;
    else {
      flow.intentosPaso = paso;
      flow.intentos = 1;
    }
  }
  const intentos = flow.intentos || 0;
  const escalado = intentos >= 2;
  db.setConversationFlow(conversacion.id, flow);
  conversacion.flow = flow;

  // ---- LA ORDEN PRIMERO, EL PAGO DESPUÉS (ronda 11, palabra
  // del dueño 2026-10-31 19:22: «Primero tiene que colocar la
  // order así y luego pregunta cómo pagará. Y le das las
  // opciones. Y los precios tú ya los tienes de los mixes»):
  // en cuanto la orden queda completa y SOLO falta el pago,
  // el bot coloca primero la orden completa — con los precios
  // de los mixes de su tabla (las 2 cotizaciones con su total
  // cada una, taxes incluidos) — y DESPUÉS pregunta cómo va a
  // pagar, con las opciones. Se muestra una vez (o de nuevo si
  // el cliente corrige un dato, porque los totales cambian);
  // al responder el método, el cierre es corto (ver
  // textoCierreTrasOrden) y la orden armada sale completa.
  if (paso === 'pago' && !preguntaAclararPago && (!flow.ordenMostrada || corregidos.length > 0)) {
    flow.ordenMostrada = true;
    db.setConversationFlow(conversacion.id, flow);
    conversacion.flow = flow;
    const partesOrden = [];
    if (corregidos.length) {
      partesOrden.push(
        `${idioma === 'en' ? 'Got it, updated' : 'Perfecto, lo corrijo'}: ${corregidos.map((c) => confirmacionCorreccionDe(c, flow.datos, idioma)).join('; ')}.`
      );
    }
    if (nuevos.length) {
      partesOrden.push(`Perfecto, ${nuevos.map((c) => confirmacionDe(c, flow.datos, idioma)).join('; ')}.`);
    }
    partesOrden.push(resumenCliente(flow.datos, flow.datos.nombre || conversacion.name, idioma));
    partesOrden.push(preguntaPara('pago', flow.datos, idioma));
    return {
      responder: true,
      texto: partesOrden.join('\n'),
      intent: flow.tipo,
      topic: flow.tipo === 'pedido' ? 'su pedido' : 'su cotización',
      intentDetectado,
    };
  }

  const partes = [];
  if (esNuevo) {
    partes.push(
      idioma === 'en'
        ? flow.tipo === 'pedido'
          ? "Perfect! We'll take your order 🏗️"
          : 'Happy to help with your quote 🏗️'
        : flow.tipo === 'pedido'
          ? '¡Perfecto, le tomamos su pedido! 🏗️'
          : 'Con gusto le ayudamos con su cotización 🏗️'
    );
  }
  if (corregidos.length) {
    partes.push(
      `${idioma === 'en' ? 'Got it, updated' : 'Perfecto, lo corrijo'}: ${corregidos.map((c) => confirmacionCorreccionDe(c, flow.datos, idioma)).join('; ')}.`
    );
  }
  if (nuevos.length) {
    partes.push(`Perfecto, ${nuevos.map((c) => confirmacionDe(c, flow.datos, idioma)).join('; ')}.`);
  }
  if (detectados.medidas) {
    partes.push(lineaMedidas(detectados.medidas, idioma));
  } else if (
    !esNuevo && !nuevos.length && !corregidos.length &&
    !faq && !ciudad && !noSabe && !preguntaPedido && !pagoAdelantado && !detectados.psiInvalido && !detectados.mixInvalido && !escalado && !preguntaAmPm && !oferta7am && !preguntaRangoYardas
  ) {
    partes.push(prefijoContinuacion(flow, idioma));
  }
  if (faq) {
    partes.push(textoEfectivo(faq, conversacion.name, idioma));
  }
  if (ciudad) {
    partes.push(lineaCiudad(ciudad, idioma));
  }
  if (cuandoPedir) {
    // Respuesta a «¿cuándo debo pedirlo?»: puede pedir desde
    // hoy; en cuanto se confirma su pago por adelantado, la
    // orden queda agendada. El flujo sigue pidiendo el día
    // concreto (la pregunta del paso va al final, como siempre).
    partes.push(idioma === 'en' ? LINEA_CUANDO_PEDIR_EN : LINEA_CUANDO_PEDIR_ES);
  }
  if (noSabe && !detectados.medidas) {
    partes.push(lineaNoSabeYardas(idioma));
  }
  // Pregunta de precio a mitad del flujo (o al abrirlo): respuesta
  // corta SIN números, y el flujo continúa donde iba.
  if (esPreguntaPrecio(textoCliente)) {
    partes.push(idioma === 'en' ? LINEA_PRECIO_EN : LINEA_PRECIO);
  }
  if (pagoAdelantado && !avisoEfectivo) {
    // Pregunta por el MOMENTO del pago («¿pago el día del
    // trabajo o debo pagar antes?»): se responde directo con la
    // regla del dueño y el flujo retoma el paso en que iba. Si
    // en este turno ya se avisó la regla del efectivo, esa
    // respuesta ya lo explica y no se duplica la línea.
    partes.push(idioma === 'en' ? LINEA_PAGO_ADELANTADO_EN : LINEA_PAGO_ADELANTADO_ES);
  }
  if (detectados.psiInvalido) {
    // El cliente pidió una resistencia que NO existe (ej. 2500
    // o 5500 psi): se le corrige con la lista exacta del dueño
    // (3000, 3500, 3600, 4000, 4500, 5000) y el flujo vuelve a
    // pedir el mix (el dato inválido no se anotó).
    partes.push(lineaPsiInvalido(detectados.psiInvalido, idioma));
  }
  if (detectados.mixInvalido) {
    // El cliente dio un mix por nombre de diseño de planta
    // (ej. «275-P»): esos no se utilizan; se le corrige con la
    // lista de los únicos mixes (los seis por PSI) y el flujo
    // vuelve a pedir el mix (el dato no se anotó).
    partes.push(lineaMixInvalido(idioma));
  }
  if (escalado) {
    partes.push(textoEscalado(paso, flow.datos, idioma));
  } else {
    partes.push(
      oferta7am
        ? textoPlantaCerrada7am(idioma)
        : preguntaAmPm
          ? textoPreguntaAmPm(idioma)
          : preguntaRangoYardas
            ? textoPreguntaRangoYardas(flow.rangoYardasPendiente, idioma)
            : preguntaAclararPago
            ? idioma === 'en'
              ? 'Debit or credit?'
              : '¿Débito o crédito?'
            : preguntaPara(paso, flow.datos, idioma, intentos >= 1)
    );
  }

  return {
    responder: true,
    texto: partes.join('\n'),
    intent: flow.tipo,
    topic: flow.tipo === 'pedido' ? 'su pedido' : 'su cotización',
    intentDetectado,
  };
}

/** ¿El mensaje abre el flujo? (intent de cotización/pedido o datos ya dados). */
function abreFlujo(intent, textoCliente) {
  if (intent.id === 'cotizacion' || intent.id === 'pedido') return true;
  // Una pregunta de precio («¿cuánto?», «how much»…) abre el flujo:
  // se responde la línea de precio y se arranca pidiendo las yardas.
  if (esPreguntaPrecio(textoCliente)) return true;
  const d = extraerDatos(textoCliente, null);
  if (d.yardas) return true;
  const t = normalizar(textoCliente);
  if (
    /\b(quiero|necesito|ocupo|me urge)\b/.test(t) &&
    /\b(concreto|cemento|semento|hormigon|yarda|yds|cotizacion|mix|mezcla)\b/.test(t)
  ) {
    return true;
  }
  // Inglés: «I need concrete», «we want 10 yards»…
  return (
    /\b(i need|i want|we need|we want|looking for|need|want)\b/.test(t) &&
    /\b(concrete|cement|yards?|yds)\b/.test(t) &&
    detectarIdioma(textoCliente) === 'en'
  );
}

/** Estado inicial de un flujo recién abierto. */
function flujoNuevo(tipo, textoCliente) {
  return {
    tipo,
    datos: datosVacios(),
    idioma: detectarIdioma(textoCliente),
    intentos: 0,
    intentosPaso: null,
    turnos: 0,
  };
}

/**
 * Clase de mensaje NO textual, según el tipo que pasa el webhook
 * o el texto marcador que se guardó («[nota de voz recibida]»…).
 * Esos textos JAMÁS son un dato del flujo.
 */
function claseNoTexto(texto, tipoMensaje) {
  const tipos = {
    audio: 'audio', location: 'location', image: 'imagen',
    video: 'video', document: 'documento', sticker: 'sticker',
    reaction: 'reaccion', contacts: 'contacto',
  };
  if (tipoMensaje && tipos[tipoMensaje]) return tipos[tipoMensaje];
  if (tipoMensaje && tipoMensaje !== 'text' && tipoMensaje !== 'button' && tipoMensaje !== 'interactive') {
    return 'otro';
  }
  const m = (texto || '').trim().match(/^\[([^\]]+)\]$/);
  if (m) {
    const k = normalizar(m[1]);
    if (k.includes('voz') || k.includes('audio')) return 'audio';
    if (k.includes('ubic')) return 'location';
    if (k.includes('imagen') || k.includes('image')) return 'imagen';
    if (k.includes('video')) return 'video';
    if (k.includes('documento')) return 'documento';
    if (k.includes('mensaje tipo')) return 'otro';
  }
  return null;
}

/**
 * Respuesta a un mensaje que NO es texto: a una nota de voz se le
 * pide amablemente que lo escriba; a una ubicación, la dirección
 * en texto; a un archivo, que lo escriba. Nunca se guarda como
 * dato y el flujo (si hay) sigue donde iba.
 */
function responderNoTexto(conversacion, clase) {
  const flow = conversacion.flow && conversacion.flow.datos ? conversacion.flow : null;
  const idioma = (flow && flow.idioma) || 'es';
  let texto;
  let intent = 'adjunto';
  if (clase === 'audio') {
    intent = 'audio';
    texto =
      idioma === 'en'
        ? "Thanks for your voice note 🙏 I can't listen to it here — could you please type it out for me? That way I get it down right."
        : 'Gracias por su nota de voz 🙏 Por aquí no la puedo escuchar: ¿me lo escribe en un mensajito, por favor? Así lo anoto bien.';
  } else if (clase === 'location') {
    intent = 'ubicacion';
    texto =
      idioma === 'en'
        ? 'Thanks for sharing your location! 📍 To write down the delivery correctly, could you please type the full job address (number, street and city)?'
        : '¡Gracias por compartir su ubicación! 📍 Para anotar bien la entrega, ¿me escribe la dirección completa de la obra (número, calle y ciudad), por favor?';
  } else {
    texto =
      idioma === 'en'
        ? 'Thanks 🙏 Could you please type that in a text message for me? That way I get it down right in your order.'
        : 'Gracias 🙏 ¿Me lo puede escribir en un mensaje de texto, por favor? Así lo anoto bien en su orden.';
  }
  if (flow) {
    const paso = pasoActual(flow);
    // Si el paso actual ya es la dirección, el texto de ubicación
    // ya la está pidiendo: no se duplica la pregunta.
    if (paso && !(clase === 'location' && paso === 'direccion')) {
      texto += '\n' + preguntaPara(paso, flow.datos, idioma);
    }
  }
  return { responder: true, texto, intent, topic: 'un mensaje sin texto' };
}

// ============================================================
// DOCUMENTOS DE LA TARJETA DE CRÉDITO (orden de Jesus,
// 2026-10-21): tras enviarle la forma de autorización, el bot
// espera en esa conversación (conv.docsTarjeta, estado
// 'pendiente'): el DOCUMENTO que mande el cliente es la forma
// llenada, y cada IMAGEN cuenta como una de las 4 fotos (tarjeta
// frente y reverso + ID frente y reverso). Si falta algo, el bot
// le dice con amabilidad qué falta exactamente; cuando está
// TODO, confirma con el texto fijo y marca la conversación para
// el especialista (needsHuman + docsTarjeta.estado 'completo'),
// que es lo que la vigilancia lee para avisar a Jesus
// «documentos completos».
// ============================================================
const MENSAJE_DOCS_COMPLETO_ES =
  'Ya recibí tu forma y tus fotos, está todo completo. Gracias.';
const MENSAJE_DOCS_COMPLETO_EN =
  "I received your form and your photos, everything is complete. Thank you.";

/** Texto amable que dice exactamente qué documento falta. */
function textoDocsFaltantes(docs, idioma) {
  const fotos = docs.fotos || 0;
  if (idioma === 'en') {
    const have = [];
    if (docs.forma) have.push('I have your form ✅');
    if (fotos > 0) have.push(`I have ${fotos} of the 4 photos`);
    const need = [];
    if (!docs.forma) need.push('your filled-out, signed authorization form');
    if (fotos < 4) {
      need.push(
        `${4 - fotos} more photo(s): your card front and back, and your ID front and back (${fotos} of 4 so far)`
      );
    }
    return (
      `Thank you! 🙏${have.length ? ` ${have.join('; ')}.` : ''} ` +
      `I still need: ${need.join(' and ')}. Could you please send it here?`
    );
  }
  const have = [];
  if (docs.forma) have.push('ya recibí su forma ✅');
  if (fotos > 0) have.push(`ya tengo ${fotos} de las 4 fotos`);
  const need = [];
  if (!docs.forma) need.push('su forma de autorización llenada y firmada');
  if (fotos < 4) {
    need.push(
      `${4 - fotos} foto(s) más: su tarjeta por el frente y el reverso, y su identificación por ambos lados (van ${fotos} de 4)`
    );
  }
  return (
    `¡Gracias! 🙏${have.length ? ` ${have.join('; ')}.` : ''} ` +
    `Todavía me falta: ${need.join(' y ')}. ¿Me lo manda por aquí, por favor?`
  );
}

/**
 * Registra un documento o imagen entrante contra la espera de
 * documentos de tarjeta (docsTarjeta 'pendiente') y decide la
 * respuesta: qué falta, o la confirmación de completo.
 */
function manejarDocsTarjeta(conversacion, clase) {
  const docs = { ...(conversacion.docsTarjeta || {}) };
  const idioma = docs.idioma || 'es';
  if (clase === 'documento') docs.forma = true;
  if (clase === 'imagen') docs.fotos = Math.min(4, (docs.fotos || 0) + 1);
  if (docs.forma && (docs.fotos || 0) >= 4) {
    docs.estado = 'completo';
    docs.completadoAt = new Date().toISOString();
    db.setDocsTarjeta(conversacion.id, docs);
    conversacion.docsTarjeta = docs;
    // Listo para el especialista: la vigilancia avisa a Jesus
    // «documentos completos» al ver needsHuman + estado completo.
    db.setNeedsHuman(conversacion.id, true);
    return {
      responder: true,
      texto: idioma === 'en' ? MENSAJE_DOCS_COMPLETO_EN : MENSAJE_DOCS_COMPLETO_ES,
      intent: 'docs_tarjeta',
      topic: 'sus documentos de tarjeta',
      docsCompletos: true,
    };
  }
  db.setDocsTarjeta(conversacion.id, docs);
  conversacion.docsTarjeta = docs;
  return {
    responder: true,
    texto: textoDocsFaltantes(docs, idioma),
    intent: 'docs_tarjeta',
    topic: 'sus documentos de tarjeta',
  };
}

// ============================================================
// POST-CIERRE DE ORDEN (2026-10-31): mensajes del cliente DESPUÉS
// de que su orden ya cerró. Caso real: la orden acababa de cerrar
// y el cliente escribió «4300 no es un mix»; el bot cayó en el
// fallback genérico («no le entendí») con la frase de retomada en
// tú — no atendió la corrección (que además era correcta) y mezcló
// registros. Reglas:
//  - Si el cliente corrige o menciona un mix tras el cierre, se
//    atiende como CORRECCIÓN de su orden: mix no disponible →
//    redacción oficial + se pregunta por cuál mix válido lo
//    cambia (y su respuesta se aplica); mix válido → se actualiza
//    la confirmación armada del panel y se confirma en una línea.
//  - Otro mensaje post-cierre sin intent claro NO cae en «no le
//    entendí»: se confirma que quedó anotado para el especialista
//    que atiende la orden.
//  - Nada de esto lleva la frase de retomada («El especialista no
//    le contestó…»): tras el cierre el especialista SÍ está
//    atendiendo la orden. La decisión sale con
//    sinPrefijoDespertar y el envoltorio la respeta.
// La orden cerrada se localiza en el historial: el último mensaje
// BOT con flags.tipo = 'confirmacion_armada' (el que el webhook
// guarda al cerrar el flujo), dentro de los últimos 7 días.
// ============================================================
const PREGUNTA_CAMBIO_MIX_ES = '¿Por cuál mix lo cambiamos en su orden?';
const PREGUNTA_CAMBIO_MIX_EN = 'Which mix should we change it to on your order?';
const PREGUNTA_OFERTA_PAGO_ES = '¿Quiere que le cambie la forma de pago a';
const PREGUNTA_OFERTA_PAGO_EN = 'Want me to change your payment method to';
const VENTANA_POST_CIERRE_MS = 7 * 24 * 3600 * 1000;

function ultimaOrdenCerrada(conversacion) {
  let msgs = [];
  try {
    msgs = db.getMessages(conversacion.id, 200) || [];
  } catch {
    return null;
  }
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.sender === 'BOT' && m.flags && m.flags.tipo === 'confirmacion_armada') {
      if (
        m.timestamp &&
        Date.now() - new Date(m.timestamp).getTime() > VENTANA_POST_CIERRE_MS
      ) {
        return null;
      }
      return m;
    }
  }
  return null;
}

/** Reescribe el mix en la línea 3 de la confirmación armada,
 * conservando el aire y la pompa tal como quedaron en la orden. */
function aplicarCambioMixEnConfirmacion(textoArmada, nuevoMix) {
  let lineas = String(textoArmada || '').split('\n');
  if (lineas.length < 3) return null;
  // Si el mix cambia tras el cierre, los totales de la orden
  // armada quedan viejos: se quitan las líneas «Total…» para
  // no dejar un precio que ya no corresponde (el dueño
  // confirma el precio del mix nuevo) — ronda 11.
  lineas = lineas.filter((l) => !/^Total\b/.test(l));
  let linea = lineas[2];
  let pompa = null;
  const mPompa = /\s\(([^)]+)\)\s*$/.exec(linea);
  if (mPompa) {
    pompa = mPompa[1];
    linea = linea.slice(0, mPompa.index);
  }
  let aire = null;
  const mAire = /\s(con aire|no aire)\s*$/.exec(linea);
  if (mAire) aire = mAire[1];
  lineas[2] = `${nuevoMix}${aire ? ` ${aire}` : ''}${pompa ? ` (${pompa})` : ''}`;
  return lineas.join('\n');
}

/** Reescribe la línea «Pago: …» de la confirmación armada. */
function aplicarCambioPagoEnConfirmacion(textoArmada, nuevoPago) {
  const lineas = String(textoArmada || '').split('\n');
  const ix = lineas.findIndex((l) => /^Pago: /.test(l));
  if (ix < 0) return null;
  lineas[ix] = `Pago: ${nuevoPago}`;
  return lineas.join('\n');
}

/** Etiqueta corta del método para preguntas/confirmaciones. */
function etiquetaCortaPago(pago, idioma) {
  if (idioma === 'en') {
    if (esPagoEfectivo(pago)) return 'cash';
    if (pago === 'Tarjeta de débito') return 'debit card';
    if (pago === 'Tarjeta de crédito') return 'credit card';
    if (pago === PAGO_CHEQUE) return 'check';
    return pago;
  }
  if (esPagoEfectivo(pago)) return 'efectivo';
  if (pago === PAGO_CHEQUE) return 'cheque';
  return pago;
}

/** Respuesta cuando el cliente PREGUNTA por un método de pago. */
function infoMetodoPago(pago, idioma) {
  if (idioma === 'en') {
    switch (pago) {
      case 'Tarjeta de crédito':
        return `Yes, we accept credit cards. A ${RECARGO_CREDITO_PCT}% processing surcharge is added, and we send you an authorization form to fill out.`;
      case PAGO_CHEQUE:
        return `Yes, we accept checks. Check payments have taxes (${TAXES_TX}) added.`;
      case 'Zelle':
        return `Yes, you can pay by Zelle. It must be sent before we load the concrete, to ${ZELLE_JMP} (this WhatsApp number does not receive Zelle).`;
      case 'Tarjeta de débito':
        return 'Yes, we accept debit cards, with no extra charges.';
      case PAGO_EFECTIVO:
      case PAGO_EFECTIVO_LEGADO:
        return 'Yes, we accept cash.';
      default:
        return '';
    }
  }
  switch (pago) {
    case 'Tarjeta de crédito':
      return `Sí, aceptamos tarjeta de crédito. Se le suma un cargo por procesamiento del ${RECARGO_CREDITO_PCT}% y le enviamos una forma de autorización para llenarla.`;
    case PAGO_CHEQUE:
      return `Sí, aceptamos cheque. A los pagos con cheque se les suman los taxes (${TAXES_TX}).`;
    case 'Zelle':
      return `Sí, puede pagar por Zelle. Tiene que enviarlo antes de que carguemos el concreto, a ${ZELLE_JMP} (este número de WhatsApp no recibe Zelle).`;
    case 'Tarjeta de débito':
      return 'Sí, aceptamos tarjeta de débito, sin cargos extra.';
    case PAGO_EFECTIVO:
    case PAGO_EFECTIVO_LEGADO:
      return 'Sí, aceptamos efectivo.';
    default:
      return '';
  }
}

/** Lista de métodos aceptados, para la pregunta genérica. */
function textoListaMetodos(idioma) {
  return idioma === 'en'
    ? `We accept: cash, debit card, credit card (a ${RECARGO_CREDITO_PCT}% processing surcharge applies), Zelle (sent before we load the concrete) and check (taxes of ${TAXES_TX} are added). Which one do you want to switch your order to?`
    : `Las formas de pago que aceptamos son: efectivo, tarjeta de débito, tarjeta de crédito (se suma un cargo por procesamiento del ${RECARGO_CREDITO_PCT}%), Zelle (se envía antes de cargar el concreto) y cheque (se suman los taxes, ${TAXES_TX}). ¿A cuál quiere cambiar su orden?`;

}

/** Aplica el cambio de forma de pago a la orden ya cerrada. */
function decisionCambioPago(orden, nuevoPago, idioma) {
  const nuevaArmada = aplicarCambioPagoEnConfirmacion(orden.text, nuevoPago);
  const nota = notaMetodoPago(nuevoPago, idioma);
  const decision = {
    responder: true,
    texto:
      (idioma === 'en'
        ? `Done ✅ I changed your order's payment method to *${etiquetaCortaPago(nuevoPago, 'en')}*.`
        : `Perfecto, ya cambié la forma de pago de su orden a *${etiquetaCortaPago(nuevoPago, 'es')}*. ✅`) +
      (nota ? ` ${nota}` : ''),
    intent: 'postcierre',
    topic: 'el cambio de forma de pago de su orden',
    sinPrefijoDespertar: true,
  };
  if (nuevaArmada && nuevaArmada !== orden.text) {
    decision.confirmacionArmada = nuevaArmada;
  }
  // Crédito tras el cierre: el webhook envía la forma de
  // autorización igual que cuando se elige en el flujo.
  if (nuevoPago === 'Tarjeta de crédito') decision.formaTarjeta = true;
  return decision;
}

function manejarPostCierre(conversacion, textoCliente, idiomaMsg) {
  const orden = ultimaOrdenCerrada(conversacion);
  if (!orden) return null;
  // Saludo puro tras el cierre: lo atiende la ruta de saludo.
  if (esSaludoPuro(textoCliente)) return null;
  let msgs = [];
  try {
    msgs = db.getMessages(conversacion.id, 200) || [];
  } catch {}
  const ultimoBot = [...msgs].reverse().find((m) => m.sender === 'BOT');
  const esperandoCambio =
    !!ultimoBot &&
    (ultimoBot.text.includes(PREGUNTA_CAMBIO_MIX_ES) ||
      ultimoBot.text.includes(PREGUNTA_CAMBIO_MIX_EN));
  const esperandoTarjetaPc =
    !!ultimoBot &&
    (ultimoBot.text.includes('¿Débito o crédito?') ||
      ultimoBot.text.includes('Debit or credit?'));
  const esperandoOfertaPago =
    !!ultimoBot &&
    (ultimoBot.text.includes(PREGUNTA_OFERTA_PAGO_ES) ||
      ultimoBot.text.includes(PREGUNTA_OFERTA_PAGO_EN));
  // Idioma: el de la ORDEN cerrada (su resumen al cliente), no el
  // del mensajito post-cierre — «4300 is not a mix» o «just a
  // question» son demasiado cortos para detectarIdioma y la
  // corrección debe salir en el idioma de la conversación.
  const resumenCierre = [...msgs]
    .reverse()
    .find(
      (m) =>
        m.sender === 'BOT' &&
        (m.text.includes('Ya quedó registrada su orden') ||
          m.text.includes('Your order is registered'))
    );
  const idiomaOrden = resumenCierre
    ? resumenCierre.text.includes('Your order is registered')
      ? 'en'
      : 'es'
    : null;
  const idioma = esperandoCambio
    ? ultimoBot.text.includes(PREGUNTA_CAMBIO_MIX_EN)
      ? 'en'
      : 'es'
    : idiomaOrden || idiomaMsg;
  const d = extraerDatos(textoCliente, 'mix');

  if (d.psiInvalido || d.mixInvalido) {
    // Corrección a un mix que NO existe: redacción oficial (sin
    // nombrar el mix pedido ni listar los válidos) y se pregunta
    // por cuál mix válido lo cambia en su orden.
    return {
      responder: true,
      texto:
        lineaMixInvalido(idioma) +
        ' ' +
        (idioma === 'en' ? PREGUNTA_CAMBIO_MIX_EN : PREGUNTA_CAMBIO_MIX_ES),
      intent: 'postcierre',
      topic: 'la corrección del mix de su orden',
      sinPrefijoDespertar: true,
    };
  }
  if (d.mix) {
    // Corrección a un mix válido (directa, o la respuesta a la
    // pregunta de cambio): se actualiza la confirmación armada
    // que el especialista completa en el panel y se confirma el
    // cambio en una línea.
    const nuevaArmada = aplicarCambioMixEnConfirmacion(orden.text, d.mix);
    const decision = {
      responder: true,
      texto:
        idioma === 'en'
          ? `Done ✅ I updated the mix on your order to *${d.mix}*.`
          : `Perfecto, ya corregí el mix de su orden: queda en *${d.mix}*. ✅`,
      intent: 'postcierre',
      topic: 'la corrección del mix de su orden',
      sinPrefijoDespertar: true,
    };
    if (nuevaArmada && nuevaArmada !== orden.text) {
      decision.confirmacionArmada = nuevaArmada;
    }
    return decision;
  }
  if (d.mixesCotizacion) {
    // Tras el cierre el cliente pide cotizar varios mixes (o
    // pasa de un mix a las cotizaciones): la orden armada queda
    // con el par — «con el mix diferente pero todo lo demás
    // igual» (regla del dueño, 2026-10-31 19:03).
    const nuevaArmada = aplicarCambioMixEnConfirmacion(
      orden.text,
      textoMixesCotizacion(d.mixesCotizacion, 'es')
    );
    const decision = {
      responder: true,
      texto:
        idioma === 'en'
          ? `Done ✅ I updated your order to the *${d.mixesCotizacion.length} quotes: ${listaMixesCotizacion(d.mixesCotizacion, 'en')}* — everything else stays the same.`
          : `Perfecto, ya corregí su orden: quedan las *${d.mixesCotizacion.length} cotizaciones: ${listaMixesCotizacion(d.mixesCotizacion, 'es')}* — todo lo demás igual. ✅`,
      intent: 'postcierre',
      topic: 'la corrección del mix de su orden',
      sinPrefijoDespertar: true,
    };
    if (nuevaArmada && nuevaArmada !== orden.text) {
      decision.confirmacionArmada = nuevaArmada;
    }
    return decision;
  }
  // ---- Forma de pago tras el cierre (reglas del dueño,
  // 2026-10-31 18:03-18:06): «ya cuando ya tienes casi todo, el
  // cliente puede cambiar la forma de pago, es decir preguntar
  // por las otras: Zelle, tarjetas». Antes todo caía en el
  // «quedó anotado» genérico (captura real: «Y si es cheque?»
  // sin respuesta). Ahora: si PREGUNTA por un método, se le
  // responde con su regla (crédito +4% de procesamiento,
  // cheque +taxes 8.25%, Zelle antes de cargar el concreto) y
  // se le ofrece el cambio; si lo pide o lo confirma, se
  // actualiza la línea «Pago:» de la orden armada.
  {
    const idiomaP = esperandoOfertaPago
      ? ultimoBot.text.includes(PREGUNTA_OFERTA_PAGO_EN)
        ? 'en'
        : 'es'
      : idioma;
    const tNorm = ` ${normalizar(textoCliente)} `;
    const pagoDetectadoPc = extraerPago(textoCliente);
    const afirmativo = /\b(si|yes|ok|okay|dale|claro|va|bueno|cambialo|cambielo|hazlo)\b/.test(tNorm);
    const decisionPagoSimple = (texto) => ({
      responder: true,
      texto,
      intent: 'postcierre',
      topic: 'el cambio de forma de pago de su orden',
      sinPrefijoDespertar: true,
    });
    if (
      esperandoTarjetaPc &&
      (pagoDetectadoPc === 'Tarjeta de débito' || pagoDetectadoPc === 'Tarjeta de crédito')
    ) {
      return decisionCambioPago(orden, pagoDetectadoPc, idiomaP);
    }
    if (esperandoOfertaPago) {
      const mOf = /\*([^*]+)\*/.exec(ultimoBot.text || '');
      const ofrecido = mOf ? extraerPago(mOf[1]) : null;
      if (ofrecido && (afirmativo || pagoDetectadoPc === ofrecido)) {
        return decisionCambioPago(orden, ofrecido, idiomaP);
      }
      if (pagoDetectadoPc && pagoDetectadoPc !== 'Tarjeta') {
        return decisionCambioPago(orden, pagoDetectadoPc, idiomaP);
      }
      if (pagoDetectadoPc === 'Tarjeta') {
        return decisionPagoSimple(idiomaP === 'en' ? 'Debit or credit?' : '¿Débito o crédito?');
      }
      // Otra cosa: sigue el curso normal (genérico al final).
    } else if (pagoDetectadoPc) {
      const esPregunta =
        /\?/.test(textoCliente) ||
        /\b(acepta|aceptan|puedo|se puede|puedes|opcion|opciones|can i|do you|what|how)\b/.test(tNorm);
      if (pagoDetectadoPc === 'Tarjeta') {
        if (esPregunta) {
          return decisionPagoSimple(
            (idiomaP === 'en'
              ? `We accept both. Debit has no extra charge; credit adds a ${RECARGO_CREDITO_PCT}% processing surcharge and we send you an authorization form to fill out. `
              : `Aceptamos las dos. La de débito no tiene cargos extra; la de crédito suma un cargo por procesamiento del ${RECARGO_CREDITO_PCT}% y le enviamos una forma de autorización para llenarla. `) +
              (idiomaP === 'en' ? 'Debit or credit?' : '¿Débito o crédito?')
          );
        }
        return decisionPagoSimple(idiomaP === 'en' ? 'Debit or credit?' : '¿Débito o crédito?');
      }
      if (esPregunta) {
        return decisionPagoSimple(
          `${infoMetodoPago(pagoDetectadoPc, idiomaP)} ` +
            (idiomaP === 'en'
              ? `Want me to change your payment method to *${etiquetaCortaPago(pagoDetectadoPc, 'en')}*?`
              : `¿Quiere que le cambie la forma de pago a *${etiquetaCortaPago(pagoDetectadoPc, 'es')}*?`)
        );
      }
      // Cambio directo («mejor por Zelle», «pago con cheque»…).
      return decisionCambioPago(orden, pagoDetectadoPc, idiomaP);
    }
    if (
      /\b(formas? de pago|metodos? de pago|opciones de pago|payment methods|payment options|how (can|do) i pay|como (puedo |se )?paga)/.test(tNorm)
    ) {
      return decisionPagoSimple(textoListaMetodos(idiomaP));
    }
  }
  if (esperandoCambio) {
    // Respondió a la pregunta de cambio sin un mix reconocible:
    // se repite la pregunta, jamás «no le entendí».
    return {
      responder: true,
      texto: idioma === 'en' ? PREGUNTA_CAMBIO_MIX_EN : PREGUNTA_CAMBIO_MIX_ES,
      intent: 'postcierre',
      topic: 'la corrección del mix de su orden',
      sinPrefijoDespertar: true,
    };
  }
  // Mensaje genérico tras el cierre: queda anotado para el
  // especialista que atiende la orden (no «no le entendí»).
  return {
    responder: true,
    texto:
      idioma === 'en'
        ? 'Got it — your message has been noted for the specialist handling your order. If you need to change anything about your order, just tell me here. 🙏'
        : 'Perfecto, su mensaje quedó anotado para el especialista que está atendiendo su orden. Si necesita cambiar algo de su orden, dígamelo por aquí. 🙏',
    intent: 'postcierre',
    topic: 'un mensaje tras el cierre de su orden',
    sinPrefijoDespertar: true,
  };
}

/**
 * Saludo breve de CONTINUACIÓN cuando el bot despierta de
 * needsHuman y el cliente solo saludó: nada de bienvenida
 * completa ni de repetir el resumen de la orden anterior; se le
 * saluda de nuevo y se le ofrece seguir con lo que necesite.
 */
function saludoContinuacion(nombre, idioma = 'es') {
  const n =
    nombre && nombre !== '' && !/^\d+$/.test(String(nombre)) ? `, ${nombre}` : '';
  if (idioma === 'en') {
    return (
      `Hello again${n}! 👋 How else can we help you?\n` +
      'You can ask for another *quote*, place another *order*, or ask us anything you need.'
    );
  }
  return (
    `¡Hola de nuevo${n}! 👋 ¿En qué más le ayudamos?\n` +
    'Puede pedir otra *cotización*, hacer otro *pedido* o preguntarnos lo que necesite.'
  );
}

/**
 * Decide si el bot debe responder a un mensaje entrante del cliente.
 * NO responde si:
 *  - el bot está pausado para esa conversación y el humano sigue
 *    activo (pausa manual del panel, ver REANUDACIÓN abajo), o
 *  - un ESPECIALISTA respondió hace menos de AUTOREPLY_HUMAN_PAUSE_MIN minutos
 *    (para no interrumpir la conversación humana).
 * REANUDACIÓN DE LA PAUSA (orden de Jesus, 2026-10-31: «cuando
 * entra el humano al chat el bot deja de responder»): la pausa
 * manual (botPaused) ya NO duerme al bot para siempre. Protege al
 * humano solo mientras está activo en la conversación: si el
 * especialista escribió hace menos de AUTOREPLY_HUMAN_PAUSE_MIN
 * minutos (o la pausa se puso hace menos de eso y aún no escribe),
 * el bot se queda en silencio; pasada esa ventana de inactividad
 * del humano, la pausa vence sola, se limpia y el bot vuelve a
 * responder sin que nadie tenga que reanudarlo a mano. Una pausa
 * vieja sin hora registrada (anterior a este arreglo) se trata
 * como vencida: son justo las conversaciones que quedaron mudas.
 * DESPERTAR (orden de Jesus, 2026-10-21): la marca needsHuman ya NO
 * duerme al bot para siempre. Si la conversación está marcada
 * (flujo completado o el cliente pidió una persona) y el cliente
 * vuelve a escribir, el bot DESPIERTA: limpia la marca y sigue la
 * conversación con normalidad. Única excepción: si un ESPECIALISTA
 * escribió desde el panel DESPUÉS de la marca y sigue dentro de la
 * ventana de pausa, el bot se queda en silencio para no interrumpir
 * a un humano que está atendiendo en vivo (y la marca se mantiene).
 * Al despertar, la respuesta se abre con la frase de retomada del
 * dueño (ver decidirRespuesta) y, si el cliente solo saludó, el
 * saludo es breve de continuación, sin repetir la orden anterior.
 * RETOMA: con un flujo ACTIVO, un mensaje nuevo del cliente (saludo,
 * mensaje corto o el dato siguiente) continúa el flujo donde iba:
 * jamás se manda la bienvenida ni el menú a mitad del flujo, y el
 * flujo no vence por tiempo (el estado persiste en la base).
 * Devuelve { responder, texto, intent, topic, motivo, confirmacionArmada? }.
 * `ctx` es un objeto interno del envoltorio decidirRespuesta: aquí
 * se anota si la conversación despertó (ctx.desperto) y el idioma
 * de la respuesta cuando ya se conoce (ctx.idioma).
 */
function decidirRespuestaInterna(conversacion, textoCliente, tipoMensaje = 'text', ctx = {}) {
  const ultimoHumano = db.lastMessageFrom(conversacion.id, 'ESPECIALISTA');
  const minutosHumano = ultimoHumano
    ? (Date.now() - new Date(ultimoHumano.timestamp).getTime()) / 60000
    : null;

  if (conversacion.botPaused) {
    // Pausa manual del panel: protege al humano SOLO mientras está
    // activo (su último mensaje manda; si aún no escribió, manda la
    // hora en que se puso la pausa). Vencida la ventana de
    // inactividad, la pausa se limpia sola y el bot reanuda sus
    // respuestas en este mismo turno, sin intervención de nadie.
    const refPausaMs = ultimoHumano
      ? new Date(ultimoHumano.timestamp).getTime()
      : conversacion.botPausedAt
        ? new Date(conversacion.botPausedAt).getTime()
        : null;
    const minutosPausa =
      refPausaMs === null ? null : (Date.now() - refPausaMs) / 60000;
    if (minutosPausa !== null && minutosPausa < cfg.autoreplyHumanPauseMin) {
      return { responder: false, motivo: 'bot pausado por especialista' };
    }
    db.setBotPaused(conversacion.id, false);
    conversacion.botPaused = false;
    conversacion.botPausedAt = null;
  }

  if (conversacion.needsHuman) {
    // ¿Un especialista tomó la conversación DESPUÉS de la marca y
    // sigue dentro de la ventana de pausa? Entonces no se
    // interrumpe: silencio y la marca queda como está. (Las
    // conversaciones marcadas antes de existir needsHumanAt no
    // traen la hora de la marca: vale cualquier mensaje de
    // especialista dentro de la ventana.)
    const marcaMs = conversacion.needsHumanAt
      ? new Date(conversacion.needsHumanAt).getTime()
      : null;
    const humanoTrasMarca =
      !!ultimoHumano &&
      (marcaMs === null ||
        new Date(ultimoHumano.timestamp).getTime() >= marcaMs);
    if (
      humanoTrasMarca &&
      minutosHumano !== null &&
      minutosHumano < cfg.autoreplyHumanPauseMin
    ) {
      return { responder: false, motivo: 'especialista activo recientemente' };
    }
    // DESPERTAR: ningún especialista tomó la conversación (o ya
    // pasó la ventana de pausa) y el cliente volvió a escribir:
    // se limpia la marca y el mensaje se procesa con normalidad.
    db.setNeedsHuman(conversacion.id, false);
    conversacion.needsHuman = false;
    conversacion.needsHumanAt = null;
    ctx.desperto = true;
    ctx.idioma =
      conversacion.flow && conversacion.flow.idioma
        ? conversacion.flow.idioma
        : null;
  } else if (minutosHumano !== null && minutosHumano < cfg.autoreplyHumanPauseMin) {
    return { responder: false, motivo: 'especialista activo recientemente' };
  }

  // --- Mensajes que NO son texto (nota de voz, ubicación, foto…):
  // jamás se guardan como dato; se pide el dato en texto.
  const clase = claseNoTexto(textoCliente, tipoMensaje);
  if (clase) {
    // DOCUMENTOS DE TARJETA EN ESPERA: si esta conversación está
    // esperando la forma y las fotos (el cliente pagó con tarjeta
    // de crédito y ya se le envió la forma), un documento es la
    // forma llenada y una imagen es una de las 4 fotos — se
    // registra contra la espera en vez de pedirlo en texto.
    if (
      (clase === 'documento' || clase === 'imagen') &&
      conversacion.docsTarjeta &&
      conversacion.docsTarjeta.estado === 'pendiente'
    ) {
      return manejarDocsTarjeta(conversacion, clase);
    }
    return responderNoTexto(conversacion, clase);
  }

  const intent = detectarIntent(textoCliente);
  const idiomaMsg = detectarIdioma(textoCliente);

  // --- Flujo de cotización/pedido EN CURSO: tiene prioridad.
  // Las respuestas cortas se interpretan como el dato que se pidió;
  // jamás se cae al menú genérico a mitad del flujo.
  if (conversacion.flow && conversacion.flow.datos) {
    const paso = pasoActual(conversacion.flow);
    // El intent «humano» NO se evalúa en los pasos de nombre y
    // compañía: lo que el cliente escriba ahí ES su nombre o su
    // compañía (un cliente que se llama Jesús no está pidiendo
    // hablar con Jesus).
    if (intent.id === 'humano' && paso !== 'nombre' && paso !== 'compania') {
      // El cliente pidió una persona: se cierra el flujo y se le atiende.
      const idiomaFlow = conversacion.flow.idioma || idiomaMsg;
      db.setConversationFlow(conversacion.id, null);
      conversacion.flow = null;
      return {
        responder: true,
        texto: textoEfectivo('humano', conversacion.name, idiomaFlow),
        intent: 'humano',
        topic: 'hablar con un especialista',
      };
    }
    // Cancelación a mitad del flujo: se cierra con despedida
    // amable y la conversación queda terminada por el cliente.
    if (esCancelacion(textoCliente)) {
      const idiomaFlow = conversacion.flow.idioma || idiomaMsg;
      db.setConversationFlow(conversacion.id, null);
      conversacion.flow = null;
      return {
        responder: true,
        texto: despedidaCancelacion(idiomaFlow),
        intent: 'cancelacion',
        topic: 'una cancelación del cliente',
        flujoCancelado: true,
      };
    }
    return manejarFlujo(conversacion, textoCliente, false, intent.id);
  }

  // --- Cancelación sin flujo: despedida amable, sin «no entendí».
  if (intent.id !== 'humano' && esCancelacion(textoCliente)) {
    return {
      responder: true,
      texto: despedidaCancelacion(idiomaMsg),
      intent: 'cancelacion',
      topic: 'una cancelación del cliente',
      flujoCancelado: true,
    };
  }

  // --- Cobertura por ciudad: «¿Llegan a Fort Worth?» confirma la
  // ciudad y sigue con la primera pregunta del flujo.
  const ciudad = intent.id !== 'humano' ? preguntaCoberturaCiudad(textoCliente) : null;
  if (ciudad) {
    conversacion.flow = flujoNuevo('cotizacion', textoCliente);
    db.setConversationFlow(conversacion.id, conversacion.flow);
    return {
      responder: true,
      texto:
        lineaCiudad(ciudad, conversacion.flow.idioma) +
        '\n' +
        preguntaPara('yardas', conversacion.flow.datos, conversacion.flow.idioma),
      intent: 'zona',
      topic: 'la zona de entrega',
    };
  }

  // --- Apertura del flujo de cotización/pedido.
  if (intent.id !== 'humano' && abreFlujo(intent, textoCliente)) {
    conversacion.flow = flujoNuevo(
      intent.id === 'pedido' ? 'pedido' : 'cotizacion',
      textoCliente
    );
    return manejarFlujo(conversacion, textoCliente, true, intent.id);
  }

  // --- Pregunta sobre el aire SIN flujo en curso: se explica y se
  // abre el flujo para que la respuesta («con aire»/«no aire») no se
  // pierda y la conversación siga como una cotización.
  const idiomaAireSuelto = intent.id !== 'humano' ? preguntaSobreAire(textoCliente) : null;
  if (idiomaAireSuelto) {
    conversacion.flow = flujoNuevo('cotizacion', textoCliente);
    db.setConversationFlow(conversacion.id, conversacion.flow);
    const recSuelta = recomendacionAire(textoCliente, idiomaAireSuelto);
    return {
      responder: true,
      texto:
        (idiomaAireSuelto === 'en' ? EXPLICACION_AIRE_EN : EXPLICACION_AIRE_ES) +
        (recSuelta ? `\n${recSuelta}` : '') +
        '\n' +
        (idiomaAireSuelto === 'en'
          ? 'Does your concrete need it with air or no air?'
          : '¿Su concreto lo necesita con aire o no aire?'),
      intent: 'aire',
      topic: 'qué es el aire en el concreto',
    };
  }

  // --- Post-cierre de orden (2026-10-31): sin flujo activo y sin
  // intent fuerte, si la conversación tiene una orden recién
  // cerrada, el mensaje se atiende como corrección o nota de esa
  // orden (ver manejarPostCierre), nunca como «no le entendí» ni
  // con la frase de retomada. El intent «pago» también entra
  // (2026-10-31 18:03): un «mejor por Zelle» tras el cierre es
  // un CAMBIO de la orden, no la pregunta genérica de pagos;
  // sin orden cerrada, manejarPostCierre devuelve null y sigue
  // la respuesta normal del intent. El intent «faq_pagos»
  // también entra (ronda 12, 2026-10-31): sus palabras clave
  // («efectivo», «cash») se tragaban la pregunta post-cierre
  // «¿Y si pago en efectivo?» y salía la FAQ genérica en vez
  // de la info del método con la oferta de cambio.
  if (intent.id === 'otro' || intent.id === 'pago' || intent.id === 'faq_pagos') {
    const postCierre = manejarPostCierre(conversacion, textoCliente, idiomaMsg);
    if (postCierre) return postCierre;
  }

  // --- Retoma tras despertar de needsHuman con un saludo puro y
  // sin flujo en curso: saludo breve de continuación, sin la
  // bienvenida completa y sin repetir la orden anterior.
  if (ctx.desperto && esSaludoPuro(textoCliente)) {
    return {
      responder: true,
      texto: saludoContinuacion(conversacion.name, idiomaMsg),
      intent: 'saludo',
      topic: 'su saludo',
    };
  }

  // --- Saludo en cualquier registro sin intent fuerte (orden
  // del dueño, 2026-10-27; caso real Cheko Alvarado, «Dimelo»):
  // si ningún intent reconoció el mensaje pero es un saludo puro
  // o el mensaje EMPIEZA con un saludo, se responde con el
  // saludo en vez de caer en el «no le entendí». Los saludos que
  // llegan CON pedido o pregunta detectable nunca pasan por
  // aquí: su intent fuerte ya ganó en detectarIntent.
  if (
    intent.id === 'otro' &&
    (esSaludoPuro(textoCliente) || empiezaConSaludo(textoCliente))
  ) {
    return {
      responder: true,
      texto: textoEfectivo('saludo', conversacion.name, idiomaMsg),
      intent: 'saludo',
      topic: 'su saludo',
    };
  }

  // --- Respuesta normal por intent (comportamiento de siempre).
  const texto = textoEfectivo(intent.id, conversacion.name, idiomaMsg);
  return { responder: true, texto, intent: intent.id, topic: intent.topic };
}

// ============================================================
// FRASE DE RETOMADA AL DESPERTAR (orden del dueño, 2026-10-21;
// registro corregido a USTED el 2026-10-31: el bot trata al
// cliente de usted en todo el flujo —«Disculpe», «su orden»— y
// la versión original mezclaba tú y usted): cuando el bot retoma
// una conversación marcada needsHuman porque el especialista NO
// contestó, su primer mensaje al cliente abre con esta frase y
// de ahí sigue ayudándole con lo que pida. SOLO sale en ese
// contexto real (ctx.desperto); las respuestas post-cierre de
// una orden salen con sinPrefijoDespertar y nunca la llevan.
// ============================================================
const LINEA_DESPERTAR_ES =
  'El especialista no le contestó; no se preocupe, yo estoy aquí para ayudarle.';
const LINEA_DESPERTAR_EN =
  "The specialist didn't get back to you, don't worry, I'm here to help you.";

/**
 * Punto de entrada público: corre la decisión normal y, si la
 * conversación despertó de needsHuman en este turno, antepone la
 * frase de retomada del dueño a la respuesta (en el idioma de la
 * respuesta: el del flujo si hay uno, si no el del mensaje).
 */
function decidirRespuesta(conversacion, textoCliente, tipoMensaje = 'text') {
  const ctx = { desperto: false, idioma: null };
  const d = decidirRespuestaInterna(conversacion, textoCliente, tipoMensaje, ctx);
  // Las respuestas post-cierre de una orden (sinPrefijoDespertar)
  // NUNCA llevan la frase de retomada: tras el cierre el
  // especialista sí está atendiendo la orden y la frase no viene
  // al caso (caso real 2026-10-31).
  if (d.responder && ctx.desperto && !d.sinPrefijoDespertar) {
    const idioma = ctx.idioma || detectarIdioma(textoCliente);
    d.texto = `${idioma === 'en' ? LINEA_DESPERTAR_EN : LINEA_DESPERTAR_ES}\n${d.texto}`;
  }
  return d;
}

module.exports = {
  detectarIntent,
  construirRespuesta,
  decidirRespuesta,
  listarRespuestas,
  esIntentValido,
  INTENTS,
  // Exportados para pruebas del flujo:
  extraerDatos,
  armarConfirmacion,
  fechaCortaEntrega,
  esPreguntaPrecio,
  preguntaSobreAire,
  recomendacionAire,
  preguntaCuandoPedir,
  preguntaPagoAdelantado,
  preguntaCoberturaCiudad,
  esSaludoPuro,
  empiezaConSaludo,
  detectarIdioma,
  esCancelacion,
  detectarFAQ,
  detectarCiudad,
  esRespuestaVaga,
  esSinCompania,
};
