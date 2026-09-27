import argparse
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

# Path to shared river topology
TOPOLOGY_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "shared", "river_topology.json")
)

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

            if progress <= 0.4:
                # Rapid upward surge phase
                ratio = progress / 0.4
                self.curr_water_level = self.base_water_level + (self.spike_target_water - self.base_water_level) * ratio
                self.curr_rainfall = self.base_rainfall + (self.spike_target_rain - self.base_rainfall) * ratio
                self.curr_soil_moisture = self.base_soil_moisture + (self.spike_target_soil - self.base_soil_moisture) * ratio
            elif progress <= 0.7:
                # Peak plateau phase with gentle crest fluctuation
                turbulence = random.uniform(-0.2, 0.4)
                self.curr_water_level = self.spike_target_water + turbulence
                self.curr_rainfall = max(0.0, self.spike_target_rain + random.uniform(-1.5, 1.5))
                self.curr_soil_moisture = self.spike_target_soil
            elif progress <= 1.0:
                # Receding tail phase
                decay = (1.0 - progress) / 0.3
                self.curr_water_level = self.base_water_level + (self.spike_target_water - self.base_water_level) * decay
                self.curr_rainfall = self.base_rainfall + (self.spike_target_rain - self.base_rainfall) * decay
                self.curr_soil_moisture = self.base_soil_moisture + (self.spike_target_soil - self.base_soil_moisture) * decay
            else:
                # Spike ended, return to normal
                self.in_spike = False
                self.curr_water_level = self.base_water_level
                self.curr_rainfall = self.base_rainfall
                self.curr_soil_moisture = self.base_soil_moisture
                print(f"[OK] [SPIKE RECEDED] Station: {self.name} ({self.node_id}) returned to baseline.\n")
        else:
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
        self.client.on_connect = self._on_connect
        self.client.on_message = self._on_message

        self._load_topology()

    def _load_topology(self):
        if not os.path.exists(TOPOLOGY_PATH):
            raise FileNotFoundError(f"Topology JSON not found at: {TOPOLOGY_PATH}")

        with open(TOPOLOGY_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)

        for n in data.get("nodes", []):
            node = SensorNode(n)
            self.nodes[node.node_id] = node

        print(f"[*] Initialized {len(self.nodes)} simulated sensor nodes in Trishuli Watershed:")
        for nid, n in self.nodes.items():
            print(f"   * {nid}: {n.name} (Elev: {n.elevation_m}m, Base Water: {n.base_water_level}cm)")

    def _on_connect(self, client, userdata, flags, rc, properties=None):
        if rc == 0:
            print(f"\n[+] Simulator connected to MQTT Broker ({self.broker}:{self.port})")
            # Subscribe to remote control spike topic
            control_topic = "nepal/trishuli/control/spike"
            client.subscribe(control_topic)
            print(f"[+] Listening for flood spike commands on: {control_topic}")
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
                    topic = f"nepal/trishuli/sensors/{node_id}/telemetry"
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
