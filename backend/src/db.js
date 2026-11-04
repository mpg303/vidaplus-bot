// ============================================================
// Almacenamiento del bot: conversaciones, mensajes, seguimientos,
// campañas y sesiones.
//
// PERSISTENCIA PERMANENTE (Supabase): el estado completo vive en
// la tabla propia de JMP `public.jmp_state` (fila «bot_db», JSONB)
// del proyecto Supabase existente. Render Free borra el disco en
// cada reinicio, así que db.json ya NO es la fuente de verdad:
// - Al arrancar, db.js descarga el estado desde Supabase (server.js
//   espera a db.ready() antes de escuchar) y lo deja en la caché
//   en memoria, que es con lo que trabaja todo el código (la
//   interfaz de este módulo sigue siendo síncrona, como siempre).
// - Cada save() escribe el db.json local (respaldo del proceso) Y
//   sube el estado completo a Supabase (con debounce, en segundo
//   plano). Como siempre se sube el estado ENTERO, un fallo de red
//   se cura solo con el siguiente guardado.
// - Si faltan SUPABASE_URL / SUPABASE_SERVICE_KEY (o
//   SUPABASE_ANON_KEY), se trabaja solo con db.json local,
//   exactamente como antes de esta migración.
// La escritura local es atómica (tmp + rename) para no corromper
// el archivo.
// ============================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { cfg } = require('./config');

const DB_FILE = path.join(cfg.dataDir, 'db.json');

function vacia() {
  return {
    conversations: [], // { id, waId, name, lastMessageAt, lastPreview, unread, botPaused, botPausedAt, needsHuman, needsHumanAt, surveySentAt, flow, docsTarjeta }
    // docsTarjeta: documentos de la forma de autorización de tarjeta, o null:
    // { estado: 'pendiente'|'completo', forma: bool, fotos: 0..4, idioma, enviadoAt, completadoAt }
    // flow: estado del flujo de cotización/pedido en curso, o null:
    // { tipo: 'cotizacion'|'pedido', idioma: 'es'|'en', intentos, intentosPaso, turnos, pagoAclaracionPedida,
    //   datos: { yardas:{cantidad,plus}|null, mix, aire, direccion, fecha, hora, slump, inspeccion, nombre, compania, pago } }
    messages: [],      // { id, conversationId, waId, sender: CLIENTE|BOT|ESPECIALISTA, type, text, metaId, status, timestamp, flags }
    followups: [],     // { id, conversationId, intent, topic, questionText, scheduledAt, attempts, status, createdAt }
    campaigns: [],     // { id, name, templateName, language, status, createdAt, recipients: [{phone,name,status,error,sentAt}] }
    sessions: [],      // { token, createdAt, expiresAt }
    replies: {},       // respuestas editadas desde el panel: { intentId: { text?, keywords?, updatedAt } }
    contadorOrdenes: 0, // correlativo del número de orden NUESTRO que el bot emite al completarse cada orden (orden del dueño, 2026-11-01)
    orders: [],        // REGISTRO PERMANENTE de órdenes listas (pestaña «Órdenes» del panel, orden del dueño 2026-11-01):
                       // una entrada por orden completada, clave (conversationId, numeroOrden); ver registrarOrden.
    prompts: [],       // PROMPTS instalados desde el panel (sección «🧩 Prompts», orden del dueño 2026-11-03):
                       // [{ id, nombre, texto, activo, creadoEn, actualizadoEn }] — a lo sumo UNO activo a la vez;
                       // la capa services/iaPrompts.js lo usa solo en mensajes «otro» y solo si hay clave IA.
  };
}

let cache = null;

function load() {
  if (cache) return cache;
  try {
    fs.mkdirSync(cfg.dataDir, { recursive: true });
    if (fs.existsSync(DB_FILE)) {
      cache = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } else {
      cache = vacia();
      saveLocal();
    }
  } catch (e) {
    console.error('[db] No se pudo leer db.json, se usa memoria:', e.message);
    cache = vacia();
  }
  if (!cache.replies) cache.replies = {}; // bases creadas antes del editor de respuestas
  if (!Array.isArray(cache.orders)) cache.orders = []; // bases creadas antes del registro de órdenes
  if (!Array.isArray(cache.prompts)) cache.prompts = []; // bases creadas antes de la sección de prompts
  return cache;
}

/** Escritura solo en el archivo local (respaldo del proceso). */
function saveLocal() {
  try {
    fs.mkdirSync(cfg.dataDir, { recursive: true });
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), 'utf8');
    fs.renameSync(tmp, DB_FILE);
  } catch (e) {
    console.error('[db] No se pudo guardar db.json:', e.message);
  }
}

function save() {
  saveLocal();
  schedulePush();
}

// ---------------- Persistencia permanente (Supabase REST) ----------------
// Tabla public.jmp_state: una sola fila (name = cfg.supabaseStateName)
// con TODO el estado en la columna JSONB `data` — el mismo diseño
// simple que ya usa el Daily Report con su tabla de colecciones.
// Solo se usa fetch (Node >= 18): ninguna dependencia nueva.

const REMOTE_ON = Boolean(cfg.supabaseUrl && cfg.supabaseKey);
const remoteUrl = () =>
  `${cfg.supabaseUrl.replace(/\/+$/, '')}/rest/v1/${cfg.supabaseTable}`;
const remoteHeaders = (extra = {}) => ({
  apikey: cfg.supabaseKey,
  Authorization: `Bearer ${cfg.supabaseKey}`,
  'Content-Type': 'application/json',
  ...extra,
});

let pushing = false;
let pushAgain = false;
let pushTimer = null;

/** Sube el estado completo a Supabase (upsert de la fila del bot). */
async function pushRemote() {
  if (!REMOTE_ON || !cache) return;
  if (pushing) {
    pushAgain = true;
    return;
  }
  pushing = true;
  try {
    const res = await fetch(remoteUrl(), {
      method: 'POST',
      headers: remoteHeaders({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify([
        { name: cfg.supabaseStateName, data: cache, updated_at: new Date().toISOString() },
      ]),
    });
    if (!res.ok) {
      console.error('[db] Supabase: no se pudo subir el estado:', res.status, (await res.text()).slice(0, 200));
    }
  } catch (e) {
    console.error('[db] Supabase: error de red al subir el estado:', e.message);
  } finally {
    pushing = false;
    if (pushAgain) {
      pushAgain = false;
      pushRemote();
    }
  }
}

/** Agrupa guardados seguidos: sube una sola vez, 300 ms después del último. */
function schedulePush() {
  if (!REMOTE_ON) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    pushRemote();
  }, 300);
  if (pushTimer.unref) pushTimer.unref();
}

/** Descarga el estado desde Supabase; null si la fila aún no existe. */
async function pullRemote() {
  const q = `?select=data&name=eq.${encodeURIComponent(cfg.supabaseStateName)}&limit=1`;
  const res = await fetch(remoteUrl() + q, { headers: remoteHeaders() });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const rows = await res.json();
  const data = rows && rows[0] && rows[0].data;
  if (!data || typeof data !== 'object' || !Array.isArray(data.conversations)) {
    return null;
  }
  return data;
}

// Carga inicial desde Supabase. server.js espera db.ready() antes de
// escuchar (con un tope de unos segundos): así ningún webhook se
// procesa con la caché vacía. Si Supabase falla, se sigue con el
// db.json local y los siguientes save() reintentan la subida.
let resolveReady;
const readyPromise = new Promise((r) => {
  resolveReady = r;
});

async function hydrate() {
  if (!REMOTE_ON) {
    console.log('[db] Supabase no configurado: se guarda solo en db.json local.');
    resolveReady();
    return;
  }
  load();
  try {
    const remote = await pullRemote();
    if (remote) {
      cache = Object.assign(vacia(), remote);
      if (!cache.replies) cache.replies = {};
      if (!Array.isArray(cache.orders)) cache.orders = [];
      if (!Array.isArray(cache.prompts)) cache.prompts = [];
      saveLocal();
      console.log('[db] Supabase: estado cargado desde la base permanente.');
    } else {
      // Primera vez: la fila no existe (o está vacía) — se sube el
      // estado local actual como punto de partida.
      await pushRemote();
      console.log('[db] Supabase: estado inicial subido a la base permanente.');
    }
  } catch (e) {
    console.error('[db] Supabase no respondió al arrancar; se sigue con db.json local:', e.message);
  }
  resolveReady();
}
hydrate();

/** Promesa que se resuelve cuando la carga inicial terminó (o falló). */
function ready() {
  return readyPromise;
}

const uid = (p) => `${p}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
const ahoraIso = () => new Date().toISOString();

// ---------------- Conversaciones ----------------

function upsertConversation(waId, name) {
  const db = load();
  let c = db.conversations.find((x) => x.waId === waId);
  if (!c) {
    c = {
      id: uid('conv'),
      waId,
      name: name || waId,
      lastMessageAt: ahoraIso(),
      lastPreview: '',
      unread: 0,
      botPaused: false,
      botPausedAt: null,
      needsHuman: false,
      needsHumanAt: null,
      surveySentAt: null,
      flow: null,
      docsTarjeta: null,
    };
    db.conversations.push(c);
  } else if (name && name !== waId && c.name === c.waId) {
    c.name = name; // actualiza el nombre cuando Meta lo envía
  }
  save();
  return c;
}

function getConversation(id) {
  return load().conversations.find((x) => x.id === id) || null;
}

function getConversationByWaId(waId) {
  return load().conversations.find((x) => x.waId === waId) || null;
}

function listConversations() {
  return load()
    .conversations.slice()
    .sort((a, b) => (b.lastMessageAt || '').localeCompare(a.lastMessageAt || ''));
}

function touchConversation(id, preview) {
  const c = getConversation(id);
  if (!c) return;
  c.lastMessageAt = ahoraIso();
  if (preview !== undefined) c.lastPreview = preview.slice(0, 120);
  save();
}

// ---------------- Mensajes ----------------
// sender: 'CLIENTE' | 'BOT' | 'ESPECIALISTA'

function addMessage({ conversationId, waId, sender, type = 'text', text = '', metaId = null, status = null, flags = {} }) {
  const db = load();
  const m = {
    id: uid('msg'),
    conversationId,
    waId,
    sender,
    type,
    text,
    metaId,
    status, // sent | delivered | read | failed (lo reporta Meta)
    timestamp: ahoraIso(),
    flags,
  };
  db.messages.push(m);
  const c = db.conversations.find((x) => x.id === conversationId);
  if (c) {
    c.lastMessageAt = m.timestamp;
    c.lastPreview = text.slice(0, 120);
    if (sender === 'CLIENTE') c.unread = (c.unread || 0) + 1;
    if (sender === 'ESPECIALISTA') {
      c.unread = 0;
      c.needsHuman = false;
      c.needsHumanAt = null;
    }
  }
  save();
  return m;
}

function getMessages(conversationId, limit = 200) {
  return load()
    .messages.filter((m) => m.conversationId === conversationId)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .slice(-limit);
}

/** Último mensaje de un remitente dado en la conversación (para el motor de seguimiento). */
function lastMessageFrom(conversationId, sender) {
  const msgs = load().messages.filter(
    (m) => m.conversationId === conversationId && m.sender === sender
  );
  return msgs.sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0] || null;
}

function markConversationRead(id) {
  const c = getConversation(id);
  if (c) {
    c.unread = 0;
    save();
  }
}

function setBotPaused(id, paused) {
  const c = getConversation(id);
  if (c) {
    c.botPaused = !!paused;
    // Hora en que se puso la pausa: decidirRespuesta la usa para
    // vencer la pausa por inactividad del humano (la pausa ya no
    // duerme al bot para siempre; ver autoReply.js, arreglo del
    // 2026-10-31). Al reanudar, la hora se limpia.
    c.botPausedAt = paused ? ahoraIso() : null;
    save();
  }
  return c;
}

function setNeedsHuman(id, value) {
  const c = getConversation(id);
  if (c) {
    c.needsHuman = !!value;
    // Momento en que se puso la marca: decidirRespuesta lo usa para
    // saber si un mensaje de ESPECIALISTA llegó DESPUÉS de la marca
    // (regla de despertar del 2026-10-21: si el cliente vuelve a
    // escribir y ningún especialista tomó la conversación tras la
    // marca, el bot despierta y sigue la conversación).
    c.needsHumanAt = value ? ahoraIso() : null;
    save();
  }
}

/** Guarda (o limpia, con null) el estado del flujo de cotización/pedido. */
function setConversationFlow(id, flow) {
  const c = getConversation(id);
  if (c) {
    c.flow = flow || null;
    save();
  }
  return c;
}

/**
 * Guarda el estado de los documentos de tarjeta de la conversación:
 * la forma de autorización y las 4 fotos (tarjeta frente/reverso e
 * ID frente/reverso) que el bot espera tras enviar la forma. La
 * vigilancia de Jesus lee este estado del jmp_state: cuando queda
 * { estado: 'completo' } junto con needsHuman, avisa «documentos
 * completos».
 */
function setDocsTarjeta(id, docs) {
  const c = getConversation(id);
  if (c) {
    c.docsTarjeta = docs || null;
    save();
  }
  return c;
}

/**
 * Emite el siguiente número de orden NUESTRO (correlativo
 * persistente): lo llama el bot cuando una orden queda completa
 * (orden del dueño, 2026-11-01). El contador vive en el estado
 * completo, así que sobrevive a los reinicios de Render porque
 * el estado se respalda en Supabase como todo lo demás.
 */
function siguienteNumeroOrden() {
  const d = load();
  d.contadorOrdenes = (d.contadorOrdenes || 0) + 1;
  save();
  return d.contadorOrdenes;
}

// ---------------- Registro permanente de órdenes ----------------
// Pestaña «Órdenes» del panel (orden del dueño, 2026-11-01:
// «haz en el panel del bot una pestaña de órdenes y allí la vas
// guardando cuando una order esté lista… es para tener un
// registro de fecha y cliente»).
//
// - Al COMPLETARSE una orden, autoReply llama registrarOrden()
//   con los datos estructurados del flujo (clave: conversationId
//   + numeroOrden).
// - Los cambios POST-CIERRE (mix, pago, mix inicial…) regeneran
//   la confirmación armada: actualizarOrdenDesdeArmada() vuelve a
//   derivar los campos desde ese texto y ACTUALIZA la misma
//   entrada — jamás crea otra.
// - listOrders() además RECONSTRUYE las entradas que falten
//   desde las confirmaciones armadas ya guardadas en las
//   conversaciones (órdenes cerradas antes de que existiera el
//   registro, p. ej. la #1): la última armada de cada número
//   manda, y la fecha de registro es la del mensaje de la armada.

/** Deriva los campos del registro desde el texto de una confirmación armada. */
function parsearArmadaOrden(texto) {
  const lineas = String(texto || '').split('\n');
  if (lineas.length < 7) return null;
  const mNum = /^Order number: (\d+)$/.exec(lineas[6] || '');
  if (!mNum) return null;
  const out = {
    numeroOrden: parseInt(mNum[1], 10),
    fechaCorta: null,
    cliente: null,
    compania: null,
    yardas: null,
    plus: false,
    mixTexto: lineas[2] || null,
    cotizaciones: null,
    direccion: lineas[3] || null,
    hora: null,
    pago: null,
    total: null,
    totalesPorMix: null,
    totalCredito: null,
    totalesCreditoPorMix: null,
    totalesLineas: [],
    domingoEspecial: false,
  };
  // Línea 1: «M/D/AA Nombre / Compañía»
  const m1 = /^(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(.+)$/.exec(lineas[0] || '');
  if (m1) {
    out.fechaCorta = m1[1];
    const resto = m1[2];
    const idx = resto.lastIndexOf(' / ');
    if (idx >= 0) {
      out.cliente = resto.slice(0, idx);
      out.compania = resto.slice(idx + 3) || null;
    } else {
      out.cliente = resto;
    }
  }
  // Línea 2: «50 yds plus»
  const m2 = /^([\d.,]+) yds( plus)?/.exec(lineas[1] || '');
  if (m2) {
    out.yardas = m2[1];
    out.plus = !!m2[2];
  }
  // Cotizaciones en par, si la línea del mix las trae.
  if (/\(\d+ cotizaciones\)|\(\d+ quotes\)/.test(lineas[2] || '')) {
    out.cotizaciones = (lineas[2].match(/\d{3,4} psi/g) || []).slice();
  }
  // Línea 5: «7 am jobsite»
  const m5 = /^(.+?)\s+jobsite$/.exec(lineas[4] || '');
  if (m5) out.hora = m5[1];
  // Resto de líneas: pago, totales y marcas.
  const porMix = [];
  const porMixCredito = [];
  for (const l of lineas.slice(7)) {
    let m;
    if ((m = /^Pago: (.+)$/.exec(l))) {
      out.pago = m[1];
    } else if (/^Total\b/.test(l)) {
      out.totalesLineas.push(l);
      if ((m = /^Total con tarjeta de crédito.*?(\d{3,4} psi): \$([\d,]+(?:\.\d{2})?)$/.exec(l))) {
        porMixCredito.push({ mix: m[1], total: '$' + m[2] });
      } else if ((m = /^Total con tarjeta de crédito.*?: \$([\d,]+(?:\.\d{2})?)$/.exec(l))) {
        out.totalCredito = '$' + m[1];
      } else if ((m = /^Total: \$([\d,]+(?:\.\d{2})?)$/.exec(l))) {
        out.total = '$' + m[1];
      } else if ((m = /^Total (.+): \$([\d,]+(?:\.\d{2})?)$/.exec(l))) {
        porMix.push({ mix: m[1], total: '$' + m[2] });
      }
    } else if (/^⚠ DOMINGO/.test(l)) {
      out.domingoEspecial = true;
    }
  }
  if (porMix.length) out.totalesPorMix = porMix;
  if (porMixCredito.length) out.totalesCreditoPorMix = porMixCredito;
  return out;
}

/**
 * Guarda o ACTUALIZA la entrada del registro de una orden
 * (clave: conversationId + numeroOrden). La primera vez fija
 * creadaEn; las siguientes solo refrescan campos y actualizadaEn.
 * Devuelve la entrada.
 */
function registrarOrden(entrada) {
  if (!entrada || entrada.numeroOrden == null || !entrada.conversationId) return null;
  const d = load();
  if (!Array.isArray(d.orders)) d.orders = [];
  const ahora = ahoraIso();
  const i = d.orders.findIndex(
    (o) => o.conversationId === entrada.conversationId && o.numeroOrden === entrada.numeroOrden
  );
  if (i >= 0) {
    const prev = d.orders[i];
    d.orders[i] = { ...prev, ...entrada, creadaEn: prev.creadaEn || entrada.creadaEn || ahora, actualizadaEn: ahora };
    save();
    return d.orders[i];
  }
  const nueva = { ...entrada, creadaEn: entrada.creadaEn || ahora, actualizadaEn: ahora };
  d.orders.push(nueva);
  save();
  return nueva;
}

/**
 * Actualiza la entrada de una orden desde su confirmación armada
 * NUEVA (cambios post-cierre). Si la entrada no existía (orden
 * cerrada antes del registro), la crea con lo derivable del texto.
 */
function actualizarOrdenDesdeArmada(conversationId, waId, textoArmada) {
  const p = parsearArmadaOrden(textoArmada);
  if (!p) return null;
  return registrarOrden({
    conversationId,
    waId: waId || null,
    telefono: waId || null,
    ...p,
    confirmacionArmada: String(textoArmada || ''),
  });
}

/**
 * Reconstruye en el registro las órdenes ya cerradas que aún no
 * tengan entrada, desde las confirmaciones armadas guardadas en
 * las conversaciones (la ÚLTIMA armada de cada número manda).
 * Devuelve cuántas entradas creó.
 */
function reconstruirOrdenesFaltantes() {
  const d = load();
  if (!Array.isArray(d.orders)) d.orders = [];
  const claves = new Set(d.orders.map((o) => `${o.conversationId}|${o.numeroOrden}`));
  const ultimas = new Map(); // convId|numero -> mensaje armada más reciente
  for (const c of d.conversations) {
    const msgs = d.messages.filter(
      (m) => m.conversationId === c.id && m.sender === 'BOT' && m.flags && m.flags.tipo === 'confirmacion_armada'
    );
    for (const m of msgs) {
      const p = parsearArmadaOrden(m.text);
      if (!p) continue;
      const clave = `${c.id}|${p.numeroOrden}`;
      const prev = ultimas.get(clave);
      if (!prev || (m.timestamp || '') >= (prev.m.timestamp || '')) {
        ultimas.set(clave, { m, p, conv: c });
      }
    }
  }
  let creadas = 0;
  for (const [clave, { m, p, conv }] of ultimas) {
    if (claves.has(clave)) continue;
    d.orders.push({
      conversationId: conv.id,
      waId: conv.waId || null,
      telefono: conv.waId || null,
      ...p,
      confirmacionArmada: m.text || '',
      creadaEn: m.timestamp || ahoraIso(),
      actualizadaEn: m.timestamp || ahoraIso(),
    });
    creadas++;
  }
  if (creadas) save();
  return creadas;
}

/** Lista del registro para el panel: la más reciente primero. */
function listOrders() {
  reconstruirOrdenesFaltantes();
  return load()
    .orders.slice()
    .sort((a, b) =>
      (b.creadaEn || '').localeCompare(a.creadaEn || '') ||
      (b.numeroOrden || 0) - (a.numeroOrden || 0)
    );
}

function updateMessageStatus(metaId, status, errors) {
  const db = load();
  const m = db.messages.find((x) => x.metaId === metaId);
  if (m) {
    m.status = status;
    // Si Meta reporta error de entrega, guardar el detalle completo
    // (code, title, message, error_data.details) para diagnóstico.
    if (Array.isArray(errors) && errors.length) {
      m.flags = m.flags || {};
      m.flags.deliveryErrors = errors;
    }
    save();
  }
}

// ---------------- Seguimientos 24h ----------------
// status: 'pending' | 'sent' | 'cancelled' | 'exhausted'

function scheduleFollowup({ conversationId, intent, topic, questionText, delayHours }) {
  const db = load();
  // Un solo seguimiento pendiente por conversación: el nuevo reemplaza al anterior.
  db.followups
    .filter((f) => f.conversationId === conversationId && f.status === 'pending')
    .forEach((f) => {
      f.status = 'cancelled';
      f.cancelReason = 'reemplazado por mensaje más reciente';
    });
  const f = {
    id: uid('fol'),
    conversationId,
    intent: intent || 'otro',
    topic: topic || 'su mensaje',
    questionText: (questionText || '').slice(0, 300),
    scheduledAt: new Date(Date.now() + delayHours * 3600 * 1000).toISOString(),
    attempts: 0,
    status: 'pending',
    createdAt: ahoraIso(),
  };
  db.followups.push(f);
  save();
  return f;
}

function cancelFollowups(conversationId, reason) {
  const db = load();
  let n = 0;
  db.followups
    .filter((f) => f.conversationId === conversationId && f.status === 'pending')
    .forEach((f) => {
      f.status = 'cancelled';
      f.cancelReason = reason;
      n++;
    });
  if (n) save();
  return n;
}

function dueFollowups() {
  const now = new Date().toISOString();
  return load().followups.filter((f) => f.status === 'pending' && f.scheduledAt <= now);
}

function listFollowups(conversationId) {
  return load()
    .followups.filter((f) => f.conversationId === conversationId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ---------------- Campañas ----------------

function createCampaign({ name, templateName, language, recipients }) {
  const db = load();
  const c = {
    id: uid('camp'),
    name,
    templateName,
    language: language || 'es',
    status: 'enviando', // enviando | completada | completada_con_errores | cancelada
    createdAt: ahoraIso(),
    recipients: recipients.map((r) => ({
      phone: String(r.phone).replace(/\D/g, ''),
      name: r.name || '',
      status: 'pendiente', // pendiente | enviado | error
      error: null,
      sentAt: null,
      metaId: null,
    })),
  };
  db.campaigns.push(c);
  save();
  return c;
}

function getCampaign(id) {
  return load().campaigns.find((x) => x.id === id) || null;
}

function listCampaigns() {
  return load()
    .campaigns.slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((c) => ({
      ...c,
      recipients: undefined, // en el listado no se manda el detalle
      total: c.recipients.length,
      enviados: c.recipients.filter((r) => r.status === 'enviado').length,
      errores: c.recipients.filter((r) => r.status === 'error').length,
    }));
}

function updateRecipient(campaignId, phone, patch) {
  const db = load();
  const c = db.campaigns.find((x) => x.id === campaignId);
  if (!c) return;
  const r = c.recipients.find((x) => x.phone === phone);
  if (r) Object.assign(r, patch);
  save();
}

function setCampaignStatus(id, status) {
  const c = getCampaign(id);
  if (c) {
    c.status = status;
    save();
  }
}

// ---------------- Sesiones del panel ----------------

function createSession(ttlMs = 7 * 24 * 3600 * 1000) {
  const db = load();
  const token = crypto.randomBytes(32).toString('hex');
  db.sessions.push({
    token,
    createdAt: ahoraIso(),
    expiresAt: new Date(Date.now() + ttlMs).toISOString(),
  });
  // Limpieza de sesiones vencidas
  const now = new Date().toISOString();
  db.sessions = db.sessions.filter((s) => s.expiresAt > now);
  save();
  return token;
}

function validSession(token) {
  if (!token) return false;
  const now = new Date().toISOString();
  return load().sessions.some((s) => s.token === token && s.expiresAt > now);
}

function destroySession(token) {
  const db = load();
  db.sessions = db.sessions.filter((s) => s.token !== token);
  save();
}

// ---------------- Respuestas editables del bot ----------------

function getReplyOverrides() {
  return load().replies || {};
}

function setReplyOverride(intentId, patch) {
  const db = load();
  if (!db.replies) db.replies = {};
  db.replies[intentId] = { ...(db.replies[intentId] || {}), ...patch, updatedAt: ahoraIso() };
  save();
  return db.replies[intentId];
}

function clearReplyOverride(intentId) {
  const db = load();
  if (db.replies) delete db.replies[intentId];
  save();
}

// ---------------- Prompts instalados (sección «🧩 Prompts» del panel) ----------------
// Orden del dueño (2026-11-03): «coloca uno para colocar los
// prompts y identificar qué prompts tiene instalados, así
// podemos ir probando cada uno». Cada prompt: { id, nombre,
// texto, activo, creadoEn, actualizadoEn }. A lo sumo UNO
// activo a la vez: activar uno apaga todos los demás. La capa
// services/iaPrompts.js usa SOLO el activo, y solo cuando el
// bot no entendió un mensaje (intent «otro»).

/** Lista de prompts instalados, en orden de instalación. */
function listPrompts() {
  const d = load();
  if (!Array.isArray(d.prompts)) d.prompts = [];
  return d.prompts.slice();
}

/** El prompt activo (activo === true), o null si ninguno está activo. */
function getPromptActivo() {
  return listPrompts().find((p) => p.activo) || null;
}

function createPrompt({ nombre, texto }) {
  const d = load();
  if (!Array.isArray(d.prompts)) d.prompts = [];
  const ahora = ahoraIso();
  const p = {
    id: uid('prompt'),
    nombre: String(nombre || '').trim(),
    texto: String(texto || '').trim(),
    activo: false, // nace apagado: el dueño lo activa cuando quiere probarlo
    creadoEn: ahora,
    actualizadoEn: ahora,
  };
  d.prompts.push(p);
  save();
  return p;
}

function updatePrompt(id, { nombre, texto }) {
  const d = load();
  if (!Array.isArray(d.prompts)) d.prompts = [];
  const p = d.prompts.find((x) => x.id === id);
  if (!p) return null;
  if (nombre !== undefined) p.nombre = String(nombre || '').trim();
  if (texto !== undefined) p.texto = String(texto || '').trim();
  p.actualizadoEn = ahoraIso();
  save();
  return p;
}

/** Activa SOLO este prompt: todos los demás quedan inactivos. */
function setPromptActivo(id) {
  const d = load();
  if (!Array.isArray(d.prompts)) d.prompts = [];
  const p = d.prompts.find((x) => x.id === id);
  if (!p) return null;
  for (const x of d.prompts) x.activo = x.id === id;
  p.actualizadoEn = ahoraIso();
  save();
  return p;
}

/** Desactiva un prompt (si era el activo, ninguno queda activo). */
function setPromptInactivo(id) {
  const d = load();
  if (!Array.isArray(d.prompts)) d.prompts = [];
  const p = d.prompts.find((x) => x.id === id);
  if (!p) return null;
  p.activo = false;
  p.actualizadoEn = ahoraIso();
  save();
  return p;
}

function deletePrompt(id) {
  const d = load();
  if (!Array.isArray(d.prompts)) d.prompts = [];
  const antes = d.prompts.length;
  d.prompts = d.prompts.filter((x) => x.id !== id);
  if (d.prompts.length === antes) return false;
  save();
  return true;
}

module.exports = {
  load,
  save,
  ready,
  getReplyOverrides,
  setReplyOverride,
  clearReplyOverride,
  upsertConversation,
  getConversation,
  getConversationByWaId,
  listConversations,
  touchConversation,
  addMessage,
  getMessages,
  lastMessageFrom,
  markConversationRead,
  setBotPaused,
  setNeedsHuman,
  setConversationFlow,
  setDocsTarjeta,
  siguienteNumeroOrden,
  registrarOrden,
  actualizarOrdenDesdeArmada,
  listOrders,
  parsearArmadaOrden,
  updateMessageStatus,
  scheduleFollowup,
  cancelFollowups,
  dueFollowups,
  listFollowups,
  createCampaign,
  getCampaign,
  listCampaigns,
  updateRecipient,
  setCampaignStatus,
  createSession,
  validSession,
  destroySession,
  listPrompts,
  getPromptActivo,
  createPrompt,
  updatePrompt,
  setPromptActivo,
  setPromptInactivo,
  deletePrompt,
};
