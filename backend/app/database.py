from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from .config import settings
from sqlalchemy import inspect, text
import logging

logger = logging.getLogger(__name__)

# Database engine configuration supporting both SQLite and PostgreSQL
engine_kwargs = {}
if settings.DATABASE_URL.startswith("sqlite"):
    engine_kwargs["connect_args"] = {"check_same_thread": False}
else:
    engine_kwargs["pool_pre_ping"] = True
    engine_kwargs["pool_size"] = 10
    engine_kwargs["max_overflow"] = 20

engine = create_engine(settings.DATABASE_URL, **engine_kwargs)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def migrate_schema():
    """Small, idempotent migration for installations created by create_all."""
    Base.metadata.create_all(bind=engine)
    inspector = inspect(engine)
    additions = {
        "alerts": {
            "status": "VARCHAR(20) DEFAULT 'ACTIVE'",
            "acknowledged_at": "DATETIME", "acknowledged_by": "VARCHAR(100)",
            "acknowledgment_note": "TEXT", "resolved_at": "DATETIME",
            "resolved_by": "VARCHAR(100)"
        },
        "sensor_readings": {
            "s_level": "FLOAT", "s_rate": "FLOAT", "s_soil": "FLOAT"
        }
    }
    with engine.begin() as conn:
        for table, columns in additions.items():
            existing = {c["name"] for c in inspector.get_columns(table)}
            for name, definition in columns.items():
                if name not in existing:
                    if engine.dialect.name != "sqlite" and definition == "DATETIME":
                        definition = "TIMESTAMP"
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {definition}"))
        if "status" in {c["name"] for c in inspector.get_columns("alerts")}:
            conn.execute(text("UPDATE alerts SET status='ACTIVE' WHERE status IS NULL"))
        try:
            if engine.dialect.name == "sqlite":
                conn.execute(text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS uq_open_alert_source_settlement "
                    "ON alerts (source_node_id, affected_settlement_id) "
                    "WHERE status IN ('ACTIVE', 'ACKNOWLEDGED')"
                ))
            elif engine.dialect.name == "postgresql":
                conn.execute(text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS uq_open_alert_source_settlement "
                    "ON alerts (source_node_id, affected_settlement_id) "
                    "WHERE status IN ('ACTIVE', 'ACKNOWLEDGED')"
                ))
        except Exception:
            logger.exception(
                "Could not create the open-alert uniqueness index. "
                "Resolve any pre-existing duplicate open pairs before retrying migration."
            )
