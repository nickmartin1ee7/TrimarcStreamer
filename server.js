const express = require('express');
const fs = require('fs');
const path = require('path');

// --- Configuration ---
const PORT = 3000;
const REFRESH_MS = 2000;
const BOUNDARY = 'frame';
const HEALTH_CHECK_MS = 30000;

// --- Upstream fetch options ---
const FETCH_OPTIONS = {
  credentials: "omit",
  headers: {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:149.0) Gecko/20100101 Firefox/149.0",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Priority": "u=0, i",
    "Pragma": "no-cache",
    "Cache-Control": "no-cache"
  },
  method: "GET"
};

// --- Upstream health state ---
let upstreamHealth = {
  ok: false,
  lastChecked: null,
  status: 'checking',
  statusCode: null
};

/**
 * Polls the upstream Trimarc image URL to check origin reachability.
 * Updates the global upstreamHealth state with the result.
 */
async function checkUpstream() {
  const testUrl = 'https://www.trimarc.org/images/milestone/CCTV_05_71_0074.jpg';
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const resp = await fetch(testUrl, { ...FETCH_OPTIONS, signal: controller.signal });
    clearTimeout(timeout);
    upstreamHealth = {
      ok: resp.ok,
      lastChecked: new Date().toISOString(),
      status: resp.ok ? 'healthy' : `HTTP ${resp.status}`,
      statusCode: resp.status
    };
  } catch (err) {
    upstreamHealth = {
      ok: false,
      lastChecked: new Date().toISOString(),
      status: err.name === 'AbortError' ? 'timeout' : err.message,
      statusCode: null
    };
  }
}

checkUpstream();
setInterval(checkUpstream, HEALTH_CHECK_MS);

// --- Express app setup ---
const app = express();

// --- Request logging middleware (skip /health to reduce noise) ---
app.use((req, res, next) => {
  if (req.path !== '/health') {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  }
  next();
});

// --- Health check endpoint ---
app.get('/health', (req, res) => {
  res.json({
    proxy: 'ok',
    upstream: upstreamHealth,
    timestamp: new Date().toISOString()
  });
});

// --- MJPEG stream proxy ---
/**
 * Proxies a single JPEG image as a multipart/x-mixed-replace MJPEG stream.
 * Continuously fetches the upstream image at REFRESH_MS intervals
 * and writes each frame as a separate MJPEG part.
 */
app.get('/stream/:id', async (req, res) => {
  const { id } = req.params;
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    return res.status(400).send('Invalid ID format');
  }

  const imageUrl = `https://www.trimarc.org/images/milestone/${id}.jpg`;

  const upstream = await fetch(imageUrl, FETCH_OPTIONS);
  if (!upstream.ok) {
    return res.status(upstream.status).send(`Upstream error: ${upstream.statusText}`);
  }

  res.writeHead(200, {
    'Content-Type': `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
  });

  let running = true;
  req.on('close', () => { running = false; });

  while (running) {
    try {
      const resp = await fetch(imageUrl, FETCH_OPTIONS);
      if (!resp.ok) throw new Error(`Upstream ${resp.status}`);
      const buf = Buffer.from(await resp.arrayBuffer());
      if (!running) break;

      res.write(`--${BOUNDARY}\r\n`);
      res.write(`Content-Type: image/jpeg\r\n`);
      res.write(`Content-Length: ${buf.length}\r\n`);
      res.write('\r\n');
      res.write(buf);
      res.write('\r\n');
    } catch (err) {
      console.error('Fetch error:', err.message);
      if (!running) break;
    }

    const deadline = Date.now() + REFRESH_MS;
    while (running && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 100));
    }
  }

  res.end();
});

// --- HTML template loading ---
let htmlTemplate;

try {
  htmlTemplate = fs.readFileSync(path.join(__dirname, 'views', 'index.html'), 'utf8');
} catch (err) {
  console.error('Failed to load HTML template:', err.message);
  process.exit(1);
}

/**
 * Renders the full HTML page for a given CCTV ID.
 * When id is null, returns a shell page with no image stream.
 * @param {string|null} id - The CCTV identifier to display
 * @returns {string} Complete HTML page
 */
function renderPage(id) {
  const hasId = !!id;
  const title = hasId ? 'TrimarcStreamer - ' + id : 'TrimarcStreamer';
  const imageHtml = hasId
    ? '<div id="imageWrap"><img id="streamImg" src="/stream/' + id + '"></div>'
    : '';
  const reconnectJs = hasId
    ? '    if (!proxyOk) {\n      img.src = img.src.split(\'?\')[0] + \'?t=\' + Date.now();\n    }'
    : '';
  const streamJs = hasId
    ? '\nconst img = document.getElementById(\'streamImg\');\nlet lastFrame = Date.now();\n\nsetInterval(() => {\n  const elapsed = Date.now() - lastFrame;\n  if (clientState === \'green\' && elapsed > 10000) {\n    setClient(\'red\');\n  }\n}, 2000);\n\nimg.addEventListener(\'load\', () => {\n  lastFrame = Date.now();\n  setClient(\'green\');\n});\n\nimg.addEventListener(\'error\', () => {\n  setClient(\'red\');\n});\n\nwindow.addEventListener(\'offline\', () => setClient(\'red\'));\nwindow.addEventListener(\'online\', () => setClient(\'green\'));\n'
    : '';

  return htmlTemplate
    .replace('{{TITLE}}', title)
    .replace('{{ID}}', id || '')
    .replace('{{IMAGE_HTML}}', imageHtml)
    .replace('{{RECONNECT_JS}}', reconnectJs)
    .replace('{{STREAM_JS}}', streamJs);
}

// --- Page routes ---
app.get('/', (req, res) => {
  res.send(renderPage(null));
});

app.get('/:id', (req, res) => {
  const { id } = req.params;
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    return res.status(400).send('Invalid ID format');
  }
  res.send(renderPage(id));
});

// --- Startup ---
app.listen(PORT, () => {
  console.log(`TrimarcStreamer running on http://localhost:${PORT}/:id`);
  console.log(`Example: http://localhost:${PORT}/CCTV_05_71_0074`);
});
