// 나를 소개하는 Q&A 봇 - 백엔드 서버
// Node.js 내장 모듈만 사용 (http, https, fs, path) — 외부 의존성 0개.
// 실행: ANTHROPIC_API_KEY=... node server.js

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const MODEL = "claude-opus-4-8";
const API_KEY = (process.env.ANTHROPIC_API_KEY || "").trim();

// 나에_대한_추측.md 를 읽어 시스템 프롬프트로 주입할 텍스트를 준비한다.
const ABOUT_ME_PATH = path.join(__dirname, "나에_대한_추측.md");
let aboutMe = "";
try {
  aboutMe = fs.readFileSync(ABOUT_ME_PATH, "utf8");
} catch (e) {
  console.error("⚠️  나에_대한_추측.md 를 읽지 못했어요. 같은 폴더에 나에_대한_추측.md 가 있는지 확인하세요.");
}

// 시스템 프롬프트: about-me.md 내용만 근거로 답하도록 강하게 제약한다.
function buildSystemPrompt() {
  return [
    "너는 'suyong'이라는 사람을 소개하는 Q&A 봇이야.",
    "",
    "반드시 아래 <about-me> 태그 안의 내용만 근거로 답해.",
    "거기에 없는 내용은 절대 지어내지 말고, '몰라요'(또는 그 정보는 제 소개에 없어요 같은 취지)라고 답해.",
    "너의 일반 상식이나 추측으로 답하지 마. 오직 <about-me> 문서가 유일한 근거야.",
    "한국어로, 친근하고 간결하게 답해.",
    "",
    "<about-me>",
    aboutMe,
    "</about-me>",
  ].join("\n");
}

// API 키가 없을 때: 나에_대한_추측.md 에서 직접 찾아 답한다 (로컬 검색 모드).
// 문서에 근거가 없으면 null 을 돌려 "몰라요"로 답하게 한다.
const STOP = new Set(["뭐", "무슨", "무엇", "어떻게", "어떤", "어때", "누구", "언제", "얼마", "왜",
  "그리고", "사람", "대해", "대한", "해줘", "알려", "정도", "있어", "있나", "하나", "그건", "이거"]);
// 한국어 조사 제거용 (질문 토큰 끝의 조사를 떼어 문서 표현과 맞춘다).
const JOSA = /(으로|에게|한테|부터|까지|처럼|보다|이야|에요|예요|은|는|이|가|을|를|에|의|도|만|와|과|로|야)$/;

function answerFromDoc(question) {
  // 문서를 의미 있는 줄만 후보로 정리 (헤딩·코드·표 구분선·다이어그램 제외).
  const lines = [];
  let inCode = false;
  for (const raw of aboutMe.split(/\n/)) {
    const t = raw.trim();
    if (t.startsWith("```")) { inCode = !inCode; continue; }
    if (inCode || !t) continue;
    if (t.startsWith("#")) continue;
    if (/^\|?\s*:?-{2,}/.test(t)) continue;
    if (/mermaid|flowchart|-->|\["/.test(t)) continue;
    const clean = raw
      .replace(/\|/g, " ")
      .replace(/[*`>#]/g, " ")
      .replace(/^\s*-\s+/, "")
      .replace(/\s+/g, " ")
      .trim();
    if (clean.length >= 2) lines.push(clean);
  }

  const q = question.toLowerCase();
  const keys = [];

  // 1) 자주 묻는 질문은 의도 → 문서 키워드로 확실히 연결한다.
  const intents = [
    { test: /(직업|무슨\s*일|하는\s*일|뭐\s*해|뭐하|직장|커리어|일\s*해|하시는)/, keys: ["실용주의", "학습자", "하버스쿨", "만들", "쓰면서 배운다", "학습 맥락"] },
    { test: /(취미|취향|좋아|관심|즐기|뭘\s*좋)/, keys: ["디자인", "토스", "글래스모피즘", "정리", "호기심", "재미", "미적"] },
    { test: /(만든|만들|제작|프로젝트|작품|뭐\s*만)/, keys: ["더치페이", "세금", "계산기", "qr", "pdf", "코인", "날씨", "꿈해몽", "포켓몬", "nasa", "짤", "생성기"] },
    { test: /(성격|성향|스타일|어떤\s*사람|특징|키워드)/, keys: ["실용적", "꼼꼼", "미적 감각", "정리정돈", "호기심", "자기성찰"] },
    { test: /(이름|닉네임|뭐라고\s*불|누구)/, keys: ["suyong"] },
    { test: /(공부|배우|학습|교육|학교|수업|어디서\s*배)/, keys: ["하버스쿨", "커리큘럼", "학습", "손으로", "주차"] },
  ];
  for (const it of intents) if (it.test.test(q)) keys.push(...it.keys);

  // 2) 일반 토큰: 조사 제거 후 2자 이상만 검색어로.
  const toks = (q.match(/[가-힣a-z0-9]+/g) || [])
    .map((w) => w.replace(JOSA, ""))
    .filter((w) => w.length >= 2 && !STOP.has(w));
  keys.push(...toks);

  if (keys.length === 0) return null;

  // 3) 각 줄을 키워드 포함 개수로 점수화 → 상위 줄들을 답으로.
  const scored = lines
    .map((l) => {
      const low = l.toLowerCase();
      let s = 0;
      for (const k of keys) if (k.length >= 2 && low.includes(k.toLowerCase())) s++;
      return { l, s };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);

  if (scored.length === 0) return null;
  return scored.slice(0, 3).map((x) => x.l).join("\n");
}

// Anthropic Messages API 를 raw HTTPS 로 호출한다.
function askClaude(question) {
  return new Promise((resolve, reject) => {
    if (!API_KEY) {
      return reject(new Error("NO_API_KEY"));
    }

    const payload = JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system: buildSystemPrompt(),
      messages: [{ role: "user", content: question }],
    });

    const req = https.request(
      {
        hostname: "api.anthropic.com",
        path: "/v1/messages",
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": API_KEY,
          "anthropic-version": "2023-06-01",
          "content-length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            const data = JSON.parse(body);
            if (res.statusCode >= 400) {
              const msg = (data && data.error && data.error.message) || "Claude API 호출에 실패했어요.";
              return reject(new Error(msg));
            }
            // content 배열에서 text 블록만 모은다.
            const answer = (data.content || [])
              .filter((b) => b.type === "text")
              .map((b) => b.text)
              .join("")
              .trim();
            resolve(answer || "답변을 만들지 못했어요. 다시 시도해 주세요.");
          } catch (err) {
            reject(new Error("Claude 응답을 해석하지 못했어요."));
          }
        });
      }
    );

    req.on("error", (err) => reject(new Error("네트워크 오류로 Claude에 연결하지 못했어요.")));
    req.write(payload);
    req.end();
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(body);
}

const server = http.createServer((req, res) => {
  // POST /api/ask : 질문을 받아 about-me.md 근거 답변을 돌려준다.
  if (req.method === "POST" && req.url === "/api/ask") {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) req.destroy(); // 과도한 입력 방지
    });
    req.on("end", async () => {
      let question;
      try {
        question = (JSON.parse(raw || "{}").question || "").trim();
      } catch (e) {
        return sendJson(res, 400, { error: "요청 형식이 올바르지 않아요." });
      }
      if (!question) {
        return sendJson(res, 400, { error: "질문을 입력해 주세요." });
      }
      // API 키가 없으면 문서에서 직접 찾아 답한다 (로컬 검색 모드).
      if (!API_KEY) {
        const found = answerFromDoc(question);
        return sendJson(res, 200, {
          answer: found || "음… 그건 제 소개 문서(나에_대한_추측.md)에 없어서 몰라요.",
        });
      }
      // 키가 있으면 Claude 로 더 자연스럽게 답한다.
      try {
        const answer = await askClaude(question);
        sendJson(res, 200, { answer });
      } catch (err) {
        // Claude 호출 실패 시에도 문서 검색으로 최대한 답해본다.
        const found = answerFromDoc(question);
        if (found) return sendJson(res, 200, { answer: found });
        sendJson(res, 500, { error: err.message || "알 수 없는 오류가 발생했어요." });
      }
    });
    return;
  }

  // GET / : 같은 폴더의 index.html 을 서빙한다.
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    const indexPath = path.join(__dirname, "index.html");
    fs.readFile(indexPath, (err, data) => {
      if (err) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end("<h1>준비 중이에요</h1><p>index.html 이 아직 없어요. 프론트엔드 파일을 추가해 주세요.</p>");
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(data);
    });
    return;
  }

  // 그 외
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("찾을 수 없는 경로예요.");
});

server.listen(PORT, () => {
  console.log("──────────────────────────────────────────");
  console.log("🤖 suyong 소개 Q&A 봇 서버가 시작됐어요!");
  console.log(`👉 브라우저에서 http://localhost:${PORT} 로 접속하세요.`);
  if (!API_KEY) {
    console.log("");
    console.log("ℹ️  ANTHROPIC_API_KEY 가 없어 '문서 검색 모드'로 동작해요 (나에_대한_추측.md에서 직접 찾아 답함).");
    console.log("   더 자연스러운 답을 원하면:  ANTHROPIC_API_KEY=발급받은키 node server.js");
  } else {
    console.log("🔑 API 키 감지됨 — Claude(claude-opus-4-8)로 답합니다.");
  }
  console.log("──────────────────────────────────────────");
});
