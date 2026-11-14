const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const bbox = [-63.35, -9.85, -62.85, -9.35];

function harness(fetch) {
  const elements = new Map();
  const readyHandlers = [];
  const element = () => ({
    textContent: '', innerHTML: '', hidden: true, style: {},
    classList: { toggle() {}, remove() {} },
    setAttribute() {},
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
    window: {},
    setTimeout() { return ++timer; }, clearTimeout() {}, clearInterval() {},
    L: { imageOverlay(url) { return { url, addTo() { return this; }, setUrl(value) { this.url = value; } }; } },
  });
  vm.runInContext(source + '\nwindow.testApi = { state, pendingRoiAnalysis, fetchRoiAnalysis, pollGeneratedFrames, updateDeforestationUI, setImageView, renderActiveFrame };', context);
  const api = context.window.testApi;
  const initialSelection = { bbox: api.state.activeRoiBBox, name: api.state.activeRoiName };
  api.state.map = { removeLayer() {} };
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
