const SH_CLIENT_ID = 'sh-802b3f04-37c6-4261-b4de-d512b962ce05';
const SH_CLIENT_SECRET = 'vvWEqXB9cnTUQWyP5M6ML9qaHuwsBmvv';

let _token = null, _tokenExp = 0;

async function getToken() {
  if (_token && Date.now() < _tokenExp - 60000) return _token;
  const resp = await fetch(
    'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token',
    { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:`grant_type=client_credentials&client_id=${SH_CLIENT_ID}&client_secret=${SH_CLIENT_SECRET}` }
  );
  if (!resp.ok) throw new Error('Auth: '+resp.status);
  const d = await resp.json();
  _token = d.access_token;
  _tokenExp = Date.now() + (d.expires_in||3600)*1000;
  return _token;
}

const CORS = {
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Methods':'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers':'Content-Type'
};

export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k,v])=>res.setHeader(k,v));
  if (req.method==='OPTIONS') return res.status(200).end();

  const action = req.query.action || 'process';
  try {
    const token = await getToken();

    if (action==='token') {
      return res.json({ token, expires_in: Math.round((_tokenExp-Date.now())/1000) });
    }
    if (action==='process') {
      const r = await fetch('https://sh.dataspace.copernicus.eu/api/v1/process', {
        method:'POST',
        headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},
        body: JSON.stringify(req.body)
      });
      if (!r.ok) return res.status(r.status).json({error: await r.text()});
      const buf = await r.arrayBuffer();
      res.setHeader('Content-Type','image/png');
      res.setHeader('Cache-Control','public,max-age=3600');
      return res.status(200).send(Buffer.from(buf));
    }
    if (action==='statistics') {
      const r = await fetch('https://sh.dataspace.copernicus.eu/api/v1/statistics', {
        method:'POST',
        headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},
        body: JSON.stringify(req.body)
      });
      return res.json(await r.json());
    }
    res.status(400).json({error:'Acción desconocida'});
  } catch(e) {
    res.status(500).json({error:String(e)});
  }
}
