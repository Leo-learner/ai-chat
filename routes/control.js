// Mac Controller proxy routes — forwards to Python Flask server on CONTROL_URL
const express = require('express');
const { authRequired, adminOnly } = require('../auth');

function createControlRouter({ controlUrl }) {
  const router = express.Router();
  const internalToken = process.env.CONTROL_INTERNAL_TOKEN || '';

  async function controlProxy(method, endpoint, body) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (internalToken) headers['X-Internal-Token'] = internalToken;
      const opts = { method, headers, signal: controller.signal };
      if (body) opts.body = JSON.stringify(body);
      const res = await fetch(`${controlUrl}${endpoint}`, opts);
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        return { status: 502, data: { error: 'Control returned non-JSON response' } };
      }
      return { status: res.status, data: await res.json() };
    } catch (err) {
      if (err.name === 'AbortError') {
        return { status: 504, data: { error: 'Control proxy timed out (25s)' } };
      }
      return { status: 502, data: { error: `Control proxy error: ${err.message}` } };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  router.use(authRequired);
  router.use(adminOnly);

  // Volume
  router.get('/volume', async (_, res) => {
    const r = await controlProxy('GET', '/api/volume');
    res.status(r.status).json(r.data);
  });
  router.post('/volume', async (req, res) => {
    const r = await controlProxy('POST', '/api/volume', req.body);
    res.status(r.status).json(r.data);
  });
  router.post('/volume/mute', async (req, res) => {
    const r = await controlProxy('POST', '/api/volume/mute', req.body);
    res.status(r.status).json(r.data);
  });

  // Brightness
  router.get('/brightness', async (_, res) => {
    const r = await controlProxy('GET', '/api/brightness');
    res.status(r.status).json(r.data);
  });
  router.post('/brightness', async (req, res) => {
    const r = await controlProxy('POST', '/api/brightness', req.body);
    res.status(r.status).json(r.data);
  });

  // Memory
  router.get('/memory', async (_, res) => {
    const r = await controlProxy('GET', '/api/memory');
    res.status(r.status).json(r.data);
  });

  // Apps
  router.get('/apps', async (_, res) => {
    const r = await controlProxy('GET', '/api/apps');
    res.status(r.status).json(r.data);
  });
  router.post('/apps/open', async (req, res) => {
    const r = await controlProxy('POST', '/api/apps/open', req.body);
    res.status(r.status).json(r.data);
  });
  router.post('/apps/close', async (req, res) => {
    const r = await controlProxy('POST', '/api/apps/close', req.body);
    res.status(r.status).json(r.data);
  });

  // Bluetooth
  router.get('/bluetooth', async (_, res) => {
    const r = await controlProxy('GET', '/api/bluetooth');
    res.status(r.status).json(r.data);
  });
  router.post('/bluetooth', async (req, res) => {
    const r = await controlProxy('POST', '/api/bluetooth', req.body);
    res.status(r.status).json(r.data);
  });

  // VPN
  router.get('/vpn', async (_, res) => {
    const r = await controlProxy('GET', '/api/vpn');
    res.status(r.status).json(r.data);
  });
  router.post('/vpn/toggle', async (req, res) => {
    const r = await controlProxy('POST', '/api/vpn/toggle', req.body);
    res.status(r.status).json(r.data);
  });

  // Terminal
  router.post('/terminal/run', async (req, res) => {
    const r = await controlProxy('POST', '/api/terminal/run', req.body);
    res.status(r.status).json(r.data);
  });

  return router;
}

module.exports = createControlRouter;
