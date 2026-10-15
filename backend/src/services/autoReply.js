// ============================================================
// Respuestas automáticas del bot (intents básicos en español).
// Todo el texto visible al cliente está en español y usa los datos
// reales del negocio definidos en config.js (NEGOCIO).
// Negocio: JMP Concrete and Dispatch LLC — venta de concreto
// por yarda cúbica en Dallas–Fort Worth.
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
      'me atienda alguien', 'persona real', 'jesus', 'morillo',
    ],
  },
  {
    id: 'cotizacion',
    label: '💲 Cotización',
    topic: 'una cotización',
    keywords: [
      'precio', 'costo', 'cuanto cuesta', 'cuánto cuesta',
      'tarifa', 'cobran', 'vale', 'presupuesto', 'cotizacion',
      'cotización', 'cotizar', 'presio', 'cuanto sale', 'cuanto vale',
    ],
  },
  {
    id: 'pedido',
    label: '🧾 Hacer un pedido',
    topic: 'hacer un pedido',
    keywords: [
      'pedido', 'pedir', 'ordenar', 'quiero concreto', 'quiero yardas',
      'necesito concreto', 'agendar entrega', 'programar', 'apartar',
      'quiero comprar', 'me manda', 'envieme',
    ],
  },
  {
    id: 'entrega',
    label: '🚚 Estatus de entrega',
    topic: 'el estatus de una entrega',
    keywords: [
      'entrega', 'camion', 'camión', 'truck', 'mixer', 'cuando llega',
      'cuándo llega', 'ya viene', 'donde viene', 'estatus', 'status',
      'retraso', 'atrasado', 'llego', 'llegó',
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
  for (const intent of INTENTS) {
    if (keywordsEfectivas(intent).some((k) => t.includes(normalizar(k)))) {
      return intent;
    }
  }
  return { id: 'otro', topic: 'su mensaje', keywords: [] };
}

/**
 * Texto efectivo de una respuesta: si el dueño editó el texto en el panel,
 * se usa ese (con variables {nombre}, {negocio}, {zona}, {telefono}, {horario});
 * si no, el texto de fábrica de construirRespuesta().
 */
function textoEfectivo(intentId, nombre) {
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
  return construirRespuesta(intentId, nombre);
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

/** Construye la respuesta en español para cada intent. */
function construirRespuesta(intentId, nombre) {
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
        `Trabajamos de *${C.horarioTexto}*.\n` +
        `Las entregas se coordinan según disponibilidad de planta.\n\n` +
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
      return (
        `Gracias por escribir a *${C.nombre}* 🏗️.\n` +
        `¿En qué le ayudamos? Puede pedir una *cotización*, hacer un *pedido*, ` +
        `preguntar por una *entrega* o un *pago*.`
      );
  }
}

/**
 * Decide si el bot debe responder a un mensaje entrante del cliente.
 * NO responde si:
 *  - el bot está pausado para esa conversación (lo atiende un humano), o
 *  - un ESPECIALISTA respondió hace menos de AUTOREPLY_HUMAN_PAUSE_MIN minutos
 *    (para no interrumpir la conversación humana).
 * Devuelve { responder, texto, intent, topic, motivo }.
 */
function decidirRespuesta(conversacion, textoCliente) {
  if (conversacion.botPaused) {
    return { responder: false, motivo: 'bot pausado por especialista' };
  }
  const ultimoHumano = db.lastMessageFrom(conversacion.id, 'ESPECIALISTA');
  if (ultimoHumano) {
    const minutos = (Date.now() - new Date(ultimoHumano.timestamp).getTime()) / 60000;
    if (minutos < cfg.autoreplyHumanPauseMin) {
      return { responder: false, motivo: 'especialista activo recientemente' };
    }
  }
  const intent = detectarIntent(textoCliente);
  const texto = textoEfectivo(intent.id, conversacion.name);
  return { responder: true, texto, intent: intent.id, topic: intent.topic };
}

module.exports = { detectarIntent, construirRespuesta, decidirRespuesta, listarRespuestas, esIntentValido, INTENTS };
