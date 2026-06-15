# 📘 수업 내용 질문 에이전트 (Context + 질문 에이전트)

수업에서 배운 내용을 질문하면, **수업 자료를 근거로** 답하고 **이전 대화를 기억**하는 나만의 AI 에이전트입니다.
하버스쿨 AI 교육 과제 — "[Context] 수업 내용 .md + 질문 에이전트 만들기".

```
[브라우저 index.html]  →  [내 서버 /api/chat]  →  [Anthropic Claude API]
    React 채팅 UI            컨텍스트 주입 + 메모리        claude-opus-4-8
                           (API 키는 서버에만 숨김)
```

## ✨ 핵심 요구사항 충족 방식

- **텍스트 + 코드 컨텍스트 모두 참조**
  서버가 시작할 때 `context/` 폴더를 통째로 읽어 시스템 프롬프트에 주입합니다.
  - 텍스트 컨텍스트: `context/수업노트.md` (2~3주차 강의 노트, 핵심만 구조화)
  - 코드 컨텍스트: `context/code/` (실제 실습 파일 — 더치페이 계산기, QR 생성기, 포켓몬 도감 API, 날씨앱, AI 별명 생성기·Q&A 봇 server.js 등)
  - 화면의 "📚 참조 중인 수업 자료" 패널에서 어떤 자료를 보고 있는지 직접 확인할 수 있습니다.
- **메모리로 맥락 유지 (필수)**
  세션별 대화 기록을 서버가 보관하고 `memory/sessions.json`에 저장합니다(서버를 껐다 켜도 유지).
  매 질문마다 이전 대화를 함께 모델에 보내므로 "아까 물어본 거랑 연결해서 설명해줘" 같은 요청을 처리합니다.

## 🚀 실행 방법

1. Anthropic API 키 준비 (https://console.anthropic.com)
2. 키를 환경변수로 설정하고 의존성 설치 후 실행:
   ```bash
   export ANTHROPIC_API_KEY=sk-ant-...      # Windows PowerShell: $env:ANTHROPIC_API_KEY="sk-ant-..."
   npm install
   npm start
   ```
3. 브라우저에서 접속: http://localhost:3000

> Node.js 18 이상 필요(내장 fetch 사용). 키는 **서버에만** 두고 절대 프론트/깃에 올리지 않습니다.

## 📡 API 계약

| 메서드 | 경로 | 요청 | 응답 |
|--------|------|------|------|
| GET | `/` | — | `index.html` |
| GET | `/api/context` | — | `{ textFiles:[{name,chars}], codeFiles:[{name,chars}], totalChars }` |
| POST | `/api/chat` | `{ sessionId, message }` | `{ reply, sessionId }` |
| GET | `/api/history?sessionId=` | — | `{ messages:[{role,content}] }` |
| POST | `/api/reset` | `{ sessionId }` | `{ ok:true }` |

에러는 적절한 상태코드 + `{ "error": "한국어 메시지" }`.

## 🗂 폴더 구조

```
[Context] 수업 내용 질문 에이전트/
├── server.js          # Express 서버: 컨텍스트 로딩 + 메모리 + Claude 호출
├── index.html         # React(CDN) 채팅 UI
├── package.json
├── .env.example
├── context/
│   ├── 수업노트.md     # 텍스트 컨텍스트(강의 노트)
│   └── code/          # 코드 컨텍스트(실습 파일들)
└── memory/
    └── sessions.json  # 세션별 대화 기록(자동 생성)
```

## 🔧 자료 바꾸기 / 늘리기

`context/` 폴더에 `.md`, `.txt`, `.html`, `.js` 파일을 추가하고 서버를 재시작하면 바로 참조 대상이 됩니다.
다른 수업·다른 과목으로도 그대로 재사용할 수 있어요 — 자료만 바꾸면 됩니다.
