// ============================================================
// Almacenamiento local en JSON (sin servicios externos).
// Guarda conversaciones, mensajes, seguimientos, campañas y sesiones.
// La escritura es atómica (tmp + rename) para no corromper el archivo.
//
// NOTA PARA PRODUCCIÓN: en un hosting serverless (p. ej. Vercel
// Functions) el disco es efímero y este archivo NO persistiría.
// Por eso el backend se despliega como proceso Node de larga
// duración (Render/Railway/VPS). Si algún día se mueve a serverless,
// hay que cambiar este módulo por una base de datos real (Postgres,
// etc.) manteniendo las mismas funciones.
// ============================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { cfg } = require('./config');

const DB_FILE = path.join(cfg.dataDir, 'db.json');

function vacia() {
  return {
    conversations: [], // { id, waId, name, lastMessageAt, lastPreview, unread, botPaused, needsHuman, surveySentAt }
    messages: [],      // { id, conversationId, waId, sender: CLIENTE|BOT|ESPECIALISTA, type, text, metaId, status, timestamp, flags }
    followups: [],     // { id, conversationId, intent, topic, questionText, scheduledAt, attempts, status, createdAt }
    campaigns: [],     // { id, name, templateName, language, status, createdAt, recipients: [{phone,name,status,error,sentAt}] }
    sessions: [],      // { token, createdAt, expiresAt }
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
      save();
    }
  } catch (e) {
    console.error('[db] No se pudo leer db.json, se usa memoria:', e.message);
    cache = vacia();
  }
  return cache;
}

function save() {
  try {
    fs.mkdirSync(cfg.dataDir, { recursive: true });
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), 'utf8');
    fs.renameSync(tmp, DB_FILE);
  } catch (e) {
    console.error('[db] No se pudo guardar db.json:', e.message);
  }
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
      needsHuman: false,
      surveySentAt: null,
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
    save();
  }
  return c;
}

function setNeedsHuman(id, value) {
  const c = getConversation(id);
  if (c) {
    c.needsHuman = !!value;
    save();
  }
}

function updateMessageStatus(metaId, status) {
  const db = load();
  const m = db.messages.find((x) => x.metaId === metaId);
  if (m) {
    m.status = status;
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

module.exports = {
  load,
  save,
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
};
