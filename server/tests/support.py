"""테스트 공용 도구: 임시 포트 서버, 쿠키를 기억하는 HTTP 클라이언트."""
import base64
import hashlib
import http.client
import json
import os
import socket
import sys
import tempfile
import threading
import time
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
SERVER_DIR = os.path.dirname(HERE)
if SERVER_DIR not in sys.path:
    sys.path.insert(0, SERVER_DIR)

import game_api  # noqa: E402

FIXTURES = os.path.join(HERE, "fixtures")
CLIENT_ID = "test-client.apps.googleusercontent.com"


def b64u(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def b64u_int(text):
    return int.from_bytes(base64.urlsafe_b64decode(text + "=" * (-len(text) % 4)), "big")


class TestKey:
    """fixtures/test_keys.json의 시험용 RSA 키(개인키 포함)."""

    def __init__(self, d):
        self.kid = d["kid"]
        self.n = b64u_int(d["n"])
        self.e = b64u_int(d["e"])
        self.d = b64u_int(d["d"])
        self.jwk_public = {"kid": d["kid"], "kty": "RSA", "alg": "RS256", "use": "sig",
                           "n": d["n"], "e": d["e"]}

    @property
    def size(self):
        return (self.n.bit_length() + 7) // 8

    def sign_raw(self, em):
        """인코딩된 메시지(em)에 개인키 연산만 한다. 비정상 패딩 서명을 만들 때 쓴다."""
        return pow(int.from_bytes(em, "big"), self.d, self.n).to_bytes(self.size, "big")

    def sign(self, message):
        t = bytes.fromhex("3031300d060960864801650304020105000420") + hashlib.sha256(message).digest()
        em = b"\x00\x01" + b"\xff" * (self.size - len(t) - 3) + b"\x00" + t
        return self.sign_raw(em)


def load_keys():
    with open(os.path.join(FIXTURES, "test_keys.json"), encoding="utf-8") as f:
        return [TestKey(k) for k in json.load(f)["keys"]]


KEYS = load_keys()


def make_jwt(key, payload, header=None, signature=None):
    h = {"alg": "RS256", "kid": key.kid, "typ": "JWT"} if header is None else header
    seg = b64u(json.dumps(h).encode()) + "." + b64u(json.dumps(payload).encode())
    sig = key.sign(seg.encode("ascii")) if signature is None else signature
    return seg + "." + b64u(sig)


def id_claims(now, nonce, sub="user-1", **over):
    """정상 ID 토큰 클레임. over에서 값이 None이면 그 클레임을 뺀다."""
    c = {"iss": "https://accounts.google.com", "aud": CLIENT_ID, "azp": CLIENT_ID, "sub": sub,
         "iat": int(now), "exp": int(now) + 3600, "nonce": nonce}
    c.update(over)
    return {k: v for k, v in c.items() if v is not None}


class FakeJwks:
    """구글 JWKS 대역. 호출 횟수를 세고, 실패나 max-age를 바꿀 수 있다."""

    def __init__(self, keys=None, max_age=3600):
        self.keys = list(KEYS if keys is None else keys)
        self.max_age = max_age
        self.calls = 0
        self.fail = False

    def __call__(self):
        self.calls += 1
        if self.fail:
            raise OSError("네트워크 오류(시험)")
        return {"keys": [k.jwk_public for k in self.keys]}, self.max_age


class FakeClock:
    """실제 시각에 오프셋을 더한 시계. advance로 시간을 건너뛴다."""

    def __init__(self):
        self.offset = 0.0

    def __call__(self):
        return time.time() + self.offset

    def advance(self, seconds):
        self.offset += seconds


class TestServer:
    def __init__(self, bounds_path=None, jwks=None, dev=False, static=None):
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.clock = FakeClock()
        cfg = game_api.Config(
            client_id=CLIENT_ID, data=self.tmp.name, dev=dev, static=static,
            bounds_path=bounds_path or os.path.join(FIXTURES, "bounds-design.json"))
        self.cfg = cfg
        self.jwks = jwks or FakeJwks()
        self.app = game_api.App(cfg, clock=self.clock, jwks_fetch=self.jwks)
        self.httpd = game_api.make_server(self.app, "127.0.0.1", 0)
        self.port = self.httpd.server_address[1]
        cfg.origin = "http://127.0.0.1:%d" % self.port
        self.origin = cfg.origin
        self.thread = threading.Thread(target=self.httpd.serve_forever, args=(0.01,), daemon=True)
        self.thread.start()
        self._ip = 0

    def next_ip(self):
        self._ip += 1
        return "10.1.%d.%d" % (self._ip // 250, self._ip % 250 + 1)

    def client(self, ip=None):
        return Client(self, ip or self.next_ip())

    def login(self, client, sub="user-1", key=None, claims=None, state=None, nonce=None,
              header=None, token=None, extra_form=None):
        """/auth/start를 거쳐 시험용 키로 서명한 id_token을 콜백으로 보낸다. 콜백 응답을 돌려준다."""
        r = client.get("/api/auth/start")
        assert r.status == 302, r.status
        q = urllib.parse.parse_qs(urllib.parse.urlparse(r.header("location")).query)
        st = q["state"][0] if state is None else state
        nn = q["nonce"][0] if nonce is None else nonce
        if token is None:
            payload = id_claims(self.clock(), nn, sub=sub, **(claims or {}))
            token = make_jwt(key or KEYS[0], payload, header=header)
        form = {"id_token": token, "state": st}
        form.update(extra_form or {})
        return client.request("POST", "/api/auth/callback",
                              raw_body=urllib.parse.urlencode(form).encode(),
                              ctype="application/x-www-form-urlencoded", origin=False)

    def login_ok(self, client, sub="user-1", **kw):
        r = self.login(client, sub=sub, **kw)
        assert r.status == 303 and r.header("location") == "/?login=ok", (r.status, r.header("location"))
        return r

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
