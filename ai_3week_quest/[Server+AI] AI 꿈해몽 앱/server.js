/*
 * [Server+AI] AI 꿈해몽 앱 - 백엔드 서버
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
const { DREAM_SYMBOLS, CATEGORIES, matchSymbols, searchDictionary } = require('./dream-dictionary');

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

// 해몽가 페르소나(캐릭터) 정의 - 말투/관점을 system 프롬프트에 주입
const PERSONAS = {
  mystic: {
    label: '🔮 신비로운 점술가',
    persona:
      '당신은 별과 운명을 읽는 신비로운 점술가입니다. 예스럽고 신비로운 어투("~하리라", "~이로다")를 쓰고, ' +
      '별·달·기운·운명·전조를 자주 언급하며 묵직하고 영험한 분위기로 꿈을 풀이합니다.',
  },
  mz: {
    label: '😎 MZ 해몽러',
    persona:
      '당신은 요즘 감성의 MZ세대 해몽러입니다. 친근하고 텐션 높은 요즘 말투에 적당한 이모지와 가벼운 드립을 섞어 ' +
      '재미있고 공감되게 꿈을 풀이합니다. 너무 진지하지 않게, 하지만 통찰은 확실하게.',
  },
  monk: {
    label: '🧘 해탈한 스님',
    persona:
      '당신은 모든 것을 내려놓은 해탈한 스님입니다. 담담하고 지혜로운 선문답풍 어투로, 집착을 내려놓는 관점에서 ' +
      '꿈의 의미를 마음공부와 연결해 잔잔하게 풀이합니다.',
  },
  bestie: {
    label: '🫶 다정한 친구',
    persona:
      '당신은 곁에서 늘 응원해주는 다정한 친구입니다. 따뜻하게 공감하고 다독여주는 말투로, ' +
      '꿈에 담긴 마음을 보듬어주며 용기를 주는 방향으로 풀이합니다.',
  },
};

// 꿈해몽 엔드포인트
app.post('/api/interpret', async (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'OPENAI_API_KEY 환경변수가 설정되지 않았습니다. 서버를 실행하기 전에 `export OPENAI_API_KEY=sk-...` 로 키를 설정하세요.',
    });
  }

  const { dream, persona } = req.body || {};

  if (!dream || !String(dream).trim()) {
    return res.status(400).json({ error: '꿈 내용을 입력해주세요.' });
  }

  // 모르는/없는 persona 키는 mystic으로 기본 처리
  const chosen = PERSONAS[persona] || PERSONAS.mystic;

  const systemPrompt =
    `${chosen.persona}\n\n` +
    '당신은 사용자가 적어준 "어젯밤 꿈"을 해몽하는 전문가입니다. 모든 답변은 한국어로 합니다. ' +
    '의학적·운명론적 단정은 피하고, 따뜻하고 재미 위주로 풀이하세요. ' +
    '반드시 아래 JSON 형식으로만, 정해진 5개 필드를 모두 채워서 답하세요:\n' +
    '{\n' +
    '  "summary": "꿈 전체를 관통하는 한 줄 요약",\n' +
    '  "keywords": ["상징 키워드", "..."],   // 3~5개의 짧은 단어\n' +
    '  "verdict": "길몽" | "흉몽" | "반길몽반흉몽",   // 셋 중 하나\n' +
    '  "advice": "오늘 하루를 위한 한 줄 조언",\n' +
    '  "luckScore": 0~100 사이 정수 (행운지수 100점 만점)\n' +
    '}\n' +
    'summary와 advice, keywords에는 당신(페르소나)의 말투/관점이 확실히 드러나게 하세요.';

  const userPrompt =
    `다음은 사용자가 적어준 어젯밤 꿈입니다. 위 형식에 맞춰 해몽해주세요.\n\n` +
    `"${String(dream).trim()}"`;

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
        temperature: 0.9,
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

    // ===== 응답 정규화 (계약 스키마 강제) =====

    // summary
    const summary = String(parsed.summary || '').trim() || '꿈의 의미를 또렷이 읽어내지 못했어요. 다시 한 번 적어주세요.';

    // keywords: 문자열 배열, 3~5개
    let keywords = Array.isArray(parsed.keywords) ? parsed.keywords : [];
    keywords = keywords
      .map((k) => String(k || '').trim())
      .filter(Boolean)
      .slice(0, 5);
    while (keywords.length < 3) keywords.push('미스터리'); // 최소 3개 보장

    // verdict: 세 값 중 하나로 보정
    const ALLOWED_VERDICT = ['길몽', '흉몽', '반길몽반흉몽'];
    let verdict = String(parsed.verdict || '').trim();
    if (!ALLOWED_VERDICT.includes(verdict)) verdict = '반길몽반흉몽';

    // advice
    const advice = String(parsed.advice || '').trim() || '오늘은 마음이 이끄는 대로, 너무 애쓰지 말고 흘러가 보세요.';

    // luckScore: 0~100 정수로 clamp
    let luckScore = Number(parsed.luckScore);
    if (!Number.isFinite(luckScore)) luckScore = 50;
    luckScore = Math.max(0, Math.min(100, Math.round(luckScore)));

    return res.json({ summary, keywords, verdict, advice, luckScore });
  } catch (err) {
    console.error('서버 오류:', err);
    return res.status(500).json({ error: '서버 내부 오류가 발생했습니다.' });
  }
});

// ============================================================
// 내부 서버 버전(오프라인) - OpenAI 없이 서버 자체 "꿈사전" 룰로 해몽
// API 키가 없어도 항상 동작. /api/interpret 와 동일한 응답 스키마.
// ============================================================

// 페르소나별 말투 (내부 버전 전용)
const LOCAL_TONE = {
  mystic: (sym, v) => ({
    summary: `별의 기운이 '${sym}'의 형상을 비추니, ${v === '길몽' ? '길한 조짐이 깃들었도다' : v === '흉몽' ? '몸을 낮추라는 전조가 보이는도다' : '길흉이 교차하는 운명이로다'}.`,
    advice: '서두르지 말고 마음의 소리에 귀 기울이라. 준비된 자에게 운이 따르느니라.',
  }),
  mz: (sym, v) => ({
    summary: `오늘 꿈 키워드는 '${sym}' ✨ ${v === '길몽' ? '이거 완전 럭키비키잖앙 🍀' : v === '흉몽' ? '음… 오늘은 좀 조심각 🥲' : '반반무많하게 흘러갈 듯 😶‍🌫️'}`,
    advice: '너무 깊게 생각 ㄴㄴ, 그냥 오늘 갓생 살면 됨! 화이팅 🔥',
  }),
  monk: (sym, v) => ({
    summary: `'${sym}'이라는 형상도 한낱 마음의 물결일 뿐. ${v === '길몽' ? '좋다 하여 들뜨지 말게' : v === '흉몽' ? '나쁘다 하여 흔들리지 말게' : '좋고 나쁨은 본디 둘이 아니라네'}.`,
    advice: '집착을 내려놓으면 길은 절로 열리는 법. 오늘도 그저 담담히 걸어가시게.',
  }),
  bestie: (sym, v) => ({
    summary: `네 꿈에 '${sym}'이 나왔구나! ${v === '길몽' ? '완전 좋은 꿈이야, 잘 될 거야 ☺️' : v === '흉몽' ? '좀 뒤숭숭했겠다… 그래도 괜찮아, 내가 있잖아' : '꿈이 좀 복잡했네, 너무 신경 쓰지 마'}`,
    advice: '오늘 혹시 힘들면 잠깐 쉬어가도 돼. 넌 충분히 잘하고 있어, 토닥토닥 🫶',
  }),
};

// 텍스트마다 살짝 다른 가산점 (0~14)
function deterministicJitter(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 100000;
  return h % 15;
}

function interpretLocally(dream, personaKey) {
  const text = String(dream);
  const matched = matchSymbols(text);

  // 행운지수
  let score = 50 + deterministicJitter(text);
  for (const m of matched) score += m.luck || 0;
  score = Math.max(3, Math.min(99, Math.round(score)));

  // 키워드 (중복 제거, 3~5개)
  let keywords = [...new Set(matched.map((m) => m.kw))].slice(0, 5);
  const FILLERS = ['무의식', '잠재의식', '메시지', '전환', '신비'];
  let fi = 0;
  while (keywords.length < 3 && fi < FILLERS.length) {
    if (!keywords.includes(FILLERS[fi])) keywords.push(FILLERS[fi]);
    fi++;
  }

  // 길흉: 매칭된 verdict 최빈값, 없으면 점수 기준
  const votes = matched.map((m) => m.verdict).filter(Boolean);
  let verdict;
  if (votes.length) {
    const count = {};
    votes.forEach((v) => (count[v] = (count[v] || 0) + 1));
    verdict = Object.keys(count).sort((a, b) => count[b] - count[a])[0];
  } else {
    verdict = score >= 65 ? '길몽' : score <= 42 ? '흉몽' : '반길몽반흉몽';
  }

  const topSym = matched.length ? matched[0].kw : '꿈';
  const tone = LOCAL_TONE[personaKey] || LOCAL_TONE.mystic;
  let { summary, advice } = tone(topSym, verdict, score);

  // 매칭된 상징이 있으면 사전 뜻을 한 줄 덧붙임
  if (matched.length) {
    const hints = matched.slice(0, 2).map((m) => `${m.kw}: ${m.meaning}`).join(' ');
    summary = `${summary} ${hints}`;
  }

  return {
    summary,
    keywords,
    verdict,
    advice,
    luckScore: score,
    matchedSymbols: matched.slice(0, 5).map((m) => ({
      kw: m.kw,
      category: m.category,
      meaning: m.meaning,
      verdict: m.verdict || (m.luck >= 8 ? '길몽' : m.luck <= -8 ? '흉몽' : '반길몽반흉몽'),
    })),
  };
}

// 꿈해몽 사전 조회 API
app.get('/api/dictionary', (req, res) => {
  const { q = '', category = '전체' } = req.query;
  const items = searchDictionary(q, category).map((s) => ({
    kw: s.kw,
    category: s.category,
    meaning: s.meaning,
    luck: s.luck,
    verdict: s.verdict || (s.luck >= 8 ? '길몽' : s.luck <= -8 ? '흉몽' : '반길몽반흉몽'),
    tags: s.match.slice(0, 4),
  }));
  res.json({ total: items.length, categories: CATEGORIES, items });
});

app.post('/api/interpret-local', (req, res) => {
  const { dream, persona } = req.body || {};
  if (!dream || !String(dream).trim()) {
    return res.status(400).json({ error: '꿈 내용을 입력해주세요.' });
  }
  const personaKey = PERSONAS[persona] ? persona : 'mystic';
  try {
    return res.json(interpretLocally(dream, personaKey));
  } catch (err) {
    console.error('내부 해몽 오류:', err);
    return res.status(500).json({ error: '내부 해몽 처리 중 오류가 발생했습니다.' });
  }
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log('');
    console.log('🌙 AI 꿈해몽 앱 서버가 실행되었습니다!');
    console.log(`   👉 http://localhost:${PORT}`);
    console.log('');
    if (!process.env.OPENAI_API_KEY) {
      console.log('⚠️  OPENAI_API_KEY가 설정되지 않았습니다. 해몽 기능을 사용하려면:');
      console.log('      export OPENAI_API_KEY=sk-...   (macOS/Linux)');
      console.log('      $env:OPENAI_API_KEY="sk-..."   (Windows PowerShell)');
      console.log('   설정 후 서버를 다시 실행하세요.');
      console.log('');
    }
  });
}

module.exports = app;
