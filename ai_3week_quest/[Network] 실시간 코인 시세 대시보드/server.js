// ============================================================
//  실시간 코인 시세 대시보드 — 서버 버전 (server.js)
//  하버스쿨 AI 교육 · 3주차 Network 실습
//
//  ▶ 이 서버가 하는 일 (왜 서버가 필요할까?)
//    브라우저(client.js)가 CoinGecko를 "직접" 부르지 않고
//    우리 서버를 한 번 거치게 한다. 이렇게 하면 좋은 점:
//      1) same-origin : 브라우저는 항상 우리 서버(/api/...)만 부르므로
//         CORS 걱정이 없다.
//      2) 캐시(보호막) : 30초마다 폴링하는 클라이언트가 여러 명 붙어도
//         서버가 짧은 메모리 캐시로 막아주어 CoinGecko가 받는 호출 수를
//         확 줄여준다. (무료 티어는 호출이 잦으면 429를 준다)
//      3) 응답 정규화 : CoinGecko의 복잡한 응답을 화면 카드에 딱 맞는
//         깔끔한 형태로 다듬어서 내려준다.
//
//  ▶ CoinGecko 는 API 키가 필요 없다(무료 public API). 그래서 키 설정 없이
//    그냥  node server.js  로 바로 실행된다.
//
//  ▶ 의존성 없음: Node 내장 모듈(http, https, fs, path, url)만 사용.
//    npm install 불필요. PORT 는 환경변수로 바꿀 수 있다(기본 3000).
//
//  ▶ 제공 엔드포인트 (프론트엔드와 합의된 계약):
//      GET /                → index.html
//      GET /client.js       → client.js
//      GET /api/coins       → 기본 관심 코인 id 목록
//      GET /api/prices      → 코인별 가격/24h등락/이미지 (markets 프록시 + 정규화)
//      GET /api/search      → 코인 검색 (search 프록시, 상위 10개)
//      GET /api/chart       → 상세 차트 (market_chart 프록시, 과거 시세 prices)
// ============================================================

const http = require('http');     // 우리 서버를 띄우는 모듈
const https = require('https');    // CoinGecko(https)에 요청을 보내는 모듈
const fs = require('fs');          // index.html / client.js 정적 파일 읽기
const path = require('path');      // 파일 경로 조립
const { URL } = require('url');    // 요청 URL의 쿼리스트링 파싱

const PORT = process.env.PORT || 3000;

// CoinGecko 무료 public API 의 기준 주소.
const COINGECKO_HOST = 'api.coingecko.com';

// 일부 환경에서 CoinGecko 가 User-Agent 없는 요청을 막는 경우가 있어
// 우리 서버를 식별할 수 있는 User-Agent 를 항상 붙여준다.
const USER_AGENT = 'haver-school-coin-dashboard/1.0 (educational)';

// ------------------------------------------------------------
//  기본 관심 코인 목록 (서버가 보유하는 데이터)
//   - client.js 가 처음 화면을 그릴 때 /api/coins 로 받아간다.
//   - 사용자가 검색으로 코인을 추가/삭제하는 건 클라이언트 쪽 상태이고,
//     서버는 "기본값"만 제공한다.
// ------------------------------------------------------------
const DEFAULT_COINS = ['bitcoin', 'ethereum', 'solana', 'ripple', 'dogecoin'];

// ------------------------------------------------------------
//  [핵심 1] 아주 작은 메모리 캐시 (CoinGecko 보호막)
//   - key   : 요청을 구분하는 문자열 (예: "prices:krw:bitcoin,ethereum")
//   - value : { expires: 만료시각(ms), payload: 정규화된 결과 객체 }
//   - 같은 key 요청이 TTL 안에 다시 오면 CoinGecko 를 부르지 않고
//     캐시된 결과를 그대로 돌려준다.
//   ▶ 30초 폴링 클라이언트가 여러 명이어도, 캐시 TTL(15초) 동안엔
//     CoinGecko 호출이 사실상 1회로 합쳐진다.
// ------------------------------------------------------------
const cache = new Map();
const PRICES_TTL = 15_000; // 가격: 15초 (시세는 자주 바뀌므로 짧게)
const SEARCH_TTL = 60_000; // 검색: 60초 (검색 결과는 잘 안 바뀌므로 길게)
const CHART_TTL  = 60_000; // 차트: 60초 (과거 시세는 시세보다 덜 민감 → 다수 클릭/재방문 보호)

// 캐시에서 값을 꺼낸다. 없거나 만료됐으면 null.
function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) {
    cache.delete(key); // 만료된 항목은 지워서 메모리를 깔끔하게 유지
    return null;
  }
  return hit.payload;
}

// 캐시에 값을 ttl(ms) 동안 저장한다.
function cacheSet(key, payload, ttl) {
  cache.set(key, { expires: Date.now() + ttl, payload });
}

// ------------------------------------------------------------
//  작은 도우미들
// ------------------------------------------------------------

// JSON 응답을 일관된 형태로 보낸다. (Content-Type 고정)
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
      sendJson(res, 404, { error: `파일을 찾을 수 없습니다: ${fileName}` });
      return;
    }
    const ext = path.extname(fileName).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// ------------------------------------------------------------
//  [핵심 2] CoinGecko 로 GET 요청을 보내고 JSON 으로 받아오는 공통 함수
//   - 내장 https.get 만 사용한다(의존성 없음).
//   - 콜백 스타일 대신 Promise 로 감싸서 async/await 로 쓰기 쉽게 만든다.
//   - resolve 값: { statusCode, json }  (json 은 파싱된 객체/배열)
//   - 429(레이트리밋), 네트워크 오류, 타임아웃을 모두 호출부에서
//     깔끔히 분기할 수 있도록 statusCode 를 그대로 넘긴다.
// ------------------------------------------------------------
function fetchCoinGecko(pathWithQuery) {
  return new Promise((resolve, reject) => {
    const options = {
      method: 'GET',
      hostname: COINGECKO_HOST,
      path: pathWithQuery,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
    };

    const apiReq = https.request(options, (apiRes) => {
      let raw = '';
      apiRes.setEncoding('utf8');
      apiRes.on('data', (chunk) => { raw += chunk; });
      apiRes.on('end', () => {
        // 429 등 비정상 코드여도 본문이 JSON 일 수 있으니 일단 파싱을 시도한다.
        let json = null;
        try { json = raw ? JSON.parse(raw) : null; } catch (_) { json = null; }
        resolve({ statusCode: apiRes.statusCode, json });
      });
    });

    // 네트워크 단절 등 요청 자체 실패
    apiReq.on('error', (err) => reject(err));

    // 타임아웃 (CoinGecko 가 느릴 때 무한 대기 방지: 12초)
    apiReq.setTimeout(12_000, () => {
      apiReq.destroy(new Error('CoinGecko 응답 시간 초과'));
    });

    apiReq.end();
  });
}

// ------------------------------------------------------------
//  스파크라인 도우미: 7일치 가격 배열을 미니 차트용으로 다듬는다.
//   - CoinGecko sparkline_in_7d.price 는 보통 ~168개(시간별)라 그대로 내리면
//     응답 JSON 이 커진다. 균등 샘플링으로 최대 maxPoints 개까지 줄여준다.
//   - 첫 포인트와 끝 포인트는 추세가 어긋나지 않도록 항상 보존한다.
//   - 데이터가 없거나 배열이 아니면 빈 배열을 돌려준다(안전 처리).
// ------------------------------------------------------------
function downsampleSparkline(prices, maxPoints = 50) {
  if (!Array.isArray(prices) || prices.length === 0) return [];
  // 이미 충분히 짧으면 그대로 사용.
  if (prices.length <= maxPoints) return prices;

  const last = prices.length - 1;
  const step = last / (maxPoints - 1); // 첫/끝을 정확히 포함하도록 간격 계산
  const sampled = [];
  for (let i = 0; i < maxPoints; i++) {
    // 균등 간격으로 인덱스를 골라낸다. 마지막은 항상 끝 포인트가 되도록 round 사용.
    sampled.push(prices[Math.round(i * step)]);
  }
  return sampled;
}

// ------------------------------------------------------------
//  차트 다운샘플 도우미: [timestamp, price] "쌍 배열"을 줄인다.
//   - 위 downsampleSparkline 은 가격 숫자 1차원 배열용이고,
//     이건 market_chart 의 prices( [[ts, price], ...] )처럼 2차원 쌍 배열용이다.
//   - 로직은 동일: 균등 간격으로 골라내되 첫/끝 쌍은 항상 보존(추세 보존).
//   - 데이터가 없거나 배열이 아니면 빈 배열을 돌려준다(안전 처리).
// ------------------------------------------------------------
function downsamplePairs(pairs, maxPoints = 150) {
  if (!Array.isArray(pairs) || pairs.length === 0) return [];
  if (pairs.length <= maxPoints) return pairs; // 이미 충분히 짧으면 그대로

  const last = pairs.length - 1;
  const step = last / (maxPoints - 1); // 첫/끝을 정확히 포함하도록 간격 계산
  const sampled = [];
  for (let i = 0; i < maxPoints; i++) {
    sampled.push(pairs[Math.round(i * step)]);
  }
  return sampled;
}

// ------------------------------------------------------------
//  쿼리 도우미: 단일 코인 id 를 안전하게 정리한다(경로에 들어가므로 sanitize).
//   - 소문자화 후 영문소문자/숫자/하이픈만 허용하고 나머지는 제거한다.
//   - 결과가 비면 빈 문자열을 돌려주고, 호출부가 400 으로 막는다.
// ------------------------------------------------------------
function parseId(idRaw) {
  return String(idRaw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, ''); // 경로 인젝션 방지용 화이트리스트 sanitize
}

// ------------------------------------------------------------
//  쿼리 도우미: days 값을 허용 목록(1/7/30/90/365)으로 안전하게 맞춘다.
//   - 허용값이면 그대로, 그 외 값이면 "가장 가까운 허용값"으로 보정한다.
//   - 숫자로 해석 불가하면 기본 7 로 처리한다.
// ------------------------------------------------------------
const ALLOWED_DAYS = [1, 7, 30, 90, 365];
function parseDays(daysRaw) {
  const n = Number(daysRaw);
  if (!Number.isFinite(n)) return 7; // 숫자가 아니면 기본 7
  if (ALLOWED_DAYS.includes(n)) return n; // 허용값이면 그대로
  // 그 외 값이면 가장 가까운 허용값으로 보정한다.
  return ALLOWED_DAYS.reduce((best, d) =>
    Math.abs(d - n) < Math.abs(best - n) ? d : best
  );
}

// ------------------------------------------------------------
//  쿼리 도우미: 콤마로 구분된 코인 id 문자열을 안전하게 정리한다.
//   - 공백 제거, 소문자화, 빈 항목 제거, 중복 제거
//   - 결과가 비면 기본 관심 코인 목록으로 대체한다.
//   - 너무 많이 요청해 CoinGecko 를 괴롭히지 않도록 50개로 제한.
// ------------------------------------------------------------
function parseIds(idsRaw) {
  const cleaned = String(idsRaw || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const unique = [...new Set(cleaned)];
  const limited = unique.slice(0, 50);
  return limited.length ? limited : [...DEFAULT_COINS];
}

// 통화 코드(vs)를 안전하게 정리한다. (소문자, 기본 krw)
function parseCurrency(vsRaw) {
  const v = String(vsRaw || '').trim().toLowerCase();
  return v || 'krw';
}

// ------------------------------------------------------------
//  [핵심 3-A] GET /api/prices
//   CoinGecko 의 coins/markets 엔드포인트를 프록시한다.
//   markets 는 "가격 + 24h등락률 + 이미지 + 고가/저가 + 시총"을
//   한 번에 주므로 카드 UI 에 딱 맞다(simple/price 보다 정보가 풍부).
//
//   응답 형태(프론트와 합의):
//     {
//       updatedAt, currency,
//       coins: [{ id, symbol, name, image, price,
//                 change24h, high24h, low24h, marketCap }, ...]
//     }
//   - 코인 순서는 "요청한 ids 순서"를 유지한다.
//   - 에러/429 시  { error, coins: [] }  + 적절한 상태코드.
// ------------------------------------------------------------
async function handlePrices(res, q) {
  const ids = parseIds(q.get('ids'));
  const currency = parseCurrency(q.get('vs'));

  // 캐시 키: 통화 + (정렬된) ids 조합. 순서가 달라도 같은 캐시를 쓰도록 정렬.
  const cacheKey = `prices:${currency}:${[...ids].sort().join(',')}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    // 캐시 적중! CoinGecko 를 부르지 않고 즉시 응답한다.
    return sendJson(res, 200, cached);
  }

  // CoinGecko markets 엔드포인트 호출 URL 조립.
  //   vs_currency : 통화 / ids : 콤마구분 코인 / price_change_percentage=24h 로 24h 등락률 포함
  //   sparkline=true : 코인베이스처럼 카드/행에 그릴 "최근 7일 미니 추세 그래프"용으로
  //                    응답 각 항목에 sparkline_in_7d.price(7일치 시간별 가격 배열)를 함께 받는다.
  const cgPath =
    `/api/v3/coins/markets?vs_currency=${encodeURIComponent(currency)}` +
    `&ids=${encodeURIComponent(ids.join(','))}` +
    `&order=market_cap_desc&per_page=250&page=1&price_change_percentage=24h&sparkline=true`;

  let result;
  try {
    result = await fetchCoinGecko(cgPath);
  } catch (err) {
    // 네트워크 단절 / 타임아웃
    return sendJson(res, 502, { error: `CoinGecko 요청 실패: ${err.message}`, coins: [] });
  }

  // 레이트리밋 — 무료 티어에서 호출이 잦을 때 발생한다.
  if (result.statusCode === 429) {
    return sendJson(res, 429, {
      error: 'CoinGecko 요청이 너무 잦습니다(429). 잠시 후 다시 시도해 주세요.',
      coins: [],
    });
  }

  // 그 외 비정상 응답
  if (result.statusCode !== 200 || !Array.isArray(result.json)) {
    return sendJson(res, 502, {
      error: `CoinGecko 응답 오류 (status ${result.statusCode})`,
      coins: [],
    });
  }

  // ▶ 정규화: CoinGecko 의 각 항목에서 필요한 필드만 뽑아 카드용 형태로 다듬는다.
  //   먼저 id 로 빠르게 찾을 수 있게 Map 을 만든 뒤,
  //   "요청한 ids 순서"대로 배열을 다시 구성한다.
  const byId = new Map();
  for (const c of result.json) {
    byId.set(c.id, {
      id: c.id,
      symbol: String(c.symbol || '').toUpperCase(), // BTC 처럼 대문자로
      name: c.name,
      image: c.image,
      price: c.current_price,
      change24h: c.price_change_percentage_24h, // 퍼센트 숫자 그대로 (예: 2.34, -1.05)
      high24h: c.high_24h,
      low24h: c.low_24h,
      marketCap: c.market_cap,
      // 최근 7일 미니 추세 그래프용 가격 배열. sparkline=true 로 받은
      // sparkline_in_7d.price 를 옵셔널하게 꺼내고(없으면 빈 배열),
      // 응답 크기를 줄이려 최대 50개로 균등 샘플링한다(첫/끝 보존).
      sparkline7d: downsampleSparkline(
        Array.isArray(c.sparkline_in_7d && c.sparkline_in_7d.price) ? c.sparkline_in_7d.price : []
      ),
    });
  }
  // 요청한 ids 순서를 유지하되, CoinGecko 가 못 찾은 id 는 건너뛴다.
  const coins = ids.map((id) => byId.get(id)).filter(Boolean);

  const payload = {
    updatedAt: new Date().toISOString(),
    currency,
    coins,
  };

  // 다음 15초 동안은 같은 요청을 캐시로 처리해 CoinGecko 를 보호한다.
  cacheSet(cacheKey, payload, PRICES_TTL);
  return sendJson(res, 200, payload);
}

// ------------------------------------------------------------
//  [핵심 3-B] GET /api/search?q=btc
//   CoinGecko 의 search 엔드포인트를 프록시한다.
//   사용자가 코인을 검색해 관심목록에 추가하는 기능에 쓴다.
//
//   응답 형태(프론트와 합의):
//     { coins: [{ id, symbol, name, image }, ...] }  (상위 10개)
//   - CoinGecko search 응답의 coins[].thumb 를 image 로 매핑한다.
// ------------------------------------------------------------
async function handleSearch(res, q) {
  const query = String(q.get('q') || '').trim();

  // 검색어가 비면 굳이 CoinGecko 를 부르지 않고 빈 배열을 돌려준다.
  if (!query) {
    return sendJson(res, 200, { coins: [] });
  }

  const cacheKey = `search:${query.toLowerCase()}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    return sendJson(res, 200, cached);
  }

  const cgPath = `/api/v3/search?query=${encodeURIComponent(query)}`;

  let result;
  try {
    result = await fetchCoinGecko(cgPath);
  } catch (err) {
    return sendJson(res, 502, { error: `CoinGecko 요청 실패: ${err.message}`, coins: [] });
  }

  if (result.statusCode === 429) {
    return sendJson(res, 429, {
      error: 'CoinGecko 요청이 너무 잦습니다(429). 잠시 후 다시 시도해 주세요.',
      coins: [],
    });
  }

  if (result.statusCode !== 200 || !result.json || !Array.isArray(result.json.coins)) {
    return sendJson(res, 502, {
      error: `CoinGecko 응답 오류 (status ${result.statusCode})`,
      coins: [],
    });
  }

  // ▶ 정규화: 상위 10개만 잘라 카드 추가용 최소 정보로 다듬는다.
  const coins = result.json.coins.slice(0, 10).map((c) => ({
    id: c.id,
    symbol: String(c.symbol || '').toUpperCase(),
    name: c.name,
    image: c.thumb, // search 응답에는 thumb(작은 썸네일)이 들어있다
  }));

  const payload = { coins };
  cacheSet(cacheKey, payload, SEARCH_TTL);
  return sendJson(res, 200, payload);
}

// ------------------------------------------------------------
//  [핵심 3-C] GET /api/chart?id=bitcoin&vs=krw&days=7
//   CoinGecko 의 coins/{id}/market_chart 엔드포인트를 프록시한다.
//   코인 행을 클릭해 상세 페이지로 들어가면 "과거 시세 차트"를 그릴 때 쓴다.
//
//   CoinGecko 응답 형태:
//     { prices: [[ts_ms, price], ...], market_caps: [...], total_volumes: [...] }
//   우리는 prices 만 사용한다.
//
//   응답 형태(프론트와 합의):
//     { id, currency, days, prices: [[ts_ms, price], ...] }
//   - prices 포인트가 많으면 최대 150개로 균등 샘플링한다(첫/끝 보존).
//   - id 가 비정상이면 400, 에러/429/네트워크 실패 시 { error, prices: [] }.
// ------------------------------------------------------------
async function handleChart(res, q) {
  const id = parseId(q.get('id'));
  const currency = parseCurrency(q.get('vs'));
  const days = parseDays(q.get('days'));

  // id 가 비정상(빈 문자열)이면 CoinGecko 를 부르지 않고 400 으로 막는다.
  if (!id) {
    return sendJson(res, 400, { error: '유효한 코인 id(영문소문자/숫자/하이픈)가 필요합니다.', prices: [] });
  }

  // 캐시 키: 통화 + id + days 조합. (요구 형식: chart:{vs}:{id}:{days})
  const cacheKey = `chart:${currency}:${id}:${days}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    // 캐시 적중! CoinGecko 를 부르지 않고 즉시 응답한다.
    return sendJson(res, 200, cached);
  }

  // CoinGecko market_chart 엔드포인트 호출 URL 조립.
  //   id 는 sanitize 했지만 한 번 더 인코딩해서 안전하게 경로에 넣는다.
  const cgPath =
    `/api/v3/coins/${encodeURIComponent(id)}/market_chart` +
    `?vs_currency=${encodeURIComponent(currency)}&days=${encodeURIComponent(days)}`;

  let result;
  try {
    result = await fetchCoinGecko(cgPath);
  } catch (err) {
    // 네트워크 단절 / 타임아웃
    return sendJson(res, 502, { error: `CoinGecko 요청 실패: ${err.message}`, prices: [] });
  }

  // 레이트리밋 — 무료 티어에서 호출이 잦을 때 발생한다.
  if (result.statusCode === 429) {
    return sendJson(res, 429, {
      error: 'CoinGecko 요청이 너무 잦습니다(429). 잠시 후 다시 시도해 주세요.',
      prices: [],
    });
  }

  // 그 외 비정상 응답(존재하지 않는 코인 id 면 404 등이 올 수 있다).
  if (result.statusCode !== 200 || !result.json || !Array.isArray(result.json.prices)) {
    return sendJson(res, 502, {
      error: `CoinGecko 응답 오류 (status ${result.statusCode})`,
      prices: [],
    });
  }

  // ▶ 정규화: prices( [[ts, price], ...] )만 꺼내 최대 150개로 줄여 내려준다.
  const payload = {
    id,
    currency,
    days,
    prices: downsamplePairs(result.json.prices, 150),
  };

  // 다음 60초 동안은 같은 요청을 캐시로 처리해 CoinGecko 를 보호한다.
  cacheSet(cacheKey, payload, CHART_TTL);
  return sendJson(res, 200, payload);
}

// ============================================================
//  요청 라우팅 (서버의 교통정리)
//   GET /              → index.html
//   GET /client.js     → client.js
//   GET /api/coins     → 기본 관심 코인 id 목록
//   GET /api/prices    → 코인 시세(markets 프록시 + 정규화)
//   GET /api/search    → 코인 검색(search 프록시, 상위 10개)
//   GET /api/chart     → 상세 차트(market_chart 프록시, 과거 시세)
//   ※ 이 실습은 모두 GET 으로 충분하다.
// ============================================================
const server = http.createServer(async (req, res) => {
  // req.url 을 절대 URL 로 파싱해 경로(pathname)와 쿼리(searchParams)를 얻는다.
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = reqUrl.pathname;
  const q = reqUrl.searchParams;

  // 다른 메서드는 막는다(이 실습은 전부 조회이므로 GET 만).
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'GET 요청만 지원합니다.' });
  }

  try {
    // ----- 정적 파일 -----
    if (pathname === '/' || pathname === '/index.html') {
      return serveStatic(res, 'index.html');
    }
    if (pathname === '/client.js') {
      return serveStatic(res, 'client.js');
    }

    // ----- API: 기본 관심 코인 목록 -----
    if (pathname === '/api/coins') {
      // client.js 가 첫 화면을 그릴 때 어떤 코인부터 보여줄지 알려준다.
      return sendJson(res, 200, { coins: [...DEFAULT_COINS] });
    }

    // ----- API: 코인 시세 -----
    if (pathname === '/api/prices') {
      return await handlePrices(res, q);
    }

    // ----- API: 코인 검색 -----
    if (pathname === '/api/search') {
      return await handleSearch(res, q);
    }

    // ----- API: 상세 차트(과거 시세) -----
    if (pathname === '/api/chart') {
      return await handleChart(res, q);
    }

    // ----- 그 외: 404 -----
    return sendJson(res, 404, { error: '없는 경로입니다.' });
  } catch (err) {
    // 예기치 못한 서버 오류 — 절대 조용히 죽지 않도록 JSON 으로 응답.
    if (!res.headersSent) {
      sendJson(res, 500, { error: `서버 오류: ${err.message}`, coins: [] });
    }
  }
});

server.listen(PORT, () => {
  console.log(`✅ 코인 시세 대시보드 서버 실행 중 → http://localhost:${PORT}`);
  console.log('   브라우저에서 위 주소를 열어보세요. (종료: Ctrl+C)');
  console.log('');
  console.log('   엔드포인트:');
  console.log('   · GET /api/coins   기본 관심 코인 목록');
  console.log('   · GET /api/prices?ids=bitcoin,ethereum&vs=krw   코인 시세');
  console.log('   · GET /api/search?q=btc   코인 검색');
  console.log('   · GET /api/chart?id=bitcoin&vs=krw&days=7   상세 차트(과거 시세)');
  console.log('');
  console.log('   CoinGecko 무료 public API 사용 (API 키 불필요).');
  console.log('   429 보호용 메모리 캐시: 시세 15초 · 검색 60초 · 차트 60초');
});
