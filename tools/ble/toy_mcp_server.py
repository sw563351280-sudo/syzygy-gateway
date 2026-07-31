"""
Toy BLE MCP Server — streamable-http transport.

Exposes toy_vibrate, toy_stop_vibration, toy_status as MCP tools.
Uses known-address BLEDevice token + BleakClient (DEVICE_OBSERVED path).
Bearer token auth via TOY_MCP_TOKEN env var.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import signal
import sys
import time
import uuid
from typing import Any

import uvicorn  # type: ignore[import-untyped]
from fastapi import FastAPI, Request, Response  # type: ignore[import-untyped]
from fastapi.responses import JSONResponse  # type: ignore[import-untyped]

# protocol.py
_this_dir = os.path.dirname(os.path.abspath(__file__))
if _this_dir not in sys.path:
    sys.path.insert(0, _this_dir)
from protocol import (  # type: ignore[import-not-found]
    WRITE_UUID,
    encode_vibration,
    format_hex_payload,
)

from bleak import BleakClient  # type: ignore[import-untyped]
from bleak.backends.device import BLEDevice  # type: ignore[import-untyped]

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

BLE_ADDRESS = os.environ.get("TOY_BLE_ADDRESS", "")
MCP_TOKEN = os.environ.get("TOY_MCP_TOKEN", "")
LISTEN_HOST = os.environ.get("TOY_MCP_HOST", "127.0.0.1")
LISTEN_PORT = int(os.environ.get("TOY_MCP_PORT", "8000"))

if not BLE_ADDRESS:
    print("FATAL: TOY_BLE_ADDRESS not set", file=sys.stderr)
    sys.exit(1)
if not MCP_TOKEN:
    print("FATAL: TOY_MCP_TOKEN not set", file=sys.stderr)
    sys.exit(1)

logging.basicConfig(level=logging.INFO, format="[toy-mcp] %(levelname)s: %(message)s")
logger = logging.getLogger("toy_mcp")

# ---------------------------------------------------------------------------
# BLE state
# ---------------------------------------------------------------------------

_client: BleakClient | None = None
_write_lock = asyncio.Lock()
_stop_timer_task: asyncio.Task[Any] | None = None
_connected = False
_last_error: str | None = None
_last_connect_attempt_at: float | None = None
_last_connect_attempt_ok: bool = False
_maintain_task: asyncio.Task[Any] | None = None


def _make_client() -> BleakClient:
    device = BLEDevice(BLE_ADDRESS, BLE_ADDRESS, {})
    return BleakClient(device, pair=False, winrt={"use_cached_services": False})


async def _connect() -> None:
    global _client, _connected, _last_error
    if _client is not None and _client.is_connected:
        return
    _client = _make_client()
    try:
        await asyncio.wait_for(_client.connect(timeout=30), timeout=35)
        _connected = True
        _last_error = None
        logger.info("Connected to %s", BLE_ADDRESS)
    except Exception as exc:
        _connected = False
        _last_error = str(exc)
        logger.error("Connect failed: %s", exc)
        raise


async def _disconnect() -> None:
    global _client, _connected
    if _client is not None:
        try:
            if _client.is_connected:
                await asyncio.wait_for(_client.disconnect(), timeout=10)
        except Exception:
            pass
    _client = None
    _connected = False


def _is_live() -> bool:
    return _client is not None and _client.is_connected


async def _maintain_connection() -> None:
    """Background task: keep BLE connected. Merged with auto-stop timer management."""
    global _connected, _client, _last_error, _last_connect_attempt_at, _last_connect_attempt_ok
    backoff = 2.0
    while True:
        try:
            if not _is_live():
                _last_connect_attempt_at = time.monotonic()
                await _connect()
                _last_connect_attempt_ok = True
                backoff = 2.0
                logger.info("Connection warmup OK")
            else:
                _last_connect_attempt_ok = True
            await asyncio.sleep(15)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            _last_connect_attempt_ok = False
            _last_error = str(exc)
            logger.warning("Connection maintain failed (retry in %.1fs): %s", backoff, exc)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 60)


async def _do_vibrate(intensity: int) -> None:
    global _stop_timer_task
    payload = encode_vibration(intensity=intensity, nonce=0x01)
    async with _write_lock:
        if _client is None or not _client.is_connected:
            raise RuntimeError("Not connected")
        await asyncio.wait_for(
            _client.write_gatt_char(WRITE_UUID, payload, response=True),
            timeout=30,
        )
    logger.info("Vibrate intensity=%d OK: %s", intensity, format_hex_payload(payload))


async def _do_stop_vibration() -> None:
    global _stop_timer_task
    if _stop_timer_task is not None:
        _stop_timer_task.cancel()
        _stop_timer_task = None
    payload = encode_vibration(intensity=0, nonce=0x01)
    async with _write_lock:
        if _client is None or not _client.is_connected:
            raise RuntimeError("Not connected")
        await asyncio.wait_for(
            _client.write_gatt_char(WRITE_UUID, payload, response=True),
            timeout=30,
        )
    logger.info("Vibration stop OK: %s", format_hex_payload(payload))


def _schedule_auto_stop(delay: float) -> None:
    global _stop_timer_task
    if _stop_timer_task is not None:
        _stop_timer_task.cancel()
    async def _delayed():
        await asyncio.sleep(delay)
        try:
            await _do_stop_vibration()
        except Exception as exc:
            logger.error("Auto-stop failed: %s", exc)
    _stop_timer_task = asyncio.create_task(_delayed())


# ---------------------------------------------------------------------------
# MCP JSON-RPC / FastAPI
# ---------------------------------------------------------------------------

app = FastAPI(title="toy-mcp-server", version="0.1.0")
_session_store: dict[str, Any] = {}

TOOLS_DEF = [
    {
        "name": "toy_vibrate",
        "description": "Start vibration at given intensity for a specified duration. Auto-stops when duration expires.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "intensity": {"type": "integer", "minimum": 1, "maximum": 100,
                              "description": "Vibration intensity 1-100"},
                "duration_seconds": {"type": "integer", "minimum": 1, "maximum": 30,
                                     "description": "Duration in seconds (1-30)"},
            },
            "required": ["intensity", "duration_seconds"],
        },
    },
    {
        "name": "toy_stop_vibration",
        "description": "Immediately stop any active vibration.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "toy_status",
        "description": "Report BLE connection status and last error.",
        "inputSchema": {"type": "object", "properties": {}},
    },
]


def _check_auth(request: Request) -> None:
    auth = request.headers.get("Authorization", "")
    expected = f"Bearer {MCP_TOKEN}"
    if auth != expected:
        raise PermissionError("Unauthorized")


async def _handle_request(body: dict[str, Any], request: Request) -> dict[str, Any] | None:
    method = body.get("method", "")
    msg_id = body.get("id")

    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "id": msg_id,
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "toy-mcp-server", "version": "0.1.0"},
            },
        }
    elif method == "notifications/initialized":
        return None
    elif method == "tools/list":
        return {"jsonrpc": "2.0", "id": msg_id, "result": {"tools": TOOLS_DEF}}
    elif method == "tools/call":
        params = body.get("params", {})
        tool_name = params.get("name", "")
        args = params.get("arguments", {})
        try:
            result_text = await _execute_tool(tool_name, args)
            return {
                "jsonrpc": "2.0",
                "id": msg_id,
                "result": {"content": [{"type": "text", "text": result_text}]},
            }
        except Exception as exc:
            logger.error("Tool %s failed: %s", tool_name, exc)
            return {
                "jsonrpc": "2.0",
                "id": msg_id,
                "error": {"code": -32000, "message": str(exc)},
            }
    else:
        return {
            "jsonrpc": "2.0",
            "id": msg_id,
            "error": {"code": -32601, "message": f"Unknown method: {method}"},
        }


async def _execute_tool(name: str, args: dict[str, Any]) -> str:
    if name == "toy_vibrate":
        intensity = args.get("intensity")
        duration = args.get("duration_seconds")
        if type(intensity) is not int:
            return "Error: intensity must be a strict integer 1-100"
        if type(duration) is not int:
            return "Error: duration_seconds must be a strict integer 1-30"
        if not (1 <= intensity <= 100):
            return f"Error: intensity must be 1-100, got {intensity}"
        if not (1 <= duration <= 30):
            return f"Error: duration_seconds must be 1-30, got {duration}"

        if not _connected:
            try:
                await asyncio.wait_for(_connect(), timeout=8)
            except asyncio.TimeoutError:
                return "Error: connection timeout (8s). Retry."
            except Exception as exc:
                return f"Error: connection failed: {exc}"

        await _do_vibrate(intensity)
        _schedule_auto_stop(float(duration))
        return f"Vibration started: intensity={intensity}, duration={duration}s (auto-stop scheduled)"

    elif name == "toy_stop_vibration":
        if not _connected:
            return "Not connected (no active vibration)"
        await _do_stop_vibration()
        return "Vibration stopped"

    elif name == "toy_status":
        status = "connected" if _connected else "disconnected"
        msg = f"Status: {status}"
        if _last_error:
            msg += f"  last_error: {_last_error}"
        return msg

    return f"Unknown tool: {name}"


@app.post("/mcp")
async def mcp_endpoint(request: Request):
    try:
        _check_auth(request)
    except PermissionError:
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)
    result = await _handle_request(body, request)
    if result is None:
        return Response(status_code=202)
    return JSONResponse(result)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "connected": _connected,
        "last_connect_attempt_at": _last_connect_attempt_at,
        "last_connect_attempt_ok": _last_connect_attempt_ok,
        "last_error": _last_error,
    }


@app.on_event("startup")
async def _on_startup():
    global _maintain_task
    _maintain_task = asyncio.create_task(_maintain_connection())
    logger.info("Connection maintain task started")


@app.on_event("shutdown")
async def _on_shutdown():
    await _shutdown()



# ---------------------------------------------------------------------------
# Shutdown
# ---------------------------------------------------------------------------

async def _shutdown() -> None:
    logger.info("Shutting down...")
    if _stop_timer_task:
        _stop_timer_task.cancel()
    if _connected:
        try:
            await _do_stop_vibration()
        except Exception:
            pass
    await _disconnect()


def _handle_signal(signum: int, frame: Any) -> None:
    logger.info("Signal %d received", signum)
    sys.exit(0)


def main() -> None:
    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    logger.info("Starting toy-mcp-server on %s:%d", LISTEN_HOST, LISTEN_PORT)
    uvicorn.run(app, host=LISTEN_HOST, port=LISTEN_PORT, log_level="info")


if __name__ == "__main__":
    main()
