# Bot propio de WhatsApp — Clínica Hispana VidaPlus 💙💚

Scaffold funcional del bot propio de la clínica, con la **misma base que el bot de Marcel/Axxel**:
un **panel web tipo inbox** (desplegado en Vercel) + un **backend API REST** (como `api.axxel.solutions`).
Usa la **API oficial de WhatsApp de Meta (Cloud API)** — Meta cobra unos centavos por mensaje
masivo fuera de conversación (tarifa de WhatsApp, no de Axxel).

```
proyecto/
├── .env.example          ← TODAS las variables (copiar a .env, nunca subirlo)
├── README.md             ← este archivo
├── backend/              ← API REST en Node.js + Express
│   ├── package.json
│   ├── render.yaml       ← despliegue en 1 clic en Render
│   ├── src/
│   │   ├── server.js     ← arranca Express, monta rutas
│   │   ├── config.js     ← variables + datos reales de la clínica + horario
│   │   ├── db.js         ← almacenamiento local JSON (conversaciones, mensajes, etc.)
│   │   ├── auth.js       ← login del panel (usuario/contraseña → token de sesión)
│   │   ├── routes/
│   │   │   ├── webhook.js ← GET verifica (hub.mode/verify_token/challenge) + POST recibe mensajes
│   │   │   ├── inbox.js   ← API del panel: bandeja, responder, encuesta, campañas
│   │   │   └── cron.js    ← GET /api/cron/followup (motor 24h, con CRON_SECRET)
│   │   └── services/
│   │       ├── send.js     ← enviar texto y plantillas vía Cloud API
│   │       ├── autoReply.js← intents en español (saludo, horario, servicios, precio, cita, ubicación…)
│   │       ├── survey.js   ← encuesta post-cita que pide la reseña de Google
│   │       ├── followup.js ← MOTOR 24H: insiste si el paciente no contestó
│   │       └── campaign.js ← campañas masivas por lotes con estado por destinatario
│   └── data/             ← db.json vive aquí (ignorado por git)
└── panel/                ← inbox web estático (HTML+JS vanilla, sin build)
    ├── index.html
    ├── styles.css
    ├── app.js
    ├── config.js         ← BACKEND_URL (editar antes de desplegar)
    └── vercel.json
```

## Qué hace cada parte

| Parte | Qué hace |
|---|---|
| `webhook.js` | Verifica el webhook de Meta (GET) y recibe mensajes/estados (POST). Guarda cada mensaje como **CLIENTE**, decide la respuesta automática y programa el seguimiento 24h. |
| `send.js` | `sendText()` y `sendTemplate()` → `POST graph.facebook.com/v22.0/<PHONE_NUMBER_ID>/messages` con el token de entorno. |
| `autoReply.js` | Intents por palabras clave en español: saludo, horario, servicios, precio, cita, ubicación, humano, emergencia, gracias, adiós. Usa los datos reales: *Clínica Hispana VidaPlus, 3068 Forest Ln Ste 121, Dallas TX 75234, (945) 301-6982, lun–sáb 9am–12am, dom 10am–5pm*. Si un humano respondió hace < 30 min o el bot está pausado, no interrumpe. |
| `survey.js` | Dispara la encuesta post-cita (texto cálido en español + `GOOGLE_REVIEW_URL`). Por texto dentro de la ventana 24h o por plantilla aprobada fuera de ella. |
| `followup.js` | **Motor de seguimiento 24h (pedido por Jesus):** si el paciente preguntó y nadie le respondió, a las 24h el bot vuelve a escribir (insistente, hasta `MAX_FOLLOWUP_ATTEMPTS` veces); si sigue sin respuesta, marca la conversación `needsHuman` para que la tome un humano. Los timers persisten en `db.json` (sobreviven reinicios). Se ejecuta vía `GET /api/cron/followup` con `CRON_SECRET`. |
| `campaign.js` | Campañas por **plantillas aprobadas**: crea la campaña, envía en lotes con pausa de 600 ms entre mensajes y guarda por destinatario `pendiente/enviado/error`. El botón **sí funciona** (a diferencia del de Axxel). |
| Roles | Cada mensaje lleva `sender`: `BOT` / `CLIENTE` / `ESPECIALISTA` (lo escrito desde el panel por un humano). |
| Panel | Login básico (`PANEL_USER`/`PANEL_PASS`), lista de conversaciones con no-leídos, vista de mensajes por rol, caja de respuesta como especialista, botón ⭐ de encuesta, ⏸️ pausar/reanudar bot por chat, y sección de campañas con historial y estado por destinatario. |

## Cómo correrlo en local

```bash
# 1. Backend
cd proyecto/backend
npm install
cp ../.env.example ../.env   # y llena los valores
npm run dev                  # http://localhost:3000

# 2. Panel (otra terminal)
cd proyecto/panel
npm start                    # http://localhost:5173 (config.js ya apunta a localhost:3000)
```

Sin tokens de Meta el backend arranca igual (avisa en consola) y el panel funciona contra datos
locales; el envío real a WhatsApp requiere la configuración de Meta (abajo).

## Cómo desplegar

**Backend → Render (recomendado, plan gratuito):**
1. Sube `proyecto/` a un repo de GitHub.
2. En Render: *New → Blueprint* y apunta al repo (usa `backend/render.yaml`), o crea un
   *Web Service* manual con Root Directory `proyecto/backend`, Build `npm install`, Start `npm start`.
3. En *Environment → Environment Variables* pega todas las variables del `.env.example`.
4. Activa un **disco persistente** y apunta `DATA_DIR` ahí (ej. `/var/data`), para que `db.json` no se borre.
5. Anota la URL pública (ej. `https://vidaplus-whatsapp-api.onrender.com`).

> ¿Por qué no el backend en Vercel Functions? El almacenamiento es un JSON local y Vercel
> serverless tiene disco efímero: los mensajes y seguimientos se perderían. El backend necesita
> un proceso Node de larga duración (Render/Railway/Fly/VPS).

**Panel → Vercel:**
1. En `panel/config.js` cambia `BACKEND_URL` por la URL pública del backend.
2. En Vercel: *Add New → Project*, importa el repo y pon **Root Directory** en `proyecto/panel`.
   No hay build: es estático (`vercel.json` incluido).
3. Obtienes algo como `https://vidaplus-inbox.vercel.app` — el equivalente propio del
   `axxel-inbox-vidaplus.vercel.app`.

**Cron del seguimiento 24h:**
Crea un cron externo gratuito (ej. [cron-job.org](https://cron-job.org)) que llame **cada hora** a:

```
GET https://<tu-backend>/api/cron/followup?secret=<CRON_SECRET>
```

**Webhook en Meta:** en tu app de Meta (*WhatsApp → Configuration*), suscribe el webhook a
`https://<tu-backend>/webhook` con tu `META_VERIFY_TOKEN` y el campo `messages`.

## Lo que Jesus debe proporcionar (checklist exacto)

1. **Cuenta de Meta Business verificada** a nombre de **MPG Care Services LLC** (documentos de la empresa).
2. **Decidir el número**: usar el actual de la clínica **(945) 301-6982** (recomendado — es el que los
   pacientes ya tienen) o un número nuevo. Si es el actual, el bot de Axxel deja de funcionar en ese número.
3. **Número de teléfono registrado en la API**: si es el actual, migrarlo (ver `briefs/decision-numero.md`
   en la carpeta del goal: pasos de migración y respaldo del historial).
4. **Token de acceso PERMANENTE** (System User) generado en developers.facebook.com → `META_ACCESS_TOKEN`.
5. **Phone Number ID** de la app de Meta → `META_PHONE_NUMBER_ID` (es el ID, no el número).
6. **`META_VERIFY_TOKEN`**: lo inventa él (texto secreto largo); debe coincidir con el configurado en Meta.
7. **`META_APP_SECRET`** (recomendado): secreto de la app de Meta, para verificar la firma del webhook.
8. **`GOOGLE_REVIEW_URL`**: enlace "escribir reseña" de la ficha de Google (Google Business → Compartir).
9. **`PANEL_USER` / `PANEL_PASS`**: usuario y contraseña fuerte para el panel.
10. **`CRON_SECRET`**: secreto largo para el cron del seguimiento 24h.
11. **Plantillas aprobadas en Meta** (WhatsApp Manager → Message templates), en español, para:
    - encuesta de reseña post-cita (categoría *utilidad*),
    - recordatorios de cita (categoría *utilidad*),
    - las campañas que quiera enviar (categoría *marketing* — ver nota abajo).
12. **Opt-in de los pacientes** para mensajes proactivos (plantillas): Meta exige que el paciente haya
    aceptado recibirlos.

## Notas importantes (costos y límites reales)

- **Costo Meta (EE.UU. 2026):** respuestas dentro de la ventana 24h que abre el paciente: primeras
  1,000/mes gratis, luego ~$0.0034 c/u. Plantillas de utilidad (encuestas, recordatorios): ~$0.0034 c/u.
  Ejemplo: 2,000 recordatorios/mes ≈ **$7**. Los mensajes que envían los pacientes siempre son gratis.
- **⚠️ Campañas de marketing pausadas por Meta:** desde abril 2025 Meta tiene **pausado** el envío de
  plantillas de *marketing* a números de EE.UU. (sigue vigente). Esto aplica a cualquiera — nosotros o
  Axxel — y explica por qué el botón de Axxel estaba muerto. El módulo `campaign.js` funciona de verdad
  con plantillas aprobadas, pero las de marketing a EE.UU. **no se entregarán hasta que Meta levante la
  pausa**. Lo que sí funciona hoy: bandeja, respuestas automáticas, encuestas y recordatorios (utilidad).
- **Ventana de 24h:** fuera de ella solo se puede escribir con plantillas aprobadas (por eso la encuesta
  y las campañas usan plantillas).
- **Seguridad:** nunca subas el `.env` ni `data/db.json` a git (contienen tokens y conversaciones).
  Cambia `PANEL_PASS` y `CRON_SECRET` por valores fuertes antes de producción.
