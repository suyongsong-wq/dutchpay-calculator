// ============================================================
//  실시간 코인 시세 대시보드 — 서버 버전 (client.js)
//  ▶ React 18 + Babel standalone (JSX 는 브라우저에서 변환된다).
//     index.html 에서 <script type="text/babel" src="/client.js"> 로 불러오므로
//     이 파일 안에서 JSX 를 그대로 써도 동작한다.
//  ▶ 디자인: 코인베이스(coinbase.com/explore) 룩 — 밝은 화이트 테마 + 테이블(리스트) 레이아웃.
//     각 코인 = 한 줄(row), 행마다 미니 스파크라인(SVG) 차트를 직접 그린다(라이브러리 없음).
//  ▶ 이 파일은 "화면(컴포넌트)"만 담당한다. 무거운 일은 모두 서버가 한다:
//     - 시세 조회 : 서버 GET /api/prices?ids=...&vs=krw   (각 코인에 sparkline7d 포함)
//     - 코인 검색 : 서버 GET /api/search?q=...
//     - 기본 목록 : 서버 GET /api/coins
//  ▶ 모든 요청이 same-origin(우리 서버)이라 CORS/키 노출 문제가 없다.
// ============================================================

const { useState, useEffect, useRef, useCallback, useMemo } = React;

// 우리 서버 API 베이스 경로. localhost 하드코딩 금지 → 상대 경로 사용(same-origin).
const API_BASE_URL = '/api';

// 관심목록을 localStorage 에 저장할 때 쓰는 키
const STORAGE_KEY = 'crypto-dashboard:watchlist';
const CURRENCY_KEY = 'crypto-dashboard:currency';

// 자동 갱신 주기 (30초)
const REFRESH_MS = 30_000;

// 코인베이스 색상(스파크라인 SVG stroke 등 JS 에서 직접 쓸 때)
const COLOR = {
  up: '#00C087',
  down: '#D8442F',
  flat: '#9AA0AB',
};

// 상세 차트 기간 탭 정의 (라벨 / days 값). 서버 허용값: 1,7,30,90,365
const PERIODS = [
  { id: 1,   label: '1D' },
  { id: 7,   label: '7D' },
  { id: 30,  label: '1개월' },
  { id: 90,  label: '3개월' },
  { id: 365, label: '1년' },
];

// ============================================================
//  🔀 해시 라우팅 — 라이브러리 없이 location.hash 로 화면 전환.
//   - 목록:      #/            (또는 빈 해시)
//   - 상세:      #/coin/bitcoin
//   새로고침·뒤로가기와 자연스럽게 맞물린다(브라우저 history 사용).
// ============================================================

// 현재 해시를 파싱해 라우트 객체로 변환한다.
function parseHash() {
  const raw = (window.location.hash || '').replace(/^#/, ''); // "#/coin/btc" → "/coin/btc"
  const parts = raw.split('/').filter(Boolean);               // ["coin","btc"]
  if (parts[0] === 'coin' && parts[1]) {
    return { name: 'detail', coinId: decodeURIComponent(parts[1]) };
  }
  return { name: 'list' };
}

// hashchange 를 구독해 현재 라우트를 돌려주는 훅
function useHashRoute() {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const onChange = () => setRoute(parseHash());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

// 프로그래매틱 네비게이션 헬퍼
function navigateToCoin(id) { window.location.hash = `#/coin/${encodeURIComponent(id)}`; }
function navigateToList() {
  // 상세→목록. history 가 있으면 뒤로, 없으면 해시 초기화.
  if (window.history.length > 1) window.history.back();
  else window.location.hash = '#/';
}

// ============================================================
//  🛠 유틸 함수 — 숫자/통화/시간 포맷
// ============================================================

// 통화 포맷. 큰 가격(비트코인)은 소수점 없이, 작은 가격(도지 등)은 소수점까지.
// Intl.NumberFormat 으로 통화기호 + 천단위 콤마를 자동 처리한다.
function formatCurrency(value, currency) {
  if (value == null || Number.isNaN(value)) return '-';
  const code = currency === 'usd' ? 'USD' : 'KRW';
  // 1 미만(예: 일부 알트코인)은 자릿수를 더 보여줘야 0 으로 깨지지 않는다.
  let maxFrac = 0;
  if (value < 1) maxFrac = 6;
  else if (value < 100) maxFrac = 2;
  else maxFrac = 0;
  try {
    return new Intl.NumberFormat(code === 'KRW' ? 'ko-KR' : 'en-US', {
      style: 'currency',
      currency: code,
      maximumFractionDigits: maxFrac,
      minimumFractionDigits: 0,
    }).format(value);
  } catch (_) {
    return String(value);
  }
}

// 시가총액처럼 큰 수는 조/억(또는 T/B) 단위로 축약해 보여준다.
function formatCompact(value, currency) {
  if (value == null || Number.isNaN(value)) return '-';
  const symbol = currency === 'usd' ? '$' : '₩';
  const abs = Math.abs(value);
  if (currency === 'usd') {
    if (abs >= 1e12) return `${symbol}${(value / 1e12).toFixed(2)}T`;
    if (abs >= 1e9)  return `${symbol}${(value / 1e9).toFixed(2)}B`;
    if (abs >= 1e6)  return `${symbol}${(value / 1e6).toFixed(2)}M`;
  } else {
    if (abs >= 1e12) return `${symbol}${(value / 1e12).toFixed(1)}조`;
    if (abs >= 1e8)  return `${symbol}${(value / 1e8).toFixed(1)}억`;
    if (abs >= 1e4)  return `${symbol}${(value / 1e4).toFixed(1)}만`;
  }
  return `${symbol}${new Intl.NumberFormat('ko-KR').format(Math.round(value))}`;
}

// 등락률 텍스트: +2.34% / -1.20% 형태.
function formatPercent(pct) {
  if (pct == null || Number.isNaN(pct)) return '-';
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

// "마지막 갱신: HH:MM:SS" 용 시간 포맷
function formatTime(date) {
  if (!date) return '-';
  return new Intl.DateTimeFormat('ko-KR', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(date);
}

// 차트 툴팁용 시각 포맷. 기간이 짧으면(1일) 시:분, 길면 날짜를 보여준다.
function formatChartTime(ts, days) {
  if (ts == null) return '';
  const d = new Date(ts);
  if (days <= 1) {
    return new Intl.DateTimeFormat('ko-KR', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(d);
  }
  if (days <= 90) {
    return new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' }).format(d);
  }
  return new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' }).format(d);
}

// 등락 방향: 'up' | 'down' | 'flat'
function trendOf(pct) {
  if (pct == null || Number.isNaN(pct)) return 'flat';
  if (pct > 0) return 'up';
  if (pct < 0) return 'down';
  return 'flat';
}

// ============================================================
//  🎨 Design System — 재사용 가능한 UI 프리미티브 (비즈니스 로직 없음)
// ============================================================

// 작은 동그란 스피너 (코인베이스 블루)
function Spinner({ className = 'w-4 h-4' }) {
  return (
    <span
      className={`inline-block rounded-full border-2 border-cbborder border-t-cbblue animate-spin ${className}`}
      role="status"
      aria-label="로딩 중"
    />
  );
}

// 버튼 — variant(primary/secondary/ghost) + size. 코인베이스 톤.
function Button({ variant = 'primary', size = 'md', className = '', children, ...props }) {
  const base =
    'inline-flex items-center justify-center gap-2 font-semibold rounded-full transition-all ' +
    'active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-cbblue/30 focus:ring-offset-1 ' +
    'disabled:opacity-40 disabled:cursor-not-allowed select-none';
  const variants = {
    primary: 'text-white bg-cbblue hover:bg-cbblueHover shadow-sm',
    secondary: 'text-cbink bg-white border border-cbborder hover:bg-cbhover',
    ghost: 'text-cbgray hover:text-cbink hover:bg-cbhover',
  };
  const sizes = { sm: 'px-3.5 py-1.5 text-sm', md: 'px-4 py-2 text-sm', lg: 'px-6 py-2.5 text-base' };
  return (
    <button className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...props}>
      {children}
    </button>
  );
}

// 등락률 텍스트 — 상승=초록 / 하락=빨강 / 보합=회색. ▲▼ 화살표 포함.
function ChangePill({ pct, className = '' }) {
  const trend = trendOf(pct);
  const color = trend === 'up' ? 'text-cbup' : trend === 'down' ? 'text-cbdown' : 'text-cbgray';
  const arrow = trend === 'up' ? '▲' : trend === 'down' ? '▼' : '';
  return (
    <span className={`inline-flex items-center gap-1 font-semibold tabular-nums ${color} ${className}`}>
      {arrow && <span className="text-[0.7em]" aria-hidden="true">{arrow}</span>}
      <span>{formatPercent(pct)}</span>
    </span>
  );
}

// ============================================================
//  📈 미니 스파크라인 — sparkline7d 배열로 작은 SVG 라인 차트를 직접 그린다.
//   - 폭 ~110 / 높이 ~36. 라이브러리 없이 <polyline> 만 사용.
//   - 추세 색: change24h 부호 우선, 없으면 첫 값 vs 끝 값으로 판단.
//   - 데이터 없으면(빈 배열 등) 옅은 회색 점선으로 표시.
// ============================================================
function Sparkline({ data, change24h, width = 110, height = 36 }) {
  const pad = 3; // 위아래 잘림 방지 여백

  // 방어: 배열이 아니거나 점이 2개 미만이면 그릴 수 없다 → "—" 점선
  const points = Array.isArray(data) ? data.filter((n) => typeof n === 'number' && !Number.isNaN(n)) : [];
  if (points.length < 2) {
    return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="추세 데이터 없음">
        <line
          x1={pad} y1={height / 2} x2={width - pad} y2={height / 2}
          stroke="#D7D9DE" strokeWidth="1.5" strokeDasharray="3 3" strokeLinecap="round"
        />
      </svg>
    );
  }

  // 추세 색 결정: change24h 가 유효하면 그 부호, 아니면 끝-첫 비교
  let trend;
  if (change24h != null && !Number.isNaN(change24h)) {
    trend = change24h > 0 ? 'up' : change24h < 0 ? 'down' : 'flat';
  } else {
    const diff = points[points.length - 1] - points[0];
    trend = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
  }
  const stroke = trend === 'up' ? COLOR.up : trend === 'down' ? COLOR.down : COLOR.flat;

  // 좌표 매핑: x 균등 분할, y 는 min~max 를 [pad, height-pad] 로 정규화
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1; // 전부 같은 값이면 0 나눗셈 방지
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const coords = points.map((v, i) => {
    const x = pad + (i / (points.length - 1)) * innerW;
    const y = pad + innerH - ((v - min) / span) * innerH; // 위가 큰 값
    return [x, y];
  });
  const polyPoints = coords.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');

  // 면적 채움(아주 옅게)을 위한 path
  const last = coords[coords.length - 1];
  const first = coords[0];
  const areaPath =
    `M ${first[0].toFixed(2)} ${first[1].toFixed(2)} ` +
    coords.slice(1).map(([x, y]) => `L ${x.toFixed(2)} ${y.toFixed(2)}`).join(' ') +
    ` L ${last[0].toFixed(2)} ${height} L ${first[0].toFixed(2)} ${height} Z`;
  const gradId = `spark-grad-${trend}`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="최근 7일 추세">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.16" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradId})`} />
      <polyline
        points={polyPoints}
        fill="none"
        stroke={stroke}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ============================================================
//  🪙 CoinRow — 코인 하나 = 테이블의 한 줄(row).
//   컬럼: 순번 | 이름(아이콘+이름+심볼) | 가격 | 24시간 | 시가총액 | 최근 7일 | 삭제
//   - hover 시 옅은 회색 배경, 행 사이 옅은 구분선.
//   - 가격이 갱신되면(이전 값과 다르면) flash 애니메이션(코인베이스 톤)으로 '실시간' 느낌.
//   - 모바일에서는 시총/스파크라인을 숨기고 핵심만 보인다.
// ============================================================
function CoinRow({ rank, coin, currency, onRemove, onOpen }) {
  // 이전 가격을 기억해 두고, 바뀌면 flash 클래스를 잠깐 붙였다 뗀다.
  const prevPrice = useRef(coin.price);
  const [flash, setFlash] = useState(''); // '' | 'flash-up' | 'flash-down'

  useEffect(() => {
    if (prevPrice.current != null && coin.price !== prevPrice.current) {
      const dir = coin.price > prevPrice.current ? 'flash-up' : 'flash-down';
      setFlash(dir);
      const t = setTimeout(() => setFlash(''), 900); // 애니메이션 길이와 맞춤
      prevPrice.current = coin.price;
      return () => clearTimeout(t);
    }
    prevPrice.current = coin.price;
  }, [coin.price]);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${coin.name} 상세 보기`}
      onClick={() => onOpen(coin.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(coin.id); }
      }}
      className={`group row-clickable grid items-center gap-3 px-3 sm:px-4 py-3 border-b border-cbline
        hover:bg-cbhover transition-colors focus:outline-none focus:bg-cbhover focus:ring-2 focus:ring-inset focus:ring-cbblue/30 ${flash}
        grid-cols-[24px_minmax(0,1fr)_auto_auto_32px]
        md:grid-cols-[28px_minmax(0,1.6fr)_minmax(110px,1fr)_minmax(96px,0.8fr)_minmax(120px,1fr)_120px_36px]`}
    >
      {/* 순번 */}
      <div className="text-sm text-cbgray tabular-nums text-center">{rank}</div>

      {/* 이름: 아이콘 + 이름(굵게) + 심볼(회색) */}
      <div className="flex items-center gap-3 min-w-0">
        {coin.image ? (
          <img
            src={coin.image} alt=""
            className="w-8 h-8 rounded-full bg-cbline shrink-0"
            onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
          />
        ) : (
          <div className="w-8 h-8 rounded-full bg-cbline grid place-items-center text-[10px] text-cbgray shrink-0">
            {coin.symbol?.slice(0, 3) || '?'}
          </div>
        )}
        <div className="min-w-0">
          <div className="font-semibold text-[15px] text-cbink truncate leading-tight">{coin.name}</div>
          <div className="text-xs text-cbgray uppercase tracking-wide">{coin.symbol}</div>
        </div>
      </div>

      {/* 가격 (우측정렬, 굵게) */}
      <div className="text-right font-semibold text-[15px] text-cbink tabular-nums">
        {formatCurrency(coin.price, currency)}
      </div>

      {/* 24시간 등락률 */}
      <div className="text-right">
        <ChangePill pct={coin.change24h} className="text-sm justify-end" />
      </div>

      {/* 시가총액 — md 이상에서만 표시 */}
      <div className="hidden md:block text-right text-sm text-cbink tabular-nums">
        {formatCompact(coin.marketCap, currency)}
      </div>

      {/* 최근 7일 스파크라인 — md 이상에서만 표시 */}
      <div className="hidden md:flex justify-end">
        <Sparkline data={coin.sparkline7d} change24h={coin.change24h} />
      </div>

      {/* 삭제 버튼 (행 끝) */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove(coin.id); }}
          aria-label={`${coin.name} 관심목록에서 삭제`}
          className="w-8 h-8 grid place-items-center rounded-full text-cbgray
            hover:text-cbdown hover:bg-cbdown/10 opacity-0 group-hover:opacity-100 focus:opacity-100
            transition-opacity focus:outline-none focus:ring-2 focus:ring-cbdown/30"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

// 로딩 중 보여줄 스켈레톤 행
function SkeletonRow() {
  return (
    <div className="grid items-center gap-3 px-3 sm:px-4 py-3 border-b border-cbline
      grid-cols-[24px_minmax(0,1fr)_auto_auto_32px]
      md:grid-cols-[28px_minmax(0,1.6fr)_minmax(110px,1fr)_minmax(96px,0.8fr)_minmax(120px,1fr)_120px_36px]">
      <div className="h-3 w-4 rounded skeleton mx-auto" />
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full skeleton shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-3.5 w-28 rounded skeleton" />
          <div className="h-2.5 w-12 rounded skeleton" />
        </div>
      </div>
      <div className="h-4 w-20 rounded skeleton justify-self-end" />
      <div className="h-4 w-14 rounded skeleton justify-self-end" />
      <div className="hidden md:block h-4 w-16 rounded skeleton justify-self-end" />
      <div className="hidden md:block h-7 w-[110px] rounded skeleton justify-self-end" />
      <div className="h-4 w-4 rounded skeleton justify-self-end" />
    </div>
  );
}

// ============================================================
//  🔍 코인 검색 박스 — /api/search 로 검색해서 관심목록에 추가
//   입력을 디바운스(300ms)해서 타이핑마다 서버를 때리지 않는다.
// ============================================================
function SearchBox({ onAdd, watchlist }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  // 디바운스 검색
  useEffect(() => {
    const q = query.trim();
    if (!q) { setResults([]); setLoading(false); return; }
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/search?q=${encodeURIComponent(q)}`);
        const json = await res.json();
        setResults(Array.isArray(json.coins) ? json.coins : []);
      } catch (_) {
        setResults([]); // 검색 실패는 조용히 빈 목록 처리
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [query]);

  // 바깥 클릭 시 드롭다운 닫기
  useEffect(() => {
    function onDocClick(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  function handlePick(coin) {
    onAdd(coin.id);
    setQuery('');
    setResults([]);
    setOpen(false);
  }

  return (
    <div className="relative w-full sm:max-w-md" ref={boxRef}>
      <div className="relative">
        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-cbgray text-sm" aria-hidden="true">🔍</span>
        <input
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="코인 검색 후 추가 (예: btc, 솔라나)"
          aria-label="코인 검색"
          className="w-full rounded-full bg-white border border-cbborder pl-10 pr-10 py-2.5 text-sm text-cbink
            placeholder:text-cbgray focus:outline-none focus:ring-2 focus:ring-cbblue/30 focus:border-cbblue transition"
        />
        {loading && <span className="absolute right-3.5 top-1/2 -translate-y-1/2"><Spinner /></span>}
      </div>

      {/* 검색 결과 드롭다운 */}
      {open && query.trim() && (
        <div className="absolute z-20 mt-2 w-full max-h-72 overflow-auto rounded-2xl border border-cbborder
          bg-white shadow-xl shadow-black/[0.08] p-1.5">
          {loading && results.length === 0 ? (
            <div className="px-3 py-3 text-sm text-cbgray">검색 중…</div>
          ) : results.length === 0 ? (
            <div className="px-3 py-3 text-sm text-cbgray">검색 결과가 없어요.</div>
          ) : (
            results.map((c) => {
              const already = watchlist.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  disabled={already}
                  onClick={() => handlePick(c)}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left
                    hover:bg-cbhover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {c.image
                    ? <img src={c.image} alt="" className="w-6 h-6 rounded-full bg-cbline" />
                    : <span className="w-6 h-6 rounded-full bg-cbline" />}
                  <span className="flex-1 min-w-0">
                    <span className="text-sm text-cbink truncate">{c.name}</span>
                    <span className="ml-2 text-xs text-cbgray uppercase">{c.symbol}</span>
                  </span>
                  <span className={`text-xs font-semibold ${already ? 'text-cbgray' : 'text-cbblue'}`}>
                    {already ? '추가됨' : '+ 추가'}
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// 통화(KRW/USD) 토글 세그먼트 — 액티브는 코인베이스 블루
function CurrencyToggle({ currency, onChange }) {
  const options = [
    { id: 'krw', label: '₩ KRW' },
    { id: 'usd', label: '$ USD' },
  ];
  return (
    <div className="inline-flex rounded-full border border-cbborder bg-white p-1" role="group" aria-label="통화 선택">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          aria-pressed={currency === o.id}
          className={`px-3.5 py-1.5 text-xs font-semibold rounded-full transition-all ${
            currency === o.id
              ? 'bg-cbblue text-white shadow-sm'
              : 'text-cbgray hover:text-cbink'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ============================================================
//  📡 시세 데이터 훅 — /api/prices 를 호출하고 30초마다 자동 갱신
//   watchlist(코인 id 배열) 또는 통화가 바뀌면 즉시 다시 불러온다.
// ============================================================
function usePrices(watchlist, currency) {
  const [coins, setCoins] = useState([]);
  const [updatedAt, setUpdatedAt] = useState(null); // 마지막 갱신 시각(Date)
  const [loading, setLoading] = useState(false);     // 갱신 중 인디케이터용
  const [error, setError] = useState(null);

  // 최신 watchlist/currency 를 인터벌 콜백에서 참조하기 위한 ref
  const idsRef = useRef(watchlist);
  const curRef = useRef(currency);
  idsRef.current = watchlist;
  curRef.current = currency;

  // 실제 fetch 로직. 인터벌과 수동 새로고침이 공유한다.
  const fetchPrices = useCallback(async () => {
    const ids = idsRef.current;
    const vs = curRef.current;
    if (!ids || ids.length === 0) {
      setCoins([]);
      setError(null);
      return;
    }
    setLoading(true);
    try {
      const url = `${API_BASE_URL}/prices?ids=${encodeURIComponent(ids.join(','))}&vs=${encodeURIComponent(vs)}`;
      const res = await fetch(url);
      const json = await res.json();
      // 서버가 { error, coins: [] } 를 줄 수 있다 → 에러 메시지 처리
      if (json.error) {
        setError(json.error);
        if (Array.isArray(json.coins)) setCoins(json.coins);
      } else {
        setError(null);
        setCoins(Array.isArray(json.coins) ? json.coins : []);
      }
      setUpdatedAt(json.updatedAt ? new Date(json.updatedAt) : new Date());
    } catch (err) {
      setError('시세를 불러오지 못했어요. 서버 상태를 확인해 주세요.');
    } finally {
      setLoading(false);
    }
  }, []);

  // watchlist / currency 가 바뀌면 즉시 재호출
  useEffect(() => { fetchPrices(); }, [watchlist, currency, fetchPrices]);

  // 30초마다 자동 갱신 (cleanup 으로 인터벌 정리)
  useEffect(() => {
    const id = setInterval(fetchPrices, REFRESH_MS);
    return () => clearInterval(id);
  }, [fetchPrices]);

  return { coins, updatedAt, loading, error, refresh: fetchPrices };
}

// ============================================================
//  📈 시세 차트 데이터 훅 — /api/chart 를 호출.
//   coinId / currency(vs) / days 가 바뀌면 다시 불러온다.
//   서버가 { error, prices: [] } 를 줄 수 있으니 방어 처리.
//   prices = [[timestamp_ms, price], ...]
// ============================================================
function useChart(coinId, currency, days) {
  const [prices, setPrices] = useState([]); // [[ts, price], ...]
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!coinId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const url = `${API_BASE_URL}/chart?id=${encodeURIComponent(coinId)}`
          + `&vs=${encodeURIComponent(currency)}&days=${encodeURIComponent(days)}`;
        const res = await fetch(url);
        const json = await res.json();
        if (cancelled) return;
        // 방어: prices 가 배열이 아니거나 비정상 항목이 섞여 있을 수 있다.
        const raw = Array.isArray(json.prices) ? json.prices : [];
        const clean = raw.filter(
          (p) => Array.isArray(p) && p.length >= 2
            && typeof p[0] === 'number' && typeof p[1] === 'number' && !Number.isNaN(p[1])
        );
        setPrices(clean);
        if (json.error) setError(json.error);
        else if (clean.length < 2) setError('차트 데이터가 충분하지 않아요.');
      } catch (_) {
        if (!cancelled) { setPrices([]); setError('차트를 불러오지 못했어요.'); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [coinId, currency, days]);

  return { prices, loading, error };
}

// ============================================================
//  📊 DetailChart — 큰 SVG 라인/에어리어 차트 (라이브러리 없음).
//   - prices: [[ts, price], ...]. 기간 성과(끝-첫)가 상승이면 초록선/하락이면 빨강선.
//   - 선 아래 옅은 그라데이션 면(area) 채우기.
//   - 마우스 호버 시 crosshair + 툴팁(가격·날짜)을 보여준다.
//   viewBox 좌표계를 쓰되 컨테이너 폭에 맞춰 늘어나도록(width 100%) 한다.
// ============================================================
function DetailChart({ prices, currency, days }) {
  const VBW = 760;   // viewBox 가로(논리 단위) — 실제 표시 폭은 CSS 가 100% 로 늘림
  const VBH = 280;   // 높이 ~280px
  const padX = 8;
  const padY = 16;
  const wrapRef = useRef(null);
  const [hover, setHover] = useState(null); // { idx, x, y } | null

  // 좌표 계산은 prices 가 바뀔 때만.
  const geom = useMemo(() => {
    const pts = prices.map((p) => p[1]);
    const n = pts.length;
    if (n < 2) return null;
    const min = Math.min(...pts);
    const max = Math.max(...pts);
    const span = max - min || 1;
    const innerW = VBW - padX * 2;
    const innerH = VBH - padY * 2;
    const coords = pts.map((v, i) => {
      const x = padX + (i / (n - 1)) * innerW;
      const y = padY + innerH - ((v - min) / span) * innerH;
      return [x, y];
    });
    const up = pts[n - 1] - pts[0]; // 기간 성과
    const trend = up > 0 ? 'up' : up < 0 ? 'down' : 'flat';
    return { coords, min, max, trend };
  }, [prices]);

  if (!geom) {
    return (
      <div className="grid place-items-center text-sm text-cbgray" style={{ height: VBH }}>
        표시할 차트 데이터가 없어요.
      </div>
    );
  }

  const { coords, trend } = geom;
  const stroke = trend === 'up' ? COLOR.up : trend === 'down' ? COLOR.down : COLOR.flat;
  const linePts = coords.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const first = coords[0];
  const last = coords[coords.length - 1];
  const areaPath =
    `M ${first[0].toFixed(2)} ${first[1].toFixed(2)} ` +
    coords.slice(1).map(([x, y]) => `L ${x.toFixed(2)} ${y.toFixed(2)}`).join(' ') +
    ` L ${last[0].toFixed(2)} ${VBH} L ${first[0].toFixed(2)} ${VBH} Z`;
  const gradId = `detail-grad-${trend}`;

  // 마우스 X → 가장 가까운 데이터 포인트 인덱스(논리 좌표로 환산).
  function handleMove(e) {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const ratio = (e.clientX - rect.left) / rect.width; // 0~1
    const logicalX = ratio * VBW;
    // 균등 분할이므로 인덱스 = (logicalX-padX)/innerW * (n-1)
    const innerW = VBW - padX * 2;
    let idx = Math.round(((logicalX - padX) / innerW) * (coords.length - 1));
    idx = Math.max(0, Math.min(coords.length - 1, idx));
    setHover({ idx, x: coords[idx][0], y: coords[idx][1] });
  }

  const hovered = hover ? prices[hover.idx] : null;

  return (
    <div className="relative w-full select-none" ref={wrapRef}>
      <svg
        viewBox={`0 0 ${VBW} ${VBH}`}
        width="100%"
        height={VBH}
        preserveAspectRatio="none"
        className="block cursor-crosshair"
        role="img"
        aria-label={`${days}일 가격 차트`}
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.18" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* 면적 채움 */}
        <path d={areaPath} fill={`url(#${gradId})`} />

        {/* 가격 라인 */}
        <polyline
          points={linePts}
          fill="none"
          stroke={stroke}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />

        {/* 호버 crosshair + 포인트 */}
        {hover && (
          <g>
            <line
              x1={hover.x} y1={padY - 8} x2={hover.x} y2={VBH}
              stroke="#0A0B0D" strokeOpacity="0.18" strokeWidth="1"
              strokeDasharray="3 3" vectorEffect="non-scaling-stroke"
            />
            <circle cx={hover.x} cy={hover.y} r="4.5" fill={stroke} stroke="#fff" strokeWidth="2" />
          </g>
        )}
      </svg>

      {/* 툴팁 — SVG 위에 절대 위치(논리 X 를 % 로 환산) */}
      {hover && hovered && (
        <div
          className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full
            rounded-lg bg-cbink text-white px-3 py-2 shadow-lg whitespace-nowrap"
          style={{ left: `${(hover.x / VBW) * 100}%` }}
        >
          <div className="text-[13px] font-semibold tabular-nums">
            {formatCurrency(hovered[1], currency)}
          </div>
          <div className="text-[11px] text-white/70 tabular-nums">
            {formatChartTime(hovered[0], days)}
          </div>
        </div>
      )}
    </div>
  );
}

// 상세 차트 영역 로딩 스켈레톤
function ChartSkeleton() {
  return (
    <div className="w-full rounded-xl skeleton" style={{ height: 280 }} aria-label="차트 로딩 중" />
  );
}

// 기간 선택 탭 — 액티브는 코인베이스 블루
function PeriodTabs({ value, onChange }) {
  return (
    <div className="inline-flex rounded-full border border-cbborder bg-white p-1" role="group" aria-label="기간 선택">
      {PERIODS.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onChange(p.id)}
          aria-pressed={value === p.id}
          className={`px-3 sm:px-3.5 py-1.5 text-xs font-semibold rounded-full transition-all ${
            value === p.id ? 'bg-cbblue text-white shadow-sm' : 'text-cbgray hover:text-cbink'
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

// 통계 그리드의 한 칸
function StatCell({ label, value }) {
  return (
    <div className="px-4 py-3.5">
      <div className="text-xs text-cbgray">{label}</div>
      <div className="mt-1 text-[15px] font-semibold text-cbink tabular-nums">{value}</div>
    </div>
  );
}

// ============================================================
//  📄 CoinDetail — 코인 상세 페이지(코인베이스 코인 상세 룩).
//   상단(아이콘+이름+심볼+큰가격+24h) → 기간탭 → 큰 차트 → 통계 그리드.
//   coin: 목록에서 받은 코인 데이터(없을 수도 있음 → 최소 정보로 렌더).
//   기간 성과 등락률은 prices(끝-첫)로 계산해 차트 헤더에도 표시.
// ============================================================
function CoinDetail({ coinId, coin, currency }) {
  const [days, setDays] = useState(7); // 기본 7D
  const { prices, loading, error } = useChart(coinId, currency, days);

  // 기간 성과(첫→끝) 등락률 계산
  const periodChange = useMemo(() => {
    if (prices.length < 2) return null;
    const a = prices[0][1];
    const b = prices[prices.length - 1][1];
    if (!a) return null;
    return ((b - a) / a) * 100;
  }, [prices]);

  const name = coin?.name || coinId;
  const symbol = coin?.symbol || '';
  const periodLabel = PERIODS.find((p) => p.id === days)?.label || `${days}일`;

  return (
    <main className="flex-1 pb-16 fade-in">
      {/* 뒤로 가기 */}
      <div className="pt-2 pb-4">
        <button
          type="button"
          onClick={navigateToList}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-cbgray
            hover:text-cbink transition-colors focus:outline-none focus:ring-2 focus:ring-cbblue/30 rounded-full px-2 py-1 -ml-2"
        >
          <span aria-hidden="true">←</span> 목록으로
        </button>
      </div>

      {/* 상단: 아이콘 + 이름/심볼 + 큰 가격 + 24h */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          {coin?.image ? (
            <img
              src={coin.image} alt=""
              className="w-12 h-12 rounded-full bg-cbline shrink-0"
              onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
            />
          ) : (
            <div className="w-12 h-12 rounded-full bg-cbline grid place-items-center text-xs text-cbgray shrink-0">
              {symbol?.slice(0, 3) || '?'}
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-extrabold text-cbink truncate leading-tight">{name}</h1>
            <div className="text-sm text-cbgray uppercase tracking-wide">{symbol}</div>
          </div>
        </div>

        <div className="sm:text-right">
          <div className="text-3xl sm:text-[34px] font-extrabold text-cbink tabular-nums leading-none">
            {coin ? formatCurrency(coin.price, currency) : '—'}
          </div>
          <div className="mt-2 flex items-center gap-2 sm:justify-end">
            {coin && <ChangePill pct={coin.change24h} className="text-sm" />}
            <span className="text-xs text-cbgray">24시간</span>
          </div>
        </div>
      </div>

      {/* 차트 카드 */}
      <div className="mt-6 rounded-2xl border border-cbborder p-4 sm:p-5">
        {/* 차트 헤더: 기간 라벨 + 성과 / 기간 탭 */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold text-cbink">{periodLabel} 가격 추이</span>
            {periodChange != null && (
              <ChangePill pct={periodChange} className="text-xs" />
            )}
          </div>
          <PeriodTabs value={days} onChange={setDays} />
        </div>

        {/* 차트 본문: 로딩/에러/정상 */}
        {loading ? (
          <ChartSkeleton />
        ) : error && prices.length < 2 ? (
          <div className="grid place-items-center text-center" style={{ height: 280 }}>
            <div>
              <div className="text-3xl mb-2">📉</div>
              <p className="text-sm text-cbink font-semibold">{error}</p>
              <p className="mt-1 text-xs text-cbgray">다른 기간을 선택하거나 잠시 후 다시 시도해 주세요.</p>
            </div>
          </div>
        ) : (
          <DetailChart prices={prices} currency={currency} days={days} />
        )}
      </div>

      {/* 통계 그리드 — 목록에서 받은 코인 데이터 재사용 */}
      <div className="mt-6 rounded-2xl border border-cbborder overflow-hidden">
        <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-cbline">
          <StatCell
            label="24h 고가"
            value={coin?.high24h != null ? formatCurrency(coin.high24h, currency) : '—'}
          />
          <StatCell
            label="24h 저가"
            value={coin?.low24h != null ? formatCurrency(coin.low24h, currency) : '—'}
          />
          <StatCell
            label="시가총액"
            value={coin?.marketCap != null ? formatCompact(coin.marketCap, currency) : '—'}
          />
          <StatCell
            label="24h 거래량"
            value={coin?.totalVolume != null ? formatCompact(coin.totalVolume, currency)
              : (coin?.volume24h != null ? formatCompact(coin.volume24h, currency) : '—')}
          />
        </div>
      </div>
    </main>
  );
}

// ============================================================
//  🚀 App — 전체 화면을 조립하는 루트 컴포넌트 (코인베이스 레이아웃)
// ============================================================
function App() {
  // 관심목록(코인 id 배열). 먼저 localStorage 에서 복원 시도.
  const [watchlist, setWatchlist] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (Array.isArray(saved) && saved.length > 0) return saved;
    } catch (_) {}
    return null; // null = 아직 기본 목록을 불러와야 함
  });

  // 통화(KRW/USD). localStorage 에서 복원.
  const [currency, setCurrency] = useState(() => {
    const saved = localStorage.getItem(CURRENCY_KEY);
    return saved === 'usd' ? 'usd' : 'krw';
  });

  const [bootError, setBootError] = useState(null);

  // 최초 1회: 저장된 관심목록이 없으면 서버 기본 목록(/api/coins)을 받아온다.
  useEffect(() => {
    if (watchlist !== null) return; // 이미 복원됨
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/coins`);
        const json = await res.json();
        if (!cancelled) {
          setWatchlist(Array.isArray(json.coins) ? json.coins : []);
        }
      } catch (_) {
        if (!cancelled) {
          setBootError('기본 코인 목록을 불러오지 못했어요.');
          setWatchlist([]);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [watchlist]);

  // watchlist / currency 변경 시 localStorage 에 저장
  useEffect(() => {
    if (Array.isArray(watchlist)) localStorage.setItem(STORAGE_KEY, JSON.stringify(watchlist));
  }, [watchlist]);
  useEffect(() => { localStorage.setItem(CURRENCY_KEY, currency); }, [currency]);

  // 안전한 배열(null 동안은 빈 배열로 취급해 훅에 넘긴다)
  const safeList = useMemo(() => (Array.isArray(watchlist) ? watchlist : []), [watchlist]);

  // 시세 데이터 + 자동 갱신
  const { coins, updatedAt, loading, error, refresh } = usePrices(safeList, currency);

  // 코인 추가 (중복 방지)
  const addCoin = useCallback((id) => {
    setWatchlist((prev) => {
      const base = Array.isArray(prev) ? prev : [];
      if (base.includes(id)) return base;
      return [...base, id];
    });
  }, []);

  // 코인 삭제
  const removeCoin = useCallback((id) => {
    setWatchlist((prev) => (Array.isArray(prev) ? prev.filter((c) => c !== id) : prev));
  }, []);

  const isInitialLoading = watchlist === null; // 기본 목록 불러오는 중
  const hasCoins = coins.length > 0;
  const isEmptyList = !isInitialLoading && safeList.length === 0;
  const showSkeleton = isInitialLoading || (loading && !hasCoins && !error);

  // 해시 라우팅: 목록 / 상세
  const route = useHashRoute();
  const openCoin = useCallback((id) => navigateToCoin(id), []);

  // 상세에서 보여줄 코인 데이터(목록 fetch 결과에서 찾는다). 30초마다 갱신되므로
  // 상세의 가격/24h/통계도 자동으로 최신값을 따라간다.
  const detailCoin = route.name === 'detail'
    ? coins.find((c) => c.id === route.coinId) || null
    : null;

  return (
    <div className="min-h-screen flex flex-col bg-white text-cbink">
      <div className="w-full max-w-[1100px] mx-auto px-4 sm:px-6 flex-1 flex flex-col">

        {/* ===== Header ===== */}
        <header className="pt-8 sm:pt-12 pb-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl sm:text-[32px] font-extrabold tracking-tight text-cbink">
                암호화폐 시세
              </h1>
              <p className="mt-1.5 text-sm text-cbgray">
                Crypto prices · 30초마다 자동 갱신
              </p>
            </div>

            {/* 우측: 통화 토글 + 새로고침 + 마지막 갱신 */}
            <div className="flex flex-wrap items-center gap-3">
              <CurrencyToggle currency={currency} onChange={setCurrency} />
              <Button variant="secondary" size="sm" onClick={refresh} disabled={loading || isEmptyList}>
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M5 9a7 7 0 0111-3.5L20 9M19 15a7 7 0 01-11 3.5L4 15" />
                </svg>
                새로고침
              </Button>
              <span className="text-xs text-cbgray flex items-center gap-1.5">
                {loading && <Spinner className="w-3.5 h-3.5" />}
                마지막 갱신
                <span className="font-medium text-cbink tabular-nums">{formatTime(updatedAt)}</span>
              </span>
            </div>
          </div>

          {/* 검색창 (코인 추가) — 목록 화면에서만 노출 */}
          {route.name === 'list' && (
            <div className="mt-6">
              <SearchBox onAdd={addCoin} watchlist={safeList} />
            </div>
          )}

          {/* 에러 배너 (서버/네트워크 오류) */}
          {(error || bootError) && (
            <div className="mt-4 rounded-xl border border-cbdown/20 bg-cbdown/5 px-4 py-3 text-sm text-cbdown">
              ⚠️ {error || bootError}
            </div>
          )}
        </header>

        {/* ===== 상세 화면(해시: #/coin/:id) ===== */}
        {route.name === 'detail' ? (
          <CoinDetail coinId={route.coinId} coin={detailCoin} currency={currency} />
        ) : (
        /* ===== Main: 코인 테이블(리스트) ===== */
        <main className="flex-1 pb-16">
          {isEmptyList ? (
            // 빈 관심목록 상태
            <div className="grid place-items-center text-center py-24 rounded-2xl border border-cbborder">
              <div>
                <div className="text-5xl mb-4">🪙</div>
                <p className="text-cbink font-semibold">관심목록이 비어 있어요.</p>
                <p className="mt-1 text-sm text-cbgray">위의 검색창에서 코인을 찾아 추가해 보세요.</p>
              </div>
            </div>
          ) : !hasCoins && error && !showSkeleton ? (
            // 데이터 없음 + 에러
            <div className="grid place-items-center text-center py-24 rounded-2xl border border-cbborder">
              <div>
                <div className="text-5xl mb-4">📡</div>
                <p className="text-cbink font-semibold">시세를 표시할 수 없어요.</p>
                <Button variant="secondary" size="sm" className="mt-4" onClick={refresh}>다시 시도</Button>
              </div>
            </div>
          ) : (
            // 정상/로딩: 테이블
            <div className="rounded-2xl border border-cbborder overflow-hidden">
              {/* 테이블 헤더 행 (회색 작은 글씨) */}
              <div className="grid items-center gap-3 px-3 sm:px-4 py-3 bg-white border-b border-cbborder
                text-[11px] font-semibold uppercase tracking-wide text-cbgray
                grid-cols-[24px_minmax(0,1fr)_auto_auto_32px]
                md:grid-cols-[28px_minmax(0,1.6fr)_minmax(110px,1fr)_minmax(96px,0.8fr)_minmax(120px,1fr)_120px_36px]">
                <div className="text-center">#</div>
                <div>이름</div>
                <div className="text-right">가격</div>
                <div className="text-right">24시간</div>
                <div className="hidden md:block text-right">시가총액</div>
                <div className="hidden md:block text-right">최근 7일</div>
                <div></div>
              </div>

              {/* 본문 행들 */}
              {showSkeleton
                ? Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)
                : coins.map((coin, i) => (
                    <CoinRow
                      key={coin.id}
                      rank={i + 1}
                      coin={coin}
                      currency={currency}
                      onRemove={removeCoin}
                      onOpen={openCoin}
                    />
                  ))}
            </div>
          )}
        </main>
        )}

        {/* ===== Footer ===== */}
        <footer className="text-center pb-8 text-xs text-cbgray">
          하버스쿨 AI 교육 · 3주차 Network 실습 · 서버 버전 (server.js + index.html + client.js · React)
        </footer>
      </div>
    </div>
  );
}

// ============================================================
//  렌더링
// ============================================================
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
