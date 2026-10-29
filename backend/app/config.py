import logging
import os
import secrets
from pydantic import BaseModel
from dotenv import load_dotenv

# Automatically load .env from backend/ or project root
_curr_dir = os.path.dirname(os.path.abspath(__file__))
load_dotenv(dotenv_path=os.path.join(_curr_dir, "..", ".env"))
load_dotenv(dotenv_path=os.path.join(_curr_dir, "..", "..", ".env"))
load_dotenv()

_log = logging.getLogger("config")


def _resolve_database_url(url: str) -> str:
    """Anchor a relative SQLite path to the project root so the DB always lives inside the project folder."""
    prefix = "sqlite:///./"
    if url.startswith(prefix):
        root = os.path.abspath(os.path.join(_curr_dir, "..", ".."))
        return "sqlite:///" + os.path.join(root, url[len(prefix):]).replace("\\", "/")
    return url


def _jwt_secret() -> str:
    value = os.getenv("JWT_SECRET", "")
    if value and value != "change-me-in-production":
        return value
    # An unset secret must never fall back to a publicly known string.
    # A random per-process secret is safe, but invalidates sessions on restart.
    _log.warning("JWT_SECRET is not set; using a random per-process secret. Set JWT_SECRET in .env to keep sessions across restarts.")
    return secrets.token_urlsafe(48)


def _csv(name: str, default: str) -> list:
    return [item.strip() for item in os.getenv(name, default).split(",") if item.strip()]


def telemetry_base(topic: str) -> str:
    """'nepal/trishuli/sensors/#' -> 'nepal/trishuli/sensors'."""
    return topic.rstrip("#").rstrip("/")


class Settings(BaseModel):
    PROJECT_NAME: str = "Himdhara: River Early Warning for Nepal"
    VERSION: str = "2.0.0"

    # MQTT Broker Configuration (the public HiveMQ broker is open to everyone:
    # use a private topic prefix and/or broker credentials in .env)
    MQTT_BROKER: str = os.getenv("MQTT_BROKER", "broker.hivemq.com")
    MQTT_PORT: int = int(os.getenv("MQTT_PORT", 1883))
    MQTT_USERNAME: str = os.getenv("MQTT_USERNAME", "")
    MQTT_PASSWORD: str = os.getenv("MQTT_PASSWORD", "")
    MQTT_TOPIC_TELEMETRY: str = os.getenv("MQTT_TOPIC_TELEMETRY", "nepal/trishuli/sensors/#")
    MQTT_TOPIC_CONTROL: str = os.getenv("MQTT_TOPIC_CONTROL", "nepal/trishuli/control/spike")
    MQTT_CLIENT_ID: str = os.getenv("MQTT_CLIENT_ID", "trishuli_backend_ingestor")

    # Database Configuration (SQLite file-based time series)
    DATABASE_URL: str = _resolve_database_url(os.getenv("DATABASE_URL", "sqlite:///./flood_system.db"))

    # Anomaly Engine Tuning Parameters
    EMA_WINDOW_SIZE: int = 12
    RATE_OF_CHANGE_WEIGHT: float = 0.40
    WATER_DEV_WEIGHT: float = 0.45
    SOIL_MOISTURE_WEIGHT: float = 0.15
    SOIL_MOISTURE_SAT_THRESHOLD: float = 40.0  # % above which soil saturation accelerates runoff

    # Sensor health
    STALE_AFTER_SECONDS: int = int(os.getenv("STALE_AFTER_SECONDS", "60"))

    APP_NAME: str = os.getenv("APP_NAME", "Himdhara")

    # Security
    JWT_SECRET: str = _jwt_secret()
    JWT_EXPIRE_MINUTES: int = int(os.getenv("JWT_EXPIRE_MINUTES", "480"))
    DEFAULT_OPERATOR_USERNAME: str = os.getenv("DEFAULT_OPERATOR_USERNAME", "operator")
    DEFAULT_OPERATOR_PASSWORD: str = os.getenv("DEFAULT_OPERATOR_PASSWORD", "")
    ALLOWED_ORIGINS: list = _csv("ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5180,http://127.0.0.1:5180")
    DEMO_CONTROLS_ENABLED: bool = os.getenv("DEMO_CONTROLS_ENABLED", "true").lower() == "true"

    # Alerts go out by email only (free): 'simulated' logs without sending, 'smtp' sends through any SMTP server.
    EMAIL_PROVIDER: str = os.getenv("EMAIL_PROVIDER", "simulated")
    SMTP_HOST: str = os.getenv("SMTP_HOST", "")
    SMTP_PORT: int = int(os.getenv("SMTP_PORT", "587"))
    SMTP_USERNAME: str = os.getenv("SMTP_USERNAME", "")
    SMTP_PASSWORD: str = os.getenv("SMTP_PASSWORD", "")
    SMTP_FROM: str = os.getenv("SMTP_FROM", "")
    SMTP_STARTTLS: bool = os.getenv("SMTP_STARTTLS", "true").lower() == "true"


settings = Settings()
