/*
 * [Context] 수업 내용 질문 에이전트 — 백엔드 서버 (하이브리드)
 *
 * 수업에서 배운 내용을 질문하면, 수업 자료(텍스트 노트 + 실습 코드)를 근거로 답하고
 * 이전 대화 맥락(메모리)을 기억해서 답하는 챗봇 서버입니다.
 *
 *  ▷ API 키가 없으면(오프라인 모드): context/지식베이스.md 를 검색해 답합니다. (키 불필요!)
 *  ▷ ANTHROPIC_API_KEY 가 있으면(AI 모드): Claude(claude-opus-4-8)로 더 풍부하게 답합니다.
 *
 * 실행 방법:
 *   1) 의존성 설치:   npm install
 *   2) (선택) 키 설정: export ANTHROPIC_API_KEY=sk-ant-...   ← 없어도 동작합니다
 *   3) 서버 실행:      npm start   (또는: node server.js)
 *   4) 브라우저 접속:  http://localhost:3000
 *
 * Node 18+ 필요 (내장 fetch 사용).
 *
 * ── 수업에서 배운 핵심 원칙 ──
 *  · API 키는 프론트가 아니라 서버 환경변수(.env)에만 둔다 → 브라우저에 키 노출 금지
 *  · 프론트(index.html)는 오직 내 서버(/api/...)만 호출한다
 *  · "문서를 근거로 답하는 봇" 패턴: 수업 자료를 근거로만 답한다 → 환각 방지
 */

const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(__dirname)); // 같은 폴더의 index.html 등 정적 서빙

// ────────────────────────────────────────────────────────────
//  Anthropic Claude API 설정 (키가 있을 때만 사용)
// ────────────────────────────────────────────────────────────
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-opus-4-8';
const MAX_TOKENS = 2048;

// ────────────────────────────────────────────────────────────
//  1) 컨텍스트 로딩 (텍스트 + 코드)
// ────────────────────────────────────────────────────────────
const CONTEXT_DIR = path.join(__dirname, 'context');
const PER_FILE_LIMIT = 16000;
const TEXT_EXT = new Set(['.md', '.txt']);
const CODE_EXT = new Set(['.html', '.js']);

function walk(dir) {
  let results = [];
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return results;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results = results.concat(walk(full));
    else if (entry.isFile()) results.push(full);
  }
  return results;
}

function loadContext() {
  const textFiles = []; // { name, chars }
  const codeFiles = []; // { name, chars }
  const codeData = []; // { name, content } — "코드 보여줘"에 사용
  const chunks = []; // Claude용 시스템 프롬프트 조각
  let totalChars = 0;

  for (const full of walk(CONTEXT_DIR).sort()) {
    const ext = path.extname(full).toLowerCase();
    const isText = TEXT_EXT.has(ext);
    const isCode = CODE_EXT.has(ext);
    if (!isText && !isCode) continue;

    let content = '';
    try {
      content = fs.readFileSync(full, 'utf8');
    } catch (e) {
      continue;
    }

    const rel = path.relative(CONTEXT_DIR, full);
    let body = content;
    let note = '';
    if (body.length > PER_FILE_LIMIT) {
      body = body.slice(0, PER_FILE_LIMIT);
      note = `\n\n…(파일이 길어 앞부분 ${PER_FILE_LIMIT}자만 표시됨)`;
    }
    chunks.push(`### 파일: ${rel} (${isText ? '텍스트' : '코드'} 컨텍스트)\n\`\`\`\n${body}${note}\n\`\`\``);

    const info = { name: rel, chars: content.length };
    if (isText) textFiles.push(info);
    else {
      codeFiles.push(info);
      codeData.push({ name: rel, content });
    }
    totalChars += content.length;
  }

  return { textFiles, codeFiles, codeData, totalChars, contextText: chunks.join('\n\n') };
}

const CONTEXT = loadContext();

// ────────────────────────────────────────────────────────────
//  2) 지식베이스 파싱 (오프라인 답변 엔진의 핵심)
//     context/지식베이스.md 를 "## 질문" 단위로 쪼개 항목 배열로 만든다.
// ────────────────────────────────────────────────────────────
function parseKnowledgeBase() {
  const file = path.join(CONTEXT_DIR, '지식베이스.md');
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    return [];
  }
  const entries = [];
  // "## 제목" 으로 항목을 나눈다 ("# " 한 개짜리 큰 제목/머리말은 제외)
  const blocks = text.split(/\n(?=## )/);
  for (const block of blocks) {
    const m = block.match(/^##\s+(.+)$/m);
    if (!m) continue;
    const question = m[1].trim();
    // <!-- keywords: a, b, c --> 추출
    const kwMatch = block.match(/<!--\s*keywords:\s*([^>]*?)\s*-->/i);
    const keywords = kwMatch ? kwMatch[1].split(',').map((s) => s.trim()).filter(Boolean) : [];
    // 본문 = 제목/키워드 줄을 뺀 나머지
    const body = block
      .replace(/^##\s+.+$/m, '')
      .replace(/<!--\s*keywords:[^>]*-->/i, '')
      .trim();
    entries.push({ question, keywords, body });
  }
  return entries;
}

const KB = parseKnowledgeBase();

console.log(
  `[컨텍스트 로딩] 텍스트 ${CONTEXT.textFiles.length}개, 코드 ${CONTEXT.codeFiles.length}개, ` +
    `총 ${CONTEXT.totalChars.toLocaleString()}자 / 지식베이스 항목 ${KB.length}개`
);
console.log(
  `[모드] ${process.env.ANTHROPIC_API_KEY ? 'AI(Claude) — 키 감지됨' : '오프라인 — 지식베이스 기반 (키 없이 동작)'}`
);

// ────────────────────────────────────────────────────────────
//  오프라인 답변 엔진
// ────────────────────────────────────────────────────────────
function normalize(s) {
  // 한글/영문/숫자만 남기고 소문자화
  return String(s).toLowerCase().replace(/[^0-9a-z가-힣]+/g, ' ').trim();
}
function flat(s) {
  return normalize(s).replace(/\s+/g, ''); // 공백까지 제거(조사 영향 줄이기)
}

const FOLLOWUP_RE = /(아까|방금|앞에서|위에서|그거|그것|그건|이어서|연결|더\s*자세|자세히|좀\s*더|추가로|계속)/;

const CODE_FILE_KEYS = [
  { keys: ['더치페이', '더피페이', '정산', '1/n'], match: '더치페이' },
  { keys: ['qr', '큐알', 'qr코드'], match: 'QR' },
  { keys: ['포켓몬', '도감', 'pokeapi'], match: '포켓몬' },
  { keys: ['날씨'], match: '날씨앱' },
  { keys: ['별명'], match: '별명' },
  { keys: ['q&a', 'qa', '큐엔에이', '소개', '추측'], match: 'Q&A' },
];

function findCodeFile(query) {
  const q = flat(query);
  for (const c of CODE_FILE_KEYS) {
    if (c.keys.some((k) => q.includes(flat(k)))) {
      const file = CONTEXT.codeData.find((f) => f.name.includes(c.match));
      if (file) return file;
    }
  }
  return null;
}

function isCodeRequest(query) {
  const q = flat(query);
  return /코드|소스|sourcecode|소스코드/.test(q) || /(코드|소스|파일).*(보여|보고|줘|줄래|볼래)/.test(normalize(query));
}

/** 지식베이스에서 질문과 가장 잘 맞는 항목을 점수로 찾는다 */
function scoreEntry(entry, query) {
  const q = flat(query);
  let score = 0;
  for (const kw of entry.keywords) {
    const k = flat(kw);
    if (k.length >= 2 && q.includes(k)) {
      score += k.length >= 4 ? 3 : 2; // 긴 키워드일수록 가중치↑
    }
  }
  // 제목 단어 매칭도 약간 반영
  for (const w of normalize(entry.question).split(' ')) {
    if (w.length >= 2 && q.includes(flat(w))) score += 1;
  }
  return score;
}

function bestEntry(query) {
  let best = null;
  let bestScore = 0;
  for (const e of KB) {
    const s = scoreEntry(e, query);
    if (s > bestScore) {
      bestScore = s;
      best = e;
    }
  }
  return { entry: best, score: bestScore };
}

function topicList() {
  return KB.map((e) => `• ${e.question}`).join('\n');
}

/**
 * 오프라인 답변 생성. session.lastTopic(직전 항목 제목)으로 후속질문 맥락을 잇는다.
 * 반환: { reply, topic }
 */
function answerLocally(query, session) {
  // 1) 코드 요청이면 해당 실습 파일을 찾아 보여준다
  if (isCodeRequest(query)) {
    const file = findCodeFile(query);
    if (file) {
      const lang = file.name.toLowerCase().endsWith('.js') ? 'js' : 'html';
      const MAX = 160;
      const lines = file.content.split('\n');
      const shown = lines.slice(0, MAX).join('\n');
      const cut = lines.length > MAX ? `\n\n> (파일이 길어 앞 ${MAX}줄만 표시했어요. 전체는 \`context/${file.name}\` 파일에 있어요.)` : '';
      return {
        reply: `요청하신 **${file.name}** 코드예요. 👇\n\n\`\`\`${lang}\n${shown}\n\`\`\`${cut}`,
        topic: '코드: ' + file.name,
      };
    }
    return {
      reply:
        '어떤 코드를 보여드릴까요? 가지고 있는 실습 코드는 다음과 같아요:\n' +
        CONTEXT.codeData.map((f) => `• ${f.name}`).join('\n') +
        '\n\n예: "더치페이 계산기 코드 보여줘", "별명 생성기 server.js 보여줘"',
      topic: null,
    };
  }

  // 2) 지식베이스 검색
  const { entry, score } = bestEntry(query);
  const isFollowup = FOLLOWUP_RE.test(query);

  // 3) 후속질문인데 잘 안 잡히면, 직전 주제로 이어서 답한다 (메모리 활용)
  if (isFollowup && score < 4 && session.lastTopic) {
    const prev = KB.find((e) => e.question === session.lastTopic);
    if (prev) {
      return {
        reply: `아까 "${prev.question}" 이야기에 이어서 다시 정리하면요 👇\n\n${prev.body}`,
        topic: prev.question,
      };
    }
  }

  if (entry && score >= 2) {
    let prefix = '';
    if (isFollowup && session.lastTopic && session.lastTopic !== entry.question) {
      prefix = `(아까 "${session.lastTopic}" 이야기와 연결해서 보면)\n\n`;
    }
    return { reply: prefix + entry.body, topic: entry.question };
  }

  // 4) 못 찾았을 때
  return {
    reply:
      '음… 그 내용은 수업 자료에서 딱 맞는 항목을 못 찾았어요. 🙏\n' +
      '이런 것들을 물어볼 수 있어요:\n' +
      topicList() +
      '\n\n(또는 "더치페이 계산기 코드 보여줘"처럼 실습 코드를 요청해도 돼요.)',
    topic: null,
  };
}

// ────────────────────────────────────────────────────────────
//  3) 메모리: 세션별 대화 기록 (memory/sessions.json에 영속 저장)
//     형태: { sessionId: { messages: [{role,content}], lastTopic: string|null } }
// ────────────────────────────────────────────────────────────
const MEMORY_DIR = path.join(__dirname, 'memory');
const MEMORY_FILE = path.join(MEMORY_DIR, 'sessions.json');
let sessions = {};

function loadSessions() {
  try {
    if (fs.existsSync(MEMORY_FILE)) sessions = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8')) || {};
  } catch (e) {
    console.warn('[메모리] sessions.json 읽기 실패, 빈 메모리로 시작:', e.message);
    sessions = {};
  }
}
function saveSessions() {
  try {
    if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true });
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(sessions, null, 2), 'utf8');
  } catch (e) {
    console.warn('[메모리] 저장 실패:', e.message);
  }
}
function getSession(id) {
  if (!sessions[id]) sessions[id] = { messages: [], lastTopic: null };
  // 예전 형식(배열) 호환
  if (Array.isArray(sessions[id])) sessions[id] = { messages: sessions[id], lastTopic: null };
  return sessions[id];
}
loadSessions();

function newSessionId() {
  return 'sess_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function buildSystemPrompt() {
  return (
    '너는 "하버스쿨 AI 교육" 수강생을 돕는 **수업 내용 질문 에이전트**다.\n' +
    '아래 <수업자료>의 텍스트 노트와 실습 코드를 **근거로** 한국어로 정확하고 친절하게 답하라.\n' +
    '1. 답변은 <수업자료>에 기반한다. 코드를 보여달라면 해당 실습 파일에서 찾아 보여주고 출처 파일명을 알려준다.\n' +
    '2. 자료에 없는 내용은 지어내지 말고 "수업 자료에는 안 나와요"라고 솔직히 말한다.\n' +
    '3. 이전 대화 맥락을 기억하고 자연스럽게 이어서 답한다.\n' +
    '4. 코드는 마크다운 코드블록(```)으로 답한다.\n\n' +
    '<수업자료>\n' +
    CONTEXT.contextText +
    '\n</수업자료>'
  );
}

async function answerWithClaude(apiKey, history, message) {
  const messagesForApi = [...history, { role: 'user', content: String(message) }];
  const aiRes = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, system: buildSystemPrompt(), messages: messagesForApi }),
  });
  if (!aiRes.ok) {
    let detail = '';
    try {
      detail = (await aiRes.json())?.error?.message || '';
    } catch (_) {
      detail = await aiRes.text().catch(() => '');
    }
    throw new Error(`AI 서버 호출 실패 (HTTP ${aiRes.status}). ${detail}`.trim());
  }
  const data = await aiRes.json();
  return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
}

// ────────────────────────────────────────────────────────────
//  API 엔드포인트
// ────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.get('/api/context', (req, res) => {
  res.json({
    textFiles: CONTEXT.textFiles,
    codeFiles: CONTEXT.codeFiles,
    totalChars: CONTEXT.totalChars,
    mode: (process.env.ANTHROPIC_API_KEY || '').trim() ? 'ai' : 'offline',
    kbCount: KB.length,
  });
});

app.get('/api/history', (req, res) => {
  const s = getSession(String(req.query.sessionId || ''));
  res.json({ messages: s.messages || [] });
});

app.post('/api/reset', (req, res) => {
  const { sessionId } = req.body || {};
  if (sessionId && sessions[sessionId]) {
    delete sessions[sessionId];
    saveSessions();
  }
  res.json({ ok: true });
});

app.post('/api/chat', async (req, res) => {
  let { sessionId, message } = req.body || {};
  if (!message || !String(message).trim()) {
    return res.status(400).json({ error: '질문(message)을 입력해 주세요.' });
  }
  if (!sessionId || !String(sessionId).trim()) sessionId = newSessionId();

  const session = getSession(sessionId);
  const apiKey = (process.env.ANTHROPIC_API_KEY || '').trim();

  try {
    let reply;
    if (apiKey) {
      // AI 모드: Claude로 답변 (이전 대화 전체를 함께 전달 → 맥락 유지)
      reply = await answerWithClaude(apiKey, session.messages, message);
      if (!reply) reply = '(답변을 생성하지 못했어요. 다시 시도해 주세요.)';
    } else {
      // 오프라인 모드: 지식베이스 검색으로 답변 (직전 주제로 후속질문 맥락 유지)
      const out = answerLocally(String(message), session);
      reply = out.reply;
      session.lastTopic = out.topic || session.lastTopic;
    }

    // 메모리에 기록
    session.messages.push({ role: 'user', content: String(message) });
    session.messages.push({ role: 'assistant', content: reply });
    sessions[sessionId] = session;
    saveSessions();

    res.json({ reply, sessionId });
  } catch (e) {
    console.error('[오류]', e.message);
    res.status(502).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`수업 내용 질문 에이전트 실행 중 → http://localhost:${PORT}`));
