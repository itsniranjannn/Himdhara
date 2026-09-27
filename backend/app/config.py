import os
from pydantic import BaseModel
from dotenv import load_dotenv

# Automatically load .env from backend/ or project root
_curr_dir = os.path.dirname(os.path.abspath(__file__))
load_dotenv(dotenv_path=os.path.join(_curr_dir, "..", ".env"))
load_dotenv(dotenv_path=os.path.join(_curr_dir, "..", "..", ".env"))
load_dotenv()

class Settings(BaseModel):
    PROJECT_NAME: str = "Flood & Landslide Early Warning System"
    VERSION: str = "1.0.0"
    
    # MQTT Broker Configuration (Defaults to HiveMQ Public Broker)
    MQTT_BROKER: str = os.getenv("MQTT_BROKER", "broker.hivemq.com")
    MQTT_PORT: int = int(os.getenv("MQTT_PORT", 1883))
    MQTT_TOPIC_TELEMETRY: str = os.getenv("MQTT_TOPIC_TELEMETRY", "nepal/trishuli/sensors/#")
    MQTT_TOPIC_CONTROL: str = os.getenv("MQTT_TOPIC_CONTROL", "nepal/trishuli/control/spike")
    MQTT_CLIENT_ID: str = os.getenv("MQTT_CLIENT_ID", "trishuli_backend_ingestor")
    
    # Database Configuration (SQLite file-based time series)
    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite:///./flood_system.db")
    
    # Anomaly Engine Tuning Parameters
    EMA_WINDOW_SIZE: int = 12
    RATE_OF_CHANGE_WEIGHT: float = 0.40
    WATER_DEV_WEIGHT: float = 0.45
    SOIL_MOISTURE_WEIGHT: float = 0.15
    SOIL_MOISTURE_SAT_THRESHOLD: float = 40.0  # % above which soil saturation accelerates runoff

settings = Settings()
