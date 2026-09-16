import argparse
import json
import os
import paho.mqtt.publish as publish

def main():
    parser = argparse.ArgumentParser(description="Trigger simulated flood spike on Trishuli sensor nodes")
    parser.add_argument("--node", default="NODE_LANGTANG_01", help="Target node ID (e.g. NODE_LANGTANG_01, NODE_BHOTEKOSHI_02, or ALL)")
    parser.add_argument("--water", type=float, default=145.0, help="Water level surge in cm")
    parser.add_argument("--rain", type=float, default=85.0, help="Rainfall surge in mm")
    parser.add_argument("--soil", type=float, default=45.0, help="Soil moisture surge percentage")
    parser.add_argument("--duration", type=int, default=45, help="Surge duration in seconds")
    parser.add_argument("--broker", default=os.getenv("MQTT_BROKER", "broker.hivemq.com"), help="MQTT broker")
    parser.add_argument("--port", type=int, default=int(os.getenv("MQTT_PORT", 1883)), help="MQTT port")
    args = parser.parse_args()

    payload = {
        "action": "INJECT_SPIKE",
        "node_id": args.node,
        "water_level_surge_cm": args.water,
        "rainfall_surge_mm": args.rain,
        "soil_moisture_surge_pct": args.soil,
        "duration_seconds": args.duration
    }

    topic = "nepal/trishuli/control/spike"
    print(f"🚀 Injecting simulated flood surge...")
    print(f"   Target: {args.node}")
    print(f"   Surge: +{args.water}cm water level, +{args.rain}mm rainfall")
    print(f"   Publishing to: {topic} on {args.broker}:{args.port}")

    publish.single(
        topic=topic,
        payload=json.dumps(payload),
        hostname=args.broker,
        port=args.port
    )
    print("✅ Flood surge command dispatched! Watch the backend & dashboard cascade.")

if __name__ == "__main__":
    main()
