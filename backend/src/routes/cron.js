// ============================================================
// Endpoint para el cron externo del motor de seguimiento 24h.
//
//   GET /api/cron/followup
//
// Seguridad: requiere el secreto CRON_SECRET, ya sea como
//   ?secret=...  o como header  x-cron-secret: ...
// Recomendado: llamarlo 1 vez por hora desde cron-job.org,
// Vercel Cron o el programador del hosting.
// ============================================================
const express = require('express');
const { cfg } = require('../config');
const { ejecutarVencidos } = require('../services/followup');

const router = express.Router();

router.get('/followup', async (req, res) => {
  const secreto = req.query.secret || req.headers['x-cron-secret'] || '';
  if (!cfg.cronSecret || secreto !== cfg.cronSecret) {
    return res.status(401).json({ error: 'Secreto inválido.' });
  }
  try {
    const resumen = await ejecutarVencidos();
    res.json({ ok: true, ...resumen, at: new Date().toISOString() });
  } catch (e) {
    console.error('[cron] error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
