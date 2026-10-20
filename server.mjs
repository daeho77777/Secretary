import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { config, roundtable } from './lib.mjs';

const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'],
  '/icon.svg': ['icon.svg', 'image/svg+xml'],
};
const MAX_QUESTION = 4000;

function authorized(req, password) {
  if (!password) return true;
  const given = Buffer.from(req.headers['x-app-password'] || '');
  const want = Buffer.from(password);
  return given.length === want.length && timingSafeEqual(given, want);
}

async function body(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 20000) throw new Error('too large');
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}

export function createServer(env = process.env) {
  const cfg = config(env);
  const password = env.APP_PASSWORD;

  return http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && STATIC[req.url]) {
        const [file, type] = STATIC[req.url];
        res.writeHead(200, { 'content-type': type });
        res.end(await readFile(fileURLToPath(new URL(`./public/${file}`, import.meta.url))));
        return;
      }
      if (req.method === 'GET' && req.url === '/api/status') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          needsPassword: Boolean(password),
          openai: Boolean(cfg.openaiKey),
          anthropic: Boolean(cfg.anthropicKey),
        }));
        return;
      }
      if (req.method === 'POST' && req.url === '/api/ask') {
        if (!authorized(req, password)) {
          res.writeHead(401, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: '비밀번호가 맞지 않아요.' }));
          return;
        }
        const { question } = await body(req);
        const q = typeof question === 'string' ? question.trim() : '';
        if (!q || q.length > MAX_QUESTION) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: `질문은 1~${MAX_QUESTION}자로 써 주세요.` }));
          return;
        }
        if (!cfg.openaiKey || !cfg.anthropicKey) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'OPENAI_API_KEY 와 ANTHROPIC_API_KEY 를 서버에 설정해 주세요.' }));
          return;
        }
        res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' });
        await roundtable(q, cfg, (ev) => res.write(JSON.stringify(ev) + '\n'));
        res.end();
        return;
      }
      res.writeHead(404);
      res.end();
    } catch (e) {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  createServer().listen(port, () => console.log(`http://localhost:${port}`));
}
