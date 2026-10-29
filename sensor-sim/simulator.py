import argparse
import glob
import json
import os
import random
import sys
import time
from datetime import datetime, timezone
import paho.mqtt.client as mqtt
from dotenv import load_dotenv

# Load .env if present
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", "backend", ".env"))
load_dotenv()

# Topics come from .env so the simulator, backend and demo controls share one private prefix.
TELEMETRY_BASE = os.getenv("MQTT_TOPIC_TELEMETRY", "nepal/trishuli/sensors/#").rstrip("#").rstrip("/")
CONTROL_TOPIC = os.getenv("MQTT_TOPIC_CONTROL", "nepal/trishuli/control/spike")

# Every basin file under shared/basins/ gets simulated stations.
BASINS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "shared", "basins"))

class SensorNode:
    def __init__(self, config: dict):
        self.node_id = config["node_id"]
        self.name = config["name"]
        self.lat = config["lat"]
        self.lng = config["lng"]
        self.elevation_m = config["elevation_m"]
        
        # Baseline hydrological characteristics
        b = config.get("baseline", {})
        self.base_rainfall = float(b.get("rainfall_mm", 2.0))
        self.base_water_level = float(b.get("water_level_cm", 50.0))
        self.base_soil_moisture = float(b.get("soil_moisture_pct", 40.0))
        
        # Current simulated state
        self.curr_water_level = self.base_water_level
        self.curr_rainfall = self.base_rainfall
        self.curr_soil_moisture = self.base_soil_moisture

        # Spike simulation state
        self.in_spike = False
        self.in_recession = False
        self.spike_target_water = 0.0
        self.spike_target_rain = 0.0
        self.spike_target_soil = 0.0
        self.spike_step = 0
        self.spike_total_steps = 8

    def trigger_spike(self, water_surge=140.0, rain_surge=75.0, soil_surge=40.0, duration_seconds=45):
        """Initiates a simulated cloudburst/flash-flood surge on this station."""
        print(f"\n[!] [SPIKE TRIGGERED] Station: {self.name} ({self.node_id})")
        print(f"    Surge Parameters: +{water_surge}cm water level, +{rain_surge}mm rainfall, +{soil_surge}% soil moisture\n")
        self.in_spike = True
        self.in_recession = False
        self.spike_target_water = self.base_water_level + water_surge
        self.spike_target_rain = self.base_rainfall + rain_surge
        self.spike_target_soil = min(98.0, self.base_soil_moisture + soil_surge)
        self.spike_step = 0
        self.spike_total_steps = max(4, int(duration_seconds / 5))

    def step(self) -> dict:
        """Simulates one time-step fluctuation."""
        if self.in_spike:
            self.spike_step += 1
            progress = self.spike_step / self.spike_total_steps

            if progress <= 0.35:
                # Rapid upward surge phase
                ratio = progress / 0.35
                self.curr_water_level = self.base_water_level + (self.spike_target_water - self.base_water_level) * ratio
                self.curr_rainfall = self.base_rainfall + (self.spike_target_rain - self.base_rainfall) * ratio
                self.curr_soil_moisture = self.base_soil_moisture + (self.spike_target_soil - self.base_soil_moisture) * ratio
            elif progress <= 1.0:
                # Peak plateau phase with gentle crest fluctuation (sustains critical classification)
                turbulence = random.uniform(-0.2, 0.4)
                self.curr_water_level = self.spike_target_water + turbulence
                self.curr_rainfall = max(0.0, self.spike_target_rain + random.uniform(-1.5, 1.5))
                self.curr_soil_moisture = self.spike_target_soil
            else:
                # Spike crest completed: transition into gradual exponential decay recession
                self.in_spike = False
                self.in_recession = True
                print(f"[*] [SPIKE CREST COMPLETE] Station: {self.name} ({self.node_id}) entering gradual recession limb.\n")

        if self.in_recession:
            excess_water = self.curr_water_level - self.base_water_level
            if excess_water > 1.2:
                # Gradual exponential decay: clamp drop per 5s tick so rate of change stays within roughly -5 to -50 cm/min
                # Rate = drop * 12 cm/min. Drop between 0.8cm and 3.8cm yields rate between -9.6 and -45.6 cm/min.
                decay_drop = max(0.8, min(3.8, excess_water * 0.18))
                self.curr_water_level -= decay_drop
            else:
                self.curr_water_level = self.base_water_level
                self.in_recession = False
                print(f"[OK] [SPIKE RECEDED] Station: {self.name} ({self.node_id}) returned to baseline.\n")

            excess_rain = self.curr_rainfall - self.base_rainfall
            if excess_rain > 0.5:
                self.curr_rainfall -= max(0.5, excess_rain * 0.25)
            else:
                self.curr_rainfall = self.base_rainfall

            excess_soil = self.curr_soil_moisture - self.base_soil_moisture
            if excess_soil > 0.5:
                self.curr_soil_moisture -= max(0.3, excess_soil * 0.10)
            else:
                self.curr_soil_moisture = self.base_soil_moisture

        if not self.in_spike and not self.in_recession:
            # Realistic baseline micro-fluctuation (Brownian walk within bounds)
            self.curr_water_level += random.uniform(-0.8, 0.8)
            self.curr_water_level = max(self.base_water_level * 0.85, min(self.base_water_level * 1.25, self.curr_water_level))

            self.curr_rainfall = max(0.0, self.base_rainfall + random.uniform(-0.5, 0.5))
            self.curr_soil_moisture = max(20.0, min(80.0, self.base_soil_moisture + random.uniform(-0.4, 0.4)))

        return {
            "node_id": self.node_id,
            "name": self.name,
            "rainfall_mm": round(self.curr_rainfall, 2),
            "water_level_cm": round(self.curr_water_level, 2),
            "soil_moisture_pct": round(self.curr_soil_moisture, 2),
            "timestamp": datetime.now(timezone.utc).isoformat()
        }


class RiverNetworkSimulator:
    def __init__(self, broker="broker.hivemq.com", port=1883, interval_sec=5.0):
        self.broker = broker
        self.port = port
        self.interval_sec = interval_sec
        self.nodes: dict[str, SensorNode] = {}
        
        self.client = mqtt.Client(
            callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
            client_id=f"trishuli_sim_{int(time.time())}"
        )
        if os.getenv("MQTT_USERNAME"):
            self.client.username_pw_set(os.getenv("MQTT_USERNAME"), os.getenv("MQTT_PASSWORD", ""))
        self.client.on_connect = self._on_connect
        self.client.on_message = self._on_message

        self._load_topology()

    def _load_topology(self):
        files = sorted(glob.glob(os.path.join(BASINS_DIR, "*.json")))
        if not files:
            raise FileNotFoundError(f"No basin files found in: {BASINS_DIR}")

        for path in files:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            basin_id = data["basin"]["basin_id"]
            for n in data.get("nodes", []):
                node = SensorNode(n)
                node.basin_id = basin_id
                self.nodes[node.node_id] = node

        print(f"[*] Initialized {len(self.nodes)} simulated sensor nodes across {len(files)} basins:")
        for nid, n in self.nodes.items():
            print(f"   * [{n.basin_id}] {nid}: {n.name} (Base Water: {n.base_water_level}cm)")

    def _on_connect(self, client, userdata, flags, rc, properties=None):
        if rc == 0:
            print(f"\n[+] Simulator connected to MQTT Broker ({self.broker}:{self.port})")
            # Subscribe to remote control spike topic
            client.subscribe(CONTROL_TOPIC)
            print(f"[+] Listening for flood spike commands on: {CONTROL_TOPIC}")
        else:
            print(f"[-] Connection failed with code {rc}")

    def _on_message(self, client, userdata, msg):
        try:
            payload = json.loads(msg.payload.decode("utf-8"))
            action = payload.get("action")
            if action == "INJECT_SPIKE":
                node_id = payload.get("node_id")
                w_surge = float(payload.get("water_level_surge_cm", 140.0))
                r_surge = float(payload.get("rainfall_surge_mm", 75.0))
                s_surge = float(payload.get("soil_moisture_surge_pct", 40.0))
                dur = int(payload.get("duration_seconds", 45))

                if node_id in self.nodes:
                    self.nodes[node_id].trigger_spike(w_surge, r_surge, s_surge, dur)
                elif node_id == "ALL":
                    for n in self.nodes.values():
                        n.trigger_spike(w_surge, r_surge, s_surge, dur)
            elif action == "RESET_SIMULATION":
                for node in self.nodes.values():
                    node.curr_water_level = node.base_water_level
                    node.curr_rainfall = node.base_rainfall
                    node.curr_soil_moisture = node.base_soil_moisture
                    node.in_spike = False
                    node.in_recession = False
                print("[OK] [SIMULATION RESET] All stations returned to baseline.")
        except Exception as e:
            print(f"Error parsing control message: {e}")

    def start(self):
        print(f"\nConnecting to broker at {self.broker}:{self.port}...")
        self.client.connect(self.broker, self.port, keepalive=60)
        self.client.loop_start()

        print(f"[>] Telemetry publishing started (Interval: {self.interval_sec}s). Press Ctrl+C to stop.\n")
        try:
            while True:
                for node_id, node in self.nodes.items():
                    reading = node.step()
                    topic = f"{TELEMETRY_BASE}/{node_id}/telemetry"
                    payload_json = json.dumps(reading)
                    self.client.publish(topic, payload_json, qos=0)
                    
                    # Print one-line status
                    spike_badge = " [SURGE ACTIVE]" if node.in_spike else ""
                    print(f"[{datetime.now().strftime('%H:%M:%S')}] {node_id} | Water: {reading['water_level_cm']}cm | Rain: {reading['rainfall_mm']}mm | Soil: {reading['soil_moisture_pct']}%{spike_badge}", flush=True)

                time.sleep(self.interval_sec)
        except KeyboardInterrupt:
            print("\nShutting down simulator...")
        finally:
            self.client.loop_stop()
            self.client.disconnect()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Trishuli River Basin Sensor Network Simulator")
    parser.add_argument("--broker", default=os.getenv("MQTT_BROKER", "broker.hivemq.com"), help="MQTT broker host")
    parser.add_argument("--port", type=int, default=int(os.getenv("MQTT_PORT", 1883)), help="MQTT broker port")
    parser.add_argument("--interval", type=float, default=5.0, help="Publish interval in seconds")
    parser.add_argument("--spike-node", default=None, help="Trigger spike on this node ID immediately on launch")
    args = parser.parse_args()

    sim = RiverNetworkSimulator(broker=args.broker, port=args.port, interval_sec=args.interval)
    
    if args.spike_node and args.spike_node in sim.nodes:
        sim.nodes[args.spike_node].trigger_spike()

    sim.start()
