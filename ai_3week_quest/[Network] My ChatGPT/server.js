// ========================================
// 나만의 ChatGPT 봇 — 백엔드 중계 서버
// Node.js 내장 모듈만 사용 (의존성 설치 불필요)
//   - http   : 정적 파일 서빙 + API 엔드포인트
//   - https  : OpenAI Chat Completions API 호출
//   - fs/path: index.html 읽기
// 실행: OPENAI_API_KEY=sk-... node server.js  →  http://localhost:3457
//
// 이 앱은 사용자가 성격/말투/전문분야를 직접 고르는 맞춤형 봇이라,
// 시스템 프롬프트를 클라이언트가 만들어 system 필드로 보내준다.
// 서버는 그 system을 messages 앞에 붙여 OpenAI에 전달한다.
// (심리상담 서버는 시스템 프롬프트가 서버에 고정되어 있는 점이 다르다.)
// ========================================

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// ---------------------------------------
// 설정
// ---------------------------------------
// 심리상담 서버(3456)와 겹치지 않게 3457 사용
const PORT = process.env.PORT || 3457;

// API 키는 서버에서만 사용 (클라이언트에 절대 노출 금지)
// 환경변수 OPENAI_API_KEY 로 주입 (platform.openai.com 에서 발급)
const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || '').trim();

const OPENAI_MODEL = 'gpt-4o-mini';

// system 필드가 비어있을 때 사용할 기본 시스템 프롬프트
const DEFAULT_SYSTEM_PROMPT = '너는 사용자 맞춤형 AI 챗봇이야. 한국어로 친절하게 답해.';

// ---------------------------------------
// OpenAI Chat Completions 호출 (https 모듈)
//   - 클라이언트가 보낸 system 프롬프트를 messages 맨 앞에 추가
// ---------------------------------------
function callOpenAI(messages, systemPrompt) {
  return new Promise((resolve, reject) => {
    if (!OPENAI_API_KEY) {
      return reject(
        new Error(
          'OPENAI_API_KEY 환경변수가 설정되지 않았어요. platform.openai.com 에서 키를 발급받아 환경변수로 넣어주세요.'
        )
      );
    }

    // 클라이언트가 보낸 시스템 프롬프트를 messages 앞에 항상 추가
    const payload = JSON.stringify({
      model: OPENAI_MODEL,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      temperature: 0.8,
      max_tokens: 500,
    });

    const options = {
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const msg = (json.error && json.error.message) || `OpenAI API 오류 (status ${res.statusCode})`;
            return reject(new Error(msg));
          }
          const reply = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
          if (!reply) return reject(new Error('OpenAI 응답에서 메시지를 찾을 수 없습니다.'));
          resolve(reply.trim());
        } catch (e) {
          reject(new Error('OpenAI 응답 파싱 실패: ' + e.message));
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.write(payload);
    req.end();
  });
}

// ---------------------------------------
// 요청 본문(JSON) 읽기 헬퍼
// ---------------------------------------
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      // 과도하게 큰 본문 방어 (1MB)
      if (data.length > 1e6) {
        reject(new Error('요청 본문이 너무 큽니다.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(new Error('잘못된 JSON 형식입니다.'));
      }
    });
    req.on('error', reject);
  });
}

// ---------------------------------------
// 일관된 JSON 응답 헬퍼
// ---------------------------------------
function sendJson(res, statusCode, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

// ---------------------------------------
// 정적 파일 서빙 (index.html)
// ---------------------------------------
function serveIndex(res) {
  const filePath = path.join(__dirname, 'index.html');
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('index.html을 찾을 수 없습니다.');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(content);
  });
}

// ---------------------------------------
// 라우팅
// ---------------------------------------
const server = http.createServer(async (req, res) => {
  const url = (req.url || '').split('?')[0];

  // POST /api/chat — OpenAI 응답
  if (req.method === 'POST' && url === '/api/chat') {
    try {
      const body = await readJsonBody(req);
      const messages = body.messages;

      // 시스템 프롬프트: 클라이언트가 보낸 system 우선, 없으면 기본값
      const systemPrompt =
        typeof body.system === 'string' && body.system.trim()
          ? body.system.trim()
          : DEFAULT_SYSTEM_PROMPT;

      // 입력 검증
      if (!Array.isArray(messages) || messages.length === 0) {
        return sendJson(res, 400, {
          success: false,
          message: 'messages 배열이 필요합니다.',
        });
      }

      // role/content 형태로 정규화 (안전하게 필터링)
      const cleaned = messages
        .filter((m) => m && typeof m.content === 'string' && m.content.trim())
        .map((m) => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content,
        }));

      if (cleaned.length === 0) {
        return sendJson(res, 400, {
          success: false,
          message: '유효한 메시지가 없습니다.',
        });
      }

      const reply = await callOpenAI(cleaned, systemPrompt);
      return sendJson(res, 200, { success: true, data: { reply } });
    } catch (err) {
      console.error('[POST /api/chat] 오류:', err.message);
      return sendJson(res, 500, {
        success: false,
        message: 'AI 응답을 가져오는 중 문제가 발생했어요. 잠시 후 다시 시도해 주세요.',
      });
    }
  }

  // GET / 또는 /index.html — 정적 파일
  if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
    return serveIndex(res);
  }

  // 그 외 — 404
  sendJson(res, 404, { success: false, message: '요청하신 경로를 찾을 수 없습니다.' });
});

server.listen(PORT, () => {
  console.log(`나만의 ChatGPT 봇 서버 실행 중 → http://localhost:${PORT}`);
});

module.exports = server;
