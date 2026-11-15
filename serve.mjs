import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const root = path.join(__dirname, 'build', 'SURGE');
const exe = path.join(__dirname, 'build', 'publish', 'Surge.exe');

console.log(`Starting Surge backend from ${exe} with root ${root}...`);
const helper = spawn(exe, ['--no-browser', '--root', root], {
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'inherit'],
});

let homeUrl = null;
let targetOrigin = null;
let token = null;

const started = new Promise((resolve, reject) => {
  let buf = '';
  helper.stdout.on('data', (chunk) => {
    buf += chunk.toString();
    const match = buf.match(/SURGE_URL=(\S+)/);
    if (match) {
      homeUrl = match[1];
      const parsed = new URL(homeUrl);
      targetOrigin = parsed.origin;
      token = new URLSearchParams(parsed.hash.slice(1)).get('k');
      resolve();
    }
  });
  helper.on('error', reject);
  helper.on('exit', (code) => reject(new Error(`Surge helper exited with code ${code}`)));
});

await started;
console.log(`Surge backend ready at ${targetOrigin} with token ${token.slice(0, 8)}...`);

const server = http.createServer(async (req, res) => {
  try {
    const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (reqUrl.pathname === '/' && !req.headers['x-surge-token']) {

      const accept = req.headers['accept'] || '';
      if (accept.includes('text/html') && !reqUrl.searchParams.has('k')) {
        res.writeHead(302, { Location: `/#k=${token}` });
        res.end();
        return;
      }
    }

    const headers = { ...req.headers };
    delete headers['host'];
    headers['host'] = new URL(targetOrigin).host;
    headers['origin'] = targetOrigin;
    headers['sec-fetch-site'] = 'same-origin';
    if (!headers['x-surge-token']) {
      headers['x-surge-token'] = token;
    }

    const proxyReq = http.request(
      `${targetOrigin}${req.url}`,
      {
        method: req.method,
        headers,
      },
      (proxyRes) => {
        const respHeaders = { ...proxyRes.headers };

        if (respHeaders['content-security-policy']) {
          respHeaders['content-security-policy'] = respHeaders['content-security-policy']
            .replace("frame-ancestors 'none'", "frame-ancestors 'self' http://localhost:3000 http://127.0.0.1:3000");
        }
        res.writeHead(proxyRes.statusCode, respHeaders);
        proxyRes.pipe(res);
      }
    );

    proxyReq.on('error', (err) => {
      console.error('Proxy request error:', err.message);
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end('Surge helper unavailable: ' + err.message);
      }
    });

    req.pipe(proxyReq);
  } catch (err) {
    console.error('Server error:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error: ' + err.message);
    }
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n======================================================`);
  console.log(` Surge OS Workspace & Browser Interface`);
  console.log(` Live preview running at: http://localhost:${PORT}/#k=${token}`);
  console.log(` Browser interface directly at: http://localhost:${PORT}/browser/index.html`);
  console.log(`======================================================\n`);
});

process.on('SIGINT', () => {
  helper.kill();
  process.exit(0);
});
process.on('SIGTERM', () => {
  helper.kill();
  process.exit(0);
});

