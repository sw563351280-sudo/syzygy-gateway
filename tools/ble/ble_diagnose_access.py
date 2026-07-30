#!/usr/bin/env python3
"""
WinRT GATT 访问权限与 Session 诊断。

纯诊断：不发送应用 payload、不写 CCCD、不订阅、不配对、不读值。
目标：查明 EE03 写入 ACCESS_DENIED 的根源。
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import time
from typing import Any

from winrt.windows.devices.bluetooth import (  # type: ignore[import-not-found]
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
    GattCommunicationStatus,
    GattDeviceService,
    GattSession,
    GattSessionStatus,
    GattSessionStatusChangedEventArgs,
)
from winrt.windows.devices.enumeration import (  # type: ignore[import-not-found]
    DeviceAccessStatus,
)

# ---------------------------------------------------------------------------
EE01_SVC = "0000ee01-0000-1000-8000-00805f9b34fb"
EE02_CH = "0000ee02-0000-1000-8000-00805f9b34fb"
EE03_CH = "0000ee03-0000-1000-8000-00805f9b34fb"

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


def fmt_enum(v: Any) -> str:
    if v is None:
        return "N/A"
    try:
        return str(v).split(".")[-1]
    except Exception:
        return str(v)


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

async def diagnose(args: argparse.Namespace) -> int:
    target_int, target_formatted = args.address

    print(f"Target: {target_formatted}")
    print()

    # --- 扫描 ---
    print("[1] Scan...")
    scan_info = await scan_target(target_formatted, args.scan_timeout)
    if scan_info is None:
        print("ERROR: Target not found.", file=sys.stderr)
        return 1
    print(f"    Found RSSI={scan_info['rssi']} dBm  addr_type={scan_info['address_type']}")

    # --- 创建设备 ---
    print("[2] BluetoothLEDevice...")
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
        print("ERROR: device None", file=sys.stderr)
        return 1

    session = None
    session_token = None
    session_events: list[dict[str, Any]] = []

    try:
        await asyncio.sleep(0.5)

        # --- 设备基本信息 ---
        print(f"    name               : {device.name or '(unknown)'}")
        conn_init = device.connection_status
        print(f"    connection_status  : {fmt_enum(conn_init)}")
        bdid = device.bluetooth_device_id
        print(f"    bluetooth_device_id: {bdid}")
        di = device.device_information
        if di:
            print(f"    DeviceInformation.id: {di.id}")

        # --- 配对状态（只读） ---
        is_paired = None
        can_pair = None
        try:
            pairing = di.pairing
            is_paired = pairing.is_paired
            can_pair = pairing.can_pair
        except Exception as exc:
            print(f"    pairing info ERROR: {exc}")
        print(f"    is_paired          : {is_paired}")
        print(f"    can_pair           : {can_pair}")

        # --- GattSession ---
        print()
        print("[3] GattSession...")
        session = await asyncio.wait_for(
            GattSession.from_device_id_async(bdid),
            timeout=args.operation_timeout,
        )
        if session is None:
            print("ERROR: GattSession is None", file=sys.stderr)
            return 1
        print(f"    created            : OK")
        print(f"    can_maintain_conn  : {session.can_maintain_connection}")
        print(f"    maintain_connection: {session.maintain_connection} (before)")
        try:
            mps = session.max_pdu_size
            print(f"    max_pdu_size       : {mps}")
        except Exception:
            print(f"    max_pdu_size       : N/A")
        print(f"    session_status     : {fmt_enum(session.session_status)} (initial)")

        # 注册 session handler
        def _on_session_changed(sender: Any, e: GattSessionStatusChangedEventArgs) -> None:
            entry = {
                "time": time.monotonic(),
                "status": fmt_enum(e.status),
                "error": fmt_enum(e.error) if e.error else "NONE",
            }
            session_events.append(entry)
            print(f"    [session event] status={entry['status']}  error={entry['error']}",
                  file=sys.stderr)

        session_token = session.add_session_status_changed(_on_session_changed)

        if session.can_maintain_connection:
            print(f"    Setting maintain_connection=True...")
            session.maintain_connection = True
            print(f"    maintain_connection: {session.maintain_connection} (after)")

            # 等待 ACTIVE
            print(f"    Waiting for ACTIVE (up to {args.operation_timeout}s)...")
            t0 = time.monotonic()
            active_seen = False
            while (time.monotonic() - t0) < args.operation_timeout:
                if session.session_status == GattSessionStatus.ACTIVE:
                    if not active_seen:
                        elapsed = time.monotonic() - t0
                        print(f"    Session ACTIVE after {elapsed:.2f}s")
                        active_seen = True
                    break
                await asyncio.sleep(0.1)
            if not active_seen:
                print(f"    WARNING: Did not reach ACTIVE within timeout. "
                      f"Current: {fmt_enum(session.session_status)}")
        else:
            print(f"    (cannot maintain_connection; skipping ACTIVE wait)")

        # --- GATT 枚举 ---
        print()
        print("[4] GATT enumeration (UNCACHED)...")
        svc_r = await asyncio.wait_for(
            device.get_gatt_services_with_cache_mode_async(BluetoothCacheMode.UNCACHED),
            timeout=args.operation_timeout,
        )
        if svc_r.status != GattCommunicationStatus.SUCCESS:
            print(f"    GATT: {fmt_enum(svc_r.status)}")
            return 1
        print(f"    GATT: SUCCESS")

        ee01_svc = ee02_ch = ee03_ch = None
        for s in (svc_r.services or []):
            u = str(s.uuid).lower()
            if u == EE01_SVC:
                ee01_svc = s
        if ee01_svc is None:
            print("ERROR: EE01 not found", file=sys.stderr)
            return 1

        try:
            cr = ee01_svc.get_characteristics_with_cache_mode_async(BluetoothCacheMode.UNCACHED)
        except AttributeError:
            cr = ee01_svc.get_characteristics_async(None)
        cr = await asyncio.wait_for(cr, timeout=args.operation_timeout)
        clist = cr.characteristics if hasattr(cr, "characteristics") else (cr or [])
        for ch in clist:
            u = str(ch.uuid).lower()
            if u == EE02_CH:
                ee02_ch = ch
            elif u == EE03_CH:
                ee03_ch = ch

        # --- EE01 访问信息 ---
        print()
        print("[5] EE01 Service access...")
        try:
            dai = ee01_svc.device_access_information
            da_before = dai.current_status if dai else "N/A"
        except Exception:
            da_before = "N/A"
        print(f"    current_status (before): {fmt_enum(da_before)}")

        # request_access_async
        ra_result = "NOT_ATTEMPTED"
        ra_exception = None
        try:
            ra = await asyncio.wait_for(
                ee01_svc.request_access_async(),
                timeout=args.operation_timeout,
            )
            ra_result = fmt_enum(ra)
        except Exception as exc:
            ra_exception = f"{type(exc).__name__}: {exc}"
            ra_result = f"EXCEPTION: {ra_exception}"

        print(f"    request_access_async: {ra_result}")

        # 再次检查
        try:
            da_after = fmt_enum(ee01_svc.device_access_information.current_status)
        except Exception:
            da_after = "N/A"
        print(f"    current_status (after): {da_after}")

        # --- EE02/EE03 属性 ---
        print()
        print("[6] Characteristic details...")

        def _safe_props(ch: Any) -> int:
            try:
                return int(ch.characteristic_properties)
            except Exception:
                return -1

        def _safe_pl(ch: Any) -> str:
            try:
                return fmt_enum(ch.protection_level)
            except Exception:
                return "N/A"

        if ee02_ch:
            print(f"    EE02:")
            print(f"      handle : {ee02_ch.attribute_handle}")
            print(f"      props  : 0x{_safe_props(ee02_ch):04X}")
            print(f"      prot_lv: {_safe_pl(ee02_ch)}")
        else:
            print(f"    EE02: NOT FOUND")

        if ee03_ch:
            print(f"    EE03:")
            print(f"      handle : {ee03_ch.attribute_handle}")
            print(f"      props  : 0x{_safe_props(ee03_ch):04X}")
            print(f"      prot_lv: {_safe_pl(ee03_ch)}")
        else:
            print(f"    EE03: NOT FOUND")

        # --- 最终状态 ---
        print()
        print("[7] Final state...")
        conn_final = device.connection_status
        print(f"    connection_status : {fmt_enum(conn_final)}")
        print(f"    session_status    : {fmt_enum(session.session_status)}")
        print(f"    session events    : {len(session_events)}")
        for se in session_events:
            print(f"      +{se['time'] - t0 if 't0' in dir() else 0:.2f}s  "
                  f"status={se['status']}  error={se['error']}")

        # --- 汇总 ---
        print()
        print("=" * 60)
        print("  Diagnosis Summary")
        print("=" * 60)
        print(f"  is_paired             : {is_paired}")
        print(f"  can_pair              : {can_pair}")
        print(f"  initial conn_status   : {fmt_enum(conn_init)}")
        print(f"  final conn_status     : {fmt_enum(conn_final)}")
        print(f"  session can_maintain  : {session.can_maintain_connection}")
        print(f"  session status        : {fmt_enum(session.session_status)}")
        print(f"  session events        : {len(session_events)}")
        print(f"  EE01 access before    : {fmt_enum(da_before)}")
        print(f"  RequestAccessAsync    : {ra_result}")
        print(f"  EE01 access after     : {da_after}")
        if ra_exception:
            print(f"  RequestAccess exception: {ra_exception}")
        if ee03_ch:
            print(f"  EE03 protection_level : {_safe_pl(ee03_ch)}")
        print(f"  Writes performed      : 0")
        print(f"  CCCD writes           : 0")
        print(f"  Reads performed       : 0")
        print(f"  Pairing attempted     : NO")
        print(f"  Control payloads      : 0")
        print("=" * 60)

        # 判断
        ra_ok = ra_result == "ALLOWED"
        session_ok = session.session_status == GattSessionStatus.ACTIVE
        if ra_ok and session_ok:
            print("CONCLUSION: A — EE01 access ALLOWED, Session ACTIVE")
        elif ra_result == "DENIED_BY_USER":
            print("CONCLUSION: B — Access DENIED_BY_USER")
        elif ra_result == "DENIED_BY_SYSTEM":
            print("CONCLUSION: C — Access DENIED_BY_SYSTEM")
        elif not session_ok and session.can_maintain_connection:
            print("CONCLUSION: D — Session not ACTIVE despite can_maintain=True")
        elif ra_ok and session_ok:
            print("CONCLUSION: E — Access & Session OK, ACCESS_DENIED needs further "
                  "investigation (protection_level, write lifecycle)")
        else:
            print("CONCLUSION: F — Diagnostic incomplete or unexpected state")

        return 0

    finally:
        # 清理
        print(f"\n[cleanup]", file=sys.stderr)
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
                print(f"  GattSession closed", file=sys.stderr)
            except Exception as exc:
                print(f"  WARNING: session.close: {exc}", file=sys.stderr)
        if device is not None:
            try:
                device.close()
                print(f"  BluetoothLEDevice closed", file=sys.stderr)
            except Exception as exc:
                print(f"  WARNING: device.close: {exc}", file=sys.stderr)


async def main_async(args: argparse.Namespace) -> int:
    return await diagnose(args)


def main() -> None:
    parser = argparse.ArgumentParser(description="WinRT GATT 访问权限与 Session 诊断")
    parser.add_argument("--address", required=True, type=_address_type, metavar="ADDRESS")
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
