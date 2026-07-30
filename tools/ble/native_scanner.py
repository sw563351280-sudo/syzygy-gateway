"""
Native WinRT BLE discovery + Bleak BLEDevice adapter.

Uses reliable WinRT BluetoothLEAdvertisementWatcher for device discovery,
then constructs a Bleak BLEDevice through an explicit adapter function.
Watcher does NOT create BluetoothLEDevice, GattSession, or any GATT I/O.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Any, Literal

from bleak.backends.device import BLEDevice  # type: ignore[import-untyped]
from winrt.windows.devices.bluetooth.advertisement import (  # type: ignore[import-not-found]
    BluetoothLEAdvertisementReceivedEventArgs,
    BluetoothLEAdvertisementWatcher,
    BluetoothLEScanningMode,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Discovery result
# ---------------------------------------------------------------------------

AddressTypeStr = Literal["public", "random"]

_ADDRESS_TYPE_MAP: dict[int, AddressTypeStr] = {
    0: "public",
    1: "random",
}


@dataclass(frozen=True)
class NativeDiscoveryResult:
    """Result from native WinRT watcher discovery.

    Only created when watcher actually receives a matching advertisement.
    """

    address: str
    """Normalized 48-bit BLE address (XX:XX:XX:XX:XX:XX)."""
    name: str | None
    """Device name from advertisement; None if absent."""
    address_type: AddressTypeStr
    """BluetoothAddressType from advertisement, mapped to 'public' or 'random'."""


# ---------------------------------------------------------------------------
# Address formatting
# ---------------------------------------------------------------------------

def _format_address(value: int) -> str:
    raw = f"{value:012X}"
    return ":".join(raw[i:i + 2] for i in range(0, 12, 2))


# ---------------------------------------------------------------------------
# Native WinRT scanner
# ---------------------------------------------------------------------------

class NativeWinRTScanner:
    """Native WinRT BLE device discovery via BluetoothLEAdvertisementWatcher.

    Discovery only. No BluetoothLEDevice, GattSession, or GATT I/O.
    """

    def __init__(self) -> None:
        self._watcher: BluetoothLEAdvertisementWatcher | None = None

    async def find_device(
        self,
        target_address: str,
        timeout: float = 15.0,
    ) -> NativeDiscoveryResult | None:
        """Scan until target found or timeout.

        Args:
            target_address: Normalized 48-bit target address.
            timeout: Scan timeout in seconds.

        Returns:
            NativeDiscoveryResult if found; None on timeout.

        Raises:
            asyncio.CancelledError: Propagated as-is.
            Exception: Watcher exceptions preserve cause via RuntimeError.
        """
        if not self._is_valid_address(target_address):
            raise ValueError(f"Invalid target address: {target_address!r}")

        found_event = asyncio.Event()
        result_container: list[NativeDiscoveryResult] = []

        def _on_received(
            sender: Any, args: BluetoothLEAdvertisementReceivedEventArgs,
        ) -> None:
            addr_str = _format_address(args.bluetooth_address)
            if addr_str != target_address:
                return
            try:
                raw_at = int(args.bluetooth_address_type)
            except (TypeError, ValueError):
                raw_at = -1
            at_str = _ADDRESS_TYPE_MAP.get(raw_at, "public")
            name = args.advertisement.local_name or None
            result_container.append(
                NativeDiscoveryResult(
                    address=addr_str,
                    name=name,
                    address_type=at_str,
                )
            )
            found_event.set()

        watcher = BluetoothLEAdvertisementWatcher()
        watcher.scanning_mode = BluetoothLEScanningMode.ACTIVE
        watcher.add_received(_on_received)
        self._watcher = watcher

        try:
            watcher.start()
            try:
                await asyncio.wait_for(found_event.wait(), timeout=timeout)
            except asyncio.TimeoutError:
                return None
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            raise RuntimeError(
                f"Native scan failed for {target_address}: {exc}"
            ) from exc
        finally:
            try:
                watcher.stop()
            except Exception:
                pass
            self._watcher = None

        return result_container[0] if result_container else None

    @staticmethod
    def _is_valid_address(address: str) -> bool:
        if not isinstance(address, str):
            return False
        parts = address.split(":")
        if len(parts) != 6:
            return False
        try:
            return all(0 <= int(p, 16) <= 255 for p in parts)
        except ValueError:
            return False


# ---------------------------------------------------------------------------
# BLEDevice adapter
# ---------------------------------------------------------------------------

def adapt_native_discovery(result: NativeDiscoveryResult) -> BLEDevice:
    """Construct a Bleak BLEDevice from a native discovery result.

    Only accepts NativeDiscoveryResult. No other BLEDevice construction
    should exist in production code.
    details contains minimal adapter metadata, not RawAdvData.
    """
    if not isinstance(result, NativeDiscoveryResult):
        raise TypeError(
            f"adapt_native_discovery requires NativeDiscoveryResult, "
            f"got {type(result).__name__}"
        )

    name = result.name or result.address

    details = {
        "_native_discovery": True,
        "_address_type": result.address_type,
    }

    return BLEDevice(result.address, name, details)
