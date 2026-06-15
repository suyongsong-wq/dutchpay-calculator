# 🌤️ 날씨 기반 옷차림 추천 API [Server+Network]

도시를 입력하면 **현재 날씨**를 받아와 **기온 구간별 옷차림**을 추천해주는 웹앱입니다.

```
[브라우저 index.html]  →  [내 서버 /recommend]  →  [OpenWeatherMap API]
        프론트                  백엔드(키 숨김)            외부 날씨 API
```

## ✨ 핵심 포인트

- 프론트(`index.html`)는 **외부 날씨 API를 직접 호출하지 않습니다.** 오직 내 서버의 `/recommend`만 호출해요.
- **OpenWeatherMap API 키는 프론트가 아니라 서버 환경변수(`.env`)에 숨깁니다.** → 브라우저에 키가 절대 노출되지 않습니다. (백엔드를 따로 두는 핵심 이유!)
- 서버가 외부 날씨를 받아 **기온 → 옷차림 매핑표**로 가공한 뒤 깔끔한 JSON으로 응답합니다.

## 🚀 실행 방법

### 1) OpenWeatherMap 키 발급 (무료)
1. https://openweathermap.org/api 접속 → 회원가입
2. 로그인 후 계정 메뉴 → **My API keys**
3. 기본 키 복사
> 신규 키는 활성화까지 수십 분~2시간 걸릴 수 있어요. 401 오류가 나면 잠시 후 다시 시도하세요.

### 2) 키 설정
```bash
cp .env.example .env
# .env 파일을 열어 OPENWEATHER_API_KEY 에 복사한 키를 붙여넣기
```

### 3) 설치 & 실행
```bash
npm install
npm start
```

### 4) 접속
브라우저에서 👉 http://localhost:3000

## 📡 API 명세

### `GET /recommend?city=서울`
| 파라미터 | 설명 | 기본값 |
|---|---|---|
| `city` | 도시명 (한글/영문) | `서울` |

**성공 응답 (200)**
```json
{
  "city": "서울",
  "temp": 18.5,
  "feelsLike": 17.2,
  "weatherDesc": "구름 조금",
  "icon": "03d",
  "tempRange": "17~19℃",
  "recommendation": {
    "headline": "🍂 얇은 니트나 가디건이 좋아요",
    "items": ["가디건", "니트", "맨투맨", "청바지"],
    "emoji": "🍂"
  }
}
```

**에러 응답** — `{ "error": "메시지" }`
- `404` 도시를 찾을 수 없음
- `500` 키 미설정/오류, 서버 내부 오류
- `502` 외부 날씨 API 호출 실패

## 👕 기온 구간 → 옷차림 매핑표

| 기온(℃) | 추천 | 옷차림 |
|---|---|---|
| 28℃ 이상 | 🥵 한여름! 시원하게 | 민소매, 반팔, 반바지, 린넨옷 |
| 23~27℃ | 😎 반팔 OK! | 반팔, 얇은 셔츠, 반바지, 면바지 |
| 20~22℃ | 🙂 얇은 겉옷 | 얇은 가디건, 긴팔, 면바지, 청바지 |
| 17~19℃ | 🍂 얇은 니트/가디건 | 가디건, 니트, 맨투맨, 청바지 |
| 12~16℃ | 🧥 자켓 필요 | 자켓, 가디건, 야상, 스타킹, 청바지 |
| 9~11℃ | 🌬️ 트렌치코트/자켓 | 트렌치코트, 자켓, 니트, 청바지, 스타킹 |
| 5~8℃ | 🧣 코트+따뜻한 옷 | 코트, 히트텍, 니트, 두꺼운 바지, 목도리 |
| 4℃ 이하 | 🥶 패딩 필수! | 패딩, 두꺼운 코트, 목도리, 기모옷, 장갑 |

## 🗂️ 파일 구성
```
server.js        Express 서버 + /recommend + 옷차림 매핑표
index.html       React(CDN) 단일 파일 프론트엔드
package.json     express, dotenv 의존성
.env.example     키 설정 템플릿 (→ .env 로 복사)
.gitignore       node_modules, .env 제외 (키 유출 방지)
```

## 🛠️ 기술 스택
- 백엔드: Node 18+ (내장 fetch), Express, dotenv
- 프론트: React 18 + Babel standalone (CDN, 빌드 도구 없음)
- 외부 API: OpenWeatherMap Current Weather Data (`units=metric`, `lang=kr`)
