// 나를 설명하는 Q&A 앱 - 백엔드 서버
// Node.js 내장 모듈만 사용 (http, https, fs, path) — 외부 의존성 0개.
// 실행: ANTHROPIC_API_KEY=... node server.js   (키 없이도 로컬 검색 모드로 동작)

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const MODEL = "claude-opus-4-8";
const API_KEY = (process.env.ANTHROPIC_API_KEY || "").trim();

// about-me.md 를 읽어 컨텍스트(지식의 전부)로 보관한다.
const ABOUT_ME_PATH = path.join(__dirname, "about-me.md");
let aboutMe = "";
try {
  aboutMe = fs.readFileSync(ABOUT_ME_PATH, "utf8");
} catch (e) {
  console.error("⚠️  about-me.md 를 읽지 못했어요. 같은 폴더에 about-me.md 가 있는지 확인하세요.");
}

// ── 시스템 프롬프트: about-me.md 내용만 근거로 답하도록 강하게 제약한다. ──
function buildSystemPrompt() {
  return [
    "너는 about-me.md 에 적힌 사람을 소개하는 Q&A 봇이야.",
    "",
    "반드시 아래 <about-me> 태그 안의 내용만 근거로 답해.",
    "거기에 없는 내용은 절대 지어내지 말고, '몰라요'(또는 '그 정보는 제 소개에 없어요' 같은 취지)라고 답해.",
    "너의 일반 상식이나 추측으로 답하지 마. 오직 <about-me> 문서가 유일한 근거야.",
    "한국어로, 친근하고 간결하게 답해.",
    "",
    "<about-me>",
    aboutMe,
    "</about-me>",
  ].join("\n");
}

// ── 로컬 검색 모드 (API 키가 없을 때): about-me.md 본문에서 질문 키워드로 관련 줄을 찾아 답한다. ──
// 문서(수업 내용 기반)에 근거가 없으면 null 을 돌려 "몰라요"로 답하게 한다.
const STOP = new Set(["뭐", "무슨", "무엇", "어떻게", "어떤", "어때", "누구", "언제", "얼마", "왜",
  "그리고", "사람", "대해", "대한", "해줘", "알려", "정도", "있어", "있나", "하나", "그건", "이거",
  "보여", "설명", "관해", "관한", "그때", "거야", "인가", "한가"]);
// 한국어 조사 제거용 (질문 토큰 끝의 조사를 떼어 문서 표현과 맞춘다).
const JOSA = /(으로|에게|한테|부터|까지|처럼|보다|이야|에요|예요|은|는|이|가|을|를|에|의|도|만|와|과|로|야)$/;

function answerFromDoc(question) {
  // 문서를 의미 있는 줄만 후보로 정리 (헤딩·코드·표 구분선·주석 제외).
  const lines = [];
  let inCode = false;
  for (const raw of aboutMe.split(/\n/)) {
    const t = raw.trim();
    if (t.startsWith("```")) { inCode = !inCode; continue; }
    if (inCode || !t) continue;
    if (t.startsWith("#")) continue;          // 헤딩 제외
    if (t.startsWith(">")) continue;          // 인용(안내문) 제외
    if (t.startsWith("<!--") || t.startsWith("-->")) continue; // 주석 제외
    if (/^\|?\s*:?-{2,}/.test(t)) continue;   // 표 구분선 제외
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

  // 1) 자주 묻는 질문은 의도 → 문서 키워드로 확실히 연결한다. (개인 + 수업 내용 모두 커버)
  const intents = [
    // ── 나에 대한 질문 ──
    { test: /(이름|닉네임|뭐라고\s*불|누구)/, keys: ["송수용", "suyong"] },
    { test: /(직업|무슨\s*일|하는\s*일|뭐\s*해|뭐하|직장|커리어|일\s*해|하시는|하는지)/, keys: ["하버스쿨", "수강", "학습자", "만들면서", "실용주의"] },
    { test: /(성격|성향|스타일|어떤\s*사람|특징|키워드)/, keys: ["실용적", "꼼꼼", "정리정돈", "호기심", "자기성찰"] },
    { test: /(취미|취향|좋아|관심|즐기|뭘\s*좋)/, keys: ["디자인", "토스", "글래스모피즘", "정리", "도구", "사용자 경험"] },
    // ── 수업 내용에 대한 질문 ──
    { test: /(배운|배웠|배우|학습|수업|커리큘럼|과정|공부)/, keys: ["2주차", "3주차", "프론트엔드", "api", "서버", "배웠다"] },
    { test: /(서버|백엔드|node|express|왜\s*필요)/, keys: ["서버", "백엔드", "node.js", "express", "정적 파일", "엔드포인트"] },
    { test: /(api\s*키|키를|키\s*숨|보안|env|환경변수|노출|훔)/, keys: ["api 키", "환경변수", ".env", "노출", "훔쳐", "프론트엔드"] },
    { test: /(fetch|네트워크|비동기|async|await|json|호출)/, keys: ["fetch", "async", "await", "json", "비동기", "res.ok"] },
    { test: /(rag|근거|문서.*답|환각|지어내)/, keys: ["rag", "시스템 프롬프트", "근거", "환각", "몰라요"] },
    { test: /(만든|만들|제작|프로젝트|작품|뭐\s*만)/, keys: ["계산기", "생성기", "날씨", "포켓몬", "코인", "꿈해몽", "별명", "도감", "nasa", "더치페이"] },
    { test: /(2주차|계산기|qr|pdf|짤|밈|변환)/, keys: ["2주차", "더치페이", "세금", "qr", "pdf", "짤", "canvas"] },
    { test: /(3주차|날씨|포켓몬|코인|이미지|챗|chatgpt)/, keys: ["3주차", "날씨앱", "포켓몬", "코인", "이미지", "chatgpt", "심리상담"] },
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
  return scored.slice(0, 3).map((x) => "· " + x.l).join("\n");
}

// ── Anthropic Messages API 를 raw HTTPS 로 호출한다. ──
function askClaude(question) {
  return new Promise((resolve, reject) => {
    if (!API_KEY) return reject(new Error("NO_API_KEY"));

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
          "x-api-key": API_KEY, // ← 키는 서버에만. 프론트로 절대 내려보내지 않는다.
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

    req.on("error", () => reject(new Error("네트워크 오류로 Claude에 연결하지 못했어요.")));
    req.write(payload);
    req.end();
  });
}

function sendJson(res, status, obj) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
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
      if (!question) return sendJson(res, 400, { error: "질문을 입력해 주세요." });

      // API 키가 없으면 문서(수업 내용)에서 직접 찾아 답한다 (로컬 검색 모드).
      if (!API_KEY) {
        const found = answerFromDoc(question);
        return sendJson(res, 200, {
          answer: found || "음… 그건 제 소개 문서(about-me.md)에 없어서 몰라요.",
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
    fs.readFile(path.join(__dirname, "index.html"), (err, data) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      if (err) return res.end("<h1>준비 중이에요</h1><p>index.html 이 아직 없어요.</p>");
      res.end(data);
    });
    return;
  }

  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("찾을 수 없는 경로예요.");
});

server.listen(PORT, () => {
  console.log("──────────────────────────────────────────");
  console.log("🤖 나를 설명하는 Q&A 앱 서버가 시작됐어요!");
  console.log(`👉 브라우저에서 http://localhost:${PORT} 로 접속하세요.`);
  if (!API_KEY) {
    console.log("");
    console.log("ℹ️  ANTHROPIC_API_KEY 가 없어 '문서 검색 모드'로 동작해요.");
    console.log("   about-me.md(수업 내용 기반)에서 직접 찾아 답하므로 키 없이도 잘 돌아갑니다.");
    console.log("   더 자연스러운 답을 원하면:  ANTHROPIC_API_KEY=발급받은키 node server.js");
  } else {
    console.log("🔑 API 키 감지됨 — Claude(claude-opus-4-8)로 답합니다.");
  }
  console.log("──────────────────────────────────────────");
});
