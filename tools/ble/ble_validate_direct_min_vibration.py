#!/usr/bin/env python3
"""
Known-address token minimum vibration validation.

Uses explicit known-address BLEDevice token (not scanner/watcher)
to connect via BleakClient. Sends one vibration intensity=1 frame,
waits 1s, sends vibration stop.
No scanner, no watcher, no address-string BleakClient, no EE02 subscription.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import time
import traceback
from typing import Any

# protocol
import os
_this_dir = os.path.dirname(os.path.abspath(__file__))
if _this_dir not in sys.path:
    sys.path.insert(0, _this_dir)
from protocol import (  # type: ignore[import-not-found]
    WRITE_UUID,
    encode_vibration,
    format_hex_payload,
)


def parse_address(raw: str) -> str:
    cleaned = raw.strip().replace("-", ":").upper()
    parts = cleaned.split(":")
    if len(parts) != 6:
        raise argparse.ArgumentTypeError("6 colon-separated hex bytes required")
    try:
        vals = [int(p, 16) for p in parts]
    except ValueError:
        raise argparse.ArgumentTypeError(f"Invalid hex: {raw!r}")
    return ":".join(f"{b:02X}" for b in vals)


async def run(address: str, connect_timeout: float, op_timeout: float) -> int:
    # Payloads
    vibration_payload = encode_vibration(intensity=1, nonce=0x01)
    stop_payload = encode_vibration(intensity=0, nonce=0x01)

    assert vibration_payload == bytes.fromhex("010100020001110100021101"), (
        f"vibration payload mismatch: {format_hex_payload(vibration_payload)}"
    )
    assert stop_payload == bytes.fromhex("010100020001110000021101"), (
        f"vibration stop payload mismatch: {format_hex_payload(stop_payload)}"
    )

    print(f"Vibration payload : {format_hex_payload(vibration_payload)}")
    print(f"Vib stop payload  : {format_hex_payload(stop_payload)}")
    print(f"WRITE_UUID        : {WRITE_UUID}")
    print(f"Assertions passed.")
    print()

    write_count = 0
    vibration_ok = False
    stop_ok = False

    from bleak import BleakClient  # type: ignore[import-untyped]
    from bleak.backends.device import BLEDevice  # type: ignore[import-untyped]

    # Known-address token — not from scanner/watcher, not claiming discovery
    device = BLEDevice(address, address, {})

    client = BleakClient(
        device,
        pair=False,
        winrt={"use_cached_services": False},
    )

    try:
        # --- connect ---
        print("[1] Connecting via known-address BLEDevice token...")
        t0 = time.monotonic()
        await asyncio.wait_for(client.connect(timeout=connect_timeout),
                               timeout=connect_timeout + 5)
        print(f"    connected in {(time.monotonic() - t0):.1f}s  mtu={client.mtu_size}")

        # --- vibration ---
        print(f"\n[2] write_gatt_char — VIBRATION intensity=1")
        print(f"    UUID: {WRITE_UUID}")
        print(f"    payload: {format_hex_payload(vibration_payload)}")
        write_count += 1
        t_w = time.monotonic()
        try:
            await asyncio.wait_for(
                client.write_gatt_char(WRITE_UUID, vibration_payload, response=True),
                timeout=op_timeout,
            )
            elapsed = (time.monotonic() - t_w) * 1000
            vibration_ok = True
            print(f"    WRITE OK in {elapsed:.0f}ms")
        except Exception as exc:
            elapsed = (time.monotonic() - t_w) * 1000
            print(f"    WRITE FAILED in {elapsed:.0f}ms: {type(exc).__name__}: {exc}")
            traceback.print_exc(file=sys.stderr)

        # --- wait 1s ---
        print(f"\n[3] Waiting 1s...")
        await asyncio.sleep(1.0)

        # --- stop ---
        print(f"\n[4] write_gatt_char — VIBRATION STOP (intensity=0)")
        print(f"    UUID: {WRITE_UUID}")
        print(f"    payload: {format_hex_payload(stop_payload)}")
        write_count += 1
        t_s = time.monotonic()
        try:
            await asyncio.wait_for(
                client.write_gatt_char(WRITE_UUID, stop_payload, response=True),
                timeout=op_timeout,
            )
            elapsed = (time.monotonic() - t_s) * 1000
            stop_ok = True
            print(f"    WRITE OK in {elapsed:.0f}ms")
        except Exception as exc:
            elapsed = (time.monotonic() - t_s) * 1000
            print(f"    WRITE FAILED in {elapsed:.0f}ms: {type(exc).__name__}: {exc}")
            traceback.print_exc(file=sys.stderr)

    except Exception as exc:
        print(f"ERROR: {type(exc).__name__}: {exc}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)

    finally:
        print(f"\n[5] Disconnecting...")
        try:
            await asyncio.wait_for(client.disconnect(), timeout=10.0)
            print(f"    disconnect OK")
        except Exception as exc:
            print(f"    disconnect FAILED: {exc}", file=sys.stderr)

    # Summary
    print(f"\n{'='*60}")
    print(f"  Tutorial Direct-Address Min Vibration")
    print(f"{'='*60}")
    print(f"  Vibration write:  {'OK' if vibration_ok else 'FAILED'}")
    print(f"  Stop write:       {'OK' if stop_ok else 'FAILED'}")
    print(f"  Total writes:     {write_count}")
    print(f"  Max writes:       2")
    print(f"  Retries:          0")
    print(f"  Known-addr token:  YES (not from scanner)")
    print(f"  Scanner/watcher:   NONE")
    print(f"  EE02 subscribed:   NO")
    print(f"  Intensity > 1:    NO")
    print(f"{'='*60}")

    print()
    print("PROGRAM OBSERVATION: ATT write results only.")
    print("Report actual device behavior: A/B/C/D/E")

    return 0 if vibration_ok else 1


def main() -> None:
    p = argparse.ArgumentParser(description="Tutorial direct min vibration validation")
    p.add_argument("--address", required=True, type=parse_address, metavar="ADDR")
    p.add_argument("--connect-timeout", type=float, default=30.0)
    p.add_argument("--operation-timeout", type=float, default=30.0)
    args = p.parse_args()

    try:
        ec = asyncio.run(run(args.address, args.connect_timeout, args.operation_timeout))
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        sys.exit(130)
    except Exception as exc:
        print(f"Fatal: {type(exc).__name__}: {exc}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
    else:
        sys.exit(ec)


if __name__ == "__main__":
    main()
