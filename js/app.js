// Top-level stub to prevent any early inline onclick errors
window.setDashboardMode = function(mode) {
    window._pendingMode = mode;
};

document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 Initializing Den Chai Solar WebGIS Engine (Facets & Buildings Mode)...');

    const basePath = window.location.href.substring(0, window.location.href.lastIndexOf('/') + 1);

    // 1. State & Data
    let denchaiStats = null;
    let currentMode = 'facets'; // 'facets', 'buildings', 'overview'
    const activeTiers = new Set(['Tier 3', 'Tier 2', 'Tier 1', 'Sub-optimal']);
    let currentTariff = 4.50; // THB / kWh
    let currentCostPerKwp = 32000; // THB / kWp
    let selectedFeatureId = null;
    let selectedLayerSource = null;
    let lastPopupInfo = null; // store last clicked feature to dynamically update on slider change

    try {
        const statsRes = await fetch(basePath + 'data/denchai_stats.json');
        denchaiStats = await statsRes.json();
        
        renderKPIs(denchaiStats, 'facets');
        renderTierList(denchaiStats.tiers);
        renderOrientationList(denchaiStats.orientations);
        renderSummaryCard(denchaiStats);
    } catch (err) {
        console.error('Failed to load stats JSON:', err);
    }

    // 2. Initialize MapLibre GL Map
    const map = new maplibregl.Map({
        container: 'map',
        style: {
            version: 8,
            sources: {
                'carto-light': {
                    type: 'raster',
                    tiles: [
                        'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
                        'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
                        'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png'
                    ],
                    tileSize: 256,
                    attribution: '&copy; <a href="https://carto.com/">CARTO</a>'
                },
                'carto-dark': {
                    type: 'raster',
                    tiles: [
                        'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
                        'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
                        'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png'
                    ],
                    tileSize: 256,
                    attribution: '&copy; <a href="https://carto.com/">CARTO</a>'
                },
                'esri-satellite': {
                    type: 'raster',
                    tiles: [
                        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
                    ],
                    tileSize: 256,
                    attribution: '&copy; ESRI World Imagery'
                },
                'osm-standard': {
                    type: 'raster',
                    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
                    tileSize: 256,
                    attribution: '&copy; OpenStreetMap'
                }
            },
            layers: [
                {
                    id: 'base-light',
                    type: 'raster',
                    source: 'carto-light',
                    layout: { visibility: 'visible' }
                },
                {
                    id: 'base-carto',
                    type: 'raster',
                    source: 'carto-dark',
                    layout: { visibility: 'none' }
                },
                {
                    id: 'base-satellite',
                    type: 'raster',
                    source: 'esri-satellite',
                    layout: { visibility: 'none' }
                },
                {
                    id: 'base-osm',
                    type: 'raster',
                    source: 'osm-standard',
                    layout: { visibility: 'none' }
                }
            ]
        },
        center: [100.0554, 17.9861], // Den Chai Municipality Center
        zoom: 14.8,
        minZoom: 12,
        maxZoom: 21,
        pitch: 25,
        bearing: 0
    });

    // Add navigation and scale controls
    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-right');

    map.on('load', () => {
        console.log('🗺️ MapLibre Map Loaded. Adding Den Chai Layers...');

        // 3. Add 10 cm UAV Orthophoto Tile Layer
        map.addSource('uav-tiles-10cm', {
            type: 'raster',
            tiles: [basePath + 'tiles/uav/{z}/{x}/{y}.webp'],
            tileSize: 256,
            minzoom: 14,
            maxzoom: 20,
            bounds: [100.020, 17.960, 100.090, 18.015]
        });

        map.addLayer({
            id: 'layer-uav-10cm',
            type: 'raster',
            source: 'uav-tiles-10cm',
            layout: { visibility: 'visible' },
            paint: { 'raster-opacity': 0.95 }
        });

        // 4. Add Den Chai Municipal Administrative Boundary
        map.addSource('denchai-admin', {
            type: 'geojson',
            data: basePath + 'data/denchai_boundary.geojson'
        });

        map.addLayer({
            id: 'layer-admin-outline',
            type: 'line',
            source: 'denchai-admin',
            paint: {
                'line-color': '#10b981',
                'line-width': 2.5,
                'line-dasharray': [3, 1.5]
            }
        });

        // 5. Add Buildings Layer (5,558 features)
        map.addSource('denchai-buildings', {
            type: 'geojson',
            data: basePath + 'data/denchai_buildings.geojson',
            promoteId: 'id'
        });

        map.addLayer({
            id: 'layer-buildings-fill',
            type: 'fill',
            source: 'denchai-buildings',
            layout: { visibility: 'none' },
            paint: {
                'fill-color': [
                    'match',
                    ['get', 'tier'],
                    'Tier 3', '#f97316',
                    'Tier 2', '#eab308',
                    'Tier 1', '#06b6d4',
                    '#64748b'
                ],
                'fill-opacity': [
                    'case',
                    ['boolean', ['feature-state', 'hover'], false], 0.95,
                    ['boolean', ['feature-state', 'selected'], false], 1.0,
                    0.78
                ]
            }
        });

        map.addLayer({
            id: 'layer-buildings-line',
            type: 'line',
            source: 'denchai-buildings',
            layout: { visibility: 'none' },
            paint: {
                'line-color': [
                    'case',
                    ['boolean', ['feature-state', 'selected'], false], '#ffffff',
                    '#38bdf8'
                ],
                'line-width': [
                    'case',
                    ['boolean', ['feature-state', 'selected'], false], 2.5,
                    1.2
                ]
            }
        });

        // 6. Add Rooftop Solar Facets Layer (17,344 features)
        map.addSource('solar-facets', {
            type: 'geojson',
            data: basePath + 'data/denchai_solar_facets.geojson',
            promoteId: 'id'
        });

        map.addLayer({
            id: 'layer-facets-fill',
            type: 'fill',
            source: 'solar-facets',
            layout: { visibility: 'visible' },
            paint: {
                'fill-color': [
                    'match',
                    ['get', 'tier'],
                    'Tier 3', '#f97316',
                    'Tier 2', '#eab308',
                    'Tier 1', '#06b6d4',
                    '#64748b'
                ],
                'fill-opacity': [
                    'case',
                    ['boolean', ['feature-state', 'hover'], false], 0.95,
                    ['boolean', ['feature-state', 'selected'], false], 1.0,
                    0.80
                ]
            }
        });

        map.addLayer({
            id: 'layer-facets-stroke',
            type: 'line',
            source: 'solar-facets',
            layout: { visibility: 'visible' },
            paint: {
                'line-color': [
                    'case',
                    ['boolean', ['feature-state', 'selected'], false], '#ffffff',
                    'rgba(255, 255, 255, 0.4)'
                ],
                'line-width': [
                    'case',
                    ['boolean', ['feature-state', 'selected'], false], 2.5,
                    0.7
                ]
            }
        });

        // 7. Setup Interactivity
        setupMapInteractions(map);
    });

    // ── Interaction Handlers ──
    let hoveredStateId = null;
    let hoveredSource = null;
    const popup = new maplibregl.Popup({
        closeButton: true,
        closeOnClick: false,
        maxWidth: '340px'
    });

    function setupMapInteractions(map) {
        const layers = [
            { fill: 'layer-facets-fill', source: 'solar-facets', type: 'facet' },
            { fill: 'layer-buildings-fill', source: 'denchai-buildings', type: 'building' }
        ];

        layers.forEach(({ fill, source, type }) => {
            map.on('mousemove', fill, (e) => {
                if (e.features.length > 0) {
                    map.getCanvas().style.cursor = 'pointer';
                    if (hoveredStateId !== null && hoveredSource !== null) {
                        map.setFeatureState({ source: hoveredSource, id: hoveredStateId }, { hover: false });
                    }
                    hoveredStateId = e.features[0].id;
                    hoveredSource = source;
                    map.setFeatureState({ source: hoveredSource, id: hoveredStateId }, { hover: true });
                }
            });

            map.on('mouseleave', fill, () => {
                map.getCanvas().style.cursor = '';
                if (hoveredStateId !== null && hoveredSource !== null) {
                    map.setFeatureState({ source: hoveredSource, id: hoveredStateId }, { hover: false });
                }
                hoveredStateId = null;
                hoveredSource = null;
            });

            map.on('click', fill, (e) => {
                if (!e.features.length) return;
                const feat = e.features[0];
                const props = feat.properties;

                if (selectedFeatureId !== null && selectedLayerSource !== null) {
                    map.setFeatureState({ source: selectedLayerSource, id: selectedFeatureId }, { selected: false });
                }
                selectedFeatureId = feat.id;
                selectedLayerSource = source;
                map.setFeatureState({ source: selectedLayerSource, id: selectedFeatureId }, { selected: true });

                lastPopupInfo = { props, type, lngLat: e.lngLat };
                showInspectorPopup(props, type, e.lngLat);
            });
        });
    }

    function showInspectorPopup(props, type, lngLat) {
        const isBuilding = (type === 'building');
        const cap_kw = parseFloat(props.capacity_kwp) || 0;
        const annual_kwh = parseFloat(props.energy_corrected_kwh || props.energy_kwh) || 0;
        const annual_thb = annual_kwh * currentTariff;
        const estimated_invest = cap_kw * currentCostPerKwp;
        const payback_yrs = annual_thb > 0 ? (estimated_invest / annual_thb).toFixed(1) : 'N/A';
        const co2_ton = (annual_kwh * 0.0004999).toFixed(2);

        const tierName = props.tier || 'Tier 3';
        const tierColor = props.tier_color || '#f97316';
        const titleBadge = isBuilding ? '🏗️ อาคารรวม (Building Footprint)' : '🏢 ระนาบหลังคา 3D (Rooftop Facet)';
        const titleLabel = isBuilding ? (props.building_id || 'อาคารเด่นชัย') : (props.class_name ? `${props.class_name} (${props.id})` : props.id);

        const area2d = props.area_2d ? Number(props.area_2d).toFixed(1) : 'N/A';
        const area3d = props.area_3d ? Number(props.area_3d).toFixed(1) : 'N/A';

        const popupHtml = `
            <div style="font-family: 'Inter', sans-serif;">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
                    <span style="font-size: 0.68rem; font-weight: 700; color: ${isBuilding ? '#38bdf8' : '#10b981'}; text-transform: uppercase;">
                        ${titleBadge}
                    </span>
                    <span style="background: ${tierColor}; color: #fff; padding: 2px 8px; border-radius: 6px; font-size: 0.7rem; font-weight: 700;">
                        ${tierName}
                    </span>
                </div>
                <div style="font-size: 1.05rem; font-weight: 800; color: #fff; margin-bottom: 10px;">
                    ${titleLabel}
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 0.76rem; background: rgba(255,255,255,0.04); padding: 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.06);">
                    <div><span style="color:#94a3b8;">พื้นที่ 2D:</span> <b style="color:#fff;">${area2d} m²</b></div>
                    <div><span style="color:#94a3b8;">พื้นที่ 3D ชดเชย:</span> <b style="color:#fff;">${area3d} m²</b></div>
                    <div><span style="color:#94a3b8;">กำลังผลิต (PV):</span> <b style="color:#f97316; font-family: 'JetBrains Mono';">${cap_kw.toFixed(1)} kWp</b></div>
                    <div><span style="color:#94a3b8;">ผลผลิตต่อปี:</span> <b style="color:#eab308; font-family: 'JetBrains Mono';">${Math.round(annual_kwh).toLocaleString()} kWh</b></div>
                    <div><span style="color:#94a3b8;">ประหยัดค่าไฟ:</span> <b style="color:#10b981; font-family: 'JetBrains Mono';">${Math.round(annual_thb).toLocaleString()} ฿/y</b></div>
                    <div><span style="color:#94a3b8;">ระยะคืนทุน:</span> <b style="color:#38bdf8; font-family: 'JetBrains Mono';">${payback_yrs} ปี</b></div>
                </div>
                ${!isBuilding && props.slope_deg !== undefined ? `
                <div style="display: flex; justify-content: space-between; margin-top: 8px; font-size: 0.7rem; color: #94a3b8; background: rgba(0,0,0,0.25); padding: 6px 8px; border-radius: 6px;">
                    <span>ความลาดชัน: <b style="color:#fff;">${props.slope_deg}°</b></span>
                    <span>ทิศทาง: <b style="color:#fff;">${props.aspect_deg}°</b></span>
                    <span>f_az: <b style="color:#eab308;">${props.solar_correction || 1.0}</b></span>
                </div>` : ''}
                <div style="margin-top: 8px; font-size: 0.72rem; color: #10b981; display: flex; align-items: center; gap: 4px;">
                    🌱 ลดการปล่อยก๊าซเรือนกระจก: <b>${co2_ton} tCO₂e/ปี</b>
                </div>
            </div>
        `;

        popup.setLngLat(lngLat).setHTML(popupHtml).addTo(map);
    }

    // ── Mode Switcher Engine ──
    window.setDashboardMode = function(mode) {
        currentMode = mode;
        console.log(`Switched to Mode: ${mode}`);

        // Update button states
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        if (mode === 'facets') document.getElementById('btn-mode-facets')?.classList.add('active');
        if (mode === 'buildings') document.getElementById('btn-mode-buildings')?.classList.add('active');
        if (mode === 'overview') document.getElementById('btn-mode-overview')?.classList.add('active');

        // Layer Panel Checkboxes
        const chkFacets = document.getElementById('chk-facets');
        const chkBld = document.getElementById('chk-buildings');
        const compContainer = document.getElementById('comparison-container');
        const orientSection = document.getElementById('orientation-section');

        const kpiLabelCount = document.getElementById('kpi-label-count');
        const kpiUnitCount = document.getElementById('kpi-unit-count');
        const kpiFacets = document.getElementById('kpi-facets');
        const kpiSubArea = document.getElementById('kpi-sub-area');
        const kpiSubCap = document.getElementById('kpi-sub-cap');

        if (mode === 'facets') {
            map.setLayoutProperty('layer-facets-fill', 'visibility', 'visible');
            map.setLayoutProperty('layer-facets-stroke', 'visibility', 'visible');
            map.setLayoutProperty('layer-buildings-fill', 'visibility', 'none');
            map.setLayoutProperty('layer-buildings-line', 'visibility', 'none');

            if (chkFacets) chkFacets.checked = true;
            if (chkBld) chkBld.checked = false;
            if (compContainer) compContainer.style.display = 'none';
            if (orientSection) orientSection.style.display = 'block';

            if (kpiLabelCount) kpiLabelCount.textContent = 'ระนาบหลังคาทั้งหมด';
            if (kpiUnitCount) kpiUnitCount.textContent = 'ระนาบ';
            if (kpiFacets) kpiFacets.textContent = '17,344';
            if (kpiSubArea) kpiSubArea.textContent = 'พื้นที่หลังคา 1,264,554 m²';
            if (kpiSubCap) kpiSubCap.textContent = 'รองรับการติดตั้งแผงโซลาร์เซลล์บนหลังคา 17,344 ระนาบ';

            if (denchaiStats) {
                renderKPIs(denchaiStats, 'facets');
                renderTierList(denchaiStats.tiers);
            }
        } else if (mode === 'buildings') {
            map.setLayoutProperty('layer-facets-fill', 'visibility', 'none');
            map.setLayoutProperty('layer-facets-stroke', 'visibility', 'none');
            map.setLayoutProperty('layer-buildings-fill', 'visibility', 'visible');
            map.setLayoutProperty('layer-buildings-line', 'visibility', 'visible');

            if (chkFacets) chkFacets.checked = false;
            if (chkBld) chkBld.checked = true;
            if (compContainer) compContainer.style.display = 'none';
            if (orientSection) orientSection.style.display = 'none';

            if (kpiLabelCount) kpiLabelCount.textContent = 'อาคารทั้งหมด';
            if (kpiUnitCount) kpiUnitCount.textContent = 'หลัง';
            if (kpiFacets) kpiFacets.textContent = '5,558';
            if (kpiSubArea) kpiSubArea.textContent = 'พื้นที่หลังคาเฉลี่ย 227.5 m²/หลัง';
            if (kpiSubCap) kpiSubCap.textContent = 'ครอบคลุมสิ่งปลูกสร้างในเขตเทศบาล 5,558 หลังคาเรือน';

            if (denchaiStats) {
                renderKPIs(denchaiStats, 'buildings');
                renderTierList(denchaiStats.tiers);
            }
        } else if (mode === 'overview') {
            map.setLayoutProperty('layer-facets-fill', 'visibility', 'visible');
            map.setLayoutProperty('layer-facets-stroke', 'visibility', 'visible');
            map.setLayoutProperty('layer-buildings-fill', 'visibility', 'none');
            map.setLayoutProperty('layer-buildings-line', 'visibility', 'visible');

            if (chkFacets) chkFacets.checked = true;
            if (chkBld) chkBld.checked = true;
            if (compContainer) compContainer.style.display = 'block';
            if (orientSection) orientSection.style.display = 'block';

            if (kpiLabelCount) kpiLabelCount.textContent = 'ระนาบหลังคาทั้งหมด';
            if (kpiUnitCount) kpiUnitCount.textContent = 'ระนาบ';
            if (kpiFacets) kpiFacets.textContent = '17,344';
            if (kpiSubArea) kpiSubArea.textContent = '5,558 หลังคาเรือน (1.26 ล้าน m²)';
            if (kpiSubCap) kpiSubCap.textContent = 'ศักยภาพรวม 252.91 MWp (เฉลี่ย 3.12 ระนาบ/อาคาร)';

            if (denchaiStats) {
                renderKPIs(denchaiStats, 'overview');
                renderTierList(denchaiStats.tiers);
            }
        }
    };

    // Attach explicit click listeners to buttons
    document.getElementById('btn-mode-facets')?.addEventListener('click', () => window.setDashboardMode('facets'));
    document.getElementById('btn-mode-buildings')?.addEventListener('click', () => window.setDashboardMode('buildings'));
    document.getElementById('btn-mode-overview')?.addEventListener('click', () => window.setDashboardMode('overview'));

    // Check if any mode was clicked before initialization completed
    if (window._pendingMode) {
        window.setDashboardMode(window._pendingMode);
        window._pendingMode = null;
    }

    // ── Tier Filter Controls ──
    window.toggleTier = function(tierName) {
        if (activeTiers.has(tierName)) {
            if (activeTiers.size === 1) return;
            activeTiers.delete(tierName);
        } else {
            activeTiers.add(tierName);
        }

        document.querySelectorAll('.tier-item').forEach(el => {
            const t = el.dataset.tier;
            if (activeTiers.has(t)) el.classList.add('active');
            else el.classList.remove('active');
        });

        const filterExp = ['match', ['get', 'tier'], Array.from(activeTiers), true, false];

        if (map.getLayer('layer-facets-fill')) map.setFilter('layer-facets-fill', filterExp);
        if (map.getLayer('layer-facets-stroke')) map.setFilter('layer-facets-stroke', filterExp);
        if (map.getLayer('layer-buildings-fill')) map.setFilter('layer-buildings-fill', filterExp);
        if (map.getLayer('layer-buildings-line')) map.setFilter('layer-buildings-line', filterExp);
    };

    // ── Basemap & Layer Switching ──
    window.switchBasemap = function(baseId) {
        ['base-light', 'base-carto', 'base-satellite', 'base-osm'].forEach(id => {
            if (map.getLayer(id)) {
                map.setLayoutProperty(id, 'visibility', id === baseId ? 'visible' : 'none');
            }
        });
        document.querySelectorAll('.base-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.base === baseId);
        });
    };

    window.toggleTheme = function() {
        document.body.classList.toggle('theme-light');
        const isLight = document.body.classList.contains('theme-light');
        window.switchBasemap(isLight ? 'base-light' : 'base-carto');
    };

    window.toggleUavLayer = function(checkbox) {
        map.setLayoutProperty('layer-uav-10cm', 'visibility', checkbox.checked ? 'visible' : 'none');
    };

    window.toggleFacetsLayer = function(checkbox) {
        const vis = checkbox.checked ? 'visible' : 'none';
        map.setLayoutProperty('layer-facets-fill', 'visibility', vis);
        map.setLayoutProperty('layer-facets-stroke', 'visibility', vis);
    };

    window.toggleBuildingsLayer = function(checkbox) {
        const vis = checkbox.checked ? 'visible' : 'none';
        if (currentMode === 'buildings') {
            map.setLayoutProperty('layer-buildings-fill', 'visibility', vis);
        }
        map.setLayoutProperty('layer-buildings-line', 'visibility', vis);
    };

    window.toggleAdminLayer = function(checkbox) {
        map.setLayoutProperty('layer-admin-outline', 'visibility', checkbox.checked ? 'visible' : 'none');
    };

    window.toggleLayerPanel = function() {
        document.getElementById('layer-panel').classList.toggle('open');
    };

    window.toggleSidebar = function() {
        document.getElementById('sidebar').classList.toggle('collapsed');
    };

    // ── Tariff & Investment Simulator ──
    window.updateTariff = function(val) {
        currentTariff = parseFloat(val);
        document.getElementById('tariff-val').textContent = currentTariff.toFixed(2) + ' ฿';
        if (denchaiStats) {
            const gen = denchaiStats.total_generation_gwh_yr || 316.33;
            const newTotalSavings = (gen * 1e6 * currentTariff / 1e6).toFixed(2);
            document.getElementById('kpi-savings').textContent = Number(newTotalSavings).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }
        if (lastPopupInfo && popup.isOpen()) {
            showInspectorPopup(lastPopupInfo.props, lastPopupInfo.type, lastPopupInfo.lngLat);
        }
    };

    window.updateCostPerKwp = function(val) {
        currentCostPerKwp = parseInt(val);
        document.getElementById('cost-val').textContent = currentCostPerKwp.toLocaleString() + ' ฿';
        if (lastPopupInfo && popup.isOpen()) {
            showInspectorPopup(lastPopupInfo.props, lastPopupInfo.type, lastPopupInfo.lngLat);
        }
    };

    // ── Render Dynamic UI Data ──
    function renderKPIs(stats, mode) {
        if (!stats) return;
        document.getElementById('kpi-capacity').textContent = stats.total_capacity_mwp.toFixed(2);
        document.getElementById('kpi-generation').textContent = stats.total_generation_gwh_yr.toFixed(2);
        const dynamicSavings = (stats.total_generation_gwh_yr * 1e6 * currentTariff / 1e6).toFixed(2);
        document.getElementById('kpi-savings').textContent = Number(dynamicSavings).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        document.getElementById('kpi-co2').textContent = Math.round(stats.total_co2_offset_tons_yr).toLocaleString();
    }

    function renderTierList(tiers) {
        const container = document.getElementById('tier-list-container');
        if (!container || !tiers) return;
        container.innerHTML = '';

        const tierMeta = [
            { key: 'Tier 3', name: 'Tier 3 (>15 kWp)', desc: 'อาคารพาณิชย์และหลังคาขนาดใหญ่' },
            { key: 'Tier 2', name: 'Tier 2 (5–15 kWp)', desc: 'อาคารขนาดกลางและบ้านพักอาศัย' },
            { key: 'Tier 1', name: 'Tier 1 (2.5–5 kWp)', desc: 'ทาวน์เฮาส์และโซลาร์ขนาดเล็ก' },
            { key: 'Sub-optimal', name: 'Sub-optimal (<2.5 kWp)', desc: 'หลังคาส่วนต่อเติมขนาดเล็ก' }
        ];

        tierMeta.forEach(m => {
            const data = tiers[m.key];
            if (!data) return;
            const div = document.createElement('div');
            div.className = 'tier-item active';
            div.dataset.tier = m.key;
            div.onclick = () => window.toggleTier(m.key);

            div.innerHTML = `
                <div class="tier-left">
                    <div class="tier-badge" style="background: ${data.color};"></div>
                    <div>
                        <div class="tier-name">${m.name}</div>
                        <div class="tier-desc">${m.desc}</div>
                    </div>
                </div>
                <div class="tier-right">
                    <div class="tier-mwp">${data.cap_mwp.toFixed(1)} MWp</div>
                    <div class="tier-count">${data.count.toLocaleString()} ระนาบ (${data.pct_count.toFixed(1)}%)</div>
                </div>
            `;
            container.appendChild(div);
        });
    }

    function renderOrientationList(orientations) {
        const container = document.getElementById('orient-list-container');
        if (!container || !orientations) return;
        container.innerHTML = '';

        const keys = ['Sroof', 'Wroof', 'Eroof', 'Nroof', 'Froof', 'Uroof', 'PV'];
        const colors = {
            'Sroof': '#10b981',
            'Wroof': '#f59e0b',
            'Eroof': '#3b82f6',
            'Nroof': '#8b5cf6',
            'Froof': '#06b6d4',
            'Uroof': '#64748b',
            'PV': '#ec4899'
        };

        keys.forEach(k => {
            const item = orientations[k];
            if (!item) return;
            const color = colors[k] || '#38bdf8';
            const div = document.createElement('div');
            div.style.cssText = 'background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 6px; padding: 6px 10px; display: flex; justify-content: space-between; align-items: center; font-size: 0.74rem;';

            div.innerHTML = `
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="width: 8px; height: 8px; border-radius: 50%; background: ${color}; display: inline-block;"></span>
                    <span style="color: #f1f5f9; font-weight: 600;">${item.label}</span>
                </div>
                <div style="text-align: right; font-family: 'JetBrains Mono';">
                    <span style="color: #f97316; font-weight: 700;">${item.cap_mwp.toFixed(1)} MWp</span>
                    <span style="color: #94a3b8; font-size: 0.68rem;"> (${item.count.toLocaleString()})</span>
                </div>
            `;
            container.appendChild(div);
        });
    }

    function renderSummaryCard(stats) {
        const container = document.getElementById('comparison-container');
        if (!container || !stats) return;

        container.innerHTML = `
            <div class="comparison-card">
                <div class="comparison-header">
                    <span>📊 ตารางเปรียบเทียบสถิติเชิงประจักษ์ (Empirical Matrix)</span>
                </div>
                <table class="comp-table">
                    <thead>
                        <tr>
                            <th>ดัชนีชี้วัด (Metric)</th>
                            <th style="text-align:right;">ระนาบ 3D</th>
                            <th style="text-align:right;">อาคารรวม</th>
                            <th style="text-align:right;">สัดส่วน</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td><b>จำนวนฟีเจอร์</b></td>
                            <td class="num">17,344 ระนาบ</td>
                            <td class="num" style="color: #38bdf8;">5,558 หลัง</td>
                            <td class="num"><span class="comp-badge high">3.12 ระนาบ/หลัง</span></td>
                        </tr>
                        <tr>
                            <td><b>กำลังผลิต (MWp)</b></td>
                            <td class="num">252.91 MWp</td>
                            <td class="num" style="color: #f97316;">252.89 MWp</td>
                            <td class="num"><span class="comp-badge high">99.99%</span></td>
                        </tr>
                        <tr>
                            <td><b>ผลผลิตไฟฟ้า (GWh/y)</b></td>
                            <td class="num">316.33 GWh</td>
                            <td class="num" style="color: #eab308;">316.30 GWh</td>
                            <td class="num"><span class="comp-badge high">99.99%</span></td>
                        </tr>
                        <tr>
                            <td><b>ประหยัดค่าไฟ (ล้าน฿/ปี)</b></td>
                            <td class="num">1,423.47</td>
                            <td class="num" style="color: #10b981;">1,423.34</td>
                            <td class="num"><span class="comp-badge high">99.99%</span></td>
                        </tr>
                        <tr>
                            <td><b>ลดก๊าซเรือนกระจก (ตัน)</b></td>
                            <td class="num">158,131 t</td>
                            <td class="num" style="color: #38bdf8;">158,117 t</td>
                            <td class="num"><span class="comp-badge high">99.99%</span></td>
                        </tr>
                    </tbody>
                </table>
                <div style="font-size: 0.7rem; color: #94a3b8; line-height: 1.4; background: rgba(0,0,0,0.3); padding: 8px; border-radius: 6px;">
                    🎯 <b>ผลการวิเคราะห์ GeoAI:</b> การวิเคราะห์เชิงระนาบ 3 มิติ (17,344 ระนาบ) ช่วยจำแนกความลาดชันและทิศทางแสงอาทิตย์ได้ละเอียดกว่าระดับอาคาร โดยคิดลดการบดบังและค่า Solar Correction Factor ($f_{az}$) รายระนาบอย่างแม่นยำ
                </div>
            </div>
        `;
    }
});
