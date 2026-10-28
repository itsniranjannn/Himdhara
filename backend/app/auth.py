"""Dependency-light JWT and password helpers.

Reads are public (the bulletin and dashboard are read-only without sign-in).
Anything that changes state requires a signed-in operator.
"""
import base64, hashlib, hmac, json, secrets, time
from collections import defaultdict, deque
from fastapi import Depends, HTTPException, Request
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from .config import settings
from .database import get_db
from .models import UserModel

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)
_ITERATIONS = 200_000


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    return f"{salt}${hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), _ITERATIONS).hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        salt, digest = stored.split("$", 1)
        # Hashes created by earlier versions used 120k iterations.
        for rounds in (_ITERATIONS, 120_000):
            actual = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), rounds).hex()
            if hmac.compare_digest(actual, digest):
                return True
        return False
    except ValueError:
        return False


def _b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode()


def _sign(message: str) -> str:
    return _b64(hmac.new(settings.JWT_SECRET.encode(), message.encode(), hashlib.sha256).digest())


def create_token(user: UserModel) -> str:
    header = _b64(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    payload = _b64(json.dumps({"sub": user.username, "role": user.role, "exp": int(time.time()) + settings.JWT_EXPIRE_MINUTES * 60}, separators=(",", ":")).encode())
    return f"{header}.{payload}.{_sign(f'{header}.{payload}')}"


def decode_token(token: str) -> dict:
    header, payload, signature = token.split(".")
    if not hmac.compare_digest(signature, _sign(f"{header}.{payload}")):
        raise ValueError("bad signature")
    data = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    if data["exp"] < time.time():
        raise ValueError("expired")
    return data


def optional_user(token: str | None = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> UserModel | None:
    """Return the signed-in user, or None for anonymous (read-only) visitors."""
    if not token:
        return None
    try:
        user = db.query(UserModel).filter(UserModel.username == decode_token(token)["sub"]).first()
        if not user:
            raise ValueError("unknown user")
        return user
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token", headers={"WWW-Authenticate": "Bearer"})


def current_user(user: UserModel | None = Depends(optional_user)) -> UserModel:
    if not user:
        raise HTTPException(status_code=401, detail="Sign in required", headers={"WWW-Authenticate": "Bearer"})
    return user


def require_operator(user: UserModel = Depends(current_user)) -> UserModel:
    if user.role != "operator":
        raise HTTPException(status_code=403, detail="Operator role required")
    return user


class RateLimiter:
    """Small in-memory sliding-window limiter (per process)."""

    def __init__(self, limit: int, window_seconds: int):
        self.limit, self.window = limit, window_seconds
        self.hits: dict[str, deque] = defaultdict(deque)

    def check(self, key: str) -> None:
        now = time.time()
        bucket = self.hits[key]
        while bucket and bucket[0] < now - self.window:
            bucket.popleft()
        if len(bucket) >= self.limit:
            raise HTTPException(status_code=429, detail="Too many attempts. Please wait and try again.")
        bucket.append(now)

    def reset(self) -> None:
        self.hits.clear()


login_limiter = RateLimiter(limit=8, window_seconds=60)
subscribe_limiter = RateLimiter(limit=5, window_seconds=600)


def client_key(request: Request) -> str:
    return request.client.host if request.client else "unknown"
