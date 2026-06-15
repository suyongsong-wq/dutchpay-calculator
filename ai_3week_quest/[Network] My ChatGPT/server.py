# ========================================
# My ChatGPT — 나만의 맞춤형 챗봇 서버 (Python 버전)
# Python3 표준 라이브러리만 사용 (설치 불필요)
#   - http.server : 정적 파일 서빙 + API 엔드포인트
#   - urllib       : OpenAI Chat Completions API 호출
# 실행: OPENAI_API_KEY=sk-... python3 server.py  →  http://localhost:3457
#
# server.js(Node)와 동일하게 동작합니다. Node가 설치되어 있으면
# `node server.js`를, 아니면 이 파일을 사용하세요.
#
# 심리상담 서버와 다른 점:
#   이 앱은 사용자가 성격/말투/전문분야를 고르는 맞춤형 봇이라,
#   시스템 프롬프트를 클라이언트가 만들어 `system` 필드로 보냅니다.
#   서버는 키만 붙여 OpenAI에 중계합니다. (키는 절대 클라이언트에 노출 안 함)
# ========================================

import os
import json
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# ---------------------------------------
# 설정
# ---------------------------------------
PORT = int(os.environ.get("PORT", 3457))

# API 키는 서버에서만 사용 (클라이언트에 절대 노출 금지)
# 환경변수 OPENAI_API_KEY 로 주입 (platform.openai.com 에서 발급)
OPENAI_API_KEY = (os.environ.get("OPENAI_API_KEY") or "").strip()

OPENAI_MODEL = "gpt-4o-mini"

# 클라이언트가 system을 보내지 않은 경우의 기본 시스템 프롬프트
DEFAULT_SYSTEM_PROMPT = "너는 사용자 맞춤형 AI 챗봇이야. 한국어로 친절하게 답해."


# ---------------------------------------
# OpenAI Chat Completions 호출
#   - 클라이언트가 보낸 system 프롬프트를 messages 맨 앞에 추가
# ---------------------------------------
def call_openai(messages, system_prompt):
    if not OPENAI_API_KEY:
        raise RuntimeError(
            "OPENAI_API_KEY 환경변수가 설정되지 않았어요. "
            "platform.openai.com 에서 키를 발급받아 환경변수로 넣어주세요."
        )

    payload = json.dumps(
        {
            "model": OPENAI_MODEL,
            "messages": [{"role": "system", "content": system_prompt}] + messages,
            "temperature": 0.8,
            "max_tokens": 500,
        }
    ).encode("utf-8")

    req = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + OPENAI_API_KEY,
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "ignore")
        try:
            msg = json.loads(body).get("error", {}).get("message")
        except Exception:
            msg = None
        raise RuntimeError(msg or ("OpenAI API 오류 (status %s)" % e.code))
    except Exception as e:
        raise RuntimeError("OpenAI 호출 실패: " + str(e))

    try:
        reply = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        raise RuntimeError("OpenAI 응답에서 메시지를 찾을 수 없습니다.")
    return reply.strip()


# ---------------------------------------
# 요청 핸들러
# ---------------------------------------
class Handler(BaseHTTPRequestHandler):
    def _send_json(self, status, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _serve_index(self):
        try:
            path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "index.html")
            with open(path, "rb") as f:
                content = f.read()
        except OSError:
            self.send_response(500)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            self.wfile.write("index.html을 찾을 수 없습니다.".encode("utf-8"))
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def do_GET(self):
        url = self.path.split("?")[0]
        if url in ("/", "/index.html"):
            return self._serve_index()
        self._send_json(404, {"success": False, "message": "요청하신 경로를 찾을 수 없습니다."})

    def do_POST(self):
        url = self.path.split("?")[0]
        if url != "/api/chat":
            return self._send_json(404, {"success": False, "message": "요청하신 경로를 찾을 수 없습니다."})

        length = int(self.headers.get("Content-Length", 0) or 0)
        if length > 1_000_000:
            return self._send_json(400, {"success": False, "message": "요청 본문이 너무 큽니다."})

        raw = self.rfile.read(length) if length else b""
        try:
            body = json.loads(raw.decode("utf-8")) if raw else {}
        except Exception:
            return self._send_json(400, {"success": False, "message": "잘못된 JSON 형식입니다."})

        messages = body.get("messages")
        if not isinstance(messages, list) or len(messages) == 0:
            return self._send_json(400, {"success": False, "message": "messages 배열이 필요합니다."})

        # 클라이언트가 보낸 시스템 프롬프트(프로필 기반). 없으면 기본값 사용
        system_prompt = body.get("system")
        if not isinstance(system_prompt, str) or not system_prompt.strip():
            system_prompt = DEFAULT_SYSTEM_PROMPT

        cleaned = []
        for m in messages:
            if isinstance(m, dict) and isinstance(m.get("content"), str) and m["content"].strip():
                role = "assistant" if m.get("role") == "assistant" else "user"
                cleaned.append({"role": role, "content": m["content"]})

        if not cleaned:
            return self._send_json(400, {"success": False, "message": "유효한 메시지가 없습니다."})

        try:
            reply = call_openai(cleaned, system_prompt)
        except Exception as e:
            print("[POST /api/chat] 오류:", str(e))
            return self._send_json(
                500,
                {"success": False, "message": "AI 응답을 가져오는 중 문제가 발생했어요. 잠시 후 다시 시도해 주세요."},
            )
        return self._send_json(200, {"success": True, "data": {"reply": reply}})

    # 기본 액세스 로그 간결화
    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args))


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print("My ChatGPT 서버 실행 중 → http://localhost:%d" % PORT)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()
