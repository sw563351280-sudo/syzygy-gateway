#!/usr/bin/env python3
"""
正式 BLETransport 单次停止帧集成验证。

通过 BLETransport 公共 API（非 Bleak/WinRT 直接调用）对真实设备
执行一次已确认的停止帧写入。
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
    encode_stop,
    format_hex_payload,
)


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


def validate_timeout(v: str, name: str, lo: float, hi: float) -> float:
    try:
        val = float(v)
    except (TypeError, ValueError):
        raise argparse.ArgumentTypeError(f"--{name} must be a number")
    if val < lo or val > hi:
        raise argparse.ArgumentTypeError(f"--{name} must be {lo}..{hi}")
    return val


async def run(address: str, args: argparse.Namespace) -> int:
    # 编码停止帧
    succ, vib = encode_stop(suction_nonce=0xA1, vibration_nonce=0xA2)
    suction_payload = succ  # 只发第一帧（吮吸停止）
    assert suction_payload == bytes.fromhex("A10100020007110000081104"), (
        f"payload mismatch: {format_hex_payload(suction_payload)}"
    )
    assert vib == bytes.fromhex("A20100020001110000021101"), "vibration payload mismatch"

    print(f"Stop frame (from protocol.encode_stop):")
    print(f"  {format_hex_payload(suction_payload)}")
    print(f"  Payload assertion: PASSED")
    print()

    notification_log: list[dict[str, Any]] = []
    _obs_t0 = 0.0
    write_count = 0
    transport = BLETransport()
    write_success = False
    write_error: str | None = None
    write_traceback: str | None = None
    cleanup_ok = True

    try:
        # 1. 连接
        print("[1] Connecting via BLETransport...")
        t0 = time.monotonic()
        await transport.connect(
            address,
            scan_timeout=args.scan_timeout,
            connect_timeout=args.connect_timeout,
        )
        print(f"     connected in {(time.monotonic() - t0):.1f}s")
        print(f"     is_connected: {transport.is_connected}")
        print(f"     mtu_size: {transport.mtu_size}")

        # 2. 定位确认
        loc = transport.get_locator()
        if loc:
            print(f"     EE01: OK")
            print(f"     EE02: handle={loc.ee02.handle}  props={loc.ee02.properties}")
            print(f"     EE03: handle={loc.ee03.handle}  props={loc.ee03.properties}")

        # 3. 订阅 EE02
        print(f"\n[2] start_notify EE02...")

        def _on_notify(sender: Any, data: bytearray) -> None:
            elapsed = time.monotonic() - _obs_t0
            entry = {
                "elapsed": elapsed,
                "length": len(data),
                "hex": " ".join(f"{b:02X}" for b in data),
            }
            notification_log.append(entry)
            print(f"  [NOTIFY +{elapsed:.2f}s] {entry['length']}B: {entry['hex']}")

        _obs_t0 = time.monotonic()
        await transport.start_notify(_on_notify, timeout=args.operation_timeout)
        print(f"     start_notify: OK")

        # 4. baseline
        print(f"\n[3] Baseline ({args.notification_wait}s)...")
        await asyncio.sleep(args.notification_wait)
        print(f"     baseline notifications: {len(notification_log)}")

        # 5. 再次断言 payload
        assert suction_payload == bytes.fromhex("A10100020007110000081104"), (
            "payload assertion failed before write"
        )

        # 6. 写入 EE03
        print(f"\n[4] write_ee03 (response=True)...")
        print(f"     payload: {format_hex_payload(suction_payload)}")
        write_count = 1
        t_w = time.monotonic()
        try:
            await transport.write_ee03(suction_payload, timeout=args.operation_timeout)
            elapsed_w = (time.monotonic() - t_w) * 1000
            write_success = True
            print(f"     WRITE SUCCESS in {elapsed_w:.0f}ms")
        except Exception as exc:
            elapsed_w = (time.monotonic() - t_w) * 1000
            write_error = f"{type(exc).__name__}: {exc}"
            write_traceback = traceback.format_exc()
            print(f"     WRITE FAILED in {elapsed_w:.0f}ms: {write_error}")
            traceback.print_exc(file=sys.stderr)

        # 7. 写入后等待
        print(f"\n[5] Post-write wait ({args.notification_wait}s)...")
        await asyncio.sleep(args.notification_wait)
        print(f"     total notifications: {len(notification_log)}")

    except (TransportError, Exception) as exc:
        print(f"ERROR: {type(exc).__name__}: {exc}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        if write_count == 0:
            print("     (write not attempted)", file=sys.stderr)

    finally:
        # 清理
        print(f"\n[6] Cleanup...")
        try:
            await transport.disconnect()
            print(f"     disconnect: OK")
        except Exception as exc:
            cleanup_ok = False
            print(f"     disconnect FAILED: {exc}", file=sys.stderr)

    # 汇总
    print(f"\n{'='*60}")
    print(f"  BLETransport Stop Validation — Summary")
    print(f"{'='*60}")
    print(f"  Payload:     {format_hex_payload(suction_payload)}")
    print(f"  Write count: {write_count}")
    print(f"  Write result: {'SUCCESS' if write_success else ('FAILED: ' + str(write_error))}")
    print(f"  Notifications: {len(notification_log)}")
    for n in notification_log:
        print(f"    [{n['elapsed']:.2f}s] {n['length']}B: {n['hex']}")
    print(f"  Cleanup: {'OK' if cleanup_ok else 'FAILED'}")
    print(f"{'='*60}")

    # 结论
    if write_success and cleanup_ok:
        print("CONCLUSION: A — BLETransport write SUCCESS, cleanup OK")
    elif write_success and not cleanup_ok:
        print("CONCLUSION: F — Write SUCCESS but cleanup FAILED")
    elif write_count == 0:
        print("CONCLUSION: C/D/E — Write not attempted (connection/locate/subscribe/payload error)")
    else:
        print("CONCLUSION: B — Write FAILED")
        if write_traceback:
            print(f"  Traceback:\n{write_traceback}")

    if write_success:
        print()
        print("NOTE: ATT write accepted. This does NOT confirm device executed stop action.")

    return 0 if write_success else 1


def main() -> None:
    parser = argparse.ArgumentParser(description="BLETransport 单次停止帧集成验证")
    parser.add_argument("--address", required=True, type=parse_address, metavar="ADDRESS")
    parser.add_argument("--scan-timeout", type=lambda v: validate_timeout(v, "scan-timeout", 1, 60),
                        default=15.0, help="扫描超时 (1-60)")
    parser.add_argument("--connect-timeout", type=lambda v: validate_timeout(v, "connect-timeout", 5, 60),
                        default=30.0, help="连接超时 (5-60)")
    parser.add_argument("--operation-timeout", type=lambda v: validate_timeout(v, "operation-timeout", 5, 60),
                        default=30.0, help="操作超时 (5-60)")
    parser.add_argument("--notification-wait", type=lambda v: validate_timeout(v, "notification-wait", 0, 10),
                        default=2.0, help="通知等待 (0-10)")
    args = parser.parse_args()

    try:
        ec = asyncio.run(run(args.address, args))
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
