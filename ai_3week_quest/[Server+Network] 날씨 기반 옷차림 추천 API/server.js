/*
 * [Server+Network] 날씨 기반 옷차림 추천 API - 백엔드 서버
 *
 * 무엇을 하나요?
 *   1) 프론트(index.html)가 우리 서버의 `/recommend?city=서울` 를 호출하면
 *   2) 서버가 OpenWeatherMap 외부 날씨 API를 호출해 현재 기온/날씨를 받아오고
 *   3) 기온 구간에 맞는 옷차림 추천 문구로 가공해서 JSON으로 돌려줍니다.
 *
 *   ★ OpenWeatherMap API 키는 프론트가 아니라 "서버 환경변수(.env)"에 숨깁니다.
 *     이렇게 하면 브라우저(프론트)에 키가 절대 노출되지 않습니다. 백엔드를 따로 두는 핵심 이유!
 *
 * 실행 방법:
 *   1) 의존성 설치:   npm install
 *   2) 키 설정:        cp .env.example .env  후 .env 파일에 OPENWEATHER_API_KEY 입력
 *   3) 서버 실행:      npm start   (또는: node server.js)
 *   4) 브라우저 접속:  http://localhost:3000
 *
 * Node 18+ 필요 (내장 fetch 사용).
 */

require('dotenv').config();

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

// ───────────────────────────────────────────────────────────────────
// 기온 구간 → 옷차림 매핑표
//   - 위에서부터 차례로 검사하여 temp(실제기온, ℃)가 min 이상이면 채택
//   - 표를 데이터로 분리해두면 구간/문구 수정이 쉽고 로직이 깔끔합니다.
// ───────────────────────────────────────────────────────────────────
const CLOTHING_TABLE = [
  { min: 28,        range: '28℃ 이상', emoji: '🥵', headline: '🥵 한여름! 시원하게 입으세요',        items: ['민소매', '반팔', '반바지', '린넨옷'] },
  { min: 23,        range: '23~27℃',   emoji: '😎', headline: '😎 반팔 OK!',                        items: ['반팔', '얇은 셔츠', '반바지', '면바지'] },
  { min: 20,        range: '20~22℃',   emoji: '🙂', headline: '🙂 선선해요, 얇은 겉옷 챙기세요',     items: ['얇은 가디건', '긴팔', '면바지', '청바지'] },
  { min: 17,        range: '17~19℃',   emoji: '🍂', headline: '🍂 얇은 니트나 가디건이 좋아요',       items: ['가디건', '니트', '맨투맨', '청바지'] },
  { min: 12,        range: '12~16℃',   emoji: '🧥', headline: '🧥 자켓이 필요한 날씨',              items: ['자켓', '가디건', '야상', '스타킹', '청바지'] },
  { min: 9,         range: '9~11℃',    emoji: '🌬️', headline: '🌬️ 트렌치코트나 자켓을 입으세요',     items: ['트렌치코트', '자켓', '니트', '청바지', '스타킹'] },
  { min: 5,         range: '5~8℃',     emoji: '🧣', headline: '🧣 코트와 따뜻한 옷이 필요해요',       items: ['코트', '히트텍', '니트', '두꺼운 바지', '목도리'] },
  { min: -Infinity, range: '4℃ 이하',  emoji: '🥶', headline: '🥶 패딩 필수! 단단히 챙겨입으세요',    items: ['패딩', '두꺼운 코트', '목도리', '기모옷', '장갑'] },
];

// 기온(℃) → { range, emoji, headline, items }
function recommendByTemp(temp) {
  const row = CLOTHING_TABLE.find((r) => temp >= r.min);
  return {
    headline: row.headline,
    items: row.items,
    emoji: row.emoji,
    _range: row.range,
  };
}

// ───────────────────────────────────────────────────────────────────
// 날씨 코드(id) → 자연스러운 한국어 설명
//   OpenWeatherMap의 lang=kr 번역은 "튼구름", "온흐림", "실 비"처럼
//   어색한 표현이 많아, 코드(weather[0].id) 기준으로 직접 매핑합니다.
//   코드표: https://openweathermap.org/weather-conditions
// ───────────────────────────────────────────────────────────────────
const WEATHER_DESC_BY_ID = {
  // 800번대: 맑음/구름
  800: '맑음',
  801: '구름 조금',
  802: '구름이 약간',
  803: '구름 많음',
  804: '흐림',
  // 700번대: 안개/연무 등
  701: '엷은 안개',
  711: '연기',
  721: '실안개',
  731: '모래 먼지',
  741: '안개',
  751: '모래바람',
  761: '먼지',
  762: '화산재',
  771: '돌풍',
  781: '토네이도',
};

// id 범위로 큰 분류 fallback
function weatherDescByRange(id) {
  if (id >= 200 && id < 300) return '뇌우';
  if (id >= 300 && id < 400) return '이슬비';
  if (id >= 500 && id < 600) {
    if (id === 500) return '약한 비';
    if (id === 511) return '진눈깨비';
    if (id >= 520) return '소나기';
    return '비';
  }
  if (id >= 600 && id < 700) {
    if (id === 600) return '약한 눈';
    if (id === 602) return '강한 눈';
    if (id === 611 || id === 612 || id === 613) return '진눈깨비';
    return '눈';
  }
  if (id >= 700 && id < 800) return '안개';
  return '';
}

// 최종 한국어 날씨 설명 (없으면 OpenWeatherMap 원문으로 fallback)
function koWeatherDesc(weather) {
  const id = weather?.id;
  if (id && WEATHER_DESC_BY_ID[id]) return WEATHER_DESC_BY_ID[id];
  const byRange = weatherDescByRange(id);
  if (byRange) return byRange;
  return weather?.description || '정보 없음';
}

const GEO_URL = 'https://api.openweathermap.org/geo/1.0/direct';
const OPENWEATHER_URL = 'https://api.openweathermap.org/data/2.5/weather';

// 옷차림 추천 엔드포인트
app.get('/recommend', async (req, res) => {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error:
        'OPENWEATHER_API_KEY가 .env에 설정되지 않았습니다. .env.example을 .env로 복사한 뒤 발급받은 키를 넣고 서버를 다시 실행하세요.',
    });
  }

  const city = (req.query.city && String(req.query.city).trim()) || '서울';

  try {
    // 1) 지오코딩: 도시명(한글/영문) → 위경도. OpenWeatherMap의 q= 날씨조회는
    //    한글 도시명을 잘 못 찾으므로, 먼저 좌표로 변환한 뒤 좌표로 날씨를 조회합니다.
    const geoRes = await fetch(
      `${GEO_URL}?q=${encodeURIComponent(city)}&limit=1&appid=${apiKey}`
    );
    if (geoRes.status === 401) {
      return res.status(500).json({
        error: 'OpenWeatherMap API 키가 올바르지 않습니다. .env의 OPENWEATHER_API_KEY를 확인하세요. (신규 키는 활성화까지 수십 분~2시간 걸릴 수 있습니다.)',
      });
    }
    if (!geoRes.ok) {
      const errText = await geoRes.text();
      console.error('Geocoding API 오류:', geoRes.status, errText);
      return res.status(502).json({
        error: `날씨 서버 호출에 실패했습니다 (status ${geoRes.status}). 잠시 후 다시 시도해주세요.`,
      });
    }
    const geoList = await geoRes.json();
    if (!Array.isArray(geoList) || geoList.length === 0) {
      return res.status(404).json({ error: `도시를 찾을 수 없습니다: ${city}` });
    }
    const place = geoList[0];
    // 화면에 보여줄 도시명: 한글명이 있으면 한글로, 없으면 기본명
    const displayCity = (place.local_names && place.local_names.ko) || place.name || city;

    // 2) 좌표로 현재 날씨 조회
    const url =
      `${OPENWEATHER_URL}?lat=${place.lat}&lon=${place.lon}` +
      `&appid=${apiKey}&units=metric&lang=kr`;

    const weatherRes = await fetch(url);

    if (weatherRes.status === 404) {
      return res.status(404).json({ error: `도시를 찾을 수 없습니다: ${city}` });
    }
    if (weatherRes.status === 401) {
      return res.status(500).json({
        error: 'OpenWeatherMap API 키가 올바르지 않습니다. .env의 OPENWEATHER_API_KEY를 확인하세요. (신규 키는 활성화까지 수십 분~2시간 걸릴 수 있습니다.)',
      });
    }
    if (!weatherRes.ok) {
      const errText = await weatherRes.text();
      console.error('OpenWeatherMap API 오류:', weatherRes.status, errText);
      return res.status(502).json({
        error: `날씨 서버 호출에 실패했습니다 (status ${weatherRes.status}). 잠시 후 다시 시도해주세요.`,
      });
    }

    const data = await weatherRes.json();

    const temp = Math.round((data?.main?.temp ?? 0) * 10) / 10;
    const feelsLike = Math.round((data?.main?.feels_like ?? 0) * 10) / 10;
    const weatherDesc = koWeatherDesc(data?.weather?.[0]);
    const icon = data?.weather?.[0]?.icon || '01d';

    const rec = recommendByTemp(temp);

    return res.json({
      city: displayCity,
      temp,
      feelsLike,
      weatherDesc,
      icon,
      tempRange: rec._range,
      recommendation: {
        headline: rec.headline,
        items: rec.items,
        emoji: rec.emoji,
      },
    });
  } catch (err) {
    console.error('서버 오류:', err);
    return res.status(500).json({ error: '서버 내부 오류가 발생했습니다.' });
  }
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log('');
    console.log('🌤️  날씨 기반 옷차림 추천 서버가 실행되었습니다!');
    console.log(`   👉 http://localhost:${PORT}`);
    console.log('');
    if (!process.env.OPENWEATHER_API_KEY) {
      console.log('⚠️  OPENWEATHER_API_KEY가 설정되지 않았습니다. 추천 기능을 쓰려면:');
      console.log('      1) cp .env.example .env');
      console.log('      2) .env 파일에 OpenWeatherMap에서 발급받은 키 입력');
      console.log('      3) 서버 다시 실행 (npm start)');
      console.log('   키 발급: https://openweathermap.org/api  (무료 가입 → API keys)');
      console.log('');
    }
  });
}

module.exports = app;
