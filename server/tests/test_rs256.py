"""S17: RS256 검증, ID 토큰 클레임 검사, JWKS 캐시.

시험용 키는 fixtures/test_keys.json(gen_test_keys.py가 만듦)이고, 서명은 support.TestKey가 한다.
"""
import base64
import hashlib
import hmac
import json
import tempfile
import unittest

from support import CLIENT_ID, KEYS, FakeClock, FakeJwks, b64u, id_claims, make_jwt
import game_api
import gen_test_keys

K1, K2 = KEYS
NONCE = "nonce-abc"


class RsaPrimitiveTest(unittest.TestCase):
    msg = b"header.payload"

    def test_valid_signature(self):
        sig = K1.sign(self.msg)
        self.assertTrue(game_api.rsa_verify_pkcs1_sha256(K1.n, K1.e, self.msg, sig))

    def test_changed_message(self):
        sig = K1.sign(self.msg)
        self.assertFalse(game_api.rsa_verify_pkcs1_sha256(K1.n, K1.e, self.msg + b"x", sig))

    def test_every_sampled_bit_flip_is_rejected(self):
        sig = bytearray(K1.sign(self.msg))
        for pos in (0, 1, 7, 100, len(sig) - 1):
            for bit in (0, 3, 7):
                bad = bytearray(sig)
                bad[pos] ^= 1 << bit
                self.assertFalse(game_api.rsa_verify_pkcs1_sha256(K1.n, K1.e, self.msg, bytes(bad)), (pos, bit))

    def test_other_key(self):
        sig = K2.sign(self.msg)
        self.assertFalse(game_api.rsa_verify_pkcs1_sha256(K1.n, K1.e, self.msg, sig))

    def test_wrong_length_and_out_of_range(self):
        sig = K1.sign(self.msg)
        self.assertFalse(game_api.rsa_verify_pkcs1_sha256(K1.n, K1.e, self.msg, sig[1:]))
        self.assertFalse(game_api.rsa_verify_pkcs1_sha256(K1.n, K1.e, self.msg, b"\x00" + sig))
        self.assertFalse(game_api.rsa_verify_pkcs1_sha256(K1.n, K1.e, self.msg, b""))
        too_big = K1.n.to_bytes(K1.size, "big")        # s == n
        self.assertFalse(game_api.rsa_verify_pkcs1_sha256(K1.n, K1.e, self.msg, too_big))
        zero = bytes(K1.size)
        self.assertFalse(game_api.rsa_verify_pkcs1_sha256(K1.n, K1.e, self.msg, zero))

    def test_padding_with_trailing_garbage_is_rejected(self):
        """패딩 파서가 해시 뒤의 쓰레기를 무시하는 옛 구현 결함. 통째 비교라 거부되어야 한다."""
        t = game_api.SHA256_DIGESTINFO + hashlib.sha256(self.msg).digest()
        garbage = b"\xde\xad" * 8
        em = b"\x00\x01" + b"\xff" * (K1.size - len(t) - len(garbage) - 3) + b"\x00" + t + garbage
        sig = K1.sign_raw(em)
        self.assertFalse(game_api.rsa_verify_pkcs1_sha256(K1.n, K1.e, self.msg, sig))

    def test_short_padding_is_rejected(self):
        t = game_api.SHA256_DIGESTINFO + hashlib.sha256(self.msg).digest()
        em = b"\x00\x01" + b"\xff" * 8 + b"\x00" + t
        em = b"\x00" * (K1.size - len(em)) + em
        self.assertFalse(game_api.rsa_verify_pkcs1_sha256(K1.n, K1.e, self.msg, K1.sign_raw(em)))

    def test_wrong_hash_and_block_type_are_rejected(self):
        t = game_api.SHA256_DIGESTINFO + hashlib.sha256(b"other").digest()
        em = b"\x00\x01" + b"\xff" * (K1.size - len(t) - 3) + b"\x00" + t
        self.assertFalse(game_api.rsa_verify_pkcs1_sha256(K1.n, K1.e, self.msg, K1.sign_raw(em)))
        t = game_api.SHA256_DIGESTINFO + hashlib.sha256(self.msg).digest()
        em = b"\x00\x02" + b"\xff" * (K1.size - len(t) - 3) + b"\x00" + t
        self.assertFalse(game_api.rsa_verify_pkcs1_sha256(K1.n, K1.e, self.msg, K1.sign_raw(em)))

    def test_digestinfo_matches_standard_der(self):
        # SEQUENCE{ SEQUENCE{ OID sha256, NULL }, OCTET STRING(32) } 의 접두부
        self.assertEqual(len(game_api.SHA256_DIGESTINFO) + 32, 51)
        self.assertEqual(game_api.SHA256_DIGESTINFO[:2], b"\x30\x31")
        self.assertEqual(game_api.SHA256_DIGESTINFO[-2:], b"\x04\x20")


class VerifyIdTokenTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.clock = FakeClock()
        self.jwks = FakeJwks()
        self.app = game_api.App(game_api.Config(data=self.tmp.name, client_id=CLIENT_ID),
                                clock=self.clock, jwks_fetch=self.jwks)

    def tearDown(self):
        self.app.close()
        self.tmp.cleanup()

    def token(self, key=K1, header=None, nonce=NONCE, **over):
        return make_jwt(key, id_claims(self.clock(), nonce, **over), header=header)

    def check(self, token, code=None, nonce=NONCE):
        if code is None:
            return game_api.verify_id_token(self.app, token, nonce)
        with self.assertRaises(game_api.TokenError) as cm:
            game_api.verify_id_token(self.app, token, nonce)
        self.assertEqual(cm.exception.code, code)

    def test_valid_token(self):
        self.assertEqual(self.check(self.token(sub="abc-123")), "abc-123")

    def test_valid_with_second_key_and_alternate_issuer(self):
        self.assertEqual(self.check(self.token(key=K2, iss="accounts.google.com")), "user-1")

    def test_forged_signature(self):
        t = self.token()
        h, p, s = t.split(".")
        raw = bytearray(K1.sign((h + "." + p).encode()))
        raw[10] ^= 1
        self.check(h + "." + p + "." + b64u(bytes(raw)), "token")

    def test_payload_tampered_after_signing(self):
        h, p, s = self.token(sub="victim").split(".")
        payload = json.loads(base64.urlsafe_b64decode(p + "=" * (-len(p) % 4)))
        payload["sub"] = "attacker"
        p2 = b64u(json.dumps(payload).encode())
        self.check(h + "." + p2 + "." + s, "token")

    def test_signed_by_other_key_under_same_kid(self):
        payload = id_claims(self.clock(), NONCE)
        t = make_jwt(K2, payload, header={"alg": "RS256", "kid": K1.kid})
        self.check(t, "token")

    def test_alg_none(self):
        payload = id_claims(self.clock(), NONCE)
        header = {"alg": "none", "kid": K1.kid}
        unsigned = make_jwt(K1, payload, header=header, signature=b"")
        self.check(unsigned, "token")
        self.assertTrue(unsigned.endswith("."))
        # 유효한 RS256 서명을 붙여도 alg가 none이면 거부
        self.check(make_jwt(K1, payload, header=header), "token")
        # 서명 칸이 아예 없는 두 조각 토큰
        self.check(".".join(unsigned.split(".")[:2]), "token")

    def test_alg_hs256_with_public_key_as_secret(self):
        """공개키를 HMAC 비밀로 쓰는 알고리즘 혼동 공격."""
        payload = id_claims(self.clock(), NONCE)
        seg = b64u(json.dumps({"alg": "HS256", "kid": K1.kid}).encode()) + "." + b64u(json.dumps(payload).encode())
        secret = K1.n.to_bytes(K1.size, "big")
        sig = hmac.new(secret, seg.encode(), hashlib.sha256).digest()
        self.check(seg + "." + b64u(sig), "token")

    def test_alg_variants_are_rejected(self):
        payload = id_claims(self.clock(), NONCE)
        for alg in ("rs256", "RS384", "RS512", "ES256", "PS256", "", None, 5):
            self.check(make_jwt(K1, payload, header={"alg": alg, "kid": K1.kid}), "token")

    def test_missing_or_unknown_kid(self):
        payload = id_claims(self.clock(), NONCE)
        self.check(make_jwt(K1, payload, header={"alg": "RS256"}), "token")
        self.check(make_jwt(K1, payload, header={"alg": "RS256", "kid": ""}), "token")
        self.check(make_jwt(K1, payload, header={"alg": "RS256", "kid": "nope"}), "token")
        self.check(make_jwt(K1, payload, header={"alg": "RS256", "kid": 5}), "token")

    def test_aud_mismatch(self):
        self.check(self.token(aud="other.apps.googleusercontent.com", azp=None), "aud")
        self.check(self.token(aud=None, azp=None), "aud")

    def test_azp_mismatch(self):
        self.check(self.token(azp="other"), "aud")

    def test_aud_list_requires_matching_azp(self):
        self.check(self.token(aud=[CLIENT_ID, "x"], azp=None), "aud")
        self.assertEqual(self.check(self.token(aud=[CLIENT_ID, "x"], azp=CLIENT_ID)), "user-1")
        self.check(self.token(aud=["x"], azp=CLIENT_ID), "aud")

    def test_azp_may_be_absent(self):
        self.assertEqual(self.check(self.token(azp=None)), "user-1")

    def test_iss_mismatch(self):
        for iss in ("https://evil.example", "https://accounts.google.com/", "http://accounts.google.com", None, 1):
            self.check(self.token(iss=iss), "token")

    def test_expired(self):
        now = int(self.clock())
        self.check(self.token(exp=now - 120), "exp")
        self.check(self.token(exp=now - 61), "exp")

    def test_exp_inside_leeway_is_accepted(self):
        now = int(self.clock())
        self.assertEqual(self.check(self.token(exp=now - 30)), "user-1")

    def test_exp_from_clock_advance(self):
        t = self.token()
        self.clock.advance(3600 + 61)
        self.check(t, "exp")

    def test_iat_in_future(self):
        now = int(self.clock())
        self.check(self.token(iat=now + 400), "exp")
        self.assertEqual(self.check(self.token(iat=now + 200)), "user-1")

    def test_exp_and_iat_types(self):
        self.check(self.token(exp="9999999999"), "token")
        self.check(self.token(exp=None), "token")
        self.check(self.token(iat=None), "token")
        self.check(self.token(exp=True), "token")

    def test_nonce_mismatch(self):
        self.check(self.token(nonce="other"), "nonce")
        self.check(self.token(nonce=None), "nonce")
        self.check(self.token(nonce=5), "nonce")
        self.check(self.token(), "nonce", nonce="different-expected")

    def test_nonce_with_non_ascii_does_not_crash(self):
        self.check(self.token(nonce="한글"), "nonce")

    def test_sub_required(self):
        self.check(self.token(sub=None), "token")
        self.check(self.token(sub=""), "token")
        self.check(self.token(sub=123), "token")
        self.check(self.token(sub="x" * 256), "token")

    def test_garbage_tokens(self):
        for t in ("", "a", "a.b", "a.b.c.d", "...", "!!!.@@@.###", "e30.e30.", "e30.e30.AAAA", "x" * 9000):
            self.check(t, "token")
        self.check(None, "token")
        self.check(b"bytes", "token")

    def test_header_and_payload_must_be_objects(self):
        seg = b64u(b"[1]") + "." + b64u(b"[1]")
        self.check(seg + "." + b64u(K1.sign(seg.encode())), "token")
        seg = b64u(b'{"alg":"RS256","kid":"%s"}' % K1.kid.encode()) + "." + b64u(b'"str"')
        self.check(seg + "." + b64u(K1.sign(seg.encode())), "token")

    def test_non_urlsafe_base64_is_rejected(self):
        t = self.token()
        h, p, s = t.split(".")
        self.check(h + "." + p + ".ab+/", "token")
        self.check(h + "." + p + " .abcd", "token")

    def test_short_key_is_rejected(self):
        small = gen_test_keys.gen_rsa(1024)
        n, e, d = small

        class Small:
            kid = "small"
            jwk_public = {"kid": "small", "kty": "RSA", "alg": "RS256",
                          "n": b64u(n.to_bytes(128, "big")), "e": b64u(e.to_bytes(3, "big"))}
            size = 128

            def sign(self, message):
                t = game_api.SHA256_DIGESTINFO + hashlib.sha256(message).digest()
                em = b"\x00\x01" + b"\xff" * (128 - len(t) - 3) + b"\x00" + t
                return pow(int.from_bytes(em, "big"), d, n).to_bytes(128, "big")

        key = Small()
        # 서명 자체는 수학적으로 맞지만 1024비트 키라 거부해야 한다.
        seg = b64u(b'{"alg":"RS256","kid":"small"}') + "." + b64u(
            json.dumps(id_claims(self.clock(), NONCE)).encode())
        t = seg + "." + b64u(key.sign(seg.encode()))
        self.assertTrue(game_api.rsa_verify_pkcs1_sha256(n, e, seg.encode(), key.sign(seg.encode())))
        self.jwks.keys.append(key)
        self.check(t, "token")

class ParseTest(unittest.TestCase):
    def test_parse_max_age(self):
        p = game_api.parse_max_age
        self.assertEqual(p("public, max-age=19980, must-revalidate, no-transform"), 19980)
        self.assertEqual(p("MAX-AGE=5"), 5)
        self.assertEqual(p("no-cache"), None)
        self.assertEqual(p(""), None)
        self.assertEqual(p(None), None)
        self.assertEqual(p("max-age=abc"), None)
        self.assertEqual(p("max-age=-5"), None)

    def test_parse_jwks_skips_bad_entries(self):
        good = K1.jwk_public
        doc = {"keys": [good, {"kty": "EC", "kid": "ec", "x": "a"}, {"kty": "RSA", "kid": "nokey"},
                        {"kty": "RSA", "n": "AQAB", "e": "AQAB"}, "junk", {"kty": "RSA", "kid": "bad", "n": "@@", "e": "AQAB"}]}
        keys = game_api.parse_jwks(doc)
        self.assertEqual(list(keys), [K1.kid])
        self.assertEqual(keys[K1.kid], (K1.n, K1.e))
        with self.assertRaises(ValueError):
            game_api.parse_jwks({"nokeys": []})
        with self.assertRaises(ValueError):
            game_api.parse_jwks([])


class JwksCacheTest(unittest.TestCase):
    def setUp(self):
        self.t = [1000.0]
        self.fetch = FakeJwks(max_age=600)
        self.cache = game_api.JwksCache(self.fetch, lambda: self.t[0])

    def test_fresh_cache_does_not_refetch(self):
        self.assertIsNotNone(self.cache.get(K1.kid))
        self.assertIsNotNone(self.cache.get(K2.kid))
        self.assertIsNotNone(self.cache.get(K1.kid))
        self.assertEqual(self.fetch.calls, 1)

    def test_max_age_is_respected(self):
        self.cache.get(K1.kid)
        self.t[0] += 599
        self.cache.get(K1.kid)
        self.assertEqual(self.fetch.calls, 1)
        self.t[0] += 2          # 601초 경과, 수명 600초 끝
        self.cache.get(K1.kid)
        self.assertEqual(self.fetch.calls, 2)

    def test_default_and_clamped_max_age(self):
        self.fetch.max_age = None
        self.cache.get(K1.kid)
        self.assertEqual(self.cache.expires, 1000.0 + game_api.JWKS_DEFAULT_MAX_AGE)
        self.fetch.max_age = 5
        self.t[0] += 10000
        self.cache.get(K1.kid)
        self.assertEqual(self.cache.expires, self.t[0] + game_api.JWKS_MAX_AGE_RANGE[0])
        self.fetch.max_age = 10 ** 9
        self.t[0] += 10000
        self.cache.get(K1.kid)
        self.assertEqual(self.cache.expires, self.t[0] + game_api.JWKS_MAX_AGE_RANGE[1])

    def test_unknown_kid_refetches_at_most_once_per_5_minutes(self):
        self.assertIsNone(self.cache.get("nope"))
        self.assertEqual(self.fetch.calls, 1)
        for _ in range(5):
            self.assertIsNone(self.cache.get("nope"))
        self.assertEqual(self.fetch.calls, 1)
        self.t[0] += 299
        self.assertIsNone(self.cache.get("nope"))
        self.assertEqual(self.fetch.calls, 1)
        self.t[0] += 2
        self.assertIsNone(self.cache.get("nope"))
        self.assertEqual(self.fetch.calls, 2)

    def test_new_key_appears_after_rotation(self):
        self.fetch.keys = [K1]
        self.assertIsNone(self.cache.get(K2.kid))
        self.fetch.keys = [K1, K2]
        self.t[0] += 301
        self.assertIsNotNone(self.cache.get(K2.kid))

    def test_fetch_failure_keeps_old_keys(self):
        self.cache.get(K1.kid)
        self.fetch.fail = True
        self.t[0] += 700
        self.assertIsNotNone(self.cache.get(K1.kid))      # 수명이 끝났지만 옛 키로 버틴다
        self.assertEqual(self.fetch.calls, 2)
        self.assertIsNotNone(self.cache.get(K1.kid))      # 5분 안에는 다시 시도하지 않는다
        self.assertEqual(self.fetch.calls, 2)

    def test_first_fetch_failure_returns_none_then_recovers(self):
        self.fetch.fail = True
        self.assertIsNone(self.cache.get(K1.kid))
        self.fetch.fail = False
        self.assertIsNone(self.cache.get(K1.kid))         # 5분 제한
        self.t[0] += 301
        self.assertIsNotNone(self.cache.get(K1.kid))

    def test_bad_document_is_a_failure(self):
        self.cache.fetch = lambda: ({"oops": 1}, 600)
        self.assertIsNone(self.cache.get(K1.kid))


if __name__ == "__main__":
    unittest.main()
