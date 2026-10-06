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
  assert.match(d.getElement('activityRecordsTable').innerHTML, /0\.80 km/);
  assert.match(d.getElement('activityRecordsTable').innerHTML, /50 kcal/);
  await d.run('querySleep()');
  assert.match(d.getElement('sleepTimelineWrapper').innerHTML, /深睡 90 分钟/);
  assert.match(d.getElement('sleepTimelineWrapper').innerHTML, /REM 60 分钟/);
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

test('sample views expose the returned readings, their units and a bounded table', async () => {
  const samples = Array.from({length:26},(_,index)=>({timestamp:`2026-10-06T${String(index%24).padStart(2,'0')}:00:00+08:00`,bpm:60+index,sample_type:index===0?'<script>':'resting'}));
  const d=dashboard({'/api/heart-rate':{body:{status:'ok',data:samples}}});
  d.getElement('hrType').value='';
  d.getElement('hrLimit').value='';
  await d.run('queryHeartRate()');
  assert.match(d.getElement('heartRateVisual').innerHTML,/bpm/);
  assert.match(d.getElement('heartRateVisual').innerHTML,/按小时平均/);
  assert.equal((d.getElement('heartRateVisualTable').innerHTML.match(/<tr>/g)||[]).length,26); // header + 25 records
  assert.doesNotMatch(d.getElement('heartRateVisualTable').innerHTML,/&lt;script&gt;/);
  d.run("changeTablePage('heartRateVisualTable',1)");
  assert.match(d.getElement('heartRateVisualTable').innerHTML,/&lt;script&gt;/);
  assert.doesNotMatch(d.getElement('heartRateVisualTable').innerHTML,/<script>/);
});

test('workout presentation converts distance and pace without turning absent fields into zero', async () => {
  const d=dashboard({'/api/workouts':{body:{status:'ok',data:[{activity_type:'running',start_at:'2026-10-06T07:30:00+08:00',duration_minutes:61,distance_m:1250,calories_kcal:null,avg_pace_sec_per_km:359.8}]}}});
  await d.run('queryWorkouts()');
  const table=d.getElement('workoutRecordsTable').innerHTML;
  assert.match(table,/跑步/);
  assert.match(table,/1\.25 km/);
  assert.match(table,/6′00″ \/ km/);
  assert.doesNotMatch(table,/0 kcal/);
  assert.match(table,/2026-10-06 07:30/);
});

test('sleep details allow selecting an earlier record and retain the overlap warning', async () => {
  const d=dashboard({'/api/sleep':{body:{status:'ok',data:[
    {end_at:'2026-10-05T08:00:00+08:00',time_asleep_minutes:360,stages:[{stage:'deep',minutes:60},{stage:'light',minutes:300}]},
    {end_at:'2026-10-06T08:00:00+08:00',time_asleep_minutes:420,stages:[{stage:'deep',minutes:90},{stage:'light',minutes:330}]},
  ]}}});
  await d.run('querySleep()');
  assert.match(d.getElement('sleepTimelineWrapper').innerHTML,/深睡 90 分钟/);
  assert.match(d.getElement('sleepTimelineWrapper').innerHTML,/重叠记录/);
  d.run('selectSleepRecord(0)');
  assert.match(d.getElement('sleepDetailVisual').innerHTML,/深睡 60 分钟/);
  assert.match(d.getElement('sleepDetailVisual').innerHTML,/6 小时 0 分钟/);
});

test('an absent date is visibly different from a recorded zero in activity charts', () => {
  const d=dashboard(queryResponses);
  const chart=d.run("makeBarChart([{date:'2026-10-05',steps:0}],'steps','步','2026-10-05','2026-10-06')");
  assert.match(chart,/2026-10-05 · 0 步/);
  assert.match(chart,/2026-10-06 · 无记录/);
  assert.doesNotMatch(chart,/2026-10-06 · 0 步/);
});

test('stress zero and empty body records are shown without generic health ratings', async () => {
  const d=dashboard({...queryResponses,'/api/body-measurements':{body:{status:'ok',data:[]}}});
  d.getElement('stressLevel').value='';
  d.getElement('stressLimit').value='';
  await d.run('queryStress()');
  assert.match(d.getElement('stressVisualTable').innerHTML,/>0<\/td>/);
  assert.doesNotMatch(d.getElement('stressVisual').innerHTML,/适中|健康|正常/);
  await d.run('queryBody()');
  assert.match(d.getElement('bodyVisual').innerHTML,/暂无体重或体成分记录/);
});

test('slow previous queries cannot replace the data in a newer detail view', async () => {
  const d=dashboard(queryResponses);
  const pending=[];
  d.context.fetch=url=>new Promise(resolve=>pending.push({url,resolve}));
  d.getElement('startDate').value='2026-10-05';
  const old=d.run('querySummary()');
  d.getElement('startDate').value='2026-10-06';
  const current=d.run('querySummary()');
  const finish=(index,steps)=>pending[index].resolve({ok:true,status:200,text:async()=>JSON.stringify({status:'ok',data:[{date:'2026-10-06',steps}]})});
  finish(1,9907); await current;
  finish(0,18137); await old;
  assert.match(d.getElement('activityRecordsTable').innerHTML,/9,907 步/);
  assert.doesNotMatch(d.getElement('activityRecordsTable').innerHTML,/18,137/);
});

test('failed detail queries show a retry state instead of claiming there are no records', async () => {
  const d=dashboard({'/api/spo2':{httpStatus:401,body:{detail:'synthetic authentication failure'}}});
  await d.run('querySpo2()');
  assert.match(d.getElement('spo2Visual').innerHTML,/数据加载失败/);
  assert.doesNotMatch(d.getElement('spo2Visual').innerHTML,/暂无记录/);
});
