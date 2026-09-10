# Den Chai Rooftop Solar Potential WebGIS Dashboard (Denchai_SolarRoof)

[![Deploy to GitHub Pages](https://github.com/theerasakoopp/Denchai_SolarRoof/actions/workflows/deploy.yml/badge.svg)](https://github.com/theerasakoopp/Denchai_SolarRoof/actions/workflows/deploy.yml)
[![Live Demo](https://img.shields.io/badge/Live%20Demo-GitHub%20Pages-brightgreen)](https://theerasakoopp.github.io/Denchai_SolarRoof/)
[![Research Paper](https://img.shields.io/badge/Paper-Elsevier%20RSASE%202026-orange)](https://github.com/theerasakoopp/Denchai_SolarRoof)

An interactive, high-performance WebGIS decision-support system evaluating 3D rooftop solar photovoltaic (PV) potential across **Den Chai Subdistrict Municipality (เทศบาลตำบลเด่นชัย)**, Phrae Province, Thailand (16.46 km²).

Powered by **UAV-SolarNet GeoAI semantic segmentation** and ultra-high resolution **10 cm UAV orthophotography**.

---

## 🌟 Key Features
- **Empirical 3D Rooftop Intelligence:** Complete inventory of **17,344 rooftop facets** and **5,558 buildings** strictly bounded within Den Chai municipal jurisdiction.
- **Aggregated Solar Capacity:** **252.91 MWp** geographic technical potential, producing **316.33 GWh/year** clean electricity and **1,423.47 million THB/year** in municipal bill savings (at 4.50 THB/kWh standard tariff).
- **Greenhouse Gas Abatement:** **158,131 tCO₂e/year** in avoided greenhouse gas emissions (grid emission factor 0.4999 kg CO₂/kWh, supporting UN SDGs 7 & 13).
- **4 Capacity Tiers (Thai DEDE & EIT Standards):**
  - **Tier 3 (>15 kWp):** 12,334 facets (236.00 MWp, 93.31%) — Commercial, agricultural, and large buildings.
  - **Tier 2 (5–15 kWp):** 3,181 facets (12.34 MWp, 4.88%) — Standard residential dwellings.
  - **Tier 1 (2.5–5 kWp):** 1,829 facets (4.57 MWp, 1.81%) — Small residences and micro-solar.
  - **Sub-optimal (<2.5 kWp):** Structural additions and heavily shaded roof planes.
- **3D Solar Orientation Vector Distribution:** Comprehensive tilt and azimuth classification covering South (37.82 MWp), West (44.81 MWp), East (38.39 MWp), North (34.11 MWp), Flat roofs (31.93 MWp), and Existing PV (0.72 MWp).
- **Ultra-High Resolution UAV Imagery:** Seamless streaming of **10 cm GSD UAV photogrammetry** across Zoom levels 14–20 in modern WebP format (27,309 tiles).
- **Interactive Rooftop & Building Inspector:** Click any rooftop facet or building to view tilt, azimuth, usable area, PV system size, annual savings, and simple payback period.
- **Dynamic Tariff & CAPEX Simulator:** Adjust local electricity tariffs (THB/kWh) and solar CAPEX (THB/kWp) to simulate real-time municipal clean energy returns.

---

## 🚀 Live Access
- **URL:** [https://theerasakoopp.github.io/Denchai_SolarRoof/](https://theerasakoopp.github.io/Denchai_SolarRoof/)

---

## 📚 Citation & Research Context
This platform serves as the open-science WebGIS deployment for the research manuscript:
> **"Deep Learning Decoders and Backbone Scaling for UAV-Based 3D Rooftop Facet Segmentation and Municipal Solar Photovoltaic Potential Assessment"**  
> *Under submission to Elsevier: Remote Sensing Applications: Society and Environment (RSASE)*.

---

## 🛠️ Tech Stack
- **Mapping Engine:** [MapLibre GL JS](https://maplibre.org/)
- **Vector Data:** GeoJSON (EPSG:4326 WGS84)
- **Raster Tiles:** 10 cm GSD XYZ WebP Tiles (Web Mercator EPSG:3857)
- **Deployment:** GitHub Pages + GitHub Actions CI/CD
