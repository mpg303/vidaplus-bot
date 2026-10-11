// ============================================================
// API del panel (inbox). Todas las rutas requieren login,
// excepto /api/health y /api/login.
//
// Conversaciones:
//   GET    /api/conversations
//   GET    /api/conversations/:id            (incluye mensajes)
//   POST   /api/conversations/:id/read      (marcar leída)
//   POST   /api/conversations/:id/reply     { text } → ESPECIALISTA
//   POST   /api/conversations/:id/pause     { paused: true|false }
//   POST   /api/conversations/:id/survey    { via, templateName? }
// Campañas:
//   GET    /api/campaigns
//   POST   /api/campaigns                   { name, templateName, language?, recipients[], components? }
//   GET    /api/campaigns/:id
//   POST   /api/campaigns/:id/cancel
// ============================================================
const express = require('express');
const db = require('../db');
const { requireAuth, loginHandler, logoutHandler } = require('../auth');
const { sendText } = require('../services/send');
const { enviarEncuesta } = require('../services/survey');
const followup = require('../services/followup');
const campaign = require('../services/campaign');

const router = express.Router();

// ---- Públicas ----
router.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));
router.post('/login', loginHandler);
router.post('/logout', logoutHandler);

// ---- Protegidas ----
router.use(requireAuth);

// ---- Conversaciones ----
router.get('/conversations', (req, res) => {
  res.json(db.listConversations());
});

router.get('/conversations/:id', (req, res) => {
  const conv = db.getConversation(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversación no encontrada.' });
  res.json({ ...conv, messages: db.getMessages(conv.id), followups: db.listFollowups(conv.id) });
});

router.post('/conversations/:id/read', (req, res) => {
  db.markConversationRead(req.params.id);
  res.json({ ok: true });
});

// Responder como ESPECIALISTA (humano desde el panel).
router.post('/conversations/:id/reply', async (req, res) => {
  const conv = db.getConversation(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversación no encontrada.' });
  const text = (req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'El mensaje no puede estar vacío.' });

  try {
    const metaId = await sendText(conv.waId, text);
    const m = db.addMessage({
      conversationId: conv.id,
      waId: conv.waId,
      sender: 'ESPECIALISTA', // ← rol humano
      type: 'text',
      text,
      metaId,
      status: 'sent',
    });
    // Un humano respondió: se cancela el seguimiento automático.
    followup.cancelar(conv.id, 'especialista respondió desde el panel');
    res.json({ ok: true, message: m });
  } catch (e) {
    console.error('[inbox] error al responder:', e.message);
    res.status(502).json({ error: 'No se pudo enviar: ' + e.message });
  }
});

// Pausar / reanudar el bot en una conversación.
router.post('/conversations/:id/pause', (req, res) => {
  const conv = db.setBotPaused(req.params.id, !!req.body?.paused);
  if (!conv) return res.status(404).json({ error: 'Conversación no encontrada.' });
  if (req.body?.paused) followup.cancelar(conv.id, 'bot pausado manualmente');
  res.json({ ok: true, botPaused: conv.botPaused });
});

// Disparar la encuesta de satisfacción post-entrega.
router.post('/conversations/:id/survey', async (req, res) => {
  const conv = db.getConversation(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversación no encontrada.' });
  try {
    const r = await enviarEncuesta({
      phone: conv.waId,
      name: conv.name,
      via: req.body?.via || 'texto',
      templateName: req.body?.templateName || '',
    });
    res.json({ ok: true, ...r });
  } catch (e) {
    console.error('[inbox] error enviando encuesta:', e.message);
    res.status(502).json({ error: 'No se pudo enviar la encuesta: ' + e.message });
  }
});

// ---- Campañas ----
router.get('/campaigns', (req, res) => {
  res.json(db.listCampaigns());
});

router.post('/campaigns', (req, res) => {
  try {
    const { name, templateName, language, recipients, components } = req.body || {};
    const camp = campaign.crearYEnviar({
      name,
      templateName,
      language: language || 'es',
      recipients: recipients || [],
      components: components || [],
    });
    res.status(201).json({ ok: true, id: camp.id, total: camp.recipients.length });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/campaigns/:id', (req, res) => {
  const camp = db.getCampaign(req.params.id);
  if (!camp) return res.status(404).json({ error: 'Campaña no encontrada.' });
  res.json(camp);
});

router.post('/campaigns/:id/cancel', (req, res) => {
  campaign.cancelar(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
