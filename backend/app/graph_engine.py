import heapq
import json
import os
from datetime import datetime, timezone
from typing import Dict, List, Any, Optional

class GraphAlertPropagationEngine:
    """
    Module D: River & Watershed Graph Propagation Engine
    -----------------------------------------------------
    Models river reaches, mountain ravines, and settlements as a Directed
    Weighted Graph G = (V, E, W):
      - V: Set of vertices containing Sensor Nodes and Inhabited Settlements.
      - E: Directed edges (u -> v) indicating downstream hydrological flow.
      - W: Edge weights w(u, v) representing flood wave travel time in minutes.

    Core Algorithm:
      Custom Dijkstra Shortest Path Search on Flood Wave Travel Times.
      Computes cumulative arrival ETAs from any upstream sensor station
      to all reachable downstream settlements.
    """

    def __init__(self, topology_path: Optional[str] = None):
        # Adjacency list: {node_id: [(neighbor_id, travel_time_min, edge_type)]}
        self.adj: Dict[str, List[Dict[str, Any]]] = {}
        # Node metadata map (names, types, coordinates, population, etc.)
        self.nodes_info: Dict[str, Dict[str, Any]] = {}
        self.settlements_info: Dict[str, Dict[str, Any]] = {}

        if topology_path:
            if os.path.isdir(topology_path):
                self.load_basins(topology_path)
            elif os.path.exists(topology_path):
                self.load_topology(topology_path)

    def load_basins(self, directory: str):
        """Loads every basin file in a directory into one graph (basins are disjoint components)."""
        from .topology import load_basins, merged
        self.load_data(merged(load_basins(directory)))

    def load_topology(self, filepath: str):
        """Loads river graph topology from a single JSON file with `nodes` and `settlements`."""
        with open(filepath, "r", encoding="utf-8") as f:
            self.load_data(json.load(f))

    def load_data(self, data: Dict[str, Any]):
        self.adj.clear()
        self.nodes_info.clear()
        self.settlements_info.clear()

        # Index settlements
        for s in data.get("settlements", []):
            sid = s["settlement_id"]
            self.settlements_info[sid] = s
            if sid not in self.adj:
                self.adj[sid] = []

        # Index sensor nodes and directed edges
        for node in data.get("nodes", []):
            nid = node["node_id"]
            self.nodes_info[nid] = node
            if nid not in self.adj:
                self.adj[nid] = []

            for target in node.get("downstream_targets", []):
                self.adj[nid].append({
                    "target_id": target["target_id"],
                    "travel_time_min": float(target["travel_time_min"]),
                    "type": target.get("type", "reach")
                })

    def propagate_alert(self, trigger_node_id: str, trigger_risk_level: str) -> List[Dict[str, Any]]:
        """
        Runs Dijkstra's algorithm starting from `trigger_node_id` to discover all
        downstream affected settlements, calculating cumulative flood wave travel time (ETA).
        
        Returns an ordered, prioritized alert list ranked by earliest arrival time.
        """
        if trigger_risk_level not in ("WARNING", "CRITICAL"):
            return []

        if trigger_node_id not in self.adj:
            return []

        # Dijkstra priority queue: (cumulative_travel_time, current_node_id, path)
        pq: List[tuple] = [(0.0, trigger_node_id, [trigger_node_id])]
        # Shortest travel time to each reachable node
        shortest_eta: Dict[str, float] = {trigger_node_id: 0.0}
        source_name = self.nodes_info.get(trigger_node_id, {}).get("name", trigger_node_id)

        affected_settlements: List[Dict[str, Any]] = []

        while pq:
            curr_eta, curr_id, path = heapq.heappop(pq)

            if curr_eta > shortest_eta.get(curr_id, float("inf")):
                continue

            # Check if this node is an inhabited settlement
            if curr_id in self.settlements_info:
                settle = self.settlements_info[curr_id]
                
                # Dynamic severity attenuation: settlements closer in time have higher urgency
                settlement_risk = trigger_risk_level
                if curr_eta > 45.0 and trigger_risk_level == "WARNING":
                    settlement_risk = "WATCH"

                alert_id = f"ALT-{trigger_node_id}-{curr_id}"
                
                affected_settlements.append({
                    "alert_id": alert_id,
                    "source_node_id": trigger_node_id,
                    "source_node_name": source_name,
                    "basin_id": self.nodes_info.get(trigger_node_id, {}).get("basin_id", "trishuli"),
                    "affected_settlement_id": curr_id,
                    "affected_settlement_name": settle.get("name", curr_id),
                    "eta_minutes": round(curr_eta, 1),
                    "risk_level": settlement_risk,
                    "evacuation_zone": settle.get("evacuation_zone", "Designated Highland Safe Ground"),
                    "population_at_risk": settle.get("population", 0),
                    "propagation_path": path,
                    "created_at": datetime.now(timezone.utc).isoformat()
                })

            # Traverse downstream edges
            for edge in self.adj.get(curr_id, []):
                next_id = edge["target_id"]
                weight = edge["travel_time_min"]
                next_eta = curr_eta + weight

                if next_eta < shortest_eta.get(next_id, float("inf")):
                    shortest_eta[next_id] = next_eta
                    heapq.heappush(pq, (next_eta, next_id, path + [next_id]))

        # Sort settlements primarily by arrival ETA (soonest affected settlement has highest priority)
        affected_settlements.sort(key=lambda x: x["eta_minutes"])
        return affected_settlements

# All basins under shared/basins/
from .topology import BASINS_DIR  # noqa: E402
graph_engine = GraphAlertPropagationEngine(BASINS_DIR)
