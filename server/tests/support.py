"""테스트 공용 도구: 임시 포트 서버, 쿠키를 기억하는 HTTP 클라이언트."""
import http.client
import json
import os
import socket
import sys
import tempfile
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
SERVER_DIR = os.path.dirname(HERE)
if SERVER_DIR not in sys.path:
    sys.path.insert(0, SERVER_DIR)

import game_api  # noqa: E402

FIXTURES = os.path.join(HERE, "fixtures")
CLIENT_ID = "test-client.apps.googleusercontent.com"


class FakeClock:
    """실제 시각에 오프셋을 더한 시계. advance로 시간을 건너뛴다."""

    def __init__(self):
        self.offset = 0.0

    def __call__(self):
        return time.time() + self.offset

    def advance(self, seconds):
        self.offset += seconds


class TestServer:
    def __init__(self, bounds_path=None, jwks_fetch=None, dev=False, static=None):
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.clock = FakeClock()
        cfg = game_api.Config(
            client_id=CLIENT_ID, data=self.tmp.name, dev=dev, static=static,
            bounds_path=bounds_path or os.path.join(FIXTURES, "bounds-design.json"))
        self.cfg = cfg
        kw = {"clock": self.clock}
        if jwks_fetch is not None:
            kw["jwks_fetch"] = jwks_fetch
        self.app = game_api.App(cfg, **kw)
        self.httpd = game_api.make_server(self.app, "127.0.0.1", 0)
        self.port = self.httpd.server_address[1]
        cfg.origin = "http://127.0.0.1:%d" % self.port
        self.origin = cfg.origin
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self._ip = 0

    def next_ip(self):
        self._ip += 1
        return "10.1.%d.%d" % (self._ip // 250, self._ip % 250 + 1)

    def client(self, ip=None):
        return Client(self, ip or self.next_ip())

    def close(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.app.close()
        self.tmp.cleanup()


class Response:
    def __init__(self, status, headers, body):
        self.status = status
        self.headers = headers          # [(소문자 이름, 값)]
        self.body = body

    def header(self, name):
        for k, v in self.headers:
            if k == name.lower():
                return v
        return None

    def all_headers(self, name):
        return [v for k, v in self.headers if k == name.lower()]

    @property
    def json(self):
        return json.loads(self.body.decode("utf-8"))


class Client:
    def __init__(self, server, ip):
        self.server = server
        self.ip = ip
        self.jar = {}

    def request(self, method, path, data=None, origin=True, headers=None, raw_body=None,
                ctype="application/json", ip=True):
        h = {}
        if ip:
            h["X-Real-IP"] = self.ip
        if origin is True:
            h["Origin"] = self.server.origin
        elif origin:
            h["Origin"] = origin
        if self.jar:
            h["Cookie"] = "; ".join("%s=%s" % kv for kv in self.jar.items())
        body = raw_body
        if data is not None and raw_body is None:
            body = json.dumps(data).encode("utf-8")
        if body is not None:
            h["Content-Type"] = ctype
        h.update(headers or {})
        conn = http.client.HTTPConnection("127.0.0.1", self.server.port, timeout=10)
        try:
            conn.request(method, path, body=body, headers=h)
            r = conn.getresponse()
            resp = Response(r.status, [(k.lower(), v) for k, v in r.getheaders()], r.read())
        finally:
            conn.close()
        for sc in resp.all_headers("set-cookie"):
            nv, _, attrs = sc.partition(";")
            name, _, value = nv.partition("=")
            if "max-age=0" in attrs.lower():
                self.jar.pop(name, None)
            else:
                self.jar[name] = value
        return resp

    def get(self, path, **kw):
        return self.request("GET", path, **kw)

    def post(self, path, data=None, **kw):
        return self.request("POST", path, {} if data is None and "raw_body" not in kw else data, **kw)

    def put(self, path, data=None, **kw):
        return self.request("PUT", path, {} if data is None and "raw_body" not in kw else data, **kw)

    def delete(self, path, data=None, **kw):
        return self.request("DELETE", path, {} if data is None and "raw_body" not in kw else data, **kw)


def raw_request(port, text):
    """소켓으로 원문 요청을 보내고 상태 줄과 본문을 돌려준다(chunked 시험용)."""
    s = socket.create_connection(("127.0.0.1", port), timeout=10)
    try:
        s.sendall(text.encode("utf-8"))
        chunks = []
        while True:
            b = s.recv(65536)
            if not b:
                break
            chunks.append(b)
    finally:
        s.close()
    data = b"".join(chunks).decode("utf-8", "replace")
    status = int(data.split(" ", 2)[1])
    return status, data
