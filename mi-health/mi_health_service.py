#!/usr/bin/env python3
"""Loopback-only gateway for Xiaomi health data."""
from __future__ import annotations

import asyncio
import dataclasses
import datetime as dt
import hmac
import json
import os
import stat
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

ALLOWED_TYPES = {"all", "sleep", "heart_rate", "steps"}
ALLOWED_API_BASES = {"https://hlth.io.mi.com", "https://ru.hlth.io.mi.com"}
SENSITIVE_KEYS = {"token", "cookie", "cookies", "password", "user_id", "uid", "relative_uid", "raw_response"}


class ConfigError(RuntimeError):
    pass


def env_flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() == "true"


def validate_api_base(value: str) -> str:
    normalized = value.strip().rstrip("/")
    if normalized not in ALLOWED_API_BASES:
        raise ConfigError("MI_HEALTH_API_BASE is not an allowed Xiaomi health endpoint")
    return normalized


def get_config() -> dict[str, Any]:
    token_file = Path(os.environ.get("MI_HEALTH_TOKEN_FILE", "/opt/syzygy/data/mi-health/token.json"))
    config = {
        "enabled": env_flag("MI_HEALTH_ENABLED"),
        "token_file": token_file,
        "relative_uid": os.environ.get("MI_HEALTH_RELATIVE_UID", "").strip(),
        "service_token": os.environ.get("MI_HEALTH_SERVICE_TOKEN", ""),
        "host": os.environ.get("MI_HEALTH_BIND_HOST", "127.0.0.1"),
        "port": int(os.environ.get("MI_HEALTH_PORT", "8091")),
        "api_base": validate_api_base(os.environ.get("MI_HEALTH_API_BASE", "https://hlth.io.mi.com")),
    }
    if config["host"] not in {"127.0.0.1", "::1", "localhost"}:
        raise ConfigError("MI_HEALTH_BIND_HOST must be loopback only")
    return config


def assert_ready(config: dict[str, Any]) -> None:
    if not config["enabled"]:
        raise ConfigError("health data service is disabled")
    if len(config["service_token"]) < 32:
        raise ConfigError("MI_HEALTH_SERVICE_TOKEN must be at least 32 characters")
    if not config["relative_uid"]:
        raise ConfigError("MI_HEALTH_RELATIVE_UID is required")
    token_file: Path = config["token_file"]
    if not token_file.is_file():
        raise ConfigError("Xiaomi token file is missing")
    if os.name != "nt" and stat.S_IMODE(token_file.stat().st_mode) & 0o077:
        raise ConfigError("Xiaomi token file must not be accessible by group or others")


def validate_date(value: str) -> dt.date:
    try:
        return dt.date.fromisoformat(value)
    except (TypeError, ValueError) as error:
        raise ValueError("date must be YYYY-MM-DD") from error


def to_safe_json(value: Any) -> Any:
    """Convert SDK models without leaking credentials or account identifiers."""
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, (dt.date, dt.datetime, dt.time)):
        return value.isoformat()
    if dataclasses.is_dataclass(value):
        return to_safe_json(dataclasses.asdict(value))
    if hasattr(value, "model_dump"):
        return to_safe_json(value.model_dump())
    if isinstance(value, dict):
        return {str(key): to_safe_json(item) for key, item in value.items() if str(key).lower() not in SENSITIVE_KEYS}
    if isinstance(value, (list, tuple, set)):
        return [to_safe_json(item) for item in value]
    if hasattr(value, "__dict__"):
        return to_safe_json(vars(value))
    return str(value)


async def query_health(config: dict[str, Any], date: dt.date, requested_type: str) -> dict[str, Any]:
    try:
        from mi_fitness import MiHealthClient
    except ImportError as error:
        raise RuntimeError("mi-fitness is not installed") from error

    async with MiHealthClient.from_token(str(config["token_file"]), base_url=config["api_base"]) as client:
        uid = config["relative_uid"]
        operations = {
            "sleep": client.get_sleep(uid, date),
            "heart_rate": client.get_heart_rate(uid, date),
            "steps": client.get_steps(uid, date),
        }
        selected = operations if requested_type == "all" else {requested_type: operations[requested_type]}
        names = list(selected)
        results = await asyncio.gather(*selected.values())
    return {name: to_safe_json(result) for name, result in zip(names, results, strict=True)}


class HealthHandler(BaseHTTPRequestHandler):
    server_version = "SyzygyMiHealth/1.0"

    def log_message(self, format: str, *args: Any) -> None:
        print("[mi-health]", format % args)

    def send_json(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
        raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def authorized(self, config: dict[str, Any]) -> bool:
        header = self.headers.get("Authorization", "")
        expected = f"Bearer {config['service_token']}"
        return hmac.compare_digest(header, expected)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/status":
            try:
                config = get_config()
                assert_ready(config)
                self.send_json(HTTPStatus.OK, {"ok": True, "enabled": True})
            except ConfigError:
                self.send_json(HTTPStatus.SERVICE_UNAVAILABLE, {"ok": False, "error": "service_not_ready"})
            return
        if parsed.path != "/health":
            self.send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "not_found"})
            return
        try:
            config = get_config()
            assert_ready(config)
        except (ConfigError, ValueError):
            self.send_json(HTTPStatus.SERVICE_UNAVAILABLE, {"ok": False, "error": "service_not_ready"})
            return
        if not self.authorized(config):
            self.send_json(HTTPStatus.UNAUTHORIZED, {"ok": False, "error": "unauthorized"})
            return
        query = parse_qs(parsed.query)
        try:
            date = validate_date(query.get("date", [""])[0])
            requested_type = query.get("type", ["all"])[0]
            if requested_type not in ALLOWED_TYPES:
                raise ValueError("invalid type")
            data = asyncio.run(query_health(config, date, requested_type))
            self.send_json(HTTPStatus.OK, {"ok": True, "date": date.isoformat(), "data": data})
        except ValueError as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(error)})
        except Exception as error:
            print("[mi-health] query failed:", type(error).__name__)
            self.send_json(HTTPStatus.BAD_GATEWAY, {"ok": False, "error": "upstream_query_failed"})


def main() -> None:
    config = get_config()
    assert_ready(config)
    server = ThreadingHTTPServer((config["host"], config["port"]), HealthHandler)
    print(f"[mi-health] listening on {config['host']}:{config['port']}")
    server.serve_forever()


if __name__ == "__main__":
    main()
