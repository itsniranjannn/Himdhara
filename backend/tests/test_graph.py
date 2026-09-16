import os
import pytest
from app.graph_engine import GraphAlertPropagationEngine

def test_graph_propagation_from_upstream_node():
    """Verify Dijkstra traversal from Langtang Upper Catchment correctly routes downstream to settlements in ETA order."""
    topology_path = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "..", "shared", "river_topology.json")
    )
    engine = GraphAlertPropagationEngine(topology_path)

    # Trigger critical alert on upper Langtang node
    alerts = engine.propagate_alert("NODE_LANGTANG_01", "CRITICAL")
    assert len(alerts) > 0

    # Ensure alerts are strictly sorted by ETA arrival time
    etas = [a["eta_minutes"] for a in alerts]
    assert etas == sorted(etas), f"ETAs must be monotonically increasing: {etas}"

    # Verify first impacted settlement is Dhunche (travel time 18 min)
    assert alerts[0]["affected_settlement_id"] == "SETTLE_DHUNCHE"
    assert alerts[0]["eta_minutes"] == 18.0

    # Verify downstream settlements are also reached (Syapru, Betrawati, Trishuli)
    settlement_ids = [a["affected_settlement_id"] for a in alerts]
    assert "SETTLE_DHUNCHE" in settlement_ids
    assert "SETTLE_SYAPRU" in settlement_ids
    assert "SETTLE_BETRAWATI" in settlement_ids
    assert "SETTLE_TRISHULI" in settlement_ids

def test_graph_propagation_normal_produces_no_alerts():
    """NORMAL risk should not generate emergency alerts."""
    topology_path = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "..", "shared", "river_topology.json")
    )
    engine = GraphAlertPropagationEngine(topology_path)
    alerts = engine.propagate_alert("NODE_LANGTANG_01", "NORMAL")
    assert len(alerts) == 0
