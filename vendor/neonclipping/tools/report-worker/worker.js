// NeonClipping report collector: a tiny Cloudflare Worker that stores "Send directly" reports (opt-in, text only).
// Deploy: see README.md in this folder. UNTESTED against a live Cloudflare account; the app side is tested against a local mock server.
const MAX = 30000;              // bytes accepted per report
const KEEP_DAYS = 60;           // reports expire on their own

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') return new Response('NeonClipping report collector', { status: 200 });
    const raw = await request.text();
    if (raw.length > MAX) return new Response('too large', { status: 413 });
    let body;
    try { body = JSON.parse(raw); } catch { return new Response('bad json', { status: 400 }); }
    if (typeof body.text !== 'string' || !body.text.startsWith('NeonClipping diagnostics')) return new Response('not a report', { status: 400 });
    // Keep only what the app promises to send: the diagnostics text, a date and error kinds. No IP, no headers are stored.
    const record = { text: body.text.slice(0, MAX), sent: String(body.sent || '').slice(0, 10), kinds: (Array.isArray(body.kinds) ? body.kinds : []).slice(0, 10).map(k => String(k).slice(0, 40)) };
    const key = new Date().toISOString() + '-' + crypto.randomUUID().slice(0, 8);
    await env.REPORTS.put(key, JSON.stringify(record), { expirationTtl: KEEP_DAYS * 86400 });
    return new Response('ok', { status: 200 });
  },
};
