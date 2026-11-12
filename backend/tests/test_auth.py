import time
import uuid

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa

from conftest import JWT_SECRET, make_token, set_env
from summarizer.core import auth
from summarizer.core.errors import AppError


@pytest.fixture(autouse=True)
def configured(monkeypatch):
    set_env(monkeypatch, SUPABASE_JWT_SECRET=JWT_SECRET)


def bearer(token):
    return f"Bearer {token}"


def test_valid_token_identifies_the_user():
    uid = uuid.uuid4()
    user = auth.current_user(bearer(make_token(uid, extra={"email": "a@b.co"})))
    assert (user.id, user.email) == (str(uid), "a@b.co")


def test_guest_sessions_are_refused_with_a_clear_message():
    with pytest.raises(AppError) as err:
        auth.current_user(bearer(make_token(anonymous=True)))
    assert err.value.status_code == 403
    assert err.value.code == "account_required"


@pytest.mark.parametrize("header", [None, "", "Basic abc", "Bearer", "Bearer    ", "bearer not.a.jwt"])
def test_missing_or_malformed_header_is_rejected(header):
    with pytest.raises(AppError) as err:
        auth.current_user(header)
    assert err.value.status_code == 401


def test_expired_token_is_rejected():
    with pytest.raises(AppError):
        auth.current_user(bearer(make_token(expires_in=-3600)))


def test_wrong_secret_is_rejected():
    with pytest.raises(AppError):
        auth.current_user(bearer(make_token(secret="x" * 40)))


def test_wrong_audience_is_rejected():
    with pytest.raises(AppError):
        auth.current_user(bearer(make_token(audience="somewhere-else")))


def test_anon_key_role_is_rejected():
    # The public "anon" API key is a JWT too, but it identifies nobody.
    with pytest.raises(AppError):
        auth.current_user(bearer(make_token(role="anon")))


def test_service_role_token_is_rejected_as_a_user():
    with pytest.raises(AppError):
        auth.current_user(bearer(make_token(role="service_role")))


def test_subject_must_be_a_uuid():
    with pytest.raises(AppError):
        auth.current_user(bearer(make_token("not-a-uuid")))


def test_unsigned_alg_none_token_is_rejected():
    forged = jwt.encode({"sub": str(uuid.uuid4()), "aud": "authenticated", "role": "authenticated",
                         "exp": int(time.time()) + 600}, key=None, algorithm="none")
    with pytest.raises(AppError):
        auth.current_user(bearer(forged))


def test_token_without_expiry_is_rejected():
    token = jwt.encode({"sub": str(uuid.uuid4()), "aud": "authenticated", "role": "authenticated"},
                       JWT_SECRET, algorithm="HS256")
    with pytest.raises(AppError):
        auth.current_user(bearer(token))


def test_hs256_is_refused_when_no_secret_is_configured(monkeypatch):
    monkeypatch.delenv("SUPABASE_JWT_SECRET")
    set_env(monkeypatch)
    with pytest.raises(AppError):
        auth.current_user(bearer(make_token()))


def test_issuer_is_checked_when_the_project_url_is_known(monkeypatch):
    set_env(monkeypatch, SUPABASE_URL="https://abc.supabase.co")
    good = make_token(extra={"iss": "https://abc.supabase.co/auth/v1"})
    assert auth.current_user(bearer(good)).id
    with pytest.raises(AppError):
        auth.current_user(bearer(make_token(extra={"iss": "https://evil.example/auth/v1"})))


class FakeJWKS:
    """Stands in for the project's published signing keys."""
    def __init__(self, public_key):
        self.public_key = public_key

    def get_signing_key_from_jwt(self, token):
        class Key:
            key = self.public_key
        return Key()


@pytest.mark.parametrize("algorithm,private", [
    ("RS256", lambda: rsa.generate_private_key(public_exponent=65537, key_size=2048)),
    ("ES256", lambda: ec.generate_private_key(ec.SECP256R1())),
])
def test_asymmetric_tokens_verify_against_published_keys(monkeypatch, algorithm, private):
    set_env(monkeypatch, SUPABASE_URL="https://abc.supabase.co")
    key = private()
    monkeypatch.setattr(auth, "_jwks", lambda: FakeJWKS(key.public_key()))
    pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                            serialization.NoEncryption())
    token = make_token(secret=pem, algorithm=algorithm, extra={"iss": "https://abc.supabase.co/auth/v1"})
    assert auth.current_user(bearer(token)).id


def test_asymmetric_token_signed_by_another_key_is_rejected(monkeypatch):
    set_env(monkeypatch, SUPABASE_URL="https://abc.supabase.co")
    real = ec.generate_private_key(ec.SECP256R1())
    attacker = ec.generate_private_key(ec.SECP256R1())
    monkeypatch.setattr(auth, "_jwks", lambda: FakeJWKS(real.public_key()))
    pem = attacker.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                 serialization.NoEncryption())
    token = make_token(secret=pem, algorithm="ES256", extra={"iss": "https://abc.supabase.co/auth/v1"})
    with pytest.raises(AppError):
        auth.current_user(bearer(token))


def test_asymmetric_tokens_are_refused_without_a_project_url():
    key = ec.generate_private_key(ec.SECP256R1())
    pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                            serialization.NoEncryption())
    with pytest.raises(AppError):
        auth.current_user(bearer(make_token(secret=pem, algorithm="ES256")))
