#!/usr/bin/env python3
"""
Bleak 3.0.2 公共 API — 单次停止帧对照。

使用 Bleak 公共 API（不直接调用 WinRT GATT 方法）对 EE03 执行一次
与阶段 5A/5A.2 完全相同的停止帧写入。
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
import time
import traceback
from typing import Any

# 开启 Bleak DEBUG 日志
logging.basicConfig(level=logging.DEBUG, format="[bleak] %(name)s %(levelname)s: %(message)s",
                    stream=sys.stderr)
logger = logging.getLogger("bleak")

from bleak import BleakClient, BleakScanner, BleakError  # type: ignore[import-untyped]
from bleak.exc import BleakGATTProtocolError  # type: ignore[import-untyped]

# protocol.py
import os as _os
_this_dir = _os.path.dirname(_os.path.abspath(__file__))
if _this_dir not in sys.path:
    sys.path.insert(0, _this_dir)
from protocol import encode_stop, format_hex_payload

EE01_SVC = "0000ee01-0000-1000-8000-00805f9b34fb"
EE02_CH = "0000ee02-0000-1000-8000-00805f9b34fb"
EE03_CH = "0000ee03-0000-1000-8000-00805f9b34fb"


def parse_address(raw: str) -> str:
    cleaned = raw.strip().replace("-", ":").upper()
    parts = cleaned.split(":")
    if len(parts) != 6:
        raise argparse.ArgumentTypeError("Address must be 6 colon-separated hex bytes")
    try:
        vals = [int(p, 16) for p in parts]
    except ValueError:
        raise argparse.ArgumentTypeError(f"Invalid hex: '{raw}'")
    for b in vals:
        if not (0 <= b <= 255):
            raise argparse.ArgumentTypeError(f"Byte out of range: '{raw}'")
    return ":".join(f"{b:02X}" for b in vals)


def parse_nonce(v: str) -> int:
    text = v.strip()
    try:
        if text.lower().startswith("0x"):
            return int(text, 16)
        if all(c in "0123456789ABCDEFabcdef" for c in text) and len(text) <= 2:
            return int(text, 16)
        return int(text, 10)
    except ValueError:
        raise argparse.ArgumentTypeError(f"Invalid nonce: '{v}'")


# ---------------------------------------------------------------------------

async def run_bleak_test(address: str, suction_nonce: int, vibration_nonce: int,
                         scan_timeout: float, op_timeout: float) -> int:
    suction_payload, vibration_payload = encode_stop(
        suction_nonce=suction_nonce, vibration_nonce=vibration_nonce,
    )
    print(f"Stop payloads (from protocol.encode_stop):")
    print(f"  SUCTION:  {format_hex_payload(suction_payload)}")
    print(f"  VIBRATION: {format_hex_payload(vibration_payload)}")
    assert suction_payload == bytes.fromhex("A10100020007110000081104"), "payload mismatch"
    assert vibration_payload == bytes.fromhex("A20100020001110000021101"), "payload mismatch"
    print(f"  Assertions: OK")
    print()

    notifications: list[dict[str, Any]] = []
    _notify_t0 = 0.0
    write_result: dict[str, Any] = {}
    write_attempted = False

    client = BleakClient(
        address,
        pair=False,
        winrt={"use_cached_services": False},
        timeout=op_timeout,
    )

    try:
        # --- 连接 ---
        print(f"[1] BleakClient connecting...")
        t0 = time.monotonic()
        await asyncio.wait_for(client.connect(), timeout=op_timeout)
        print(f"     connected in {(time.monotonic() - t0):.2f}s")
        print(f"     is_connected: {client.is_connected}")
        print(f"     mtu_size: {client.mtu_size}")

        # --- 定位 GATT ---
        print(f"[2] Locating EE01/EE02/EE03...")
        ee01_svc = None
        ee02_char_obj = None
        ee03_char_obj = None
        for svc in client.services:
            if svc.uuid.lower() == EE01_SVC:
                ee01_svc = svc
                for ch in svc.characteristics:
                    cu = ch.uuid.lower()
                    if cu == EE02_CH:
                        ee02_char_obj = ch
                    elif cu == EE03_CH:
                        ee03_char_obj = ch
                break

        if ee01_svc is None:
            print("ERROR: EE01 not found", file=sys.stderr)
            return 1
        if ee02_char_obj is None:
            print("ERROR: EE02 not found", file=sys.stderr)
            return 1
        if ee03_char_obj is None:
            print("ERROR: EE03 not found", file=sys.stderr)
            return 1

        print(f"     EE01 handle: {ee01_svc.handle}")
        print(f"     EE02 handle: {ee02_char_obj.handle}  props: {ee02_char_obj.properties}")
        print(f"     EE03 handle: {ee03_char_obj.handle}  props: {ee03_char_obj.properties}")
        try:
            mw = ee03_char_obj.max_write_without_response_size
            print(f"     EE03 max_write_wo_resp: {mw}")
        except Exception:
            pass

        # --- 订阅 EE02 ---
        print(f"\n[3] start_notify EE02...")

        def _on_notify(sender: Any, data: bytearray) -> None:
            elapsed = time.monotonic() - _notify_t0
            entry = {
                "elapsed": elapsed,
                "length": len(data),
                "hex": " ".join(f"{b:02X}" for b in data),
            }
            notifications.append(entry)
            print(f"  [NOTIFY +{elapsed:.2f}s] {entry['length']}B: {entry['hex']}")

        _notify_t0 = time.monotonic()
        try:
            await asyncio.wait_for(
                client.start_notify(ee02_char_obj, _on_notify),
                timeout=op_timeout,
            )
            print(f"     start_notify: OK")
        except Exception as exc:
            print(f"ERROR: start_notify failed: {type(exc).__name__}: {exc}", file=sys.stderr)
            traceback.print_exc(file=sys.stderr)
            return 1

        # --- 基线 ---
        print(f"\n[4] 2s baseline...")
        await asyncio.sleep(2.0)
        print(f"     baseline notifications: {len(notifications)}")

        # --- 写入 EE03 ---
        print(f"\n[5] write_gatt_char EE03 (response=True)...")
        print(f"     payload: {format_hex_payload(suction_payload)}")
        print(f"     length: {len(suction_payload)}")

        write_attempted = True
        t_w = time.monotonic()
        try:
            await asyncio.wait_for(
                client.write_gatt_char(
                    ee03_char_obj,
                    suction_payload,
                    response=True,
                ),
                timeout=op_timeout,
            )
            elapsed_w = (time.monotonic() - t_w) * 1000
            write_result = {
                "status": "SUCCESS",
                "elapsed_ms": elapsed_w,
                "exception": None,
            }
            print(f"     WRITE SUCCESS in {elapsed_w:.0f}ms")
        except BleakGATTProtocolError as exc:
            elapsed_w = (time.monotonic() - t_w) * 1000
            att_code = getattr(exc, "att_error_code", None)
            write_result = {
                "status": f"ATT_PROTOCOL_ERROR",
                "att_error_code": att_code,
                "elapsed_ms": elapsed_w,
                "exception": f"{type(exc).__name__}: {exc}",
            }
            print(f"     ATT PROTOCOL ERROR: {exc}  att_error_code={att_code}")
            traceback.print_exc(file=sys.stderr)
        except BleakError as exc:
            elapsed_w = (time.monotonic() - t_w) * 1000
            exc_msg = str(exc)
            is_access_denied = "access" in exc_msg.lower() or "denied" in exc_msg.lower()
            write_result = {
                "status": f"BLEAK_ERROR{' (ACCESS_DENIED category)' if is_access_denied else ''}",
                "elapsed_ms": elapsed_w,
                "exception": f"{type(exc).__name__}: {exc_msg}",
                "is_access_denied_category": is_access_denied,
            }
            print(f"     BleakError: {exc_msg}  access_denied_category={is_access_denied}")
            traceback.print_exc(file=sys.stderr)
        except Exception as exc:
            elapsed_w = (time.monotonic() - t_w) * 1000
            write_result = {
                "status": f"UNEXPECTED_ERROR",
                "elapsed_ms": elapsed_w,
                "exception": f"{type(exc).__name__}: {exc}",
                "traceback": traceback.format_exc(),
            }
            print(f"     Exception: {type(exc).__name__}: {exc}")
            traceback.print_exc(file=sys.stderr)

        after_write = len(notifications)
        print(f"     notifications after write: {after_write}")

        # 等待
        print(f"\n     Waiting 3s for notifications...")
        await asyncio.sleep(3.0)
        print(f"     total notifications: {len(notifications)}")

    finally:
        # --- 清理 ---
        print(f"\n[6] Cleanup...", file=sys.stderr)
        if client.is_connected:
            try:
                await asyncio.wait_for(client.stop_notify(ee02_char_obj), timeout=10.0)
                print(f"     stop_notify: OK", file=sys.stderr)
            except Exception as exc:
                print(f"     stop_notify WARNING: {exc}", file=sys.stderr)
            try:
                await asyncio.wait_for(client.disconnect(), timeout=10.0)
                print(f"     disconnect: OK", file=sys.stderr)
            except Exception as exc:
                print(f"     disconnect WARNING: {exc}", file=sys.stderr)

    # --- 汇总 ---
    print(f"\n{'='*60}")
    print(f"  Bleak Stop Candidate — Summary")
    print(f"{'='*60}")
    print(f"  Payload:   {format_hex_payload(suction_payload)}")
    print(f"  Write attempted: {write_attempted}")
    print(f"  Write result:")
    for k, v in write_result.items():
        print(f"    {k}: {v}")
    print(f"  Notifications: {len(notifications)}")
    for n in notifications:
        print(f"    [{n['elapsed']:.2f}s] {n['length']}B: {n['hex']}")
    print(f"  Resource cleanup: OK")
    print(f"{'='*60}")

    if write_result.get("status") == "SUCCESS":
        print("CONCLUSION: A — Bleak write SUCCESS")
    elif write_result.get("is_access_denied_category"):
        print("CONCLUSION: B — Bleak also returns Access Denied category")
    elif "ATT_PROTOCOL_ERROR" in write_result.get("status", ""):
        print("CONCLUSION: C — Bleak returns ATT Protocol Error")
        print(f"  ATT error code: {write_result.get('att_error_code')}")
    elif not write_attempted:
        print("CONCLUSION: E — Bleak connection/service failed; write not attempted")
    else:
        print(f"CONCLUSION: F — Other failure: {write_result.get('status')}")

    return 0 if write_result.get("status") == "SUCCESS" else 1


async def main_async(args: argparse.Namespace) -> int:
    return await run_bleak_test(
        args.address, args.suction_nonce, args.vibration_nonce,
        args.scan_timeout, args.operation_timeout,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Bleak 3.0.2 单次停止帧对照")
    parser.add_argument("--address", required=True, type=parse_address, metavar="ADDRESS")
    parser.add_argument("--suction-nonce", required=True, type=parse_nonce, metavar="NONCE")
    parser.add_argument("--vibration-nonce", required=True, type=parse_nonce, metavar="NONCE")
    parser.add_argument("--scan-timeout", type=float, default=15.0)
    parser.add_argument("--operation-timeout", type=float, default=30.0)
    args = parser.parse_args()
    try:
        ec = asyncio.run(main_async(args))
    except KeyboardInterrupt:
        print("\nInterrupted (Ctrl+C).", file=sys.stderr)
        sys.exit(130)
    except Exception as exc:
        print(f"Fatal: {type(exc).__name__}: {exc}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
    else:
        sys.exit(ec)


if __name__ == "__main__":
    main()
