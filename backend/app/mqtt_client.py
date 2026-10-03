import asyncio
import json
import logging
from datetime import datetime, timezone
import paho.mqtt.client as mqtt
from .config import settings
from .database import SessionLocal
from .models import SensorReadingModel, NodeModel, AlertModel, AlertHistoryModel, IncidentModel
from uuid import uuid4
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
        print(f"[+] [MQTT Ingested] {node_id} | Water: {water_level:.1f}cm | Rain: {rainfall:.1f}mm | Soil: {soil_moisture:.1f}% | Risk: {risk_level}", flush=True)
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
                s_level=analysis["s_level"],
                s_rate=analysis["s_rate"],
                s_soil=analysis["s_soil"],
                hsi_score=analysis["hsi_score"],
                risk_level=risk_level
            )
            db.add(reading_rec)

            # 2. Update Node state
            node_rec = db.query(NodeModel).filter(NodeModel.node_id == node_id).first()
            if node_rec:
                node_rec.current_risk = risk_level
                node_rec.last_updated = ts

            # 3. Store or upsert alerts (one active alert per source_node, affected_settlement)
            dispatched_alerts = []
            should_broadcast_resolved = False

            if risk_level in ("WARNING", "CRITICAL"):
                for alt in alerts:
                    settle_id = alt["affected_settlement_id"]
                    # Reuse one open alert for each source/settlement pair.
                    existing_alert = (
                        db.query(AlertModel)
                        .filter(AlertModel.source_node_id == node_id,
                                AlertModel.affected_settlement_id == settle_id,
                                AlertModel.status.in_(["ACTIVE", "ACKNOWLEDGED"]))
                        .first()
                    )

                    if not existing_alert:
                        # New alert incident: insert one active alert
                        new_alert_id = f"ALT-{node_id}-{settle_id}-{int(ts.timestamp())}"
                        new_alert_rec = AlertModel(
                            alert_id=new_alert_id,
                            source_node_id=alt["source_node_id"],
                            source_node_name=alt["source_node_name"],
                            affected_settlement_id=alt["affected_settlement_id"],
                            affected_settlement_name=alt["affected_settlement_name"],
                            eta_minutes=alt["eta_minutes"],
                            risk_level=alt["risk_level"],
                            evacuation_zone=alt.get("evacuation_zone"),
                            population_at_risk=alt.get("population_at_risk", 0),
                            created_at=ts,
                            acknowledged=False, status="ACTIVE"
                        )
                        db.add(new_alert_rec)
                        alt_copy = dict(alt)
                        alt_copy["alert_id"] = new_alert_id
                        dispatched_alerts.append(alt_copy)
                    else:
                        # Refresh the existing row in place; never grow duplicates per cycle.
                        changed = (
                            existing_alert.risk_level != alt["risk_level"]
                            or existing_alert.eta_minutes != alt["eta_minutes"]
                        )
                        existing_alert.risk_level = alt["risk_level"]
                        existing_alert.eta_minutes = alt["eta_minutes"]
                        existing_alert.affected_settlement_name = alt["affected_settlement_name"]
                        existing_alert.evacuation_zone = alt.get("evacuation_zone")
                        existing_alert.population_at_risk = alt.get("population_at_risk", 0)
                        if changed:
                            alt_copy = dict(alt)
                            alt_copy["alert_id"] = existing_alert.alert_id
                            dispatched_alerts.append(alt_copy)
            elif risk_level == "NORMAL":
                # Normal recession closes all open alerts from this source station.
                active_alerts = (
                    db.query(AlertModel)
                    .filter(AlertModel.source_node_id == node_id,
                            AlertModel.status.in_(["ACTIVE", "ACKNOWLEDGED"]))
                    .all()
                )
                if active_alerts:
                    for a in active_alerts:
                        old_status = a.status
                        a.status = "RESOLVED"; a.resolved_at = ts; a.resolved_by = "system-recovery"
                        a.acknowledged = True
                        db.add(AlertHistoryModel(alert_id=a.alert_id, from_status=old_status,
                                                 to_status="RESOLVED", changed_by="system-recovery",
                                                 note="Sensor returned to NORMAL"))
                    should_broadcast_resolved = True

            # Keep one incident open per source station until recovery.
            if risk_level in ("WARNING", "CRITICAL"):
                incident = db.query(IncidentModel).filter(
                    IncidentModel.source_node_id == node_id,
                    IncidentModel.recovered_at.is_(None)).first()
                if not incident:
                    db.add(IncidentModel(incident_id=f"INC-{node_id}-{int(ts.timestamp())}-{uuid4().hex[:6]}",
                                          source_node_id=node_id, peak_risk=risk_level, started_at=ts))
                elif incident.peak_risk == "WARNING" and risk_level == "CRITICAL":
                    incident.peak_risk = "CRITICAL"
            elif risk_level == "NORMAL":
                incident = db.query(IncidentModel).filter(
                    IncidentModel.source_node_id == node_id,
                    IncidentModel.recovered_at.is_(None)).first()
                if incident:
                    incident.recovered_at = ts
                    incident.recovery_note = "Automatic recovery after risk normalized"

            db.commit()
        except Exception as ex:
            db.rollback()
            logger.error(f"DB insertion error: {ex}")
        finally:
            db.close()

        # --- Module E: Real-time Dispatch ---
        # 1. Telemetry & computed metrics
        await dispatcher.dispatch_telemetry(analysis)
        
        # 2. Downstream alerts (only new or escalated alerts)
        if dispatched_alerts:
            await dispatcher.dispatch_alerts(dispatched_alerts)

        # 3. If alerts were auto-resolved when river normalized, notify dashboard
        if should_broadcast_resolved:
            await dispatcher.dispatch_resolved(node_id)

mqtt_service = MQTTIngestionService()
