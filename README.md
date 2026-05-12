# TrimarcStreamer

Proxies and streams MJPEG feeds from [Trimarc](https://www.trimarc.org/site/pages/Index.html) CCTV cameras with a live status bar and ID-based navigation.

## Usage

```
http://localhost:3000/<CCTV_ID>
```

Open the root page to use the textbox to navigate to a camera by ID. The status bar shows live health status for the origin, proxy, and client.

## Setup

```bash
npm install
node server.js
```

## Screenshots

<img width="1113" height="994" alt="image" src="https://github.com/user-attachments/assets/f1e4ab16-72be-4742-b941-08f8c410a658" />

## Project structure

- `server.js` — Express server, routes, health checks, template rendering
- `views/index.html` — HTML/CSS/JS page template with `{{PLACEHOLDERS}}`
