"""시험용 RSA 키(2048비트) 두 개를 표준 라이브러리만으로 만들어 fixtures/test_keys.json에 쓴다.

    python server/tests/gen_test_keys.py

한 번 만들어 커밋한 파일을 테스트가 읽는다. 시험 전용 키이므로 비밀이 아니다.
개인키 값 d는 서명 도구(support의 sign_rs256)가 쓴다.
"""
import base64
import json
import os
import secrets

SMALL_PRIMES = [p for p in range(3, 2000, 2) if all(p % q for q in range(3, int(p ** 0.5) + 1, 2))]


def is_probable_prime(n, rounds=40):
    if n < 2:
        return False
    for p in SMALL_PRIMES:
        if n % p == 0:
            return n == p
    d, r = n - 1, 0
    while d % 2 == 0:
        d //= 2
        r += 1
    for _ in range(rounds):
        a = secrets.randbelow(n - 3) + 2
        x = pow(a, d, n)
        if x in (1, n - 1):
            continue
        for _ in range(r - 1):
            x = x * x % n
            if x == n - 1:
                break
        else:
            return False
    return True


def gen_prime(bits):
    while True:
        c = secrets.randbits(bits) | (1 << (bits - 1)) | (1 << (bits - 2)) | 1
        if is_probable_prime(c):
            return c


def gen_rsa(bits=2048, e=65537):
    while True:
        p, q = gen_prime(bits // 2), gen_prime(bits // 2)
        if p == q:
            continue
        n = p * q
        phi = (p - 1) * (q - 1)
        if n.bit_length() != bits or phi % e == 0:
            continue
        return n, e, pow(e, -1, phi)


def b64u(i):
    b = i.to_bytes((i.bit_length() + 7) // 8, "big")
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def main():
    keys = []
    for kid in ("test-key-1", "test-key-2"):
        n, e, d = gen_rsa()
        keys.append({"kid": kid, "kty": "RSA", "alg": "RS256", "use": "sig",
                     "n": b64u(n), "e": b64u(e), "d": b64u(d)})
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "test_keys.json")
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        json.dump({"keys": keys}, f, indent=1)
        f.write("\n")
    print("wrote", out)


if __name__ == "__main__":
    main()
