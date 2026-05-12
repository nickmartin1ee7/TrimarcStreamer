const express = require('express');

const app = express();
const PORT = 3000;
const REFRESH_MS = 2000;
const BOUNDARY = 'frame';
const HEALTH_CHECK_MS = 30000;

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

// Periodic upstream health checks
checkUpstream();
setInterval(checkUpstream, HEALTH_CHECK_MS);

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Health endpoint
app.get('/health', (req, res) => {
  res.json({
    proxy: 'ok',
    upstream: upstreamHealth,
    timestamp: new Date().toISOString()
  });
});

// MJPEG stream endpoint
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

// HTML player page
app.get('/:id', (req, res) => {
  const { id } = req.params;
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    return res.status(400).send('Invalid ID format');
  }

  const streamUrl = `/stream/${id}`;

  res.send(`<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>pic2Feed - ${id}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #0a0a0a;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    font-family: system-ui, -apple-system, sans-serif;
  }
  #statusBar {
    width: 100%;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    gap: 0;
    padding: 10px 16px;
    background: #111;
    border-bottom: 1px solid #222;
    font-size: 13px;
    user-select: none;
  }
  .node {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    color: #888;
  }
  .node .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    flex-shrink: 0;
    transition: background 0.4s, box-shadow 0.4s;
  }
  .node .dot.green { background: #22c55e; box-shadow: 0 0 7px #22c55e66; }
  .node .dot.red { background: #ef4444; box-shadow: 0 0 7px #ef444466; }
  .node .dot.gray { background: #555; }
  .node .name { color: #aaa; white-space: nowrap; }
  .node .name.highlight { color: #fff; }
  .flow {
    width: 44px;
    height: 4px;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 3px 2px 0;
  }
  .flow .track {
    width: 100%;
    height: 2px;
    border-radius: 1px;
    background: repeating-linear-gradient(
      90deg,
      #22c55e 0px,
      #22c55e 6px,
      transparent 6px,
      transparent 10px
    );
    background-size: 10px 100%;
    animation: flowAnim 0.5s linear infinite;
    transition: background 0.4s;
  }
  .flow.broken .track {
    background: repeating-linear-gradient(
      90deg,
      #ef4444 0px,
      #ef4444 3px,
      transparent 3px,
      transparent 7px
    );
    background-size: 7px 100%;
    animation: none;
  }
  .flow.broken::after {
    content: '\\2716';
    position: absolute;
    color: #ef4444;
    font-size: 10px;
    line-height: 1;
    text-shadow: 0 0 6px #ef444466;
  }
  @keyframes flowAnim {
    0% { background-position: 0 0; }
    100% { background-position: 10px 0; }
  }
  #imageWrap {
    flex: 1;
    display: flex;
    justify-content: center;
    align-items: center;
    width: 100%;
  }
  img {
    display: block;
    max-width: 100vw;
    max-height: calc(100vh - 37px);
  }
</style>
</head>
<body>
<div id="statusBar">
  <div class="node" id="originNode">
    <span class="dot gray" id="originDot"></span>
    <span class="name" id="originName">Origin</span>
  </div>
  <div class="flow" id="flow1">
    <div class="track"></div>
  </div>
  <div class="node" id="proxyNode">
    <span class="dot gray" id="proxyDot"></span>
    <span class="name" id="proxyName">Proxy</span>
  </div>
  <div class="flow" id="flow2">
    <div class="track"></div>
  </div>
  <div class="node" id="clientNode">
    <span class="dot gray" id="clientDot"></span>
    <span class="name" id="clientName">Client</span>
  </div>
</div>
<div id="imageWrap">
  <img id="streamImg" src="${streamUrl}">
</div>
<script>
const img = document.getElementById('streamImg');
const originDot = document.getElementById('originDot');
const proxyDot = document.getElementById('proxyDot');
const clientDot = document.getElementById('clientDot');
const flow1 = document.getElementById('flow1');
const flow2 = document.getElementById('flow2');

let lastFrame = Date.now();
let originOk = false;
let proxyOk = true;
let clientState = 'gray';

function setDot(el, state) {
  el.className = 'dot ' + state;
}

function setFlow(el, healthy) {
  el.className = 'flow' + (healthy ? '' : ' broken');
}

function updateLinks() {
  setFlow(flow1, originOk && proxyOk);
  setFlow(flow2, proxyOk && clientState === 'green');
}

function setOrigin(ok) {
  originOk = ok;
  setDot(originDot, ok ? 'green' : 'red');
  updateLinks();
}

function setProxy(ok) {
  proxyOk = ok;
  setDot(proxyDot, ok ? 'green' : 'red');
  updateLinks();
}

function setClient(state) {
  clientState = state;
  setDot(clientDot, state);
  updateLinks();
}

// Initial state
setOrigin(false);
setProxy(true);
setClient('gray');

// Poll health endpoint every 5s
async function pollHealth() {
  try {
    const resp = await fetch('/health');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    setProxy(true);
    setOrigin(!!data.upstream.ok);
  } catch (err) {
    setProxy(false);
    setOrigin(false);
  }
}
setInterval(pollHealth, 5000);
pollHealth();

// Monitor img stream
setInterval(() => {
  const elapsed = Date.now() - lastFrame;
  if (clientState === 'green' && elapsed > 10000) {
    setClient('red');
  }
}, 2000);

img.addEventListener('load', () => {
  lastFrame = Date.now();
  setClient('green');
});

img.addEventListener('error', () => {
  setClient('red');
});

window.addEventListener('offline', () => setClient('red'));
window.addEventListener('online', () => setClient('green'));
</script>
</body>
</html>`);
});

app.listen(PORT, () => {
  console.log(`pic2Feed running on http://localhost:${PORT}/:id`);
  console.log(`Example: http://localhost:${PORT}/CCTV_05_71_0074`);
});