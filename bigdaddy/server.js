'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = __dirname;
const STORE_PATH = path.join(ROOT, 'data', 'store.json');
const ENV_PATH = path.join(ROOT, '.env');

function loadEnvFile() {
  if (!fs.existsSync(ENV_PATH)) return;
  const lines = fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/);
  lines.forEach(function (line) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eq = trimmed.indexOf('=');
    if (eq < 1) return;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  });
}

loadEnvFile();

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ChangeThisStrongPassword';

const sessions = new Map();
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_LOG_ENTRIES = 2000;
const MAX_VISITORS = 5000;
const IST = 'Asia/Kolkata';

const DEFAULT_STORE = {
  whatsappNumber: '918889624193',
  dmcaEnabled: true,
  siteOnline: true,
  mailClicks: [],
  pageVisits: [],
  visitors: [],
};

function ensureStoreFile() {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, JSON.stringify(DEFAULT_STORE, null, 2), 'utf8');
  }
}

function readStore() {
  ensureStoreFile();
  const raw = fs.readFileSync(STORE_PATH, 'utf8');
  const data = Object.assign({}, DEFAULT_STORE, JSON.parse(raw));
  if (!Array.isArray(data.mailClicks)) data.mailClicks = [];
  if (!Array.isArray(data.pageVisits)) data.pageVisits = [];
  if (!Array.isArray(data.visitors)) data.visitors = [];
  if (typeof data.siteOnline !== 'boolean') data.siteOnline = true;
  return data;
}

function writeStore(data) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function trimLogs(list) {
  if (!Array.isArray(list)) return [];
  if (list.length <= MAX_LOG_ENTRIES) return list;
  return list.slice(list.length - MAX_LOG_ENTRIES);
}

function trimVisitors(list) {
  if (!Array.isArray(list)) return [];
  if (list.length <= MAX_VISITORS) return list;
  return list.slice(list.length - MAX_VISITORS);
}

function json(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(status === 204 ? '' : JSON.stringify(body));
}

function parseBody(req) {
  return new Promise(function (resolve, reject) {
    let data = '';
    req.on('data', function (chunk) {
      data += chunk;
      if (data.length > 1e6) {
        reject(new Error('Body too large'));
        req.destroy();
      }
    });
    req.on('end', function () {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function normalizeWhatsApp(input) {
  const digits = String(input || '').replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return null;
  return digits;
}

function normalizeEmail(input) {
  const email = String(input || '').trim().toLowerCase().slice(0, 200);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '';
  return email;
}

function passwordMatches(input, expected) {
  const a = crypto.createHash('sha256').update(String(input)).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

function createToken() {
  return crypto.randomBytes(32).toString('hex');
}

function getBearerToken(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return '';
}

function isAuthed(req) {
  const token = getBearerToken(req);
  if (!token) return false;
  const session = sessions.get(token);
  if (!session) return false;
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || '';
}

function dateKeyIst(iso) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: IST,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(iso ? new Date(iso) : new Date());
}

function isTodayIst(iso) {
  return dateKeyIst(iso) === dateKeyIst();
}

function upsertVisitor(store, payload) {
  store.visitors = trimVisitors(store.visitors);
  const visitorId = String(payload.visitorId || '').slice(0, 80);
  const email = normalizeEmail(payload.email);
  const now = new Date().toISOString();
  const page = String(payload.page || '').slice(0, 500);
  const ip = payload.ip || '';
  const userAgent = String(payload.userAgent || '').slice(0, 400);

  let visitor = null;
  if (visitorId) {
    visitor = store.visitors.find(function (item) {
      return item.visitorId === visitorId;
    });
  }
  if (!visitor && email) {
    visitor = store.visitors.find(function (item) {
      return item.email === email;
    });
  }

  if (!visitor) {
    visitor = {
      id: crypto.randomUUID(),
      visitorId: visitorId || crypto.randomUUID(),
      email: email,
      ip: ip,
      userAgent: userAgent,
      firstSeen: now,
      lastSeen: now,
      visitCount: 0,
      lastPage: page || '/',
      pages: [],
    };
    store.visitors.push(visitor);
  }

  visitor.lastSeen = now;
  visitor.visitCount += 1;
  visitor.ip = ip || visitor.ip;
  if (userAgent) visitor.userAgent = userAgent;
  if (email) visitor.email = email;
  if (visitorId) visitor.visitorId = visitorId;
  if (page) {
    visitor.lastPage = page;
    if (visitor.pages.indexOf(page) === -1 && visitor.pages.length < 40) {
      visitor.pages.push(page);
    }
  }
  return visitor;
}

function buildStats(store) {
  const visits = store.pageVisits || [];
  const visitors = store.visitors || [];
  const todayVisits = visits.filter(function (row) {
    return isTodayIst(row.at);
  });
  const todayVisitorIds = {};
  todayVisits.forEach(function (row) {
    const key = row.visitorId || row.ip || row.id;
    todayVisitorIds[key] = true;
  });
  const todayVisitors = visitors.filter(function (row) {
    return isTodayIst(row.lastSeen) || isTodayIst(row.firstSeen);
  });
  const emails = [];
  const seen = {};
  visitors.forEach(function (row) {
    if (row.email && !seen[row.email]) {
      seen[row.email] = true;
      emails.push({
        email: row.email,
        lastSeen: row.lastSeen,
        visitCount: row.visitCount,
        lastPage: row.lastPage,
      });
    }
  });
  emails.sort(function (a, b) {
    return String(b.lastSeen).localeCompare(String(a.lastSeen));
  });

  return {
    siteOnline: store.siteOnline !== false,
    whatsappNumber: store.whatsappNumber,
    dmcaEnabled: Boolean(store.dmcaEnabled),
    totalVisits: visits.length,
    totalVisitors: visitors.length,
    todayVisits: todayVisits.length,
    todayVisitors: todayVisitors.length,
    emailCount: emails.length,
    emails: emails,
  };
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
};

function isAdminPublicPath(pathname) {
  return (
    pathname === '/admin' ||
    pathname === '/admin/' ||
    pathname === '/admin.html' ||
    pathname === '/admin-login.html' ||
    pathname === '/admin.css' ||
    pathname === '/admin.js' ||
    pathname === '/styles.css'
  );
}

function serveMaintenance(res) {
  res.writeHead(503, {
    'Content-Type': 'text/html; charset=utf-8',
    'Retry-After': '3600',
    'Cache-Control': 'no-store',
  });
  res.end(
    '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">' +
      '<title>Site temporarily unavailable</title><style>' +
      'body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0a0a;color:#f5f5f5;font-family:system-ui,sans-serif;padding:24px;}' +
      '.box{max-width:440px;text-align:center;border:1px solid #2a2a2a;border-radius:12px;padding:36px 28px;background:#141414;}' +
      'h1{color:#e8c872;font-size:1.4rem;margin:0 0 12px;}p{color:#9ca3af;line-height:1.5;margin:0;}</style></head><body>' +
      '<div class="box"><h1>Website is temporarily down</h1><p>This site is offline for maintenance. Please try again later.</p></div>' +
      '</body></html>'
  );
}

function serveStatic(req, res, urlPath) {
  let filePath = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
  if (!filePath.startsWith(ROOT)) {
    json(res, 403, { error: 'Forbidden' });
    return;
  }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async function (req, res) {
  const url = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === '/admin' || pathname === '/admin/') {
    res.writeHead(302, { Location: '/admin.html' });
    res.end();
    return;
  }

  if (pathname.startsWith('/api/')) {
    try {
      if (req.method === 'GET' && pathname === '/api/public/config') {
        const store = readStore();
        json(res, 200, {
          whatsappNumber: store.whatsappNumber,
          dmcaEnabled: Boolean(store.dmcaEnabled),
          siteOnline: store.siteOnline !== false,
        });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/track/visit') {
        const store = readStore();
        if (store.siteOnline === false) {
          json(res, 503, { error: 'Site offline' });
          return;
        }
        const body = await parseBody(req);
        const page = String(body.page || pathname).slice(0, 500);
        const visitor = upsertVisitor(store, {
          visitorId: body.visitorId,
          email: body.email,
          page: page,
          ip: clientIp(req),
          userAgent: req.headers['user-agent'] || '',
        });
        store.pageVisits = trimLogs(store.pageVisits);
        store.pageVisits.push({
          id: crypto.randomUUID(),
          visitorId: visitor.visitorId,
          email: visitor.email || '',
          page: page,
          referrer: String(body.referrer || req.headers.referer || '').slice(0, 500),
          at: new Date().toISOString(),
          ip: clientIp(req),
        });
        writeStore(store);
        json(res, 204, {});
        return;
      }

      if (req.method === 'POST' && pathname === '/api/track/email') {
        const store = readStore();
        if (store.siteOnline === false) {
          json(res, 503, { error: 'Site offline' });
          return;
        }
        const body = await parseBody(req);
        const email = normalizeEmail(body.email);
        if (!email) {
          json(res, 400, { error: 'Invalid email' });
          return;
        }
        upsertVisitor(store, {
          visitorId: body.visitorId,
          email: email,
          page: String(body.page || '').slice(0, 500),
          ip: clientIp(req),
          userAgent: req.headers['user-agent'] || '',
        });
        writeStore(store);
        json(res, 204, {});
        return;
      }

      if (req.method === 'POST' && pathname === '/api/track/mailto') {
        const body = await parseBody(req);
        const email = normalizeEmail(body.email);
        const page = String(body.page || '').slice(0, 500);
        if (!email) {
          json(res, 400, { error: 'Invalid email' });
          return;
        }
        const store = readStore();
        store.mailClicks = trimLogs(store.mailClicks);
        store.mailClicks.push({
          id: crypto.randomUUID(),
          email: email,
          page: page,
          at: new Date().toISOString(),
          ip: clientIp(req),
        });
        writeStore(store);
        json(res, 204, {});
        return;
      }

      if (req.method === 'POST' && pathname === '/api/admin/login') {
        const body = await parseBody(req);
        const password = String(body.password || '');
        if (!passwordMatches(password, ADMIN_PASSWORD)) {
          json(res, 401, { error: 'Invalid password' });
          return;
        }
        const token = createToken();
        sessions.set(token, { expiresAt: Date.now() + SESSION_TTL_MS });
        json(res, 200, { token: token, expiresInHours: 24 });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/admin/logout') {
        const token = getBearerToken(req);
        if (token) sessions.delete(token);
        json(res, 204, {});
        return;
      }

      if (!isAuthed(req)) {
        json(res, 401, { error: 'Unauthorized' });
        return;
      }

      if (req.method === 'GET' && pathname === '/api/admin/settings') {
        const store = readStore();
        json(res, 200, {
          whatsappNumber: store.whatsappNumber,
          dmcaEnabled: Boolean(store.dmcaEnabled),
          siteOnline: store.siteOnline !== false,
        });
        return;
      }

      if (req.method === 'PUT' && pathname === '/api/admin/settings') {
        const body = await parseBody(req);
        const store = readStore();
        if (body.whatsappNumber !== undefined) {
          const normalized = normalizeWhatsApp(body.whatsappNumber);
          if (!normalized) {
            json(res, 400, { error: 'WhatsApp number must be 10–15 digits (country code included).' });
            return;
          }
          store.whatsappNumber = normalized;
        }
        if (body.dmcaEnabled !== undefined) {
          store.dmcaEnabled = Boolean(body.dmcaEnabled);
        }
        if (body.siteOnline !== undefined) {
          store.siteOnline = Boolean(body.siteOnline);
        }
        writeStore(store);
        json(res, 200, {
          whatsappNumber: store.whatsappNumber,
          dmcaEnabled: Boolean(store.dmcaEnabled),
          siteOnline: store.siteOnline !== false,
        });
        return;
      }

      if (req.method === 'GET' && pathname === '/api/admin/stats') {
        json(res, 200, buildStats(readStore()));
        return;
      }

      if (req.method === 'GET' && pathname === '/api/admin/visitors') {
        const store = readStore();
        const list = (store.visitors || []).slice().reverse();
        json(res, 200, { items: list });
        return;
      }

      if (req.method === 'GET' && pathname === '/api/admin/mail-clicks') {
        const store = readStore();
        const list = (store.mailClicks || []).slice().reverse();
        json(res, 200, { items: list });
        return;
      }

      if (req.method === 'GET' && pathname === '/api/admin/page-visits') {
        const store = readStore();
        const list = (store.pageVisits || []).slice().reverse();
        json(res, 200, { items: list });
        return;
      }

      if (req.method === 'DELETE' && pathname === '/api/admin/mail-clicks') {
        const store = readStore();
        store.mailClicks = [];
        writeStore(store);
        json(res, 204, {});
        return;
      }

      json(res, 404, { error: 'Not found' });
    } catch (err) {
      json(res, 400, { error: err.message || 'Bad request' });
    }
    return;
  }

  const store = readStore();
  if (store.siteOnline === false && !isAdminPublicPath(pathname)) {
    serveMaintenance(res);
    return;
  }

  serveStatic(req, res, pathname);
});

server.listen(PORT, function () {
  console.log('Big Daddy site running at http://localhost:' + PORT);
  console.log('Admin panel: http://localhost:' + PORT + '/admin.html');
  if (!process.env.ADMIN_PASSWORD) {
    console.warn('Warning: using default ADMIN_PASSWORD. Set ADMIN_PASSWORD in .env for production.');
  }
});
