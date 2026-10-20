import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer } from '../server.mjs';

// OpenAI / Anthropic 흉내 서버
function fakeApis({ failGpt = false } = {}) {
  const calls = [];
  const srv = http.createServer(async (req, res) => {
    let raw = '';
    for await (const c of req) raw += c;
    const body = JSON.parse(raw);
    const prompt = body.messages.at(-1).content;
    calls.push({ url: req.url, prompt });
    res.setHeader('content-type', 'application/json');
    if (req.url === '/v1/chat/completions') {
      if (failGpt) { res.writeHead(500); res.end('boom'); return; }
      res.end(JSON.stringify({ choices: [{ message: { content: 'GPT:' + prompt.slice(0, 8) } }] }));
    } else {
      res.end(JSON.stringify({ content: [{ type: 'text', text: 'CLAUDE:' + prompt.slice(0, 8) }] }));
    }
  });
  return new Promise((r) => srv.listen(0, () => r({ srv, calls, port: srv.address().port })));
}

async function ask(app, question, headers = {}) {
  const res = await fetch(`http://localhost:${app.address().port}/api/ask`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ question }),
  });
  return res;
}

async function withApp(env, opts, fn) {
  const api = await fakeApis(opts);
  const app = createServer({
    OPENAI_API_KEY: 'k1', ANTHROPIC_API_KEY: 'k2',
    OPENAI_BASE_URL: `http://localhost:${api.port}`,
    ANTHROPIC_BASE_URL: `http://localhost:${api.port}`,
    ...env,
  });
  await new Promise((r) => app.listen(0, r));
  try { await fn(app, api); } finally { app.close(); api.srv.close(); }
}

const stages = async (res) =>
  (await res.text()).trim().split('\n').map((l) => JSON.parse(l));

test('두 답변 → 상호 검토 → 종합 순서로 진행해요', () =>
  withApp({}, {}, async (app, api) => {
    const evs = await stages(await ask(app, '월세 투자?'));
    assert.deepEqual(evs.map((e) => e.stage), ['answers', 'reviews', 'summary', 'done']);
    assert.match(evs[0].gpt.text, /^GPT:/);
    assert.match(evs[0].claude.text, /^CLAUDE:/);
    // 답변 2회 + 검토 2회 + 종합 1회
    assert.equal(api.calls.length, 5);
    // 검토 요청에는 상대 답변이 들어 있어요
    const gptReviewPrompt = api.calls.find((c) => c.url === '/v1/chat/completions' && c.prompt.includes('Claude의 답변'));
    assert.ok(gptReviewPrompt.prompt.includes('CLAUDE:'));
  }));

test('한쪽이 실패하면 검토를 건너뛰고 알려줘요', () =>
  withApp({}, { failGpt: true }, async (app) => {
    const evs = await stages(await ask(app, '질문'));
    assert.deepEqual(evs.map((e) => e.stage), ['answers', 'done']);
    assert.equal(evs[0].gpt.ok, false);
    assert.match(evs[1].note, /건너뛰/);
  }));

test('비밀번호가 설정되면 틀린 요청은 거절해요', () =>
  withApp({ APP_PASSWORD: 'pw' }, {}, async (app, api) => {
    assert.equal((await ask(app, '질문')).status, 401);
    assert.equal((await ask(app, '질문', { 'x-app-password': 'no' })).status, 401);
    assert.equal(api.calls.length, 0);
    assert.equal((await ask(app, '질문', { 'x-app-password': 'pw' })).status, 200);
  }));

test('빈 질문과 키 없음은 거절해요', async () => {
  await withApp({}, {}, async (app) => {
    assert.equal((await ask(app, '   ')).status, 400);
  });
  await withApp({ OPENAI_API_KEY: '' }, {}, async (app) => {
    assert.equal((await ask(app, '질문')).status, 500);
  });
});

test('휴대폰 설치용 파일(manifest, 아이콘)을 내려줘요', () =>
  withApp({}, {}, async (app) => {
    const base = `http://localhost:${app.address().port}`;
    const m = await fetch(`${base}/manifest.webmanifest`);
    assert.equal(m.status, 200);
    assert.equal((await m.json()).display, 'standalone');
    assert.equal((await fetch(`${base}/icon.svg`)).status, 200);
    assert.equal((await fetch(`${base}/`)).status, 200);
    assert.equal((await fetch(`${base}/server.mjs`)).status, 404);
  }));
