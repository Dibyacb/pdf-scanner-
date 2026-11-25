// functions/_middleware.js (deploy to each hosted Cloudflare Pages app connected to portfolio-db)
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function cleanHeader(val, max = 160) {
  if (!val || typeof val !== 'string') return null;
  const trimmed = val.replace(/^"+|"+$/g, '').trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function parseDirectVisitor(request) {
  const h = request.headers;
  const cf = request.cf || {};
  const ip =
    cleanHeader(h.get('CF-Connecting-IP'), 64) ||
    cleanHeader(h.get('X-Forwarded-For')?.split(',')[0], 64) ||
    'Unknown';

  const ua = cleanHeader(h.get('User-Agent'), 512) || '';
  const chModel = cleanHeader(h.get('Sec-CH-UA-Model'), 80);

  let device_type = 'Desktop';
  if (/bot|crawl|spider|slurp|curl|wget|python-requests|headless/i.test(ua)) device_type = 'Bot';
  else if (/iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(ua)) device_type = 'Tablet';
  else if (/Mobi|iPhone|iPod|Android.*Mobile|Windows Phone|BlackBerry/i.test(ua)) device_type = 'Mobile';

  let os = 'Unknown OS';
  const androidMatch = ua.match(/Android\s+([0-9.]+)/i);
  const iosMatch = ua.match(/(?:iPhone|CPU)\s+OS\s+([0-9_]+)/i);
  const macMatch = ua.match(/Mac OS X\s+([0-9_]+)/i);
  if (androidMatch) os = `Android ${androidMatch[1]}`;
  else if (iosMatch) os = `iOS ${iosMatch[1].replace(/_/g, '.')}`;
  else if (/Windows NT 10\.0/i.test(ua)) os = 'Windows 10/11';
  else if (/Windows NT 6\.3/i.test(ua)) os = 'Windows 8.1';
  else if (/Windows NT 6\.1/i.test(ua)) os = 'Windows 7';
  else if (macMatch) os = `macOS ${macMatch[1].replace(/_/g, '.')}`;
  else if (/CrOS/i.test(ua)) os = 'ChromeOS';
  else if (/Linux/i.test(ua)) os = 'Linux';

  let device_model = null;
  if (chModel && chModel !== 'K') device_model = chModel;
  else if (/iPhone/i.test(ua)) device_model = 'iPhone';
  else if (/iPad/i.test(ua)) device_model = 'iPad';
  else if (androidMatch) {
    const m = ua.match(/Android\s+[0-9.]+;\s*([^;)]+?)(?:\s+Build\/|\))/i);
    const candidate = m ? m[1].trim() : '';
    device_model = candidate && candidate !== 'K' && !/^wv$/i.test(candidate)
      ? candidate.slice(0, 64)
      : (device_type === 'Tablet' ? 'Android Tablet' : 'Android Phone');
  } else if (/Windows/i.test(ua)) device_model = 'Windows PC';
  else if (/Macintosh|Mac OS X/i.test(ua)) device_model = 'Mac';
  else if (/Linux/i.test(ua)) device_model = 'Linux PC';

  let browser = 'Unknown Browser';
  if (/Instagram/i.test(ua)) browser = 'Instagram In-App';
  else if (/FBAN|FBAV/i.test(ua)) browser = 'Facebook In-App';
  else if (/WhatsApp/i.test(ua)) browser = 'WhatsApp In-App';
  else if (/EdgA?\/([0-9.]+)/i.test(ua)) browser = `Edge ${ua.match(/EdgA?\/([0-9]+)/i)[1]}`;
  else if (/OPR\/([0-9.]+)/i.test(ua)) browser = `Opera ${ua.match(/OPR\/([0-9]+)/i)[1]}`;
  else if (/SamsungBrowser\/([0-9.]+)/i.test(ua)) browser = `Samsung Internet ${ua.match(/SamsungBrowser\/([0-9]+)/i)[1]}`;
  else if (/CriOS\/([0-9.]+)/i.test(ua)) browser = `Chrome iOS ${ua.match(/CriOS\/([0-9]+)/i)[1]}`;
  else if (/FxiOS\/([0-9.]+)/i.test(ua)) browser = `Firefox iOS ${ua.match(/FxiOS\/([0-9]+)/i)[1]}`;
  else if (/Chrome\/([0-9.]+)/i.test(ua) && !/Chromium/i.test(ua)) browser = `Chrome ${ua.match(/Chrome\/([0-9]+)/i)[1]}`;
  else if (/Firefox\/([0-9.]+)/i.test(ua)) browser = `Firefox ${ua.match(/Firefox\/([0-9]+)/i)[1]}`;
  else if (/Version\/([0-9.]+).*Safari/i.test(ua)) browser = `Safari ${ua.match(/Version\/([0-9.]+)/i)[1]}`;
  else if (/Safari/i.test(ua)) browser = 'Safari';

  let referrer = null;
  const rawRef = h.get('Referer');
  if (rawRef) {
    try {
      const u = new URL(rawRef);
      referrer = `${u.hostname}${u.pathname === '/' ? '' : u.pathname}`.slice(0, 200);
    } catch {
      referrer = rawRef.slice(0, 200);
    }
  }

  return {
    ip,
    country: cleanHeader(cf.country, 16),
    city: cleanHeader(cf.city, 80),
    region: cleanHeader(cf.region, 80),
    timezone: cleanHeader(cf.timezone, 64),
    isp: cleanHeader(cf.asOrganization, 120),
    device_type,
    device_model,
    os,
    browser,
    referrer,
    user_agent: ua || null,
    created_at: new Date().toISOString(),
  };
}

function isPageNavigation(request, url) {
  if (request.method !== 'GET') return false;
  const path = url.pathname.toLowerCase();
  if (path.startsWith('/api/') || path.startsWith('/cdn-cgi/')) return false;
  if (/\.(js|css|png|jpg|jpeg|webp|gif|svg|ico|woff2?|ttf|eot|map|json|xml|txt|pdf|zip)$/.test(path)) {
    return false;
  }
  const dest = request.headers.get('Sec-Fetch-Dest');
  if (dest && dest !== 'document') return false; // skips iframes, scripts, images
  const accept = request.headers.get('Accept') || '';
  return accept.includes('text/html');
}

export async function onRequest(context) {
  const { request, env, next, waitUntil } = context;

  if (env.DB) {
    try {
      const url = new URL(request.url);
      const host = url.hostname.replace(/^www\./, '');
      const row = await env.DB
        .prepare('SELECT id, title, is_paused, pause_message FROM projects WHERE live_url LIKE ? LIMIT 1')
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

      if (row && isPageNavigation(request, url)) {
        const logTask = (async () => {
          try {
            const v = parseDirectVisitor(request);
            // Deduplicate if the same IP just tapped this project on Priyantos studio within 15 seconds
            const recentCutoff = new Date(Date.now() - 15 * 1000).toISOString();
            const recent = await env.DB
              .prepare('SELECT id FROM project_clicks WHERE project_id = ? AND ip = ? AND created_at >= ? LIMIT 1')
              .bind(row.id, v.ip, recentCutoff)
              .first();

            if (!recent) {
              await env.DB
                .prepare(
                  `INSERT INTO project_clicks
                   (project_id, project_title, source, action, ip, country, city, region, timezone, isp, device_type, device_model, os, browser, screen, referrer, user_agent, created_at)
                   VALUES (?, ?, 'direct', 'Direct Visit', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`
                )
                .bind(
                  row.id,
                  row.title,
                  v.ip,
                  v.country,
                  v.city,
                  v.region,
                  v.timezone,
                  v.isp,
                  v.device_type,
                  v.device_model,
                  v.os,
                  v.browser,
                  v.referrer,
                  v.user_agent,
                  v.created_at
                )
                .run();
            }
          } catch (err) {
            console.error('direct visit log failed:', err);
          }
        })();

        if (typeof waitUntil === 'function') waitUntil(logTask);
        else await logTask;
      }
    } catch (err) {
      console.error('middleware check failed:', err);
    }
  }

  return next();
}
