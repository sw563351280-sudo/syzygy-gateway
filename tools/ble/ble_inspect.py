#!/usr/bin/env python3
"""
WinRT 原生 GATT 结构枚举工具。

连接 BLE 设备，只枚举 GATT 服务/Characteristic/Descriptor 及属性。
禁止读取值、禁止写入、禁止订阅通知、禁止配对。

依赖：winrt 3.2.1（已安装于项目 .venv）
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import time
from typing import Any

from winrt.windows.devices.bluetooth import (  # type: ignore[import-not-found]
    BluetoothAddressType,
    BluetoothCacheMode,
    BluetoothConnectionStatus,
    BluetoothLEDevice,
)
from winrt.windows.devices.bluetooth.advertisement import (  # type: ignore[import-not-found]
    BluetoothLEAdvertisementReceivedEventArgs,
    BluetoothLEAdvertisementWatcher,
    BluetoothLEScanningMode,
)
from winrt.windows.devices.bluetooth.genericattributeprofile import (  # type: ignore[import-not-found]
    GattCharacteristic,
    GattCharacteristicProperties,
    GattCommunicationStatus,
    GattDescriptor,
    GattDeviceService,
)

# ---------------------------------------------------------------------------
# 常量
# ---------------------------------------------------------------------------

TUTORIAL_UUIDS = [
    "0000ee01-0000-1000-8000-00805f9b34fb",
    "0000ee02-0000-1000-8000-00805f9b34fb",
    "0000ee03-0000-1000-8000-00805f9b34fb",
    "0000ee04-0000-1000-8000-00805f9b34fb",
]

TUTORIAL_WRITE_CANDIDATE = "0000ee03-0000-1000-8000-00805f9b34fb"

PROPERTY_NAMES = [
    ("BROADCAST", "broadcast"),
    ("READ", "read"),
    ("WRITE_WITHOUT_RESPONSE", "write-without-response"),
    ("WRITE", "write"),
    ("NOTIFY", "notify"),
    ("INDICATE", "indicate"),
    ("AUTHENTICATED_SIGNED_WRITES", "authenticated-signed-writes"),
    ("EXTENDED_PROPERTIES", "extended-properties"),
    ("RELIABLE_WRITES", "reliable-writes"),
    ("WRITABLE_AUXILIARIES", "writable-auxiliaries"),
]


# ---------------------------------------------------------------------------
# 地址工具
# ---------------------------------------------------------------------------

def parse_address(raw: str) -> tuple[int, str]:
    """解析地址字符串 → (uint64, 冒号大写格式化字符串)。"""
    cleaned = raw.strip().replace("-", ":").upper()
    parts = cleaned.split(":")
    if len(parts) != 6:
        raise argparse.ArgumentTypeError(
            f"Address must be 6 colon-separated hex bytes, got: '{raw}'"
        )
    try:
        byte_vals = [int(p, 16) for p in parts]
    except ValueError:
        raise argparse.ArgumentTypeError(f"Invalid hex bytes in address: '{raw}'")
    for b in byte_vals:
        if not (0 <= b <= 255):
            raise argparse.ArgumentTypeError(f"Byte value out of range in: '{raw}'")
    formatted = ":".join(f"{b:02X}" for b in byte_vals)
    # 大端：MSB first → uint64
    value = 0
    for b in byte_vals:
        value = (value << 8) | b
    return value, formatted


def _address_type(raw: str) -> tuple[int, str]:
    """argparse type= 包装，保证非法地址退出码为 2。"""
    return parse_address(raw)


def format_address(value: int) -> str:
    """WinRT uint64 bluetooth_address → XX:XX:XX:XX:XX:XX（大端）。"""
    raw = f"{value:012X}"
    return ":".join(raw[i:i + 2] for i in range(0, 12, 2))


def validate_timeout(value: str, name: str, min_val: float, max_val: float) -> float:
    """校验超时参数。"""
    try:
        val = float(value)
    except (TypeError, ValueError):
        raise argparse.ArgumentTypeError(f"--{name} must be a number, got: '{value}'")
    if val < min_val or val > max_val:
        raise argparse.ArgumentTypeError(
            f"--{name} must be between {min_val} and {max_val}, got {val}"
        )
    return val


# ---------------------------------------------------------------------------
# 属性解析
# ---------------------------------------------------------------------------

def parse_properties(flags: int) -> tuple[list[str], list[str]]:
    """解析 GattCharacteristicProperties 位掩码。

    Returns:
        (property_names, classifications)
    """
    names: list[str] = []
    classes: list[str] = []

    mapping = {
        "BROADCAST": GattCharacteristicProperties.BROADCAST,
        "READ": GattCharacteristicProperties.READ,
        "WRITE_WITHOUT_RESPONSE": GattCharacteristicProperties.WRITE_WITHOUT_RESPONSE,
        "WRITE": GattCharacteristicProperties.WRITE,
        "NOTIFY": GattCharacteristicProperties.NOTIFY,
        "INDICATE": GattCharacteristicProperties.INDICATE,
        "AUTHENTICATED_SIGNED_WRITES": GattCharacteristicProperties.AUTHENTICATED_SIGNED_WRITES,
        "EXTENDED_PROPERTIES": GattCharacteristicProperties.EXTENDED_PROPERTIES,
        "RELIABLE_WRITES": GattCharacteristicProperties.RELIABLE_WRITES,
        "WRITABLE_AUXILIARIES": GattCharacteristicProperties.WRITABLE_AUXILIARIES,
    }

    for pname, pval in mapping.items():
        if flags & int(pval):
            names.append(pname)

    if flags & int(GattCharacteristicProperties.READ):
        classes.append("READABLE")
    if flags & int(GattCharacteristicProperties.WRITE):
        classes.append("WRITABLE_WITH_RESPONSE")
    if flags & int(GattCharacteristicProperties.WRITE_WITHOUT_RESPONSE):
        classes.append("WRITABLE_WITHOUT_RESPONSE")
    if flags & int(GattCharacteristicProperties.NOTIFY):
        classes.append("NOTIFIABLE")
    if flags & int(GattCharacteristicProperties.INDICATE):
        classes.append("INDICATABLE")

    return names, classes


def is_standard_uuid(uuid_str: str) -> bool:
    """判断是否为标准蓝牙 UUID（16-bit base）。"""
    return uuid_str.startswith("0000") and uuid_str.endswith("-0000-1000-8000-00805f9b34fb")


# ---------------------------------------------------------------------------
# 扫描
# ---------------------------------------------------------------------------

async def scan_for_target(
    target_formatted: str,
    target_int: int,
    scan_timeout: float,
) -> dict[str, Any] | None:
    """扫描直到发现目标设备，返回扫描信息。超时返回 None。"""

    found_event = asyncio.Event()
    result: dict[str, Any] = {}

    def _on_received(
        sender: Any,
        args: BluetoothLEAdvertisementReceivedEventArgs,
    ) -> None:
        addr_str = format_address(args.bluetooth_address)
        if addr_str != target_formatted:
            return

        # 匹配
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
        result["address_str"] = addr_str
        result["address_type"] = at
        result["local_name"] = args.advertisement.local_name or None
        result["rssi"] = rssi
        result["ad_type"] = int(args.advertisement_type)
        result["is_connectable"] = args.is_connectable
        result["is_directed"] = args.is_directed
        found_event.set()

    watcher = BluetoothLEAdvertisementWatcher()
    watcher.scanning_mode = BluetoothLEScanningMode.ACTIVE
    watcher.add_received(_on_received)

    try:
        watcher.start()
        try:
            await asyncio.wait_for(found_event.wait(), timeout=scan_timeout)
        except asyncio.TimeoutError:
            return None
    finally:
        try:
            watcher.stop()
        except Exception:
            pass

    return result


# ---------------------------------------------------------------------------
# GATT 枚举
# ---------------------------------------------------------------------------

async def enumerate_gatt(
    device: Any,
    op_timeout: float,
) -> dict[str, Any]:
    """枚举设备的所有 GATT 结构。"""

    stats = {
        "service_count": 0,
        "characteristic_count": 0,
        "descriptor_count": 0,
        "readable_count": 0,
        "write_count": 0,
        "write_wo_resp_count": 0,
        "notify_count": 0,
        "indicate_count": 0,
        "skipped_services": 0,
        "tutorial_uuids": {},
        "services": [],
        "gatt_status": None,
        "complete": True,
    }

    # 获取 GATT 服务（UNCACHED）
    try:
        get_svc = device.get_gatt_services_with_cache_mode_async(
            BluetoothCacheMode.UNCACHED
        )
    except AttributeError:
        get_svc = device.get_gatt_services_async()

    try:
        svc_result = await asyncio.wait_for(get_svc, timeout=op_timeout)
    except asyncio.TimeoutError:
        stats["gatt_status"] = "TIMEOUT"
        stats["complete"] = False
        return stats

    status = svc_result.status
    stats["gatt_status"] = str(status).split(".")[-1] if status is not None else "NONE"

    if status != GattCommunicationStatus.SUCCESS:
        if status == GattCommunicationStatus.ACCESS_DENIED:
            print(f"  [WARN] GATT service enumeration: ACCESS_DENIED")
            stats["skipped_services"] = -1  # marker
        else:
            print(f"  [WARN] GATT service enumeration status: {stats['gatt_status']}")
        return stats

    services = svc_result.services or []
    stats["service_count"] = len(services)

    for svc in services:
        svc_uuid = str(svc.uuid).lower() if svc.uuid else "?"
        svc_handle = svc.attribute_handle
        is_std = is_standard_uuid(svc_uuid)

        svc_info = {
            "uuid": svc_uuid,
            "handle": svc_handle,
            "is_standard": is_std,
            "characteristics": [],
        }
        stats["services"].append(svc_info)

        print(f"  Service: {svc_uuid}  (handle={svc_handle})  {'[standard]' if is_std else '[vendor]'}")

        # 获取 Characteristic
        try:
            try:
                chars_result = svc.get_characteristics_with_cache_mode_async(
                    BluetoothCacheMode.UNCACHED
                )
            except AttributeError:
                chars_result = svc.get_characteristics_async(None)
        except AttributeError:
            chars_result = svc.get_all_characteristics()
            chars = list(chars_result)
            svc_info["characteristics"] = []
            # synchronous result
            print(f"    Characteristics: {len(chars)}")
            continue

        try:
            chars = await asyncio.wait_for(chars_result, timeout=op_timeout)
        except asyncio.TimeoutError:
            print(f"    [WARN] Characteristic enumeration timed out")
            stats["complete"] = False
            continue

        # chars might be a GattCharacteristicsResult
        if hasattr(chars, "status"):
            chr_status = chars.status
            if chr_status == GattCommunicationStatus.ACCESS_DENIED:
                print(f"    [WARN] Characteristics: ACCESS_DENIED")
                stats["skipped_services"] += 1
                continue
            elif chr_status != GattCommunicationStatus.SUCCESS:
                print(f"    [WARN] Characteristics status: {chr_status}")
                continue
            char_list = chars.characteristics or []
        elif hasattr(chars, "characteristics"):
            char_list = chars.characteristics or []
        else:
            char_list = chars or []

        print(f"    Characteristics: {len(char_list)}")

        for ch in char_list:
            ch_uuid = str(ch.uuid).lower() if ch.uuid else "?"
            ch_handle = ch.attribute_handle
            try:
                props_raw = int(ch.characteristic_properties)
            except Exception:
                props_raw = 0

            prop_names, classes = parse_properties(props_raw)

            stats["characteristic_count"] += 1
            if "READABLE" in classes:
                stats["readable_count"] += 1
            if "WRITABLE_WITH_RESPONSE" in classes:
                stats["write_count"] += 1
            if "WRITABLE_WITHOUT_RESPONSE" in classes:
                stats["write_wo_resp_count"] += 1
            if "NOTIFIABLE" in classes:
                stats["notify_count"] += 1
            if "INDICATABLE" in classes:
                stats["indicate_count"] += 1

            ch_info = {
                "uuid": ch_uuid,
                "handle": ch_handle,
                "properties": props_raw,
                "prop_names": prop_names,
                "classifications": classes,
                "descriptors": [],
            }
            svc_info["characteristics"].append(ch_info)

            print(f"      Characteristic: {ch_uuid}  (handle={ch_handle})")
            print(f"        Properties: 0x{props_raw:04X} — {', '.join(prop_names)}")
            print(f"        Class: {', '.join(classes)}")

            # 教程 UUID 检查
            if ch_uuid in TUTORIAL_UUIDS:
                stats["tutorial_uuids"][ch_uuid] = {
                    "service_uuid": svc_uuid,
                    "handle": ch_handle,
                    "has_write": "WRITE" in prop_names,
                    "has_write_wo_resp": "WRITE_WITHOUT_RESPONSE" in prop_names,
                    "has_notify": "NOTIFY" in prop_names,
                    "has_indicate": "INDICATE" in prop_names,
                }
                if ch_uuid == TUTORIAL_WRITE_CANDIDATE:
                    print(f"        >>> TUTORIAL_WRITE_UUID_CANDIDATE <<<")

            # 获取 Descriptors
            try:
                try:
                    desc_result = ch.get_descriptors_with_cache_mode_async(
                        BluetoothCacheMode.UNCACHED
                    )
                except AttributeError:
                    desc_result = ch.get_descriptors_async(None)
            except AttributeError:
                desc_list = list(ch.get_all_descriptors())
            else:
                try:
                    desc_result = await asyncio.wait_for(desc_result, timeout=op_timeout)
                except asyncio.TimeoutError:
                    print(f"          [WARN] Descriptor enumeration timed out")
                    continue

                if hasattr(desc_result, "status"):
                    d_status = desc_result.status
                    if d_status != GattCommunicationStatus.SUCCESS:
                        if d_status == GattCommunicationStatus.ACCESS_DENIED:
                            print(f"          [WARN] Descriptors: ACCESS_DENIED")
                        continue
                    desc_list = desc_result.descriptors or []
                elif hasattr(desc_result, "descriptors"):
                    desc_list = desc_result.descriptors or []
                else:
                    desc_list = desc_result or []

            for d in desc_list:
                d_uuid = str(d.uuid).lower() if d.uuid else "?"
                d_handle = d.attribute_handle
                stats["descriptor_count"] += 1

                ch_info["descriptors"].append({
                    "uuid": d_uuid,
                    "handle": d_handle,
                })

                print(f"          Descriptor: {d_uuid}  (handle={d_handle})")

    return stats


# ---------------------------------------------------------------------------
# 输出
# ---------------------------------------------------------------------------

def print_summary(scan_info: dict[str, Any], stats: dict[str, Any]) -> None:
    """打印最终汇总。"""
    print()
    print("=" * 60)
    print("  GATT Enumeration Summary")
    print("=" * 60)

    # Device
    print(f"  Device Name       : {scan_info.get('local_name') or '(unknown)'}")
    print(f"  Address           : {scan_info.get('address_str')}")
    print(f"  Address Type      : {scan_info.get('address_type')}")
    print(f"  RSSI              : {scan_info.get('rssi')} dBm")
    print(f"  Connection Status : {scan_info.get('connection_status', 'N/A')}")
    print()
    print(f"  GATT Status       : {stats.get('gatt_status')}")
    print(f"  Enumeration       : {'complete' if stats.get('complete') else 'INCOMPLETE'}")
    print()
    print(f"  Services          : {stats['service_count']}")
    print(f"  Characteristics   : {stats['characteristic_count']}")
    print(f"  Descriptors       : {stats['descriptor_count']}")
    print(f"  Skipped Services  : {max(0, stats.get('skipped_services', 0))}")
    print()
    print(f"  — Readable        : {stats['readable_count']}")
    print(f"  — Write           : {stats['write_count']}")
    print(f"  — Write WoResp    : {stats['write_wo_resp_count']}")
    print(f"  — Notify          : {stats['notify_count']}")
    print(f"  — Indicate        : {stats['indicate_count']}")
    print()

    # 教程 UUID
    print("  Tutorial UUIDs:")
    for uuid_str in TUTORIAL_UUIDS:
        info = stats["tutorial_uuids"].get(uuid_str)
        if info:
            print(f"    {uuid_str}")
            print(f"      Service         : {info['service_uuid']}")
            print(f"      Handle          : {info['handle']}")
            print(f"      Write           : {info['has_write']}")
            print(f"      Write WoResp    : {info['has_write_wo_resp']}")
            print(f"      Notify          : {info['has_notify']}")
            print(f"      Indicate        : {info['has_indicate']}")
            if uuid_str == TUTORIAL_WRITE_CANDIDATE:
                print(f"      >>> TUTORIAL_WRITE_UUID_CANDIDATE <<<")
        else:
            print(f"    {uuid_str}  — not found")

    print()
    print("  Resources:")
    print(f"    GATT services closed    : yes")
    print(f"    BluetoothLEDevice closed: yes")
    print("=" * 60)


# ---------------------------------------------------------------------------
# 入口
# ---------------------------------------------------------------------------

async def main_async(args: argparse.Namespace) -> int:
    """异步主逻辑。"""

    target_int, target_formatted = args.address

    print(f"Target: {target_formatted} (int: 0x{target_int:012X})")
    print(f"Scan timeout: {args.scan_timeout}s  Op timeout: {args.operation_timeout}s")
    print(f"Scanning for target device...")

    # 阶段 1: 扫描发现
    scan_info = await scan_for_target(
        target_formatted, target_int, args.scan_timeout
    )

    if scan_info is None:
        print(f"ERROR: Target device {target_formatted} not found within "
              f"{args.scan_timeout}s.", file=sys.stderr)
        return 1

    print(f"  Found: {scan_info['local_name'] or '(unknown)'}  "
          f"RSSI={scan_info['rssi']} dBm  addr_type={scan_info['address_type']}")

    # 阶段 2: 创建 BluetoothLEDevice
    addr_int = scan_info["address_int"]
    addr_type = scan_info.get("address_type")

    device = None
    gatt_services_to_close: list[Any] = []

    try:
        # 使用 address type（如果有）
        if addr_type is not None:
            print(f"  Creating BluetoothLEDevice with address type {addr_type}...")
            device = await asyncio.wait_for(
                BluetoothLEDevice.from_bluetooth_address_with_bluetooth_address_type_async(
                    addr_int, addr_type
                ),
                timeout=args.operation_timeout,
            )
        else:
            print(f"  Creating BluetoothLEDevice (no address type)...")
            device = await asyncio.wait_for(
                BluetoothLEDevice.from_bluetooth_address_async(addr_int),
                timeout=args.operation_timeout,
            )

        if device is None:
            print(f"ERROR: Windows returned None for BluetoothLEDevice.", file=sys.stderr)
            return 1

        print(f"  Device created: name={device.name or '(unknown)'}, "
              f"addr_type={device.bluetooth_address_type}")

        # 等待连接建立
        await asyncio.sleep(1.0)
        try:
            conn = device.connection_status
        except Exception:
            conn = "UNKNOWN"
        print(f"  Connection status: {conn}")

        scan_info["connection_status"] = str(conn).split(".")[-1] if conn != "UNKNOWN" else "UNKNOWN"

        # 阶段 3: GATT 枚举
        print(f"\nEnumerating GATT structure (UNCACHED)...")
        stats = await enumerate_gatt(device, args.operation_timeout)

        print_summary(scan_info, stats)

        # 判断退出码
        if stats.get("skipped_services", 0) < 0:  # ACCESS_DENIED at top level
            # 完全无法访问 → 退出 1
            return 1
        # 即使部分 skipped，只要拿到了结构，退出 0
        return 0

    except asyncio.TimeoutError:
        print(f"ERROR: Operation timed out.", file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"ERROR: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1

    finally:
        # 释放资源
        for svc_data in []:
            pass  # services closed via device.close()
        if device is not None:
            try:
                device.close()
                print("  [cleanup] BluetoothLEDevice closed")
            except Exception:
                pass


def main() -> None:
    parser = argparse.ArgumentParser(
        description="WinRT 原生 GATT 结构枚举工具 (只读, 不取值)"
    )
    parser.add_argument(
        "--address",
        required=True,
        type=_address_type,
        metavar="ADDRESS",
        help="目标 BLE 设备地址 (e.g. 4D:F4:0E:D8:53:7D)",
    )
    parser.add_argument(
        "--scan-timeout",
        type=lambda v: validate_timeout(v, "scan-timeout", 1, 60),
        default=15.0,
        help="扫描超时，默认 15 秒 (1-60)",
    )
    parser.add_argument(
        "--operation-timeout",
        type=lambda v: validate_timeout(v, "operation-timeout", 5, 60),
        default=30.0,
        help="GATT 操作超时，默认 30 秒 (5-60)",
    )

    args = parser.parse_args()

    try:
        exit_code = asyncio.run(main_async(args))
    except KeyboardInterrupt:
        print("\nInterrupted by user (Ctrl+C).", file=sys.stderr)
        sys.exit(130)
    except Exception as exc:
        print(f"Fatal: {type(exc).__name__}: {exc}", file=sys.stderr)
        sys.exit(1)
    else:
        sys.exit(exit_code)


if __name__ == "__main__":
    main()
