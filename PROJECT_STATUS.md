# Project Milestone & Current Status Log
**Project:** Flood/Landslide Early Warning & Alert Routing System (Trishuli River Basin)  
**Last Updated:** September 16, 2026  
**Repository:** `https://github.com/itsniranjannn/8thsem-project.git`

---

## 1. Executive Summary
An end-to-end distributed early warning system with real-time IoT sensor simulation, non-blackbox analytical anomaly detection (EMA + Rate of change + Hydrological Stress Index), Dijkstra graph-based alert propagation routing for downstream settlements, and a live React-Leaflet GIS emergency operations dashboard.
Connected to **Supabase PostgreSQL** cloud database and streaming live telemetry over **HiveMQ MQTT**.

---

## 2. Recent Updates & Fixes (September 27, 2026)
1. **Map Basemap Keyless Fix ([RiverMap.jsx](file:///c:/Users/ASUS/Documents/8thsemproj/frontend/src/components/RiverMap.jsx)):**
   - Replaced retired CartoDB direct tiles (which caused "API KEY REQUIRED" watermarks) with the standard free, keyless **OpenStreetMap** tile layer (`https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`).
   - Added custom high-contrast dark theme CSS filter in [index.css](file:///c:/Users/ASUS/Documents/8thsemproj/frontend/src/index.css) to preserve the Operations Center dark aesthetic.
   - Preserved correct OpenStreetMap attribution link per usage policy.
2. **Simulator & Supabase Telemetry Pipeline Active:**
   - Integrated `python-dotenv` into [config.py](file:///c:/Users/ASUS/Documents/8thsemproj/backend/app/config.py) and [simulator.py](file:///c:/Users/ASUS/Documents/8thsemproj/sensor-sim/simulator.py) to reliably load the Supabase connection string from `.env`.
   - Verified MQTT broker alignment: both backend and simulator connect to `broker.hivemq.com:1883` on topic `nepal/trishuli/sensors/#`.
   - Successfully running [simulator.py](file:///c:/Users/ASUS/Documents/8thsemproj/sensor-sim/simulator.py) with unbuffered output (`flush=True`).
   - Verified row growth in Supabase `sensor_readings` table (over 150+ rows actively inserted and climbing).
   - Added `/api/stats` endpoint and updated [App.jsx](file:///c:/Users/ASUS/Documents/8thsemproj/frontend/src/App.jsx) to initialize counters directly from database totals.

---

## 3. Tasks Completed

| Module | Component | Description | Status |
|---|---|---|---|
| **Topology** | Trishuli Watershed Graph | Modeled 6 monitoring stations and 5 downstream settlements with hydraulic travel-time edge weights | [DONE] |
| **Module A** | Sensor Simulator | Multi-station simulation with baseline fluctuation & MQTT publishing every 5s | [DONE] |
| **Module A** | Viva Spike Control | Remote MQTT spike injection trigger via control topic and CLI script | [DONE] |
| **Module B** | Ingestion Service | Paho MQTT subscriber, telemetry validator, and time-series persistence | [DONE] |
| **Module B** | Database Engine | SQLite (default) + PostgreSQL ready with SQLAlchemy & `psycopg2-binary` | [DONE] |
| **Module C** | Anomaly Detection | Custom mathematical model: EMA baseline, rate of change, Hydrological Stress Index ($HSI$) | [DONE] |
| **Module C** | Risk Classifier | Calibrated 4-tier decision tree (`NORMAL`, `WATCH`, `WARNING`, `CRITICAL`) | [DONE] |
| **Module D** | Graph Propagation | Dijkstra shortest-path search on flood wave travel times to compute arrival ETAs | [DONE] |
| **Module D** | Alert Prioritization | Downstream settlement ranking by earliest ETA with safe evacuation zones | [DONE] |
| **Module E** | Real-time Dispatch | WebSocket server (`/ws/stream`) streaming telemetry & alerts to frontend | [DONE] |
| **Module E** | Notification Sim | Emergency console broadcast & email dispatch with delivery log | [DONE] |
| **Module F** | GIS River Basin Map | Leaflet map with CartoDB dark theme, reach vectors, and colored risk beacons | [DONE] |
| **Module F** | Telemetry Chart | Live Recharts showing real-time water level vs. EMA baseline envelope | [DONE] |
| **Module F** | Cascading Alert Feed | ETA-ranked settlement cards with population at risk and acknowledge action | [DONE] |
| **Module F** | Viva Demo Panel | One-click button in web UI to trigger live flash flood surge | [DONE] |
| **Module F** | Audit Log Table | Live telemetry table showing raw metrics & analytical justification | [DONE] |
| **DevOps** | Git & Repository | Initialized git repository, created clean `.gitignore`, configured remote | [DONE] |

---

## 3. Automated & Live Verification Tests Conducted

| Test Category | Test File / Command | Scope & Assertion | Result |
|---|---|---|---|
| **Unit Test** | `test_anomaly.py::test_anomaly_normal_baseline` | Verifies steady readings stay in `NORMAL` status with $HSI < 1.0$ | **PASSED** (0.09s) |
| **Unit Test** | `test_anomaly.py::test_anomaly_flash_flood_spike` | Verifies rapid surge triggers `CRITICAL` risk with elevated rate of change | **PASSED** |
| **Unit Test** | `test_graph.py::test_graph_propagation_from_upstream` | Verifies Dijkstra routes downstream in strict ETA order: Dhunche (18m) -> Syapru (30m) -> Betrawati (71m) -> Trishuli (88m) -> Galchi (117m) | **PASSED** |
| **Unit Test** | `test_graph.py::test_graph_propagation_normal` | Verifies `NORMAL` state produces 0 false alerts | **PASSED** |
| **Integration** | `test_e2e_pipeline.py` | Full pipeline test: seed nodes -> ingest reading -> inject spike -> assert database rows & alerts | **PASSED** |
| **Live API** | `verify_live.py` | Live verification against running backend (`http://127.0.0.1:8000/api/health`, `/nodes`, `/alerts`) | **PASSED** (6 stations, 5 alerts, active WS client) |
| **Frontend Build** | `npm run build` | Vite production bundle compilation | **PASSED** (0 errors, 2.30s) |

---

## 4. File Manifest (Created & Utilized)

### Shared Configuration
- `shared/river_topology.json`: River reaches, coordinates, elevations, and travel times.

### Sensor Simulation (`sensor-sim/`)
- `sensor-sim/simulator.py`: Multi-node MQTT simulator with live spike injection mode.
- `sensor-sim/trigger_spike.py`: CLI tool for triggering flood surges.

### Backend Application (`backend/`)
- `backend/app/config.py`: Application parameters, MQTT topics, and database configuration.
- `backend/app/database.py`: SQLAlchemy session and engine with PostgreSQL pool support.
- `backend/app/models.py`: Database models (`nodes`, `sensor_readings`, `alerts`).
- `backend/app/schemas.py`: Pydantic validation schemas.
- `backend/app/anomaly_engine.py`: Module C custom analytical anomaly detection math.
- `backend/app/graph_engine.py`: Module D Dijkstra graph traversal and ETA router.
- `backend/app/dispatcher.py`: Module E WebSocket broadcast manager and alert simulator.
- `backend/app/seed_data.py`: Initializer and river topology seeder.
- `backend/app/main.py`: FastAPI server with REST and WebSocket endpoints.
- `backend/run.py`: Backend entry runner script.
- `backend/tests/conftest.py`: Test configuration.
- `backend/tests/test_anomaly.py`: Unit tests for Module C.
- `backend/tests/test_graph.py`: Unit tests for Module D.
- `backend/tests/test_e2e_pipeline.py`: Pipeline integration test.
- `backend/tests/verify_live.py`: Live system health inspector.

### Frontend Dashboard (`frontend/`)
- `frontend/index.html`: Web entry with Outfit font and Leaflet CSS.
- `frontend/src/index.css`: Dark emergency operations theme and animations.
- `frontend/src/services/api.js`: REST API client.
- `frontend/src/hooks/useWebSocket.js`: Auto-reconnecting WebSocket streaming hook.
- `frontend/src/components/Header.jsx`: Top navigation and live WebSocket status badge.
- `frontend/src/components/RiverMap.jsx`: Leaflet GIS map with glowing beacons and reaches.
- `frontend/src/components/TelemetryChart.jsx`: Real-time chart with EMA baseline and thresholds.
- `frontend/src/components/AlertFeed.jsx`: ETA-ranked downstream cascaded alerts.
- `frontend/src/components/SpikeControl.jsx`: Viva demonstration flood surge injection panel.
- `frontend/src/components/RawDataTable.jsx`: Raw telemetry and algorithm justification table.
- `frontend/src/App.jsx`: Master dashboard layout.

### Orchestration & Documentation
- `start_all.ps1`: 1-click startup script for all 3 processes.
- `README.md`: Architectural documentation and defense presentation guide.
- `POSTGRES_SETUP_GUIDE.md`: Step-by-step instructions for SQLite / PostgreSQL configuration.
- `PROJECT_STATUS.md`: Continuous progress and verification tracker.
- `.gitignore`: Ignore rules for node_modules, build artifacts, and database files.
- `.env.example`: Configuration template for PostgreSQL and MQTT broker.
