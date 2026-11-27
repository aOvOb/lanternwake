#!/usr/bin/env python3
"""개발용 서버: 정적 파일과 계정 API를 같은 출처(기본 http://localhost:8080)로 서빙한다. 표준 라이브러리만 쓴다.

  python tools/devserver.py [--port 8080] [--api-port 8081] [--data 폴더] [--no-api] [--sink 폴더]

- 계정 서버(server/game_api.py --dev)를 자식 프로세스로 띄우고 /api/ 요청을 그쪽으로 넘긴다.
  Origin 검사가 맞도록 PUBLIC_ORIGIN을 이 서버의 주소로 준다. 구글 클라이언트 ID 없이 뜨고,
  /api/dev/login?name=이름 으로 가짜 로그인을 할 수 있다(--dev에서만 켜진다).
- --data를 주지 않으면 실행할 때마다 새 임시 폴더를 쓴다(끝나면 지운다).
- --no-api는 계정 서버를 띄우지 않는다. /api/ 요청은 502가 되어 게임이 "오프라인"으로 보인다.
- --sink 폴더를 주면 POST /__sink/<이름> 본문을 폴더 안 파일로 저장한다(자동 검사 결과 받기용).
- 정적 파일은 저장소 루트에서 주되 server/, tools/, deploy/, .git, *.md는 막는다.
"""
import argparse
import atexit
import http.client
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BLOCKED = ("server", "tools", "deploy", ".git", "docs")
HOP = {"server", "date", "connection", "keep-alive", "transfer-encoding", "te", "trailer", "upgrade", "proxy-authorization",
       "proxy-authenticate", "host", "content-length"}


class Dev(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def make_handler(api_port, sink_dir):
    class H(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.0"
        server_version = "lw-dev"

        def log_message(self, *a):
            pass

        # -- API 프록시
        def proxy(self):
            if api_port is None:
                return self.reply(502, b'{"error":"no_api"}', "application/json")
            n = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(n) if n else None
            headers = {k: v for k, v in self.headers.items() if k.lower() not in HOP}
            # 요청이 X-Real-IP를 직접 주면 그대로 둔다(시험에서 요청 제한을 사용자별로 나누기 위한 개발용 편의)
            if not any(k.lower() == "x-real-ip" for k in headers):
                headers["X-Real-IP"] = self.client_address[0]
            if body is not None:
                headers["Content-Length"] = str(len(body))
            try:
                conn = http.client.HTTPConnection("127.0.0.1", api_port, timeout=20)
                conn.request(self.command, self.path, body=body, headers=headers)
                r = conn.getresponse()
                data = r.read()
            except OSError:
                return self.reply(502, b'{"error":"api_down"}', "application/json")
            self.send_response(r.status)
            for k, v in r.getheaders():
                if k.lower() not in HOP:
                    self.send_header(k, v)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(data)

        def reply(self, status, data, ctype, extra=()):
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-cache")
            for k, v in extra:
                self.send_header(k, v)
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(data)

        # -- 정적 파일
        def static(self):
            path = urllib.parse.unquote(self.path.partition("?")[0])
            rel = path.lstrip("/")
            if rel == "" or rel.endswith("/"):
                rel += "index.html"
            parts = [p for p in re.split(r"[\/]", rel) if p]
            if (not parts or parts[0] in BLOCKED or any(p.startswith(".") for p in parts) or rel.endswith(".md")):
                return self.reply(404, b"not found", "text/plain; charset=utf-8")
            full = os.path.realpath(os.path.join(ROOT, rel))
            if os.path.commonpath([full, ROOT]) != ROOT or not os.path.isfile(full):
                return self.reply(404, b"not found", "text/plain; charset=utf-8")
            ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
            if full.endswith(".webmanifest"):
                ctype = "application/manifest+json"
            elif full.endswith(".js"):
                ctype = "text/javascript; charset=utf-8"
            elif ctype.startswith("text/"):
                ctype += "; charset=utf-8"
            with open(full, "rb") as f:
                self.reply(200, f.read(), ctype)

        def route(self):
            path = self.path.partition("?")[0]
            if path == "/api" or path.startswith("/api/"):
                return self.proxy()
            if sink_dir and self.command == "POST" and path.startswith("/__sink/"):
                name = re.sub(r"[^A-Za-z0-9_.-]", "_", path[len("/__sink/"):])[:80] or "x"
                n = int(self.headers.get("Content-Length") or 0)
                with open(os.path.join(sink_dir, name), "wb") as f:
                    f.write(self.rfile.read(n))
                return self.reply(204, b"", "text/plain")
            if self.command in ("GET", "HEAD"):
                return self.static()
            self.reply(405, b"method not allowed", "text/plain; charset=utf-8")

        do_GET = do_HEAD = do_POST = do_PUT = do_DELETE = route

    return H


def wait_health(port, tries=50):
    for _ in range(tries):
        try:
            urllib.request.urlopen("http://127.0.0.1:%d/api/health" % port, timeout=1).read()
            return True
        except OSError:
            time.sleep(0.2)
    return False


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--api-port", type=int, default=8081)
    ap.add_argument("--data", default=None)
    ap.add_argument("--no-api", action="store_true")
    ap.add_argument("--sink", default=None)
    a = ap.parse_args()
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")

    api_port = None
    if not a.no_api:
        api_port = a.api_port
        data = a.data
        if data is None:
            data = tempfile.mkdtemp(prefix="lw-devdata-")
            atexit.register(shutil.rmtree, data, True)
        env = dict(os.environ, PUBLIC_ORIGIN="http://localhost:%d" % a.port, DATA=data)
        env.pop("GOOGLE_CLIENT_ID", None)
        child = subprocess.Popen([sys.executable, os.path.join(ROOT, "server", "game_api.py"), "serve", "--dev",
                                  "--host", "127.0.0.1", "--port", str(api_port)], env=env)
        atexit.register(child.terminate)
        if not wait_health(api_port):
            print("계정 서버가 뜨지 않았습니다.", file=sys.stderr)
            child.terminate()
            sys.exit(1)
    if a.sink:
        os.makedirs(a.sink, exist_ok=True)
    srv = Dev(("127.0.0.1", a.port), make_handler(api_port, a.sink))
    print("ready http://localhost:%d api=%s" % (a.port, api_port or "off"), flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
