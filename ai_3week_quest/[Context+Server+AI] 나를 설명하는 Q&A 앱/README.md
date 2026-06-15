# 나를 설명하는 Q&A 앱 (Context + Server + AI)

`about-me.md` 컨텍스트 파일에 **내 서버 + AI**를 더해서, 나에 대해 무엇이든 물어보면 답해주는 Q&A 앱입니다.

## 핵심 아이디어

```
사용자 질문  ─▶  내 서버(server.js)  ─▶  "질문 + about-me.md"를 함께 AI에게 전달
                                            │
   화면에 답변  ◀──  서버  ◀──  AI가 about-me.md 내용만 근거로 답변 (없으면 "몰라요")
```

이 앱의 정수는 **AI의 일반 지식이 아니라 내 `about-me.md`를 근거로만** 답하게 하는 것입니다.
서버가 시스템 프롬프트에 `about-me.md` 전체를 실어 보내고, "아래 내용에 있는 것만 근거로 답하고, 없으면 모른다고 해"라고 지시합니다.

## 파일 구성

| 파일 | 역할 |
| --- | --- |
| `about-me.md` | 나를 설명하는 컨텍스트 (지식의 전부). 섹션: 기본정보 / 경력 / 취향 / 좋아하는 것 / 프로젝트 |
| `server.js` | 질문 + about-me.md를 AI에 전달하고 답을 돌려주는 백엔드 (Node 내장 모듈만, 의존성 0개) |
| `index.html` | React + Tailwind(CDN)로 만든 채팅형 질문/답변 화면 |
| `.env.example` | API 키 설정 예시 |

## 실행 방법

1. (선택) Anthropic API 키 준비 — 더 자연스러운 답을 원할 때
   ```bash
   cp .env.example .env   # 그리고 .env 안에 키를 채우거나, 아래처럼 직접 export
   ```
2. 서버 실행
   ```bash
   # API 키와 함께 (Claude 사용)
   ANTHROPIC_API_KEY=sk-ant-... node server.js

   # 또는 키 없이 (about-me.md 로컬 검색 모드로 데모)
   node server.js
   ```
3. 브라우저에서 `http://localhost:3000` 접속 후, 나에 대해 무엇이든 물어보세요!

## 동작 모드

- **AI 모드** (`ANTHROPIC_API_KEY` 있음): `claude-opus-4-8` 가 about-me.md를 근거로 자연스럽게 답변.
- **로컬 검색 모드** (키 없음): about-me.md 본문에서 질문 키워드로 관련 줄을 찾아 답변. 근거가 없으면 "몰라요".

## 확장하기

`about-me.md` **하나만 갈아끼우면** 다른 봇이 됩니다.
- 친구를 소개하는 내용으로 바꾸면 → '친구 소개 봇'
- 우리 가게 정보로 바꾸면 → '우리 가게 소개 봇'

## 보안 메모

- API 키는 **서버에만** 둡니다. 브라우저(프론트)는 `/api/ask` 만 호출하므로 키가 노출되지 않습니다.
- 실제 키가 든 `.env` 는 깃에 커밋하지 마세요.
