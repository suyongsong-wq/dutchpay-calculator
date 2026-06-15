// ============================================================
//  나만의 이미지 생성 서비스 — 서버 버전 (server.js)
//  하버스쿨 AI 교육 · Network + AI 실습 (풀스택)
//
//  ▶ 단일 HTML 버전과의 가장 큰 차이:
//    - 단일 버전: 브라우저(React)가 직접 프롬프트를 조합하고
//      Pollinations.ai로 바로 이미지를 요청했다.
//    - 서버 버전: "서버(server.js)"가 핵심 일을 한다.
//        1) 스타일 프리셋을 보관하고 제공한다 (/api/styles)
//        2) "사용자 프롬프트 + 스타일 키워드"를 조합한다
//        3) 조합한 프롬프트로 Pollinations.ai에 직접 요청해
//           이미지를 받아온 뒤(스트리밍) 브라우저로 그대로 흘려보낸다(프록시)
//      → 브라우저 입장에서는 모든 요청이 "같은 출처(same-origin)"라
//        다운로드/CORS 문제가 사라진다.
//
//  ▶ 의존성 없음: Node 내장 모듈(http, https, fs, path, url)만 사용.
//    npm install 불필요. 그냥  node server.js  로 실행.
//
//  ▶ provider 2종 지원 (provider 쿼리 파라미터로 선택):
//      - pollinations (기본값) : 무료, API 키 불필요. URL 자체가 이미지.
//      - fal                   : fal.ai FLUX schnell. 고품질, API 키 필요.
//        ┌ fal.ai 호출 흐름(서버에서 내장 https 모듈만 사용) ─────────┐
//        │ 1) POST https://fal.run/fal-ai/flux/schnell 로 생성 요청   │
//        │    (Authorization: Key <FAL_KEY>, 바디는 프롬프트/시드 등)  │
//        │ 2) 응답 JSON 의 images[0].url 에서 결과 이미지 주소를 추출  │
//        │ 3) 그 url 을 서버가 다시 https.get 으로 받아 res 로 pipe    │
//        │    → 클라이언트는 same-origin 스트리밍이라 CORS/다운로드 OK │
//        └────────────────────────────────────────────────────────┘
//
//  ▶ fal.ai 사용법:
//      FAL_KEY=발급받은키 node server.js
//    키 없이 그냥  node server.js  로 실행해도 Pollinations 는 그대로 동작.
//    (API 키는 환경변수로만 읽으며, 코드에 하드코딩하거나 로깅하지 않는다.)
// ============================================================

const http = require('http');     // 우리 서버를 띄우는 모듈
const https = require('https');    // Pollinations.ai(https)에 요청을 보내는 모듈
const fs = require('fs');          // index.html / client.js 정적 파일 읽기
const path = require('path');      // 파일 경로 조립
const { URL } = require('url');    // 요청 URL의 쿼리스트링 파싱

const PORT = process.env.PORT || 3000;

// fal.ai API 키는 환경변수에서만 읽는다. (trailing newline 방지를 위해 .trim())
// 절대 코드에 하드코딩하거나 콘솔/응답에 노출하지 않는다.
const FAL_KEY = (process.env.FAL_KEY || '').trim();

// Hugging Face 토큰도 환경변수에서만 읽는다. (무료 발급: huggingface.co/settings/tokens)
const HF_TOKEN = (process.env.HF_TOKEN || '').trim();

// Hugging Face 이미지 생성에 쓸 모델 (text-to-image). 무료 서버리스 추론 라우터 사용.
const HF_MODEL = 'black-forest-labs/FLUX.1-schnell';

// ------------------------------------------------------------
//  스타일 프리셋 8종 (서버가 보유하는 데이터)
//   - id:       내부 식별자 (client → server 로 전달됨)
//   - label:    화면에 보일 한글 이름
//   - keywords: 최종 프롬프트에 더해질 "영어" 스타일 키워드
//               (영어 키워드가 이미지 모델에서 화질이 더 좋다)
//   - emoji:    카드 시각 표현용
//   - desc:     카드 설명용 한 줄 (교육 친화)
//  핵심 원리 → "사용자 프롬프트" + "스타일 키워드" = 최종 프롬프트
// ------------------------------------------------------------
const STYLE_PRESETS = [
  { id: 'photo',      label: '사진 실사',            emoji: '📷', desc: 'DSLR 느낌의 사실적인 사진',
    keywords: 'photorealistic, ultra realistic photo, 8k, sharp focus, natural lighting, DSLR' },
  { id: 'anime',      label: '애니메이션 / 지브리풍', emoji: '🌸', desc: '부드러운 셀 애니메이션 화풍',
    keywords: 'anime, studio ghibli style, cel shading, soft colors, hand drawn, beautiful background' },
  { id: 'oil',        label: '유화',                 emoji: '🖼️', desc: '두꺼운 붓터치의 클래식 유화',
    keywords: 'oil painting, thick brush strokes, classical art, textured canvas, fine art masterpiece' },
  { id: 'watercolor', label: '수채화',               emoji: '🎨', desc: '맑고 번지는 수채 일러스트',
    keywords: 'watercolor, soft washes, bleeding colors, paper texture, delicate, light and airy' },
  { id: 'cyberpunk',  label: '사이버펑크',           emoji: '🌃', desc: '네온 가득한 미래 도시 분위기',
    keywords: 'cyberpunk, neon, futuristic, glowing, rain, blade runner aesthetic, high detail' },
  { id: 'pixel',      label: '픽셀아트',             emoji: '👾', desc: '레트로 게임 도트 그래픽',
    keywords: 'pixel art, 16-bit, retro game style, pixelated, vibrant palette, isometric' },
  { id: 'render3d',   label: '3D 렌더',              emoji: '🧊', desc: '매끈한 3D CG 렌더링',
    keywords: '3d render, octane, cinema4d, soft global illumination, smooth materials, high quality cgi' },
  { id: 'lineart',    label: '미니멀 라인아트',      emoji: '✏️', desc: '깔끔한 선 위주의 미니멀 일러스트',
    keywords: 'minimal line art, clean vector lines, simple, flat design, limited color palette, elegant' },
];

// ------------------------------------------------------------
//  [핵심 1] 프롬프트 조합 함수
//   최종 프롬프트 = 사용자가 적은 문장  +  ", "  +  스타일 키워드
//   잘못된 styleId가 와도 기본값(첫 프리셋)으로 안전하게 처리한다.
// ------------------------------------------------------------
function buildFinalPrompt(userPrompt, styleId) {
  const preset = STYLE_PRESETS.find((s) => s.id === styleId) || STYLE_PRESETS[0];
  const cleaned = String(userPrompt || '').trim();
  // 사용자 입력이 비어 있으면 키워드만으로도 의미가 없으니 그대로 둔다(검증은 라우트에서)
  return `${cleaned}, ${preset.keywords}`;
}

// provider 쿼리값을 안전하게 정규화한다.
//   허용: 'fal' | 'huggingface' | 'pollinations'(기본, 하위호환)
function normalizeProvider(value) {
  if (value === 'fal' || value === 'huggingface') return value;
  return 'pollinations';
}

// ------------------------------------------------------------
//  작은 도우미들
// ------------------------------------------------------------

// JSON 응답을 일관된 형태로 보낸다.
function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

// 확장자별 Content-Type 매핑 (정적 파일 서빙용)
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
};

// 정적 파일 하나를 읽어서 응답한다 (index.html, client.js).
function serveStatic(res, fileName) {
  const filePath = path.join(__dirname, fileName);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendJson(res, 404, { success: false, message: `파일을 찾을 수 없습니다: ${fileName}` });
      return;
    }
    const ext = path.extname(fileName).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// ------------------------------------------------------------
//  [공통 도우미] 이미지 URL 하나를 받아서 클라이언트(res)로 스트리밍 프록시
//   - Pollinations 와 fal 둘 다, "최종 이미지가 있는 URL"을 얻은 다음
//     이 함수로 똑같이 흘려보낸다(받는 즉시 pipe → 메모리에 통째로 안 담음).
//   - 브라우저는 우리 서버(/api/image)에서 이미지를 받으므로 same-origin →
//     CORS·다운로드 문제가 없다.
// ------------------------------------------------------------
function streamImageUrl(res, imageUrl) {
  const upstream = https.get(imageUrl, (imgRes) => {
    if (imgRes.statusCode !== 200) {
      imgRes.resume(); // 스트림을 비워 메모리 누수 방지
      if (!res.headersSent) {
        sendJson(res, 502, {
          success: false,
          message: `이미지 서버 응답 오류 (status ${imgRes.statusCode})`,
        });
      }
      return;
    }

    res.writeHead(200, {
      'Content-Type': imgRes.headers['content-type'] || 'image/jpeg',
      'Cache-Control': 'no-store',
    });

    // ▶ 스트리밍 프록시의 핵심: 받는 즉시 그대로 흘려보낸다.
    imgRes.pipe(res);
  });

  upstream.on('error', (err) => {
    if (!res.headersSent) {
      sendJson(res, 502, { success: false, message: `이미지 요청 실패: ${err.message}` });
    } else {
      res.end();
    }
  });

  upstream.setTimeout(45000, () => {
    upstream.destroy();
    if (!res.headersSent) {
      sendJson(res, 504, { success: false, message: '이미지 생성 시간이 초과되었습니다.' });
    }
  });
}

// ------------------------------------------------------------
//  [핵심 2-A] Pollinations 이미지 프록시 (기본 provider · 키 불필요)
//   1) buildFinalPrompt 로 최종 프롬프트를 만든다.
//   2) Pollinations.ai URL을 조립한다 (URL 자체가 이미지).
//   3) streamImageUrl 로 그 URL을 받아 클라이언트로 스트리밍한다.
// ------------------------------------------------------------
function proxyPollinations(res, userPrompt, styleId, seed) {
  const finalPrompt = buildFinalPrompt(userPrompt, styleId);

  // Pollinations.ai 는 URL 자체가 이미지다. 프롬프트는 URL 인코딩 필수.
  const encoded = encodeURIComponent(finalPrompt);
  const pollUrl =
    `https://image.pollinations.ai/prompt/${encoded}` +
    `?width=1024&height=1024&nologo=true&seed=${encodeURIComponent(seed)}&model=flux`;

  // 조립한 URL을 공통 스트리밍 프록시로 넘긴다. (flux 모델은 보통 5~15초)
  streamImageUrl(res, pollUrl);
}

// ------------------------------------------------------------
//  [핵심 2-B] fal.ai 이미지 프록시 (두 번째 provider · 키 필요)
//   Pollinations 와 달리 "URL = 이미지"가 아니라, 두 단계가 필요하다:
//     1) POST https://fal.run/fal-ai/flux/schnell 로 생성을 요청한다.
//        - 헤더 Authorization: Key <FAL_KEY>, Content-Type: application/json
//        - 바디(JSON): prompt / image_size / num_images / seed / safety
//     2) 돌아온 응답 JSON 에서 images[0].url(완성된 이미지 주소)을 꺼낸다.
//     3) 그 url 을 공통 streamImageUrl 로 받아 클라이언트로 스트리밍한다.
//   ▶ POST 요청은 내장 https.request 로 보내고, 바디를 write/end 한 뒤
//     응답 청크를 모아 JSON 으로 파싱한다.
// ------------------------------------------------------------
function proxyFal(res, userPrompt, styleId, seed) {
  // 키가 없으면 외부 호출을 시도하지 않고 친절한 한국어 에러로 끝낸다.
  if (!FAL_KEY) {
    return sendJson(res, 503, {
      success: false,
      message:
        'FAL_KEY 환경변수가 설정되지 않았습니다. ' +
        'fal.ai 키를 발급받은 뒤  FAL_KEY=발급받은키 node server.js  로 실행해 주세요. ' +
        '(키 없이도 Pollinations provider 는 그대로 사용할 수 있어요.)',
    });
  }

  const finalPrompt = buildFinalPrompt(userPrompt, styleId);

  // 1) 생성 요청 바디. seed 는 숫자로 보낸다(쿼리는 문자열이므로 변환).
  const requestBody = JSON.stringify({
    prompt: finalPrompt,
    image_size: 'square_hd',
    num_images: 1,
    seed: Number(seed) || 0,
    enable_safety_checker: true,
  });

  const options = {
    method: 'POST',
    hostname: 'fal.run',
    path: '/fal-ai/flux/schnell',
    headers: {
      // ▶ fal.ai 인증 방식: "Key <발급키>"
      Authorization: `Key ${FAL_KEY}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(requestBody),
    },
  };

  const apiReq = https.request(options, (apiRes) => {
    // 응답 청크를 모은다(이미지가 아니라 JSON 이므로 통째로 받아 파싱).
    let raw = '';
    apiRes.setEncoding('utf8');
    apiRes.on('data', (chunk) => { raw += chunk; });
    apiRes.on('end', () => {
      // 비정상 상태코드 처리 (401 인증실패, 422 잘못된 입력 등)
      if (apiRes.statusCode !== 200) {
        let detail = '';
        try { detail = (JSON.parse(raw).detail) || ''; } catch (_) { /* JSON 아니면 무시 */ }
        let message;
        if (apiRes.statusCode === 401) {
          // 키 자체가 틀린 경우
          message = 'fal.ai 인증에 실패했습니다. FAL_KEY 값이 올바른지 확인해 주세요.';
        } else if (apiRes.statusCode === 403) {
          // 키는 맞지만 계정이 잠긴 경우(대부분 잔액 소진) — 실제 사유를 그대로 전달
          message = 'fal.ai 계정을 사용할 수 없습니다(잔액 소진/계정 잠금일 수 있어요). '
                  + 'fal.ai/dashboard/billing 에서 잔액을 충전해 주세요.'
                  + (detail ? ` (fal.ai: ${detail})` : '');
        } else {
          message = `fal.ai 응답 오류 (status ${apiRes.statusCode})` + (detail ? `: ${detail}` : '');
        }
        return sendJson(res, 502, { success: false, message });
      }

      // 2) 정상 응답에서 images[0].url 추출
      try {
        const data = JSON.parse(raw);
        const imageUrl = data && data.images && data.images[0] && data.images[0].url;
        if (!imageUrl) {
          return sendJson(res, 502, {
            success: false,
            message: 'fal.ai 응답에서 이미지 URL을 찾지 못했습니다.',
          });
        }
        // 3) 추출한 url 을 공통 프록시로 스트리밍
        streamImageUrl(res, imageUrl);
      } catch (err) {
        sendJson(res, 502, { success: false, message: `fal.ai 응답 파싱 실패: ${err.message}` });
      }
    });
  });

  // 네트워크 단절 등 요청 자체 실패
  apiReq.on('error', (err) => {
    if (!res.headersSent) {
      sendJson(res, 502, { success: false, message: `fal.ai 요청 실패: ${err.message}` });
    }
  });

  // 타임아웃 (생성 + 응답까지 넉넉히 45초)
  apiReq.setTimeout(45000, () => {
    apiReq.destroy();
    if (!res.headersSent) {
      sendJson(res, 504, { success: false, message: 'fal.ai 이미지 생성 시간이 초과되었습니다.' });
    }
  });

  // ▶ POST 바디를 실어 보낸다.
  apiReq.write(requestBody);
  apiReq.end();
}

// ------------------------------------------------------------
//  [핵심 2-C] Hugging Face 이미지 생성 (세 번째 provider · 무료 토큰)
//   fal 과 또 다르다: HF 추론 API는 응답으로 "이미지 URL"이 아니라
//   "이미지 바이트(JPEG/PNG)"를 그대로 돌려준다. 그래서:
//     1) POST router.huggingface.co/.../<모델> 에 { inputs: 최종프롬프트 } 전송
//        - 헤더 Authorization: Bearer <HF_TOKEN>
//     2) 응답이 이미지면 → 그 응답 스트림을 곧장 클라이언트로 pipe (URL 단계 없음)
//        응답이 JSON이면 → 에러(모델 로딩중 503, 인증 401 등)이므로 메시지 처리
//   ▶ HF는 seed 파라미터를 항상 지원하진 않으므로 parameters.seed로 살짝 얹어준다.
// ------------------------------------------------------------
function proxyHuggingFace(res, userPrompt, styleId, seed) {
  // 토큰이 없으면 외부 호출 없이 친절한 한국어 에러로 끝낸다.
  if (!HF_TOKEN) {
    return sendJson(res, 503, {
      success: false,
      message:
        'HF_TOKEN 환경변수가 설정되지 않았습니다. ' +
        'huggingface.co/settings/tokens 에서 무료 토큰을 발급받은 뒤 ' +
        'HF_TOKEN=발급받은토큰 node server.js  로 실행해 주세요.',
    });
  }

  const finalPrompt = buildFinalPrompt(userPrompt, styleId);

  const requestBody = JSON.stringify({
    inputs: finalPrompt,
    parameters: { seed: Number(seed) || 0 },
  });

  const options = {
    method: 'POST',
    hostname: 'router.huggingface.co',
    path: `/hf-inference/models/${HF_MODEL}`,
    headers: {
      // ▶ HF 인증 방식: "Bearer <토큰>"
      Authorization: `Bearer ${HF_TOKEN}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(requestBody),
      Accept: 'image/png',
    },
  };

  const apiReq = https.request(options, (apiRes) => {
    const ctype = apiRes.headers['content-type'] || '';

    // 응답이 이미지면 → 그대로 스트리밍 프록시 (가장 흔한 정상 경로)
    if (apiRes.statusCode === 200 && ctype.startsWith('image/')) {
      res.writeHead(200, { 'Content-Type': ctype, 'Cache-Control': 'no-store' });
      apiRes.pipe(res);
      return;
    }

    // 그 외(에러/모델 로딩중)는 JSON 본문을 모아서 사유를 안내한다.
    let raw = '';
    apiRes.setEncoding('utf8');
    apiRes.on('data', (chunk) => { raw += chunk; });
    apiRes.on('end', () => {
      let detail = '';
      try { const j = JSON.parse(raw); detail = j.error || j.message || ''; }
      catch (_) { detail = raw.slice(0, 200); }

      let message;
      if (apiRes.statusCode === 401 || apiRes.statusCode === 403) {
        message = 'Hugging Face 인증에 실패했습니다. HF_TOKEN 값이 올바른지 확인해 주세요.';
      } else if (apiRes.statusCode === 503) {
        // 콜드 스타트: 모델을 처음 깨우는 중. 잠시 후 다시 시도하면 된다.
        message = '모델을 준비하는 중입니다(콜드 스타트). 20~30초 후 다시 생성을 눌러 주세요.'
                + (detail ? ` (HF: ${detail})` : '');
      } else if (apiRes.statusCode === 402) {
        message = 'Hugging Face 무료 추론 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.'
                + (detail ? ` (HF: ${detail})` : '');
      } else {
        message = `Hugging Face 응답 오류 (status ${apiRes.statusCode})` + (detail ? `: ${detail}` : '');
      }
      sendJson(res, 502, { success: false, message });
    });
  });

  apiReq.on('error', (err) => {
    if (!res.headersSent) {
      sendJson(res, 502, { success: false, message: `Hugging Face 요청 실패: ${err.message}` });
    }
  });

  // 콜드 스타트까지 고려해 넉넉히 90초.
  apiReq.setTimeout(90000, () => {
    apiReq.destroy();
    if (!res.headersSent) {
      sendJson(res, 504, { success: false, message: 'Hugging Face 이미지 생성 시간이 초과되었습니다.' });
    }
  });

  apiReq.write(requestBody);
  apiReq.end();
}

// ------------------------------------------------------------
//  provider 값에 따라 알맞은 프록시 함수로 분기한다.
//   - 'fal'          → proxyFal
//   - 'huggingface'  → proxyHuggingFace
//   - 그 외/미지정   → proxyPollinations (하위호환: 기존 동작 유지)
// ------------------------------------------------------------
function proxyImage(res, userPrompt, styleId, seed, provider) {
  if (provider === 'fal') {
    return proxyFal(res, userPrompt, styleId, seed);
  }
  if (provider === 'huggingface') {
    return proxyHuggingFace(res, userPrompt, styleId, seed);
  }
  return proxyPollinations(res, userPrompt, styleId, seed);
}

// ============================================================
//  요청 라우팅 (서버의 교통정리)
//   GET /              → index.html
//   GET /client.js     → client.js
//   GET /api/styles    → 스타일 프리셋 8종 JSON
//   GET /api/preview   → 최종 조합 프롬프트 미리보기 JSON (+ provider)
//   GET /api/image     → 프롬프트 조합 + 이미지 프록시 (provider 분기)
//   ※ provider 쿼리: 'pollinations'(기본) | 'fal' — 미지정 시 pollinations
// ============================================================
const server = http.createServer((req, res) => {
  // req.url 을 절대 URL 로 파싱해 경로(pathname)와 쿼리(searchParams)를 얻는다.
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = reqUrl.pathname;
  const q = reqUrl.searchParams;

  // 이 실습은 모두 GET 으로 충분하다. 다른 메서드는 막는다.
  if (req.method !== 'GET') {
    sendJson(res, 405, { success: false, message: 'GET 요청만 지원합니다.' });
    return;
  }

  try {
    // ----- 정적 파일 -----
    if (pathname === '/' || pathname === '/index.html') {
      return serveStatic(res, 'index.html');
    }
    if (pathname === '/client.js') {
      return serveStatic(res, 'client.js');
    }

    // ----- API: 스타일 프리셋 목록 -----
    if (pathname === '/api/styles') {
      // client.js 가 카드 그리드를 그릴 때 쓰는 데이터.
      return sendJson(res, 200, { success: true, data: STYLE_PRESETS });
    }

    // ----- API: 최종 프롬프트 미리보기 (교육용) -----
    if (pathname === '/api/preview') {
      const prompt = q.get('prompt') || '';
      const style = q.get('style') || '';
      const provider = normalizeProvider(q.get('provider'));
      if (!prompt.trim()) {
        return sendJson(res, 400, { success: false, message: '프롬프트가 비어 있습니다.' });
      }
      // 프롬프트 조합 로직은 provider 공통이다. 어떤 provider 인지도 함께 알려준다.
      const finalPrompt = buildFinalPrompt(prompt, style);
      return sendJson(res, 200, { success: true, data: { finalPrompt, provider } });
    }

    // ----- API: 이미지 생성(조합 + 프록시) -----
    if (pathname === '/api/image') {
      const prompt = q.get('prompt') || '';
      const style = q.get('style') || '';
      const provider = normalizeProvider(q.get('provider'));
      // seed 가 없으면 서버가 랜덤으로 만들어 준다(다시 생성 시 client가 새 seed를 넘김).
      const seed = q.get('seed') || String(Math.floor(Math.random() * 1_000_000));

      if (!prompt.trim()) {
        return sendJson(res, 400, { success: false, message: '프롬프트를 입력해 주세요.' });
      }
      // 여기서부터는 응답을 직접 스트리밍하므로 sendJson 으로 끝내지 않는다.
      // (fal + 키 미설정인 경우엔 proxyImage 내부에서 JSON 에러로 끝난다.)
      return proxyImage(res, prompt, style, seed, provider);
    }

    // ----- 그 외: 404 -----
    sendJson(res, 404, { success: false, message: '없는 경로입니다.' });
  } catch (err) {
    // 예기치 못한 서버 오류 — 절대 조용히 죽지 않도록 JSON 으로 응답.
    if (!res.headersSent) {
      sendJson(res, 500, { success: false, message: `서버 오류: ${err.message}` });
    }
  }
});

server.listen(PORT, () => {
  console.log(`✅ 이미지 생성 서버 실행 중 → http://localhost:${PORT}`);
  console.log('   브라우저에서 위 주소를 열어보세요. (종료: Ctrl+C)');
  console.log('');
  console.log('   provider 안내:');
  console.log('   · Pollinations  : 무료 · 키 불필요 (기본값, 바로 사용 가능)');
  if (FAL_KEY) {
    // 키 자체는 절대 출력하지 않는다. 설정 여부만 알린다.
    console.log('   · fal.ai FLUX   : ✅ FAL_KEY 감지됨 — 고품질 provider 사용 가능');
  } else {
    console.log('   · fal.ai FLUX   : ⚠️  FAL_KEY 미설정 — fal 선택 시 안내 에러가 표시됩니다.');
    console.log('       사용하려면 →  FAL_KEY=발급받은키 node server.js');
  }
  if (HF_TOKEN) {
    console.log('   · HuggingFace   : ✅ HF_TOKEN 감지됨 — 무료 provider 사용 가능');
  } else {
    console.log('   · HuggingFace   : ⚠️  HF_TOKEN 미설정 — huggingface 선택 시 안내 에러가 표시됩니다.');
    console.log('       사용하려면 →  HF_TOKEN=발급받은토큰 node server.js  (무료: huggingface.co/settings/tokens)');
  }
});
