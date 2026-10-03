import asyncio
import json
import logging
from typing import Set, Dict, Any
from fastapi import WebSocket

logger = logging.getLogger("AlertDispatcher")
logger.setLevel(logging.INFO)
from .notifier import notifier

class AlertDispatcher:
    """
    Module E: Alert Dispatcher & Real-Time Broadcast Hub
    ----------------------------------------------------
    Manages active WebSocket connections for the live operations dashboard
    and routes multi-channel emergency alert notifications (SMS/Email simulations).
    """

    def __init__(self):
        self.active_connections: Set[WebSocket] = set()

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.add(websocket)
        logger.info(f"Dashboard client connected. Active connections: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        self.active_connections.discard(websocket)
        logger.info(f"Dashboard client disconnected. Active connections: {len(self.active_connections)}")

    async def broadcast(self, message: Dict[str, Any]):
        """Broadcasts a JSON packet to all connected dashboard clients."""
        if not self.active_connections:
            return

        payload = json.dumps(message, default=str)
        dead_connections = set()

        for conn in self.active_connections:
            try:
                await conn.send_text(payload)
            except Exception as ex:
                dead_connections.add(conn)

        for dead in dead_connections:
            self.active_connections.discard(dead)

    async def dispatch_telemetry(self, telemetry_data: Dict[str, Any]):
        """Pushes live sensor reading and calculated metrics to the dashboard."""
        await self.broadcast({
            "type": "TELEMETRY_UPDATE",
            "data": telemetry_data
        })

    async def dispatch_alerts(self, alerts: list):
        """Pushes cascaded downstream emergency alerts to dashboard and simulates SMS/Email dispatch."""
        if not alerts:
            return

        # 1. Real-time WebSocket Push to Dashboard
        await self.broadcast({
            "type": "NEW_ALERTS",
            "data": alerts
        })

        # 2. Simulated Emergency Broadcast (Console & Log simulation)
        for alert in alerts:
            print("\n" + "=" * 70)
            print(f"[EMERGENCY ALERT ROUTED] -> {alert['affected_settlement_name'].upper()}")
            print(f"   Origin: {alert['source_node_name']} ({alert['source_node_id']})")
            print(f"   Severity: {alert['risk_level']} | Wave Arrival ETA: {alert['eta_minutes']} min")
            print(f"   Evacuation Point: {alert['evacuation_zone']}")
            print(f"   Population at Risk: {alert['population_at_risk']:,}")
            print(f"   Simulated SMS Sent: 'FLOOD ALERT: Evacuate riverbanks toward {alert['evacuation_zone']}. ETA {alert['eta_minutes']}m.'")
            message = f"FLOOD ALERT: Evacuate riverbanks toward {alert['evacuation_zone']}. ETA {alert['eta_minutes']}m."
            notifier.send_sms(alert["affected_settlement_id"], message)
            notifier.send_email(alert["affected_settlement_id"], f"{alert['risk_level']} flood alert", message)
            print("=" * 70 + "\n")

    async def dispatch_resolved(self, source_node_id: str):
        """Broadcasts alert resolution to dashboard when river levels normalize."""
        await self.broadcast({
            "type": "ALERTS_RESOLVED",
            "source_node_id": source_node_id
        })

dispatcher = AlertDispatcher()
