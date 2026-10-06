/**
 * Mi Fitness local health notebook
 * Core Client-side Application Logic
 */

// State Store
const state = {
  activeTab: 'overview',
  tables: {},
  viewRequests: {},
  sleepRecords: [],
  apiKey: localStorage.getItem('mi_fitness_api_key') || '',
  qrToken: '',
  qrPollInterval: null,
  qrTimerInterval: null,
  qrExpiresIn: 300,
  syncTypes: ['daily_activity', 'heart_rate', 'sleep', 'workouts', 'body_measurements', 'spo2', 'stress', 'abnormal_heart_beat'],
  lastResponse: null,
  lastRequestInfo: null,
  overviewRequestId: 0,
};

// DOM Utilities
const $ = (id) => document.getElementById(id);
const $$ = (selector) => document.querySelectorAll(selector);
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

// Date Helpers
const formatDate = (d) => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

function initDates() {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const savedStart = localStorage.getItem('mi_fitness_start_date');
  const savedEnd = localStorage.getItem('mi_fitness_end_date');
  const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || '');
  if (validDate(savedStart) && validDate(savedEnd) && savedStart <= savedEnd) {
    $('startDate').value = savedStart;
    $('endDate').value = savedEnd;
    $$('.preset-pill').forEach(p => p.classList.remove('active'));
  } else {
    $('startDate').value = formatDate(yesterday);
    $('endDate').value = formatDate(today);
  }
}

function saveDateRange() {
  localStorage.setItem('mi_fitness_start_date', getSd());
  localStorage.setItem('mi_fitness_end_date', getEd());
}

function setDatePreset(type) {
  const today = new Date();
  let start = new Date(today);
  
  $$('.preset-pill').forEach(p => p.classList.remove('active'));
  
  if (type === 'today') {
    start = today;
  } else if (type === 'yesterday') {
    start.setDate(today.getDate() - 1);
  } else if (type === '7d') {
    start.setDate(today.getDate() - 6);
  } else if (type === '30d') {
    start.setDate(today.getDate() - 29);
  } else if (type === 'month') {
    start = new Date(today.getFullYear(), today.getMonth(), 1);
  }
  
  $('startDate').value = formatDate(start);
  $('endDate').value = formatDate(today);
  saveDateRange();
  
  const el = $(`preset-${type}`);
  if (el) el.classList.add('active');
  loadSelectedTab();
}

const getSd = () => $('startDate').value;
const getEd = () => $('endDate').value;
const getRangeQuery = (path) => `${path}?start_date=${getSd()}&end_date=${getEd()}`;
const getSelQuery = (id, param) => {
  const v = $(id).value;
  return v ? `&${param}=${encodeURIComponent(v)}` : '';
};
const getLimQuery = (id) => {
  const v = $(id).value.trim();
  return v ? `&limit=${encodeURIComponent(v)}` : '';
};

// Toast Notifications
function showToast(title, desc = '', type = 'info', duration = 3500) {
  const container = $('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast-message ${type}`;
  
  const icons = {
    success: '✓',
    error: '!',
    warning: '!',
    info: 'i',
  };

  toast.innerHTML = `
    <div class="toast-icon">${icons[type] || 'i'}</div>
    <div class="toast-content">
      <div class="toast-title">${escapeHtml(title)}</div>
      ${desc ? `<div class="toast-desc">${escapeHtml(desc)}</div>` : ''}
    </div>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-leaving');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// Tab Switching
function switchTab(tabId) {
  state.activeTab = tabId;
  
  $$('.nav-item').forEach(item => {
    item.classList.toggle('active', item.getAttribute('data-tab') === tabId);
  });
  
  $$('.tab-pane').forEach(pane => {
    pane.classList.toggle('active', pane.id === `tab-${tabId}`);
  });
  const titles = {overview:'数据概览',activity:'每日活动',sleep:'睡眠记录',workouts:'运动记录',heartrate:'心率记录',spo2:'血氧记录',stress:'压力记录',body:'体重与体成分',sync:'云端同步',series:'指标统计',abnormal:'异常心跳记录',doctor:'连接与数据覆盖',keys:'账号与密钥'};
  $('pageTitle').textContent = titles[tabId] || '健康记录';
  $('pageSubtitle').textContent = ['sync','keys','doctor'].includes(tabId) ? '管理本地数据与账号连接' : '查看选定日期内的本地记录';
  if (['series','abnormal','doctor','keys'].includes(tabId)) document.querySelector('.nav-tools').open = true;
  loadSelectedTab();
}

// API Communication & Proxy Handler
function getHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const key = state.apiKey || $('apiKeyInput').value.trim();
  if (key) {
    headers['X-API-Key'] = key;
  }
  return headers;
}

async function api(method, path, body = null) {
  const startTime = performance.now();
  const url = '/proxy' + path;
  
  updateInspectorHeader(method, path, 'pending', '请求中…');
  $('inspectorBody').innerHTML = `<div class="inspector-empty-state"><div class="spinner"></div><div>正在通过 Flask 代理请求后端...</div></div>`;

  try {
    const options = {
      method,
      headers: getHeaders(),
    };
    if (body) {
      options.body = JSON.stringify(body);
    }

    const resp = await fetch(url, options);
    const latency = Math.round(performance.now() - startTime);
    const text = await resp.text();

    let jsonObj = null;
    try {
      jsonObj = JSON.parse(text);
    } catch (e) {
      // plain text
    }

    state.lastResponse = jsonObj || text;
    state.lastRequestInfo = {
      method,
      path,
      url,
      status: resp.status,
      latency,
      headers: options.headers,
      body,
    };

    updateInspectorHeader(method, path, resp.ok ? 'ok' : 'err', `HTTP ${resp.status}`, latency);
    renderJsonViewer(state.lastResponse);

    if (!resp.ok) {
      showToast(`请求失败: HTTP ${resp.status}`, jsonObj?.error || jsonObj?.detail || '请查看控制台输出', 'error');
      return null;
    }

    // Keep the full response in the inspector; renderers consume the query rows.
    return Array.isArray(jsonObj?.data) ? jsonObj.data : jsonObj;
  } catch (err) {
    const latency = Math.round(performance.now() - startTime);
    updateInspectorHeader(method, path, 'err', '网络错误', latency);
    $('inspectorBody').innerHTML = `<div style="color:var(--status-error);padding:12px;"> 代理网络连接错误: ${escapeHtml(err.message)}<br><br> 请检查:<br>1. Python FastAPI 是否在 127.0.0.1:8321 运行<br>2. Flask 代理是否正常监听</div>`;
    showToast('代理连接失败', '无法连接到后端服务，请确认端口与服务状态', 'error');
    return null;
  }
}

// Inspector View Rendering
function updateInspectorHeader(method, path, statusType, statusText, latency = 0) {
  const methodClass = method.toLowerCase();
  $('metaMethod').className = `http-method-pill ${methodClass}`;
  $('metaMethod').textContent = method;
  
  $('metaStatus').className = `status-pill ${statusType}`;
  $('metaStatus').textContent = statusText;
  
  $('metaLatency').textContent = latency > 0 ? `${latency} ms` : '...';
  $('metaUrl').textContent = path;
}

function renderJsonViewer(data) {
  if (!data) {
    $('inspectorBody').innerHTML = `<div class="inspector-empty-state"><div class="inspector-empty-icon"></div><div>暂无返回数据</div></div>`;
    return;
  }

  const jsonStr = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  $('inspectorBody').innerHTML = highlightJson(jsonStr);
}

function highlightJson(json) {
  if (typeof json !== 'string') {
    json = JSON.stringify(json, null, 2);
  }
  json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
    let cls = 'json-number';
    if (/^"/.test(match)) {
      if (/:$/.test(match)) {
        cls = 'json-key';
      } else {
        cls = 'json-string';
      }
    } else if (/true|false/.test(match)) {
      cls = 'json-boolean';
    } else if (/null/.test(match)) {
      cls = 'json-null';
    }
    return `<span class="${cls}">${match}</span>`;
  });
}

function filterInspectorJson(query) {
  if (!state.lastResponse) return;
  const q = query.trim().toLowerCase();
  if (!q) {
    renderJsonViewer(state.lastResponse);
    return;
  }
  const str = JSON.stringify(state.lastResponse, null, 2);
  const lines = str.split('\n');
  const filtered = lines.filter(line => line.toLowerCase().includes(q)).join('\n');
  $('inspectorBody').innerHTML = `<div style="color:var(--accent-cyan);font-size:11px;margin-bottom:8px;"> 匹配到 ${lines.filter(l => l.toLowerCase().includes(q)).length} 行:</div>` + highlightJson(filtered || '未找到匹配项');
}

// Copy & Export Tools
function copyResponse() {
  if (!state.lastResponse) {
    showToast('无可复制数据', '', 'warning');
    return;
  }
  const text = typeof state.lastResponse === 'string' ? state.lastResponse : JSON.stringify(state.lastResponse, null, 2);
  navigator.clipboard.writeText(text).then(() => {
    showToast('复制成功', '响应 JSON 已存入剪贴板', 'success');
  });
}

function copyCurl() {
  if (!state.lastRequestInfo) {
    showToast('无可用请求', '请先发起一次 API 请求', 'warning');
    return;
  }
  const { method, path, headers, body } = state.lastRequestInfo;
  let curl = `curl -X ${method} "http://127.0.0.1:8321${path}"`;
  for (const [k, v] of Object.entries(headers)) {
    curl += ` \\\n  -H "${k}: ${v}"`;
  }
  if (body) {
    curl += ` \\\n  -d '${JSON.stringify(body)}'`;
  }
  navigator.clipboard.writeText(curl).then(() => {
    showToast('cURL 命令已复制', '可在终端直接执行该请求', 'success');
  });
}

function downloadJson() {
  if (!state.lastResponse) {
    showToast('无可下载数据', '', 'warning');
    return;
  }
  const text = typeof state.lastResponse === 'string' ? state.lastResponse : JSON.stringify(state.lastResponse, null, 2);
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mi-fitness-response-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('下载完成', 'JSON 文件已保存', 'success');
}

// Overview Dashboard Loader
async function loadOverview() {
  const requestId = ++state.overviewRequestId;
  const startDate = getSd();
  const endDate = getEd();
  const rangeQuery = (path) => `${path}?start_date=${startDate}&end_date=${endDate}`;
  $('overviewActivityChart').innerHTML = '<div class="empty-state"><div class="spinner"></div>正在读取记录…</div>';
  $('overviewActivityStats').innerHTML = '';
  $('overviewSleepVisual').innerHTML = '';
  ['stepsRecordDate','sleepRecordDate','hrRecordDate','spo2RecordDate','stressRecordDate'].forEach(id=>{$(id).textContent='正在读取';});
  $('overviewRangeStatus').textContent = `正在查询 ${startDate} 至 ${endDate} 的本地记录…`;
  ['statSteps', 'statCalories', 'statDistance', 'statHr', 'statSleep', 'statSpo2', 'statStress']
    .forEach(id => { $(id).textContent = '--'; });
  const summaryPromise = api('GET', rangeQuery('/api/summary'));
  const hrPromise = api('GET', rangeQuery('/api/heart-rate') + '&sample_type=resting');
  const sleepPromise = api('GET', rangeQuery('/api/sleep') + '&include_naps=true');
  const spo2Promise = api('GET', rangeQuery('/api/spo2'));
  const stressPromise = api('GET', rangeQuery('/api/stress'));

  const [summary, hr, sleep, spo2, stress] = await Promise.all([
    summaryPromise, hrPromise, sleepPromise, spo2Promise, stressPromise
  ]);
  // A slow initial request must not overwrite a later date-range refresh.
  if (requestId !== state.overviewRequestId) return;

  if (summary && Array.isArray(summary) && summary.length > 0) {
    const latest = summary[summary.length - 1];
    $('overviewRangeStatus').textContent =
      `${startDate} 至 ${endDate} · 最新活动记录 ${latest.date}`;
    $('statSteps').textContent = numeric(latest.steps) ? numberText(latest.steps) : '--';
    $('statCalories').textContent = numeric(latest.active_kcal) ? Math.round(latest.active_kcal) : '--';
    $('statDistance').textContent = numeric(latest.distance_m) ? (latest.distance_m / 1000).toFixed(2) : '--';
  } else {
    $('overviewRangeStatus').textContent = `${startDate} 至 ${endDate}：暂无活动记录，请同步所选日期范围`;
  }

  if (hr && Array.isArray(hr) && hr.length > 0) {
    $('statHr').textContent = hr[hr.length - 1].bpm ?? '--';
  }

  if (sleep && Array.isArray(sleep) && sleep.length > 0) {
    const lastSleep = sleep[sleep.length - 1];
    const totalMinutes = lastSleep.time_asleep_minutes;
    const hours = (totalMinutes / 60).toFixed(1);
    $('statSleep').textContent = isNaN(hours) ? '--' : hours;
  }

  if (spo2 && Array.isArray(spo2) && spo2.length > 0) {
    const latestSpo2 = spo2[spo2.length - 1].spo2_pct;
    $('statSpo2').textContent = latestSpo2 != null ? `${latestSpo2}%` : '--';
  }

  if (stress && Array.isArray(stress) && stress.length > 0) {
    $('statStress').textContent = stress[stress.length - 1].stress_score ?? '--';
  }

  renderOverviewVisuals(summary, hr, sleep, spo2, stress, startDate, endDate);

  const responses = [summary, hr, sleep, spo2, stress];
  if (responses.some(data => data === null)) {
    showToast('部分数据加载失败', '请查看控制台中的错误响应', 'warning');
  } else if (responses.some(data => Array.isArray(data) && data.length > 0)) {
    // Successful cached reads stay quiet; the page is the confirmation.
  } else {
    showToast('所选日期暂无本地数据', '请先同步该日期范围，或调整查询日期', 'info');
  }
}

// Local, dependency-free presentation. Missing readings stay missing.
const numeric = (value) => value != null && value !== '' && Number.isFinite(Number(value));
const numberText = (value, digits = 0) => numeric(value)
  ? Number(value).toLocaleString('zh-CN', { maximumFractionDigits: digits, minimumFractionDigits: digits }) : '—';
const dateText = (value) => value ? String(value).slice(0, 10) : '—';
const timeText = (value) => value ? String(value).slice(11, 16) : '—';
const stampText = (value) => value ? `${dateText(value)} ${timeText(value)}` : '—';
const durationText = (minutes) => !numeric(minutes) ? '—' : `${Math.floor(Math.round(Number(minutes)) / 60)} 小时 ${Math.round(Number(minutes)) % 60} 分钟`;
const emptyView = (message = '所选日期暂无记录', failed = false) => `<div class="empty-state"><strong>${escapeHtml(failed ? '数据加载失败' : message)}</strong><p>${failed ? '检查连接或账号后，再点击刷新。' : '可调整日期范围，或先同步这段时间的数据。'}</p></div>`;
const miniStat = (title, value, unit = '') => `<div class="mini-stat">${escapeHtml(title)}<strong>${escapeHtml(value)}<small>${escapeHtml(unit)}</small></strong></div>`;

function makeBarChart(rows, field = 'steps', unit = '步', startDate = getSd(), endDate = getEd(), calendar = true) {
  if (!Array.isArray(rows) || !rows.some(row => numeric(row[field]))) return emptyView();
  const byDate = new Map(rows.map(row => [row.date, row[field]]));
  const start = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);
  const slots = [];
  if (calendar && Number.isFinite(start.getTime()) && end >= start && (end - start) / 86400000 <= 365) {
    for (let day = new Date(start); day <= end; day.setDate(day.getDate() + 1)) {
      const date = formatDate(day);
      slots.push({ date, value: byDate.has(date) ? byDate.get(date) : null });
    }
  } else rows.forEach(row => slots.push({ date: row.date, value: row[field] }));
  const width = 600, height = 210, left = 44, right = 10, top = 14, bottom = 34;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const max = Math.max(...slots.map(row => numeric(row.value) ? Number(row.value) : 0), 1);
  const step = plotWidth / slots.length;
  const barWidth = Math.min(28, step * .56);
  let svg = `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(unit)}趋势，缺失日期显示为虚线标记">`;
  for (const fraction of [0, .5, 1]) {
    const y = top + plotHeight * (1 - fraction);
    svg += `<line class="chart-grid" x1="${left}" y1="${y}" x2="${width - right}" y2="${y}"/><text class="chart-label" x="${left - 9}" y="${y + 3}" text-anchor="end">${numberText(max * fraction)}</text>`;
  }
  const latest = rows[rows.length - 1]?.date;
  slots.forEach((row, index) => {
    const x = left + step * (index + .5);
    if (numeric(row.value)) {
      const barHeight = Number(row.value) / max * plotHeight;
      svg += `<rect class="chart-bar ${row.date === latest ? 'latest' : ''}" x="${x - barWidth / 2}" y="${top + plotHeight - barHeight}" width="${barWidth}" height="${barHeight}" rx="2" tabindex="0"><title>${escapeHtml(row.date)} · ${numberText(row.value)} ${escapeHtml(unit)}</title></rect>`;
      if (Number(row.value) === 0) svg += `<circle class="chart-point" cx="${x}" cy="${top + plotHeight}" r="2"><title>${escapeHtml(row.date)} · 0 ${escapeHtml(unit)}</title></circle>`;
    } else {
      svg += `<line x1="${x - 3}" x2="${x + 3}" y1="${top + plotHeight - 3}" y2="${top + plotHeight - 3}" stroke="#9da596" stroke-dasharray="2 2"><title>${escapeHtml(row.date)} · 无记录</title></line>`;
    }
    const labelEvery = Math.max(1, Math.ceil(slots.length / 7));
    if (index % labelEvery === 0 || (index === slots.length - 1 && index % labelEvery > labelEvery / 2)) {
      svg += `<text class="chart-label" x="${x}" y="${height - 10}" text-anchor="middle">${escapeHtml(row.date?.slice(5))}</text>`;
    }
  });
  return svg + '</svg>';
}

function makeLineChart(points, unit) {
  if (!points.length) return emptyView();
  const width = 640, height = 210, left = 46, right = 14, top = 18, bottom = 38;
  const values = points.map(point => point.value);
  const low = Math.max(0,Math.floor(values.reduce((a,b)=>Math.min(a,b),Infinity) - 2));
  const high = Math.min(unit==='%' || unit==='/ 100' ? 100 : Infinity,Math.ceil(values.reduce((a,b)=>Math.max(a,b),-Infinity) + 2));
  const x = (i) => left + (width - left - right) * (points.length === 1 ? .5 : i / (points.length - 1));
  const y = (value) => top + (height - top - bottom) * (1 - (value - low) / (high - low));
  let svg = `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="平均值趋势，单位 ${escapeHtml(unit)}，纵轴 ${low} 至 ${high}">`;
  for (const value of [low, (low + high) / 2, high]) {
    svg += `<line class="chart-grid" x1="${left}" x2="${width - right}" y1="${y(value)}" y2="${y(value)}"/><text class="chart-label" x="${left - 9}" y="${y(value) + 3}" text-anchor="end">${numberText(value, 1)}</text>`;
  }
  // Break the line at missing local dates or hours instead of implying continuous coverage.
  let path = '';
  points.forEach((point, i) => {
    const previous = points[i - 1];
    const gap = previous && (Date.parse(point.timestamp) - Date.parse(previous.timestamp)) > (point.hourly ? 3600000 : 86400000) * 1.5;
    path += `${i === 0 || gap ? 'M' : 'L'}${x(i)},${y(point.value)} `;
  });
  svg += `<path class="chart-line" d="${path}"/>`;
  const labelEvery = Math.max(1, Math.ceil(points.length / 7));
  points.forEach((point, i) => {
    svg += `<circle class="chart-point" cx="${x(i)}" cy="${y(point.value)}" r="3" tabindex="0"><title>${escapeHtml(point.label)} · ${numberText(point.value, 1)} ${escapeHtml(unit)} · ${point.count} 条样本</title></circle>`;
    if (i % labelEvery === 0) svg += `<text class="chart-label" x="${x(i)}" y="${height - 12}" text-anchor="middle">${escapeHtml(point.label)}</text>`;
  });
  return svg + '</svg>';
}

function renderDataTable(id, columns, rows, page = 0) {
  const container = $(id);
  if (!container) return;
  state.tables[id] = { columns, rows, page };
  const pageSize = 25, pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  page = Math.max(0, Math.min(page, pageCount - 1));
  state.tables[id].page = page;
  const visible = rows.slice(page * pageSize, (page + 1) * pageSize);
  container.innerHTML = `<div class="data-table-container"><table class="data-table"><thead><tr>${columns.map(column => `<th class="${column.numeric ? 'numeric' : ''}">${escapeHtml(column.title)}</th>`).join('')}</tr></thead><tbody>${visible.map(row => `<tr>${columns.map(column => `<td class="${column.numeric ? 'numeric' : ''}">${escapeHtml(column.format ? column.format(row[column.key], row) : row[column.key] ?? '—')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${rows.length ? `<div class="table-pagination"><span>共 ${numberText(rows.length)} 条记录 · 每页 25 条</span><div class="btn-group"><button class="btn btn-outline btn-sm" onclick="changeTablePage('${id}', -1)" ${page === 0 ? 'disabled' : ''}>上一页</button><span>${page + 1} / ${pageCount}</span><button class="btn btn-outline btn-sm" onclick="changeTablePage('${id}', 1)" ${page === pageCount - 1 ? 'disabled' : ''}>下一页</button></div></div>` : ''}`;
}

function changeTablePage(id, change) {
  const table = state.tables[id];
  if (table) renderDataTable(id, table.columns, table.rows, table.page + change);
}

async function loadView(id, path, render) {
  const request = (state.viewRequests[id] || 0) + 1;
  state.viewRequests[id] = request;
  $(id).innerHTML = '<div class="empty-state"><div class="spinner"></div>正在读取本地记录…</div>';
  const data = await api('GET', path);
  if (state.viewRequests[id] !== request) return;
  if (data === null || data?.status === 'error') {
    $(id).innerHTML = emptyView('', true);
    return;
  }
  render(data);
}

function activityStats(rows) {
  const steps = rows.filter(row => numeric(row.steps));
  const total = steps.reduce((sum, row) => sum + Number(row.steps), 0);
  return `<span>记录天数<strong>${steps.length}</strong></span><span>日均步数<strong>${steps.length ? numberText(total / steps.length) : '—'}</strong></span><span>累计步数<strong>${numberText(total)}</strong></span>`;
}

function renderOverviewVisuals(summary, hr, sleep, spo2, stress, startDate, endDate) {
  const activity = Array.isArray(summary) ? summary : [];
  $('overviewActivityChart').innerHTML = summary === null ? emptyView('', true) : makeBarChart(activity, 'steps', '步', startDate, endDate);
  $('overviewActivityStats').innerHTML = activity.length ? activityStats(activity) : '';
  const updateDate = (id, rows, field) => {
    $(id).textContent = Array.isArray(rows) && rows.length ? dateText(rows[rows.length - 1][field]) : '暂无记录';
  };
  updateDate('stepsRecordDate', summary, 'date');
  updateDate('hrRecordDate', hr, 'timestamp');
  updateDate('sleepRecordDate', sleep, 'end_at');
  updateDate('spo2RecordDate', spo2, 'timestamp');
  updateDate('stressRecordDate', stress, 'timestamp');
  const lastSleep = Array.isArray(sleep) ? sleep[sleep.length - 1] : null;
  $('overviewSleepDate').textContent = lastSleep ? `${dateText(lastSleep.end_at)} · ${lastSleep.is_nap ? '小睡' : '睡眠记录'}` : '按起床日期记录';
  $('overviewSleepVisual').innerHTML = lastSleep ? sleepComposition(lastSleep) : emptyView('暂无睡眠记录', sleep === null);
  const days = Math.round((Date.parse(endDate) - Date.parse(startDate)) / 86400000) + 1;
  $('overviewDataNote').textContent = `选定 ${days} 天，已记录 ${activity.length} 天活动。指标展示各自最新一条记录，日期可能不同；缺失记录不作为零值。距离来自去重的分钟明细，可能与 App 汇总不同。`;
}

async function querySummary() {
  await loadView('summaryVisualContainer', getRangeQuery('/api/summary'), renderSummaryVisual);
}

function renderSummaryVisual(data) {
  const container = $('summaryVisualContainer');
  if (!Array.isArray(data) || !data.length) { container.innerHTML = emptyView(); return; }
  container.innerHTML = `<div class="chart-output">${makeBarChart(data)}</div><div class="summary-line">${activityStats(data)}</div><div id="activityRecordsTable"></div><p class="data-note">步数与活动消耗采用云端合并的每日汇总。距离来自分钟明细，可能与 App 不同。</p>`;
  renderDataTable('activityRecordsTable', [
    {title:'日期',key:'date'}, {title:'步数',key:'steps',numeric:true,format:v=>`${numberText(v)} 步`},
    {title:'活动消耗',key:'active_kcal',numeric:true,format:v=>`${numberText(v)} kcal`},
    {title:'距离',key:'distance_m',numeric:true,format:v=>numeric(v)?`${numberText(v/1000,2)} km`:'—'},
    {title:'活动时长',key:'active_minutes',numeric:true,format:v=>numeric(v)?`${numberText(v)} 分钟`:'—'},
  ], data);
}

function renderSampleView(id, data, field, unit, title, extraColumns = []) {
  const rows = Array.isArray(data) ? data.filter(row => numeric(row[field])) : [];
  const container = $(id);
  if (!rows.length) { container.innerHTML = emptyView(); return; }
  const values = rows.map(row => Number(row[field]));
  const singleDay = new Set(rows.map(row => dateText(row.timestamp))).size === 1;
  const groups = new Map();
  rows.forEach(row => {
    const key = String(row.timestamp).slice(0, singleDay ? 13 : 10);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(Number(row[field]));
  });
  const points = [...groups].sort(([a],[b])=>a.localeCompare(b)).map(([key, readings])=>({
    label:singleDay ? `${key.slice(11)}:00` : key.slice(5),
    timestamp:singleDay ? `${key}:00:00` : `${key}T00:00:00`, hourly:singleDay,
    value:readings.reduce((a,b)=>a+b,0)/readings.length, count:readings.length,
  }));
  container.innerHTML = `<div class="mini-stat-row">${miniStat('最新记录',numberText(values[values.length-1]),unit)}${miniStat('样本均值',numberText(values.reduce((a,b)=>a+b,0)/values.length,1),unit)}${miniStat('样本范围',`${numberText(values.reduce((a,b)=>Math.min(a,b),Infinity))}–${numberText(values.reduce((a,b)=>Math.max(a,b),-Infinity))}`,unit)}${miniStat('样本数量',numberText(rows.length),'条')}</div><div class="panel-header"><h3>${escapeHtml(title)}趋势</h3><span class="panel-subtitle">按${singleDay ? '小时' : '日'}平均 · ${escapeHtml(unit)}</span></div><div class="chart-output">${makeLineChart(points,unit)}</div><div id="${id}Table"></div><p class="data-note">统计仅包含本次返回的样本；设置数量上限会截取较早的记录。图表平均值不代表全天连续监测。</p>`;
  renderDataTable(`${id}Table`, [
    {title:'记录时间',key:'timestamp',format:stampText},
    {title:`${title} (${unit})`,key:field,numeric:true,format:v=>numberText(v)},...extraColumns,
  ], rows.slice().reverse());
}

async function queryHeartRate() {
  const q = getRangeQuery('/api/heart-rate') + getSelQuery('hrType', 'sample_type') + getLimQuery('hrLimit');
  await loadView('heartRateVisual',q,data=>renderSampleView('heartRateVisual',data,'bpm','bpm','心率',[
    {title:'类型',key:'sample_type',format:v=>({resting:'静息',passive:'日常监测',active:'活跃采样',workout:'训练采样'}[v] || v || '—')},
  ]));
}

function sleepComposition(session) {
  const stageMinutes = (stage) => (session.stages || []).filter(item=>item.stage===stage).reduce((sum,item)=>sum+(Number(item.minutes)||0),0);
  const counts = {deep:stageMinutes('deep'),light:stageMinutes('light'),rem:stageMinutes('rem'),awake:stageMinutes('awake') || session.time_awake_minutes || 0};
  const total = Object.values(counts).reduce((a,b)=>a+b,0);
  const names = {deep:'深睡',light:'浅睡',rem:'REM',awake:'清醒'};
  return `<div class="sleep-large">${escapeHtml(durationText(session.time_asleep_minutes))}</div><div class="sleep-window">${escapeHtml(stampText(session.start_at))} — ${escapeHtml(timeText(session.end_at))}</div>${total ? `<div class="sleep-timeline-bar" role="img" aria-label="睡眠分期时长构成">${Object.entries(counts).map(([stage,minutes])=>`<div class="sleep-segment ${stage}" style="width:${minutes/total*100}%" title="${names[stage]} ${minutes} 分钟"></div>`).join('')}</div><div class="sleep-legend">${Object.entries(counts).map(([stage,minutes])=>`<span class="legend-item"><span class="legend-dot ${stage}"></span>${names[stage]} ${minutes} 分钟</span>`).join('')}</div>` : '<p class="panel-subtitle">这条记录没有睡眠分期。</p>'}<p class="sleep-caption">实际睡眠不含清醒时间。分期条表示时长构成，不表示先后顺序。</p>`;
}

async function querySleep() {
  await loadView('sleepTimelineWrapper',getRangeQuery('/api/sleep')+'&include_naps='+$('napsSelect').value,renderSleepTimeline);
}

function renderSleepTimeline(data) {
  if (!Array.isArray(data) || !data.length) { $('sleepTimelineWrapper').innerHTML = emptyView('暂无睡眠记录'); return; }
  state.sleepRecords = data;
  $('sleepTimelineWrapper').innerHTML = `<div class="form-row"><div class="form-group"><label class="form-label" for="sleepSessionSelect">选择一条睡眠记录</label><select id="sleepSessionSelect" class="select-control" onchange="selectSleepRecord(this.value)">${data.map((row,index)=>`<option value="${index}" ${index===data.length-1?'selected':''}>${escapeHtml(dateText(row.end_at))} · ${escapeHtml(timeText(row.start_at))}–${escapeHtml(timeText(row.end_at))} · ${row.is_nap?'小睡':'睡眠'}</option>`).join('')}</select></div></div><div id="sleepDetailVisual">${sleepComposition(data[data.length-1])}</div><p class="data-note">按起床日期归属。同一晚可能有多个来源的重叠记录，以下时长不直接相加。</p><div id="sleepRecordsTable"></div>`;
  renderDataTable('sleepRecordsTable',[
    {title:'起床日期',key:'end_at',format:dateText},{title:'入睡',key:'start_at',format:stampText},
    {title:'起床',key:'end_at',format:timeText},{title:'实际睡眠',key:'time_asleep_minutes',format:durationText},
    {title:'清醒',key:'time_awake_minutes',format:v=>numeric(v)?`${numberText(v)} 分钟`:'—'},
    {title:'类型',key:'is_nap',format:v=>v?'小睡':'睡眠'},
  ],data.slice().reverse());
}

function selectSleepRecord(index) {
  const session = state.sleepRecords[Number(index)];
  if (session) $('sleepDetailVisual').innerHTML = sleepComposition(session);
}

const workoutName = (value) => ({running:'跑步',outdoor_running:'户外跑步',walking:'步行',outdoor_walking:'户外步行',cycling:'骑行',outdoor_riding:'户外骑行',indoor_riding:'室内骑行',swimming:'游泳',hiking:'徒步',treadmill:'跑步机',indoor_running:'室内跑步',strength_training:'力量训练',yoga:'瑜伽'}[String(value).toLowerCase()] || (/^\d+$/.test(String(value)) ? `运动（类型 ${value}）` : value) || '运动');
const paceText = (value) => numeric(value) ? `${Math.floor(Math.round(value)/60)}′${String(Math.round(value)%60).padStart(2,'0')}″ / km` : '—';

async function queryWorkouts() {
  await loadView('workoutsVisual',getRangeQuery('/api/workouts'),data=>{
    if (!Array.isArray(data) || !data.length) { $('workoutsVisual').innerHTML=emptyView('暂无运动记录'); return; }
    $('workoutsVisual').innerHTML=`<div class="mini-stat-row">${miniStat('运动记录',data.length,'次')}${miniStat('累计时长',numberText(data.reduce((sum,row)=>sum+(Number(row.duration_minutes)||0),0)),'分钟')}</div><div id="workoutRecordsTable"></div>`;
    renderDataTable('workoutRecordsTable',[
      {title:'开始时间',key:'start_at',format:stampText},{title:'运动',key:'activity_type',format:workoutName},
      {title:'时长',key:'duration_minutes',format:v=>`${numberText(v)} 分钟`},
      {title:'距离',key:'distance_m',format:v=>numeric(v)?`${numberText(v/1000,2)} km`:'—'},
      {title:'消耗',key:'calories_kcal',format:v=>numeric(v)?`${numberText(v)} kcal`:'—'},
      {title:'平均心率',key:'avg_heart_rate_bpm',format:v=>numeric(v)?`${numberText(v)} bpm`:'—'},
      {title:'平均配速',key:'avg_pace_sec_per_km',format:paceText},
    ],data.slice().reverse());
  });
}

async function queryBody() {
  await loadView('bodyVisual',getRangeQuery('/api/body-measurements')+'&latest_only='+$('latestOnlyCheck').checked,data=>{
    if (!Array.isArray(data)||!data.length) { $('bodyVisual').innerHTML=emptyView('暂无体重或体成分记录'); return; }
    $('bodyVisual').innerHTML='<div id="bodyRecordsTable"></div><p class="data-note">未提供的体成分字段显示为横线。</p>';
    const fields=[['weight_kg','体重','kg'],['bmi','BMI',''],['body_fat_pct','体脂率','%'],['muscle_mass_kg','肌肉量','kg'],['water_pct','水分','%'],['bone_mass_kg','骨量','kg'],['visceral_fat_score','内脏脂肪指数',''],['basal_metabolism_kcal','基础代谢','kcal'],['metabolic_age','代谢年龄','岁']];
    renderDataTable('bodyRecordsTable',[{title:'记录时间',key:'timestamp',format:stampText},...fields.filter(([field])=>data.some(row=>row[field]!=null)).map(([key,title,unit])=>({key,title,format:v=>numeric(v)?`${numberText(v,1)} ${unit}`:'—'}))],data.slice().reverse());
  });
}

async function querySpo2() {
  await loadView('spo2Visual',getRangeQuery('/api/spo2')+getLimQuery('spo2Limit'),data=>renderSampleView('spo2Visual',data,'spo2_pct','%','血氧'));
}

async function queryStress() {
  await loadView('stressVisual',getRangeQuery('/api/stress')+getSelQuery('stressLevel','level')+getLimQuery('stressLimit'),data=>renderSampleView('stressVisual',data,'stress_score','/ 100','压力指数'));
}

async function queryAbnormalHr() {
  await loadView('abnormalVisual',getRangeQuery('/api/abnormal-heart-beat'),data=>{
    if (!Array.isArray(data)||!data.length) { $('abnormalVisual').innerHTML=emptyView('所选日期没有事件记录'); return; }
    renderDataTable('abnormalVisual',[{title:'开始',key:'start_at',format:stampText},{title:'结束',key:'end_at',format:stampText},{title:'持续时长',key:'duration_seconds',format:v=>`${numberText(v)} 秒`}],data.slice().reverse());
  });
}

async function queryMetricSeries() {
  const metric=$('metricSelect').value,gran=$('granularitySelect').value,agg=$('aggregationSelect').value;
  const q=`${getRangeQuery('/api/metric-series')}&metric=${metric}&granularity=${gran}&aggregation=${agg}`;
  await loadView('metricChartContainer',q,data=>renderMetricChart(data,metric));
}

function renderMetricChart(data, metricName) {
  const unit={steps:'步',distance_m:'m',active_kcal:'kcal'}[metricName] || '';
  if (!Array.isArray(data)||!data.length) { $('metricChartContainer').innerHTML=emptyView(); return; }
  $('metricChartContainer').innerHTML=makeBarChart(data,'value',unit,data[0].date,data[data.length-1].date,$('granularitySelect').value==='day')+'<div id="metricRecordsTable"></div>';
  renderDataTable('metricRecordsTable',[{title:'分组开始日期',key:'date'},{title:`统计值 (${unit})`,key:'value',numeric:true,format:v=>numberText(v,1)}],data);
}

async function queryDiagnostics(deep = false) {
  const data=await api('GET',`/api/status?deep=${deep}`);
  $('diagnosticsVisual').innerHTML=data ? `<div class="sync-status"><h3>${deep ? (data.connected?'云端连接可用':'云端尚未连接') : '本地状态'}</h3><p class="panel-subtitle">${escapeHtml(data.message || (data.sync_in_progress ? '正在同步数据' : '当前没有运行中的同步任务'))}</p></div>` : emptyView('',true);
}

async function queryCoverage() {
  const data=await api('GET','/api/coverage');
  const rows=Array.isArray(data)?data:data?.coverage;
  if (!Array.isArray(rows)||!rows.length) { $('diagnosticsVisual').innerHTML=emptyView('暂无缓存数据'); return; }
  const names={daily_activity:'每日活动',heart_rate:'心率',sleep:'睡眠',workouts:'运动',body_measurements:'体成分',spo2:'血氧',stress:'压力',abnormal_heart_beat:'异常心跳'};
  renderDataTable('diagnosticsVisual',[{title:'数据',key:'data_type',format:v=>names[v]||v},{title:'最早日期',key:'first_date'},{title:'最新日期',key:'last_date'},{title:'有记录的天数',key:'days_with_data',format:v=>numberText(v)}],rows);
}

function loadSelectedTab() {
  const loaders={overview:loadOverview,activity:querySummary,heartrate:queryHeartRate,sleep:querySleep,workouts:queryWorkouts,body:queryBody,spo2:querySpo2,stress:queryStress,abnormal:queryAbnormalHr,series:queryMetricSeries,doctor:queryCoverage};
  if (loaders[state.activeTab]) return loaders[state.activeTab]();
}


// Sync Center Control
function toggleSyncTag(tag) {
  const idx = state.syncTypes.indexOf(tag);
  if (idx > -1) {
    if (state.syncTypes.length > 1) {
      state.syncTypes.splice(idx, 1);
    } else {
      showToast('至少保留一种同步类型', '', 'warning');
      return;
    }
  } else {
    state.syncTypes.push(tag);
  }
  renderSyncPills();
}

function selectAllSyncTags(all = true) {
  if (all) {
    state.syncTypes = ['daily_activity', 'heart_rate', 'sleep', 'workouts', 'body_measurements', 'spo2', 'stress', 'abnormal_heart_beat'];
  } else {
    state.syncTypes = ['daily_activity'];
  }
  renderSyncPills();
}

function renderSyncPills() {
  const container = $('syncTagPills');
  if (!container) return;
  const allTypes = [
    { id: 'daily_activity', name: '每日活动' },
    { id: 'heart_rate', name: '心率' },
    { id: 'sleep', name: '睡眠' },
    { id: 'workouts', name: '运动' },
    { id: 'body_measurements', name: '体成分' },
    { id: 'spo2', name: '血氧' },
    { id: 'stress', name: '压力' },
    { id: 'abnormal_heart_beat', name: '异常心跳' },
  ];

  container.innerHTML = allTypes.map(t => {
    const isSelected = state.syncTypes.includes(t.id);
    return `
      <button type="button" class="tag-pill ${isSelected ? 'selected' : ''}" aria-pressed="${isSelected}" onclick="toggleSyncTag('${t.id}')">
        <span class="tag-check" aria-hidden="true">✓</span>
        <span>${t.name}</span>
      </button>
    `;
  }).join('');
}

async function triggerSync(background = false) {
  const body = {
    start_date: getSd(),
    end_date: getEd(),
    background,
    data_types: state.syncTypes,
  };

  showToast(background ? '已触发后台异步同步' : '正在执行前台同步…', '请耐心等待云端响应', 'info');
  const res = await api('POST', '/api/sync', body);

  if (background && res && res.sync_id) {
    $('syncIdInput').value = res.sync_id;
    showSyncResult({...res,status:res.status || 'pending'});
    showToast('已获取同步任务 ID', res.sync_id, 'success');
  } else if (!background && res) {
    showSyncResult(res);
    if (res.status === 'ok' || res.status === 'partial') await loadOverview();
  }
}

function showSyncResult(result) {
  const names = {daily_activity:'每日活动',heart_rate:'心率',sleep:'睡眠',workouts:'运动',body_measurements:'体成分',spo2:'血氧',stress:'压力',abnormal_heart_beat:'异常心跳'};
  const title = {ok:'同步完成',partial:'部分同步完成',error:'同步失败',running:'正在同步',pending:'等待同步',cancelled:'同步已取消'}[result.status] || '同步任务';
  $('syncResultVisual').innerHTML = `<div class="sync-status ${result.status==='error'?'error':''}"><h3>${title}</h3><p class="panel-subtitle">新增 ${result.records_added ?? 0} 条 · 更新 ${result.records_updated ?? 0} 条${result.error ? ' · '+escapeHtml(result.error) : ''}</p></div><div id="syncTypesTable"></div>`;
  if (Array.isArray(result.results) && result.results.length) renderDataTable('syncTypesTable', [{title:'数据类型',key:'data_type',format:v=>names[v]||v},{title:'状态',key:'status',format:v=>({ok:'完成',error:'失败',skipped:'跳过'}[v]||v)},{title:'新增',key:'added',format:v=>numberText(v)},{title:'更新',key:'updated',format:v=>numberText(v)},{title:'说明',key:'error'}],result.results);
  const counts = `新增 ${result.records_added ?? 0} 条，更新 ${result.records_updated ?? 0} 条`;
  if (result.status === 'ok') {
    showToast('同步完成', counts, 'success');
  } else if (result.status === 'partial') {
    showToast('部分数据同步成功', `${counts}；请查看控制台中的失败类型`, 'warning');
  } else if (result.status === 'error' || result.status === 'cancelled') {
    showToast('同步未完成', result.error || '请查看控制台中的错误详情', 'error');
  }
}

async function pollSyncStatus() {
  const syncId = $('syncIdInput').value.trim();
  if (!syncId) {
    showToast('请输入同步任务 ID', '', 'warning');
    return;
  }
  const result = await api('GET', `/api/sync/${encodeURIComponent(syncId)}`);
  if (result) {
    showSyncResult(result);
    if (result.status === 'ok' || result.status === 'partial') await loadOverview();
  }
}

// QR Code Authentication Modal & Auto Polling
function openQrModal() {
  state.qrReturnFocus = document.activeElement;
  $('qrModal').classList.add('active');
  $('qrModal').querySelector('.modal-close-btn').focus();
  startQrFlow();
}

function closeQrModal() {
  const wasOpen = $('qrModal').classList.contains('active');
  $('qrModal').classList.remove('active');
  stopQrFlow();
  if (wasOpen) state.qrReturnFocus?.focus();
}

async function startQrFlow() {
  stopQrFlow();
  $('qrStatusText').textContent = '正在向小米账号服务器生成登录二维码...';
  $('qrScanBeam').style.display = 'none';

  const res = await api('POST', '/api/auth/qr/start?region=cn');
  if (res && res.qr_token) {
    state.qrToken = res.qr_token;
    state.qrExpiresIn = res.expires_in || 300;
    
    $('qrImage').src = `/proxy/api/auth/qr/${res.qr_token}.png`;
    $('qrLoginUrl').value = res.login_url || '';
    $('qrScanBeam').style.display = 'block';
    $('qrStatusText').textContent = '请打开小米运动健康/米家/小米账号 App 扫码并在手机上点击确认';

    startQrTimer();
    startQrPolling();
  } else {
    $('qrStatusText').textContent = '二维码生成失败，请确认后端连接正常';
  }
}

function startQrTimer() {
  const total = state.qrExpiresIn;
  let remaining = total;
  
  state.qrTimerInterval = setInterval(() => {
    remaining--;
    const mins = Math.floor(remaining / 60);
    const secs = String(remaining % 60).padStart(2, '0');
    $('qrTimerText').textContent = `有效期剩余: ${mins}:${secs}`;
    $('qrProgressBar').style.width = `${(remaining / total) * 100}%`;

    if (remaining <= 0) {
      stopQrFlow();
      $('qrStatusText').textContent = '二维码已过期，请点击「刷新二维码」重试';
    }
  }, 1000);
}

function startQrPolling() {
  state.qrPollInterval = setInterval(async () => {
    if (!state.qrToken) return;
    try {
      const res = await fetch(`/proxy/api/auth/qr/poll?token=${state.qrToken}`, {
        headers: getHeaders(),
      });
      const data = await res.json();

      if (data.status === 'scanned') {
        $('qrStatusText').innerHTML = ' <strong>已扫码！</strong> 请在手机上点击「确认登录」';
      } else if (data.status === 'confirmed' && data.api_key) {
        stopQrFlow();
        $('qrStatusText').innerHTML = ` <strong>登录成功！</strong> API Key 已自动保存`;
        saveApiKey(data.api_key);
        loadOverview();
        showToast('扫码授权成功', '账号已连接，可以同步数据', 'success');
        setTimeout(() => closeQrModal(), 1800);
      }
    } catch (e) {
      // ignore transient poll error
    }
  }, 2000);
}

function stopQrFlow() {
  if (state.qrPollInterval) clearInterval(state.qrPollInterval);
  if (state.qrTimerInterval) clearInterval(state.qrTimerInterval);
  state.qrPollInterval = null;
  state.qrTimerInterval = null;
}

function copyLoginUrl() {
  const url = $('qrLoginUrl').value;
  if (!url) return;
  navigator.clipboard.writeText(url).then(() => {
    showToast('登录链接已复制', '也可在手机浏览器打开该链接登录确认', 'success');
  });
}

// API Key Management
function saveApiKey(key) {
  state.apiKey = key.trim();
  localStorage.setItem('mi_fitness_api_key', state.apiKey);
  $('apiKeyInput').value = state.apiKey;
}

function initApiKeyInput() {
  const input = $('apiKeyInput');
  input.value = state.apiKey;
  input.addEventListener('change', (e) => {
    saveApiKey(e.target.value);
    showToast('API Key 已更新', '', 'info');
  });
}

async function createKeyWithCredentials() {
  const userId = $('keyUserId').value.trim();
  const passToken = $('keyPassToken').value.trim();
  const label = $('keyLabel').value.trim() || 'web-console';

  if (!userId || !passToken) {
    showToast('请填写 user_id 和 passToken', '', 'warning');
    return;
  }

  const res = await api('POST', '/api/auth/keys', {
    user_id: userId,
    pass_token: passToken,
    region: 'cn',
    label,
  });

  if (res && res.api_key) {
    saveApiKey(res.api_key);
    showToast('API Key 发放成功', '已自动填入全局请求头', 'success');
    listKeys();
  }
}

async function listKeys() {
  const data = await api('GET', '/api/auth/keys');
  renderKeysTable(data);
}

function renderKeysTable(data) {
  const container = $('keysTableWrapper');
  if (!container) return;
  if (!data || !Array.isArray(data) || data.length === 0) {
    container.innerHTML = '<p class="panel-subtitle">暂无已发放的 API Key 记录</p>';
    return;
  }

  let html = `
    <div class="data-table-container">
      <table class="data-table">
        <thead>
          <tr>
            <th>标签</th>
            <th>Key 前缀</th>
            <th>User ID</th>
            <th>创建时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
  `;

  data.forEach(k => {
    const prefix = k.key_masked?.split('…')[0] || k.prefix || k.api_key_prefix || '';
    html += `
      <tr>
        <td><strong>${escapeHtml(k.label || '默认')}</strong></td>
        <td><code>${escapeHtml(k.key_masked || prefix || 'mif_sk_...')}</code></td>
        <td>${escapeHtml(k.user_id || '--')}</td>
        <td>${escapeHtml(k.created_at || '--')}</td>
        <td>
          <button class="btn btn-danger btn-sm" data-key-prefix="${escapeHtml(prefix)}" onclick="revokeKeyByPrefix(this.dataset.keyPrefix)">吊销</button>
        </td>
      </tr>
    `;
  });

  html += '</tbody></table></div>';
  container.innerHTML = html;
}

async function revokeKeyByPrefix(prefix) {
  if (!prefix) {
    prefix = $('revokePrefixInput').value.trim();
  }
  if (!prefix) {
    showToast('请提供要吊销的 Key 前缀', '', 'warning');
    return;
  }
  if (!confirm(`确定要吊销前缀为 ${prefix} 的 API Key 吗？`)) return;

  await api('DELETE', `/api/auth/keys/${encodeURIComponent(prefix)}`);
  showToast('Key 吊销指令已发送', '', 'info');
  listKeys();
}

// System Connection & Health Check
async function checkSystemHealth() {
  const statusEl = $('backendStatusText');
  const dotEl = $('backendStatusDot');
  try {
    const res = await fetch('/api/proxy_status');
    const data = await res.json();
    if (data.backend_reachable) {
      dotEl.className = 'status-dot pulsing';
      statusEl.textContent = '本地服务已连接';
    } else {
      dotEl.className = 'status-dot offline pulsing';
      statusEl.textContent = '本地服务未连接';
    }
  } catch (e) {
    dotEl.className = 'status-dot offline pulsing';
    statusEl.textContent = '代理服务异常';
  }
}

// Initialization on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  initDates();
  initApiKeyInput();
  renderSyncPills();
  ['startDate', 'endDate'].forEach(id => {
    $(id).addEventListener('change', () => {
      $$('.preset-pill').forEach(p => p.classList.remove('active'));
      saveDateRange();
      loadSelectedTab();
    });
  });
  checkSystemHealth();
  setInterval(checkSystemHealth, 15000);

  // Bind preset pills
  $$('.preset-pill').forEach(pill => {
    pill.addEventListener('click', (e) => {
      const type = e.target.getAttribute('data-preset');
      if (type) setDatePreset(type);
    });
  });

  // Tab Navigation
  $$('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const tab = item.getAttribute('data-tab');
      if (tab) switchTab(tab);
    });
  });

  ['hrType','napsSelect','stressLevel','latestOnlyCheck','metricSelect','granularitySelect','aggregationSelect'].forEach(id=>$(id).addEventListener('change',()=>loadSelectedTab()));
  $('qrModal').addEventListener('click',event=>{if(event.target===$('qrModal')) closeQrModal();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape') closeQrModal();});

  // Auto load overview stats
  loadOverview();
});
