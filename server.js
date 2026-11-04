'use strict';

/**
 * API账户余额看板 · 本地服务
 * 零第三方依赖，仅使用 Node.js 内置模块（需要 Node 18+）。
 * 职责：托管静态页面、持久化本地配置、代理查询两个平台的余额接口。
 * 密钥只保存在本机 data/config.json，不会回传给页面的完整明文。
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { exec } = require('node:child_process');

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
let DATA_DIR = path.join(ROOT, 'data');
let CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const REQUEST_TIMEOUT = 12000;

const DEFAULTS = {
  glm: {
    apiKey: '',
    baseUrl: 'https://open.bigmodel.cn',
    customEndpoint: '',
    currency: 'CNY',
  },
  deepseek: {
    apiKey: '',
    endpoint: 'https://api.deepseek.com/user/balance',
  },
  refreshSeconds: 300,
};

const GLM_ENDPOINTS = [
  { path: '/api/biz/account/query-customer-account-report', name: '控制台账户报表' },
  { path: '/api/paas/v4/users/me/balance', name: '账户余额接口' },
  { path: '/api/coding/paas/v4/users/me/balance', name: '套餐账户余额接口' },
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// ---------------------------------------------------------------- 配置读写

function readConfig() {
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    saved = {};
  }
  return {
    glm: { ...DEFAULTS.glm, ...(saved.glm || {}) },
    deepseek: { ...DEFAULTS.deepseek, ...(saved.deepseek || {}) },
    refreshSeconds: Number.isFinite(saved.refreshSeconds) ? saved.refreshSeconds : DEFAULTS.refreshSeconds,
  };
}

function writeConfig(config) {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
  try { fs.chmodSync(CONFIG_FILE, 0o600); } catch { /* 部分文件系统不支持chmod */ }
}

function maskKey(key) {
  if (!key) return '';
  return `••••${String(key).slice(-4)}`;
}

function isValidUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function publicConfig(config) {
  return {
    glm: {
      configured: Boolean(config.glm.apiKey),
      masked: maskKey(config.glm.apiKey),
      baseUrl: config.glm.baseUrl,
      customEndpoint: config.glm.customEndpoint,
      currency: config.glm.currency,
    },
    deepseek: {
      configured: Boolean(config.deepseek.apiKey),
      masked: maskKey(config.deepseek.apiKey),
      endpoint: config.deepseek.endpoint,
    },
    refreshSeconds: config.refreshSeconds,
    server: { host: HOST, port: PORT, lanAddresses: lanAddresses() },
  };
}

function lanAddresses() {
  const list = [];
  for (const items of Object.values(os.networkInterfaces())) {
    for (const item of items || []) {
      if (item.family === 'IPv4' && !item.internal) list.push(item.address);
    }
  }
  return list;
}

// ---------------------------------------------------------------- 错误模型

class ApiError extends Error {
  constructor(code, detail) {
    super(code);
    this.code = code;
    this.detail = detail || '';
  }
}

const ERROR_TEXT = {
  NOT_CONFIGURED: ['尚未配置API密钥', '请在「设置」中填写对应平台的API密钥后刷新。'],
  INVALID_KEY: ['API密钥无效或已过期', '请检查密钥是否填写完整、是否已被删除，以及密钥所属站点是否与接口地址匹配。'],
  INSUFFICIENT: ['账户余额不足', '平台拒绝继续提供服务，请充值后再试。'],
  RATE_LIMITED: ['请求过于频繁', '平台已限流，请稍后重试或在设置中增大自动刷新间隔。'],
  SERVER_ERROR: ['平台服务暂时不可用', '平台接口返回服务端错误，稍后会自动重试。'],
  ENDPOINT: ['接口地址不存在或已变更', '可在「设置」中填写自定义余额接口地址。'],
  TIMEOUT: ['请求超时', '网络或平台响应过慢，请检查网络与代理设置，或稍后手动刷新。'],
  NETWORK: ['网络连接失败', '无法连接到平台接口，请检查网络、代理或防火墙设置。'],
  PARSE: ['接口响应格式无法识别', '平台接口可能已变更，可在「设置」中填写自定义余额接口地址。'],
  NO_BALANCE: ['接口未返回余额数据', '该密钥类型可能不支持余额查询，请确认密钥权限或改用控制台查看。'],
  CONFIG: ['配置保存失败', '请检查填写的接口地址是否为完整的http或https地址。'],
  UNKNOWN: ['查询失败', '请查看下方详细信息，或稍后重试。'],
};

function errorPayload(err) {
  const code = err instanceof ApiError ? err.code : 'UNKNOWN';
  const [message, hint] = ERROR_TEXT[code] || ERROR_TEXT.UNKNOWN;
  const detail = err instanceof ApiError ? err.detail : (err && err.message ? String(err.message) : '');
  return {
    code,
    message,
    hint,
    detail: detail ? String(detail).slice(0, 300) : '',
  };
}

function httpError(status, raw) {
  if (status === 401 || status === 403) return new ApiError('INVALID_KEY', `HTTP ${status}`);
  if (status === 402) return new ApiError('INSUFFICIENT', `HTTP ${status}`);
  if (status === 404) return new ApiError('ENDPOINT', `HTTP ${status}`);
  if (status === 429) return new ApiError('RATE_LIMITED', `HTTP ${status}`);
  if (status >= 500) return new ApiError('SERVER_ERROR', `HTTP ${status}`);
  const snippet = (raw || '').replace(/\s+/g, ' ').slice(0, 180);
  return new ApiError('UNKNOWN', `HTTP ${status}${snippet ? `：${snippet}` : ''}`);
}

// ---------------------------------------------------------------- HTTP工具

async function requestJson(url, headers, timeout = REQUEST_TIMEOUT) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': 'balance-dashboard/1.0', ...headers },
      signal: controller.signal,
      redirect: 'follow',
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    return { status: response.status, ok: response.ok, data, raw: text.slice(0, 2000) };
  } catch (err) {
    if (err && (err.name === 'AbortError' || /timeout|aborted/i.test(err.message || ''))) {
      throw new ApiError('TIMEOUT', `等待超过${Math.round(timeout / 1000)}秒`);
    }
    throw new ApiError('NETWORK', err && err.message ? err.message : '未知网络错误');
  } finally {
    clearTimeout(timer);
  }
}

function numericValue(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean' || typeof value === 'object') return null;
  const n = Number(value);
  return Number.isFinite(n) ? String(value) : null;
}

function pickValue(obj, paths) {
  for (const getter of paths) {
    let value;
    try { value = getter(obj); } catch { value = undefined; }
    const found = numericValue(value);
    if (found !== null) return found;
  }
  return null;
}

// ---------------------------------------------------------------- 智谱GLM

/** 新版智谱密钥形如 id.secret，官方调用方式要求用secret签发JWT。 */
function zhipuJwt(apiKey) {
  const dot = apiKey.indexOf('.');
  if (dot < 0) return null;
  const id = apiKey.slice(0, dot);
  const secret = apiKey.slice(dot + 1);
  if (!id || !secret) return null;
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const now = Date.now();
  const head = b64({ alg: 'HS256', sign_type: 'SIGN' });
  const body = b64({ api_key: id, exp: now + 3600 * 1000, timestamp: now });
  const unsigned = `${head}.${body}`;
  const signature = crypto.createHmac('sha256', secret).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}

function zhipuAuthModes(apiKey) {
  const modes = [{ mode: 'raw', header: `Bearer ${apiKey}` }];
  const jwt = zhipuJwt(apiKey);
  if (jwt) modes.push({ mode: 'jwt', header: `Bearer ${jwt}` });
  return modes;
}

function zhipuBusinessError(data) {
  if (!data || typeof data !== 'object') return null;
  const code = data.code ?? data.errCode ?? data.error?.code;
  const msg = data.msg ?? data.message ?? data.error?.message ?? '';
  if (code === undefined || code === null) return null;
  if (Number(code) === 200 || Number(code) === 0) return null;
  const text = `${code} ${msg}`;
  if (/(1000|1001|1002|401|403|身份|认证|鉴权|api.?key|token)/i.test(text)) {
    return new ApiError('INVALID_KEY', `${code}${msg ? `：${msg}` : ''}`);
  }
  return new ApiError('UNKNOWN', `${code}${msg ? `：${msg}` : ''}`);
}

function parseGlim(data, fallbackCurrency) {
  if (!data || typeof data !== 'object') return null;
  const business = zhipuBusinessError(data);
  if (business) throw business;

  const balance = pickValue(data, [
    (o) => o?.data?.balance,
    (o) => o?.data?.balanceInfo?.balance,
    (o) => o?.balanceInfo?.balance,
    (o) => o?.balance,
    (o) => o?.data?.cashBalance,
    (o) => o?.data?.remainBalance,
    (o) => o?.data?.availableBalance,
    (o) => o?.total_balance,
    (o) => o?.data?.totalBalance,
  ]);
  if (balance === null) return null;

  const root = data.data && typeof data.data === 'object' ? data.data : {};
  const info = data.balanceInfo || root.balanceInfo || {};
  const breakdown = [];
  const add = (label, value) => {
    const v = numericValue(value);
    if (v !== null) breakdown.push({ label, value: v });
  };
  add('充值余额', root.rechargeAmount);
  add('赠金余额', root.giveAmount ?? info.giftBalance);
  add('代金券余额', info.voucherBalance);
  add('累计消费', root.totalSpendAmount);
  if (Array.isArray(data.packageInfo) && data.packageInfo.length) {
    for (const pack of data.packageInfo.slice(0, 3)) {
      add(`资源包·${pack.packageName || '未命名'}`, pack.remainingPoints);
    }
  }

  const currencyRaw = data.currency || root.currency || '';
  const currency = /^(CNY|USD)$/i.test(currencyRaw) ? currencyRaw.toUpperCase() : (fallbackCurrency || 'CNY');
  return { balance, currency, breakdown, available: Number(balance) > 0 };
}

async function queryGlim(cfg) {
  if (!cfg.apiKey) throw new ApiError('NOT_CONFIGURED');
  const base = String(cfg.baseUrl || DEFAULTS.glm.baseUrl).replace(/\/+$/, '');
  const endpoints = cfg.customEndpoint
    ? [{ url: cfg.customEndpoint, name: '自定义接口' }]
    : GLM_ENDPOINTS.map((e) => ({ url: base + e.path, name: e.name }));
  const authModes = zhipuAuthModes(cfg.apiKey);
  const errors = [];

  for (const endpoint of endpoints) {
    for (const auth of authModes) {
      try {
        const response = await requestJson(endpoint.url, { Authorization: auth.header });
        if (!response.ok) throw httpError(response.status, response.raw);
        const parsed = parseGlim(response.data, cfg.currency);
        if (!parsed) throw new ApiError('PARSE', response.raw.slice(0, 220));
        return {
          ...parsed,
          source: endpoint.name + (auth.mode === 'jwt' ? '·JWT鉴权' : ''),
        };
      } catch (err) {
        errors.push(err);
        // 裸密钥被拒绝且密钥形如id.secret时，再用JWT试同一个端点。
        if (err.code === 'INVALID_KEY' && auth.mode === 'raw' && authModes.length > 1) continue;
        break;
      }
    }
  }

  // 优先返回信息量最大的错误：无效密钥 > 其他明确错误 > 第一个错误。
  throw errors.find((e) => e.code === 'INVALID_KEY')
    || errors.find((e) => e.code !== 'ENDPOINT')
    || errors[0]
    || new ApiError('UNKNOWN');
}

// ---------------------------------------------------------------- DeepSeek

function parseDeepSeek(data) {
  const infos = data && Array.isArray(data.balance_infos) ? data.balance_infos : null;
  if (!infos || !infos.length) {
    if (data && typeof data === 'object' && (data.error || data.message)) {
      throw new ApiError('UNKNOWN', JSON.stringify(data.error || data.message).slice(0, 200));
    }
    throw new ApiError('NO_BALANCE');
  }
  const primary = infos[0] || {};
  const balance = numericValue(primary.total_balance);
  if (balance === null) throw new ApiError('PARSE', 'total_balance字段缺失或格式异常');
  const currency = /^(CNY|USD)$/i.test(primary.currency || '') ? primary.currency.toUpperCase() : 'CNY';

  const breakdown = [];
  for (const info of infos) {
    const labelPrefix = infos.length > 1 ? `${info.currency || currency}·` : '';
    for (const [label, key] of [['赠金余额', 'granted_balance'], ['充值余额', 'topped_up_balance']]) {
      const value = numericValue(info[key]);
      if (value !== null) breakdown.push({ label: labelPrefix + label, value });
    }
    if (infos.length > 1) {
      const total = numericValue(info.total_balance);
      if (total !== null) breakdown.push({ label: `${info.currency || currency}·总余额`, value: total });
    }
  }
  return {
    balance,
    currency,
    breakdown,
    available: data.is_available !== false,
    source: '官方余额接口',
  };
}

async function queryDeepSeek(cfg) {
  if (!cfg.apiKey) throw new ApiError('NOT_CONFIGURED');
  const url = cfg.endpoint || DEFAULTS.deepseek.endpoint;
  const response = await requestJson(url, { Authorization: `Bearer ${cfg.apiKey}` });
  if (!response.ok) throw httpError(response.status, response.raw);
  return parseDeepSeek(response.data);
}

// ---------------------------------------------------------------- 余额汇总

const PLATFORM_NAMES = { glm: '智谱GLM', deepseek: 'DeepSeek' };

async function buildItem(platform, cfg, queryFn, fallbackCurrency) {
  const started = Date.now();
  try {
    const result = await queryFn(cfg);
    return {
      platform,
      name: PLATFORM_NAMES[platform],
      ok: true,
      balance: result.balance,
      currency: result.currency || fallbackCurrency,
      available: result.available,
      breakdown: result.breakdown || [],
      source: result.source || '',
      updatedAt: new Date().toISOString(),
      latencyMs: Date.now() - started,
      error: null,
    };
  } catch (err) {
    return {
      platform,
      name: PLATFORM_NAMES[platform],
      ok: false,
      balance: null,
      currency: fallbackCurrency,
      available: null,
      breakdown: [],
      source: '',
      updatedAt: null,
      latencyMs: Date.now() - started,
      error: errorPayload(err),
    };
  }
}

async function getBalances(config, only) {
  const jobs = [];
  if (!only || only === 'glm') jobs.push(buildItem('glm', config.glm, queryGlim, config.glm.currency || 'CNY'));
  if (!only || only === 'deepseek') jobs.push(buildItem('deepseek', config.deepseek, queryDeepSeek, 'CNY'));
  const items = await Promise.all(jobs);
  return { serverTime: new Date().toISOString(), items };
}

// ---------------------------------------------------------------- HTTP服务

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 64 * 1024) {
        reject(new Error('请求体过大'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('请求体不是合法JSON')); }
    });
    req.on('error', reject);
  });
}

function serveStatic(res, pathname) {
  const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const filePath = path.resolve(PUBLIC_DIR, relative);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== path.join(PUBLIC_DIR, 'index.html')) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('页面不存在');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(content);
  });
}

function applyConfigPatch(config, patch) {
  const next = JSON.parse(JSON.stringify(config));
  const setKey = (target, value) => {
    if (value === undefined) return; // 留空表示不修改
    target.apiKey = String(value).trim();
  };

  if (patch.glm && typeof patch.glm === 'object') {
    setKey(next.glm, patch.glm.apiKey);
    if (patch.glm.currency !== undefined) {
      const c = String(patch.glm.currency).toUpperCase();
      if (!['CNY', 'USD'].includes(c)) throw new ApiError('CONFIG', '币种只支持CNY或USD');
      next.glm.currency = c;
    }
    if (patch.glm.baseUrl !== undefined) {
      const text = String(patch.glm.baseUrl).trim();
      if (!isValidUrl(text)) throw new ApiError('CONFIG', '智谱接口基础地址不是合法的http或https地址');
      next.glm.baseUrl = text.replace(/\/+$/, '');
    }
    if (patch.glm.customEndpoint !== undefined) {
      const text = String(patch.glm.customEndpoint).trim();
      if (text && !isValidUrl(text)) throw new ApiError('CONFIG', '智谱自定义接口地址不是合法的http或https地址');
      next.glm.customEndpoint = text;
    }
  }
  if (patch.deepseek && typeof patch.deepseek === 'object') {
    setKey(next.deepseek, patch.deepseek.apiKey);
    if (patch.deepseek.endpoint !== undefined) {
      const text = String(patch.deepseek.endpoint).trim();
      if (!isValidUrl(text)) throw new ApiError('CONFIG', 'DeepSeek接口地址不是合法的http或https地址');
      next.deepseek.endpoint = text;
    }
  }
  if (patch.refreshSeconds !== undefined) {
    const seconds = Number(patch.refreshSeconds);
    if (!Number.isInteger(seconds) || seconds < 0 || (seconds > 0 && seconds < 30) || seconds > 86400) {
      throw new ApiError('CONFIG', '自动刷新间隔需为0（关闭）或30~86400之间的整数秒');
    }
    next.refreshSeconds = seconds;
  }
  return next;
}

function createRequestHandler() {
  return async (req, res) => {
  let url;
  try { url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); }
  catch { sendJson(res, 400, { error: '请求地址不合法' }); return; }
  const pathname = url.pathname;

  try {
    if (pathname === '/api/config' && req.method === 'GET') {
      sendJson(res, 200, publicConfig(readConfig()));
      return;
    }
    if (pathname === '/api/config' && req.method === 'POST') {
      const patch = await readBody(req);
      const next = applyConfigPatch(readConfig(), patch);
      writeConfig(next);
      sendJson(res, 200, { ok: true, config: publicConfig(next) });
      return;
    }
    if (pathname === '/api/balance' && req.method === 'GET') {
      const only = ['glm', 'deepseek'].includes(url.searchParams.get('only')) ? url.searchParams.get('only') : null;
      sendJson(res, 200, await getBalances(readConfig(), only));
      return;
    }
    if (pathname.startsWith('/api/')) {
      sendJson(res, 404, { error: '接口不存在' });
      return;
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      serveStatic(res, pathname);
      return;
    }
    sendJson(res, 405, { error: '不支持的请求方法' });
  } catch (err) {
    const payload = errorPayload(err);
    sendJson(res, err instanceof ApiError && err.code === 'CONFIG' ? 400 : 500, { ok: false, error: payload });
  }
  };
}

function startServer(options = {}) {
  const port = Number(options.port || PORT);
  const host = options.host || HOST;
  const open = options.open !== false;
  if (options.dataDir) {
    DATA_DIR = options.dataDir;
    CONFIG_FILE = path.join(DATA_DIR, 'config.json');
  }
  const server = http.createServer(createRequestHandler());
  return new Promise((resolve, reject) => {
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        const conflict = new Error(`端口${port}已被占用`);
        conflict.code = 'PORT_IN_USE';
        reject(conflict);
      } else {
        reject(err);
      }
    });
    server.listen(port, host, () => {
      const address = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`;
      console.log('');
      console.log('  API账户余额看板已启动');
      console.log(`  本机访问：${address}`);
      if (host === '0.0.0.0') {
        for (const ip of lanAddresses()) console.log(`  局域网访问：http://${ip}:${port}`);
        console.log('  提示：仅建议在可信局域网内使用，密钥保存在本机，但页面可被同网设备访问。');
      }
      console.log('  按Ctrl+C停止服务');
      console.log('');
      if (open && process.platform === 'darwin' && host === '127.0.0.1' && process.env.NO_OPEN !== '1') {
        exec(`open "${address}"`, () => {});
      }
      resolve({ server, address, port, host });
    });
  });
}

if (require.main === module) {
  startServer().catch((err) => {
    if (err.code === 'PORT_IN_USE') {
      console.error(`${err.message}。可用 PORT=8788 node server.js 指定其他端口。`);
    } else {
      console.error('服务启动失败：', err.message);
    }
    process.exit(1);
  });
}

module.exports = { startServer };
