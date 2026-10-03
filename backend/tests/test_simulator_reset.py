import importlib.util
import json
from pathlib import Path


def _load_simulator():
    path = Path(__file__).parents[2] / "sensor-sim" / "simulator.py"
    spec = importlib.util.spec_from_file_location("sensor_simulator", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_reset_command_returns_simulator_nodes_to_baseline():
    simulator = _load_simulator()
    config = {
        "node_id": "RESET-NODE",
        "name": "Reset Station",
        "lat": 27.7,
        "lng": 85.3,
        "elevation_m": 1000,
        "baseline": {
            "rainfall_mm": 2,
            "water_level_cm": 50,
            "soil_moisture_pct": 40,
        },
    }
    node = simulator.SensorNode(config)
    node.curr_water_level = 190
    node.curr_rainfall = 80
    node.curr_soil_moisture = 90
    node.in_spike = True
    node.in_recession = True

    network = object.__new__(simulator.RiverNetworkSimulator)
    network.nodes = {node.node_id: node}
    network._on_message(None, None, type("Message", (), {
        "payload": json.dumps({"action": "RESET_SIMULATION"}).encode()
    })())

    assert node.curr_water_level == node.base_water_level
    assert node.curr_rainfall == node.base_rainfall
    assert node.curr_soil_moisture == node.base_soil_moisture
    assert not node.in_spike
    assert not node.in_recession
