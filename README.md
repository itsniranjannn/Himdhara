<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&height=120&color=0:0d1117,50:0e7490,100:06b6d4&section=header&text=Himdhara%20(%E0%A4%B9%E0%A4%BF%E0%A4%AE%E0%A4%A7%E0%A4%BE%E0%A4%B0%E0%A4%BE)&fontSize=40&fontColor=ffffff&fontAlignY=38" width="100%" alt="Himdhara Header"/>

<a href="https://github.com/itsniranjannn/Himdhara">
  <img src="https://readme-typing-svg.demolab.com?font=Poppins&weight=600&size=21&duration=2800&pause=900&color=22D3EE&center=true&vCenter=true&width=700&lines=Autonomous+Multi-Basin+River+Early+Warning.;Real-time+MQTT+IoT+hydrology+telemetry.;Dijkstra+downstream+flood+ETA+routing.;Bilingual+Nepali+%26+English+hazard+dispatch." alt="Typing animation"/>
</a>

<br/>

![FastAPI](https://img.shields.io/badge/Backend-FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white)
![React 18](https://img.shields.io/badge/Frontend-React_18-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![Leaflet](https://img.shields.io/badge/Maps-Leaflet-199900?style=for-the-badge&logo=leaflet&logoColor=white)
![MQTT](https://img.shields.io/badge/Telemetry-MQTT_v5-660066?style=for-the-badge&logo=eclipsemosquitto&logoColor=white)
![MySQL](https://img.shields.io/badge/Database-MySQL-4479A1?style=for-the-badge&logo=mysql&logoColor=white)

<br/>

**[Overview](#overview) · [Features](#features) · [Architecture](#architecture) · [Connect](#connect)**

</div>

---

## Overview

**Himdhara (हिमधारा)** is an autonomous, real-time river surveillance and downstream hazard dispatch platform engineered for Nepal's Himalayan river basins (Trishuli, Bagmati, Koshi, Gandaki, and Karnali).

<p align="center">
  <img src="docs/screenshots/landing-hero-dark.png" alt="Himdhara Public Portal" width="94%" />
</p>

---

## Features

<table>
<tr>
<td width="50%" valign="top">

### Telemetry & Physics Engine
- **IoT MQTT Emulation**: 5-second sensor feeds (water level, rainfall, soil moisture)
- **Hydrological Stress Index (HSI)**: EMA + flash surge rate (`dWL/dt`) + soil saturation
- **Multi-tier Risk**: `NORMAL` → `WATCH` → `WARNING` → `CRITICAL`

</td>
<td width="50%" valign="top">

### Routing & Dispatch
- **Dijkstra Flood ETA**: calculates exact flood wave arrival times for downstream settlements
- **Bilingual Alerts**: automated HTML/text email dispatch in **Nepali (नेपाली)** and **English**
- **Operations Center**: dark/light GIS dashboard with one-click flood surge simulation

</td>
</tr>
</table>

### System Interface

| Operations Center (Dark) | Operations Center (Light) |
| :---: | :---: |
| <img src="docs/screenshots/monitor-critical-dark.png" width="100%" alt="Monitor Dark" /> | <img src="docs/screenshots/monitor-light-latest.png" width="100%" alt="Monitor Light" /> |

| Critical Flood Incident | Incident Timeline Log |
| :---: | :---: |
| <img src="docs/screenshots/alerts-active-latest.png" width="100%" alt="Alerts View" /> | <img src="docs/screenshots/incidents-dark.png" width="100%" alt="Incidents Log" /> |

| Public Web Bulletin | Mobile Responsive View |
| :---: | :---: |
| <img src="docs/screenshots/bulletin-active-latest.png" width="100%" alt="Public Bulletin" /> | <img src="docs/screenshots/mobile-bulletin-latest.png" width="60%" alt="Mobile Bulletin" /> |

---

## Architecture

```mermaid
flowchart LR
    A[MQTT Sensor Nodes] --> B[FastAPI Ingestion & HSI Engine]
    B --> C[(MySQL / SQLAlchemy)]
    B --> D[Dijkstra Flood ETA Router]
    D --> E[Bilingual Email Dispatch]
    B --> F[React + Leaflet Operations UI]
```

---

## Connect

<div align="center">

<a href="mailto:katwalniranjan7@gmail.com"><img src="https://img.shields.io/badge/katwalniranjan7%40gmail.com-D14836?style=for-the-badge&logo=gmail&logoColor=white" alt="Email"/></a>
<a href="https://github.com/itsniranjannn"><img src="https://img.shields.io/badge/itsniranjannn-181717?style=for-the-badge&logo=github&logoColor=white" alt="GitHub"/></a>

<img src="https://capsule-render.vercel.app/api?type=waving&height=80&color=0:0d1117,50:0e7490,100:06b6d4&section=footer" width="100%" alt=""/>

</div>
