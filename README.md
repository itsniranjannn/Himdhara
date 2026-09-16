# Flood/Landslide Early Warning & Alert Routing System
**8th Semester Engineering Final Year Project**  
*Watershed Focus: Trishuli & Bhotekoshi River Basin, Nepal*

[![System Architecture](https://img.shields.io/badge/Architecture-Distributed%20IoT%20Pipeline-blue)](#system-architecture)
[![Algorithm](https://img.shields.io/badge/Core%20Algorithms-EMA%20%2B%20HSI%20%2B%20Dijkstra%20Graph-emerald)](#core-algorithms-built-from-scratch)
[![Test Suite](https://img.shields.io/badge/Tests-100%25%20Passed-brightgreen)](#testing--verification)

---

## 1. Project Overview & Target
This project is an end-to-end distributed early warning and emergency alert routing system designed for high-risk mountain river basins.
During the final project defense / viva presentation, the presenter triggers a simulated cloudburst or flash flood surge on an upstream sensor station; the custom analytical algorithm classifies the risk in real-time, calculates the arrival ETAs for downstream settlements using a directed graph of the river network, and cascades prioritized evacuation alerts to the live operations dashboard within seconds.

---

## 2. System Architecture

```
[Sensor Node Simulators (Python)]
          │ (MQTT JSON Telemetry: water_level_cm, rainfall_mm, soil_moisture_pct)
          ▼
   [MQTT Broker] (HiveMQ Cloud / broker.hivemq.com port 1883)
          │
          ▼ (Topic: nepal/trishuli/sensors/#)
 [FastAPI Ingestion Service]
   ├── Time-Series Data Store (SQLite / SQLAlchemy)
   │
   ├── Module C: [Anomaly Detection Engine (Custom Math)]
   │     ├── Rolling window (12 readings)
   │     ├── Exponential Moving Average (EMA) Baseline
   │     ├── Dynamic Rate of Change (ΔL / Δt)
   │     └── Hydrological Stress Index (HSI) Classification
   │
   ├── Module D: [Alert Propagation Engine (Graph Model)]
   │     ├── Trishuli River Basin Directed Graph G = (V, E, W)
   │     ├── Hydraulic travel-time edge weights W(u, v)
   │     └── Dijkstra shortest path search for settlement arrival ETAs
   │
   └── Module E: [Alert Dispatcher & WebSocket Hub]
          │ (Real-time events: TELEMETRY_UPDATE, NEW_ALERTS)
          ▼
 [React + Leaflet GIS Dashboard]
   ├── Interactive Basin Map with color-coded risk pulse markers
   ├── Real-time Chart (Water level vs EMA baseline & thresholds)
   ├── Cascaded Alert Feed with countdown timers & safe zones
   └── One-Click Viva Demo Flood Spike Injection Panel
```

---

## 3. Core Algorithms Built from Scratch (No ML Libraries)

### Algorithm 1: Analytical Anomaly & Hydrological Stress Index (Module C)
Evaluators specifically grade non-black-box mathematical reasoning:
1. **Exponential Moving Average Baseline:**
   $$EMA_t = \alpha \cdot L_t + (1 - \alpha) \cdot EMA_{t-1}, \quad \text{where } \alpha = \frac{2}{N+1}$$
2. **Surge Velocity (Rate of Change):**
   $$\Delta R_t = \frac{L_t - L_{t-1}}{\Delta t} \quad (\text{cm / minute})$$
3. **Hydrological Stress Index ($HSI$):**
   Fuses baseline deviation, surge velocity, and antecedent soil moisture saturation:
   $$HSI_t = w_{dev} \cdot \frac{L_t - EMA_t}{\sigma_L} + w_{rate} \cdot \max(0, \Delta R_t) + w_{soil} \cdot \left(\frac{SM_t - SM_{thresh}}{100 - SM_{thresh}}\right)$$
4. **Classification Thresholds:**
   - `NORMAL`: Baseline fluctuations ($HSI < 1.2$, $L_t < L_{watch}$)
   - `WATCH`: Mild runoff / high soil saturation ($HSI \ge 1.2$ or $L_t \ge L_{watch}$)
   - `WARNING`: Accelerating surge ($HSI \ge 2.0$ or $L_t \ge L_{warning}$)
   - `CRITICAL`: Immediate flash-flood threat ($HSI \ge 3.0$ or $L_t \ge L_{critical}$)

### Algorithm 2: Dijkstra Travel-Time Flood Routing (Module D)
- Watershed is modeled as a Directed Weighted Graph $G = (V, E, W)$.
- Vertices $V$ include 6 Sensor Stations and 5 Inhabited Settlements (Dhunche, Syaprubesi, Betrawati, Trishuli Bazaar, Galchi).
- Edges $E$ represent hydrological flow with weights $W(u, v) = \text{travel\_time\_minutes}$.
- When an upstream node crosses `WARNING` or `CRITICAL`, Dijkstra's shortest path search runs with a priority queue (`heapq`) to compute cumulative wave arrival times:
  $$ETA(v) = \text{Current Time} + \text{dist}_G(u, v)$$
- Outputs an ETA-sorted, prioritized alert cascade with evacuation points and population at risk.

---

## 4. Folder Structure

```
8thsemproj/
├── shared/
│   └── river_topology.json      # Geo-coordinates, elevations, reach travel times
├── sensor-sim/
│   ├── simulator.py             # Multi-node MQTT simulator with live spike mode
│   └── trigger_spike.py         # CLI flood surge injection tool
├── backend/
│   ├── app/
│   │   ├── config.py            # Environment settings & parameters
│   │   ├── database.py          # SQLite database connection & session
│   │   ├── models.py            # SQLAlchemy models (readings, nodes, alerts)
│   │   ├── schemas.py           # Pydantic schemas
│   │   ├── anomaly_engine.py    # Module C: Pure math rolling window & HSI scoring
│   │   ├── graph_engine.py      # Module D: Graph network & Dijkstra ETA routing
│   │   ├── dispatcher.py        # Module E: WebSocket broadcast & notification sim
│   │   ├── seed_data.py         # River network topology seeder
│   │   └── main.py              # FastAPI app & MQTT runner
│   ├── tests/
│   │   ├── test_anomaly.py      # Unit tests for Module C
│   │   ├── test_graph.py        # Unit tests for Module D
│   │   └── test_e2e_pipeline.py # End-to-end integration test
│   └── run.py                   # Backend entry runner
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Header.jsx       # Status & WebSocket indicator
│   │   │   ├── RiverMap.jsx     # Leaflet map with colored risk markers
│   │   │   ├── TelemetryChart.jsx # Water level vs EMA envelope chart
│   │   │   ├── AlertFeed.jsx    # ETA-ranked cascaded alerts
│   │   │   ├── SpikeControl.jsx # Viva demo injection control bar
│   │   │   └── RawDataTable.jsx # Sensor telemetry & algorithm audit table
│   │   ├── hooks/useWebSocket.js
│   │   ├── services/api.js
│   │   └── App.jsx
│   └── index.html
├── start_all.ps1                # 1-click launcher for all 3 services
└── README.md
```

---

## 5. Quick Start & Execution Guide

### Prerequisite
Python 3.10+ and Node.js v18+

### Launching All Services (1-Click)
Open PowerShell in the project directory:
```powershell
.\start_all.ps1
```

Or launch individually:

#### Terminal 1: Backend API & Ingestion
```powershell
python backend/run.py
```
*API docs available at `http://localhost:8000/docs`*

#### Terminal 2: Sensor Simulator
```powershell
python sensor-sim/simulator.py
```

#### Terminal 3: React Dashboard
```powershell
cd frontend
npm run dev
```
*Open `http://localhost:5173/` or `http://localhost:5174/` in your browser.*

---

## 6. How to Conduct the Viva / Defense Demonstration
1. Open the dashboard in your browser.
2. Show the evaluators the **Trishuli Basin GIS Map**: all 6 stations are green (`NORMAL`), telemetry streams steadily every 5 seconds.
3. Show the **Live Telemetry Chart**: explain the **EMA baseline envelope** and physical thresholds.
4. **Trigger the Spike:**
   - In the **Viva Demo: Flood Spike Injection** panel at the top, select `Langtang Glacier Catchment (NODE_LANGTANG_01)` and click **"INJECT FLOOD SPIKE"**.
5. **Watch the live cascade within seconds:**
   - Water level on `NODE_LANGTANG_01` surges from 45cm to 195cm.
   - Rate of change exceeds 25 cm/min; HSI jumps to > 3.2.
   - Node beacon turns glowing red (`CRITICAL`).
   - Alert feed immediately cascades downstream settlements in ETA order:
     1. **Dhunche Town** (ETA: 18 min) - 12,000 pop
     2. **Syaprubesi Bazaar** (ETA: 30 min) - 4,500 pop
     3. **Betrawati Market** (ETA: 71 min) - 8,500 pop
     4. **Trishuli Bazaar** (ETA: 88 min) - 26,000 pop
     5. **Galchi Highway Junction** (ETA: 117 min) - 15,000 pop
6. Explain to evaluators how Dijkstra's shortest path algorithm routed the travel times and how Module C avoided ML black-boxes by applying analytical hydro-statistics.

---

## 7. Running Unit & Integration Tests
```powershell
# Run Unit Tests (Module C & Module D)
python -m pytest backend/tests -v

# Run End-to-End Pipeline Integration Test
python backend/tests/test_e2e_pipeline.py
```
