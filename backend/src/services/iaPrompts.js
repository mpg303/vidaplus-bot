// ============================================================
// Capa de prompts con IA — «🧩 Prompts» del panel
// (orden de Jesus 2026-11-03: «coloca uno para colocar los
// prompts y identificar qué prompts tiene instalados, así
// podemos ir probando cada uno» — instalado en el bot de JMP
// porque el prompt a probar es de construcción).
//
// Espejo de la capa de instrucciones IA del bot de la clínica
// (vidaplus-bot-clinica, services/iaInstrucciones.js), adaptada:
// allá hay UN texto libre del dueño; aquí hay una LISTA de
// prompts con nombre (db.prompts) y solo manda el que tenga
// activo=true — a lo sumo uno a la vez (ver db.js).
//
// Cómo funciona:
// - El dueño instala prompts desde el panel; quedan en el
//   estado del bot (db.prompts, persistido en Supabase
//   jmp_state por el mecanismo de siempre de db.js).
// - Esta capa se consulta SOLO cuando el mensaje del cliente
//   no cayó en ningún flujo fijo (el webhook la llama únicamente
//   con intent «otro» y mensajes de texto reales). Los flujos
//   fijos (cotización, pedido, post-cierre…) NUNCA pasan por
//   aquí.
// - La IA recibe: el prompt ACTIVO del dueño + la base de
//   conocimiento VERIFICADA de JMP (la misma fuente de verdad
//   de autoReply.js: precios de mixes en Dallas, mixes que
//   existen, impuestos, proceso de orden) + el mensaje del
//   cliente, y decide: una respuesta corta en el idioma del
//   cliente, o «SIN_PROMPT» cuando el prompt no aplica.
// - Si la IA no aplica, no responde o falla → null, y el
//   webhook sigue con el comportamiento actual de «otro»
//   (la respuesta de siempre). Nada cambia.
// - SIN CLAVE (IA_API_KEY vacía) la capa está APAGADA: no hace
//   ninguna llamada y el bot se comporta exactamente como hoy.
//   Los prompts quedan instalados, pero el bot aún no los usa.
//
// Lo que esta capa NUNCA puede pisar (manda la regla fija):
// - precios y datos verificados (además del prompt, la salida
//   se valida: cualquier monto $ que no exista en los datos
//   verificados descarta la respuesta entera);
// - los flujos fijos de cotización/pedido y sus cierres;
// - la escalación a humano de los intents que la tienen
//   (esta capa solo sustituye el TEXTO de la decisión «otro»).
// ============================================================
const { cfg, NEGOCIO } = require('../config');
const db = require('../db');
const { PRECIOS_MIX, IMPUESTOS_PCT, RECARGO_CREDITO_PCT } = require('./autoReply');

const MARCA_SIN_PROMPT = 'SIN_PROMPT';
const CACHE_MS = 30000; // caché breve del prompt activo guardado
const MAX_TEXTO_IA = 700; // una respuesta de WhatsApp: corta o no sale

let cachePrompt = null; // { prompt, leidoEn }
let transporte = null; // inyectable para pruebas (patrón de la casa)

/** ¿Está la capa activa? Solo con la clave del proveedor presente. */
function iaActiva() {
  return Boolean(cfg.iaApiKey);
}

/** El prompt activo del dueño, con caché breve (se lee del estado). */
function obtenerPromptActivo() {
  const ahora = Date.now();
  if (cachePrompt && ahora - cachePrompt.leidoEn < CACHE_MS) {
    return cachePrompt.prompt;
  }
  let prompt = null;
  try {
    const p = db.getPromptActivo();
    if (p && String(p.texto || '').trim()) {
      prompt = { id: p.id, nombre: p.nombre || '', texto: p.texto };
    }
  } catch {
    prompt = null;
  }
  cachePrompt = { prompt, leidoEn: ahora };
  return prompt;
}

/** Las rutas del panel la llaman al guardar: lo nuevo aplica ya. */
function invalidarCachePrompts() {
  cachePrompt = null;
}

/**
 * Puerta de entrada: ¿este mensaje debe consultar la capa IA?
 * SOLO decisiones «otro» (ningún flujo fijo lo cubrió) y SOLO
 * mensajes de texto reales del cliente (los toques de botón o
 * interactivos no se interpretan con IA).
 */
function debeConsultarIA(decision, tipoMensaje) {
  return Boolean(
    decision &&
    decision.responder &&
    decision.intent === 'otro' &&
    tipoMensaje === 'text'
  );
}

// ---------------- Base de conocimiento verificada ----------------
// Se arma desde autoReply.js (PRECIOS_MIX y constantes: la misma
// fuente de verdad de las respuestas y cotizaciones del bot).
// Si un dato no está aquí, la IA no puede afirmarlo: por eso el
// prompt le prohíbe salir de esta base.

function baseConocimientoTexto() {
  const precios = Object.entries(PRECIOS_MIX)
    .map(([mix, precio]) => `${mix} $${precio} por yarda`)
    .join('; ');
  return [
    `Empresa: ${NEGOCIO.nombre} — venta y despacho de concreto por yarda cúbica. Zona: ${NEGOCIO.zona}. WhatsApp: ${NEGOCIO.whatsapp}. Correo: ${NEGOCIO.email}. Horario: ${NEGOCIO.horarioTexto}.`,
    `Mixes que existen (los ÚNICOS): 3000, 3500, 3600, 4000, 4500 y 5000 psi, más la Pompa mix 50-50 (mix para pompas de arrastre). Cualquier otro PSI NO existe; algo especial requiere solicitar un mix design o submittal. Los nombres de diseño de una planta no se utilizan.`,
    `Precios por yarda SOLO para trabajos en Dallas: ${precios}. Todo total incluye los taxes de Texas del ${IMPUESTOS_PCT}%. El precio depende de la DIRECCIÓN del trabajo y del mix, nunca de la planta. Fuera de Dallas no hay total automático: lo confirma el equipo. La Pompa mix 50-50 no tiene total automático: lo confirma el equipo.`,
    `Pompa: JMP NO vende ni ofrece servicio de pompa ni de bombeo (aclaración del dueño, 2026-11-04): la pompa la pone el cliente con su proveedor. En la orden solo se pregunta qué pompa va a usar el cliente para saber el MIX: con pompa de arrastre (trailer pump) el mix es el «Trailer pump mix 50-50» (el psi base + $5 por yarda) y con boom pump el mix es el psi tal cual; la orden cierra con su total como cualquier otra. Si el cliente pide que JMP le consiga una pompa, el bot NO lo promete ni lo cotiza: ese caso lo atiende el equipo.`,
    `Proceso de orden: para cotizar o pedir, el bot pide la cantidad de yardas, el mix, si lleva aire, si ocupa pompa, la dirección del trabajo, la fecha y la hora de entrega, el nombre y la compañía; con esos datos coloca primero la orden completa con los precios (en Dallas) y DESPUÉS pregunta el método de pago.`,
    `Métodos de pago: efectivo, Zelle, tarjeta de débito, tarjeta de crédito y cheque. La tarjeta de crédito suma un cargo por procesamiento del ${RECARGO_CREDITO_PCT}% al total. Solo el pago por Zelle se envía antes de cargar el concreto, a ${NEGOCIO.email}; el efectivo, la tarjeta de débito y el cheque NO se pagan por adelantado.`,
    `Los domingos por lo general no se trabaja: un pedido para domingo no se rechaza, se pasa al equipo como posible caso especial.`,
  ].join('\n');
}

/** Montos $ permitidos en una respuesta de la IA (los verificados). */
function montosVerificados() {
  return new Set(Object.values(PRECIOS_MIX).filter((v) => typeof v === 'number'));
}

// ---------------- Prompt ----------------

function construirMensajes({ prompt, textoCliente, idioma }) {
  const sistema = [
    `Eres el asistente virtual de ${NEGOCIO.nombre}, una empresa de venta y despacho de concreto en Dallas–Fort Worth, TX.`,
    'Un mensaje de un cliente NO coincidió con ningún tema fijo del bot. El dueño de la empresa dejó un PROMPT escrito por él para casos como este: tu trabajo es aplicar lo que ese prompt manda, si aplica.',
    '',
    `PROMPT ACTIVO DEL DUEÑO («${prompt.nombre || 'sin nombre'}»; manda lo que aplique; no inventes instrucciones nuevas):`,
    '"""',
    String(prompt.texto || '').trim(),
    '"""',
    '',
    'DATOS VERIFICADOS DE LA EMPRESA (única fuente de verdad sobre la empresa; nunca afirmes datos que no estén aquí):',
    baseConocimientoTexto(),
    '',
    'REGLAS QUE NUNCA PUEDES ROMPER:',
    `- Si el prompt del dueño NO aplica claramente a este mensaje, responde EXACTAMENTE esto y nada más: ${MARCA_SIN_PROMPT}`,
    '- No respondas preguntas generales que el prompt no cubra: para eso también va SIN_PROMPT.',
    '- Nunca des precios, montos ni datos que no estén en los DATOS VERIFICADOS. Nunca inventes montos. Los totales de una orden dependen de las yardas y la dirección: no calcules totales tú.',
    '- No tomes pedidos ni pidas los datos de la orden (yardas, mix, dirección, fecha, nombre): eso lo hacen los flujos fijos del bot.',
    '- Respuesta CORTA (máximo unas 60 palabras), clara y profesional, trato de usted, en el idioma del cliente, con máximo UNA pregunta.',
    '- Sin saludos largos ni menús: responde solo lo que el prompt manda para este mensaje.',
  ].join('\n');
  return [
    { role: 'system', content: sistema },
    {
      role: 'user',
      content: `Mensaje del cliente (${idioma === 'en' ? 'inglés' : 'español'}):\n${String(textoCliente || '')}`,
    },
  ];
}

// ---------------- Validación de la salida ----------------
// La regla fija manda sobre la IA: si la salida se sale de lo
// verificado, se descarta entera y el bot sigue como hoy.

function validarRespuestaIA(cruda) {
  if (typeof cruda !== 'string') return null;
  let texto = cruda.trim().replace(/^```[a-z]*\s*/i, '').replace(/```$/, '').trim();
  if (!texto) return null;
  if (texto.toUpperCase().includes(MARCA_SIN_PROMPT)) return null;
  if (texto.length > MAX_TEXTO_IA) return null;
  // Cualquier monto $ mencionado debe existir en los datos verificados.
  const permitidos = montosVerificados();
  const montos = texto.match(/\$\s?\d+(?:[.,]\d{1,2})?/g) || [];
  for (const m of montos) {
    const valor = parseFloat(m.replace(/[$\s]/g, '').replace(',', '.'));
    if (!permitidos.has(valor)) return null;
  }
  return texto;
}

// ---------------- Transporte (API del proveedor) ----------------
// Compatible con la API de chat de OpenAI (y cualquier proveedor
// compatible). fetch global de Node >= 18, sin dependencias.

async function transporteOpenAI(mensajes) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.iaTimeoutMs || 12000);
  try {
    const resp = await fetch(`${cfg.iaBaseUrl}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.iaApiKey}`,
      },
      body: JSON.stringify({
        model: cfg.iaModelo,
        messages: mensajes,
        temperature: 0.2,
        max_tokens: 220,
      }),
    });
    if (!resp.ok) throw new Error(`proveedor IA respondió ${resp.status}`);
    const data = await resp.json();
    return data?.choices?.[0]?.message?.content || '';
  } finally {
    clearTimeout(timer);
  }
}

function fijarTransporte(fn) {
  transporte = typeof fn === 'function' ? fn : null;
}

// ---------------- Punto de entrada del webhook ----------------

/**
 * Intenta responder un mensaje «otro» siguiendo el prompt
 * ACTIVO del dueño. Devuelve { texto } si la IA aplicó el
 * prompt; null en cualquier otro caso (capa apagada, sin
 * prompt activo, prompt no aplicable, error o salida
 * inválida): el webhook conserva entonces el comportamiento
 * actual de «otro».
 */
async function responderConPromptActivo({ texto, idioma = 'es' } = {}) {
  if (!iaActiva()) return null;
  const prompt = obtenerPromptActivo();
  if (!prompt) return null; // sin prompt activo no hay nada que interpretar
  try {
    const mensajes = construirMensajes({ prompt, textoCliente: texto, idioma });
    const cruda = await (transporte || transporteOpenAI)(mensajes);
    const validada = validarRespuestaIA(cruda);
    if (!validada) return null;
    return { texto: validada };
  } catch (e) {
    console.error('[ia] la capa de prompts falló; sigue el flujo normal de «otro»:', e.message);
    return null;
  }
}

module.exports = {
  iaActiva,
  obtenerPromptActivo,
  invalidarCachePrompts,
  debeConsultarIA,
  baseConocimientoTexto,
  construirMensajes,
  validarRespuestaIA,
  responderConPromptActivo,
  fijarTransporte,
  MARCA_SIN_PROMPT,
};
