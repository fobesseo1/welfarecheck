// 웹 서버 (의존성 없음, node:http)
// 실행: node src/server.ts  →  http://localhost:3000
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SessionStore, ENGINE_VERSION } from './session.ts';
import { evidence } from './evidence.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(here, '../public');
const PORT = Number(process.env.PORT ?? 3000);

const ev = evidence();
const integrity = ev.integrity();
if (integrity.length) console.warn('[근거 DB 무결성 경고]\n' + integrity.join('\n'));
const store = new SessionStore();

function send(res: http.ServerResponse, code: number, body: unknown, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
async function body(req: http.IncomingMessage): Promise<any> {
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 20000) throw new Error('입력이 너무 깁니다'); }
  return raw ? JSON.parse(raw) : {};
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const m = url.pathname.match(/^\/api\/sessions\/([a-f0-9-]{36})(\/(messages|answers|facts))?$/);
  try {
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return send(res, 200, { ok: integrity.length === 0, engine_version: ENGINE_VERSION, llm_provider: process.env.LLM_PROVIDER ?? 'mock', rules: ev.rules.size, usable_rules: [...ev.rules.keys()].filter((r) => ev.usable(r)).length, integrity });
    }
    if (req.method === 'POST' && url.pathname === '/api/sessions') {
      const b = await body(req); const s = store.create();
      return send(res, 200, b.text ? await store.message(s.id, String(b.text)) : store.state(s));
    }
    if (m && req.method === 'GET' && !m[3]) return send(res, 200, store.state(store.load(m[1])));
    if (m && req.method === 'POST' && m[3] === 'messages') { const b = await body(req); return send(res, 200, await store.message(m[1], String(b.text ?? ''))); }
    if (m && req.method === 'POST' && m[3] === 'answers') { const b = await body(req); return send(res, 200, store.answer(m[1], String(b.questionId), String(b.value))); }
    if (m && req.method === 'PATCH' && m[3] === 'facts') { const b = await body(req); return send(res, 200, store.edit(m[1], String(b.key), b.value ?? null)); }
    if (req.method === 'GET') {
      const file = path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname);
      if (file.startsWith(PUBLIC) && existsSync(file)) {
        const type = file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.js') ? 'text/javascript; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/octet-stream';
        return send(res, 200, readFileSync(file), type);
      }
    }
    send(res, 404, { error: '찾을 수 없습니다' });
  } catch (e) {
    console.error(e);
    send(res, 400, { error: (e as Error).message });
  }
});

server.listen(PORT, () => console.log(`장기요양 사전검토 서버: http://localhost:${PORT}  (LLM_PROVIDER=${process.env.LLM_PROVIDER ?? 'mock'}, 규칙 ${ev.rules.size}개 로드)`));
