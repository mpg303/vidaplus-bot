// ============================================================
// Lógica del panel: login, bandeja, respuestas como especialista,
// encuesta de reseña, pausar bot y campañas.
// Habla con el backend (ver config.js → BACKEND_URL).
// ============================================================
const API = () => window.VIDAPLUS_CONFIG.BACKEND_URL.replace(/\/$/, '');
const token = () => localStorage.getItem('vp_token');

let convActiva = null;
let timerConv = null;
let timerMsgs = null;

async function api(path, opts = {}) {
  const res = await fetch(API() + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token() ? { Authorization: 'Bearer ' + token() } : {}),
      ...(opts.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    // Sesión vencida → volver al login
    localStorage.removeItem('vp_token');
    mostrarLogin();
    throw new Error('Sesión vencida, inicie sesión de nuevo.');
  }
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

// ---------------- Login ----------------
function mostrarLogin() {
  document.getElementById('login-view').classList.remove('hidden');
  document.getElementById('app-view').classList.add('hidden');
  clearInterval(timerConv);
  clearInterval(timerMsgs);
}
function mostrarApp() {
  document.getElementById('login-view').classList.add('hidden');
  document.getElementById('app-view').classList.remove('hidden');
  cargarConversaciones();
  cargarCampanas();
  timerConv = setInterval(cargarConversaciones, 5000);
  timerMsgs = setInterval(() => {
    if (convActiva) cargarChat(convActiva, true);
  }, 3000);
}

document.getElementById('login-btn').addEventListener('click', async () => {
  const err = document.getElementById('login-error');
  err.classList.add('hidden');
  try {
    const data = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({
        user: document.getElementById('login-user').value,
        pass: document.getElementById('login-pass').value,
      }),
    });
    localStorage.setItem('vp_token', data.token);
    mostrarApp();
  } catch (e) {
    err.textContent = e.message;
    err.classList.remove('hidden');
  }
});
document.getElementById('login-pass').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('login-btn').click();
});
document.getElementById('logout-btn').addEventListener('click', async () => {
  try { await api('/api/logout', { method: 'POST' }); } catch {}
  localStorage.removeItem('vp_token');
  mostrarLogin();
});

// ---------------- Tabs ----------------
document.querySelectorAll('.tab[data-tab]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab[data-tab]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-inbox').classList.toggle('hidden', btn.dataset.tab !== 'inbox');
    document.getElementById('tab-orders').classList.toggle('hidden', btn.dataset.tab !== 'orders');
    document.getElementById('tab-campaigns').classList.toggle('hidden', btn.dataset.tab !== 'campaigns');
    document.getElementById('tab-replies').classList.toggle('hidden', btn.dataset.tab !== 'replies');
    if (btn.dataset.tab === 'orders') cargarOrdenes();
    if (btn.dataset.tab === 'campaigns') cargarCampanas();
    if (btn.dataset.tab === 'replies') cargarRespuestas();
  });
});

// ---------------- Bandeja ----------------
function horaCorta(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('es-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

async function cargarConversaciones() {
  try {
    const convs = await api('/api/conversations');
    document.getElementById('conv-count').textContent = `(${convs.length})`;
    const lista = document.getElementById('conv-list');
    lista.innerHTML = '';
    for (const c of convs) {
      const div = document.createElement('div');
      div.className = 'conv' + (convActiva === c.id ? ' active' : '');
      div.innerHTML = `
        <div class="conv-top">
          <span class="conv-name">${esc(c.name || c.waId)}</span>
          <span>${c.unread > 0 ? `<span class="unread">${c.unread}</span>` : ''}
          <span class="conv-time">${horaCorta(c.lastMessageAt)}</span></span>
        </div>
        <div class="conv-preview">${esc(c.lastPreview || '')}</div>
        <div>${c.needsHuman ? '<span class="flag-human">⚠️ necesita humano</span> ' : ''}
        ${c.botPaused ? '<span class="flag-paused">⏸️ bot pausado</span>' : ''}</div>`;
      div.addEventListener('click', () => abrirChat(c.id));
      lista.appendChild(div);
    }
  } catch (e) {
    console.warn('conversaciones:', e.message);
  }
}

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[m]));
}

async function abrirChat(id) {
  convActiva = id;
  document.getElementById('tab-inbox').classList.add('chat-open');
  document.getElementById('chat-empty').classList.add('hidden');
  document.getElementById('chat-active').classList.remove('hidden');
  await cargarChat(id);
  try { await api(`/api/conversations/${id}/read`, { method: 'POST' }); } catch {}
  cargarConversaciones();
}

const ROL_TXT = { CLIENTE: 'Cliente', BOT: 'Bot', ESPECIALISTA: 'Especialista' };
const ROL_CLS = { CLIENTE: 'cli', BOT: 'bot', ESPECIALISTA: 'esp' };

async function cargarChat(id, silencioso = false) {
  try {
    const c = await api(`/api/conversations/${id}`);
    if (convActiva !== id) return; // el usuario cambió de chat mientras cargaba
    document.getElementById('chat-name').textContent = c.name || c.waId;
    document.getElementById('chat-meta').textContent =
      `${c.waId}${c.botPaused ? ' · ⏸️ bot pausado' : ''}${c.needsHuman ? ' · ⚠️ necesita humano' : ''}`;
    const btnPausa = document.getElementById('btn-pause');
    btnPausa.textContent = c.botPaused ? '▶️ Reanudar bot' : '⏸️ Pausar bot';
    btnPausa.classList.toggle('warn', !c.botPaused);

    const box = document.getElementById('messages');
    const alFinal = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    box.innerHTML = '';
    for (const m of c.messages) {
      const div = document.createElement('div');
      div.className = `msg ${ROL_CLS[m.sender] || 'cli'}`;
      div.innerHTML = `<div class="role">${ROL_TXT[m.sender] || m.sender}</div>${esc(m.text)}
        <div class="meta">${horaCorta(m.timestamp)}${m.status ? ' · ' + esc(m.status) : ''}${m.flags?.followup ? ' · 🔁 seguimiento' : ''}${m.flags?.survey ? ' · ⭐ encuesta' : ''}</div>`;
      box.appendChild(div);
    }
    if (alFinal || !silencioso) box.scrollTop = box.scrollHeight;
  } catch (e) {
    if (!silencioso) console.warn('chat:', e.message);
  }
}

// Responder como ESPECIALISTA
async function enviarRespuesta() {
  const ta = document.getElementById('reply-text');
  const texto = ta.value.trim();
  if (!texto || !convActiva) return;
  ta.value = '';
  try {
    await api(`/api/conversations/${convActiva}/reply`, {
      method: 'POST',
      body: JSON.stringify({ text: texto }),
    });
    cargarChat(convActiva);
  } catch (e) {
    alert('No se pudo enviar: ' + e.message);
    ta.value = texto;
  }
}
document.getElementById('btn-back').addEventListener('click', () => {
  document.getElementById('tab-inbox').classList.remove('chat-open');
});
document.getElementById('reply-btn').addEventListener('click', enviarRespuesta);
document.getElementById('reply-text').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    enviarRespuesta();
  }
});

// Encuesta de reseña
document.getElementById('btn-survey').addEventListener('click', async () => {
  if (!convActiva) return;
  if (!confirm('¿Enviar la encuesta de satisfacción a este cliente?')) return;
  try {
    await api(`/api/conversations/${convActiva}/survey`, { method: 'POST', body: '{}' });
    alert('Encuesta enviada ⭐');
    cargarChat(convActiva);
  } catch (e) {
    alert('No se pudo enviar: ' + e.message);
  }
});

// Pausar / reanudar bot
document.getElementById('btn-pause').addEventListener('click', async () => {
  if (!convActiva) return;
  const pausar = document.getElementById('btn-pause').textContent.includes('Pausar');
  try {
    await api(`/api/conversations/${convActiva}/pause`, {
      method: 'POST',
      body: JSON.stringify({ paused: pausar }),
    });
    cargarChat(convActiva);
    cargarConversaciones();
  } catch (e) {
    alert('Error: ' + e.message);
  }
});

// ---------------- Campañas ----------------
document.getElementById('camp-send').addEventListener('click', async () => {
  const err = document.getElementById('camp-error');
  err.classList.add('hidden');
  const recipients = document.getElementById('camp-recipients').value
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [phone, ...resto] = l.split(/\s+/);
      return { phone, name: resto.join(' ') };
    });
  if (!recipients.length) {
    err.textContent = 'Agregue al menos un destinatario.';
    err.classList.remove('hidden');
    return;
  }
  if (!confirm(`¿Enviar la campaña a ${recipients.length} destinatario(s)? Se usarán plantillas aprobadas de Meta.`)) return;
  try {
    const r = await api('/api/campaigns', {
      method: 'POST',
      body: JSON.stringify({
        name: document.getElementById('camp-name').value.trim(),
        templateName: document.getElementById('camp-template').value.trim(),
        language: document.getElementById('camp-lang').value.trim() || 'es',
        recipients,
      }),
    });
    alert(`Campaña creada y enviando (${r.total} destinatarios).`);
    document.getElementById('camp-name').value = '';
    document.getElementById('camp-template').value = '';
    document.getElementById('camp-recipients').value = '';
    cargarCampanas();
  } catch (e) {
    err.textContent = e.message;
    err.classList.remove('hidden');
  }
});

async function cargarCampanas() {
  try {
    const camps = await api('/api/campaigns');
    const box = document.getElementById('campaigns');
    box.innerHTML = camps.length ? '' : '<p class="hint">Aún no hay campañas.</p>';
    for (const c of camps) {
      const div = document.createElement('div');
      div.className = 'camp-card';
      div.innerHTML = `
        <h3>${esc(c.name)}</h3>
        <span class="pill">${esc(c.status)}</span>
        <div class="camp-stats">
          <span>Plantilla: <b>${esc(c.templateName)}</b></span>
          <span>Total: <b>${c.total}</b></span>
          <span>Enviados: <b>${c.enviados}</b></span>
          <span>Errores: <b>${c.errores}</b></span>
        </div>
        <button class="btn-small" data-detalle="${c.id}">Ver detalle</button>
        ${c.status === 'enviando' ? `<button class="btn-small warn" data-cancel="${c.id}">Cancelar</button>` : ''}`;
      box.appendChild(div);
    }
    box.querySelectorAll('[data-detalle]').forEach((b) =>
      b.addEventListener('click', () => verDetalleCampana(b.dataset.detalle)));
    box.querySelectorAll('[data-cancel]').forEach((b) =>
      b.addEventListener('click', async () => {
        if (!confirm('¿Cancelar el envío de esta campaña?')) return;
        await api(`/api/campaigns/${b.dataset.cancel}/cancel`, { method: 'POST' });
        cargarCampanas();
      }));
  } catch (e) {
    console.warn('campañas:', e.message);
  }
}

async function verDetalleCampana(id) {
  try {
    const c = await api(`/api/campaigns/${id}`);
    const lineas = c.recipients
      .map((r) => `${r.status === 'enviado' ? '✅' : r.status === 'error' ? '❌' : '⏳'} ${r.phone} ${esc(r.name || '')}${r.error ? ' — ' + esc(r.error) : ''}`)
      .join('\n');
    alert(`Campaña: ${c.name}\nEstado: ${c.status}\n\n${lineas}`);
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

// ---------------- Respuestas del bot (editor) ----------------
async function cargarRespuestas() {
  const box = document.getElementById('replies-list');
  try {
    const items = await api('/api/replies');
    box.innerHTML = '';
    for (const r of items) {
      const card = document.createElement('div');
      card.className = 'camp-card reply-card';
      card.innerHTML = `
        <h3>${esc(r.label)} ${r.edited ? '<span class="pill">✏️ editada</span>' : ''}</h3>
        ${r.id !== 'otro' ? `<label>Palabras clave (separadas por comas)
          <input type="text" class="reply-keywords" value="${esc(r.keywords.join(', '))}">
        </label>` : '<p class="hint">Esta respuesta se usa cuando el mensaje del cliente no coincide con ningún tema.</p>'}
        <label>Texto que recibe el cliente
          <textarea class="reply-text" rows="6">${esc(r.text)}</textarea>
        </label>
        <div class="reply-actions">
          <button class="btn-primary btn-small" data-save="${r.id}">💾 Guardar</button>
          ${r.edited ? `<button class="btn-small warn" data-reset="${r.id}">↩️ Volver al texto original</button>` : ''}
        </div>`;
      box.appendChild(card);
    }
    box.querySelectorAll('[data-save]').forEach((b) =>
      b.addEventListener('click', () => guardarRespuesta(b)));
    box.querySelectorAll('[data-reset]').forEach((b) =>
      b.addEventListener('click', () => restablecerRespuesta(b.dataset.reset)));
  } catch (e) {
    box.innerHTML = '<p class="error">No se pudieron cargar las respuestas: ' + esc(e.message) + '</p>';
  }
}

async function guardarRespuesta(btn) {
  const card = btn.closest('.reply-card');
  const id = btn.dataset.save;
  const body = { text: card.querySelector('.reply-text').value };
  const kw = card.querySelector('.reply-keywords');
  if (kw) body.keywords = kw.value;
  btn.disabled = true;
  try {
    await api(`/api/replies/${id}`, { method: 'POST', body: JSON.stringify(body) });
    alert('✅ Respuesta guardada. El bot ya usa el texto nuevo.');
    cargarRespuestas();
  } catch (e) {
    alert('No se pudo guardar: ' + e.message);
    btn.disabled = false;
  }
}

async function restablecerRespuesta(id) {
  if (!confirm('¿Volver al texto y palabras clave originales de esta respuesta?')) return;
  try {
    await api(`/api/replies/${id}/reset`, { method: 'POST', body: '{}' });
    cargarRespuestas();
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

// ---------------- Órdenes (registro permanente) ----------------
// El bot guarda cada orden cuando queda lista (backend: registro
// db.orders, GET /api/orders). Aquí se consulta por FECHA y por
// CLIENTE: la lista viene de la más reciente a la más vieja y se
// agrupa por el día en que la orden quedó registrada.
let ordenesCache = [];

function fechaLocalISO(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function tituloDiaOrden(iso) {
  const f = fechaLocalISO(iso);
  const hoy = fechaLocalISO(new Date().toISOString());
  const ayer = fechaLocalISO(new Date(Date.now() - 24 * 3600 * 1000).toISOString());
  if (f === hoy) return 'Hoy';
  if (f === ayer) return 'Ayer';
  const d = new Date(iso);
  return isNaN(d)
    ? 'Sin fecha'
    : d.toLocaleDateString('es-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function totalesTextoOrden(o) {
  const partes = [];
  if (o.totalesPorMix && o.totalesPorMix.length) {
    for (const t of o.totalesPorMix) partes.push(`${esc(t.mix)}: <b>${esc(t.total)}</b>`);
  } else if (o.total) {
    partes.push(`Total: <b>${esc(o.total)}</b>`);
  }
  if (o.totalesCreditoPorMix && o.totalesCreditoPorMix.length) {
    for (const t of o.totalesCreditoPorMix) partes.push(`Crédito ${esc(t.mix)}: <b>${esc(t.total)}</b>`);
  } else if (o.totalCredito) {
    partes.push(`Total con crédito: <b>${esc(o.totalCredito)}</b>`);
  }
  return partes.join(' · ');
}

async function cargarOrdenes() {
  const box = document.getElementById('orders-list');
  try {
    ordenesCache = await api('/api/orders');
    pintarOrdenes();
  } catch (e) {
    box.innerHTML = '<p class="error">No se pudieron cargar las órdenes: ' + esc(e.message) + '</p>';
  }
}

function pintarOrdenes() {
  const box = document.getElementById('orders-list');
  const q = (document.getElementById('ord-q').value || '').trim().toLowerCase();
  const fecha = document.getElementById('ord-fecha').value || '';
  const lista = ordenesCache.filter((o) => {
    if (fecha && fechaLocalISO(o.creadaEn) !== fecha) return false;
    if (q) {
      const texto = [o.cliente, o.compania, o.telefono, o.waId, o.numeroOrden]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!texto.includes(q)) return false;
    }
    return true;
  });
  if (!lista.length) {
    box.innerHTML = ordenesCache.length
      ? '<p class="hint">Ninguna orden coincide con ese filtro.</p>'
      : '<p class="hint">Aún no hay órdenes registradas. Cuando el bot cierre una orden, aparecerá aquí automáticamente.</p>';
    return;
  }
  box.innerHTML = '';
  let diaActual = null;
  for (const o of lista) {
    const dia = tituloDiaOrden(o.creadaEn);
    if (dia !== diaActual) {
      diaActual = dia;
      const h = document.createElement('h3');
      h.className = 'orders-day';
      h.textContent = dia;
      box.appendChild(h);
    }
    const totales = totalesTextoOrden(o);
    const div = document.createElement('div');
    div.className = 'camp-card order-card';
    div.innerHTML = `
      <h3>Orden #${esc(o.numeroOrden)} <span class="pill">${esc(horaCorta(o.creadaEn))}</span>
      ${o.domingoEspecial ? '<span class="pill err">⚠ domingo</span>' : ''}</h3>
      <div class="camp-stats">
        <span>Cliente: <b>${esc(o.cliente || '')}</b>${o.compania ? ` / ${esc(o.compania)}` : ''}</span>
        <span>Teléfono: <b>${esc(o.telefono || o.waId || '')}</b></span>
        <span>Cantidad: <b>${esc(o.yardas || '')} yds${o.plus ? ' plus' : ''}</b></span>
        <span>Mix: <b>${esc(o.mixTexto || o.mix || '')}</b></span>
        <span>Dirección: <b>${esc(o.direccion || '')}</b></span>
        <span>Entrega: <b>${esc(o.fechaCorta || o.fecha || '')}${o.hora ? ' — ' + esc(o.hora) : ''}</b></span>
        ${o.pago ? `<span>Pago: <b>${esc(o.pago)}</b></span>` : ''}
        ${totales ? `<span>${totales}</span>` : ''}
      </div>
      <button class="btn-small" type="button">Ver detalle</button>
      <pre class="order-detail hidden">${esc(o.confirmacionArmada || '')}</pre>`;
    const btn = div.querySelector('button');
    const detalle = div.querySelector('.order-detail');
    btn.addEventListener('click', () => {
      detalle.classList.toggle('hidden');
      btn.textContent = detalle.classList.contains('hidden') ? 'Ver detalle' : 'Ocultar detalle';
    });
    box.appendChild(div);
  }
}

document.getElementById('ord-q').addEventListener('input', pintarOrdenes);
document.getElementById('ord-fecha').addEventListener('change', pintarOrdenes);
document.getElementById('ord-refresh').addEventListener('click', cargarOrdenes);

// ---------------- Arranque ----------------
if (token()) mostrarApp();
else mostrarLogin();
