/*
 * [Server+AI] AI 별명 생성기 - 백엔드 서버
 *
 * 실행 방법:
 *   1) 의존성 설치:   npm install
 *   2) API 키 설정:    export OPENAI_API_KEY=sk-...   (Windows PowerShell: $env:OPENAI_API_KEY="sk-...")
 *   3) 서버 실행:      npm start   (또는: node server.js)
 *   4) 브라우저 접속:  http://localhost:3000
 *
 * Node 18+ 필요 (내장 fetch 사용).
 */

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// 같은 폴더의 정적 파일(index.html 등) 서빙
app.use(express.static(__dirname));

// 루트: index.html 반환
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4o-mini';

// 별명 생성 엔드포인트
app.post('/api/generate', async (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'OPENAI_API_KEY 환경변수가 설정되지 않았습니다. 서버를 실행하기 전에 `export OPENAI_API_KEY=sk-...` 로 키를 설정하세요.',
    });
  }

  const { name, personality, hobby, style } = req.body || {};

  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: '이름(name)은 필수 입력값입니다.' });
  }

  const styleText = (style && String(style).trim()) || '자유로운';

  const systemPrompt =
    '당신은 사람의 특징을 살려 재치있고 창의적인 한국어 별명을 지어주는 작명 전문가입니다. ' +
    '진부하지 않고, 부르기 쉬우면서도 기억에 남는 별명을 만듭니다. ' +
    '반드시 사용자가 요청한 "스타일/톤"을 강하게 반영하세요.';

  const userPrompt =
    `다음 사람에게 어울리는 재미있는 별명 5개를 지어주세요.\n\n` +
    `- 이름: ${name}\n` +
    `- 성격: ${personality || '(없음)'}\n` +
    `- 취미: ${hobby || '(없음)'}\n` +
    `- 원하는 스타일/톤: "${styleText}"\n\n` +
    `요구사항:\n` +
    `1. "${styleText}" 스타일/톤이 확실히 느껴지도록 만드세요.\n` +
    `2. 성격과 취미의 특징을 별명에 녹여내세요.\n` +
    `3. 각 별명마다 왜 그런 별명인지 짧고 재치있는 이유를 한 문장으로 덧붙이세요.\n` +
    `4. 정확히 5개를 만드세요.\n\n` +
    `반드시 아래 JSON 형식으로만 답하세요:\n` +
    `{ "nicknames": [ { "name": "별명", "reason": "이유 한 문장" }, ... ] }`;

  try {
    const aiRes = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 1.0,
        response_format: { type: 'json_object' },
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error('OpenAI API 오류:', aiRes.status, errText);
      return res.status(502).json({
        error: `AI 서버 호출에 실패했습니다 (status ${aiRes.status}). 잠시 후 다시 시도해주세요.`,
      });
    }

    const data = await aiRes.json();
    const content = data?.choices?.[0]?.message?.content || '{}';

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      console.error('AI 응답 JSON 파싱 실패:', content);
      return res.status(502).json({ error: 'AI 응답을 해석하지 못했습니다. 다시 시도해주세요.' });
    }

    let nicknames = Array.isArray(parsed.nicknames) ? parsed.nicknames : [];

    // 정규화: name/reason 문자열 보장, 최대 5개
    nicknames = nicknames
      .filter((n) => n && (n.name || typeof n === 'string'))
      .map((n) =>
        typeof n === 'string'
          ? { name: n, reason: '' }
          : { name: String(n.name || '').trim(), reason: String(n.reason || '').trim() }
      )
      .filter((n) => n.name)
      .slice(0, 5);

    if (nicknames.length === 0) {
      return res.status(502).json({ error: 'AI가 별명을 생성하지 못했습니다. 입력을 바꿔 다시 시도해주세요.' });
    }

    return res.json({ nicknames });
  } catch (err) {
    console.error('서버 오류:', err);
    return res.status(500).json({ error: '서버 내부 오류가 발생했습니다.' });
  }
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log('');
    console.log('🎉 AI 별명 생성기 서버가 실행되었습니다!');
    console.log(`   👉 http://localhost:${PORT}`);
    console.log('');
    if (!process.env.OPENAI_API_KEY) {
      console.log('⚠️  OPENAI_API_KEY가 설정되지 않았습니다. 별명 생성을 사용하려면:');
      console.log('      export OPENAI_API_KEY=sk-...   (macOS/Linux)');
      console.log('      $env:OPENAI_API_KEY="sk-..."   (Windows PowerShell)');
      console.log('   설정 후 서버를 다시 실행하세요.');
      console.log('');
    }
  });
}

module.exports = app;
