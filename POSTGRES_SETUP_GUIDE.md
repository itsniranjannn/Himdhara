# PostgreSQL Setup & Migration Guide
**Flood/Landslide Early Warning & Alert Routing System**

The backend is fully equipped with **SQLAlchemy + psycopg2-binary**, allowing you to switch between SQLite and PostgreSQL simply by changing the `DATABASE_URL` environment variable.

---

## Option 1: Free Cloud PostgreSQL (Recommended - 2 Minutes Setup)
*Best for capstone defense because your database is accessible from anywhere without running a local database service on your laptop.*

1. Go to [Neon.tech](https://neon.tech/) or [Supabase.com](https://supabase.com/) and create a free account.
2. Create a new project named `flood-warning-db`.
3. Copy the provided connection string (URI), which looks like:
   ```
   postgresql://niranjan:secretpassword@ep-watershed-123.ap-southeast-1.aws.neon.tech/flood_warning_db?sslmode=require
   ```
4. Create a `.env` file in `backend/` or project root and paste:
   ```env
   DATABASE_URL=postgresql://niranjan:secretpassword@ep-watershed-123.ap-southeast-1.aws.neon.tech/flood_warning_db?sslmode=require
   ```
5. Restart your backend:
   ```powershell
   python backend/run.py
   ```
   The database tables (`nodes`, `sensor_readings`, `alerts`) and Trishuli River network topology are **automatically created and seeded on startup**!

---

## Option 2: Local PostgreSQL on Windows (via Installer & pgAdmin)

### 1. Download & Install PostgreSQL
1. If not already installed, download PostgreSQL from [EnterpriseDB / postgresql.org](https://www.postgresql.org/download/windows/).
2. Keep the default port `5432` and remember your master password (usually `postgres` user).

### 2. Create the Database
Open **SQL Shell (psql)** or **pgAdmin 4**:
```sql
CREATE DATABASE flood_warning_db;
```

### 3. Configure Your Application
In your `.env` file (or set in PowerShell):
```env
DATABASE_URL=postgresql://postgres:your_password@localhost:5432/flood_warning_db
```

In PowerShell:
```powershell
$env:DATABASE_URL="postgresql://postgres:your_password@localhost:5432/flood_warning_db"
python backend/run.py
```

---

## Option 3: Local PostgreSQL via Docker (If you have Docker Desktop)
```powershell
docker run --name flood-postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=flood_warning_db -p 5432:5432 -d postgres:16
```
Then set:
```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/flood_warning_db
```

---

## How to Verify PostgreSQL Data
Once running, you can verify your time-series tables in pgAdmin or psql:
```sql
-- View all 6 registered Himalayan monitoring stations
SELECT node_id, name, elevation_m, current_risk FROM nodes;

-- View live ingested sensor readings
SELECT node_id, water_level_cm, rainfall_mm, soil_moisture_pct, risk_level, timestamp 
FROM sensor_readings 
ORDER BY timestamp DESC 
LIMIT 10;

-- View cascaded emergency alerts
SELECT affected_settlement_name, eta_minutes, risk_level, evacuation_zone, population_at_risk 
FROM alerts 
ORDER BY eta_minutes ASC;
```
