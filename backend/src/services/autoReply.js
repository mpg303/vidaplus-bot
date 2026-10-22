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
// el concreto va «con aire o no aire» (regla del dueño): el paso
// del mix no se completa hasta tener mix Y aire. Y AL FINAL, ya
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
// EFECTIVO (regla del dueño, 2026-10-21): NO se acepta efectivo
// en el lugar del trabajo (ahí vienen las estafas); si el cliente
// pide pagar en efectivo, se registra «Efectivo (por adelantado,
// con un encargado)» y se le avisa que el pago se entrega antes,
// encontrándose con un encargado de la compañía.
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
      // Efectivo/cash: la respuesta de esta FAQ incluye la regla
      // del dueño (por adelantado con un encargado, nunca en el
      // lugar del trabajo).
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
    keywords: [
      'hola', 'buenas', 'buenos dias', 'buenas tardes',
      'buenas noches', 'hey', 'saludos', 'que tal', 'qué tal',
      'hello', 'hi', 'good morning', 'good afternoon',
      'good evening', 'buen dia', 'buen día',
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
// REGLA DEL EFECTIVO (orden del dueño, 2026-10-21): el bot NO
// acepta efectivo en el lugar del trabajo (ahí vienen las
// estafas). Si el cliente quiere pagar en efectivo, el pago se
// hace POR ADELANTADO encontrándose con un encargado de la
// compañía, y así queda registrado en la orden.
// ============================================================
const PAGO_EFECTIVO = 'Efectivo (por adelantado, con un encargado)';
const REGLA_EFECTIVO_ES =
  'El pago en efectivo se hace por adelantado: tiene que encontrarse con uno de los encargados de la compañía para entregar el pago antes de que carguemos su orden. No recibimos efectivo en el lugar del trabajo.';
const REGLA_EFECTIVO_EN =
  "Cash payment is made in advance: you would meet with one of our company representatives to hand over the payment before we load your order. We don't accept cash at the jobsite.";

/** Mensaje de la regla del efectivo en el idioma del cliente. */
function mensajeReglaEfectivo(idioma) {
  return idioma === 'en' ? REGLA_EFECTIVO_EN : REGLA_EFECTIVO_ES;
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
        `El precio por yarda depende de la planta y la mezcla, ` +
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
      // de débito, tarjeta de crédito y efectivo. El efectivo va
      // siempre con su regla: por adelantado, encontrándose con un
      // encargado; nunca en el lugar del trabajo.
      return (
        `¡Claro! 🙏 Aceptamos *Zelle*, *tarjeta de débito*, *tarjeta de crédito* y *efectivo*.\n` +
        `El pago es por adelantado: en cuanto se confirme su pago, cargamos su orden.\n` +
        `${REGLA_EFECTIVO_ES}`
      );
    case 'faq_minimo':
      // El mínimo real depende de la planta y la zona: NO se inventa cifra.
      return (
        `El mínimo de yardas lo confirma el especialista, porque depende de la planta ` +
        `y de la zona de su obra 🙏\n` +
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
        `Pricing per yard depends on the plant and the mix, ` +
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
        `we load your order.\n` +
        `${REGLA_EFECTIVO_EN}`
      );
    case 'faq_minimo':
      return (
        `The minimum yardage is confirmed by the specialist, since it ` +
        `depends on the plant and your job's area 🙏\n` +
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
    aire: null, // 'con aire' | 'no aire' — se pide junto con el mix
    direccion: null,
    fecha: null, // texto tal como lo dio el cliente («mañana», «10/20/26»…)
    hora: null, // texto tal como lo dio el cliente («7 am», «10:00 pm»…)
    slump: null,
    inspeccion: false,
    nombre: null, // nombre de la persona — se pide AL FINAL, con la orden completa
    compania: null, // nombre de su compañía, o «Particular» si no tiene
    pago: null, // forma de pago: «Zelle» | «Tarjeta de débito» | «Tarjeta de crédito» | «Tarjeta» | «Efectivo (por adelantado, con un encargado)»
  };
}

/** Primer dato que falta según el orden del flujo (null si está completo). */
function pasoActual(flow) {
  return (
    PASOS_FLUJO.find((p) => {
      // El paso del mix exige mix Y aire («aire o no aire»).
      if (p === 'mix') return !flow.datos.mix || !flow.datos.aire;
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

/** Limpia un nombre/compañía capturado (espacios y punto final). */
function limpiarNombre(s) {
  return (s || '').replace(/\s{2,}/g, ' ').replace(/[. ]+$/, '').trim();
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
  const esParticular =
    /\b(particular|no tengo compan\w*|sin compan\w*|no tengo empresa|no es empresa|es personal|solo yo|soy yo mismo|no company|just personal|don'?t have a company|dont have a company|it'?s personal)\b/i.test(
      normalizar(t)
    );
  const mNombre = t.match(/(?:a nombre de|mi nombre es|my name is|soy|nombre)\s*[:\-]?\s*([^,;]+)/i);
  const mComp = t.match(/(?:compa[ñn][ií]a|empresa|negocio|company)\s*(?:es|se llama)?\s*[:\-]?\s*(.+)$/i);
  if (mComp && !esParticular) out.compania = limpiarNombre(mComp[1]);
  if (mNombre) {
    out.nombre = limpiarNombre(
      mNombre[1].replace(/(?:compa[ñn][ií]a|empresa|negocio|company).*$/i, '')
    );
  }
  if (!out.nombre && !out.compania) {
    const partes = t.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    if (partes.length >= 2) {
      out.nombre = limpiarNombre(partes[0].replace(/^a nombre de\s*/i, ''));
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
 * lleguen», «cash al entregar»… Ese pago NO se acepta en el lugar
 * del trabajo (regla del dueño, 2026-10-21): va por adelantado,
 * encontrándose con un encargado de la compañía.
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
 * del flujo): «¿Cómo va a pagar: Zelle, tarjeta de débito, tarjeta
 * de crédito o efectivo?» (las cuatro opciones del dueño,
 * 2026-10-21). Devuelve el valor normalizado — «Zelle», «Tarjeta
 * de débito» o «Tarjeta de crédito» —, o «Tarjeta» a secas si el
 * cliente dijo solo «tarjeta»/«card» sin aclarar (el flujo le
 * pregunta «¿Débito o crédito?» una sola vez), o «Efectivo (por
 * adelantado, con un encargado)» si pidió pagar en efectivo, o
 * null si no se entiende ninguna forma de pago.
 */
function extraerPago(raw) {
  const t = normalizar(raw);
  // El efectivo manda sobre las demás palabras: quien dice
  // «efectivo» (o «cash», «pago cuando lleguen»…) quiere pagar en
  // efectivo, y eso se registra SOLO como pago por adelantado con
  // un encargado — nunca como pago en el lugar del trabajo.
  if (esPagoEfectivo(raw)) return PAGO_EFECTIVO;
  if (/\bzelle\b/.test(t)) return 'Zelle';
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
  if (/\b(llegan|entregan|cubren|van a|deliver|cover|go to|reach)\b/.test(t)) return ciudad;
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
  const mYds = raw.match(/(\d+(?:[.,]\d+)?)\s*(?:yds?|yards?|yardas?)\b/i);
  if (mYds) {
    d.yardas = {
      cantidad: mYds[1].replace(',', '.'),
      plus: /\bplus\b/i.test(raw) || raw.includes('+'),
    };
  } else if (paso === 'yardas') {
    const mNum = raw.match(/^[^0-9]*(\d+(?:[.,]\d+)?)[^0-9]*$/);
    if (mNum) {
      d.yardas = { cantidad: mNum[1].replace(',', '.'), plus: /\bplus\b/i.test(raw) };
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
  const mSlump =
    raw.match(/slump\D{0,4}(\d+(?:[.,]\d+)?)/i) ||
    raw.match(/(\d+(?:[.,]\d+)?)\s*(?:de\s+)?slump/i);
  if (mSlump) d.slump = mSlump[1].replace(',', '.');
  if (/\binspecci[oó]n\b|\binspection\b/i.test(raw)) d.inspeccion = true;

  // --- Hora ---
  const mHora =
    raw.match(/(\d{1,2}(?::\d{2})?\s*(?:a\.?\s?m\.?|p\.?\s?m\.?))/i) ||
    raw.match(/a las\s+(\d{1,2}(?::\d{2})?)/i);
  if (mHora) d.hora = mHora[1].trim();

  // --- Fecha (día de la entrega) ---
  const mFecha =
    raw.match(/\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/) ||
    raw.match(/\d{1,2}\s+de\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)/i) ||
    raw.match(/pasado\s+mañana|mañana|hoy|lunes|martes|miércoles|jueves|viernes|sábado|domingo|tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday/i);
  if (mFecha) {
    d.fecha = mFecha[0].trim();
  } else if (
    paso === 'fecha' && !d.hora && !d.yardas && !pareceDireccion(raw) &&
    !esPreguntaPrecio(raw) && !preguntaSobreAire(raw) && !correccion && !vaga
  ) {
    // Respuesta corta al «¿para qué día?»: se toma tal cual
    // (una pregunta de precio jamás se toma como fecha, y un
    // «ok» tampoco es una fecha).
    d.fecha = raw.replace(/[. ]+$/, '');
  }

  const esDireccion = pareceDireccion(raw);

  // --- Aire (va junto con el mix: «aire o no aire») ---
  // Si el mensaje PREGUNTA sobre el aire («¿qué es el aire?»), la
  // palabra «aire» es parte de la pregunta, no una respuesta: no se
  // captura como dato (el bot explica y vuelve a preguntar).
  const aire = preguntaSobreAire(raw) ? null : extraerAire(raw);
  if (aire) d.aire = aire;

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
  const NUMS_MIX = '2500|3000|3500|4000|4500|5000|5500|6000';
  const producto = detectarProducto(raw);
  const mPsi =
    raw.match(/(\d{3,5})\s*(?:psi|libras)\b/i) ||
    raw.match(new RegExp(`\\bde\\s+(${NUMS_MIX})\\b`, 'i')) ||
    raw.match(new RegExp(`\\b(${NUMS_MIX})\\s+(?:con|sin)\\s+aire\\b`, 'i')) ||
    raw.match(new RegExp(`\\b(?:mix|mezcla)\\s*(?:de\\s*)?(${NUMS_MIX})\\b`, 'i')) ||
    (!esDireccion ? raw.match(new RegExp(`\\b(${NUMS_MIX})\\b`)) : null);
  if (producto) {
    d.mix = producto;
  } else if (mPsi) {
    d.mix = `${mPsi[1]} psi`;
  } else if (paso === 'mix' && !esDireccion && !d.fecha && !d.hora && !correccion && !vaga) {
    // En el paso del mix, el mensaje puede ser la descripción del
    // mix (ej. «High early mix / mix 275-P»), tal como la dio el
    // cliente, sin la frase del aire (ese dato va aparte). Pero
    // SOLO si parece un mix de verdad: «gracias» o texto basura
    // NO se anotan como mix (se re-pregunta con ejemplos). Una
    // pregunta de precio o sobre el aire tampoco es un mix.
    const mixTexto = esPreguntaPrecio(raw) || preguntaSobreAire(raw) ? '' : quitarFrasesAire(raw);
    if (mixTexto && pareceMix(mixTexto)) d.mix = mixTexto.replace(/[. ]+$/, '');
  } else {
    const mMix = raw.match(/\b(?:mix|mezcla)\b[^,.;]*/i);
    if (mMix) d.mix = quitarFrasesAire(mMix[0]).replace(/[. ]+$/, '');
  }

  // --- Dirección ---
  if (esDireccion) {
    const dir = capturarDireccion(raw);
    if (dir) d.direccion = dir;
  } else if (
    paso === 'direccion' &&
    !d.mix &&
    !d.yardas &&
    !d.fecha &&
    !d.hora &&
    !esPreguntaPrecio(raw) &&
    !preguntaSobreAire(raw) &&
    !correccion &&
    !vaga
  ) {
    // Respuesta corta al «¿cuál es la dirección?»: se toma tal cual
    // (conserva saltos de línea, ej. la línea «Estados Unidos»).
    // Una pregunta de precio jamás se toma como dirección.
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
    if (!vaga && (!correccion || hayMarcador)) {
      const cli = extraerNombreCompania(raw);
      if (cli.nombre) d.nombre = cli.nombre;
      if (cli.compania) d.compania = cli.compania;
    }
  } else if (!esPreguntaPrecio(raw) && !preguntaSobreAire(raw)) {
    const adelantado = extraerNombreAdelantado(raw);
    if (adelantado.nombre) d.nombre = adelantado.nombre;
    if (adelantado.compania) d.compania = adelantado.compania;
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
      // Efectivo: queda registrado como pago por adelantado con
      // un encargado, y el flujo avisa la regla en este turno.
      if (pagoDetectado === PAGO_EFECTIVO) d.pagoEfectivo = true;
    }
  } else if (
    pagoDetectado &&
    pagoDetectado !== 'Tarjeta' &&
    /\b(pago|pagar|pay|zelle|debito|debit|credito|credit|efectivo|cash)\b/i.test(normalizar(raw))
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
  for (const campo of ['yardas', 'mix', 'aire', 'direccion', 'fecha', 'hora', 'slump', 'nombre', 'compania', 'pago']) {
    if (!d[campo]) continue;
    const habia = flow.datos[campo];
    if (!habia) {
      flow.datos[campo] = d[campo];
      aplicados.push(campo);
    } else if (JSON.stringify(habia) !== JSON.stringify(d[campo])) {
      if (campo === 'yardas' || d.correccion) {
        flow.datos[campo] = d[campo];
        corregidos.push(campo);
      }
    }
  }
  if (d.inspeccion) flow.datos.inspeccion = true;
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
  if (pago === PAGO_EFECTIVO) return 'Cash (in advance, with a company representative)';
  return pago;
}

/** Confirmación breve de un dato recién capturado. */
function confirmacionDe(campo, datos, idioma = 'es') {
  if (idioma === 'en') {
    switch (campo) {
      case 'yardas':
        return `got it: *${datos.yardas.cantidad} yds${datos.yardas.plus ? ' plus' : ''}*`;
      case 'mix':
        return `got the mix: *${datos.mix}*`;
      case 'aire':
        return `noted: concrete *${aireDisplay(datos.aire, idioma)}*`;
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
      default:
        return 'noted';
    }
  }
  switch (campo) {
    case 'yardas':
      return `anotadas las *${datos.yardas.cantidad} yds${datos.yardas.plus ? ' plus' : ''}*`;
    case 'mix':
      return `anotado el mix: *${datos.mix}*`;
    case 'aire':
      return `anotado: concreto *${datos.aire}*`;
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
        return `changed to the mix: *${datos.mix}*`;
      case 'aire':
        return `changed to: concrete *${aireDisplay(datos.aire, idioma)}*`;
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
      default:
        return 'updated';
    }
  }
  switch (campo) {
    case 'yardas':
      return `lo dejo en *${datos.yardas.cantidad} yds${datos.yardas.plus ? ' plus' : ''}*`;
    case 'mix':
      return `lo dejo en el mix: *${datos.mix}*`;
    case 'aire':
      return `lo dejo: concreto *${datos.aire}*`;
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
    default:
      return 'lo dejo anotado';
  }
}

/**
 * ¿El mensaje es SOLO un saludo? («hola», «buenas», «hello»,
 * «buenas tardes», «hola buenas»…). Cuando un cliente retoma una
 * conversación a mitad del flujo y escribe un saludo, el bot debe
 * RETOMAR donde iba (volver a preguntar el dato que falta), nunca
 * guardar el saludo como si fuera un dato (mix, dirección, fecha
 * o nombre) ni mandar la bienvenida de nuevo.
 */
function esSaludoPuro(texto) {
  const t = normalizar(texto)
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return false;
  const frases = [
    'buenas noches', 'buenas tardes', 'buenos dias', 'buen dia',
    'good afternoon', 'good evening', 'good morning',
    'que tal', 'hola', 'buenas', 'hello', 'hi', 'hey', 'saludos',
  ];
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
  'El precio depende de la planta y del mix. Con los datos de su orden se lo confirmamos enseguida.';
const LINEA_PRECIO_EN =
  "Price depends on the plant and the mix. With your order details we'll confirm it right away.";

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
        if (datos.mix && !datos.aire) {
          return conEjemplo
            ? 'Does the concrete need air or no air? Air helps against cold weather in outdoor work; indoor floors are usually ordered without air.'
            : 'And does the concrete need it with air or no air?';
        }
        if (!datos.mix && datos.aire) {
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
        return 'How will you pay: Zelle, debit card, credit card or cash?';
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
      if (datos.mix && !datos.aire) {
        return conEjemplo
          ? '¿El concreto va con aire o no aire? El aire ayuda contra el frío en trabajos de exterior; para interiores suele pedirse sin aire.'
          : '¿Y el concreto va con aire o no aire?';
      }
      if (!datos.mix && datos.aire) {
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
      // Cuatro opciones (orden del dueño, 2026-10-21): Zelle,
      // tarjeta de débito, tarjeta de crédito y efectivo — el
      // efectivo con su regla de pago por adelantado con un
      // encargado (nunca en el lugar del trabajo).
      return '¿Cómo va a pagar: Zelle, tarjeta de débito, tarjeta de crédito o efectivo?';
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
    `${datos.mix}${datos.aire ? ` ${datos.aire}` : ''}`,
    `${datos.direccion}`,
    `${datos.hora} jobsite`,
    `Slump${datos.slump ? ` ${datos.slump}` : ''}${datos.inspeccion ? ' (inspection)' : ''}`,
    'Order number',
  ];
  // Al final va la forma de pago que eligió el cliente (línea
  // nueva; las líneas del formato del dueño no cambian).
  if (datos.pago) lineas.push(`Pago: ${datos.pago}`);
  return lineas.join('\n');
}

/** Cierre corto al cliente cuando el flujo queda completo. */
function resumenCliente(datos, nombre, idioma = 'es') {
  const n = nombre && nombre !== '' ? ` ${nombre}` : '';
  if (idioma === 'en') {
    return (
      `All set${n}! ✅ Your order is registered:\n` +
      `• ${datos.yardas.cantidad} yds${datos.yardas.plus ? ' plus' : ''}\n` +
      `• Mix: ${datos.mix}${datos.aire ? `, ${aireDisplay(datos.aire, idioma)}` : ''}\n` +
      `• Address: ${datos.direccion}\n` +
      `• Day: ${datos.fecha} — ${datos.hora}\n` +
      (datos.pago ? `• Payment: ${pagoDisplay(datos.pago, idioma)}\n` : '') +
      `\nWe'll confirm price and availability right away. ` +
      `A specialist will help you right here. 🙏\n` +
      // Same rule as in Spanish: payment is IN ADVANCE, said once.
      `Payment is in advance: as soon as your payment is confirmed, we load your order. 🚛`
    );
  }
  return (
    `¡Listo${n}! ✅ Ya quedó registrada su orden:\n` +
    `• ${datos.yardas.cantidad} yds${datos.yardas.plus ? ' plus' : ''}\n` +
    `• Mix: ${datos.mix}${datos.aire ? `, ${datos.aire}` : ''}\n` +
    `• Dirección: ${datos.direccion}\n` +
    `• Día: ${datos.fecha} — ${datos.hora}\n` +
    (datos.pago ? `• Pago: ${datos.pago}\n` : '') +
    `\nLe confirmamos precio y disponibilidad en seguida. ` +
    `Un especialista le atiende por aquí mismo. 🙏\n` +
    // Regla del dueño: el pago es POR ADELANTADO. Se avisa UNA
    // sola vez, aquí en el cierre (no en la pregunta del pago);
    // el bot todavía no pide ni envía datos de cobro.
    `El pago es por adelantado: en cuanto se confirme su pago, cargamos su orden. 🚛`
  );
}

/**
 * Avanza el flujo con un mensaje del cliente.
 * `esNuevo` = el flujo se acaba de abrir con este mensaje.
 * Devuelve la decisión de respuesta (mismo formato que decidirRespuesta),
 * con `confirmacionArmada` cuando el flujo se completa.
 */
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

function manejarFlujo(conversacion, textoCliente, esNuevo, intentDetectado) {
  const flow = conversacion.flow;
  if (!flow.idioma) flow.idioma = detectarIdioma(textoCliente);
  const idioma = flow.idioma;
  flow.turnos = (flow.turnos || 0) + 1;
  const pasoPedido = pasoActual(flow);

  // Mensajes que NO son un dato del paso actual: saludo puro
  // (retoma), pregunta frecuente, pregunta de cobertura por
  // ciudad, o «no sé cuántas yardas» sin medidas. Esos textos
  // jamás se guardan como mix, dirección, fecha ni nombre.
  const saludoPuro = esSaludoPuro(textoCliente);
  const faq = saludoPuro ? null : detectarFAQ(textoCliente);
  const ciudad = !saludoPuro && !faq ? preguntaCoberturaCiudad(textoCliente) : null;
  const noSabe = pasoPedido === 'yardas' && !saludoPuro && esNoSabeYardas(textoCliente);

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
  const { aplicados: nuevos, corregidos } = omitirCaptura
    ? { aplicados: [], corregidos: [] }
    : fusionarDatos(flow, detectados);

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
    db.setConversationFlow(conversacion.id, null);
    conversacion.flow = null;
    const textoResumen = resumenCliente(datos, datos.nombre || conversacion.name, idioma);
    return {
      responder: true,
      // Si el pago es en efectivo, el mensaje de la regla va
      // primero y el cierre normal sigue enseguida.
      texto:
        datos.pago === PAGO_EFECTIVO && avisoEfectivo
          ? `${mensajeReglaEfectivo(idioma)}\n${textoResumen}`
          : textoResumen,
      intent: flow.tipo,
      topic: flow.tipo === 'pedido' ? 'su pedido' : 'su cotización',
      confirmacionArmada,
    };
  }

  // ---- Anti-bucle: contar intentos fallidos en el MISMO paso ----
  const huboAvance =
    nuevos.length > 0 || corregidos.length > 0 || preguntaAclararPago || paso !== pasoPedido;
  const preguntaLegitima =
    saludoPuro || !!faq || !!ciudad || (noSabe && !detectados.medidas) ||
    esPreguntaPrecio(textoCliente) || !!preguntaSobreAire(textoCliente) || !!detectados.medidas;
  if (huboAvance) {
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
  if (avisoEfectivo) {
    // El cliente dio el efectivo por adelantado a mitad del flujo:
    // se le avisa la regla ahora y el flujo sigue su curso.
    partes.push(mensajeReglaEfectivo(idioma));
  }
  if (detectados.medidas) {
    partes.push(lineaMedidas(detectados.medidas, idioma));
  } else if (
    !esNuevo && !nuevos.length && !corregidos.length &&
    !faq && !ciudad && !noSabe && !escalado
  ) {
    partes.push(prefijoContinuacion(flow, idioma));
  }
  if (faq) {
    partes.push(textoEfectivo(faq, conversacion.name, idioma));
  }
  if (ciudad) {
    partes.push(lineaCiudad(ciudad, idioma));
  }
  if (noSabe && !detectados.medidas) {
    partes.push(lineaNoSabeYardas(idioma));
  }
  // Pregunta de precio a mitad del flujo (o al abrirlo): respuesta
  // corta SIN números, y el flujo continúa donde iba.
  if (esPreguntaPrecio(textoCliente)) {
    partes.push(idioma === 'en' ? LINEA_PRECIO_EN : LINEA_PRECIO);
  }
  if (escalado) {
    partes.push(textoEscalado(paso, flow.datos, idioma));
  } else {
    partes.push(
      preguntaAclararPago
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
 *  - el bot está pausado para esa conversación (lo atiende un humano), o
 *  - un ESPECIALISTA respondió hace menos de AUTOREPLY_HUMAN_PAUSE_MIN minutos
 *    (para no interrumpir la conversación humana).
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
  if (conversacion.botPaused) {
    return { responder: false, motivo: 'bot pausado por especialista' };
  }
  const ultimoHumano = db.lastMessageFrom(conversacion.id, 'ESPECIALISTA');
  const minutosHumano = ultimoHumano
    ? (Date.now() - new Date(ultimoHumano.timestamp).getTime()) / 60000
    : null;

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
    return {
      responder: true,
      texto:
        (idiomaAireSuelto === 'en' ? EXPLICACION_AIRE_EN : EXPLICACION_AIRE_ES) +
        '\n' +
        (idiomaAireSuelto === 'en'
          ? 'Does your concrete need it with air or no air?'
          : '¿Su concreto lo necesita con aire o no aire?'),
      intent: 'aire',
      topic: 'qué es el aire en el concreto',
    };
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

  // --- Respuesta normal por intent (comportamiento de siempre).
  const texto = textoEfectivo(intent.id, conversacion.name, idiomaMsg);
  return { responder: true, texto, intent: intent.id, topic: intent.topic };
}

// ============================================================
// FRASE DE RETOMADA AL DESPERTAR (palabras exactas del dueño,
// 2026-10-21): cuando el bot retoma una conversación porque el
// especialista NO contestó, su primer mensaje al cliente abre
// con esta frase y de ahí sigue ayudándole con lo que pida.
// ============================================================
const LINEA_DESPERTAR_ES =
  'El especialista no te contestó, no te preocupes, yo estoy aquí para ayudarte.';
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
  if (d.responder && ctx.desperto) {
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
  esSaludoPuro,
  detectarIdioma,
  esCancelacion,
  detectarFAQ,
  detectarCiudad,
  esRespuestaVaga,
};
