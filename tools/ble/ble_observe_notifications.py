#!/usr/bin/env python3
"""
被动通知观察工具 — EE02 只订阅不控制。

使用 Windows 原生 WinRT 连接 SOSEXY，订阅 EE02 NOTIFY，
在指定时间内观察通知。不向 EE03/AE01 写入任何控制 payload。

唯一 GATT 写入：CCCD (NOTIFY / NONE)。
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
    BluetoothAddressType,
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
    GattDeviceService,
    GattValueChangedEventArgs,
)

# ---------------------------------------------------------------------------
# 常量
# ---------------------------------------------------------------------------

EE01_SERVICE_UUID = "0000ee01-0000-1000-8000-00805f9b34fb"
EE02_CHAR_UUID = "0000ee02-0000-1000-8000-00805f9b34fb"

# ---------------------------------------------------------------------------
# 工具函数
# ---------------------------------------------------------------------------

def parse_address(raw: str) -> tuple[int, str]:
    cleaned = raw.strip().replace("-", ":").upper()
    parts = cleaned.split(":")
    if len(parts) != 6:
        raise argparse.ArgumentTypeError(f"Address must be 6 colon-separated hex bytes")
    try:
        byte_vals = [int(p, 16) for p in parts]
    except ValueError:
        raise argparse.ArgumentTypeError(f"Invalid hex in address: '{raw}'")
    for b in byte_vals:
        if not (0 <= b <= 255):
            raise argparse.ArgumentTypeError(f"Byte out of range in: '{raw}'")
    formatted = ":".join(f"{b:02X}" for b in byte_vals)
    value = 0
    for b in byte_vals:
        value = (value << 8) | b
    return value, formatted


def _address_type(raw: str) -> tuple[int, str]:
    return parse_address(raw)


def format_address(value: int) -> str:
    raw = f"{value:012X}"
    return ":".join(raw[i:i + 2] for i in range(0, 12, 2))


def validate_timeout(value: str, name: str, lo: float, hi: float) -> float:
    try:
        val = float(value)
    except (TypeError, ValueError):
        raise argparse.ArgumentTypeError(f"--{name} must be a number")
    if val < lo or val > hi:
        raise argparse.ArgumentTypeError(f"--{name} must be {lo}..{hi}")
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


def fmt_gatt_status(status: Any) -> str:
    if status is None:
        return "NONE"
    try:
        return str(status).split(".")[-1]
    except Exception:
        return str(status)


# ---------------------------------------------------------------------------
# 尝试导入 protocol.py 以标注通知内容
# ---------------------------------------------------------------------------

try:
    import os as _os
    _tools_dir = _os.path.join(_os.path.dirname(__file__))
    if _tools_dir not in sys.path:
        sys.path.insert(0, _tools_dir)
    from protocol import (  # type: ignore[import-not-found]
        PAYLOAD_LENGTH,
        decode_frame,
        format_hex_payload as fmt_payload,
        get_field_descriptions,
    )
    _HAS_PROTOCOL = True
except Exception:
    _HAS_PROTOCOL = False


def annotate_payload(data: bytes) -> list[str]:
    """用 protocol.py 标注 payload，失败时返回空。"""
    if not _HAS_PROTOCOL:
        return []
    notes: list[str] = []
    if len(data) == PAYLOAD_LENGTH:
        try:
            cmd = decode_frame(data)
            notes.append(f"TUTORIAL_SHAPE_MATCH: {cmd.description}")
            notes.append(f"  func_id=0x{cmd.func_id:02X} intensity={cmd.intensity} nonce=0x{cmd.nonce:02X}")
        except Exception:
            notes.append("TUTORIAL_SHAPE_MATCH: UNKNOWN (12-byte but unrecognized fields)")
    return notes


# ---------------------------------------------------------------------------
# 扫描
# ---------------------------------------------------------------------------

async def scan_target(target_formatted: str, scan_timeout: float) -> dict[str, Any] | None:
    found = asyncio.Event()
    result: dict[str, Any] = {}

    def _on_recv(sender: Any, args: BluetoothLEAdvertisementReceivedEventArgs) -> None:
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

    watcher = BluetoothLEAdvertisementWatcher()
    watcher.scanning_mode = BluetoothLEScanningMode.ACTIVE
    watcher.add_received(_on_recv)
    try:
        watcher.start()
        try:
            await asyncio.wait_for(found.wait(), timeout=scan_timeout)
        except asyncio.TimeoutError:
            return None
    finally:
        try:
            watcher.stop()
        except Exception:
            pass
    return result


# ---------------------------------------------------------------------------
# 主逻辑
# ---------------------------------------------------------------------------

async def observe(target_int: int, address_type_val: Any, args: argparse.Namespace) -> int:
    """执行完整的连接 → 订阅 → 观察 → 清理流程。"""

    notifications: list[dict[str, Any]] = []
    cccd_enable_time: str | None = None
    cccd_enable_status: str = "NOT_ATTEMPTED"
    cccd_disable_time: str | None = None
    cccd_disable_status: str = "NOT_ATTEMPTED"
    value_changed_token = None
    ee02_char: Any = None
    device: Any = None

    # --- 连接 ---
    print(f"Creating BluetoothLEDevice...", file=sys.stderr)
    if address_type_val is not None:
        device = await asyncio.wait_for(
            BluetoothLEDevice.from_bluetooth_address_with_bluetooth_address_type_async(
                target_int, address_type_val
            ),
            timeout=args.operation_timeout,
        )
    else:
        device = await asyncio.wait_for(
            BluetoothLEDevice.from_bluetooth_address_async(target_int),
            timeout=args.operation_timeout,
        )

    if device is None:
        print("ERROR: BluetoothLEDevice returned None", file=sys.stderr)
        return 1

    print(f"  Device: name={device.name or '(unknown)'}  "
          f"addr_type={device.bluetooth_address_type}", file=sys.stderr)
    await asyncio.sleep(1.0)

    try:
        # --- GATT Services ---
        print(f"Requesting GATT services (UNCACHED)...", file=sys.stderr)
        svc_result = await asyncio.wait_for(
            device.get_gatt_services_with_cache_mode_async(BluetoothCacheMode.UNCACHED),
            timeout=args.operation_timeout,
        )

        svc_status = svc_result.status
        print(f"  GATT status: {fmt_gatt_status(svc_status)}", file=sys.stderr)

        if svc_status != GattCommunicationStatus.SUCCESS:
            print(f"ERROR: GATT service enumeration failed: {fmt_gatt_status(svc_status)}",
                  file=sys.stderr)
            return 1

        services = svc_result.services or []

        # 找 EE01
        ee01_svc: Any = None
        for svc in services:
            if str(svc.uuid).lower() == EE01_SERVICE_UUID:
                ee01_svc = svc
                break

        if ee01_svc is None:
            print(f"ERROR: EE01 service not found", file=sys.stderr)
            return 1

        print(f"  EE01 service found: handle={ee01_svc.attribute_handle}", file=sys.stderr)

        # 获取 Characteristics
        try:
            chars_result = ee01_svc.get_characteristics_with_cache_mode_async(
                BluetoothCacheMode.UNCACHED
            )
        except AttributeError:
            chars_result = ee01_svc.get_characteristics_async(None)

        chars = await asyncio.wait_for(chars_result, timeout=args.operation_timeout)
        if hasattr(chars, "status"):
            if chars.status != GattCommunicationStatus.SUCCESS:
                print(f"ERROR: Characteristic enum failed: {fmt_gatt_status(chars.status)}",
                      file=sys.stderr)
                return 1
            char_list = chars.characteristics or []
        elif hasattr(chars, "characteristics"):
            char_list = chars.characteristics or []
        else:
            char_list = chars or []

        # 找 EE02
        for ch in char_list:
            if str(ch.uuid).lower() == EE02_CHAR_UUID:
                ee02_char = ch
                break

        if ee02_char is None:
            print(f"ERROR: EE02 characteristic not found in EE01", file=sys.stderr)
            return 1

        props = int(ee02_char.characteristic_properties)
        has_notify = (props & 0x10) != 0
        print(f"  EE02 found: handle={ee02_char.attribute_handle}  "
              f"properties=0x{props:04X}  NOTIFY={'YES' if has_notify else 'NO'}",
              file=sys.stderr)

        if not has_notify:
            print(f"ERROR: EE02 does not support NOTIFY", file=sys.stderr)
            return 1

        # 观察开始时间（在 handler 之前定义，供 nonlocal 引用）
        _observe_start = 0.0  # 占位，CCCD 启用后更新

        # --- 注册 value_changed handler ---
        def _on_value_changed(sender: Any, event_args: GattValueChangedEventArgs) -> None:
            nonlocal _observe_start
            try:
                ts = event_args.timestamp
                raw = read_ibuffer(event_args.characteristic_value)
            except Exception:
                raw = b""
            elapsed = time.monotonic() - _observe_start
            entry = {
                "elapsed": elapsed,
                "timestamp": str(ts) if ts else "N/A",
                "length": len(raw),
                "payload": raw,
                "hex": _bytes_to_hex(raw),
            }
            # 与上一条比较
            if notifications:
                prev = notifications[-1]["payload"]
                diffs: list[dict[str, Any]] = []
                min_len = min(len(prev), len(raw))
                for i in range(min_len):
                    if prev[i] != raw[i]:
                        diffs.append({"offset": i, "prev": prev[i], "curr": raw[i]})
                if len(prev) != len(raw):
                    diffs.append({"offset": "length", "prev": len(prev), "curr": len(raw)})
                entry["diffs"] = diffs
            else:
                entry["diffs"] = []
            notifications.append(entry)

            print(f"\n[{elapsed:5.1f}s] Notification #{len(notifications)}", flush=True)
            print(f"  Timestamp     : {entry['timestamp']}", flush=True)
            print(f"  Char UUID     : {EE02_CHAR_UUID}", flush=True)
            print(f"  Payload len   : {entry['length']} bytes", flush=True)
            print(f"  Hex           : {entry['hex']}", flush=True)
            if entry["diffs"]:
                print(f"  vs previous   :", flush=True)
                for d in entry["diffs"]:
                    print(f"    offset {str(d['offset']):>6}:  prev=0x{d['prev']:02X}  curr=0x{d['curr']:02X}",
                          flush=True)
            else:
                print(f"  vs previous   : IDENTICAL", flush=True)
            notes = annotate_payload(raw)
            for n in notes:
                print(f"  {n}", flush=True)

        value_changed_token = ee02_char.add_value_changed(_on_value_changed)
        print(f"  value_changed handler registered", file=sys.stderr)

        # --- 启用 CCCD NOTIFY ---
        print(f"  Enabling CCCD NOTIFY...", file=sys.stderr)
        try:
            cccd_result = await asyncio.wait_for(
                ee02_char.write_client_characteristic_configuration_descriptor_with_result_async(
                    GattClientCharacteristicConfigurationDescriptorValue.NOTIFY
                ),
                timeout=args.operation_timeout,
            )
            cccd_enable_time = datetime.now(timezone.utc).isoformat()
            cccd_enable_status = fmt_gatt_status(cccd_result.status)
            print(f"  CCCD enable: {cccd_enable_status}  at {cccd_enable_time}", file=sys.stderr)
            if cccd_result.status != GattCommunicationStatus.SUCCESS:
                print(f"  WARNING: CCCD enable returned non-success", file=sys.stderr)
        except Exception as exc:
            cccd_enable_status = f"EXCEPTION: {exc}"
            print(f"  ERROR enabling CCCD: {exc}", file=sys.stderr)
            return 1

        # --- 观察阶段 ---
        _observe_start = time.monotonic()

        duration = args.duration
        p1 = duration / 3
        p2 = 2 * duration / 3

        print(f"\n{'='*60}", flush=True)
        print(f"  Notification Observation — {duration:.0f}s", flush=True)
        print(f"  [0s]    Baseline: DO NOT operate the device", flush=True)

        await asyncio.sleep(p1)

        print(f"\n  [{p1:.0f}s]   Physical-action window: press button ONCE now", flush=True)

        await asyncio.sleep(p2 - p1)

        print(f"\n  [{p2:.0f}s]   Baseline: DO NOT operate the device", flush=True)

        await asyncio.sleep(duration - p2)

        print(f"\n  [{duration:.0f}s]   Observation complete", flush=True)
        print(f"{'='*60}\n", flush=True)

    finally:
        # --- 清理 ---
        print(f"\n[cleanup] Releasing resources...", file=sys.stderr)

        # 1. 禁用 CCCD
        if ee02_char is not None:
            try:
                cccd_disable = await asyncio.wait_for(
                    ee02_char.write_client_characteristic_configuration_descriptor_with_result_async(
                        GattClientCharacteristicConfigurationDescriptorValue.NONE
                    ),
                    timeout=10.0,
                )
                cccd_disable_time = datetime.now(timezone.utc).isoformat()
                cccd_disable_status = fmt_gatt_status(cccd_disable.status)
                print(f"  CCCD disable: {cccd_disable_status}", file=sys.stderr)
            except Exception as exc:
                cccd_disable_status = f"EXCEPTION: {exc}"
                print(f"  CCCD disable FAILED: {exc}", file=sys.stderr)

            # 2. 移除 value_changed handler
            if value_changed_token is not None:
                try:
                    ee02_char.remove_value_changed(value_changed_token)
                    print(f"  value_changed handler removed", file=sys.stderr)
                except Exception as exc:
                    print(f"  WARNING: remove_value_changed failed: {exc}", file=sys.stderr)

        # 3. 关闭设备
        if device is not None:
            try:
                device.close()
                print(f"  BluetoothLEDevice closed", file=sys.stderr)
            except Exception as exc:
                print(f"  WARNING: device.close failed: {exc}", file=sys.stderr)

    # --- 汇总 ---
    print(f"\n{'='*60}")
    print(f"  Observation Summary")
    print(f"{'='*60}")
    print(f"  Duration          : {duration:.0f}s")
    print(f"  CCCD enable       : {cccd_enable_status}  at {cccd_enable_time}")
    print(f"  CCCD disable      : {cccd_disable_status}  at {cccd_disable_time}")
    print(f"  Total notifications: {len(notifications)}")

    baseline_1 = [n for n in notifications if n["elapsed"] <= p1]
    action_window = [n for n in notifications if p1 < n["elapsed"] <= p2]
    baseline_2 = [n for n in notifications if n["elapsed"] > p2]

    print(f"  Baseline 0..{p1:.0f}s       : {len(baseline_1)} notification(s)")
    print(f"  Action {p1:.0f}..{p2:.0f}s         : {len(action_window)} notification(s)")
    print(f"  Baseline {p2:.0f}..{duration:.0f}s      : {len(baseline_2)} notification(s)")

    # 重复帧检测
    seen_hex: set[str] = set()
    repeat_count = 0
    for n in notifications:
        h = n["hex"]
        if h in seen_hex:
            repeat_count += 1
        else:
            seen_hex.add(h)
    print(f"  Unique payloads   : {len(seen_hex)}")
    print(f"  Repeated payloads : {repeat_count}")

    if notifications:
        print(f"\n  All notification payloads:")
        for i, n in enumerate(notifications, 1):
            marker = " (repeat)" if i > 1 and notifications[i-2]["hex"] == n["hex"] else ""
            print(f"    [{n['elapsed']:5.1f}s] #{i}: "
                  f"{n['length']}B  {n['hex']}{marker}")

    print(f"\n  Resources released.")
    print(f"{'='*60}")

    return 0


async def main_async(args: argparse.Namespace) -> int:
    target_int, target_formatted = args.address

    print(f"Target: {target_formatted}", file=sys.stderr)
    print(f"Scan timeout: {args.scan_timeout}s  Observe: {args.duration}s  "
          f"Op timeout: {args.operation_timeout}s", file=sys.stderr)

    # 扫描
    print(f"Scanning for target...", file=sys.stderr)
    scan_info = await scan_target(target_formatted, args.scan_timeout)
    if scan_info is None:
        print(f"ERROR: Target {target_formatted} not found.", file=sys.stderr)
        return 1

    print(f"  Found: {scan_info['local_name'] or '(unknown)'}  "
          f"RSSI={scan_info['rssi']} dBm  addr_type={scan_info['address_type']}",
          file=sys.stderr)

    return await observe(scan_info["address_int"], scan_info.get("address_type"), args)


def main() -> None:
    parser = argparse.ArgumentParser(description="被动 BLE 通知观察工具 (EE02 只订阅)")
    parser.add_argument("--address", required=True, type=_address_type, metavar="ADDRESS")
    parser.add_argument("--duration", type=lambda v: validate_timeout(v, "duration", 5, 120),
                        default=30.0, help="观察时长，默认 30 秒 (5-120)")
    parser.add_argument("--scan-timeout", type=lambda v: validate_timeout(v, "scan-timeout", 1, 60),
                        default=15.0, help="扫描超时，默认 15 秒 (1-60)")
    parser.add_argument("--operation-timeout", type=lambda v: validate_timeout(v, "operation-timeout", 5, 60),
                        default=30.0, help="GATT 操作超时，默认 30 秒 (5-60)")
    args = parser.parse_args()

    try:
        exit_code = asyncio.run(main_async(args))
    except KeyboardInterrupt:
        print("\nInterrupted (Ctrl+C).", file=sys.stderr)
        sys.exit(130)
    except Exception as exc:
        print(f"Fatal: {type(exc).__name__}: {exc}", file=sys.stderr)
        sys.exit(1)
    else:
        sys.exit(exit_code)


if __name__ == "__main__":
    main()
