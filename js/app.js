// ==========================================================================
// Den Chai Solar WebGIS Engine (3D Facets & Buildings Mode)
// UAV-SolarNet GeoAI Framework | Elsevier RSASE 2026
// ==========================================================================

// Global State
let map = null;
let denchaiStats = null;
let currentMode = 'facets'; // 'facets', 'buildings', 'overview'
let is3DMode = false;
let current3DSubMode = 'combined'; // 'facets', 'buildings', 'combined'
let currentFacetColorMode = 'orient'; // 'tier', 'orient'
const activeTiers = new Set(['Tier 3', 'Tier 2', 'Tier 1', 'Sub-optimal']);
let currentTariff = 4.50; // THB / kWh
let currentCostPerKwp = 32000; // THB / kWp
let selectedFeatureId = null;
let selectedLayerSource = null;
let lastPopupInfo = null;
let hoveredStateId = null;
let hoveredSource = null;
let popup = null;
let isMapLoaded = false;
const pendingActions = [];
const deletedFacetIds = new Set();

// ── Top-Level Window API (Defined immediately to guarantee zero inline onclick errors) ──

window.deleteFacet = async function(facetId) {
    if (!facetId) return;
    if (!confirm(`ยืนยันการลบระนาบ [${facetId}] ออกจากระบบใช่หรือไม่?\n(เช่น ตรวจพบว่าเป็นถนนหรือพื้นดินที่แปลผลคลาดเคลื่อน)`)) {
        return;
    }

    deletedFacetIds.add(String(facetId));
    applyDeletedFacetsFilter();

    if (popup && popup.isOpen()) popup.remove();

    try {
        const res = await fetch('/api/delete_facet', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: facetId })
        });
        const result = await res.json();
        if (result.success) {
            showToast(`🗑️ ลบระนาบ ${facetId} เรียบร้อยแล้ว (เหลือ ${result.remaining_facets.toLocaleString()} ระนาบ)`);
            if (denchaiStats) {
                denchaiStats.total_facets = result.remaining_facets;
                const kpiF = document.getElementById('kpi-facets');
                if (kpiF) kpiF.textContent = result.remaining_facets.toLocaleString();
            }
        } else {
            showToast(`⚠️ เกิดข้อผิดพลาดในการลบ: ${result.error || 'Unknown error'}`);
        }
    } catch (err) {
        console.error('Delete error:', err);
        showToast(`🗑️ ลบระนาบ ${facetId} ออกจากมุมมองแผนที่แล้ว`);
    }
};

function applyDeletedFacetsFilter() {
    if (!isMapLoaded || deletedFacetIds.size === 0) return;
    const delList = Array.from(deletedFacetIds);
    const excludeFilter = ['!', ['in', ['to-string', ['get', 'id']], ['literal', delList]]];
    const tierFilter = ['match', ['get', 'tier'], Array.from(activeTiers), true, false];
    const combinedFilter = ['all', tierFilter, excludeFilter];

    if (map.getLayer('layer-facets-fill')) map.setFilter('layer-facets-fill', combinedFilter);
    if (map.getLayer('layer-facets-stroke')) map.setFilter('layer-facets-stroke', combinedFilter);
    if (map.getLayer('layer-facets-3d')) map.setFilter('layer-facets-3d', combinedFilter);
}

function showToast(msg) {
    let toast = document.getElementById('webgis-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'webgis-toast';
        toast.style.cssText = 'position: fixed; bottom: 25px; left: 50%; transform: translateX(-50%); background: rgba(15, 23, 42, 0.95); backdrop-filter: blur(12px); color: #fff; border: 1px solid rgba(56, 189, 248, 0.4); border-radius: 10px; padding: 10px 18px; font-size: 0.8rem; font-weight: 600; z-index: 9999; box-shadow: 0 10px 30px rgba(0,0,0,0.6); transition: opacity 0.3s ease; display: flex; align-items: center; gap: 8px;';
        document.body.appendChild(toast);
    }
    toast.innerHTML = msg;
    toast.style.opacity = '1';
    toast.style.display = 'flex';
    clearTimeout(window._toastTimeout);
    window._toastTimeout = setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => { toast.style.display = 'none'; }, 300);
    }, 4000);
}

window.toggle3DCity = function() {
    if (!isMapLoaded) {
        pendingActions.push(() => window.toggle3DCity());
        return;
    }
    is3DMode = !is3DMode;
    const btn = document.getElementById('btn-3d-city');
    const pnl3d = document.getElementById('city-3d-controls');
    const chkBld = document.getElementById('chk-buildings');

    if (is3DMode) {
        if (btn) {
            btn.style.background = 'rgba(245, 158, 11, 0.45)';
            btn.style.boxShadow = '0 0 15px rgba(245, 158, 11, 0.6)';
            btn.innerHTML = `
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
                <span>🗺️ มุมมอง 2 มิติ (2D Map)</span>
            `;
        }
        if (pnl3d) pnl3d.style.display = 'block';
        if (chkBld) chkBld.checked = true;

        // Hide 2D flat fills while in 3D mode
        if (map.getLayer('layer-facets-fill')) map.setLayoutProperty('layer-facets-fill', 'visibility', 'none');
        if (map.getLayer('layer-facets-stroke')) map.setLayoutProperty('layer-facets-stroke', 'visibility', 'none');
        if (map.getLayer('layer-buildings-fill')) map.setLayoutProperty('layer-buildings-fill', 'visibility', 'none');

        // Apply active 3D submode
        window.set3DSubMode(current3DSubMode);

        if (map.getLayer('layer-buildings-line')) {
            map.setLayoutProperty('layer-buildings-line', 'visibility', 'visible');
        }

        map.easeTo({
            pitch: 58,
            bearing: -25,
            duration: 1500
        });
    } else {
        if (btn) {
            btn.style.background = 'rgba(245, 158, 11, 0.2)';
            btn.style.boxShadow = 'none';
            btn.innerHTML = `
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
                <span>🏙️ มุมมอง 3 มิติ (3D City)</span>
            `;
        }
        if (pnl3d) pnl3d.style.display = 'none';

        if (map.getLayer('layer-buildings-3d')) {
            map.setLayoutProperty('layer-buildings-3d', 'visibility', 'none');
        }
        if (map.getLayer('layer-facets-3d')) {
            map.setLayoutProperty('layer-facets-3d', 'visibility', 'none');
        }

        // Restore 2D mode layers
        window.setDashboardMode(currentMode);

        map.easeTo({
            pitch: 0,
            bearing: 0,
            duration: 1200
        });
    }
};

window.set3DSubMode = function(subMode) {
    current3DSubMode = subMode;
    document.getElementById('btn-3d-sub-bld')?.classList.toggle('active', subMode === 'buildings');
    document.getElementById('btn-3d-sub-facet')?.classList.toggle('active', subMode === 'facets');
    document.getElementById('btn-3d-sub-comb')?.classList.toggle('active', subMode === 'combined');

    if (!is3DMode || !isMapLoaded) return;

    if (subMode === 'buildings') {
        // Whole 3D Buildings (Walls from Ground to Eave)
        if (map.getLayer('layer-buildings-3d')) {
            map.setLayoutProperty('layer-buildings-3d', 'visibility', 'visible');
            map.setPaintProperty('layer-buildings-3d', 'fill-extrusion-opacity', 0.88);
            map.setPaintProperty('layer-buildings-3d', 'fill-extrusion-color', [
                'case',
                ['has', 'tier_color'], ['get', 'tier_color'],
                '#38bdf8'
            ]);
        }
        if (map.getLayer('layer-facets-3d')) {
            map.setLayoutProperty('layer-facets-3d', 'visibility', 'none');
        }
    } else if (subMode === 'facets') {
        // Separate 3D Roof Facets (elevated at real roof base height!)
        if (map.getLayer('layer-buildings-3d')) {
            map.setLayoutProperty('layer-buildings-3d', 'visibility', 'none');
        }
        if (map.getLayer('layer-facets-3d')) {
            map.setLayoutProperty('layer-facets-3d', 'visibility', 'visible');
            map.setPaintProperty('layer-facets-3d', 'fill-extrusion-base', ['coalesce', ['get', 'height_base'], ['get', 'height_eave'], 3.5]);
            map.setPaintProperty('layer-facets-3d', 'fill-extrusion-height', ['coalesce', ['get', 'height_roof'], ['get', 'height_ridge'], 5.5]);
            map.setPaintProperty('layer-facets-3d', 'fill-extrusion-opacity', 0.95);
            applyFacet3DColors();
        }
    } else if (subMode === 'combined') {
        // Combined: semi-transparent building walls + 3D roof facets on top!
        if (map.getLayer('layer-buildings-3d')) {
            map.setLayoutProperty('layer-buildings-3d', 'visibility', 'visible');
            map.setPaintProperty('layer-buildings-3d', 'fill-extrusion-base', 0);
            map.setPaintProperty('layer-buildings-3d', 'fill-extrusion-height', ['coalesce', ['get', 'height_eave'], 3.5]);
            map.setPaintProperty('layer-buildings-3d', 'fill-extrusion-opacity', 0.45);
            map.setPaintProperty('layer-buildings-3d', 'fill-extrusion-color', '#475569');
        }
        if (map.getLayer('layer-facets-3d')) {
            map.setLayoutProperty('layer-facets-3d', 'visibility', 'visible');
            map.setPaintProperty('layer-facets-3d', 'fill-extrusion-base', ['coalesce', ['get', 'height_base'], ['get', 'height_eave'], 3.5]);
            map.setPaintProperty('layer-facets-3d', 'fill-extrusion-height', ['coalesce', ['get', 'height_roof'], ['get', 'height_ridge'], 5.5]);
            map.setPaintProperty('layer-facets-3d', 'fill-extrusion-opacity', 0.98);
            applyFacet3DColors();
        }
    }
};

window.setFacetColorMode = function(colorMode) {
    currentFacetColorMode = colorMode;
    document.getElementById('btn-color-tier')?.classList.toggle('active', colorMode === 'tier');
    document.getElementById('btn-color-orient')?.classList.toggle('active', colorMode === 'orient');
    applyFacet3DColors();
};

function applyFacet3DColors() {
    if (!map || !map.getLayer('layer-facets-3d')) return;
    if (currentFacetColorMode === 'orient') {
        map.setPaintProperty('layer-facets-3d', 'fill-extrusion-color', [
            'case',
            ['has', 'orientation_color'], ['get', 'orientation_color'],
            ['has', 'color'], ['get', 'color'],
            '#3b82f6'
        ]);
    } else {
        map.setPaintProperty('layer-facets-3d', 'fill-extrusion-color', [
            'case',
            ['has', 'tier_color'], ['get', 'tier_color'],
            ['has', 'energy_color'], ['get', 'energy_color'],
            '#eab308'
        ]);
    }
}

window.setDashboardMode = function(mode) {
    currentMode = mode;
    console.log(`Switched to Mode: ${mode}`);

    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    if (mode === 'facets') document.getElementById('btn-mode-facets')?.classList.add('active');
    if (mode === 'buildings') document.getElementById('btn-mode-buildings')?.classList.add('active');
    if (mode === 'overview') document.getElementById('btn-mode-overview')?.classList.add('active');

    const chkFacets = document.getElementById('chk-facets');
    const chkBld = document.getElementById('chk-buildings');
    const compContainer = document.getElementById('comparison-container');
    const orientSection = document.getElementById('orientation-section');

    const kpiLabelCount = document.getElementById('kpi-label-count');
    const kpiUnitCount = document.getElementById('kpi-unit-count');
    const kpiFacets = document.getElementById('kpi-facets');
    const kpiSubArea = document.getElementById('kpi-sub-area');
    const kpiSubCap = document.getElementById('kpi-sub-cap');

    if (!isMapLoaded) {
        pendingActions.push(() => window.setDashboardMode(mode));
        return;
    }

    if (mode === 'facets') {
        if (!is3DMode) {
            map.setLayoutProperty('layer-facets-fill', 'visibility', 'visible');
            map.setLayoutProperty('layer-facets-stroke', 'visibility', 'visible');
            map.setLayoutProperty('layer-buildings-fill', 'visibility', 'none');
            map.setLayoutProperty('layer-buildings-line', 'visibility', 'none');
        }

        if (chkFacets) chkFacets.checked = true;
        if (chkBld) chkBld.checked = false;
        if (compContainer) compContainer.style.display = 'none';
        if (orientSection) orientSection.style.display = 'block';

        if (kpiLabelCount) kpiLabelCount.textContent = 'ระนาบหลังคาทั้งหมด';
        if (kpiUnitCount) kpiUnitCount.textContent = 'ระนาบ';
        if (kpiFacets) kpiFacets.textContent = '16,573';
        if (kpiSubArea) kpiSubArea.textContent = 'พื้นที่หลังคา 1,200,552 m²';
        if (kpiSubCap) kpiSubCap.textContent = 'รองรับการติดตั้งแผงโซลาร์เซลล์บนหลังคา 16,573 ระนาบ';

        if (denchaiStats) {
            renderKPIs(denchaiStats, 'facets');
            renderTierList(denchaiStats.tiers);
        }
    } else if (mode === 'buildings') {
        if (!is3DMode) {
            map.setLayoutProperty('layer-facets-fill', 'visibility', 'none');
            map.setLayoutProperty('layer-facets-stroke', 'visibility', 'none');
            map.setLayoutProperty('layer-buildings-fill', 'visibility', 'visible');
            map.setLayoutProperty('layer-buildings-line', 'visibility', 'visible');
        }

        if (chkFacets) chkFacets.checked = false;
        if (chkBld) chkBld.checked = true;
        if (compContainer) compContainer.style.display = 'none';
        if (orientSection) orientSection.style.display = 'none';

        if (kpiLabelCount) kpiLabelCount.textContent = 'อาคารทั้งหมด';
        if (kpiUnitCount) kpiUnitCount.textContent = 'หลัง';
        if (kpiFacets) kpiFacets.textContent = '4,420';
        if (kpiSubArea) kpiSubArea.textContent = 'พื้นที่หลังคาเฉลี่ย 271.6 m²/หลัง';
        if (kpiSubCap) kpiSubCap.textContent = 'ครอบคลุมสิ่งปลูกสร้างในเขตเทศบาล 4,420 หลังคาเรือน';

        if (denchaiStats) {
            renderKPIs(denchaiStats, 'buildings');
            renderTierList(denchaiStats.tiers);
        }
    } else if (mode === 'overview') {
        if (!is3DMode) {
            map.setLayoutProperty('layer-facets-fill', 'visibility', 'visible');
            map.setLayoutProperty('layer-facets-stroke', 'visibility', 'visible');
            map.setLayoutProperty('layer-buildings-fill', 'visibility', 'none');
            map.setLayoutProperty('layer-buildings-line', 'visibility', 'visible');
        }

        if (chkFacets) chkFacets.checked = true;
        if (chkBld) chkBld.checked = true;
        if (compContainer) compContainer.style.display = 'block';
        if (orientSection) orientSection.style.display = 'block';

        if (kpiLabelCount) kpiLabelCount.textContent = 'ระนาบหลังคาทั้งหมด';
        if (kpiUnitCount) kpiUnitCount.textContent = 'ระนาบ';
        if (kpiFacets) kpiFacets.textContent = '16,573';
        if (kpiSubArea) kpiSubArea.textContent = '4,420 หลังคาเรือน (1.20 ล้าน m²)';
        if (kpiSubCap) kpiSubCap.textContent = 'ศักยภาพรวม 103.94 MWp (เฉลี่ย 3.75 ระนาบ/อาคาร)';

        if (denchaiStats) {
            renderKPIs(denchaiStats, 'overview');
            renderTierList(denchaiStats.tiers);
        }
    }
};

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

    if (!isMapLoaded) return;

    const filterExp = ['match', ['get', 'tier'], Array.from(activeTiers), true, false];
    let facetFilter = filterExp;
    if (deletedFacetIds.size > 0) {
        const delList = Array.from(deletedFacetIds);
        const excludeFilter = ['!', ['in', ['to-string', ['get', 'id']], ['literal', delList]]];
        facetFilter = ['all', filterExp, excludeFilter];
    }

    if (map.getLayer('layer-facets-fill')) map.setFilter('layer-facets-fill', facetFilter);
    if (map.getLayer('layer-facets-stroke')) map.setFilter('layer-facets-stroke', facetFilter);
    if (map.getLayer('layer-buildings-fill')) map.setFilter('layer-buildings-fill', filterExp);
    if (map.getLayer('layer-buildings-line')) map.setFilter('layer-buildings-line', filterExp);
    if (map.getLayer('layer-buildings-3d')) map.setFilter('layer-buildings-3d', filterExp);
    if (map.getLayer('layer-facets-3d')) map.setFilter('layer-facets-3d', facetFilter);
};

window.switchBasemap = function(baseId) {
    if (!isMapLoaded) return;
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
    if (isMapLoaded && map.getLayer('layer-uav-10cm')) {
        map.setLayoutProperty('layer-uav-10cm', 'visibility', checkbox.checked ? 'visible' : 'none');
    }
};

window.toggleFacetsLayer = function(checkbox) {
    if (!isMapLoaded) return;
    const vis = checkbox.checked ? 'visible' : 'none';
    if (!is3DMode) {
        if (map.getLayer('layer-facets-fill')) map.setLayoutProperty('layer-facets-fill', 'visibility', vis);
        if (map.getLayer('layer-facets-stroke')) map.setLayoutProperty('layer-facets-stroke', 'visibility', vis);
    }
    if (map.getLayer('layer-facets-3d')) {
        map.setLayoutProperty('layer-facets-3d', 'visibility', (is3DMode && checkbox.checked && current3DSubMode !== 'buildings') ? 'visible' : 'none');
    }
};

window.toggleBuildingsLayer = function(checkbox) {
    if (!isMapLoaded) return;
    const vis = checkbox.checked ? 'visible' : 'none';
    if (currentMode === 'buildings' && !is3DMode) {
        if (map.getLayer('layer-buildings-fill')) map.setLayoutProperty('layer-buildings-fill', 'visibility', vis);
    }
    if (map.getLayer('layer-buildings-line')) map.setLayoutProperty('layer-buildings-line', 'visibility', vis);
    if (map.getLayer('layer-buildings-3d')) {
        map.setLayoutProperty('layer-buildings-3d', 'visibility', (is3DMode && checkbox.checked && current3DSubMode !== 'facets') ? 'visible' : 'none');
    }
};

window.toggleAdminLayer = function(checkbox) {
    if (isMapLoaded && map.getLayer('layer-admin-outline')) {
        map.setLayoutProperty('layer-admin-outline', 'visibility', checkbox.checked ? 'visible' : 'none');
    }
};

window.toggleLayerPanel = function() {
    document.getElementById('layer-panel')?.classList.toggle('open');
};

window.toggleSidebar = function() {
    document.getElementById('sidebar')?.classList.toggle('collapsed');
};

window.updateTariff = function(val) {
    currentTariff = parseFloat(val);
    const tVal = document.getElementById('tariff-val');
    if (tVal) tVal.textContent = currentTariff.toFixed(2) + ' ฿';
    if (denchaiStats) {
        const gen = denchaiStats.total_generation_gwh_yr || 131.21;
        const newTotalSavings = (gen * 1e6 * currentTariff / 1e6).toFixed(2);
        const kpiSav = document.getElementById('kpi-savings');
        if (kpiSav) kpiSav.textContent = Number(newTotalSavings).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    if (lastPopupInfo && popup && popup.isOpen()) {
        showInspectorPopup(lastPopupInfo.props, lastPopupInfo.type, lastPopupInfo.lngLat);
    }
};

window.updateCostPerKwp = function(val) {
    currentCostPerKwp = parseInt(val);
    const cVal = document.getElementById('cost-val');
    if (cVal) cVal.textContent = currentCostPerKwp.toLocaleString() + ' ฿';
    if (lastPopupInfo && popup && popup.isOpen()) {
        showInspectorPopup(lastPopupInfo.props, lastPopupInfo.type, lastPopupInfo.lngLat);
    }
};

// ── DOM Initialization ──
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 Initializing Den Chai Solar WebGIS Engine (3D Facets & Buildings Mode)...');

    const basePath = window.location.href.substring(0, window.location.href.lastIndexOf('/') + 1);

    // Attach explicit click listeners to prevent any inline event issues
    document.getElementById('btn-3d-city')?.addEventListener('click', window.toggle3DCity);
    document.getElementById('btn-3d-sub-bld')?.addEventListener('click', () => window.set3DSubMode('buildings'));
    document.getElementById('btn-3d-sub-facet')?.addEventListener('click', () => window.set3DSubMode('facets'));
    document.getElementById('btn-3d-sub-comb')?.addEventListener('click', () => window.set3DSubMode('combined'));
    document.getElementById('btn-color-tier')?.addEventListener('click', () => window.setFacetColorMode('tier'));
    document.getElementById('btn-color-orient')?.addEventListener('click', () => window.setFacetColorMode('orient'));
    document.getElementById('btn-mode-facets')?.addEventListener('click', () => window.setDashboardMode('facets'));
    document.getElementById('btn-mode-buildings')?.addEventListener('click', () => window.setDashboardMode('buildings'));
    document.getElementById('btn-mode-overview')?.addEventListener('click', () => window.setDashboardMode('overview'));

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

    // Initialize MapLibre GL Map
    map = new maplibregl.Map({
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
        zoom: 15.2,
        minZoom: 12,
        maxZoom: 21,
        pitch: 25,
        bearing: 0
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-right');

    popup = new maplibregl.Popup({
        closeButton: true,
        closeOnClick: false,
        maxWidth: '340px'
    });

    map.on('load', () => {
        console.log('🗺️ MapLibre Map Loaded. Adding Den Chai Layers...');
        isMapLoaded = true;

        // 1. Add 10 cm UAV Orthophoto Tile Layer
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

        // 2. Add Den Chai Municipal Administrative Boundary
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

        // 3. Add Buildings Layer (4,420 features)
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

        // 4. Add Rooftop Solar Facets Layer (16,573 features)
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

        // 5. Add 3D Extruded Buildings (LoD1 Walls from Ground to Eave Height)
        map.addLayer({
            id: 'layer-buildings-3d',
            type: 'fill-extrusion',
            source: 'denchai-buildings',
            layout: { visibility: 'none' },
            paint: {
                'fill-extrusion-color': [
                    'case',
                    ['has', 'tier_color'], ['get', 'tier_color'],
                    ['has', 'energy_color'], ['get', 'energy_color'],
                    '#38bdf8'
                ],
                'fill-extrusion-height': [
                    'coalesce',
                    ['get', 'height_eave'],
                    ['get', 'height_mean'],
                    3.5
                ],
                'fill-extrusion-base': 0,
                'fill-extrusion-opacity': 0.88
            }
        });

        // 6. Add 3D Extruded Rooftop Solar Facets (Elevated Rooftop Facets)
        map.addLayer({
            id: 'layer-facets-3d',
            type: 'fill-extrusion',
            source: 'solar-facets',
            layout: { visibility: 'none' },
            paint: {
                'fill-extrusion-color': [
                    'case',
                    ['has', 'tier_color'], ['get', 'tier_color'],
                    ['has', 'energy_color'], ['get', 'energy_color'],
                    ['has', 'orientation_color'], ['get', 'orientation_color'],
                    ['has', 'color'], ['get', 'color'],
                    '#eab308'
                ],
                'fill-extrusion-height': [
                    'coalesce',
                    ['get', 'height_roof'],
                    ['get', 'height_ridge'],
                    5.5
                ],
                'fill-extrusion-base': [
                    'coalesce',
                    ['get', 'height_base'],
                    ['get', 'height_eave'],
                    3.2
                ],
                'fill-extrusion-opacity': 0.95
            }
        });

        // 7. Setup Interactivity
        setupMapInteractions(map);

        // Run any queued pending actions
        while (pendingActions.length > 0) {
            const action = pendingActions.shift();
            try { action(); } catch (e) { console.error('Pending action error:', e); }
        }

        // Auto-activate 3D mode if requested via URL hash (#3d) or query (?mode=3d)
        const urlParams = new URLSearchParams(window.location.search);
        if (window.location.hash === '#3d' || urlParams.get('mode') === '3d') {
            setTimeout(() => {
                if (!is3DMode) window.toggle3DCity();
            }, 600);
        }
    });
});

// ── Map Interactions ──
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

    // 3D Building Extrusion Interactions
    map.on('mousemove', 'layer-buildings-3d', () => {
        map.getCanvas().style.cursor = 'pointer';
    });

    map.on('mouseleave', 'layer-buildings-3d', () => {
        map.getCanvas().style.cursor = '';
    });

    map.on('click', 'layer-buildings-3d', (e) => {
        if (!e.features.length) return;
        lastPopupInfo = { props: e.features[0].properties, type: 'building', lngLat: e.lngLat };
        showInspectorPopup(e.features[0].properties, 'building', e.lngLat);
    });

    // 3D Facet Extrusion Interactions
    map.on('mousemove', 'layer-facets-3d', () => {
        map.getCanvas().style.cursor = 'pointer';
    });

    map.on('mouseleave', 'layer-facets-3d', () => {
        map.getCanvas().style.cursor = '';
    });

    map.on('click', 'layer-facets-3d', (e) => {
        if (!e.features.length) return;
        lastPopupInfo = { props: e.features[0].properties, type: 'facet', lngLat: e.lngLat };
        showInspectorPopup(e.features[0].properties, 'facet', e.lngLat);
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
    const orientLabel = props.orientation_th || props.class_name || (isBuilding ? 'อาคารรวม' : 'ระนาบโซลาร์');
    const titleBadge = isBuilding ? '🏗️ แบบจำลองอาคาร 3 มิติ (3D Buildings)' : '🧩 ระนาบหลังคา 3 มิติ (3D Solar Facet)';
    const titleLabel = isBuilding ? (props.building_id || 'อาคารเด่นชัย') : `${orientLabel} (${props.id})`;

    const area2d = parseFloat(props.area_2d) || 0;
    let area3d = parseFloat(props.area_3d);
    if (!area3d || isNaN(area3d)) {
        const slope = parseFloat(props.slope_deg) || 0;
        area3d = slope > 0 ? (area2d / Math.cos(slope * Math.PI / 180)) : area2d;
    }
    const areaUsable = parseFloat(props.area_usable) || (area3d * 0.6);
    const kUsablePct = props.k_usable ? Math.round(props.k_usable * 100) : 60;

    const popupHtml = `
        <div style="font-family: 'Inter', sans-serif; min-width: 290px;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
                <span style="font-size: 0.68rem; font-weight: 700; color: ${isBuilding ? '#38bdf8' : '#10b981'}; text-transform: uppercase;">
                    ${titleBadge}
                </span>
                <span style="background: ${tierColor}; color: #fff; padding: 2px 8px; border-radius: 6px; font-size: 0.7rem; font-weight: 700;">
                    ${tierName}
                </span>
            </div>
            <div style="font-size: 1.05rem; font-weight: 800; color: #fff; margin-bottom: 8px;">
                ${titleLabel}
            </div>

            <!-- Section 1: 3D Physical Surface Dimensions -->
            <div style="background: rgba(15, 23, 42, 0.6); padding: 8px 10px; border-radius: 8px; border: 1px solid rgba(56, 189, 248, 0.25); margin-bottom: 8px;">
                <div style="font-size: 0.68rem; font-weight: 700; color: #38bdf8; margin-bottom: 4px; display: flex; justify-content: space-between;">
                    <span>📐 มิติพื้นที่ระนาบ 3 มิติ (3D Spatial Geometry)</span>
                    <span style="color: #94a3b8; font-size: 0.64rem;">ชดเชย Slope / cos(β)</span>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; font-size: 0.73rem;">
                    <div><span style="color:#94a3b8;">พื้นที่แนวราบ 2D:</span> <b style="color:#cbd5e1;">${area2d.toFixed(1)} m²</b></div>
                    <div><span style="color:#94a3b8;">พื้นที่จริง 3D:</span> <b style="color:#f59e0b; font-family: 'JetBrains Mono';">${area3d.toFixed(1)} m²</b></div>
                    <div style="grid-column: span 2; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 4px; margin-top: 2px;">
                        <span style="color:#94a3b8;">พื้นที่ติดตั้งจริง 3D สุทธิ:</span> 
                        <b style="color:#10b981; font-family: 'JetBrains Mono'; font-size: 0.8rem;">${areaUsable.toFixed(1)} m²</b>
                        <span style="color:#64748b; font-size: 0.65rem;">(หักระยะร่น ${kUsablePct}%)</span>
                    </div>
                </div>
            </div>

            <!-- Section 2: Energy & Solar Potential -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 0.75rem; background: rgba(255,255,255,0.04); padding: 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.06);">
                <div><span style="color:#94a3b8;">กำลังผลิต (คิดจาก 3D):</span> <b style="color:#f97316; font-family: 'JetBrains Mono';">${cap_kw.toFixed(1)} kWp</b></div>
                <div><span style="color:#94a3b8;">ผลผลิตไฟฟ้า (จาก 3D):</span> <b style="color:#eab308; font-family: 'JetBrains Mono';">${Math.round(annual_kwh).toLocaleString()} kWh/ปี</b></div>
                <div><span style="color:#94a3b8;">ประหยัดค่าไฟ:</span> <b style="color:#10b981; font-family: 'JetBrains Mono';">${Math.round(annual_thb).toLocaleString()} ฿/y</b></div>
                <div><span style="color:#94a3b8;">ระยะคืนทุน:</span> <b style="color:#38bdf8; font-family: 'JetBrains Mono';">${payback_yrs} ปี</b></div>
            </div>

            <!-- Section 3: Slope & Orientation -->
            ${!isBuilding && props.slope_deg !== undefined ? `
            <div style="display: flex; justify-content: space-between; margin-top: 8px; font-size: 0.7rem; color: #94a3b8; background: rgba(0,0,0,0.25); padding: 6px 8px; border-radius: 6px;">
                <span>ความลาดชัน 3D: <b style="color:#fff;">${props.slope_deg}°</b></span>
                <span>มุมทิศ 3D: <b style="color:#fff;">${props.aspect_deg}°</b></span>
                <span>f_az (ทิศแดด): <b style="color:#eab308;">${props.solar_correction || 1.0}</b></span>
            </div>` : ''}

            <!-- Section 4: 3D Elevations (Eave, Ridge, Delta Z) -->
            ${(props.height_base !== undefined || props.height_eave !== undefined) ? `
            <div style="margin-top: 8px; font-size: 0.72rem; background: rgba(15, 23, 42, 0.75); padding: 8px 10px; border-radius: 8px; border: 1px solid rgba(56, 189, 248, 0.3);">
                <div style="font-weight: 700; color: #38bdf8; margin-bottom: 5px; display: flex; justify-content: space-between; align-items: center;">
                    <span>📐 ระดับความสูงมุมระนาบ 3 มิติ (nDSM)</span>
                    <span style="background: rgba(245, 158, 11, 0.2); color: #f59e0b; padding: 1px 6px; border-radius: 4px; font-size: 0.68rem; font-family: 'JetBrains Mono';">ΔZ: ${(parseFloat(props.delta_z) || (parseFloat(props.height_roof || props.height_ridge) - parseFloat(props.height_base || props.height_eave)) || 0).toFixed(2)} ม.</span>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; color: #cbd5e1; font-size: 0.7rem;">
                    <div>• ชายคา (Eave): <b style="color: #fff; font-family: 'JetBrains Mono';">${(parseFloat(props.height_base || props.height_eave) || 3.5).toFixed(2)} ม.</b></div>
                    <div>• สันหลังคา (Ridge): <b style="color: #fff; font-family: 'JetBrains Mono';">${(parseFloat(props.height_roof || props.height_ridge) || 5.5).toFixed(2)} ม.</b></div>
                </div>
            </div>` : ''}

            <!-- Section 5: Environmental offset -->
            <div style="margin-top: 8px; font-size: 0.66rem; color: #94a3b8; background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.2); padding: 5px 8px; border-radius: 6px; line-height: 1.35;">
                💡 <b style="color: #10b981;">3D Solar Rigor:</b> พื้นที่ติดตั้งจริง (${areaUsable.toFixed(1)} m²) และพลังงานไฟฟ้าถูกคำนวณจากระนาบลาดเอียง 3 มิติ ($A_{3D} = A_{2D} / \\cos\\beta$) สกัดระดับความสูงจาก nDSM เชิงประจักษ์ 100%
            </div>

            <div style="margin-top: 6px; font-size: 0.72rem; color: #10b981; display: flex; align-items: center; gap: 4px;">
                🌱 ลดการปล่อยก๊าซเรือนกระจก: <b>${co2_ton} tCO₂e/ปี</b>
            </div>

            <!-- Section 6: False Positive / Road Deletion Action -->
            ${!isBuilding ? `
            <div style="margin-top: 10px; padding-top: 8px; border-top: 1px dashed rgba(255,255,255,0.15); display: flex; justify-content: flex-end;">
                <button onclick="window.deleteFacet('${props.id}')" style="background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.5); color: #fca5a5; padding: 5px 12px; border-radius: 6px; font-size: 0.72rem; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 6px; transition: all 0.2s;" onmouseover="this.style.background='rgba(239, 68, 68, 0.4)'" onmouseout="this.style.background='rgba(239, 68, 68, 0.2)'" title="ลบระนาบนี้ออกจากระบบหากตรวจพบว่าเป็นถนน หรือพื้นดินที่แปลผลคลาดเคลื่อน">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                    <span>🗑️ ลบ Facet นี้ (ไม่ใช่หลังคา / ถนน)</span>
                </button>
            </div>` : ''}
        </div>
    `;

    popup.setLngLat(lngLat).setHTML(popupHtml).addTo(map);
}

// ── Render Dynamic UI Data ──
function renderKPIs(stats, mode) {
    if (!stats) return;
    const kpiCap = document.getElementById('kpi-capacity');
    if (kpiCap) kpiCap.textContent = stats.total_capacity_mwp.toFixed(2);
    const kpiGen = document.getElementById('kpi-generation');
    if (kpiGen) kpiGen.textContent = stats.total_generation_gwh_yr.toFixed(2);
    const dynamicSavings = (stats.total_generation_gwh_yr * 1e6 * currentTariff / 1e6).toFixed(2);
    const kpiSav = document.getElementById('kpi-savings');
    if (kpiSav) kpiSav.textContent = Number(dynamicSavings).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const kpiCo2 = document.getElementById('kpi-co2');
    if (kpiCo2) kpiCo2.textContent = Math.round(stats.total_co2_offset_tons_yr).toLocaleString();
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
                        <td class="num">16,573 ระนาบ</td>
                        <td class="num" style="color: #38bdf8;">4,420 หลัง</td>
                        <td class="num"><span class="comp-badge high">3.75 ระนาบ/หลัง</span></td>
                    </tr>
                    <tr>
                        <td><b>กำลังผลิต (MWp)</b></td>
                        <td class="num">103.94 MWp</td>
                        <td class="num" style="color: #f97316;">103.94 MWp</td>
                        <td class="num"><span class="comp-badge high">100.0%</span></td>
                    </tr>
                    <tr>
                        <td><b>ผลผลิตไฟฟ้า (GWh/y)</b></td>
                        <td class="num">131.21 GWh</td>
                        <td class="num" style="color: #eab308;">131.21 GWh</td>
                        <td class="num"><span class="comp-badge high">100.0%</span></td>
                    </tr>
                    <tr>
                        <td><b>ประหยัดค่าไฟ (ล้าน฿/ปี)</b></td>
                        <td class="num">590.45</td>
                        <td class="num" style="color: #10b981;">590.45</td>
                        <td class="num"><span class="comp-badge high">100.0%</span></td>
                    </tr>
                    <tr>
                        <td><b>ลดก๊าซเรือนกระจก (ตัน)</b></td>
                        <td class="num">65,605 t</td>
                        <td class="num" style="color: #38bdf8;">65,605 t</td>
                        <td class="num"><span class="comp-badge high">100.0%</span></td>
                    </tr>
                </tbody>
            </table>
            <div style="font-size: 0.7rem; color: #94a3b8; line-height: 1.4; background: rgba(0,0,0,0.3); padding: 8px; border-radius: 6px;">
                🎯 <b>ผลการวิเคราะห์ GeoAI:</b> การวิเคราะห์เชิงระนาบ 3 มิติ (16,573 ระนาบ) ช่วยจำแนกความลาดชันและทิศทางแสงอาทิตย์ได้ละเอียดกว่าระดับอาคาร โดยคิดลดการบดบังและค่า Solar Correction Factor ($f_{az}$) รายระนาบอย่างแม่นยำ พร้อมระดับความสูง nDSM
            </div>
        </div>
    `;
}
