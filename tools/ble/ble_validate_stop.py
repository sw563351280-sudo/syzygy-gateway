#!/usr/bin/env python3
"""
教程停止候选帧首次设备验证。

订阅 EE02 → 向 EE03 写入两条 intensity=0 停止候选帧 → 观察 EE02 通知。
这是真实 GATT 写入，不是 dry-run。

唯一应用层写入：两次 EE03 WRITE_WITH_RESPONSE 停止帧。
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import time
from datetime import datetime, timezone
from typing import Any

import winrt.windows.storage.streams as _streams  # type: ignore[import-not-found]
from winrt.windows.devices.bluetooth import (  # type: ignore[import-not-found]
    BluetoothCacheMode,
    BluetoothLEDevice,
)
from winrt.windows.devices.bluetooth.advertisement import (  # type: ignore[import-not-found]
    BluetoothLEAdvertisementReceivedEventArgs,
    BluetoothLEAdvertisementWatcher,
    BluetoothLEScanningMode,
)
from winrt.windows.devices.bluetooth.genericattributeprofile import (  # type: ignore[import-not-found]
    GattCharacteristic,
    GattClientCharacteristicConfigurationDescriptorValue,
    GattCommunicationStatus,
    GattSession,
    GattSessionStatus,
    GattSessionStatusChangedEventArgs,
    GattWriteOption,
)
from winrt.windows.devices.enumeration import (  # type: ignore[import-not-found]
    DeviceAccessStatus,
)

# protocol.py 导入
import os as _os
_this_dir = _os.path.dirname(_os.path.abspath(__file__))
if _this_dir not in sys.path:
    sys.path.insert(0, _this_dir)
from protocol import (  # type: ignore[import-not-found]
    encode_stop,
    format_hex_payload,
)

# ---------------------------------------------------------------------------
# 常量
# ---------------------------------------------------------------------------

EE01_SVC = "0000ee01-0000-1000-8000-00805f9b34fb"
EE02_CH = "0000ee02-0000-1000-8000-00805f9b34fb"
EE03_CH = "0000ee03-0000-1000-8000-00805f9b34fb"

# ---------------------------------------------------------------------------
# 工具函数
# ---------------------------------------------------------------------------

def parse_address(raw: str) -> tuple[int, str]:
    cleaned = raw.strip().replace("-", ":").upper()
    parts = cleaned.split(":")
    if len(parts) != 6:
        raise argparse.ArgumentTypeError("Address must be 6 colon-separated hex bytes")
    try:
        vals = [int(p, 16) for p in parts]
    except ValueError:
        raise argparse.ArgumentTypeError(f"Invalid hex in: '{raw}'")
    for b in vals:
        if not (0 <= b <= 255):
            raise argparse.ArgumentTypeError(f"Byte out of range: '{raw}'")
    formatted = ":".join(f"{b:02X}" for b in vals)
    value = 0
    for b in vals:
        value = (value << 8) | b
    return value, formatted


def _address_type(raw: str) -> tuple[int, str]:
    return parse_address(raw)


def format_address(value: int) -> str:
    raw = f"{value:012X}"
    return ":".join(raw[i:i + 2] for i in range(0, 12, 2))


def validate_nonce(value: str) -> int:
    text = value.strip()
    try:
        if text.lower().startswith("0x"):
            val = int(text, 16)
        elif all(c in "0123456789ABCDEFabcdef" for c in text) and len(text) <= 2:
            val = int(text, 16)
        else:
            val = int(text, 10)
    except ValueError:
        raise argparse.ArgumentTypeError(f"Invalid nonce: '{value}'")
    if val < 0 or val > 255:
        raise argparse.ArgumentTypeError(f"Nonce must be 0..255, got {val}")
    return val


def read_ibuffer(buf: Any) -> bytes:
    if buf is None:
        return b""
    try:
        length = buf.length
        if length == 0:
            return b""
        reader = _streams.DataReader.from_buffer(buf)
        data = bytearray(length)
        reader.read_bytes(data)
        return bytes(data)
    except Exception:
        return b""


def _bytes_to_hex(data: bytes) -> str:
    return " ".join(f"{b:02X}" for b in data)


def fmt_status(s: Any) -> str:
    if s is None:
        return "NONE"
    try:
        return str(s).split(".")[-1]
    except Exception:
        return str(s)


# ---------------------------------------------------------------------------
# 扫描
# ---------------------------------------------------------------------------

async def scan_target(target_formatted: str, scan_timeout: float) -> dict[str, Any] | None:
    found = asyncio.Event()
    result: dict[str, Any] = {}

    def _on(sender: Any, args: BluetoothLEAdvertisementReceivedEventArgs) -> None:
        if format_address(args.bluetooth_address) != target_formatted:
            return
        try:
            rssi = args.raw_signal_strength_in_dbm
            if hasattr(rssi, "value"):
                rssi = rssi.value
        except Exception:
            rssi = None
        try:
            at = args.bluetooth_address_type
        except Exception:
            at = None
        result["address_int"] = args.bluetooth_address
        result["address_str"] = format_address(args.bluetooth_address)
        result["address_type"] = at
        result["local_name"] = args.advertisement.local_name or None
        result["rssi"] = rssi
        found.set()

    w = BluetoothLEAdvertisementWatcher()
    w.scanning_mode = BluetoothLEScanningMode.ACTIVE
    w.add_received(_on)
    try:
        w.start()
        try:
            await asyncio.wait_for(found.wait(), timeout=scan_timeout)
        except asyncio.TimeoutError:
            return None
    finally:
        try:
            w.stop()
        except Exception:
            pass
    return result


# ---------------------------------------------------------------------------
# 主逻辑
# ---------------------------------------------------------------------------

async def validate_stop(args: argparse.Namespace) -> int:
    suction_nonce = args.suction_nonce
    vibration_nonce = args.vibration_nonce

    # 生成停止帧
    suction_payload, vibration_payload = encode_stop(
        suction_nonce=suction_nonce,
        vibration_nonce=vibration_nonce,
    )

    print(f"Stop candidate payloads (from protocol.encode_stop):")
    print(f"  SUCTION_STOP_CANDIDATE   nonce=0x{suction_nonce:02X}:  "
          f"{format_hex_payload(suction_payload)}")
    print(f"  VIBRATION_STOP_CANDIDATE nonce=0x{vibration_nonce:02X}:  "
          f"{format_hex_payload(vibration_payload)}")
    print()

    target_int, target_formatted = args.address

    notification_log: list[dict[str, Any]] = []
    write_results: list[dict[str, Any]] = []

    device = None
    session = None
    session_token = None
    session_events: list[dict[str, Any]] = []
    ee03_char: Any = None
    ee02_char: Any = None
    vc_token = None

    # --- 扫描 ---
    print("[1] Scanning for target...")
    scan_info = await scan_target(target_formatted, args.scan_timeout)
    if scan_info is None:
        print(f"ERROR: Target not found.", file=sys.stderr)
        return 1
    print(f"     Found: {scan_info['local_name'] or '(unknown)'}  "
          f"RSSI={scan_info['rssi']} dBm  addr_type={scan_info['address_type']}")

    # --- 连接 ---
    print("[2] Creating BluetoothLEDevice...")
    at = scan_info.get("address_type")
    if at is not None:
        device = await asyncio.wait_for(
            BluetoothLEDevice.from_bluetooth_address_with_bluetooth_address_type_async(
                scan_info["address_int"], at
            ),
            timeout=args.operation_timeout,
        )
    else:
        device = await asyncio.wait_for(
            BluetoothLEDevice.from_bluetooth_address_async(scan_info["address_int"]),
            timeout=args.operation_timeout,
        )
    if device is None:
        print("ERROR: device is None.", file=sys.stderr)
        return 1
    print(f"     Device: name={device.name or '(unknown)'}")
    print(f"     initial conn_status: {fmt_status(device.connection_status)}")
    await asyncio.sleep(1.0)

    try:
        # --- GattSession ---
        print("[3] GattSession...")
        session = await asyncio.wait_for(
            GattSession.from_device_id_async(device.bluetooth_device_id),
            timeout=args.operation_timeout,
        )
        if session is None:
            print("ERROR: GattSession is None", file=sys.stderr)
            return 1
        print(f"     can_maintain_conn : {session.can_maintain_connection}")
        print(f"     initial status    : {fmt_status(session.session_status)}")
        try:
            print(f"     max_pdu_size      : {session.max_pdu_size}")
        except Exception:
            pass

        if not session.can_maintain_connection:
            print("ERROR: cannot maintain GATT session; cannot write.", file=sys.stderr)
            return 1

        # session 事件 handler
        def _on_session_changed(
            sender: Any, e: GattSessionStatusChangedEventArgs,
        ) -> None:
            entry = {
                "time": time.monotonic(),
                "status": fmt_status(e.status),
                "error": fmt_status(e.error) if e.error else "NONE",
            }
            session_events.append(entry)
            print(f"     [session] status={entry['status']}  error={entry['error']}",
                  file=sys.stderr)

        session_token = session.add_session_status_changed(_on_session_changed)

        # 设置 maintain_connection 并等待 ACTIVE
        session.maintain_connection = True
        print(f"     maintain_connection=True; waiting for ACTIVE...")
        t0 = time.monotonic()
        while (time.monotonic() - t0) < args.operation_timeout:
            if session.session_status == GattSessionStatus.ACTIVE:
                print(f"     Session ACTIVE after {(time.monotonic() - t0):.2f}s")
                break
            await asyncio.sleep(0.1)
        else:
            print("ERROR: GattSession did not reach ACTIVE.", file=sys.stderr)
            return 1

        # --- GATT ---
        print("[4] Enumerating GATT (UNCACHED)...")
        svc_r = await asyncio.wait_for(
            device.get_gatt_services_with_cache_mode_async(BluetoothCacheMode.UNCACHED),
            timeout=args.operation_timeout,
        )
        if svc_r.status != GattCommunicationStatus.SUCCESS:
            print(f"ERROR: GATT fail: {fmt_status(svc_r.status)}", file=sys.stderr)
            return 1

        # 定位 EE01
        ee01 = None
        for s in (svc_r.services or []):
            if str(s.uuid).lower() == EE01_SVC:
                ee01 = s
                break
        if ee01 is None:
            print("ERROR: EE01 not found.", file=sys.stderr)
            return 1
        print(f"     EE01: handle={ee01.attribute_handle}")

        # EE01 request_access_async
        print(f"     EE01 access before: {fmt_status(ee01.device_access_information.current_status)}")
        ra = await asyncio.wait_for(
            ee01.request_access_async(),
            timeout=10.0,
        )
        print(f"     RequestAccessAsync: {fmt_status(ra)}")
        if ra != DeviceAccessStatus.ALLOWED:
            print(f"ERROR: EE01 access not ALLOWED; aborting.", file=sys.stderr)
            return 1
        print(f"     Access: ALLOWED")

        # 获取 characteristics
        try:
            cr = ee01.get_characteristics_with_cache_mode_async(BluetoothCacheMode.UNCACHED)
        except AttributeError:
            cr = ee01.get_characteristics_async(None)
        cr = await asyncio.wait_for(cr, timeout=args.operation_timeout)
        if hasattr(cr, "status"):
            if cr.status != GattCommunicationStatus.SUCCESS:
                print(f"ERROR: chars fail: {fmt_status(cr.status)}", file=sys.stderr)
                return 1
            clist = cr.characteristics or []
        elif hasattr(cr, "characteristics"):
            clist = cr.characteristics or []
        else:
            clist = cr or []

        for ch in clist:
            u = str(ch.uuid).lower()
            if u == EE02_CH:
                ee02_char = ch
            elif u == EE03_CH:
                ee03_char = ch

        if ee02_char is None:
            print("ERROR: EE02 not found.", file=sys.stderr)
            return 1
        if ee03_char is None:
            print("ERROR: EE03 not found.", file=sys.stderr)
            return 1

        ee02_props = int(ee02_char.characteristic_properties)
        ee03_props = int(ee03_char.characteristic_properties)
        print(f"     EE02: handle={ee02_char.attribute_handle}  props=0x{ee02_props:04X}  "
              f"NOTIFY={'YES' if (ee02_props & 0x10) else 'NO'}")
        print(f"     EE03: handle={ee03_char.attribute_handle}  props=0x{ee03_props:04X}  "
              f"WRITE={'YES' if (ee03_props & 0x08) else 'NO'}")

        if not (ee02_props & 0x10):
            print("ERROR: EE02 lacks NOTIFY.", file=sys.stderr)
            return 1
        if not (ee03_props & 0x08):
            print("ERROR: EE03 lacks WRITE.", file=sys.stderr)
            return 1

        # --- 注册 EE02 handler ---
        _notify_start = time.monotonic()

        def _on_value_changed(sender: Any, event_args: Any) -> None:
            try:
                raw = read_ibuffer(event_args.characteristic_value)
            except Exception:
                raw = b""
            elapsed = time.monotonic() - _notify_start
            entry = {
                "elapsed": elapsed,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "length": len(raw),
                "hex": _bytes_to_hex(raw),
            }
            notification_log.append(entry)
            print(f"\n  [NOTIFY +{elapsed:.2f}s] {len(raw)}B: {entry['hex']}")

        vc_token = ee02_char.add_value_changed(_on_value_changed)

        # --- 启用 CCCD NOTIFY ---
        print("[5] Enabling CCCD NOTIFY...")
        cccd_r = await asyncio.wait_for(
            ee02_char.write_client_characteristic_configuration_descriptor_with_result_async(
                GattClientCharacteristicConfigurationDescriptorValue.NOTIFY
            ),
            timeout=args.operation_timeout,
        )
        cccd_enable_status = fmt_status(cccd_r.status)
        print(f"     CCCD enable: {cccd_enable_status}")

        if cccd_r.status != GattCommunicationStatus.SUCCESS:
            print(f"ERROR: CCCD enable FAILED ({cccd_enable_status}); not writing.",
                  file=sys.stderr)
            return 1

        # --- 基线等待 ---
        print("[6] Waiting 2s for baseline...")
        await asyncio.sleep(2.0)
        baseline_count = len(notification_log)
        print(f"     Baseline notifications: {baseline_count}")

        # --- 写入前断言 ---
        print(f"\n[7] Pre-write assertions...")
        mps = session.max_pdu_size
        print(f"     connection_status : {fmt_status(device.connection_status)}")
        print(f"     session_status    : {fmt_status(session.session_status)}")
        print(f"     EE03 properties   : 0x{ee03_props:04X}")
        print(f"     EE03 prot_level   : {fmt_status(ee03_char.protection_level)}")
        print(f"     max_pdu_size      : {mps}")
        print(f"     payload length    : {len(suction_payload)} (max: {mps - 3})")

        pre_checks_ok = True
        if device.connection_status != 1:
            print("ASSERT FAIL: connection_status != CONNECTED", file=sys.stderr)
            pre_checks_ok = False
        if session.session_status != GattSessionStatus.ACTIVE:
            print("ASSERT FAIL: session_status != ACTIVE", file=sys.stderr)
            pre_checks_ok = False
        if not (ee03_props & 0x08):
            print("ASSERT FAIL: EE03 lacks WRITE", file=sys.stderr)
            pre_checks_ok = False
        try:
            if int(ee03_char.protection_level) != 0:
                print("ASSERT FAIL: EE03 protection_level != 0", file=sys.stderr)
                pre_checks_ok = False
        except Exception:
            pass
        if len(suction_payload) > mps - 3:
            print("ASSERT FAIL: payload exceeds max_pdu_size - 3", file=sys.stderr)
            pre_checks_ok = False
        if suction_payload != bytes.fromhex("A10100020007110000081104"):
            print("ASSERT FAIL: suction payload mismatch", file=sys.stderr)
            pre_checks_ok = False
        if vibration_payload != bytes.fromhex("A20100020001110000021101"):
            print("ASSERT FAIL: vibration payload mismatch", file=sys.stderr)
            pre_checks_ok = False

        if not pre_checks_ok:
            print("ERROR: Pre-write assertions FAILED. Not writing.", file=sys.stderr)
            return 1
        print(f"     All assertions PASSED.")

        # --- 写入第一帧 (SUCTION STOP) ---
        _write_start = time.monotonic()

        print(f"\n[8] EE03 WRITE #1 — SUCTION_STOP_CANDIDATE")
        print(f"     Payload: {format_hex_payload(suction_payload)}")
        t1 = time.monotonic()
        try:
            wr1 = await asyncio.wait_for(
                ee03_char.write_value_with_result_and_option_async(
                    suction_payload,
                    GattWriteOption.WRITE_WITH_RESPONSE,
                ),
                timeout=args.operation_timeout,
            )
        except Exception as exc:
            print(f"ERROR: write #1 exception: {type(exc).__name__}: {exc}", file=sys.stderr)
            write_results.append({
                "frame": "SUCTION_STOP_CANDIDATE",
                "nonce": f"0x{suction_nonce:02X}",
                "status": f"EXCEPTION: {exc}",
                "protocol_error": None,
                "elapsed_ms": (time.monotonic() - t1) * 1000,
            })
            return 1
        elapsed_ms = (time.monotonic() - t1) * 1000
        w1_status = fmt_status(wr1.status)
        w1_proto = fmt_status(wr1.protocol_error) if hasattr(wr1, "protocol_error") else "N/A"
        write_results.append({
            "frame": "SUCTION_STOP_CANDIDATE",
            "nonce": f"0x{suction_nonce:02X}",
            "status": w1_status,
            "protocol_error": w1_proto,
            "elapsed_ms": elapsed_ms,
        })
        print(f"     Status: {w1_status}  protocol_error: {w1_proto}  "
              f"time: {elapsed_ms:.0f}ms")
        after_w1 = len(notification_log)

        if wr1.status != GattCommunicationStatus.SUCCESS:
            print(f"ERROR: WRITE #1 FAILED. Aborting second write.", file=sys.stderr)
            return 1

        # --- 等待 ---
        print(f"\n     Waiting 2s...")
        await asyncio.sleep(2.0)
        after_w1_wait = len(notification_log)
        print(f"     Notifications after write #1: {after_w1_wait - after_w1}")

        # --- 写入第二帧 (VIBRATION STOP) ---
        print(f"\n[9] EE03 WRITE #2 — VIBRATION_STOP_CANDIDATE")
        print(f"     Payload: {format_hex_payload(vibration_payload)}")
        t2 = time.monotonic()
        try:
            wr2 = await asyncio.wait_for(
                ee03_char.write_value_with_result_and_option_async(
                    vibration_payload,
                    GattWriteOption.WRITE_WITH_RESPONSE,
                ),
                timeout=args.operation_timeout,
            )
        except Exception as exc:
            print(f"ERROR: write #2 exception: {type(exc).__name__}: {exc}", file=sys.stderr)
            write_results.append({
                "frame": "VIBRATION_STOP_CANDIDATE",
                "nonce": f"0x{vibration_nonce:02X}",
                "status": f"EXCEPTION: {exc}",
                "protocol_error": None,
                "elapsed_ms": (time.monotonic() - t2) * 1000,
            })
            return 1
        elapsed_ms2 = (time.monotonic() - t2) * 1000
        w2_status = fmt_status(wr2.status)
        w2_proto = fmt_status(wr2.protocol_error) if hasattr(wr2, "protocol_error") else "N/A"
        write_results.append({
            "frame": "VIBRATION_STOP_CANDIDATE",
            "nonce": f"0x{vibration_nonce:02X}",
            "status": w2_status,
            "protocol_error": w2_proto,
            "elapsed_ms": elapsed_ms2,
        })
        print(f"     Status: {w2_status}  protocol_error: {w2_proto}  "
              f"time: {elapsed_ms2:.0f}ms")
        after_w2 = len(notification_log)

        if wr2.status != GattCommunicationStatus.SUCCESS:
            print(f"ERROR: WRITE #2 FAILED.", file=sys.stderr)
            return 1

        # --- 等待通知 ---
        print(f"\n     Waiting 5s for notifications...")
        await asyncio.sleep(5.0)
        final_count = len(notification_log)
        print(f"     Post-write notifications: {final_count - after_w2}")

    finally:
        # --- 清理 ---
        print(f"\n[10] Cleanup...", file=sys.stderr)

        if ee02_char is not None:
            try:
                cccd_off = await asyncio.wait_for(
                    ee02_char.write_client_characteristic_configuration_descriptor_with_result_async(
                        GattClientCharacteristicConfigurationDescriptorValue.NONE
                    ),
                    timeout=10.0,
                )
                print(f"     CCCD disable: {fmt_status(cccd_off.status)}", file=sys.stderr)
            except Exception as exc:
                print(f"     CCCD disable FAILED: {exc}", file=sys.stderr)

            if vc_token is not None:
                try:
                    ee02_char.remove_value_changed(vc_token)
                    print(f"     handler removed", file=sys.stderr)
                except Exception as exc:
                    print(f"     WARNING: remove handler: {exc}", file=sys.stderr)

        if session is not None:
            if session_token is not None:
                try:
                    session.remove_session_status_changed(session_token)
                except Exception:
                    pass
            try:
                if session.can_maintain_connection:
                    session.maintain_connection = False
            except Exception:
                pass
            try:
                session.close()
                print(f"     GattSession closed", file=sys.stderr)
            except Exception as exc:
                print(f"     WARNING: session.close: {exc}", file=sys.stderr)

        if device is not None:
            try:
                device.close()
                print(f"     device closed", file=sys.stderr)
            except Exception as exc:
                print(f"     WARNING: device.close: {exc}", file=sys.stderr)

    # --- 汇总 ---
    print(f"\n{'='*60}")
    print(f"  Stop Candidate Validation — Summary")
    print(f"{'='*60}")
    print(f"  Payloads:")
    print(f"    SUCTION_STOP_CANDIDATE:   {format_hex_payload(suction_payload)}")
    print(f"    VIBRATION_STOP_CANDIDATE: {format_hex_payload(vibration_payload)}")
    print()
    for wr in write_results:
        print(f"  {wr['frame']}:")
        print(f"    Status          : {wr['status']}")
        print(f"    Protocol Error  : {wr['protocol_error']}")
        print(f"    Time            : {wr['elapsed_ms']:.0f}ms")
    print()
    print(f"  EE03 writes       : {len(write_results)}")
    print(f"  EE02 notifications: {len(notification_log)}")
    if notification_log:
        for i, n in enumerate(notification_log, 1):
            print(f"    [{n['elapsed']:.2f}s] {n['length']}B: {n['hex']}")
    print(f"  Non-zero intensity: NO")
    print(f"  AE01 written      : NO")
    print(f"  Retries           : NO")
    print(f"  Characteristic read: NO")
    print(f"  Paired            : NO")
    print(f"  Resources released: YES")
    print(f"{'='*60}")

    if all(wr["status"] == "0" for wr in write_results):
        print(f"\nCONCLUSION: A — Both candidate frames accepted by ATT/GATT.")
        print(f"IMPORTANT: ATT/GATT acceptance only. Stop action NOT confirmed.")
    elif write_results[0]["status"] == "0" and write_results[1]["status"] != "0":
        print(f"\nCONCLUSION: B — First accepted, second failed.")
    elif write_results[0]["status"] != "0":
        print(f"\nCONCLUSION: C — First failed, second not attempted.")
    else:
        print(f"\nCONCLUSION: D/E — Unexpected result.")

    return 0


async def main_async(args: argparse.Namespace) -> int:
    return await validate_stop(args)


def main() -> None:
    parser = argparse.ArgumentParser(description="教程停止候选帧验证")
    parser.add_argument("--address", required=True, type=_address_type, metavar="ADDRESS")
    parser.add_argument("--suction-nonce", required=True, type=validate_nonce, metavar="NONCE")
    parser.add_argument("--vibration-nonce", required=True, type=validate_nonce, metavar="NONCE")
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
        sys.exit(1)
    else:
        sys.exit(ec)


if __name__ == "__main__":
    main()
