import asyncio
import json
import logging
from datetime import datetime, timezone
import paho.mqtt.client as mqtt
from .config import settings
from .database import SessionLocal
from .models import SensorReadingModel, NodeModel, AlertModel
from .anomaly_engine import anomaly_engine
from .graph_engine import graph_engine
from .dispatcher import dispatcher

logger = logging.getLogger("MQTT_Ingestion")
logger.setLevel(logging.INFO)

class MQTTIngestionService:
    """
    Module B: MQTT Ingestion Service
    ---------------------------------
    Subscribes to sensor telemetry topics, processes payloads, invokes
    Module C (Anomaly Detection) and Module D (Graph Propagation),
    persists time-series records to the database, and broadcasts updates.
    """

    def __init__(self):
        self.client: mqtt.Client = None
        self.loop: asyncio.AbstractEventLoop = None

    def start(self, loop: asyncio.AbstractEventLoop):
        self.loop = loop
        
        # Paho MQTT v2 protocol setup
        client_id = f"{settings.MQTT_CLIENT_ID}_{int(datetime.now().timestamp())}"
        self.client = mqtt.Client(
            callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
            client_id=client_id
        )
        self.client.on_connect = self._on_connect
        self.client.on_message = self._on_message
        self.client.on_disconnect = self._on_disconnect

        logger.info(f"Connecting to MQTT Broker at {settings.MQTT_BROKER}:{settings.MQTT_PORT}...")
        try:
            self.client.connect(settings.MQTT_BROKER, settings.MQTT_PORT, keepalive=60)
            self.client.loop_start()
        except Exception as e:
            logger.error(f"Failed to connect to MQTT broker: {e}")

    def stop(self):
        if self.client:
            self.client.loop_stop()
            self.client.disconnect()
            logger.info("MQTT Ingestion Service stopped.")

    def _on_connect(self, client, userdata, flags, rc, properties=None):
        if rc == 0:
            logger.info(f"Connected to MQTT Broker! Subscribing to: {settings.MQTT_TOPIC_TELEMETRY}")
            client.subscribe(settings.MQTT_TOPIC_TELEMETRY)
        else:
            logger.error(f"MQTT connection failed with code {rc}")

    def _on_disconnect(self, client, userdata, disconnect_flags, rc, properties=None):
        logger.warning(f"Disconnected from MQTT broker (rc={rc}). Auto-reconnecting...")

    def _on_message(self, client, userdata, msg):
        """Processes incoming sensor telemetry payload."""
        try:
            payload_str = msg.payload.decode("utf-8")
            data = json.loads(payload_str)
            
            # Asynchronously dispatch to processing coroutine
            if self.loop and self.loop.is_running():
                asyncio.run_coroutine_threadsafe(self._process_reading(data), self.loop)
        except Exception as e:
            logger.error(f"Error handling MQTT message on {msg.topic}: {e}")

    async def _process_reading(self, data: dict):
        """
        End-to-End Ingestion Pipeline:
        1. Parse & Validate
        2. Module C: Anomaly & Risk Detection
        3. Module D: Graph Alert Propagation (if WARNING or CRITICAL)
        4. Persist to SQLite Database
        5. Module E: Real-Time WebSocket Broadcast
        """
        node_id = data.get("node_id")
        if not node_id:
            return

        water_level = float(data.get("water_level_cm", 0.0))
        rainfall = float(data.get("rainfall_mm", 0.0))
        soil_moisture = float(data.get("soil_moisture_pct", 0.0))
        
        # Parse timestamp if available
        raw_ts = data.get("timestamp")
        if raw_ts:
            try:
                ts = datetime.fromisoformat(raw_ts.replace("Z", "+00:00"))
            except Exception:
                ts = datetime.now(timezone.utc)
        else:
            ts = datetime.now(timezone.utc)

        # --- Module C: Run Custom Anomaly & Risk Engine ---
        analysis = anomaly_engine.process_reading(
            node_id=node_id,
            water_level_cm=water_level,
            rainfall_mm=rainfall,
            soil_moisture_pct=soil_moisture,
            timestamp=ts
        )

        risk_level = analysis["risk_level"]
        alerts = []

        # --- Module D: Run Graph Alert Propagation Engine if threshold crossed ---
        if risk_level in ("WARNING", "CRITICAL"):
            alerts = graph_engine.propagate_alert(
                trigger_node_id=node_id,
                trigger_risk_level=risk_level
            )

        # --- Database Persistence ---
        db = SessionLocal()
        try:
            # 1. Store time-series reading
            reading_rec = SensorReadingModel(
                node_id=node_id,
                rainfall_mm=rainfall,
                water_level_cm=water_level,
                soil_moisture_pct=soil_moisture,
                timestamp=ts,
                ema_water_level=analysis["ema_water_level"],
                rate_of_change_cm_min=analysis["rate_of_change_cm_min"],
                hsi_score=analysis["hsi_score"],
                risk_level=risk_level
            )
            db.add(reading_rec)

            # 2. Update Node state
            node_rec = db.query(NodeModel).filter(NodeModel.node_id == node_id).first()
            if node_rec:
                node_rec.current_risk = risk_level
                node_rec.last_updated = ts

            # 3. Store new alerts if any
            for alt in alerts:
                # Check for recent active alert on this settlement to prevent spamming duplicates
                existing_alert = (
                    db.query(AlertModel)
                    .filter(
                        AlertModel.source_node_id == node_id,
                        AlertModel.affected_settlement_id == alt["affected_settlement_id"],
                        AlertModel.acknowledged == False
                    )
                    .order_by(AlertModel.created_at.desc())
                    .first()
                )
                if not existing_alert:
                    new_alert_rec = AlertModel(
                        alert_id=alt["alert_id"],
                        source_node_id=alt["source_node_id"],
                        source_node_name=alt["source_node_name"],
                        affected_settlement_id=alt["affected_settlement_id"],
                        affected_settlement_name=alt["affected_settlement_name"],
                        eta_minutes=alt["eta_minutes"],
                        risk_level=alt["risk_level"],
                        evacuation_zone=alt.get("evacuation_zone"),
                        population_at_risk=alt.get("population_at_risk", 0),
                        created_at=ts
                    )
                    db.add(new_alert_rec)

            db.commit()
        except Exception as ex:
            db.rollback()
            logger.error(f"DB insertion error: {ex}")
        finally:
            db.close()

        # --- Module E: Real-time Dispatch ---
        # 1. Telemetry & computed metrics
        await dispatcher.dispatch_telemetry(analysis)
        
        # 2. Downstream alerts
        if alerts:
            await dispatcher.dispatch_alerts(alerts)

mqtt_service = MQTTIngestionService()
