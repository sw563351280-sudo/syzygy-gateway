#!/usr/bin/env python3
"""
最低非零强度振动语义验证 — BLETransport 公共 API。

发送一次最低档振动 (intensity=1) 持续 1 秒，然后发送停止帧。
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import time
import traceback
from typing import Any

import os as _os
_this_dir = _os.path.dirname(_os.path.abspath(__file__))
if _this_dir not in sys.path:
    sys.path.insert(0, _this_dir)

from ble_transport import (  # type: ignore[import-not-found]
    BLETransport,
    TransportError,
)
from protocol import (  # type: ignore[import-not-found]
    INTENSITY_MIN,
    encode_stop,
    encode_vibration,
    format_hex_payload,
)

# 最低非零强度 = INTENSITY_MIN + 1 = 1（范围 0-100）
MIN_NONZERO_INTENSITY = 1
assert INTENSITY_MIN == 0
assert MIN_NONZERO_INTENSITY == 1

VERIFIED_STOP_PAYLOAD = bytes.fromhex("A10100020007110000081104")


def parse_address(raw: str) -> str:
    cleaned = raw.strip().replace("-", ":").upper()
    parts = cleaned.split(":")
    if len(parts) != 6:
        raise argparse.ArgumentTypeError("Address must be 6 colon-separated hex bytes")
    try:
        vals = [int(p, 16) for p in parts]
    except ValueError:
        raise argparse.ArgumentTypeError(f"Invalid hex: '{raw}'")
    return ":".join(f"{b:02X}" for b in vals)


async def run(address: str, scan_timeout: float, connect_timeout: float,
              op_timeout: float) -> int:
    # 编码
    vibration_payload = encode_vibration(intensity=MIN_NONZERO_INTENSITY, nonce=0x01)
    succ_stop, vib_stop = encode_stop(suction_nonce=0xA1, vibration_nonce=0xA2)
    stop_payload = succ_stop  # 吮吸停止帧
    assert stop_payload == VERIFIED_STOP_PAYLOAD, (
        f"stop payload mismatch: {format_hex_payload(stop_payload)}"
    )

    print(f"Min non-zero vibration intensity: {MIN_NONZERO_INTENSITY}")
    print(f"Vibration payload : {format_hex_payload(vibration_payload)}")
    print(f"Stop payload      : {format_hex_payload(stop_payload)}")
    print()

    notification_log: list[dict[str, Any]] = []
    _obs_t0 = 0.0
    write_count = 0
    vibration_attempted = False
    stop_sent_in_normal_path = False
    transport = BLETransport()

    vibration_write_ok = False
    stop_write_ok = False

    async def _try_stop() -> bool:
        """发送一次停止帧。只在 connected 且未发送过时执行。"""
        nonlocal stop_sent_in_normal_path, write_count, stop_write_ok
        if stop_sent_in_normal_path:
            return True
        if not transport.is_connected:
            print("     [stop] NOT CONNECTED; cannot send stop.", file=sys.stderr)
            return False
        write_count += 1
        stop_sent_in_normal_path = True
        try:
            await transport.write_ee03(stop_payload, timeout=5.0)
            print(f"     [stop] WRITE OK")
            stop_write_ok = True
            return True
        except Exception as exc:
            print(f"     [stop] WRITE FAILED: {type(exc).__name__}: {exc}", file=sys.stderr)
            traceback.print_exc(file=sys.stderr)
            return False

    try:
        # --- 连接 ---
        print("[1] Connecting...")
        t0 = time.monotonic()
        await transport.connect(address, scan_timeout=scan_timeout,
                                 connect_timeout=connect_timeout)
        print(f"     connected in {(time.monotonic() - t0):.1f}s  mtu={transport.mtu_size}")

        # --- 订阅 ---
        print(f"\n[2] start_notify...")

        def _on_notify(sender: Any, data: bytearray) -> None:
            elapsed = time.monotonic() - _obs_t0
            entry = {"elapsed": elapsed, "length": len(data),
                     "hex": " ".join(f"{b:02X}" for b in data)}
            notification_log.append(entry)
            print(f"  [NOTIFY +{elapsed:.2f}s] {entry['length']}B: {entry['hex']}")

        _obs_t0 = time.monotonic()
        await transport.start_notify(_on_notify, timeout=op_timeout)

        # --- baseline ---
        print(f"\n[3] Baseline 1s...")
        await asyncio.sleep(1.0)
        print(f"     notifications: {len(notification_log)}")

        # --- 振动 ---
        print(f"\n[4] write_ee03 — MIN VIBRATION (intensity=1, nonce=0x01)...")
        print(f"     payload: {format_hex_payload(vibration_payload)}")
        vibration_attempted = True
        write_count += 1
        t_w = time.monotonic()
        try:
            await transport.write_ee03(vibration_payload, timeout=op_timeout)
            elapsed_w = (time.monotonic() - t_w) * 1000
            vibration_write_ok = True
            print(f"     WRITE OK in {elapsed_w:.0f}ms")
        except Exception as exc:
            elapsed_w = (time.monotonic() - t_w) * 1000
            print(f"     WRITE FAILED in {elapsed_w:.0f}ms: {type(exc).__name__}: {exc}")
            traceback.print_exc(file=sys.stderr)

        # --- 等待 1 秒 ---
        print(f"\n[5] Waiting 1s (vibration active)...")
        await asyncio.sleep(1.0)
        mid_notifications = len(notification_log)
        print(f"     notifications during vibration: {mid_notifications}")

        # --- 停止 ---
        print(f"\n[6] write_ee03 — STOP...")
        ok = await _try_stop()

        # --- 等待 ---
        print(f"\n[7] Post-stop wait 1s...")
        await asyncio.sleep(1.0)
        print(f"     total notifications: {len(notification_log)}")

    except (TransportError, Exception) as exc:
        print(f"ERROR: {type(exc).__name__}: {exc}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        if write_count == 0:
            print("     (no writes attempted)")

    finally:
        # finally 中尝试停止（如果正常路径未发送）
        if vibration_attempted and not stop_sent_in_normal_path:
            print(f"\n[finally] Attempting stop (was not sent in normal path)...")
            await _try_stop()

        # 清理
        print(f"\n[cleanup] Disconnecting...")
        try:
            await transport.disconnect()
            print(f"     disconnect: OK")
        except Exception as exc:
            print(f"     disconnect FAILED: {exc}", file=sys.stderr)

    # --- 汇总 ---
    print(f"\n{'='*60}")
    print(f"  Min Vibration + Stop — Summary")
    print(f"{'='*60}")
    print(f"  Vibration payload: {format_hex_payload(vibration_payload)}")
    print(f"  Vibration write:   {'OK' if vibration_write_ok else 'FAILED'}")
    print(f"  Stop payload:      {format_hex_payload(stop_payload)}")
    print(f"  Stop write:        {'OK' if stop_write_ok else 'FAILED/Not attempted'}")
    print(f"  Total writes:      {write_count}")
    print(f"  Notifications:     {len(notification_log)}")
    for n in notification_log:
        print(f"    [{n['elapsed']:.2f}s] {n['length']}B: {n['hex']}")
    print(f"  Intensity > 1:     NO")
    print(f"  Duration > 1s:     NO")
    print(f"  Suction attempted: NO")
    print(f"  AE01 written:      NO")
    print(f"  Retries:           NO")
    print(f"{'='*60}")

    # 报告程序观察到的事实，不宣称设备行为
    print()
    print("PROGRAM OBSERVATIONS (not device claims):")
    print(f"  - Vibration ATT write: {'accepted' if vibration_write_ok else 'FAILED'}")
    print(f"  - Stop ATT write: {'accepted' if stop_write_ok else 'FAILED/Not attempted'}")
    print(f"  - EE02 notifications received: {len(notification_log)}")
    print()
    print("WAITING FOR USER TO REPORT ACTUAL DEVICE BEHAVIOR.")
    print("Choose: A/B/C/D/E (see phase instructions)")

    return 0 if vibration_write_ok else 1


def main() -> None:
    parser = argparse.ArgumentParser(description="最低档振动 1s + 停止 语义验证")
    parser.add_argument("--address", required=True, type=parse_address, metavar="ADDRESS")
    parser.add_argument("--scan-timeout", type=float, default=30.0, help="扫描超时 (default 30s)")
    parser.add_argument("--connect-timeout", type=float, default=30.0, help="连接超时")
    parser.add_argument("--operation-timeout", type=float, default=30.0, help="操作超时")
    args = parser.parse_args()

    try:
        ec = asyncio.run(run(args.address, args.scan_timeout,
                             args.connect_timeout, args.operation_timeout))
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
