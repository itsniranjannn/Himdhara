"""Loads river basins from shared/basins/*.json.

Every basin file is self-contained: a `basin` header, its sensor `nodes` and its
`settlements`. Adding a basin to the system means adding one JSON file here.
"""
import glob
import json
import os
from typing import Dict, List

BASINS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "shared", "basins"))
NEPAL_BOUNDS = {"lat": (26.0, 31.0), "lng": (80.0, 89.0)}
REQUIRED_BASIN_KEYS = ("basin_id", "name", "center")


class TopologyError(ValueError):
    """Raised when a basin file is malformed or inconsistent."""


def validate_basins(basins: List[dict]) -> None:
    node_ids: Dict[str, str] = {}
    settlement_ids: Dict[str, str] = {}
    basin_ids = set()
    for basin in basins:
        bid = basin["basin_id"]
        if bid in basin_ids:
            raise TopologyError(f"duplicate basin_id {bid}")
        basin_ids.add(bid)
        for key in REQUIRED_BASIN_KEYS:
            if key not in basin:
                raise TopologyError(f"{bid}: missing basin key '{key}'")
        for node in basin["nodes"]:
            nid = node["node_id"]
            if nid in node_ids:
                raise TopologyError(f"node_id {nid} appears in both {node_ids[nid]} and {bid}")
            node_ids[nid] = bid
        for settlement in basin["settlements"]:
            sid = settlement["settlement_id"]
            if sid in settlement_ids:
                raise TopologyError(f"settlement_id {sid} appears in both {settlement_ids[sid]} and {bid}")
            settlement_ids[sid] = bid
    for basin in basins:
        bid = basin["basin_id"]
        for item in basin["nodes"] + basin["settlements"]:
            label = item.get("node_id") or item["settlement_id"]
            if not (NEPAL_BOUNDS["lat"][0] <= item["lat"] <= NEPAL_BOUNDS["lat"][1] and NEPAL_BOUNDS["lng"][0] <= item["lng"] <= NEPAL_BOUNDS["lng"][1]):
                raise TopologyError(f"{label}: coordinates outside Nepal")
        for node in basin["nodes"]:
            t = node.get("thresholds") or {}
            if not (0 < t.get("water_level_watch", 0) < t.get("water_level_warning", 0) < t.get("water_level_critical", 0)):
                raise TopologyError(f"{node['node_id']}: thresholds must be positive and strictly increasing")
            for edge in node.get("downstream_targets", []):
                if edge["target_id"] not in node_ids and edge["target_id"] not in settlement_ids:
                    raise TopologyError(f"{node['node_id']}: unknown downstream target {edge['target_id']}")
                if float(edge["travel_time_min"]) <= 0:
                    raise TopologyError(f"{node['node_id']}: travel_time_min must be positive")


def load_basins(directory: str = BASINS_DIR) -> List[dict]:
    basins = []
    for path in sorted(glob.glob(os.path.join(directory, "*.json"))):
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        basin = dict(data["basin"])
        basin["nodes"] = [{**node, "basin_id": basin["basin_id"]} for node in data.get("nodes", [])]
        basin["settlements"] = [{**s, "basin_id": basin["basin_id"]} for s in data.get("settlements", [])]
        basins.append(basin)
    validate_basins(basins)
    # Stable display order: explicit `order` first, then alphabetical.
    return sorted(basins, key=lambda b: (b.get("order", 999), b["name"]))


def basin_meta(basin: dict) -> dict:
    """Basin header without the heavy node and settlement lists."""
    return {k: v for k, v in basin.items() if k not in ("nodes", "settlements")}


def merged(basins: List[dict]) -> dict:
    return {
        "nodes": [node for basin in basins for node in basin["nodes"]],
        "settlements": [s for basin in basins for s in basin["settlements"]],
    }
