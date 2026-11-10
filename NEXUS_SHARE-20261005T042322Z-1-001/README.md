# 🛰️ NEXUS Crisis Intelligence

> **Emergency reporting, incident prioritization, response-team coordination, report-credibility scoring, blind-spot detection and ripple-effect intelligence for disaster management — in one self-contained web app.**

![HTML5](https://img.shields.io/badge/frontend-HTML5%20%7C%20CSS3%20%7C%20JavaScript-orange.svg)
![React](https://img.shields.io/badge/charts-React%2018.3%20%2B%20Recharts%202.12-61DAFB.svg)
![Storage](https://img.shields.io/badge/storage-browser%20localStorage-336791.svg)
![Geocoding](https://img.shields.io/badge/geocoding-OpenStreetMap%20Nominatim-7EBC6F.svg)
![Build](https://img.shields.io/badge/build%20step-none-brightgreen.svg)

---

## 📌 Problem Statement

During floods, fires, accidents and building collapses, emergency coordinators receive reports from many people at once. Four problems repeatedly slow the response:

1. **Every report looks equally urgent.** Without a consistent way to rank incidents, a critical situation can wait behind several minor ones.
2. **Reports are not equally reliable.** Duplicate, conflicting or single-source reports are treated the same as corroborated ones.
3. **Silence is mistaken for safety.** Areas with no connectivity, blocked roads or low reporting may be the ones in the most danger, yet they send no reports.
4. **Incidents are handled one by one.** A road accident near a medical emergency, or flooding near a blocked road, can create secondary risks that nobody is watching for.

**NEXUS** addresses these with a transparent, rule-based pipeline. It shows *why* an incident is ranked where it is, how trustworthy a report is, where information is missing, and which nearby incidents may affect each other. Every score shows its inputs, so coordinators can check the reasoning instead of trusting a black box.

---

## 🚀 Features

| Feature | Module | Mechanism | Output | Status |
|---|---|---|---|---|
| **Emergency Report Submission** | Citizen portal | Validated form (title, description, category, location, people affected, contact); confirmation popup with a reference number. | Stored incident record plus a "report submitted" popup for the citizen. | **Working** |
| **Administrator Alerts** | Authority console | PIN login; new reports reach the admin tab through browser storage events; summary of reports received while away. | Popup alert with an "Open report" action. | **Working** |
| **Intelligent Incident Prioritization** | Prioritization | Weighted score: severity 40%, people affected 30%, time waiting 20%, incident type 10%, adjusted by signal words in the report text (e.g. "trapped", "gas leak" raise it; "under control" lowers it). | 0–100 priority score and Low / Medium / High / Critical level for every incident. | **Working** |
| **Response Team Management & Assignment** | Teams | Team registry with category, availability and location; auto-assign picks the nearest suitable available team by distance. | Assigned team, straight-line distance and ETA. | **Working** |
| **Incident & Team Map** | Ops Map | Locations resolved to coordinates; incidents and teams plotted with dashed assignment routes. | Interactive SVG map with distances and a Google Maps route link. | **Working** |
| **Operational Analytics** | Analytics | Live counts of active, resolved, critical and assigned incidents, plus average time to start and resolve. | KPI tiles and category breakdown. | **Working** |
| **TruthGrid — Report Credibility** | Community | Clusters reports by place and time, cross-verifies independent sources, scores 0–100 and flags conflicts. | Verified / Unverified / Disputed badge on every report. | **Working** |
| **ShadowMap — Response Blind Spots** | ShadowMap | Compares reports to expected volume, plus connectivity, road access and facility distance. | Ranked areas with welfare-check recommendations. | **Working (simulated inputs)** |
| **Emergency Ripple Intelligence** | Ripple (admin) | Groups nearby incidents; 11 transparent rules flag secondary risks as *detected* or *potential*. | Ripple alerts, risk zones, connecting lines on a map, recommended actions. | **Working** |
| **Traffic, Shelters & My Dashboard** | Public tools | Road status, shelter occupancy and a per-area summary. | Traffic diversions, shelter capacity, personal area view. | **Working (demo data)** |

---

## 🧠 Emergency Ripple Effect Intelligence

Ripple analyses active incidents that have a resolved latitude/longitude.

1. **Cluster** — Incidents within the configured **radius** (1–10 km) *and* **time window** (1–24 h) are grouped into clusters using a union-find over pairwise haversine distance.
2. **Tag** — Each incident gets hazard tags from its category and from keywords in its title and description (for example *accident*, *flood*, *fire*, *collapse*, *medical*, *blockage*).
3. **Match rules** — A rule links a primary tag to a nearby tag, for example Road Accident → Medical Emergency (ambulance access), Flood → Road Accident, Flood → Road Blockage, Fire → any nearby incident (evacuation), Road Blockage → any nearby incident (delayed vehicles), Building Collapse → Medical / Fire.
4. **Classify the link honestly** — *Detected* means the nearby report's own text mentions the primary hazard. Otherwise the alert is labelled *Potential*: nearby does **not** mean caused by.
5. **Score** — rule base + primary severity + nearby severity + distance + reported within 1 hour + people affected + text evidence. Levels: Low < 45, Medium 45+, High 65+, Critical 85+. Every alert lists its score factors.
6. **Recommend** — Each rule carries a precautionary action; the alert also names the nearest available team of the relevant type from the Teams module.
7. **Stay in sync** — The analysis re-runs every few seconds and whenever incidents change. Resolved or edited incidents drop their alerts automatically, and one alert is kept per incident pair (no duplicates).

---

## 🏗️ Tech Stack

| Component | Version | Role | Rationale |
|---|---|---|---|
| **HTML5 / CSS3 / JavaScript (ES2020)** | — | Application, styling, all analysis engines | No build step; the whole app is one file. |
| **React** | `18.3.1` (UMD via unpkg) | Charts in the dashboard | Loaded from a CDN, so no bundler is needed. |
| **Recharts** | `2.12.7` (UMD via unpkg) | Dashboard charts | Declarative charting; the page falls back gracefully if the CDN is unreachable. |
| **Inline SVG** | — | Risk map, Ops Map, ShadowMap, Ripple map | Lightweight, responsive, clickable markers. |
| **Browser `localStorage`** | — | Reports, teams, geocode cache, settings, acknowledgements | Works offline; shared across tabs of one browser. |
| **OpenStreetMap Nominatim** | public API | Turns typed place names into coordinates | Falls back to built-in area centres when offline. |

---

## 📂 Project Structure

```
NEXUS/
├── NEXUS_Crisis_Intelligence_Ripple.html   # The complete application (HTML + CSS + JS)
└── README.md                               # This file
```

Inside the HTML file, the script is organised as independent modules that share the global incident list (`inc`):

```
index.html
├── <style>                        # Design tokens, layout, responsive rules, per-module styles
├── <section> blocks               # Dashboard, Risk Map, Alerts, Prioritization, Analytics,
│                                  # Community, TruthGrid, ShadowMap, My Incidents, Traffic,
│                                  # Shelters, Ops Map, Ripple, Teams, Authority console
└── <script> blocks
    ├── Core                       # Incident model, report form, authority login, charts
    ├── Notifications              # Citizen confirmation popup, admin alerts, cross-tab sync
    ├── TruthGrid                  # Clustering, cross-verification, confidence scoring
    ├── ShadowMap                  # Information gap, connectivity, access, priority scoring
    ├── Prioritization             # window.NexusPriority — incident priority engine
    ├── Teams & Geocoding          # window.NexusTeams — team registry, location lookup, haversine
    ├── Ops Map & Analytics        # Incident/team map, KPIs
    └── Ripple Intelligence        # window.NexusRipple — clustering, rules, alerts, map
```

---

## ⚙️ Installation & Setup

### Prerequisites
- A modern browser (Chrome, Edge, Firefox or Safari).
- Internet access for the first load (React/Recharts CDN and place-name lookup). Entering coordinates as `lat, lng` works without a lookup.
- *Optional:* Python 3 to serve the file locally.

### Step 1: Get the file
Place `NEXUS_Crisis_Intelligence_Ripple.html` in a folder of your choice.

### Step 2: Run it

```bash
# Option A — double-click the file, or open it from the browser (File ▸ Open)

# Option B — serve it locally
python -m http.server 8000
# then open http://localhost:8000/NEXUS_Crisis_Intelligence_Ripple.html
```

### Step 3: Try the flow
1. **As a citizen:** click **+ Report Incident**, fill in the form and submit. A confirmation popup shows your reference number.
2. **As an administrator:** click **Authority Login** and enter the demo PIN `1234`. Use a *second browser tab* as the citizen to see live admin alerts.
3. **Test Ripple:** submit a *Road Accident* at `13.0850, 80.2100` and a *Medical Emergency* at `13.0950, 80.2150` (about 1.2 km apart). Open **Ripple** in the navigation to see the alert, the connecting line on the map and the recommended action.

> **Changing the demo PIN:** search the file for `1234` in the login handler. Replace it with real authentication before any deployment.

---

## 🔄 How It Works

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            NEXUS PIPELINE                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│  STAGE 1: REPORT INTAKE                                                     │
│  Citizen form ➔ validation ➔ incident record ➔ confirmation popup           │
│                              ➔ browser storage ➔ admin popup alert          │
├─────────────────────────────────────────────────────────────────────────────┤
│  STAGE 2: ENRICHMENT                                                        │
│  Location text ➔ coordinates (typed, cached, Nominatim, area fallback)      │
│  Priority engine ➔ 0–100 score + level   TruthGrid ➔ credibility status     │
├─────────────────────────────────────────────────────────────────────────────┤
│  STAGE 3: SITUATIONAL INTELLIGENCE                                          │
│  ShadowMap ➔ areas with missing information or limited access               │
│  Ripple    ➔ nearby incidents ➔ rule match ➔ detected / potential alerts    │
├─────────────────────────────────────────────────────────────────────────────┤
│  STAGE 4: RESPONSE                                                          │
│  Team auto-assignment ➔ Ops Map routes ➔ welfare checks ➔ status updates    │
│  Status changes sync back to the citizen's report and clear stale alerts    │
└─────────────────────────────────────────────────────────────────────────────┘
```

### TruthGrid scoring
`score = 20 + corroboration (≤40) + consistency (≤20) + recency (≤20) + authority response (15) + contact (5) + description (5) − conflict penalty (25)`.
Status: **Verified** (score ≥ 70 or authorities responding, no conflict), **Disputed** (conflicting type, severity or wording), **Unverified** (everything else).

### ShadowMap priority
`priority = 0.30 × flood risk + 0.30 × information gap + 0.20 × connectivity + 0.20 × access constraint`.
Levels: **Investigate now** (≥ 60), **Monitor** (≥ 42), **Covered**.

### Data stored in the browser
`nexus_reports_v2` (citizen reports) · `nexus_teams_v1` (teams) · `nexus_geo_v1` (geocode cache) · `nexus_shadow_v1` (ShadowMap connectivity and checks) · `nexus_ripple_cfg_v1` (Ripple radius, window, filter) · `nexus_ripple_ack_v1` (acknowledged alerts) · `nexus_admin_seen_v2` (admin last-seen time).

---

## ⚠️ Current Limitations

- **No server.** Data lives in one browser. Cross-tab alerts work within the same browser only; alerts between devices need a backend.
- **Demo inputs.** Population, connectivity, facility distances, shelters and traffic are simulated sample data.
- **Geocoding depends on the public Nominatim service.** It is rate-limited, so lookups are queued and cached. Unresolved places wait until a location is found.
- **Rule-based, not predictive.** Ripple alerts flag *possible* secondary risks for human review. They are decision support, not proof of cause.
- **Authority login is a demo PIN.** It is not secure authentication.

---

## 📈 Roadmap & Scalability

1. **Backend and database:** a REST/WebSocket API (for example FastAPI or Node) with PostgreSQL/PostGIS replacing `localStorage`, enabling real multi-device alerts and `ST_DWithin` proximity queries for Ripple.
2. **Real data feeds:** Open-Meteo or NASA GPM for rainfall, Sentinel-1 radar for flood extent, VIIRS night lights for outages, WorldPop for population, OpenStreetMap for roads and facilities.
3. **Real authentication:** role-based access for citizens, coordinators and field teams.
4. **Notifications:** SMS, push and email delivery for administrator and citizen updates.
5. **Road-aware routing:** replace straight-line distance and ETA with road routing that avoids closed roads.

---

## 📄 License

Add the license of your choice (for example Apache 2.0) before distributing.