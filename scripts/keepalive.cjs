const https = require('node:https');
const url = process.env.API_HEALTH_URL;
const interval = Number(process.env.KEEPALIVE_INTERVAL_MS ?? 840000);
if (!url) { console.error('API_HEALTH_URL is required'); process.exit(1); }
function ping() { https.get(url, (res) => { console.log(new Date().toISOString(), res.statusCode ?? 'no status'); res.resume(); }).on('error', (e) => console.error('ping failed', e.message)); }
ping(); setInterval(ping, interval);
