const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../src/mi_fitness_mcp/web_assets/static/js/app.js'), 'utf8');

function dashboard(responses, saved = {}) {
  const elements = new Map();
  const toasts = [];
  const requested = [];
  const storage = new Map(Object.entries(saved));
  const getElement = (id) => {
    if (!elements.has(id)) elements.set(id, { value: '2026-10-06', textContent: '--', innerHTML: '', className: '', classList:{add(){},remove(){}} });
    return elements.get(id);
  };
  const context = vm.createContext({
    document: { getElementById: getElement, querySelectorAll: () => [], addEventListener() {} },
    localStorage: { getItem: key => storage.get(key) || '', setItem: (key,value) => storage.set(key,value) },
    performance: { now: () => 1 },
    setTimeout() {}, clearInterval() {}, setInterval() {},
    toasts,
    fetch: async (url) => {
      requested.push(url);
      const endpoint = url.replace('/proxy', '').split('?')[0];
      const fixture = responses[endpoint];
      assert.ok(fixture, `Missing fixture for ${endpoint}`);
      return { ok: fixture.httpStatus !== 401, status: fixture.httpStatus || 200, text: async () => JSON.stringify(fixture.body) };
    },
  });
  vm.runInContext(source, context);
  vm.runInContext('showToast = (title, desc, type) => toasts.push({title, desc, type})', context);
  getElement('apiKeyInput').value = '';
  return { context, getElement, toasts, requested, run: (code) => vm.runInContext(code, context) };
}

const queryResponses = {
  '/api/summary': { body: { status: 'ok', count: 1, data: [{ date: '2026-10-06', steps: 1000, active_kcal: 50, distance_m: 800 }] } },
  '/api/heart-rate': { body: { status: 'ok', count: 1, data: [{ bpm: 68 }] } },
  '/api/sleep': { body: { status: 'ok', count: 1, data: [{ duration_minutes: 420, time_asleep_minutes: 390, time_awake_minutes: 30, stages: [{stage:'deep',minutes:90}, {stage:'light',minutes:240}, {stage:'rem',minutes:60}, {stage:'awake',minutes:30}] }] } },
  '/api/spo2': { body: { status: 'ok', count: 1, data: [{ spo2_pct: 97 }] } },
  '/api/stress': { body: { status: 'ok', count: 1, data: [{ stress_score: 0 }] } },
};

test('dashboard renders the actual backend response envelope and field names', async () => {
  const d = dashboard(queryResponses);
  await d.run('loadOverview()');
  for (const [id, expected] of Object.entries({ statSteps: '1,000', statCalories: '50', statDistance: '0.80', statHr: '68', statSleep: '6.5', statSpo2: '97%', statStress: '0' })) {
    assert.equal(String(d.getElement(id).textContent), expected, id);
  }
  assert.equal(d.run('state.lastResponse.status'), 'ok');
  assert.ok(d.run('Array.isArray(state.lastResponse.data)'));
});

test('overview shows latest samples across a historical range', async () => {
  const d = dashboard({
    ...queryResponses,
    '/api/heart-rate': {body:{status:'ok',data:[{bpm:60},{bpm:68}]}},
    '/api/spo2': {body:{status:'ok',data:[{spo2_pct:95},{spo2_pct:99}]}},
    '/api/stress': {body:{status:'ok',data:[{stress_score:20},{stress_score:0}]}},
  });
  await d.run('loadOverview()');
  assert.equal(d.getElement('statHr').textContent, 68);
  assert.equal(d.getElement('statSpo2').textContent, '99%');
  assert.equal(d.getElement('statStress').textContent, 0);
  assert.ok(d.requested.every(url => !url.includes('limit=1')));
});

test('a slow previous request cannot overwrite a refreshed date range', async () => {
  const d = dashboard(queryResponses);
  const pending = [];
  d.context.fetch = url => new Promise(resolve => pending.push({url, resolve}));
  d.getElement('startDate').value = '2026-10-05';
  const oldLoad = d.run('loadOverview()');
  d.getElement('startDate').value = '2026-09-06';
  const newLoad = d.run('loadOverview()');
  const finish = (prefix, steps) => {
    pending.filter(request => request.url.includes(`start_date=${prefix}`)).forEach(request => {
      const data = request.url.includes('/api/summary?') ? [{date:'2026-10-06',steps}] : [];
      request.resolve({ok:true,status:200,text:async()=>JSON.stringify({status:'ok',data})});
    });
  };
  finish('2026-09-06', 9907);
  await newLoad;
  finish('2026-10-05', 18137);
  await oldLoad;
  assert.equal(d.getElement('statSteps').textContent, '9,907');
  assert.match(d.getElement('overviewRangeStatus').textContent, /^2026-09-06 至 2026-10-06/);
});

test('date shortcuts select inclusive 7-day and 30-day ranges', () => {
  const d = dashboard(queryResponses);
  for (const [preset, days] of [['7d',7],['30d',30],['yesterday',2]]) {
    d.run(`setDatePreset('${preset}')`);
    const start = Date.parse(d.getElement('startDate').value);
    const end = Date.parse(d.getElement('endDate').value);
    assert.equal((end-start)/86400000 + 1, days);
  }
});

test('reloading preserves a selected history range', () => {
  const d = dashboard(queryResponses, {'mi_fitness_start_date':'2026-09-06','mi_fitness_end_date':'2026-10-06'});
  d.run('initDates()');
  assert.equal(d.getElement('startDate').value, '2026-09-06');
  assert.equal(d.getElement('endDate').value, '2026-10-06');
});

test('activity and sleep views render query rows and sleep stages', async () => {
  const d = dashboard(queryResponses);
  d.getElement('napsSelect').value = 'true';
  await d.run('querySummary()');
  assert.match(d.getElement('summaryVisualContainer').innerHTML, /0\.80 km/);
  assert.match(d.getElement('summaryVisualContainer').innerHTML, /50 kcal/);
  await d.run('querySleep()');
  assert.match(d.getElement('sleepTimelineWrapper').innerHTML, /深睡 90m/);
  assert.match(d.getElement('sleepTimelineWrapper').innerHTML, /REM 60m/);
});

test('empty date range clears previously displayed readings', async () => {
  const responses = Object.fromEntries(Object.keys(queryResponses).map(endpoint => [endpoint, {body:{status:'ok', count:0, data:[]}}]));
  const d = dashboard(responses);
  d.getElement('statSteps').textContent = '12345';
  await d.run('loadOverview()');
  assert.equal(d.getElement('statSteps').textContent, '--');
  assert.equal(d.toasts.at(-1).title, '所选日期暂无本地数据');
});

test('HTTP 200 sync failure is not reported as successful sync', async () => {
  const d = dashboard({'/api/sync': {body:{status:'error',results:[{status:'error',error:'synthetic error'}]}}});
  await d.run('triggerSync(false)');
  assert.equal(d.toasts.at(-1).type, 'error');
  assert.equal(d.toasts.at(-1).title, '同步未完成');
});

test('HTTP authentication failure does not trigger a sync-success notification', async () => {
  const d = dashboard({'/api/sync': {httpStatus:401, body:{detail:'synthetic authentication failure'}}});
  await d.run('triggerSync(false)');
  assert.equal(d.toasts.at(-1).type, 'error');
  assert.match(d.toasts.at(-1).title, /HTTP 401/);
});

test('key list renders backend masked keys and escapes labels', async () => {
  const d = dashboard({'/api/auth/keys': {body:{status:'ok',count:1,data:[{key_masked:'mif_sk_abcde…1234',label:'<img src=x>',user_id:'fake-user'}]}}});
  await d.run('listKeys()');
  assert.match(d.getElement('keysTableWrapper').innerHTML, /mif_sk_abcde…1234/);
  assert.match(d.getElement('keysTableWrapper').innerHTML, /&lt;img src=x&gt;/);
});
