#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""API账户余额看板 · 本地服务（Python标准库版）

与server.js功能等价，仅使用Python标准库，无需安装Node.js或任何第三方包。
适用于macOS自带的Python 3（需3.7及以上）。
密钥只保存在本机data/config.json，页面只接收脱敏信息。
"""

import base64
import concurrent.futures
import errno
import hashlib
import hmac
import json
import math
import os
import re
import socket
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

ROOT = Path(__file__).resolve().parent
PUBLIC_DIR = ROOT / "public"
DATA_DIR = ROOT / "data"
CONFIG_FILE = DATA_DIR / "config.json"
PORT = int(os.environ.get("PORT", "8787"))
HOST = os.environ.get("HOST", "127.0.0.1")
NO_OPEN = os.environ.get("NO_OPEN") == "1"
REQUEST_TIMEOUT = 12

DEFAULTS = {
    "glm": {
        "apiKey": "",
        "baseUrl": "https://open.bigmodel.cn",
        "customEndpoint": "",
        "currency": "CNY",
    },
    "deepseek": {
        "apiKey": "",
        "endpoint": "https://api.deepseek.com/user/balance",
    },
    "refreshSeconds": 300,
}

GLM_ENDPOINTS = [
    ("/api/biz/account/query-customer-account-report", "控制台账户报表"),
    ("/api/paas/v4/users/me/balance", "账户余额接口"),
    ("/api/coding/paas/v4/users/me/balance", "套餐账户余额接口"),
]

MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
}

ERROR_TEXT = {
    "NOT_CONFIGURED": ("尚未配置API密钥", "请在「设置」中填写对应平台的API密钥后刷新。"),
    "INVALID_KEY": ("API密钥无效或已过期", "请检查密钥是否填写完整、是否已被删除，以及密钥所属站点是否与接口地址匹配。"),
    "INSUFFICIENT": ("账户余额不足", "平台拒绝继续提供服务，请充值后再试。"),
    "RATE_LIMITED": ("请求过于频繁", "平台已限流，请稍后重试或在设置中增大自动刷新间隔。"),
    "SERVER_ERROR": ("平台服务暂时不可用", "平台接口返回服务端错误，稍后会自动重试。"),
    "ENDPOINT": ("接口地址不存在或已变更", "可在「设置」中填写自定义余额接口地址。"),
    "TIMEOUT": ("请求超时", "网络或平台响应过慢，请检查网络与代理设置，或稍后手动刷新。"),
    "NETWORK": ("网络连接失败", "无法连接到平台接口，请检查网络、代理或防火墙设置。"),
    "PARSE": ("接口响应格式无法识别", "平台接口可能已变更，可在「设置」中填写自定义余额接口地址。"),
    "NO_BALANCE": ("接口未返回余额数据", "该密钥类型可能不支持余额查询，请确认密钥权限或改用控制台查看。"),
    "CONFIG": ("配置保存失败", "请检查填写的接口地址是否为完整的http或https地址。"),
    "UNKNOWN": ("查询失败", "请查看下方详细信息，或稍后重试。"),
}

PLATFORM_NAMES = {"glm": "智谱GLM", "deepseek": "DeepSeek"}


class ApiError(Exception):
    def __init__(self, code, detail=""):
        super().__init__(code)
        self.code = code
        self.detail = detail or ""


# ---------------------------------------------------------------- 配置

def read_config():
    saved = {}
    try:
        saved = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
    except Exception:
        saved = {}
    glm = dict(DEFAULTS["glm"])
    glm.update(saved.get("glm") or {})
    deepseek = dict(DEFAULTS["deepseek"])
    deepseek.update(saved.get("deepseek") or {})
    seconds = saved.get("refreshSeconds", DEFAULTS["refreshSeconds"])
    if not isinstance(seconds, (int, float)):
        seconds = DEFAULTS["refreshSeconds"]
    return {"glm": glm, "deepseek": deepseek, "refreshSeconds": seconds}


def write_config(config):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(DATA_DIR, 0o700)
    except OSError:
        pass
    CONFIG_FILE.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")
    try:
        os.chmod(CONFIG_FILE, 0o600)
    except OSError:
        pass


def mask_key(key):
    return "••••" + str(key)[-4:] if key else ""


def is_valid_url(value):
    try:
        u = urlparse(value)
        return u.scheme in ("http", "https") and bool(u.netloc)
    except Exception:
        return False


def lan_addresses():
    try:
        ips = socket.gethostbyname_ex(socket.gethostname())[2]
    except Exception:
        ips = []
    return [ip for ip in ips if not ip.startswith("127.")]


def public_config(config):
    return {
        "glm": {
            "configured": bool(config["glm"]["apiKey"]),
            "masked": mask_key(config["glm"]["apiKey"]),
            "baseUrl": config["glm"]["baseUrl"],
            "customEndpoint": config["glm"]["customEndpoint"],
            "currency": config["glm"]["currency"],
        },
        "deepseek": {
            "configured": bool(config["deepseek"]["apiKey"]),
            "masked": mask_key(config["deepseek"]["apiKey"]),
            "endpoint": config["deepseek"]["endpoint"],
        },
        "refreshSeconds": config["refreshSeconds"],
        "server": {"host": HOST, "port": PORT, "lanAddresses": lan_addresses()},
    }


# ---------------------------------------------------------------- 错误

def error_payload(err):
    code = err.code if isinstance(err, ApiError) else "UNKNOWN"
    message, hint = ERROR_TEXT.get(code, ERROR_TEXT["UNKNOWN"])
    detail = err.detail if isinstance(err, ApiError) else str(err)
    return {"code": code, "message": message, "hint": hint, "detail": str(detail)[:300]}


def http_error(status, raw):
    if status in (401, 403):
        return ApiError("INVALID_KEY", f"HTTP {status}")
    if status == 402:
        return ApiError("INSUFFICIENT", f"HTTP {status}")
    if status == 404:
        return ApiError("ENDPOINT", f"HTTP {status}")
    if status == 429:
        return ApiError("RATE_LIMITED", f"HTTP {status}")
    if status >= 500:
        return ApiError("SERVER_ERROR", f"HTTP {status}")
    snippet = re.sub(r"\s+", " ", raw or "")[:180]
    return ApiError("UNKNOWN", f"HTTP {status}{'：' + snippet if snippet else ''}")


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


# ---------------------------------------------------------------- HTTP工具

def request_json(url, headers=None, timeout=REQUEST_TIMEOUT):
    merged = {"Accept": "application/json", "User-Agent": "balance-dashboard/1.0-python"}
    merged.update(headers or {})
    req = urllib.request.Request(url, method="GET", headers=merged)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            status, raw = resp.status, resp.read().decode("utf-8", "replace")
            ok = 200 <= status < 300
    except urllib.error.HTTPError as exc:
        status = exc.code
        raw = exc.read().decode("utf-8", "replace")
        ok = False
    except (socket.timeout, TimeoutError):
        raise ApiError("TIMEOUT", f"等待超过{timeout}秒")
    except urllib.error.URLError as exc:
        reason = str(getattr(exc, "reason", exc))
        if "timed out" in reason.lower() or "timeout" in reason.lower():
            raise ApiError("TIMEOUT", f"等待超过{timeout}秒")
        raise ApiError("NETWORK", reason)
    except Exception as exc:
        raise ApiError("NETWORK", str(exc))
    try:
        data = json.loads(raw) if raw else None
    except Exception:
        data = None
    return {"status": status, "ok": ok, "data": data, "raw": raw[:2000]}


def numeric_value(value):
    if value is None or value == "" or isinstance(value, (bool, dict, list)):
        return None
    try:
        num = float(value)
    except (ValueError, TypeError):
        return None
    if not math.isfinite(num):
        return None
    return str(value)


def pick_value(obj, getters):
    for getter in getters:
        try:
            found = numeric_value(getter(obj))
        except Exception:
            found = None
        if found is not None:
            return found
    return None


# ---------------------------------------------------------------- 智谱GLM

def _b64url(obj):
    raw = json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def zhipu_jwt(api_key):
    dot = api_key.find(".")
    if dot < 0:
        return None
    key_id, secret = api_key[:dot], api_key[dot + 1:]
    if not key_id or not secret:
        return None
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    head = _b64url({"alg": "HS256", "sign_type": "SIGN"})
    body = _b64url({"api_key": key_id, "exp": now_ms + 3600 * 1000, "timestamp": now_ms})
    unsigned = f"{head}.{body}"
    signature = base64.urlsafe_b64encode(
        hmac.new(secret.encode("utf-8"), unsigned.encode("ascii"), hashlib.sha256).digest()
    ).rstrip(b"=").decode("ascii")
    return f"{unsigned}.{signature}"


def zhipu_auth_modes(api_key):
    modes = [("raw", f"Bearer {api_key}")]
    jwt = zhipu_jwt(api_key)
    if jwt:
        modes.append(("jwt", f"Bearer {jwt}"))
    return modes


def zhipu_business_error(data):
    if not isinstance(data, dict):
        return None
    error_obj = data.get("error") if isinstance(data.get("error"), dict) else {}
    code = data.get("code", data.get("errCode", error_obj.get("code")))
    msg = data.get("msg") or data.get("message") or error_obj.get("message") or ""
    if code is None:
        return None
    try:
        numeric = int(code)
    except (ValueError, TypeError):
        numeric = None
    if numeric in (200, 0):
        return None
    text = f"{code} {msg}"
    suffix = f"：{msg}" if msg else ""
    if re.search(r"(1000|1001|1002|401|403|身份|认证|鉴权|api.?key|token)", text, re.I):
        return ApiError("INVALID_KEY", f"{code}{suffix}")
    return ApiError("UNKNOWN", f"{code}{suffix}")


def parse_glm(data, fallback_currency):
    if not isinstance(data, dict):
        return None
    business = zhipu_business_error(data)
    if business:
        raise business
    balance = pick_value(data, [
        lambda o: o.get("data", {}).get("balance") if isinstance(o.get("data"), dict) else None,
        lambda o: o.get("data", {}).get("balanceInfo", {}).get("balance") if isinstance(o.get("data"), dict) and isinstance(o["data"].get("balanceInfo"), dict) else None,
        lambda o: o.get("balanceInfo", {}).get("balance") if isinstance(o.get("balanceInfo"), dict) else None,
        lambda o: o.get("balance"),
        lambda o: o.get("data", {}).get("cashBalance") if isinstance(o.get("data"), dict) else None,
        lambda o: o.get("data", {}).get("remainBalance") if isinstance(o.get("data"), dict) else None,
        lambda o: o.get("data", {}).get("availableBalance") if isinstance(o.get("data"), dict) else None,
        lambda o: o.get("total_balance"),
        lambda o: o.get("data", {}).get("totalBalance") if isinstance(o.get("data"), dict) else None,
    ])
    if balance is None:
        return None
    root = data.get("data") if isinstance(data.get("data"), dict) else {}
    info = data.get("balanceInfo") if isinstance(data.get("balanceInfo"), dict) else root.get("balanceInfo", {})
    if not isinstance(info, dict):
        info = {}
    breakdown = []

    def add(label, value):
        found = numeric_value(value)
        if found is not None:
            breakdown.append({"label": label, "value": found})

    add("充值余额", root.get("rechargeAmount"))
    add("赠金余额", root.get("giveAmount", info.get("giftBalance")))
    add("代金券余额", info.get("voucherBalance"))
    add("累计消费", root.get("totalSpendAmount"))
    packages = data.get("packageInfo")
    if isinstance(packages, list):
        for pack in packages[:3]:
            if isinstance(pack, dict):
                add(f"资源包·{pack.get('packageName') or '未命名'}", pack.get("remainingPoints"))
    currency_raw = data.get("currency") or root.get("currency") or ""
    currency = currency_raw.upper() if str(currency_raw).upper() in ("CNY", "USD") else (fallback_currency or "CNY")
    return {"balance": balance, "currency": currency, "breakdown": breakdown, "available": float(balance) > 0}


def query_glm(cfg):
    if not cfg.get("apiKey"):
        raise ApiError("NOT_CONFIGURED")
    base = str(cfg.get("baseUrl") or DEFAULTS["glm"]["baseUrl"]).rstrip("/")
    endpoints = ([{"url": cfg["customEndpoint"], "name": "自定义接口"}]
                 if cfg.get("customEndpoint")
                 else [{"url": base + path, "name": name} for path, name in GLM_ENDPOINTS])
    auth_modes = zhipu_auth_modes(cfg["apiKey"])
    errors = []
    for endpoint in endpoints:
        for mode, header in auth_modes:
            try:
                response = request_json(endpoint["url"], {"Authorization": header})
                if not response["ok"]:
                    raise http_error(response["status"], response["raw"])
                parsed = parse_glm(response["data"], cfg.get("currency"))
                if not parsed:
                    raise ApiError("PARSE", response["raw"][:220])
                parsed["source"] = endpoint["name"] + ("·JWT鉴权" if mode == "jwt" else "")
                return parsed
            except ApiError as err:
                errors.append(err)
                if err.code == "INVALID_KEY" and mode == "raw" and len(auth_modes) > 1:
                    continue
                break
    raise (next((e for e in errors if e.code == "INVALID_KEY"), None)
           or next((e for e in errors if e.code != "ENDPOINT"), None)
           or (errors[0] if errors else ApiError("UNKNOWN")))


# ---------------------------------------------------------------- DeepSeek

def parse_deepseek(data):
    infos = data.get("balance_infos") if isinstance(data, dict) else None
    if not isinstance(infos, list) or not infos:
        if isinstance(data, dict) and (data.get("error") or data.get("message")):
            raise ApiError("UNKNOWN", json.dumps(data.get("error") or data.get("message"), ensure_ascii=False)[:200])
        raise ApiError("NO_BALANCE")
    primary = infos[0] if isinstance(infos[0], dict) else {}
    balance = numeric_value(primary.get("total_balance"))
    if balance is None:
        raise ApiError("PARSE", "total_balance字段缺失或格式异常")
    currency = str(primary.get("currency") or "").upper()
    currency = currency if currency in ("CNY", "USD") else "CNY"
    breakdown = []
    for info in infos:
        if not isinstance(info, dict):
            continue
        label_prefix = f"{info.get('currency') or currency}·" if len(infos) > 1 else ""
        for label, key in (("赠金余额", "granted_balance"), ("充值余额", "topped_up_balance")):
            value = numeric_value(info.get(key))
            if value is not None:
                breakdown.append({"label": label_prefix + label, "value": value})
        if len(infos) > 1:
            total = numeric_value(info.get("total_balance"))
            if total is not None:
                breakdown.append({"label": f"{info.get('currency') or currency}·总余额", "value": total})
    return {
        "balance": balance,
        "currency": currency,
        "breakdown": breakdown,
        "available": data.get("is_available") is not False,
        "source": "官方余额接口",
    }


def query_deepseek(cfg):
    if not cfg.get("apiKey"):
        raise ApiError("NOT_CONFIGURED")
    url = cfg.get("endpoint") or DEFAULTS["deepseek"]["endpoint"]
    response = request_json(url, {"Authorization": f"Bearer {cfg['apiKey']}"})
    if not response["ok"]:
        raise http_error(response["status"], response["raw"])
    return parse_deepseek(response["data"])


# ---------------------------------------------------------------- 汇总

def build_item(platform, cfg, query_fn, fallback_currency):
    started = datetime.now(timezone.utc).timestamp()
    common = {
        "platform": platform,
        "name": PLATFORM_NAMES[platform],
        "currency": fallback_currency,
        "breakdown": [],
        "source": "",
        "latencyMs": 0,
    }
    try:
        result = query_fn(cfg)
        return {
            **common,
            "ok": True,
            "balance": result["balance"],
            "currency": result.get("currency") or fallback_currency,
            "available": result.get("available"),
            "breakdown": result.get("breakdown") or [],
            "source": result.get("source") or "",
            "updatedAt": now_iso(),
            "latencyMs": int((datetime.now(timezone.utc).timestamp() - started) * 1000),
            "error": None,
        }
    except Exception as err:
        return {
            **common,
            "ok": False,
            "balance": None,
            "available": None,
            "updatedAt": None,
            "latencyMs": int((datetime.now(timezone.utc).timestamp() - started) * 1000),
            "error": error_payload(err),
        }


def get_balances(config, only=None):
    jobs = []
    if only in (None, "glm"):
        jobs.append(("glm", config["glm"], query_glm, config["glm"].get("currency") or "CNY"))
    if only in (None, "deepseek"):
        jobs.append(("deepseek", config["deepseek"], query_deepseek, "CNY"))
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, len(jobs))) as pool:
        futures = [pool.submit(build_item, *job) for job in jobs]
        items = [future.result() for future in futures]
    return {"serverTime": now_iso(), "items": items}


# ---------------------------------------------------------------- 配置更新

def apply_config_patch(config, patch):
    nxt = json.loads(json.dumps(config, ensure_ascii=False))

    def set_key(target, value):
        if value is not None:
            target["apiKey"] = str(value).strip()

    if isinstance(patch.get("glm"), dict):
        glm_patch = patch["glm"]
        set_key(nxt["glm"], glm_patch.get("apiKey"))
        if "currency" in glm_patch:
            currency = str(glm_patch["currency"]).upper()
            if currency not in ("CNY", "USD"):
                raise ApiError("CONFIG", "币种只支持CNY或USD")
            nxt["glm"]["currency"] = currency
        if "baseUrl" in glm_patch:
            text = str(glm_patch["baseUrl"]).strip()
            if not is_valid_url(text):
                raise ApiError("CONFIG", "智谱接口基础地址不是合法的http或https地址")
            nxt["glm"]["baseUrl"] = text.rstrip("/")
        if "customEndpoint" in glm_patch:
            text = str(glm_patch["customEndpoint"]).strip()
            if text and not is_valid_url(text):
                raise ApiError("CONFIG", "智谱自定义接口地址不是合法的http或https地址")
            nxt["glm"]["customEndpoint"] = text
    if isinstance(patch.get("deepseek"), dict):
        ds_patch = patch["deepseek"]
        set_key(nxt["deepseek"], ds_patch.get("apiKey"))
        if "endpoint" in ds_patch:
            text = str(ds_patch["endpoint"]).strip()
            if not is_valid_url(text):
                raise ApiError("CONFIG", "DeepSeek接口地址不是合法的http或https地址")
            nxt["deepseek"]["endpoint"] = text
    if "refreshSeconds" in patch:
        try:
            seconds = int(patch["refreshSeconds"])
        except (ValueError, TypeError):
            raise ApiError("CONFIG", "自动刷新间隔需为0（关闭）或30~86400之间的整数秒")
        if seconds < 0 or (0 < seconds < 30) or seconds > 86400:
            raise ApiError("CONFIG", "自动刷新间隔需为0（关闭）或30~86400之间的整数秒")
        nxt["refreshSeconds"] = seconds
    return nxt


# ---------------------------------------------------------------- HTTP服务

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def _send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length > 65536:
            raise ValueError("请求体过大")
        raw = self.rfile.read(length).decode("utf-8") if length else ""
        return json.loads(raw) if raw else {}

    def _serve_static(self, pathname):
        rel = unquote(pathname.lstrip("/")) or "index.html"
        target = (PUBLIC_DIR / rel).resolve()
        public_root = str(PUBLIC_DIR.resolve()) + os.sep
        if not str(target).startswith(public_root):
            self.send_error(403, "Forbidden")
            return
        try:
            data = target.read_bytes()
        except OSError:
            self.send_response(404)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", MIME.get(target.suffix.lower(), "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def _dispatch(self):
        parsed = urlparse(self.path)
        pathname = parsed.path
        try:
            if pathname == "/api/config" and self.command == "GET":
                self._send_json(200, public_config(read_config()))
                return
            if pathname == "/api/config" and self.command == "POST":
                nxt = apply_config_patch(read_config(), self._read_body())
                write_config(nxt)
                self._send_json(200, {"ok": True, "config": public_config(nxt)})
                return
            if pathname == "/api/balance" and self.command == "GET":
                only = parse_qs(parsed.query).get("only", [None])[0]
                if only not in ("glm", "deepseek"):
                    only = None
                self._send_json(200, get_balances(read_config(), only))
                return
            if pathname.startswith("/api/"):
                self._send_json(404, {"error": "接口不存在"})
                return
            if self.command in ("GET", "HEAD"):
                self._serve_static(pathname)
                return
            self._send_json(405, {"error": "不支持的请求方法"})
        except ApiError as err:
            status = 400 if err.code == "CONFIG" else 500
            self._send_json(status, {"ok": False, "error": error_payload(err)})
        except Exception as err:
            self._send_json(500, {"ok": False, "error": error_payload(err)})

    def do_GET(self):
        self._dispatch()

    def do_HEAD(self):
        self._dispatch()

    def do_POST(self):
        self._dispatch()


def main():
    ThreadingHTTPServer.daemon_threads = True
    try:
        server = ThreadingHTTPServer((HOST, PORT), Handler)
    except OSError as err:
        if err.errno == errno.EADDRINUSE:
            print(f"端口{PORT}已被占用。可用 PORT=8788 python3 server.py 指定其他端口。")
        else:
            print("服务启动失败：", err)
        sys.exit(1)
    address = f"http://{'127.0.0.1' if HOST == '0.0.0.0' else HOST}:{PORT}"
    print("")
    print("  API账户余额看板已启动（Python标准库版，无需Node.js）")
    print(f"  本机访问：{address}")
    if HOST == "0.0.0.0":
        for ip in lan_addresses():
            print(f"  局域网访问：http://{ip}:{PORT}")
        print("  提示：仅建议在可信局域网内使用，密钥保存在本机，但页面可被同网设备访问。")
    print("  按Ctrl+C停止服务")
    print("")
    if sys.platform == "darwin" and HOST == "127.0.0.1" and not NO_OPEN:
        try:
            subprocess.Popen(["open", address], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except OSError:
            pass
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n服务已停止。")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
