# TrimarcStreamer

Proxies and streams MJPEG feeds from Trimarc CCTV cameras with a live status bar and ID-based navigation.

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
