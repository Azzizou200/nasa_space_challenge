const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const exampleCatalog = fs.readFileSync(path.join(root, 'public/forest-examples.js'), 'utf8');
const bbox = [-63.35, -9.85, -62.85, -9.35];

function harness(fetch) {
  const elements = new Map();
  const readyHandlers = [];
  const element = () => ({
    textContent: '', innerHTML: '', hidden: true, style: {},
    handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; }, focus() { this.focused = true; },
    classList: { toggle() {}, remove() {} },
    setAttribute() {}, removeAttribute() {}, getBoundingClientRect() { return { height: 0 }; },
    querySelector(selector) { return this.children[selector] ||= element(); },
    children: {},
  });
  for (const [, id] of html.matchAll(/\bid="([^"]+)"/g)) elements.set(id, element());
  let timer = 0;
  const context = vm.createContext({
    console, fetch, URL, Date, Math, Number, JSON, Map,
    document: {
      addEventListener(type, handler) { if (type === 'DOMContentLoaded') readyHandlers.push(handler); },
      querySelectorAll() { return []; },
      getElementById(id) { assert.ok(elements.has(id), `Unknown element: ${id}`); return elements.get(id); },
    },
    window: { matchMedia: () => ({ matches: false }) },
    setTimeout() { return ++timer; }, clearTimeout() {}, clearInterval() {},
    L: {
      rectangle() { return { addTo() { return this; } }; }, divIcon() {}, latLng() {},
      marker(center, options) { return { center, options, handlers: {},
        addTo() { return this; }, bindTooltip() { return this; },
        on(type, handler) { this.handlers[type] = handler; return this; } }; },
      layerGroup(layers) { return { layers, addTo() { return this; }, eachLayer(fn) { layers.forEach(fn); } }; },
      imageOverlay(url) { return { url, addTo() { return this; }, setUrl(value) { this.url = value; } }; }
    },
  });
  vm.runInContext(exampleCatalog, context);
  vm.runInContext(source + '\nwindow.testApi = { state, pendingRoiAnalysis, fetchRoiAnalysis, pollGeneratedFrames, updateDeforestationUI, setImageView, renderActiveFrame, fetchFloodAnalysis, pollFloodAnalysis, updateFloodUI, setupFloodControls, switchMission, selectFloodRoi, stepFrame, toggleCompare, FLOOD_REFERENCES, selectFloodReference, setupForestControls, fetchNisarForestAnalysis, pollNisarForestAnalysis, FOREST_EXAMPLES, selectForestExample, selectDeforestationRoi };', context);
  const api = context.window.testApi;
  const initialSelection = { bbox: api.state.activeRoiBBox, name: api.state.activeRoiName };
  api.state.map = { removedLayers: [], removeLayer(layer) { this.removedLayers.push(layer); }, flyToBounds(bounds) { this.lastBounds = bounds; }, flyTo() {} };
  api.state.activeRoiBBox = bbox;
  return { ...api, elements, context, readyHandlers, initialSelection };
}

const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
const flush = () => new Promise(resolve => setImmediate(resolve));

test('public image effects change the display without changing measured results', async () => {
  const api = harness(async () => response({}));
  const metrics = measured(api);
  api.state.activeRoiData = metrics;
  api.updateDeforestationUI(metrics, bbox);
  const before = JSON.stringify(metrics);
  api.context.SarImageEffects = { render: async () => 'blob:processed-image' };
  api.setImageView('simple');
  await flush();
  assert.equal(api.state.activeOverlay.url, 'blob:processed-image');
  assert.equal(JSON.stringify(metrics), before);
  assert.equal(api.state.activeFrames[0].image, metrics.monthly_series[0].image_url);
  assert.equal(api.elements.get('map-legend-details').open, true);
  assert.match(api.elements.get('sidebar-legend').innerHTML, /vegetation-like/);
  api.setImageView('original');
  assert.equal(api.state.activeOverlay.url, metrics.monthly_series[0].image_url);
});

test('an enhancement finishing late cannot overwrite a newer timeline date', async () => {
  const api = harness(async () => response({}));
  api.updateDeforestationUI(measured(api), bbox);
  const finishes = [];
  api.context.SarImageEffects = { render: () => new Promise(resolve => finishes.push(resolve)) };
  api.setImageView('enhanced');
  api.state.currentFrameIndex = 1;
  api.renderActiveFrame();
  const current = api.state.activeOverlay;
  finishes[0]('blob:previous-date');
  await flush();
  assert.notEqual(current.url, 'blob:previous-date');
  finishes[1]('blob:current-date');
  await flush();
  assert.equal(current.url, 'blob:current-date');
});

test('startup has no selected region and sends no analysis request', async () => {
  let requests = 0;
  const api = harness(async () => { requests++; throw new Error('Unexpected analysis request'); });
  assert.equal(api.initialSelection.bbox, null);
  assert.equal(api.initialSelection.name, '');
  api.state.activeRoiBBox = null;
  api.context.window.matchMedia = () => ({ matches: false });
  vm.runInContext(`
    initMap = () => {};
    setSidebarVisible = () => {};
    loadManifest = async () => {};
    setupEventListeners = () => {};
    setupSearch = () => {};
    setupSquareDrawingTool = () => {};
  `, api.context);
  await api.readyHandlers[0]();
  assert.equal(requests, 0);
  assert.equal(api.state.activeRoiBBox, null);
  assert.equal(api.state.activeFrames.length, 0);
  assert.equal(api.elements.get('bottom-dock').hidden, true);
  assert.equal(api.elements.get('kpi-section').hidden, true);
  assert.equal(api.elements.get('region-section').hidden, false);
});

function pending(api, region = 'amazon_run') {
  return { ...api.pendingRoiAnalysis(bbox, 2025), source: 'COPERNICUS/S1_GRD', region };
}

function measured(api, region = 'amazon_run') {
  const data = pending(api, region);
  return {
    ...data, bbox, metrics_ready: true, status: 'complete',
    baseline_jan_forest_km2: 1800.2, total_forest_lost_km2: 50.1,
    net_loss_percentage: 2.78, peak_monthly_loss_km2: 8.4,
    peak_logging_month: 'Mar 2025', orbit_pass: 'ASCENDING',
    method: { vh_threshold_db: -15.5, scale_m: 80 },
    monthly_series: data.monthly_series.map((item, index) => ({
      ...item, forest_area_km2: 1800.2 - index,
      loss_speed_km2_month: index === 0 ? 0 : 1,
      image: `${region}_2025_${String(index + 1).padStart(2, '0')}.png`,
      image_url: `/public/data/${region}/${region}_2025_${String(index + 1).padStart(2, '0')}.png`,
    })),
  };
}

test('pending cards stay empty even when all images finish before metrics', async () => {
  let api;
  api = harness(async url => {
    const data = pending(api);
    if (url === '/api/analyze') return response(data, 202);
    return response({
      region: data.region, status: 'running', metrics_ready: false,
      images: data.monthly_series.map((_, index) => ({
        filename: `amazon_run_2025_${String(index + 1).padStart(2, '0')}.png`,
        image_url: `/public/data/amazon_run/${index}.png`,
      })),
    });
  });
  await api.fetchRoiAnalysis(bbox, 2025, 'Amazon');
  await flush();
  assert.equal(api.elements.get('kpi-baseline').textContent, '—');
  assert.equal(api.elements.get('kpi-lost').textContent, '—');
  assert.equal(api.elements.get('chart-bars').innerHTML, '');
  assert.equal(api.elements.get('gee-loading').hidden, false);
  assert.match(api.elements.get('gee-loading').querySelector('small').textContent, /finalizing/);
});

test('measured metrics replace pending cards and preserve the selected date', async () => {
  let status;
  const api = harness(async () => response(status));
  const data = pending(api);
  api.state.activeRoiData = data;
  api.updateDeforestationUI(data, bbox);
  api.state.currentFrameIndex = 6;
  const metrics = measured(api);
  status = {
    region: data.region, status: 'complete', metrics_ready: true, metrics,
    images: metrics.monthly_series.map(item => ({ filename: item.image, image_url: item.image_url })),
  };
  await api.pollGeneratedFrames(data.region);
  assert.equal(api.state.currentFrameIndex, 6);
  assert.equal(api.state.activeRoiData.baseline_jan_forest_km2, 1800.2);
  assert.match(api.elements.get('kpi-baseline').textContent, /1,800.2/);
  assert.equal(api.elements.get('kpi-peak-month').textContent, 'Peak: Mar 2025');
  assert.equal(api.elements.get('kpi-pass').textContent, 'ascending pass');
  assert.equal(api.elements.get('gee-loading').hidden, true);
  assert.match(api.elements.get('metrics-status').textContent, /Radar-derived estimates/);
});

test('API failure displays an error and never synthesizes forest figures', async () => {
  const api = harness(async () => { throw new Error('Network offline'); });
  await api.fetchRoiAnalysis(bbox, 2025, 'Amazon');
  assert.equal(api.elements.get('kpi-baseline').textContent, '—');
  assert.equal(api.elements.get('kpi-speed').textContent, '—');
  assert.equal(api.elements.get('gee-loading').hidden, false);
  assert.match(api.elements.get('gee-loading').querySelector('small').textContent, /Network offline/);
});

test('old simulation API responses are rejected', async () => {
  const api = harness(async () => response({ source: 'Universal Geodetic SAR Engine', baseline_jan_forest_km2: 2392.52 }));
  await api.fetchRoiAnalysis(bbox, 2025, 'Amazon');
  assert.equal(api.elements.get('kpi-baseline').textContent, '—');
  assert.match(api.elements.get('gee-loading').querySelector('small').textContent, /Restart server.py/);
});

test('late responses from a previous selection cannot overwrite the current run', async () => {
  let finish;
  const api = harness(() => new Promise(resolve => { finish = resolve; }));
  const data = pending(api);
  api.state.activeRoiData = data;
  api.updateDeforestationUI(data, bbox);
  const poll = api.pollGeneratedFrames(data.region);
  api.state.analysisRequestId++;
  const current = pending(api, 'congo_run');
  api.state.activeRoiData = current;
  finish(response({ region: data.region, status: 'complete', metrics_ready: true, metrics: measured(api), images: [] }));
  await poll;
  assert.equal(api.state.activeRoiData.region, 'congo_run');
  assert.equal(api.elements.get('kpi-baseline').textContent, '—');
});

test('measurements with the wrong bounding box are rejected', async () => {
  let status;
  const api = harness(async () => response(status));
  const data = pending(api);
  api.state.activeRoiData = data;
  api.updateDeforestationUI(data, bbox);
  const metrics = measured(api);
  metrics.bbox = [18.2, -2.5, 18.7, -2];
  status = { region: data.region, status: 'complete', metrics_ready: true, metrics, images: [] };
  await api.pollGeneratedFrames(data.region);
  assert.equal(api.elements.get('kpi-baseline').textContent, '—');
  assert.match(api.elements.get('gee-loading').querySelector('small').textContent, /do not match/);
});

test('zero baseline and net gains do not become fabricated loss percentages', () => {
  const api = harness(async () => response({}));
  const metrics = measured(api);
  metrics.baseline_jan_forest_km2 = 0;
  metrics.net_loss_percentage = null;
  metrics.total_forest_lost_km2 = -12.5;
  api.updateDeforestationUI(metrics, bbox);
  assert.equal(api.elements.get('kpi-baseline').textContent, '0 km²');
  assert.equal(api.elements.get('kpi-lost').textContent, '+12.5 km²');
  assert.equal(api.elements.get('kpi-loss-pct').textContent, 'No baseline forest to compare');
});

function floodPending(region = 'flood_roi_1') {
  return { source: 'NISAR_L2_GCOV', mission: 'flood', bbox,
    start_date: '2025-10-01', end_date: '2025-11-01', region,
    metrics_ready: false, status: 'running', acquisition_series: [] };
}

function floodMeasured() {
  return { ...floodPending(), status: 'complete', metrics_ready: true,
    baseline_date: '2025-10-02', baseline_water_km2: 4.2,
    peak_flood_km2: 12.3, peak_flood_date: '2025-10-14', latest_flood_km2: 8.1,
    analyzed_land_area_km2: 120, affected_area_km2: 15.2,
    track: '114', direction: 'A', frame: '165',
    method: { hh_threshold_db: -15, hv_threshold_db: -24 },
    acquisition_series: ['2025-10-02', '2025-10-14', '2025-10-26'].map((date, index) => ({
      date, flood_area_km2: [0, 12.3, 8.1][index], water_area_km2: [4.2, 16.5, 12.3][index],
      image: `flood_${date}.png`, image_url: `/public/data/flood_roi_1/flood_${date}.png`,
      bounds: [[-9.85, -63.35], [-9.35, -62.85]],
    })),
    downloads: { csv: '/public/data/flood_roi_1/metrics.csv' },
  };
}

test('Floods replaces Hurricanes without loading preset images or starting analysis', () => {
  const api = harness(async () => { throw new Error('unexpected request'); });
  api.switchMission('flood');
  assert.equal(api.state.activeMission, 'flood');
  assert.equal(api.state.activeFrames.length, 0);
  assert.equal(api.elements.get('flood-date-form').hidden, false);
  assert.equal(api.elements.get('flood-kpi-section').hidden, true);
  assert.equal(api.elements.get('bottom-dock').hidden, true);
  assert.equal(api.elements.get('image-view-select').disabled, true);
  assert.match(html, /data-mission="flood"/);
  assert.doesNotMatch(html, /data-mission="florida"|>Hurricanes</);
});

test('date form validates order and requires a drawn region before fetching', async () => {
  let calls = 0;
  const api = harness(async () => { calls++; return response(floodPending(), 202); });
  api.switchMission('flood');
  api.setupFloodControls();
  const start = api.elements.get('flood-start-date');
  const end = api.elements.get('flood-end-date');
  const submit = api.elements.get('flood-date-form').handlers.submit;
  start.value = '2025-11-01'; end.value = '2025-10-01';
  submit({ preventDefault() {} });
  assert.equal(calls, 0);
  assert.match(api.elements.get('flood-date-error').textContent, /after start/);
  start.value = '2025-10-01'; end.value = '2025-11-01';
  submit({ preventDefault() {} });
  assert.equal(calls, 0);
  assert.match(api.elements.get('flood-date-error').textContent, /Draw a region/);
  api.state.flood.bbox = bbox;
  submit({ preventDefault() {} });
  await flush();
  assert.ok(calls > 0);
});

test('drawing a flood region stays in Floods and preserves the forest selection', () => {
  const api = harness(async () => response({}));
  api.switchMission('flood');
  vm.runInContext('setSidebarVisible = () => {};', api.context);
  const forestBBox = api.state.activeRoiBBox;
  api.selectFloodRoi([32.5, -25.5, 33.8, -24]);
  assert.equal(api.state.activeMission, 'flood');
  assert.equal(api.state.activeRoiBBox, forestBBox);
  assert.equal(api.state.flood.bbox[0], 32.5);
  assert.equal(api.elements.get('bottom-dock').hidden, true);
});

test('flood analysis sends selected region and dates and displays only measured acquisitions', async () => {
  let body;
  const metrics = floodMeasured();
  const api = harness(async (url, options) => {
    if (url === '/api/flood/analyze') {
      body = JSON.parse(options.body);
      return response(floodPending(), 202);
    }
    return response({ region: metrics.region, status: 'complete', metrics_ready: true, metrics });
  });
  api.switchMission('flood');
  await api.fetchFloodAnalysis(bbox, '2025-10-01', '2025-11-01');
  assert.deepEqual(body.bbox, bbox);
  assert.equal(body.start_date, '2025-10-01');
  assert.equal(body.end_date, '2025-11-01');
  assert.equal(api.elements.get('flood-peak').textContent, '12.3 km²');
  assert.equal(api.elements.get('flood-count').textContent, '3');
  assert.equal(api.state.activeFrames.length, 3);
  assert.equal(api.state.activeFrames[1].startDate, '2025-10-14');
  assert.equal(api.elements.get('bottom-dock').hidden, false);
  assert.equal(api.elements.get('gee-loading').hidden, true);
  api.stepFrame(1);
  assert.match(api.elements.get('event-title').textContent, /2025-10-14/);
  api.toggleCompare();
  assert.match(api.elements.get('event-title').textContent, /Baseline.*2025-10-02/);
  api.toggleCompare();
  assert.equal(api.state.currentFrameIndex, 1);
  api.switchMission('deforestation');
  assert.equal(api.elements.get('flood-kpi-section').hidden, true);
  assert.equal(api.state.activeFrames.length, 0);
  api.switchMission('flood');
  assert.equal(api.state.activeFrames.length, 3);
});

test('flood download progress stays pending without inventing statistics', async () => {
  const api = harness(async url => url === '/api/flood/analyze'
    ? response(floodPending(), 202)
    : response({ region: 'flood_roi_1', status: 'running', metrics_ready: false,
      progress: { stage: 'downloading', message: 'Downloading acquisition 2 of 3', completed: 1, total: 3 } }));
  api.switchMission('flood');
  await api.fetchFloodAnalysis(bbox, '2025-10-01', '2025-11-01');
  assert.equal(api.elements.get('flood-peak').textContent, '—');
  assert.equal(api.state.activeFrames.length, 0);
  assert.match(api.elements.get('gee-loading').querySelector('small').textContent, /Downloading acquisition 2/);
});

test('flood failures and wrong period responses never publish measurements', async () => {
  for (const mismatch of [false, true]) {
    const metrics = floodMeasured();
    metrics.start_date = '2025-09-01';
    const api = harness(async url => url === '/api/flood/analyze' ? response(floodPending(), 202)
      : response(mismatch ? { region: metrics.region, status: 'complete', metrics_ready: true, metrics }
        : { region: metrics.region, status: 'error', error: 'Earthdata authentication required' }));
    api.switchMission('flood');
    await api.fetchFloodAnalysis(bbox, '2025-10-01', '2025-11-01');
    assert.equal(api.elements.get('flood-peak').textContent, '—');
    assert.equal(api.elements.get('bottom-dock').hidden, true);
    assert.match(api.elements.get('gee-loading').querySelector('small').textContent,
      mismatch ? /do not match/ : /authentication/);
  }
});

test('late flood responses cannot overwrite a new region or another mission', async () => {
  let finish;
  const api = harness(url => url === '/api/flood/cancel' ? Promise.resolve(response({status: 'cancelled'})) : new Promise(resolve => { finish = resolve; }));
  api.switchMission('flood');
  api.state.flood.bbox = bbox;
  api.state.flood.data = floodPending();
  const poll = api.pollFloodAnalysis('flood_roi_1');
  vm.runInContext('setSidebarVisible = () => {};', api.context);
  api.selectFloodRoi([32.5, -25.5, 33.8, -24]);
  finish(response({ region: 'flood_roi_1', status: 'complete', metrics_ready: true, metrics: floodMeasured() }));
  await poll;
  assert.equal(api.state.flood.data, null);
  assert.equal(api.state.activeFrames.length, 0);
  api.state.flood.data = floodPending();
  const second = api.pollFloodAnalysis('flood_roi_1');
  api.switchMission('deforestation');
  finish(response({ region: 'flood_roi_1', status: 'complete', metrics_ready: true, metrics: floodMeasured() }));
  await second;
  assert.equal(api.state.activeFrames.length, 0);
  assert.equal(api.state.activeMission, 'deforestation');
});

test('reference picker selects a named floodplain while preserving dates and forest selection', () => {
  let requests = 0;
  const api = harness(async () => { requests++; throw new Error('Reference selection must not download imagery'); });
  api.setupFloodControls();
  api.switchMission('flood');
  vm.runInContext('setSidebarVisible = () => {};', api.context);
  const start = api.elements.get('flood-start-date');
  const end = api.elements.get('flood-end-date');
  start.value = '2026-01-01'; end.value = '2026-03-01';
  const forest = api.state.activeRoiBBox;
  api.elements.get('flood-reference-select').handlers.change({ target: { value: 'limpopo' } });
  assert.equal(api.state.activeMission, 'flood');
  assert.equal(api.state.flood.referenceId, 'limpopo');
  assert.match(api.state.flood.name, /Limpopo/);
  assert.match(api.elements.get('sidebar-title').textContent, /Limpopo/);
  assert.deepEqual(Array.from(api.state.flood.bbox), [32.81, -24.70, 33.15, -24.36]);
  assert.equal(start.value, '2026-01-01');
  assert.equal(end.value, '2026-03-01');
  assert.equal(api.state.activeRoiBBox, forest);
  assert.equal(api.elements.get('flood-reference-details').hidden, false);
  assert.match(api.elements.get('flood-reference-source').href, /^https:\/\/science.nasa.gov\//);
  assert.equal(requests, 0);
  api.selectFloodRoi([32.5, -25.5, 33.8, -24]);
  assert.equal(api.state.flood.referenceId, '');
  assert.equal(api.elements.get('flood-reference-select').value, '');
  assert.equal(api.elements.get('flood-reference-details').hidden, true);
});

test('reference markers select study areas and stay confined to the Floods mission', () => {
  const api = harness(async () => { throw new Error('Unexpected request'); });
  api.switchMission('flood');
  vm.runInContext('setSidebarVisible = () => {};', api.context);
  const layer = api.state.flood.referenceLayer;
  assert.equal(layer.layers.length, 5);
  const forest = api.state.activeRoiBBox;
  layer.layers[4].handlers.click();
  assert.equal(api.state.flood.referenceId, 'mississippi');
  assert.match(api.state.flood.name, /Vicksburg/);
  assert.equal(api.elements.get('flood-reference-select').value, 'mississippi');
  const requestId = api.state.flood.requestId;
  layer.layers[2].handlers.click();
  assert.equal(api.state.flood.referenceId, 'indus');
  assert.ok(api.state.flood.requestId > requestId);
  api.switchMission('deforestation');
  assert.ok(api.state.map.removedLayers.includes(layer));
  assert.equal(api.elements.get('flood-reference-controls').hidden, true);
  assert.equal(api.state.activeRoiBBox, forest);
  api.switchMission('flood');
  assert.equal(api.state.flood.referenceLayer, layer);
  assert.equal(api.elements.get('flood-reference-select').value, 'indus');
  const current = api.state.flood.bbox;
  api.selectFloodReference('invalid-id');
  assert.equal(api.state.flood.bbox, current);
});

test('cancel stops the current browser run and prevents further polling', async () => {
  const calls = [];
  const api = harness(async (url, options) => {
    calls.push({ url, body: options?.body && JSON.parse(options.body) });
    if (url === '/api/flood/analyze') return response(floodPending(), 202);
    if (url === '/api/flood/cancel') return response({ status: 'cancelled' });
    return response({ region: 'flood_roi_1', status: 'running', metrics_ready: false,
      elapsed_seconds: 18, progress: { stage: 'reading', message: 'Reading HH region rows' } });
  });
  api.setupFloodControls();
  api.switchMission('flood');
  await api.fetchFloodAnalysis(bbox, '2025-10-01', '2025-11-01');
  assert.equal(api.elements.get('flood-cancel-btn').hidden, false);
  assert.match(api.elements.get('gee-progress-label').textContent, /18s elapsed/);
  const requestId = api.state.flood.requestId;
  api.elements.get('flood-cancel-btn').handlers.click();
  await flush();
  assert.ok(api.state.flood.requestId > requestId);
  assert.equal(api.state.flood.data.status, 'cancelled');
  assert.equal(api.elements.get('gee-loading').hidden, true);
  assert.equal(api.elements.get('flood-cancel-btn').hidden, true);
  const cancelled = calls.find(call => call.url === '/api/flood/cancel');
  const started = calls.find(call => call.url === '/api/flood/analyze');
  assert.equal(cancelled.body.client_id, started.body.client_id);
  assert.equal(cancelled.body.region_name, 'flood_roi_1');
});

test('a prelaunch-only flood date range is rejected before starting a request', () => {
  let requests = 0;
  const api = harness(async () => { requests++; return response({}); });
  api.setupFloodControls();
  api.switchMission('flood');
  api.state.flood.bbox = bbox;
  api.elements.get('flood-start-date').value = '2024-01-01';
  api.elements.get('flood-end-date').value = '2024-12-31';
  api.elements.get('flood-date-form').handlers.submit({ preventDefault() {} });
  assert.equal(requests, 0);
  assert.match(api.elements.get('flood-date-error').textContent, /no 2024 NISAR/);
});

function forestPending(region = 'forest_roi_1') {
  return { source: 'NISAR_L2_GCOV', mission: 'forest', bbox, region,
    start_date: '2025-10-01', end_date: '2025-11-01', hv_threshold_db: -13,
    metrics_ready: false, status: 'running', acquisition_series: [] };
}

function forestMeasured() {
  return { ...forestPending(), status: 'complete', metrics_ready: true,
    total_region_area_km2: 100, baseline_forest_km2: 80, final_forest_km2: 65,
    total_forest_lost_km2: 15, net_loss_percentage: 18.75,
    peak_loss_km2: 10, peak_loss_date: '2025-10-25', baseline_date: '2025-10-01',
    track: '114', direction: 'A', frame: '165', method: { hv_threshold_db: -13 },
    acquisition_series: ['2025-10-01', '2025-10-13', '2025-10-25'].map((date, index) => ({
      date, forest_area_km2: [80, 75, 65][index], loss_km2: [0, 5, 10][index],
      image: `forest_${date}.png`, image_url: `/public/data/forest_roi_1/forest_${date}.png`,
      bounds: [[-9.8, -63.3], [-9.4, -62.9]]
    })), downloads: { csv: '/public/data/forest_roi_1/metrics.csv', geotiff: '/public/data/forest_roi_1/forest.tif' }
  };
}

function useNisarForest(api) {
  api.setupForestControls();
  api.elements.get('forest-source-select').handlers.change({ target: { value: 'nisar' } });
}

test('forest source selection clears old results without starting downloads or changing flood state', () => {
  let requests = 0;
  const api = harness(async () => { requests++; throw new Error('Unexpected request'); });
  api.state.activeRoiData = measured(api);
  api.updateDeforestationUI(api.state.activeRoiData, bbox);
  api.state.flood.data = floodMeasured();
  const floodData = api.state.flood.data;
  useNisarForest(api);
  assert.equal(api.state.forestSource, 'nisar');
  assert.equal(api.state.activeRoiData, null);
  assert.equal(api.state.activeFrames.length, 0);
  assert.equal(api.elements.get('forest-nisar-options').hidden, false);
  assert.equal(api.elements.get('kpi-section').hidden, true);
  assert.match(api.elements.get('workspace-sensor').textContent, /NISAR/);
  assert.equal(api.state.flood.data, floodData);
  assert.equal(requests, 0);
});

test('NISAR forest requests selected dates and threshold and renders acquisition interval measurements', async () => {
  let body;
  const metrics = forestMeasured();
  const api = harness(async (url, options) => {
    if (url === '/api/forest/nisar/analyze') {
      body = JSON.parse(options.body);
      return response(forestPending(), 202);
    }
    return response({ region: metrics.region, status: 'complete', metrics_ready: true, metrics });
  });
  useNisarForest(api);
  await api.fetchNisarForestAnalysis(bbox, '2025-10-01', '2025-11-01', -13);
  assert.deepEqual(body.bbox, bbox);
  assert.equal(body.hv_threshold_db, -13);
  assert.equal(body.start_date, '2025-10-01');
  assert.match(body.client_id, /^forest_/);
  assert.equal(api.elements.get('kpi-baseline').textContent, '80 km²');
  assert.equal(api.elements.get('kpi-speed').textContent, '10 km²');
  assert.equal(api.elements.get('forest-peak-label').textContent, 'Peak interval loss');
  assert.match(api.elements.get('metrics-method').textContent, /HV gamma0 > -13/);
  assert.equal(api.state.activeFrames.length, 3);
  assert.deepEqual(Array.from(api.state.activeFrames[0].bounds[0]), [-9.8, -63.3]);
  api.stepFrame(1);
  assert.match(api.elements.get('chart-active-val').textContent, /2025-10-13: 5 km² \/ interval/);
  api.toggleCompare();
  assert.match(api.elements.get('event-title').textContent, /Baseline.*2025-10-01/);
  api.toggleCompare();
  assert.equal(api.state.currentFrameIndex, 1);
  assert.equal(api.elements.get('forest-tiff-download').href, '/public/data/forest_roi_1/forest.tif');
  api.switchMission('flood');
  assert.equal(api.elements.get('forest-source-controls').hidden, true);
  api.switchMission('deforestation');
  assert.equal(api.state.activeFrames.length, 3);
  assert.match(api.elements.get('workspace-sensor').textContent, /NISAR/);
});

test('forest form rejects missing regions, prelaunch dates and invalid thresholds before requests', () => {
  let calls = 0;
  const api = harness(async () => { calls++; return response({}); });
  useNisarForest(api);
  const start = api.elements.get('forest-start-date');
  const end = api.elements.get('forest-end-date');
  const threshold = api.elements.get('forest-hv-threshold');
  const submit = api.elements.get('forest-analysis-form').handlers.submit;
  start.value = '2024-01-01'; end.value = '2024-12-31'; threshold.value = '-13';
  submit({ preventDefault() {} });
  assert.match(api.elements.get('forest-analysis-error').textContent, /after launch/);
  start.value = '2025-10-01'; end.value = '2025-11-01'; threshold.value = '-99';
  submit({ preventDefault() {} });
  assert.match(api.elements.get('forest-analysis-error').textContent, /threshold/);
  threshold.value = '-13';
  api.state.activeRoiBBox = null;
  submit({ preventDefault() {} });
  assert.match(api.elements.get('forest-analysis-error').textContent, /Draw a region/);
  assert.equal(calls, 0);
});

test('NISAR forest progress stays pending and errors never use Sentinel-1 measurements', async () => {
  let failure = false;
  const api = harness(async url => url === '/api/forest/nisar/analyze' ? response(forestPending(), 202)
    : response(failure ? { region: 'forest_roi_1', status: 'error', error: 'Earthdata required' }
      : { region: 'forest_roi_1', status: 'running', metrics_ready: false,
          progress: { stage: 'reading', message: 'Reading NISAR forest data' }, elapsed_seconds: 12 }));
  useNisarForest(api);
  await api.fetchNisarForestAnalysis(bbox, '2025-10-01', '2025-11-01', -13);
  assert.equal(api.elements.get('kpi-baseline').textContent, '—');
  assert.equal(api.state.activeFrames.length, 0);
  assert.match(api.elements.get('gee-progress-label').textContent, /12s/);
  failure = true;
  await api.pollNisarForestAnalysis('forest_roi_1');
  assert.equal(api.state.activeRoiData.status, 'error');
  assert.match(api.elements.get('gee-loading').querySelector('small').textContent, /Earthdata/);
  assert.equal(api.elements.get('forest-cancel-btn').hidden, true);
});

test('mismatched NISAR forest thresholds and flood results cannot publish forest measurements', async () => {
  for (const field of ['threshold', 'mission']) {
    const metrics = forestMeasured();
    if (field === 'threshold') metrics.method.hv_threshold_db = -18;
    else metrics.mission = 'flood';
    const api = harness(async url => url === '/api/forest/nisar/analyze' ? response(forestPending(), 202)
      : response({ region: metrics.region, status: 'complete', metrics_ready: true, metrics }));
    useNisarForest(api);
    await api.fetchNisarForestAnalysis(bbox, '2025-10-01', '2025-11-01', -13);
    assert.equal(api.elements.get('kpi-baseline').textContent, '—');
    assert.match(api.elements.get('gee-loading').querySelector('small').textContent, /do not match/);
  }
});

test('switching forest source cancels NISAR and ignores a late completion', async () => {
  const calls = [];
  let finish;
  const api = harness((url, options) => {
    calls.push({ url, body: options?.body && JSON.parse(options.body) });
    if (url === '/api/nisar/cancel') return Promise.resolve(response({ status: 'cancelled' }));
    return new Promise(resolve => { finish = resolve; });
  });
  useNisarForest(api);
  api.state.activeRoiData = forestPending();
  const poll = api.pollNisarForestAnalysis('forest_roi_1');
  api.elements.get('forest-source-select').handlers.change({ target: { value: 'sentinel1' } });
  finish(response({ region: 'forest_roi_1', status: 'complete', metrics_ready: true, metrics: forestMeasured() }));
  await poll;
  assert.equal(api.state.forestSource, 'sentinel1');
  assert.equal(api.state.activeRoiData, null);
  assert.equal(api.state.activeFrames.length, 0);
  assert.equal(api.elements.get('forest-nisar-options').hidden, true);
  const cancel = calls.find(call => call.url === '/api/nisar/cancel');
  assert.equal(cancel.body.region_name, 'forest_roi_1');
  assert.match(cancel.body.client_id, /^forest_/);
});

function savedMetrics(example) {
  return JSON.parse(fs.readFileSync(path.join(root, example.metrics_url.slice(1)), 'utf8'));
}

test('each forest source has three complete measured examples with all image and export files', () => {
  const api = harness(async () => { throw new Error('No requests expected'); });
  for (const sourceKey of ['sentinel1', 'nisar']) {
    const examples = api.FOREST_EXAMPLES[sourceKey];
    assert.equal(examples.length, 3);
    assert.equal(new Set(examples.map(item => item.id)).size, 3);
    for (const example of examples) {
      const data = savedMetrics(example);
      assert.deepEqual(data.bbox, Array.from(example.bbox));
      assert.equal(data.metrics_ready, true);
      assert.equal(data.region, example.region);
      const rows = sourceKey === 'nisar' ? data.acquisition_series : data.monthly_series;
      assert.equal(rows.length, example.observation_count);
      assert.ok(rows.length >= 2);
      const directory = path.join(root, 'public/data', example.region);
      assert.ok(fs.existsSync(path.join(directory, 'metrics.csv')));
      for (const row of rows) assert.ok(fs.statSync(path.join(directory, row.image)).size > 0);
      if (sourceKey === 'nisar') assert.ok(fs.statSync(path.join(directory, 'forest.tif')).size > 0);
    }
  }
});

test('all six saved forest examples open immediately without analysis jobs and survive mission switches', async () => {
  for (const sourceKey of ['sentinel1', 'nisar']) {
    const calls = [];
    const api = harness(async url => {
      calls.push(url);
      const example = api.FOREST_EXAMPLES[sourceKey].find(item => item.metrics_url === url);
      assert.ok(example, `Unexpected network request: ${url}`);
      return response(savedMetrics(example));
    });
    vm.runInContext('setSidebarVisible = () => {};', api.context);
    api.state.forestSource = sourceKey;
    api.setupForestControls();
    for (const example of api.FOREST_EXAMPLES[sourceKey]) {
      await api.selectForestExample(example.id);
      assert.equal(api.state.activeRoiData.saved_example, true);
      assert.equal(api.state.activeRoiData.region, example.region);
      assert.equal(api.state.activeRoiName, example.name);
      assert.equal(api.state.activeFrames.length, example.observation_count);
      assert.equal(api.elements.get('gee-loading').hidden, true);
      assert.match(api.elements.get('metrics-status').textContent, /Saved example/);
      assert.ok(api.state.activeFrames.every(frame => frame.image.startsWith(`/public/data/${example.region}/`)));
      if (sourceKey === 'nisar') {
        assert.equal(api.elements.get('forest-hv-threshold').value, -13);
        assert.equal(api.elements.get('forest-start-date').value, example.start_date);
        assert.equal(api.elements.get('forest-tiff-download').href, `/public/data/${example.region}/forest.tif`);
      }
      api.stepFrame(1);
      api.toggleCompare();
      assert.match(api.elements.get('event-title').textContent, /Baseline/);
      api.toggleCompare();
      assert.equal(api.state.currentFrameIndex, 1);
      const count = calls.length;
      api.switchMission('flood');
      api.switchMission('deforestation');
      await flush();
      assert.equal(calls.length, count, 'Saved example must not poll an in-memory job');
      assert.equal(api.state.forestExampleId, example.id);
    }
    assert.equal(calls.length, 3);
  }
});

test('late saved example responses cannot overwrite a different source selection', async () => {
  let finish;
  const api = harness(() => new Promise(resolve => { finish = resolve; }));
  vm.runInContext('setSidebarVisible = () => {};', api.context);
  api.setupForestControls();
  const example = api.FOREST_EXAMPLES.sentinel1[0];
  const loading = api.selectForestExample(example.id);
  api.elements.get('forest-source-select').handlers.change({ target: { value: 'nisar' } });
  finish(response(savedMetrics(example)));
  await loading;
  assert.equal(api.state.activeRoiData, null);
  assert.equal(api.state.forestSource, 'nisar');
  assert.equal(api.state.forestExampleId, '');
  assert.equal(api.state.activeFrames.length, 0);
});

test('saved examples reject mismatched metrics and custom drawing clears their selection', async () => {
  const api = harness(async () => {
    const data = savedMetrics(api.FOREST_EXAMPLES.nisar[0]);
    data.bbox = [0, 0, 1, 1];
    return response(data);
  });
  vm.runInContext('setSidebarVisible = () => {};', api.context);
  useNisarForest(api);
  await api.selectForestExample(api.FOREST_EXAMPLES.nisar[0].id);
  assert.equal(api.state.activeRoiData, null);
  assert.equal(api.state.activeFrames.length, 0);
  assert.match(api.elements.get('forest-example-note').textContent, /do not match/);
  await api.selectDeforestationRoi([1, 1, 2, 2], 'Custom region');
  assert.equal(api.state.forestExampleId, '');
  assert.equal(api.elements.get('forest-example-select').value, '');
});
