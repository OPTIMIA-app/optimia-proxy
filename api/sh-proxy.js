const SH_CLIENT_ID     = process.env.SH_CLIENT_ID;
const SH_CLIENT_SECRET = process.env.SH_CLIENT_SECRET;

let _token = null, _tokenExp = 0;
async function getToken() {
  if (!SH_CLIENT_ID || !SH_CLIENT_SECRET) {
    throw new Error('Faltan las variables de entorno SH_CLIENT_ID / SH_CLIENT_SECRET en Vercel');
  }
  if (_token && Date.now() < _tokenExp - 60000) return _token;
  const resp = await fetch(
    'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=client_credentials&client_id=${SH_CLIENT_ID}&client_secret=${SH_CLIENT_SECRET}`
    }
  );
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error('Auth ' + resp.status + ': ' + txt);
  }
  const d = await resp.json();
  _token = d.access_token;
  _tokenExp = Date.now() + (d.expires_in || 3600) * 1000;
  return _token;
}

// Parsear body del request (Vercel no lo parsea automáticamente para POST)
async function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body; // ya parseado
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch(e) {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization'
};

export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query.action || 'process';

  try {
    const token = await getToken();

    // ── TOKEN ──────────────────────────────────────────────
    if (action === 'token') {
      return res.json({
        token,
        expires_in: Math.round((_tokenExp - Date.now()) / 1000)
      });
    }

    // ── PROCESS (imagen PNG) ────────────────────────────────
    if (action === 'process') {
      const body = await parseBody(req);
      console.log('[sh-proxy] process body keys:', Object.keys(body));
      const r = await fetch('https://sh.dataspace.copernicus.eu/api/v1/process', {
        method:  'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body:    JSON.stringify(body)
      });
      if (!r.ok) {
        const errTxt = await r.text();
        console.error('[sh-proxy] process error', r.status, errTxt);
        return res.status(r.status).json({ error: errTxt });
      }
      const buf = await r.arrayBuffer();
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.status(200).send(Buffer.from(buf));
    }

    // ── STATISTICS (valor NDVI promedio) ───────────────────
    if (action === 'statistics') {
      const body = await parseBody(req);
      console.log('[sh-proxy] statistics body keys:', Object.keys(body));
      const r = await fetch('https://sh.dataspace.copernicus.eu/api/v1/statistics', {
        method:  'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body:    JSON.stringify(body)
      });
      const data = await r.json();
      if (!r.ok) {
        console.error('[sh-proxy] statistics error', r.status, data);
        return res.status(r.status).json(data);
      }
      return res.json(data);
    }

    res.status(400).json({ error: 'Acción desconocida: ' + action });
  } catch(e) {
    console.error('[sh-proxy] exception:', e.message);
    res.status(500).json({ error: String(e) });
  }
}
