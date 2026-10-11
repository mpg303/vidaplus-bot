// ============================================================
// Servidor Express — API del bot de WhatsApp de Clínica Hispana VidaPlus.
//
// Rutas:
//   GET/POST /webhook   → webhook de Meta (público, verificado por token/firma)
//   /api/*              → API del panel (login + inbox + campañas)
//   GET /api/cron/*     → tareas programadas (protegido por CRON_SECRET)
// ============================================================
const express = require('express');
const { cfg } = require('./config');

const app = express();

// CORS simple: el panel vive en otro origen (Vercel) y necesita llamar a la API.
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-cron-secret');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Se guarda el body crudo para poder verificar la firma X-Hub-Signature-256 de Meta.
app.use(
  express.json({
    limit: '1mb',
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

app.use('/webhook', require('./routes/webhook'));
// El cron se monta ANTES que el inbox: el router del inbox aplica requireAuth
// a todo lo que no coincida con sus rutas, y sombrearía /api/cron/followup.
app.use('/api/cron', require('./routes/cron'));
app.use('/api', require('./routes/inbox'));

app.get('/', (req, res) => {
  res.json({
    servicio: 'JMP Concrete and Dispatch LLC — Bot de WhatsApp (API)',
    estado: 'en línea',
    hora: new Date().toISOString(),
  });
});

app.listen(cfg.port, () => {
  console.log(`[api] escuchando en puerto ${cfg.port}`);
  if (!cfg.metaAccessToken || !cfg.metaPhoneNumberId) {
    console.warn(
      '[api] AVISO: faltan META_ACCESS_TOKEN o META_PHONE_NUMBER_ID. ' +
        'El envío a WhatsApp no funcionará hasta configurarlos (ver .env.example).'
    );
  }
  if (!cfg.panelPass) {
    console.warn('[api] AVISO: falta PANEL_PASS. El login del panel no funcionará.');
  }
});
