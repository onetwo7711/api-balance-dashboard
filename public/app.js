'use strict';

const CACHE_KEY = 'balance-dashboard-last-good-v1';
const PAGE_PARAMS = new URLSearchParams(window.location.search);
const MODE = PAGE_PARAMS.get('mode') === 'float' ? 'float' : 'window';
const IS_DESKTOP = Boolean(window.desktopAPI && window.desktopAPI.isDesktop);
if (MODE === 'float') document.body.classList.add('mode-float');
const PLATFORMS = ['glm', 'deepseek'];
const REFRESH_LABELS = { 0: '已关闭', 60: '每1分钟', 300: '每5分钟', 900: '每15分钟', 1800: '每30分钟' };

const state = {
  config: null,
  items: {},
  lastGood: loadCache(),
  loading: false,
  loadingPlatform: null,
  timer: null,
  nextAt: null,
  lastRefreshAt: null,
};

const $ = (id) => document.getElementById(id);

function loadCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; }
  catch { return {}; }
}

function saveCache() {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(state.lastGood)); } catch { /* 隐私模式下忽略 */ }
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

async function api(url, options) {
  const response = await fetch(url, { cache: 'no-store', ...options });
  let data = null;
  try { data = await response.json(); } catch { data = null; }
  if (!response.ok) {
    const info = data && data.error;
    const message = info && typeof info === 'object' ? `${info.message}${info.hint ? `：${info.hint}` : ''}` : (info || `请求失败（HTTP ${response.status}）`);
    const err = new Error(message);
    err.code = info && typeof info === 'object' ? info.code : 'UNKNOWN';
    throw err;
  }
  return data;
}

function formatAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return esc(value);
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function currencySymbol(currency) {
  return currency === 'USD' ? '$' : '¥';
}

function formatTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', { hour12: false, year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function relativeTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff)) return '';
  if (diff < 60 * 1000) return '刚刚';
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)}小时前`;
  return `${Math.floor(diff / 86400000)}天前`;
}

function showToast(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.hidden = true; }, 3200);
}

// ---------------------------------------------------------------- 卡片渲染

function cardHtml(platform) {
  const current = state.items[platform];
  const cached = state.lastGood[platform];
  const fresh = current && current.ok ? current : null;
  const shown = fresh || cached || null;
  const failed = Boolean(current && !current.ok);
  const stale = Boolean(!fresh && cached);
  const error = failed ? current.error : null;

  let dotClass = 'dot-idle';
  let stateText = '等待查询';
  if (state.loading && !shown) { dotClass = 'dot-loading'; stateText = '查询中'; }
  else if (fresh) {
    dotClass = fresh.available === false ? 'dot-mixed' : 'dot-ok';
    stateText = fresh.available === false ? '余额不足' : '正常';
  } else if (failed) { dotClass = 'dot-bad'; stateText = '查询失败'; }

  const amountHtml = shown
    ? `<span class="amount" title="精确值：${esc(shown.balance)}">${esc(currencySymbol(shown.currency))}${formatAmount(shown.balance)}</span>
       <span class="currency-badge">${esc(shown.currency || 'CNY')}</span>`
    : `<span class="amount amount-placeholder">— —</span><span class="currency-badge">待查询</span>`;

  let note = '';
  if (state.loading && !shown) note = '正在向平台查询余额…';
  else if (fresh && fresh.available === false) note = '平台提示余额不足，API调用可能被拒绝，请及时充值。';
  else if (fresh) note = '数据来自平台实时接口。';
  else if (failed) note = '本次查询未成功，请查看下方错误提示。';
  else if (!shown) note = '点击「刷新余额」开始查询。';
  else note = '当前显示上次查询成功的数据。';

  const updatedAt = shown ? shown.updatedAt : null;
  const timeText = updatedAt ? `${formatTime(updatedAt)}（${relativeTime(updatedAt)}）` : '—';
  const metaRows = [`<div class="meta-row"><span class="meta-label">最近更新时间</span><span class="meta-value">${esc(timeText)}</span></div>`];
  if (fresh && MODE !== 'float') {
    metaRows.push(`<div class="meta-row"><span class="meta-label">接口来源</span><span class="meta-value">${esc(fresh.source || '平台接口')}</span></div>`);
    metaRows.push(`<div class="meta-row"><span class="meta-label">本次耗时</span><span class="meta-value">${esc(fresh.latencyMs)}毫秒</span></div>`);
  }

  const breakdown = shown && shown.breakdown && shown.breakdown.length
    ? `<div class="breakdown">${shown.breakdown.map((row) => `
        <div class="breakdown-row"><span class="breakdown-label">${esc(row.label)}</span><span class="breakdown-value">${esc(currencySymbol(shown.currency))}${formatAmount(row.value)}</span></div>`).join('')}</div>`
    : '';

  let alertHtml = '';
  if (error) {
    alertHtml = `<div class="alert">
      <div class="alert-title"><span class="dot dot-bad" aria-hidden="true"></span>${esc(error.message)}<span class="alert-code">${esc(error.code)}</span></div>
      <p>${esc(error.hint)}</p>
      ${error.detail ? `<p class="alert-detail">接口返回：${esc(error.detail)}</p>` : ''}
    </div>`;
  }
  const staleHtml = stale && !failed ? `<div class="stale">尚未完成本次查询，显示上次成功数据。</div>` : '';

  const platformName = platform === 'glm' ? '智谱GLM' : 'DeepSeek';
  const refreshSpin = state.loadingPlatform === platform ? ' spinning' : '';
  const refreshDisabled = state.loadingPlatform ? ' disabled' : '';
  return `<article class="card" aria-label="${esc(platformName + '余额')}">
    <div class="card-head">
      <div class="card-title"><span class="dot ${dotClass}" aria-hidden="true"></span>${esc(platformName)}</div>
      <div class="card-head-right">
        <div class="card-state">${esc(stateText)}</div>
        <button class="card-refresh${refreshSpin}" type="button" data-refresh="${platform}" title="刷新${esc(platformName)}余额" aria-label="刷新${esc(platformName)}余额"${refreshDisabled}>↻</button>
      </div>
    </div>
    <div class="amount-block">${amountHtml}</div>
    <div class="balance-note">${esc(note)}</div>
    <div class="meta">${metaRows.join('')}</div>
    ${breakdown}
    ${alertHtml}
    ${staleHtml}
  </article>`;
}

function renderCards() {
  $('cards').innerHTML = PLATFORMS.map(cardHtml).join('');
}

function renderStatus() {
  const items = PLATFORMS.map((p) => state.items[p]).filter(Boolean);
  const done = items.length === 2;
  const okCount = items.filter((i) => i.ok).length;
  const badCount = items.filter((i) => !i.ok).length;
  let dotClass = 'dot-idle';
  let text = '正在载入配置…';

  if (state.loading) { dotClass = 'dot-loading'; text = '正在查询两个平台…'; }
  else if (done && badCount === 0) {
    dotClass = items.every((i) => i.available !== false) ? 'dot-ok' : 'dot-mixed';
    text = `两个平台均查询成功·${formatTime(state.lastRefreshAt)}`;
  } else if (done && okCount > 0) { dotClass = 'dot-mixed'; text = `${badCount}个平台查询失败，${okCount}个平台正常`; }
  else if (done) { dotClass = 'dot-bad'; text = '两个平台均查询失败，请查看卡片中的错误提示'; }
  else if (state.config) { text = '点击「刷新余额」获取最新余额'; }

  $('globalDot').className = `dot ${dotClass}`;
  $('globalStatus').textContent = text;
}

function renderAll() {
  renderCards();
  renderStatus();
  updateCountdown();
}

// ---------------------------------------------------------------- 自动刷新

function updateCountdown() {
  const seconds = state.config ? Number(state.config.refreshSeconds) : 0;
  $('autoStatus').textContent = `自动刷新：${REFRESH_LABELS[seconds] || `每${seconds}秒`}`;
  if (!seconds || !state.nextAt) { $('countdown').textContent = ''; return; }
  const left = Math.max(0, Math.ceil((state.nextAt - Date.now()) / 1000));
  const mm = String(Math.floor(left / 60)).padStart(2, '0');
  const ss = String(left % 60).padStart(2, '0');
  $('countdown').textContent = `距下次刷新${mm}:${ss}`;
}

function resetAutoTimer() {
  clearTimeout(state.timer);
  const seconds = state.config ? Number(state.config.refreshSeconds) : 0;
  if (!seconds) { state.nextAt = null; updateCountdown(); return; }
  state.nextAt = Date.now() + seconds * 1000;
  state.timer = setTimeout(() => { refreshAll(); }, seconds * 1000);
  updateCountdown();
}

function setLoading(loading) {
  const btn = $('refreshBtn');
  btn.disabled = loading;
  $('refreshLabel').textContent = loading ? '查询中…' : '刷新余额';
  btn.querySelector('.icon-refresh').classList.toggle('spinning', loading);
}

async function refreshAll() {
  if (state.loading) return;
  state.loading = true;
  setLoading(true);
  resetAutoTimer();
  renderAll();
  try {
    const data = await api('/api/balance');
    for (const item of data.items) {
      state.items[item.platform] = item;
      if (item.ok) state.lastGood[item.platform] = item;
    }
    saveCache();
    state.lastRefreshAt = data.serverTime;
  } catch (err) {
    const message = err && err.message ? err.message : '未知错误';
    for (const p of PLATFORMS) {
      state.items[p] = {
        platform: p, ok: false, balance: null, currency: 'CNY', breakdown: [],
        updatedAt: null, source: '', latencyMs: 0,
        error: { code: 'NETWORK', message: '无法连接本地服务', hint: '请确认服务仍在运行，然后重新打开本页面。', detail: message },
      };
    }
    showToast('无法连接本地服务，请确认服务仍在运行');
  } finally {
    state.loading = false;
    setLoading(false);
    renderAll();
  }
}

/** 只刷新单个平台，不影响另一个平台的卡片与整体状态。 */
async function refreshPlatform(platform) {
  if (!PLATFORMS.includes(platform) || state.loadingPlatform || state.loading) return;
  state.loadingPlatform = platform;
  renderAll();
  try {
    const data = await api(`/api/balance?only=${encodeURIComponent(platform)}`);
    const item = (data.items || []).find((i) => i.platform === platform);
    if (item) {
      state.items[platform] = item;
      if (item.ok) state.lastGood[platform] = item;
      saveCache();
      state.lastRefreshAt = data.serverTime;
    }
  } catch (err) {
    const message = err && err.message ? err.message : '未知错误';
    state.items[platform] = {
      platform, ok: false, balance: null, currency: 'CNY', breakdown: [],
      updatedAt: null, source: '', latencyMs: 0,
      error: {
        code: (err && err.code) || 'UNKNOWN',
        message: '查询失败',
        hint: message,
        detail: '',
      },
    };
    showToast('刷新失败：' + message);
  } finally {
    state.loadingPlatform = null;
    renderAll();
  }
}

// ---------------------------------------------------------------- 设置表单

function fillForm(cfg) {
  const hint = (input, configured, masked) => {
    input.value = '';
    input.placeholder = configured ? `已配置（尾号${masked.slice(-4)}），留空表示不修改` : '请输入API密钥';
  };
  hint($('glmKey'), cfg.glm.configured, cfg.glm.masked);
  hint($('dsKey'), cfg.deepseek.configured, cfg.deepseek.masked);
  $('glmCurrency').value = cfg.glm.currency || 'CNY';
  $('glmBaseUrl').value = cfg.glm.baseUrl || '';
  $('glmCustomEndpoint').value = cfg.glm.customEndpoint || '';
  $('dsEndpoint').value = cfg.deepseek.endpoint || '';
  $('refreshSeconds').value = String(cfg.refreshSeconds);

  const lan = cfg.server && cfg.server.lanAddresses && cfg.server.lanAddresses[0];
  $('lanHint').textContent = lan
    ? `手机访问：以HOST=0.0.0.0重新启动服务后，在同一局域网打开http://${lan}:${cfg.server.port}。`
    : '';
}

function togglePanel(open) {
  $('settingsPanel').hidden = !open;
  $('settingsBtn').setAttribute('aria-expanded', String(open));
  if (open && state.config) fillForm(state.config);
}

function collectPayload() {
  const payload = {
    glm: {
      currency: $('glmCurrency').value,
      baseUrl: $('glmBaseUrl').value.trim() || 'https://open.bigmodel.cn',
      customEndpoint: $('glmCustomEndpoint').value.trim(),
    },
    deepseek: {
      endpoint: $('dsEndpoint').value.trim() || 'https://api.deepseek.com/user/balance',
    },
    refreshSeconds: Number($('refreshSeconds').value),
  };
  const glmKey = $('glmKey').value.trim();
  const dsKey = $('dsKey').value.trim();
  if (glmKey) payload.glm.apiKey = glmKey;
  if (dsKey) payload.deepseek.apiKey = dsKey;
  return payload;
}

async function saveConfig() {
  const btn = $('saveBtn');
  btn.disabled = true;
  try {
    const result = await api('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(collectPayload()),
    });
    state.config = result.config;
    fillForm(state.config);
    $('glmKey').value = '';
    $('dsKey').value = '';
    togglePanel(false);
    showToast('设置已保存，正在重新查询余额');
    await refreshAll();
  } catch (err) {
    showToast(`保存失败：${err.message}`);
  } finally {
    btn.disabled = false;
  }
}

async function clearKey(platform) {
  const name = platform === 'glm' ? '智谱GLM' : 'DeepSeek';
  try {
    const result = await api('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [platform]: { apiKey: '' } }),
    });
    state.config = result.config;
    state.items[platform] = {
      platform, ok: false, balance: null, currency: 'CNY', breakdown: [], updatedAt: null,
      source: '', latencyMs: 0,
      error: { code: 'NOT_CONFIGURED', message: '尚未配置API密钥', hint: `请在「设置」中填写${name}的API密钥后刷新。`, detail: '' },
    };
    const keyInput = platform === 'glm' ? $('glmKey') : $('dsKey');
    const part = platform === 'glm' ? state.config.glm : state.config.deepseek;
    keyInput.value = '';
    keyInput.placeholder = part.configured ? `已配置（尾号${part.masked.slice(-4)}），留空表示不修改` : '请输入API密钥';
    renderAll();
    showToast(`${name}的API密钥已清除`);
  } catch (err) {
    showToast(`清除失败：${err.message}`);
  }
}

// ---------------------------------------------------------------- 初始化

function initFloatBar() {
  if (MODE !== 'float') return;
  const bar = $('floatBar');
  if (bar) bar.hidden = false;
  const opacity = $('floatOpacity');
  const topBtn = $('floatTopBtn');
  const refreshBtn = $('floatRefreshBtn');
  const hideBtn = $('floatHideBtn');
  const mainBtn = $('floatMainBtn');
  if (refreshBtn) refreshBtn.addEventListener('click', () => refreshAll());
  if (hideBtn) hideBtn.addEventListener('click', () => { if (window.desktopAPI) window.desktopAPI.hideFloat(); });
  if (mainBtn) mainBtn.addEventListener('click', () => { if (window.desktopAPI) window.desktopAPI.showMain(); });
  if (topBtn) {
    topBtn.addEventListener('click', () => {
      const next = !topBtn.classList.contains('is-active');
      topBtn.classList.toggle('is-active', next);
      if (window.desktopAPI) window.desktopAPI.setAlwaysOnTop(next);
    });
  }
  if (opacity) {
    opacity.addEventListener('input', () => {
      if (window.desktopAPI) window.desktopAPI.setOpacity(Number(opacity.value) / 100);
    });
  }
  if (window.desktopAPI && window.desktopAPI.getFloatState) {
    window.desktopAPI.getFloatState().then((info) => {
      if (opacity) opacity.value = String(Math.round((info.opacity ?? 0.95) * 100));
      if (topBtn) topBtn.classList.toggle('is-active', info.alwaysOnTop !== false);
      if (opacity && info.opacitySupported === false) {
        opacity.disabled = true;
        opacity.title = '当前系统不支持窗口透明度调节';
      }
    });
  }
}

function initDesktopButtons() {
  const btn = $('floatSoloBtn');
  if (!btn) return;
  if (!IS_DESKTOP || !window.desktopAPI || !window.desktopAPI.openSolo) {
    btn.remove();
    return;
  }
  btn.hidden = false;
  btn.addEventListener('click', () => window.desktopAPI.openSolo());
}

function initDesktopHints() {
  if (!IS_DESKTOP || MODE === 'float') return;
  const footer = document.querySelector('.footer');
  if (!footer) return;
  const hint = document.createElement('p');
  hint.textContent = '桌面模式快捷键：CommandOrControl+Shift+B显示或隐藏悬浮窗，CommandOrControl+Shift+W唤起主窗口。';
  footer.appendChild(hint);
  if (window.desktopAPI && window.desktopAPI.getShortcutStatus) {
    window.desktopAPI.getShortcutStatus().then((list) => {
      const failed = (list || []).filter((item) => !item.ok);
      if (!failed.length) return;
      const tip = document.createElement('p');
      tip.textContent = `提示：${failed.map((item) => item.accelerator).join('、')}未注册成功，macOS需在系统设置→隐私与安全性→辅助功能中允许本应用。`;
      footer.appendChild(tip);
    });
  }
}

function bindEvents() {
  $('refreshBtn').addEventListener('click', () => refreshAll());
  $('settingsBtn').addEventListener('click', () => togglePanel($('settingsPanel').hidden));
  $('closeSettingsBtn').addEventListener('click', () => togglePanel(false));
  $('cancelBtn').addEventListener('click', () => togglePanel(false));
  $('saveBtn').addEventListener('click', () => saveConfig());
  document.querySelectorAll('[data-clear]').forEach((btn) => {
    btn.addEventListener('click', () => clearKey(btn.dataset.clear));
  });
  document.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-refresh]');
    if (btn) refreshPlatform(btn.dataset.refresh);
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.nextAt && Date.now() >= state.nextAt && !state.loading) refreshAll();
  });
}

(async function init() {
  bindEvents();
  initFloatBar();
  initDesktopButtons();
  initDesktopHints();
  renderAll();
  setInterval(updateCountdown, 1000);
  try {
    state.config = await api('/api/config');
    fillForm(state.config);
    resetAutoTimer();
    await refreshAll();
  } catch (err) {
    $('globalDot').className = 'dot dot-bad';
    $('globalStatus').textContent = `无法连接本地服务：${err.message}`;
    showToast('无法连接本地服务，请确认服务仍在运行');
  }
})();
