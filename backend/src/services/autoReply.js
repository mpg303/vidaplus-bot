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
// (Zelle, tarjeta de débito o tarjeta de crédito). Los datos que
// el cliente ya dio no se vuelven a pedir, y las respuestas cortas
// a mitad del flujo se interpretan como el dato que se está
// pidiendo (jamás se responde el menú genérico a mitad del flujo).
// En el cierre se aclara UNA sola vez que el pago es POR
// ADELANTADO (regla del dueño): en cuanto se confirme el pago se
// carga la orden; el bot todavía NO pide ni envía datos de cobro.
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
      'me atienda alguien', 'persona real', 'jesus', 'morillo',
      'especialista',
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
      'necesito concreto', 'necesito yardas', 'agendar entrega',
      // La gente también pide «cemento» (y mal escrito «semento», o
      // «hormigón»): es lo mismo que concreto y debe abrir el pedido.
      'quiero cemento', 'necesito cemento', 'ocupo cemento',
      'quiero semento', 'necesito semento', 'ocupo semento',
      'quiero hormigon', 'necesito hormigon', 'ocupo hormigon',
      'programar', 'apartar', 'quiero comprar', 'me manda', 'envieme',
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
    pago: null, // forma de pago: «Zelle» | «Tarjeta de débito» | «Tarjeta de crédito» | «Tarjeta»
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
    /\b(sin aire|no aire|no lleva aire|sin entrained air|non[-\s]?air|no air)\b/i.test(raw)
  ) {
    return 'no aire';
  }
  if (/\b(con aire|lleva aire|air[-\s]?entrained)\b/i.test(raw) || /\baire\b/i.test(raw) || /\bair\b/i.test(raw)) {
    return 'con aire';
  }
  return null;
}

/** Quita las frases de aire de un texto (para que no queden dentro del mix). */
function quitarFrasesAire(texto) {
  return (texto || '')
    .replace(/\b(sin aire|no aire|no lleva aire|con aire|lleva aire|non[-\s]?air|no air|air[-\s]?entrained)\b/gi, ' ')
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
    /\b(particular|no tengo compan\w*|sin compan\w*|no tengo empresa|no es empresa|es personal|solo yo|soy yo mismo)\b/i.test(
      normalizar(t)
    );
  const mNombre = t.match(/(?:a nombre de|mi nombre es|nombre)\s*[:\-]?\s*([^,;]+)/i);
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
 * Interpreta la respuesta al paso de la FORMA DE PAGO (el último
 * del flujo): «¿Cómo va a pagar: Zelle, tarjeta de débito o tarjeta
 * de crédito?». Devuelve el valor normalizado — «Zelle», «Tarjeta
 * de débito» o «Tarjeta de crédito» —, o «Tarjeta» a secas si el
 * cliente dijo solo «tarjeta»/«card» sin aclarar (el flujo le
 * pregunta «¿Débito o crédito?» una sola vez), o null si no se
 * entiende ninguna forma de pago.
 */
function extraerPago(raw) {
  const t = normalizar(raw);
  if (/\bzelle\b/.test(t)) return 'Zelle';
  const debito = /\b(debito|debit)\b/.test(t);
  const credito = /\b(credito|credit)\b/.test(t);
  if (debito && !credito) return 'Tarjeta de débito';
  if (credito && !debito) return 'Tarjeta de crédito';
  if (/\b(tarjeta|card)\b/.test(t)) return 'Tarjeta';
  return null;
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

  // --- Yardas (+ plus) ---
  const mYds = raw.match(/(\d+(?:[.,]\d+)?)\s*(?:yds?|yardas?)\b/i);
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
    raw.match(/pasado\s+mañana|mañana|hoy|lunes|martes|miércoles|jueves|viernes|sábado|domingo/i);
  if (mFecha) {
    d.fecha = mFecha[0].trim();
  } else if (paso === 'fecha' && !d.hora && !d.yardas && !pareceDireccion(raw) && !esPreguntaPrecio(raw) && !preguntaSobreAire(raw)) {
    // Respuesta corta al «¿para qué día?»: se toma tal cual
    // (una pregunta de precio jamás se toma como fecha).
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
  // La resistencia se pide como «4000 psi», «3000 libras» o el número
  // solo («cemento 4000»): las tres formas se entienden como el mix.
  // El número solo NO se captura si el mensaje parece una dirección
  // (podría ser el número de la calle).
  const mPsi =
    raw.match(/(\d{3,5})\s*(?:psi|libras)\b/i) ||
    (!esDireccion ? raw.match(/\b(2500|3000|3500|4000|4500|5000|5500|6000)\b/) : null);
  if (mPsi) {
    d.mix = `${mPsi[1]} psi`;
  } else if (paso === 'mix' && !esDireccion && !d.fecha && !d.hora) {
    // En el paso del mix, todo el mensaje ES la descripción del mix
    // (ej. «High early mix / mix 275-P»), tal como la dio el cliente,
    // sin la frase del aire (ese dato va aparte). Una pregunta de
    // precio («¿cuánto sale?») o sobre el aire («¿qué es el aire?»)
    // NO es un mix: no se captura.
    const mixTexto = esPreguntaPrecio(raw) || preguntaSobreAire(raw) ? '' : quitarFrasesAire(raw);
    if (mixTexto) d.mix = mixTexto.replace(/[. ]+$/, '');
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
    !preguntaSobreAire(raw)
  ) {
    // Respuesta corta al «¿cuál es la dirección?»: se toma tal cual
    // (conserva saltos de línea, ej. la línea «Estados Unidos»).
    // Una pregunta de precio jamás se toma como dirección.
    d.direccion = raw.replace(/[. ]+$/, '');
  }

  // --- Nombre y compañía (pasos finales, ya con la orden completa) ---
  // Se piden UNO POR VEZ (primero el nombre, después la compañía),
  // pero si el cliente da los dos juntos se capturan ambos y no se
  // le vuelve a preguntar lo que ya dio.
  // Una pregunta de precio o sobre el aire jamás se toma como nombre.
  if ((paso === 'nombre' || paso === 'compania') && !esPreguntaPrecio(raw) && !preguntaSobreAire(raw)) {
    const cli = extraerNombreCompania(raw);
    if (cli.nombre) d.nombre = cli.nombre;
    if (cli.compania) d.compania = cli.compania;
  }

  // --- Forma de pago (último paso, después de la compañía) ---
  // Si dice solo «tarjeta»/«card» sin aclarar, se marca genérica
  // (d.pagoGenerica): el flujo pregunta «¿Débito o crédito?» una
  // sola vez antes de guardarla como «Tarjeta».
  if (paso === 'pago' && !esPreguntaPrecio(raw) && !preguntaSobreAire(raw)) {
    const pago = extraerPago(raw);
    if (pago === 'Tarjeta') d.pagoGenerica = true;
    else if (pago) d.pago = pago;
  }

  return d;
}

/** Fusiona los datos detectados en el flujo y devuelve los campos nuevos. */
function fusionarDatos(flow, d) {
  const nuevos = [];
  for (const campo of ['yardas', 'mix', 'aire', 'direccion', 'fecha', 'hora', 'slump', 'nombre', 'compania', 'pago']) {
    if (d[campo] && !flow.datos[campo]) {
      flow.datos[campo] = d[campo];
      nuevos.push(campo);
    } else if (d[campo] && campo === 'yardas') {
      flow.datos.yardas = d.yardas; // una corrección de cantidad manda
    }
  }
  if (d.inspeccion) flow.datos.inspeccion = true;
  return nuevos;
}

/** Confirmación breve de un dato recién capturado. */
function confirmacionDe(campo, datos) {
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

/**
 * ¿El cliente está preguntando el PRECIO? Para el dueño, el
 * «¿cuánto?» del cliente siempre es el precio. Se excluyen las
 * preguntas de duración («cuánto tarda/tiempo/demora…»).
 */
function esPreguntaPrecio(texto) {
  const t = normalizar(texto);
  if (/\bhow much\b/.test(t)) return true;
  if (/\bprecio(s)?\b/.test(t) || /\bcosto\b/.test(t) || /\btarifa\b/.test(t)) return true;
  if (/\bcuanto\b/.test(t) && !/\bcuanto\s+(tiempo|tarda|tardan|demora|dura|duran)\b/.test(t)) return true;
  return false;
}

/** Respuesta corta sobre el precio: jamás se da un número. */
const LINEA_PRECIO =
  'El precio depende de la planta y del mix 🏗️ Con los datos de su orden se lo confirmamos enseguida.';

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

/** La pregunta por el dato que falta, en el orden del dueño. */
function preguntaPara(paso, datos) {
  switch (paso) {
    case 'yardas':
      return '¿Cuántas yardas necesita?';
    case 'mix':
      // Con el mix se pregunta también el aire («aire o no aire»);
      // si ya está uno de los dos, se pregunta solo el que falta.
      if (datos.mix && !datos.aire) return '¿Y el concreto va con aire o no aire?';
      if (!datos.mix && datos.aire) return '¿Qué mix o resistencia (PSI) necesita?';
      return '¿Qué mix o resistencia (PSI) necesita? ¿Y el concreto va con aire o no aire?';
    case 'direccion':
      return '¿Cuál es la dirección completa de la obra?';
    case 'fecha':
      // Si ya dio la hora, solo falta el día; si no, se piden juntos,
      // que es como el dueño pregunta («la hora» = día y hora).
      return datos.hora
        ? '¿Para qué día lo necesita?'
        : '¿Para qué día lo necesita y a qué hora en la obra?';
    case 'hora':
      return '¿A qué hora lo necesita en la obra?';
    case 'nombre':
      // Nombre y compañía se piden UNO POR VEZ (orden del dueño):
      // primero solo el nombre…
      return 'Ya casi terminamos 🙏 ¿A nombre de quién queda la orden?';
    case 'compania':
      // …y en cuanto da el nombre, solo la compañía.
      return '¿Y cuál es el nombre de su compañía? Si no tiene compañía y es particular, dígamelo y así lo dejamos.';
    case 'pago':
      // Último dato: la forma de pago (sin pedir datos de cobro).
      return '¿Cómo va a pagar: Zelle, tarjeta de débito o tarjeta de crédito?';
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
  if (/\bmanana\b/.test(t)) return fmt(base + 86400000);
  if (/\bhoy\b/.test(t)) return fmt(base);

  const dias = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 };
  for (const [nombreDia, num] of Object.entries(dias)) {
    if (new RegExp(`\\b${nombreDia}\\b`).test(t)) {
      const hoyDia = new Date(base).getUTCDay();
      return fmt(base + ((num - hoyDia + 7) % 7) * 86400000);
    }
  }
  const meses = {
    enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
    julio: 6, agosto: 7, septiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,
  };
  const mMes = t.match(/(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)/);
  if (mMes) {
    let ms = Date.UTC(Y, meses[mMes[2]], +mMes[1]);
    if (ms < base) ms = Date.UTC(Y + 1, meses[mMes[2]], +mMes[1]);
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
function resumenCliente(datos, nombre) {
  const n = nombre && nombre !== '' ? ` ${nombre}` : '';
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
function manejarFlujo(conversacion, textoCliente, esNuevo, intentDetectado) {
  const flow = conversacion.flow;
  const pasoPedido = pasoActual(flow);
  const detectados = extraerDatos(textoCliente, pasoPedido);
  const nuevos = fusionarDatos(flow, detectados);

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
      if (nuevos.length) {
        partesAire.push(`Perfecto, ${nuevos.map((c) => confirmacionDe(c, flow.datos)).join('; ')}.`);
      }
      partesAire.push(idiomaAire === 'en' ? EXPLICACION_AIRE_EN : EXPLICACION_AIRE_ES);
      partesAire.push(
        flow.datos.aire
          ? preguntaPara(paso, flow.datos)
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
    return {
      responder: true,
      texto: resumenCliente(datos, datos.nombre || conversacion.name),
      intent: flow.tipo,
      topic: flow.tipo === 'pedido' ? 'su pedido' : 'su cotización',
      confirmacionArmada,
    };
  }
  db.setConversationFlow(conversacion.id, flow);
  conversacion.flow = flow;

  const partes = [];
  if (esNuevo) {
    partes.push(
      flow.tipo === 'pedido'
        ? '¡Perfecto, le tomamos su pedido! 🏗️'
        : 'Con gusto le ayudamos con su cotización 🏗️'
    );
  }
  if (nuevos.length) {
    partes.push(`Perfecto, ${nuevos.map((c) => confirmacionDe(c, flow.datos)).join('; ')}.`);
  } else if (!esNuevo) {
    partes.push(`Sigamos con ${flow.tipo === 'pedido' ? 'su pedido' : 'su cotización'} 🏗️`);
  }
  // Pregunta de precio a mitad del flujo (o al abrirlo): respuesta
  // corta SIN números, y el flujo continúa donde iba.
  if (esPreguntaPrecio(textoCliente)) {
    partes.push(LINEA_PRECIO);
  }
  partes.push(preguntaAclararPago ? '¿Débito o crédito?' : preguntaPara(paso, flow.datos));

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
  return (
    /\b(quiero|necesito|ocupo|me urge)\b/.test(t) &&
    /\b(concreto|cemento|semento|hormigon|yarda|yds|cotizacion|mix|mezcla)\b/.test(t)
  );
}

/**
 * Decide si el bot debe responder a un mensaje entrante del cliente.
 * NO responde si:
 *  - el bot está pausado para esa conversación (lo atiende un humano), o
 *  - un ESPECIALISTA respondió hace menos de AUTOREPLY_HUMAN_PAUSE_MIN minutos
 *    (para no interrumpir la conversación humana).
 * Devuelve { responder, texto, intent, topic, motivo, confirmacionArmada? }.
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

  // --- Flujo de cotización/pedido EN CURSO: tiene prioridad.
  // Las respuestas cortas se interpretan como el dato que se pidió;
  // jamás se cae al menú genérico a mitad del flujo.
  if (conversacion.flow && conversacion.flow.datos) {
    if (intent.id === 'humano') {
      // El cliente pidió una persona: se cierra el flujo y se le atiende.
      db.setConversationFlow(conversacion.id, null);
      conversacion.flow = null;
      return {
        responder: true,
        texto: textoEfectivo('humano', conversacion.name),
        intent: 'humano',
        topic: 'hablar con un especialista',
      };
    }
    return manejarFlujo(conversacion, textoCliente, false, intent.id);
  }

  // --- Apertura del flujo de cotización/pedido.
  if (intent.id !== 'humano' && abreFlujo(intent, textoCliente)) {
    conversacion.flow = {
      tipo: intent.id === 'pedido' ? 'pedido' : 'cotizacion',
      datos: datosVacios(),
    };
    return manejarFlujo(conversacion, textoCliente, true, intent.id);
  }

  // --- Pregunta sobre el aire SIN flujo en curso: se explica y se
  // abre el flujo para que la respuesta («con aire»/«no aire») no se
  // pierda y la conversación siga como una cotización.
  const idiomaAireSuelto = intent.id !== 'humano' ? preguntaSobreAire(textoCliente) : null;
  if (idiomaAireSuelto) {
    conversacion.flow = { tipo: 'cotizacion', datos: datosVacios() };
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

  // --- Respuesta normal por intent (comportamiento de siempre).
  const texto = textoEfectivo(intent.id, conversacion.name);
  return { responder: true, texto, intent: intent.id, topic: intent.topic };
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
};
