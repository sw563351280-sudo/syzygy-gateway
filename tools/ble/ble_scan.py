#!/usr/bin/env python3
"""
只读 BLE 广播扫描工具。

使用 Bleak 3.0.2 进行被动 BLE 广播扫描。
仅扫描；不连接、不配对、不读写 GATT。
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import sys
import uuid
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Any

# 仅导入扫描所需对象
from bleak import BleakScanner  # type: ignore[import-untyped]
from bleak.exc import BleakError  # type: ignore[import-untyped]


# ---------------------------------------------------------------------------
# 数据模型
# ---------------------------------------------------------------------------

@dataclass
class DeviceSnapshot:
    """单次广播观察的原始数据。"""

    name: str | None
    address: str
    rssi: int | None
    tx_power: int | None
    local_name: str | None
    service_uuids: list[str]
    manufacturer_data: dict[int, bytes]
    service_data: dict[str, bytes]


@dataclass
class AggregatedDevice:
    """扫描期间聚合后的设备信息。

    去重规则（按 device.address.casefold()）：
    1. 保存最近一次广播数据。
    2. 记录本次扫描期间观察到的最强 RSSI。
    3. 最终输出使用最强 RSSI。
    4. 服务 UUID 取本次扫描观察到的并集。
    5. manufacturer data 和 service data 使用最近一次非空数据。
    """

    address: str
    name: str  # 解析后的显示名称
    best_rssi: int | None = None
    tx_power: int | None = None
    service_uuids: set[str] = field(default_factory=set)
    manufacturer_data: dict[int, bytes] = field(default_factory=dict)
    service_data: dict[str, bytes] = field(default_factory=dict)
    _last_nonempty_mfr: dict[int, bytes] = field(default_factory=dict)
    _last_nonempty_svc: dict[str, bytes] = field(default_factory=dict)

    def update(self, snap: DeviceSnapshot) -> None:
        """合并一次新的广播观察。"""
        # RSSI — 保留最强值
        if snap.rssi is not None:
            if self.best_rssi is None or snap.rssi > self.best_rssi:
                self.best_rssi = snap.rssi

        # TX Power — 最近一次非空
        if snap.tx_power is not None:
            self.tx_power = snap.tx_power

        # Service UUIDs — 并集
        if snap.service_uuids:
            self.service_uuids.update(snap.service_uuids)

        # Manufacturer data — 最近一次非空
        if snap.manufacturer_data:
            self._last_nonempty_mfr = dict(snap.manufacturer_data)

        # Service data — 最近一次非空
        if snap.service_data:
            self._last_nonempty_svc = dict(snap.service_data)

        # 更新最终使用的 manufacturer_data / service_data
        self.manufacturer_data = self._last_nonempty_mfr
        self.service_data = self._last_nonempty_svc

    def sort_key(self) -> tuple[int, int, str, str]:
        """排序键：有 RSSI 在前 → RSSI 降序 → 名称 → 地址。"""
        has_rssi = 0 if self.best_rssi is not None else 1
        neg_rssi = -self.best_rssi if self.best_rssi is not None else 0
        return (has_rssi, neg_rssi, self.name.casefold(), self.address.casefold())


# ---------------------------------------------------------------------------
# 辅助函数
# ---------------------------------------------------------------------------

def _resolve_name(device_name: str | None, local_name: str | None) -> str:
    """按优先级解析设备显示名称：

    1. advertisement_data.local_name
    2. device.name
    3. "(unknown)"
    """
    if local_name:
        return local_name
    if device_name:
        return device_name
    return "(unknown)"


def _bytes_to_hex(data: bytes) -> str:
    """字节 → 大写两位十六进制，空格分隔。"""
    return " ".join(f"{b:02X}" for b in data)


def _hex_no_spaces(data: bytes) -> str:
    """字节 → 无空格大写十六进制（用于 JSON）。"""
    return data.hex().upper()


# ---------------------------------------------------------------------------
# 参数解析与校验
# ---------------------------------------------------------------------------

def validate_timeout(value: str) -> float:
    """校验并转换 --timeout 参数。

    Returns:
        float: 转换后的浮点值（1..60）。

    Raises:
        argparse.ArgumentTypeError: 值不在有效范围内或非数字。
    """
    try:
        val = float(value)
    except (TypeError, ValueError):
        raise argparse.ArgumentTypeError(
            f"Invalid timeout value: '{value}'. Must be a number between 1 and 60."
        )

    if math.isnan(val) or math.isinf(val):
        raise argparse.ArgumentTypeError(
            f"Invalid timeout value: '{value}'. NaN and Infinity are not allowed."
        )

    if val < 1 or val > 60:
        raise argparse.ArgumentTypeError(
            f"Timeout must be between 1 and 60 seconds, got {val}."
        )

    return val


def validate_uuid(uuid_str: str) -> str:
    """校验并标准化 UUID。

    Returns:
        str: 小写标准格式 UUID 字符串。

    Raises:
        argparse.ArgumentTypeError: UUID 格式无效。
    """
    try:
        parsed = uuid.UUID(uuid_str.strip())
    except (ValueError, AttributeError):
        raise argparse.ArgumentTypeError(
            f"Invalid UUID: '{uuid_str}'. Must be a valid UUID string."
        )
    return str(parsed).lower()


def build_parser() -> argparse.ArgumentParser:
    """构建命令行参数解析器。"""
    parser = argparse.ArgumentParser(
        description="只读 BLE 广播扫描工具（bleak 3.0.2）",
    )
    parser.add_argument(
        "--timeout",
        type=validate_timeout,
        default=10.0,
        help="扫描持续时间（秒），范围 1–60，默认 10",
    )
    parser.add_argument(
        "--name",
        type=str,
        default=None,
        help="按设备名称进行不区分大小写的部分匹配",
    )
    parser.add_argument(
        "--service-uuid",
        type=validate_uuid,
        default=None,
        metavar="UUID",
        help="按广播 service UUID 筛选",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        default=False,
        dest="json_mode",
        help="以 JSON 格式输出结果",
    )
    return parser


# ---------------------------------------------------------------------------
# 设备归一化 / 序列化
# ---------------------------------------------------------------------------

def snapshot_from_detection(
    device: Any,
    advertisement_data: Any,
) -> DeviceSnapshot:
    """从 Bleak detection callback 参数创建 DeviceSnapshot。"""
    return DeviceSnapshot(
        name=device.name,
        address=device.address,
        rssi=advertisement_data.rssi,
        tx_power=advertisement_data.tx_power,
        local_name=advertisement_data.local_name,
        service_uuids=list(advertisement_data.service_uuids or []),
        manufacturer_data=dict(advertisement_data.manufacturer_data or {}),
        service_data=dict(advertisement_data.service_data or {}),
    )


def device_to_dict(dev: AggregatedDevice) -> dict[str, Any]:
    """将聚合设备转为 JSON 可序列化字典。"""
    return {
        "name": dev.name,
        "address": dev.address,
        "rssi": dev.best_rssi,
        "tx_power": dev.tx_power,
        "service_uuids": sorted(dev.service_uuids) if dev.service_uuids else [],
        "manufacturer_data": {
            f"0x{cid:04X}": _hex_no_spaces(data)
            for cid, data in sorted(dev.manufacturer_data.items())
        },
        "service_data": {
            uid: _hex_no_spaces(data)
            for uid, data in sorted(dev.service_data.items())
        },
    }


# ---------------------------------------------------------------------------
# 扫描核心
# ---------------------------------------------------------------------------

async def scan_devices(
    timeout: float,
) -> list[AggregatedDevice]:
    """执行 BLE 广播扫描，返回去重聚合后的设备列表。"""
    aggregated: OrderedDict[str, AggregatedDevice] = OrderedDict()

    def _detection_callback(device: Any, advertisement_data: Any) -> None:
        """Bleak 检测回调。"""
        snap = snapshot_from_detection(device, advertisement_data)
        key = snap.address.casefold()

        if key in aggregated:
            aggregated[key].update(snap)
        else:
            dev = AggregatedDevice(
                address=snap.address,
                name=_resolve_name(snap.name, snap.local_name),
            )
            dev.update(snap)
            aggregated[key] = dev

    scanner = BleakScanner(detection_callback=_detection_callback)

    try:
        await scanner.start()
        await asyncio.sleep(timeout)
    finally:
        await scanner.stop()

    return list(aggregated.values())


# ---------------------------------------------------------------------------
# 筛选
# ---------------------------------------------------------------------------

def apply_filters(
    devices: list[AggregatedDevice],
    name_filter: str | None,
    uuid_filter: str | None,
) -> list[AggregatedDevice]:
    """按名称和/或 service UUID 筛选设备。"""
    result = devices

    if name_filter:
        needle = name_filter.casefold()

        def _name_match(d: AggregatedDevice) -> bool:
            return needle in d.name.casefold()

        result = [d for d in result if _name_match(d)]

    if uuid_filter:
        target = uuid_filter.lower()

        def _uuid_match(d: AggregatedDevice) -> bool:
            return any(u.lower() == target for u in d.service_uuids)

        result = [d for d in result if _uuid_match(d)]

    return result


# ---------------------------------------------------------------------------
# 输出
# ---------------------------------------------------------------------------

def _format_rssi(rssi: int | None) -> str:
    """格式化 RSSI 值。"""
    if rssi is None:
        return "N/A"
    return f"{rssi} dBm"


def _format_tx_power(tx: int | None) -> str:
    """格式化 TX Power 值。"""
    if tx is None:
        return "N/A"
    return f"{tx} dBm"


def _format_service_uuids(uuids: set[str]) -> str:
    """格式化 service UUIDs 列表。"""
    if not uuids:
        return "none"
    return ", ".join(sorted(uuids))


def _format_manufacturer_data(data: dict[int, bytes]) -> str:
    """格式化 manufacturer data，含 company ID。"""
    if not data:
        return "none"
    lines: list[str] = []
    for cid in sorted(data):
        lines.append(f"    0x{cid:04X}: {_bytes_to_hex(data[cid])}")
    return "\n".join(lines).rstrip()


def _format_service_data(data: dict[str, bytes]) -> str:
    """格式化 service data。"""
    if not data:
        return "none"
    lines: list[str] = []
    for uid, raw in sorted(data.items()):
        lines.append(f"    {uid}: {_bytes_to_hex(raw)}")
    return "\n".join(lines).rstrip()


def text_output(
    devices: list[AggregatedDevice],
    timeout: float,
    discovered_count: int,
) -> None:
    """纯文本模式输出。"""
    print(f"BLE Scan Results ({timeout:.1f}s)")
    print("-" * 72)

    if not devices:
        print("No devices found matching the criteria.")
        print()
    else:
        for i, dev in enumerate(devices, 1):
            max_label_width = 20
            print(f"[{i:>3}] {dev.name}")
            print(f"  {'Address / Windows identifier':<{max_label_width}}: {dev.address}")
            print(f"  {'RSSI':<{max_label_width}}: {_format_rssi(dev.best_rssi)}")
            print(f"  {'TX Power':<{max_label_width}}: {_format_tx_power(dev.tx_power)}")
            print(f"  {'Service UUIDs':<{max_label_width}}: {_format_service_uuids(dev.service_uuids)}")
            print(f"  {'Manufacturer Data':<{max_label_width}}:")
            print(_format_manufacturer_data(dev.manufacturer_data))
            print(f"  {'Service Data':<{max_label_width}}:")
            print(_format_service_data(dev.service_data))
            print()

    print("-" * 72)
    print(f"Scan duration   : {timeout:.1f} seconds")
    print(f"Discovered      : {discovered_count} device(s) before filtering")
    print(f"Matched         : {len(devices)} device(s) after filtering")
    print("Dedup strategy  : address.casefold() key; strongest RSSI retained; "
          "service UUID union; most recent non-empty mfr/svc data")


def json_output(
    devices: list[AggregatedDevice],
    timeout: float,
    discovered_count: int,
) -> None:
    """JSON 模式输出。"""
    result = {
        "scan": {
            "timeout_seconds": timeout,
            "discovered_count": discovered_count,
            "matched_count": len(devices),
        },
        "devices": [device_to_dict(d) for d in devices],
    }
    print(json.dumps(result, indent=2, ensure_ascii=False))


# ---------------------------------------------------------------------------
# 入口
# ---------------------------------------------------------------------------

def main() -> None:
    """主入口函数。"""
    parser = build_parser()
    args = parser.parse_args()

    # 执行扫描
    try:
        all_devices = asyncio.run(scan_devices(timeout=args.timeout))
    except BleakError as exc:
        print(f"BLE error: {exc}", file=sys.stderr)
        print("Possible causes: Bluetooth adapter unavailable, disabled, "
              "or Windows Bluetooth Support Service not running.",
              file=sys.stderr)
        sys.exit(1)
    except asyncio.TimeoutError:
        print("Scan timed out.", file=sys.stderr)
        sys.exit(1)
    except OSError as exc:
        print(f"System error: {exc}", file=sys.stderr)
        print("Possible causes: Bluetooth adapter removed during scan, "
              "driver issue, or insufficient permissions.",
              file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        print("Scan interrupted by user (Ctrl+C).", file=sys.stderr)
        sys.exit(130)
    except Exception as exc:
        print(f"Unexpected error: {exc}", file=sys.stderr)
        sys.exit(1)

    discovered_count = len(all_devices)

    # 应用筛选
    matched = apply_filters(
        all_devices,
        name_filter=args.name,
        uuid_filter=args.service_uuid,
    )

    # 排序
    matched.sort(key=lambda d: d.sort_key())

    # 输出
    if args.json_mode:
        json_output(matched, args.timeout, discovered_count)
    else:
        text_output(matched, args.timeout, discovered_count)

    sys.exit(0)


if __name__ == "__main__":
    main()
