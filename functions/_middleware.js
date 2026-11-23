// functions/_middleware.js (add to each separate Cloudflare Pages website)
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

export async function onRequest({ request, env, next }) {
  if (env.DB) {
    try {
      const host = new URL(request.url).hostname.replace(/^www\./, '');
      const row = await env.DB
        .prepare('SELECT title, is_paused, pause_message FROM projects WHERE live_url LIKE ? LIMIT 1')
        .bind(`%${host}%`)
        .first();

      if (row && row.is_paused === 1) {
        const title = escapeHtml(row.title || 'Application');
        const msg = escapeHtml(row.pause_message || 'Hosting for this application is currently paused by Priyantos studio.');
        return new Response(
          `<!doctype html>
          <html lang="en">
          <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — Offline</title></head>
          <body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#fdf2e3;color:#2a1c24;font-family:system-ui,-apple-system,sans-serif;text-align:center;padding:24px">
            <div style="max-width:440px;background:#fffaf3;border:1.5px solid rgba(42,28,36,.2);border-radius:20px;padding:32px 24px">
              <span style="display:inline-block;background:rgba(180,83,9,.15);color:#b45309;font-weight:700;font-size:12px;letter-spacing:.04em;text-transform:uppercase;padding:5px 12px;border-radius:999px;margin-bottom:14px">Hosting Paused</span>
              <h1 style="margin:0 0 10px;font-size:24px">${title}</h1>
              <p style="margin:0;color:#6f5a57;line-height:1.5">${msg}</p>
            </div>
          </body>
          </html>`,
          {
            status: 503,
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              'Cache-Control': 'no-store',
            },
          }
        );
      }
    } catch (err) {
      console.error('kill-switch check failed:', err);
    }
  }
  return next();
}
