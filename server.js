const express = require('express');

const app = express();
const PORT = 3000;
const REFRESH_MS = 2000;
const BOUNDARY = 'frame';

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

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
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
  body { background: #000; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
  img { display: block; max-width: 100vw; max-height: 100vh; }
</style>
</head>
<body>
<img src="${streamUrl}">
</body>
</html>`);
});

app.listen(PORT, () => {
  console.log(`pic2Feed running on http://localhost:${PORT}/:id`);
  console.log(`Example: http://localhost:${PORT}/CCTV_05_71_0074`);
});