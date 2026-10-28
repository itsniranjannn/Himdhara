# Trishuli Flood & Landslide Early Warning System

**8th Semester Engineering Final Year Project**  
**Study area:** Trishuli and Bhotekoshi River Basin, Bagmati Province, Nepal

This repository contains a complete distributed flood and landslide early-warning prototype. It combines a six-station MQTT telemetry simulator, a FastAPI ingestion and analysis service, a SQLAlchemy persistence layer, a graph-based alert routing engine, a WebSocket event stream, and a React/Leaflet operations dashboard.

The system is designed for a viva/demo deployment, but the boundaries between the simulator, ingestion service, database, API, and dashboard are kept explicit so that real sensor publishers and a production database can replace the local components.

## Contents

1. [System capabilities](#system-capabilities)
2. [Architecture](#architecture)
3. [Repository layout](#repository-layout)
4. [Runtime components](#runtime-components)
5. [Telemetry and event contracts](#telemetry-and-event-contracts)
6. [Analytical risk engine](#analytical-risk-engine)
7. [Graph routing and alert lifecycle](#graph-routing-and-alert-lifecycle)
8. [Persistence model](#persistence-model)
9. [REST and WebSocket API](#rest-and-websocket-api)
10. [Dashboard information architecture](#dashboard-information-architecture)
11. [Configuration](#configuration)
12. [Local setup and operation](#local-setup-and-operation)
13. [Demo and spike workflow](#demo-and-spike-workflow)
14. [Authentication and authorization](#authentication-and-authorization)
15. [Design system and motion](#design-system-and-motion)
16. [Testing and verification](#testing-and-verification)
17. [Troubleshooting](#troubleshooting)
18. [Deployment and production considerations](#deployment-and-production-considerations)

## System capabilities

- Publishes realistic five-second telemetry for six stations.
- Consumes MQTT JSON messages and stores raw plus computed readings.
- Calculates EMA baseline, rate of change, component scores, HSI, and risk level.
- Shows current station state, timestamps, trends, thresholds, map position, and network topology.
- Routes `WARNING` and `CRITICAL` conditions through the river graph to affected settlements.
- Computes flood-wave arrival ETA using weighted shortest paths.
- Creates one open alert per `(source_node_id, affected_settlement_id)` pair.
- Updates an existing `ACTIVE` or `ACKNOWLEDGED` alert in place on later evaluation cycles.
- Resolves open alerts when the source station returns to `NORMAL`.
- Records acknowledgement, resolution, recovery, and operator history.
- Broadcasts live telemetry and alert events over WebSocket.
- Read-only public access, with operator sign-in required for every state-changing action (see [Authentication](#authentication-and-authorization)).
- Detects silent sensors: a station with no reading for `STALE_AFTER_SECONDS` (default 60) is shown as OFFLINE instead of its last risk band.
- Short-horizon trend forecast per station (minutes until watch/warning/critical at the current rate, guidance only).
- Operators acknowledge and resolve alerts with notes and a full history; alerts also auto-resolve on recovery.
- Analytics page: water-level history over 1 h to 7 days, per-station statistics, risk-band time share, CSV export.
- Alert delivery by SMS (Sparrow SMS, Nepal) and email (SMTP) to registered contacts in English or Nepali, with a persistent delivery log. Defaults to simulated delivery.
- Public bulletin in English and Nepali, with resident self-registration for SMS alerts.
- Telemetry validation (unknown stations, out-of-range or non-numeric values are rejected) and a private MQTT topic prefix.
- Includes a modal Demo workflow for spike injection and simulator reset.
- Provides a public bulletin with station conditions, general safety guidance, and settlement evacuation points.
- Supports SQLite for zero-configuration local development and PostgreSQL for hosted deployments.

## Architecture

```text
                         +------------------------------+
                         |  React + Vite operations UI  |
                         |  Leaflet map, charts, alerts |
                         +---------------+--------------+
                                         |
                              REST /api + WebSocket
                                         |
+------------------+       +-------------v----------------+
| Python simulator | MQTT  | FastAPI application          |
| 6 sensor nodes   +------> | auth, REST, WebSocket,       |
| spike/recession  |       | MQTT lifecycle orchestration |
+------------------+       +------+------+----------------+
                                  |      |
                                  |      +--> Dispatcher/WebSocket hub
                                  |
                 +----------------v----------------+
                 | MQTT ingestion and analysis     |
                 | validate -> compute -> persist  |
                 | deduplicate -> route -> publish |
                 +----------------+----------------+
                                  |
                    +-------------v--------------+
                    | SQLAlchemy database         |
                    | SQLite or PostgreSQL        |
                    | nodes, readings, alerts,    |
                    | users, history, incidents   |
                    +-----------------------------+

Shared river_topology.json supplies station coordinates,
thresholds, directed edges, settlement metadata, and travel times.
```

### End-to-end processing

1. `sensor-sim/simulator.py` loads `shared/river_topology.json` and publishes one telemetry message per station every five seconds.
2. `backend/app/mqtt_client.py` subscribes to `nepal/trishuli/sensors/#`.
3. The ingestion service validates the payload, finds the station, computes anomaly metrics, and writes a `SensorReadingModel`.
4. The station's latest risk and timestamp become visible through `/api/nodes`.
5. If the risk is `WARNING` or `CRITICAL`, `graph_engine` calculates downstream settlement routes.
6. The alert upsert routine updates an existing open pair or inserts a new alert only when no open pair exists.
7. On recovery to `NORMAL`, open alerts for that source station are transitioned to `RESOLVED`.
8. The dispatcher sends `TELEMETRY_UPDATE` and `NEW_ALERTS` messages to connected dashboards.
9. React state updates the map, chart, station list, alert queue, counters, and animations without a full reload.

## Repository layout

```text
8thsemproj/
├── .env.example                       # Environment variable template
├── start_all.ps1                      # Windows launcher for all services
├── shared/
│   └── river_topology.json            # Stations, settlements, edges, thresholds
├── sensor-sim/
│   ├── simulator.py                   # Six-node MQTT simulator
│   └── trigger_spike.py               # Command-line spike publisher
├── backend/
│   ├── run.py                         # Uvicorn entry point
│   ├── app/
│   │   ├── main.py                    # FastAPI app, lifecycle, REST, WebSocket
│   │   ├── config.py                  # Environment-backed settings
│   │   ├── database.py                # Engine, sessions, schema migration
│   │   ├── models.py                  # SQLAlchemy persistence models
│   │   ├── schemas.py                 # Request and response validation
│   │   ├── auth.py                    # Password hashing and JWT validation
│   │   ├── mqtt_client.py             # MQTT ingestion and alert lifecycle
│   │   ├── anomaly_engine.py          # EMA, HSI, thresholds, classification
│   │   ├── graph_engine.py            # Directed graph and Dijkstra routing
│   │   ├── dispatcher.py              # WebSocket fan-out and notification log
│   │   ├── notifier.py                # Simulated SMS/email notification layer
│   │   └── seed_data.py               # Station and settlement initialization
│   └── tests/                         # Backend unit and integration tests
├── frontend/
│   ├── package.json                   # React/Vite scripts and dependencies
│   └── src/
│       ├── App.jsx                    # Shell, routes, auth modal, live state
│       ├── index.css                  # Global design system and animations
│       ├── hooks/useWebSocket.js      # Reconnect and heartbeat handling
│       ├── services/api.js            # REST client and session expiry handling
│       └── components/
│           ├── RiverMap.jsx           # Leaflet basin map
│           ├── TelemetryChart.jsx     # Water level and threshold chart
│           ├── AlertFeed.jsx           # ETA-sorted alert queue
│           ├── SpikeControl.jsx        # Authenticated Demo controls
│           ├── RawDataTable.jsx        # Telemetry and algorithm audit
│           └── AccessPages.jsx         # Login and public bulletin
└── README.md
```

## Runtime components

### Sensor simulator

The simulator creates six `SensorNode` instances from the shared topology. Each node has:

- Stable `node_id`, name, coordinates, elevation, and baseline values.
- Water level, rainfall, and soil-moisture state.
- Normal random fluctuation.
- A rising flood-spike phase.
- A sustained crest phase.
- A gradual recession phase back to baseline.

The simulator listens on the control topic for `INJECT_SPIKE` and `RESET_SIMULATION` commands. Its five-second interval is intentionally aligned with the dashboard's fresh-reading and stale-state checks.

### FastAPI service

Startup runs an idempotent schema migration, seeds the graph network, starts the MQTT worker, and exposes REST and WebSocket endpoints. Shutdown stops the MQTT worker cleanly.

### MQTT ingestion

The ingestion worker:

1. Connects to the configured broker.
2. Subscribes to the telemetry wildcard.
3. Parses JSON payloads.
4. Computes risk metrics.
5. Persists readings and station state.
6. Creates or updates routed alerts.
7. Resolves alerts during normal recession.
8. Broadcasts live events.

### Dispatcher and notifier

The dispatcher maintains active WebSocket connections and broadcasts JSON events. The notifier keeps a simulated notification log for SMS/email integration points; the default providers are deliberately non-delivery simulation providers.

## Telemetry and event contracts

### MQTT telemetry payload

Topic pattern:

```text
nepal/trishuli/sensors/{node_id}
```

Payload:

```json
{
  "node_id": "NODE_LANGTANG_01",
  "rainfall_mm": 2.5,
  "water_level_cm": 45.0,
  "soil_moisture_pct": 38.0,
  "timestamp": "2026-09-29T15:40:29.940Z"
}
```

`timestamp` is optional; the backend uses the current UTC time when it is absent.

### MQTT control payloads

Spike injection topic:

```text
nepal/trishuli/control/spike
```

```json
{
  "action": "INJECT_SPIKE",
  "node_id": "NODE_LANGTANG_01",
  "water_level_surge_cm": 145.0,
  "rainfall_surge_mm": 80.0,
  "soil_moisture_surge_pct": 40.0,
  "duration_seconds": 45
}
```

Reset payload:

```json
{
  "action": "RESET_SIMULATION"
}
```

### WebSocket endpoint

Connect to:

```text
ws://127.0.0.1:8000/ws/stream
```

The client sends `ping`; the server replies with `pong`. Server events include:

```json
{
  "type": "TELEMETRY_UPDATE",
  "data": {
    "node_id": "NODE_LANGTANG_01",
    "water_level_cm": 45.0,
    "risk_level": "NORMAL",
    "hsi_score": 0.12,
    "timestamp": "2026-09-29T15:40:29.940Z"
  }
}
```

```json
{
  "type": "NEW_ALERTS",
  "data": [
    {
      "alert_id": "ALERT-...",
      "source_node_id": "NODE_LANGTANG_01",
      "affected_settlement_id": "SETTLE_DHUNCHE",
      "eta_minutes": 18.0,
      "risk_level": "CRITICAL",
      "status": "ACTIVE"
    }
  ]
}
```

## Analytical risk engine

The analysis is deterministic and explainable; it does not use an ML library.

### EMA baseline

For a rolling window size `N = 12`:

```text
alpha = 2 / (N + 1)
EMA_t = alpha * L_t + (1 - alpha) * EMA_(t-1)
```

### Rate of change

```text
rate_cm_min = (water_level_t - water_level_(t-1)) / elapsed_minutes
```

### Component scores

The engine derives normalized water-level deviation, positive surge-rate, and soil-saturation terms:

```text
HSI =
  0.45 * s_level +
  0.40 * s_rate +
  0.15 * s_soil
```

The soil saturation term begins contributing above the configured `40%` threshold.

### Risk classification

Each station also has water-level thresholds:

| Risk | Meaning |
|---|---|
| `NORMAL` | Baseline conditions |
| `WATCH` | Early deviation, runoff, or elevated water level |
| `WARNING` | Significant surge or warning threshold crossed |
| `CRITICAL` | Immediate flash-flood threat or critical threshold crossed |
| `STALE` | Dashboard-derived display state when no reading is received within the freshness window |

The persisted reading risk is one of `NORMAL`, `WATCH`, `WARNING`, or `CRITICAL`. `STALE` is a presentation state based on timestamp age.

The mapping is explicit and evaluated from highest severity down: `CRITICAL` is selected at
the critical water threshold, HSI `>= 3.0`, or a warning-level surge above `20 cm/min`;
`WARNING` is selected at the warning threshold, HSI `>= 2.0`, or a watch-level surge above
`12 cm/min`; `WATCH` is selected at the watch threshold, HSI `>= 1.2`, surge above
`8 cm/min`, or soil moisture above `85%`. Otherwise the reading is `NORMAL`. An HSI such
as `0.60` is therefore correctly normal when water level and rate remain below the watch
rules; the dashboard displays the matching reason beside the selected station.

## Graph routing and alert lifecycle

`shared/river_topology.json` defines a directed weighted graph containing sensor stations, settlement targets, and hydraulic travel-time edges. Dijkstra's algorithm calculates the shortest downstream travel time from an affected source to each settlement:

```text
ETA(settlement) = current_time + shortest_travel_time(source, settlement)
```

The dashboard sorts the alert queue by flood-wave arrival time.

### Alert upsert rule

For every evaluation cycle:

1. Query `alerts` for the same `source_node_id` and `affected_settlement_id`.
2. Restrict the query to `ACTIVE` and `ACKNOWLEDGED`.
3. If a row exists, update its ETA, risk level, settlement metadata, and population in place.
4. Insert only when no open row exists.
5. Broadcast only the resulting current alert state.

This prevents a sustained station condition from creating a new duplicate row every five seconds.

`alerts` also has a partial unique index on `(source_node_id, affected_settlement_id)` for
`ACTIVE` and `ACKNOWLEDGED` rows. SQLite and PostgreSQL both support this index predicate.
Resolved rows remain reusable for a later incident. During migration, an existing database
with duplicate open pairs logs an explicit migration error so operators can resolve the
duplicates before retrying; new databases are protected at creation time.

### Recovery rule

When a source station evaluates to `NORMAL`, all of its open alerts are transitioned to `RESOLVED`, with resolution timestamp, resolver, and history record. This applies during normal sensor recession as well as the manual simulator reset flow.

### Manual state transitions

- `ACTIVE -> ACKNOWLEDGED` requires an operator.
- `ACKNOWLEDGED -> RESOLVED` requires an operator.
- Automatic recovery can resolve open alerts when telemetry returns to `NORMAL`.

## Persistence model

| Table | Purpose | Important fields |
|---|---|---|
| `nodes` | Station metadata and current state | `node_id`, coordinates, elevation, thresholds, `current_risk` |
| `sensor_readings` | Raw and computed telemetry | water, rain, soil, timestamp, EMA, scores, HSI, risk |
| `alerts` | Settlement warning routes | source, settlement, ETA, risk, status, acknowledgement/resolution |
| `alert_history` | State transition audit trail | alert ID, old/new status, actor, note, time |
| `users` | Operator/viewer accounts | username, password hash, role |
| `incidents` | Recovered warning periods | source, peak risk, start/recovery |
| `settlements` | Public guidance metadata | name, evacuation zone, population |

`backend/app/database.py` runs `create_all` plus idempotent additions for telemetry score columns and alert lifecycle columns. PostgreSQL installations use connection pooling and `pool_pre_ping`.

## REST and WebSocket API

Base URL:

```text
http://127.0.0.1:8000
```

### Public/read endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | Service, broker, and WebSocket-client health |
| `GET` | `/api/stats` | Reading, node, and active-alert counters |
| `GET` | `/api/network/topology` | Shared graph JSON for map rendering |
| `GET` | `/api/nodes` | Station status, latest reading, thresholds, freshness |
| `GET` | `/api/nodes/{node_id}/readings?limit=50` | Chronological chart data |
| `GET` | `/api/alerts?active_only=false&limit=30` | Recent alert records |
| `GET` | `/api/settlements` | Settlement guidance metadata |
| `GET` | `/api/incidents` | Recovered incident records |
| `GET` | `/api/incidents/export.csv` | CSV incident export |
| `GET` | `/api/alerts/{alert_id}/history` | Alert transition history |
| `GET` | `/api/notifications/log` | Notification log |
| `WS` | `/ws/stream` | Live telemetry and alert events |

### Operator and demo endpoints

| Method | Path | Role | Purpose |
|---|---|---|---|
| `POST` | `/api/auth/login` | Public | Returns bearer JWT |
| `POST` | `/api/auth/users` | Local demo | Creates viewer/operator account (legacy compatibility) |
| `POST` | `/api/alerts/{alert_id}/acknowledge` | Local demo | Acknowledges active alert |
| `POST` | `/api/alerts/{alert_id}/resolve` | Local demo | Resolves acknowledged alert |
| `PUT` | `/api/nodes/{node_id}/thresholds` | Local demo | Updates ordered water thresholds |
| `PUT` | `/api/settlements/{settlement_id}` | Local demo | Updates public guidance metadata |
| `POST` | `/api/spike/inject` | Local demo | Publishes simulator spike command |
| `POST` | `/api/simulation/reset` | Local demo | Publishes reset and closes open alerts |

Production deployments should add authentication. The local/demo build does not require an Authorization header:

```text
Authorization: Bearer <access_token>
```

## Dashboard information architecture

The application keeps the operations navigation stable:

### Public routes

- `/` is the public landing page with the basin overview, live network preview, safety guidance, and dashboard entry points.
- `/bulletin` is the public, read-only situation bulletin.
- `/app/monitor`, `/app/alerts`, `/app/incidents`, and `/app/configuration` are the authenticated operations surfaces.
- The previous `/monitor`, `/alerts`, `/incidents`, `/configuration`, and `/public` paths redirect to their new locations.

### Monitor

- Basin map and river network.
- Selected station telemetry chart.
- Current water level, HSI, rate, and component terms.
- Six-station live status list.
- Settlement alert queue.
- Expandable telemetry/algorithm audit.

### Alerts

- Active and historical alert records.
- ETA-ranked settlement routes.
- Acknowledge and resolve actions for operators.
- Alert timeline and notes.

### Incidents

- Recovered warning/critical periods.
- Peak HSI and duration summaries.
- Incident detail and export-to-CSV action.

### Configuration

- Station thresholds.
- Settlement names, evacuation zones, and populations.
- Operator-only editing with validation.

### Public bulletin

- Public read-only station conditions.
- One general safety guidance section.
- Settlement-specific evacuation points only on each alert card.

## Configuration

Copy `.env.example` to `.env` at the repository root or configure environment variables through the deployment environment. `backend/app/config.py` loads root, backend, and process environment files.

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `sqlite:///./flood_system.db` | SQLAlchemy database URL |
| `MQTT_BROKER` | `broker.hivemq.com` | MQTT broker hostname |
| `MQTT_PORT` | `1883` | MQTT broker port |
| `MQTT_TOPIC_TELEMETRY` | `nepal/trishuli/sensors/#` | Telemetry subscription |
| `MQTT_TOPIC_CONTROL` | `nepal/trishuli/control/spike` | Simulator control topic |
| `MQTT_CLIENT_ID` | `trishuli_backend_ingestor` | Backend MQTT client prefix |
| `EMA_WINDOW_SIZE` | `12` | Analysis rolling window |
| `SOIL_MOISTURE_SAT_THRESHOLD` | `40.0` | Saturation contribution threshold |
| `RATE_OF_CHANGE_WEIGHT` | `0.40` | HSI rate component weight |
| `WATER_DEV_WEIGHT` | `0.45` | HSI water deviation weight |
| `SOIL_MOISTURE_WEIGHT` | `0.15` | HSI soil component weight |
| `JWT_SECRET` | random per process | JWT signing secret; set a long random value in `.env` |
| `MQTT_USERNAME` / `MQTT_PASSWORD` | empty | Broker credentials (use on a private broker) |
| `STALE_AFTER_SECONDS` | `60` | Silence before a station is shown OFFLINE |
| `ALLOWED_ORIGINS` | localhost dev ports | Comma-separated browser origins allowed by CORS |
| `DEMO_CONTROLS_ENABLED` | `true` | Enables the spike / reset demo endpoints |
| `SMS_PROVIDER`, `SPARROW_TOKEN`, `SPARROW_FROM` | `simulated` | Set provider to `sparrow` to send real SMS |
| `EMAIL_PROVIDER`, `SMTP_HOST/PORT/USERNAME/PASSWORD/FROM` | `simulated` | Set provider to `smtp` to send real email |
| `JWT_EXPIRE_MINUTES` | `480` | Token lifetime |
| `DEFAULT_OPERATOR_USERNAME` | `operator` | Seed operator username |
| `DEFAULT_OPERATOR_PASSWORD` | empty | Operator password. Empty = a random one-time password is printed on first start |
| `SMS_PROVIDER` | `simulated` | Notification provider mode |
| `EMAIL_PROVIDER` | `simulated` | Notification provider mode |

The frontend development client currently targets `http://127.0.0.1:8000/api` and `ws://127.0.0.1:8000/ws/stream`. Change these service URLs in `frontend/src/services/api.js` and the WebSocket hook when deploying behind a different origin. Local/demo operator authentication is disabled so the Demo control can be used directly; the login endpoint remains only as a backwards-compatible API surface.

## Local setup and operation

### Prerequisites

- Python 3.10 or newer.
- Node.js 18 or newer.
- npm.
- An MQTT broker reachable by both simulator and backend.
- PostgreSQL only if using a PostgreSQL `DATABASE_URL`; SQLite needs no separate service.

Install backend dependencies according to the Python environment used by the project. Frontend dependencies are declared in `frontend/package.json`.

### Start everything on Windows

```powershell
.\start_all.ps1
```

The launcher opens:

- FastAPI at `http://127.0.0.1:8000`
- Swagger UI at `http://127.0.0.1:8000/docs`
- Simulator publisher
- Vite dashboard at `http://127.0.0.1:5173`

The dashboard automatically reconnects its WebSocket with exponential backoff (capped at 30 seconds) and sends a heartbeat `ping` every 15 seconds. The backend answers with `pong`. The Demo button (operator sign-in required) publishes an `INJECT_SPIKE` command; watch the selected station's water level, rate, HSI, risk badge, and map popup for the resulting live values.

### Start services manually

Terminal 1:

```powershell
python backend/run.py
```

Terminal 2:

```powershell
python sensor-sim/simulator.py
```

Terminal 3:

```powershell
cd frontend
npm install
npm run dev
```

### Frontend commands

```powershell
cd frontend
npm run dev       # Development server
npm run build     # Production bundle
npm run lint      # Oxlint
npm run preview   # Serve the production bundle locally
```

## Demo and spike workflow

1. Start backend, simulator, and frontend.
2. Open the Monitor page.
3. Confirm `MQTT connected`, `WebSocket live`, and fresh station timestamps.
4. Sign in using an operator account.
5. Open **Demo**.
6. Select a station, normally `NODE_LANGTANG_01`.
7. Set the water surge and press **INJECT FLOOD SPIKE**.
8. Observe the station rise through `WATCH`, `WARNING`, and/or `CRITICAL`.
9. Observe downstream settlement alerts appear in ETA order.
10. Leave the simulator running through its recession phase.
11. Confirm alert rows are updated rather than duplicated.
12. Confirm the open rows transition to `RESOLVED` after recovery.
13. Use **Reset simulation** to immediately restore baseline and close open alert routes.

The command-line equivalent is:

```powershell
python sensor-sim/trigger_spike.py
```

The dashboard and API require an operator JWT for spike and reset operations. If a token expires, the API client clears the stored session and the UI returns to the operator sign-in modal.

## Authentication and authorization

- Passwords are stored as PBKDF2-HMAC-SHA256 hashes (200,000 rounds) with random per-password salts. Login is rate-limited (8 attempts per minute per client and username).
- Tokens are signed locally as HS256-style JWTs.
- Reads are public: anyone can open the dashboard, the bulletin and read stations, alerts, incidents and settlements without signing in.
- `operator` is required for every state-changing action: acknowledging/resolving alerts, editing thresholds and settlements, managing contacts, viewing the notification log, and the Demo spike/reset controls. `viewer` accounts are read-only; they can export CSV.
- An anonymous request to a protected endpoint returns `401`; a viewer returns `403`.
- The operator account comes from `DEFAULT_OPERATOR_USERNAME` / `DEFAULT_OPERATOR_PASSWORD` in `.env` and is re-synced on every start. If the password is empty the first start generates a random one-time password and prints it in the backend console. There is no default password.
- `JWT_SECRET` must be set in `.env`. If it is empty a random per-process secret is used and sessions end on restart.
- CORS is limited to `ALLOWED_ORIGINS`. The API binds to `127.0.0.1` by default (`API_HOST=0.0.0.0` to expose it).
- Set `DEMO_CONTROLS_ENABLED=false` on a real deployment to disable the spike/reset endpoints.

## Design system and motion

The frontend design system is centralized in `frontend/src/index.css`.

### Typography

- `Space Grotesk` weights 500, 600, and 700 for headings and navigation.
- `DM Sans` weights 400, 500, and 600 for interface text.
- `JetBrains Mono` weights 400 and 600 for numbers, IDs, metrics, and timestamps.
- Numeric values use tabular numerals.

### Palette

```css
--surface-0:#08141b
--surface-1:#0d2028
--surface-2:#122b35
--surface-3:#183743
--border:#2a4a55
--text-1:#edf7f6
--text-2:#b6c8ca
--text-3:#7e999e
--brand:#62d6d0
--brand-hover:#8be6df
--brand-muted:#2f7779
--normal:#42c98a
--watch:#d8b34b
--warning:#e68a52
--critical:#ed6b72
--stale:#9aa8ae
```

Risk colors are restricted to a status dot, adjacent label, and 2px left-edge accent. They are not used as full card fills or pill badges.
The interface also provides a persisted light theme and follows the system preference when no choice has been saved.

### Layout and interaction rules

- Spacing uses 4, 8, 12, 16, 24, and 32px values.
- Cards use `var(--surface-1)`, a one-pixel border, and a 12px radius.
- Tables are bare rows separated by bottom borders.
- Primary buttons use the glacier-teal brand accent with a 8px radius.
- Secondary buttons are transparent with a one-pixel border.
- The logo is the inline contour-line/alert-chevron SVG mark.
- Three concepts are retained in `frontend/src/assets/logo-concepts/`; Concept 01, **Contour Signal**, is the selected mark. Its mountain/signal chevron remains legible at favicon size while the contour lines connect the product to Himalayan terrain and hydrological telemetry without relying on a generic warning symbol.
- The Demo and sign-in surfaces are modal overlays above Leaflet layers.
- Native text selection uses the dark design tokens instead of the browser's default blue highlight.

### Motion

- The public landing page uses Framer Motion for viewport reveals, pointer parallax, route transitions, and reduced-motion-aware choreography; SVG contour and river effects remain CSS-driven.
- New alerts slide down 8px and fade in over 200ms.
- Risk dots pulse once over 400ms when a station risk changes.
- Updated numeric cells flash `var(--bg-2)` for 400ms.
- Route changes use a 150ms opacity fade.
- Only the WebSocket live indicator uses a continuous two-second breathing animation.

### Public landing experience

- `/` is the public animated basin overview. Its network preview reads live station state but the flood-wave button is visual-only and never writes to the database.
- The landing page is lazy-loaded so the operations bundle does not pay the cost of the public presentation until it is requested.
- The footer identifies the current React, FastAPI, MQTT, and Leaflet stack; project credits remain a replaceable placeholder.
- Public bulletin presentation is intentionally separate from the operator shell: it has its own logo header, theme toggle, plain-language station conditions, and settlement guidance without operator controls or implementation jargon.
- Configuration controls are disabled for signed-out and viewer sessions; the page explains that an operator sign-in is required to edit.
- Water levels, rates, and telemetry values are shown to two decimal places. Interface timestamps use 24-hour `NPT` formatting.
- The monitor chart scales to recent data with headroom and displays nearby WATCH, WARNING, and CRITICAL threshold lines. The map uses the free OpenStreetMap tile service and includes a station/settlement legend; this avoids third-party API-key tile fallbacks.
- Incident cards show duration, peak HSI, shortened identifiers with the full ID available on hover, and CSV export. The editable footer credits live in [`frontend/src/config/credits.js`](frontend/src/config/credits.js).

### Screenshots

The final browser verification captures are in [`docs/screenshots/`](docs/screenshots/):

- `landing-hero-dark.png` and `landing-hero-light.png` — public hero in both themes.
- `landing-pipeline-dark.png` — animated Sensor → MQTT → Analysis → Routing → Alerts pipeline.
- `monitor-idle-light.png` — six-station idle monitor.
- `monitor-critical-dark.png` and `monitor-critical-light.png` — live spike state with CRITICAL station and downstream routes.
- `alerts-dark.png`, `incidents-dark.png`, and `configuration-dark.png` — operations surfaces.
- `bulletin-alert-dark.png` — public bulletin during an active alert.
- `mobile-bulletin-dark.png` — narrow mobile bulletin with no horizontal overflow.
- `monitor-critical-latest.png`, `alerts-active-latest.png`, `bulletin-active-latest.png`, `mobile-bulletin-latest.png`, and `monitor-light-latest.png` — current-round live spike verification captures.

Screenshots are captured from the rendered app viewport only; browser chrome and personal bookmarks are excluded.

## Testing and verification

### Backend

```powershell
python -m pytest backend/tests -v
```

The backend suite covers anomaly calculations, graph routing, simulator reset behavior, and pipeline behavior.

### Frontend

```powershell
cd frontend
npm run build
npm run lint
```

### Verified current state

- Backend suite: **12 tests passed**.
- Frontend production build: **passed**.
- Frontend lint: **passed with zero warnings**.
- Vite build emitted no chunk-size warning after lazy-loading the landing page; the largest generated JavaScript asset is approximately 415 kB minified.
- Browser verification: landing page, both themes, desktop and mobile layouts, six fresh station timestamps, real Demo spike to CRITICAL, five ETA-sorted downstream routes, alert bulletin state, modal layering above Leaflet, route redirects, and stable alert upsert behavior.
- `start_all.ps1` anchors backend and simulator processes to the repository root, starts Vite in `frontend`, and opens the public landing page at `/`.

## Troubleshooting

### Stations show stale timestamps

1. Check that `python sensor-sim/simulator.py` is running.
2. Confirm the simulator and backend use the same MQTT broker and topics.
3. Open `/api/health` and confirm the backend is online.
4. Check backend logs for MQTT connection or payload errors.
5. Check `/api/nodes` for `last_reading_at`.
6. If an existing database was created before telemetry score fields were added, restart the backend so `migrate_schema()` can run.

### WebSocket is offline

1. Confirm the backend is listening on port 8000.
2. Confirm the browser is using `ws://127.0.0.1:8000/ws/stream`.
3. Check for firewall or broker-independent backend errors.
4. The client automatically retries with backoff and sends heartbeat pings.

### Demo does not update telemetry

Confirm the backend is listening on port `8000`, the simulator is connected to the configured MQTT broker, and the browser is using `ws://127.0.0.1:8000/ws/stream`. The Demo button needs an operator sign-in first. Then watch the selected station for updated water, rate, HSI, risk, and popup values.

### Alerts appear duplicated

Inspect the pair using:

```sql
SELECT source_node_id, affected_settlement_id, status, COUNT(*)
FROM alerts
WHERE status IN ('ACTIVE', 'ACKNOWLEDGED')
GROUP BY source_node_id, affected_settlement_id;
```

The count should be one for each open source/settlement pair. Repeated evaluation should update the existing row's ETA and risk rather than insert a new row.

### No alerts appear during a spike

1. Confirm the station crosses `WARNING` or `CRITICAL`.
2. Confirm the topology contains downstream settlement edges.
3. Check the backend MQTT logs.
4. Check the browser console and WebSocket connection.
5. Query `/api/alerts?active_only=true`.

## Deployment and production considerations

This repository is configured for local/demo operation. Before production use:

- Use a private authenticated MQTT broker with TLS.
- Use PostgreSQL with backups, migrations, and restricted network access.
- Set a strong random `JWT_SECRET`.
- Replace default operator credentials.
- Restrict CORS to the deployed dashboard origin.
- Serve the API and dashboard over HTTPS/WSS.
- Put the API behind a reverse proxy with request limits and structured logs.
- Replace simulated SMS/email providers with audited delivery integrations.
- Add database indexes or constraints for open-alert pair uniqueness if concurrent workers are introduced.
- Add a durable job/queue strategy if alert notifications must survive process restarts.
- Monitor MQTT connection health, WebSocket clients, ingestion latency, database growth, and alert transitions.
- Add retention/archival policies for high-volume `sensor_readings`.
- Validate all thresholds and topology changes through review before deployment.

## License and academic use

This is an academic final-year project implementation for demonstrating distributed telemetry ingestion, explainable hydrological risk analysis, graph routing, and live operator UX. Review dependencies and external broker terms before redistribution or deployment.
