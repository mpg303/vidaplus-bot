// ============================================================
// Autenticación básica del panel.
// POST /api/login { user, pass } → { token }
// Las rutas protegidas piden: Authorization: Bearer <token>.
// Las sesiones se guardan en db.json (sobreviven reinicios).
// ============================================================
const crypto = require('crypto');
const { cfg } = require('./config');
const db = require('./db');

function loginHandler(req, res) {
  const { user, pass } = req.body || {};
  if (!cfg.panelPass) {
    return res.status(500).json({
      error: 'PANEL_PASS no está configurado en el servidor.',
    });
  }
  // timingSafeEqual lanza si los buffers tienen distinta longitud:
  // se comparan las longitudes primero.
  const userBuf = Buffer.from(String(user || ''));
  const passBuf = Buffer.from(String(pass || ''));
  const expUserBuf = Buffer.from(cfg.panelUser);
  const expPassBuf = Buffer.from(cfg.panelPass);
  const okUser =
    userBuf.length === expUserBuf.length &&
    crypto.timingSafeEqual(userBuf, expUserBuf);
  const okPass =
    passBuf.length === expPassBuf.length &&
    crypto.timingSafeEqual(passBuf, expPassBuf);
  if (!okUser || !okPass) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
  }
  const token = db.createSession();
  res.json({ token });
}

function logoutHandler(req, res) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (token) db.destroySession(token);
  res.json({ ok: true });
}

/** Middleware: protege las rutas del panel. */
function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!db.validSession(token)) {
    return res.status(401).json({ error: 'No autorizado. Inicie sesión.' });
  }
  next();
}

module.exports = { loginHandler, logoutHandler, requireAuth };
