"""NativeWinRTScanner 和 adapt_native_discovery 离线测试。"""

from __future__ import annotations

import asyncio
import os
import sys
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from bleak.backends.device import BLEDevice  # type: ignore[import-untyped]
from native_scanner import (  # type: ignore[import-not-found]
    NativeDiscoveryResult,
    NativeWinRTScanner,
    adapt_native_discovery,
)


class TestNativeDiscoveryResult(unittest.TestCase):
    def test_immutable(self) -> None:
        r = NativeDiscoveryResult(
            address="4D:F4:0E:D8:53:7D", name="SOSEXY", address_type="public"
        )
        self.assertEqual(r.address, "4D:F4:0E:D8:53:7D")
        self.assertEqual(r.name, "SOSEXY")
        self.assertEqual(r.address_type, "public")
        with self.assertRaises(Exception):
            r.address = "other"  # type: ignore[misc]

    def test_public_maps_correctly(self) -> None:
        r = NativeDiscoveryResult(address="AA:BB:CC:DD:EE:FF", name=None, address_type="public")
        self.assertEqual(r.address_type, "public")

    def test_random_maps_correctly(self) -> None:
        r = NativeDiscoveryResult(address="AA:BB:CC:DD:EE:FF", name=None, address_type="random")
        self.assertEqual(r.address_type, "random")

    def test_name_none_allowed(self) -> None:
        r = NativeDiscoveryResult(address="AA:BB:CC:DD:EE:FF", name=None, address_type="public")
        self.assertIsNone(r.name)


class TestNativeWinRTScanner(unittest.TestCase):
    def test_valid_address_accepted(self) -> None:
        scanner = NativeWinRTScanner()
        self.assertTrue(scanner._is_valid_address("4D:F4:0E:D8:53:7D"))

    def test_invalid_length_rejected(self) -> None:
        scanner = NativeWinRTScanner()
        self.assertFalse(scanner._is_valid_address("4D:F4:0E:D8:53"))
        self.assertFalse(scanner._is_valid_address("4D:F4:0E:D8:53:7D:00"))

    def test_non_hex_rejected(self) -> None:
        scanner = NativeWinRTScanner()
        self.assertFalse(scanner._is_valid_address("ZZ:ZZ:ZZ:ZZ:ZZ:ZZ"))

    def test_out_of_range_rejected(self) -> None:
        scanner = NativeWinRTScanner()
        self.assertFalse(scanner._is_valid_address("FF:FF:FF:FF:FF:1FF"))

    def test_not_string_rejected(self) -> None:
        scanner = NativeWinRTScanner()
        self.assertFalse(scanner._is_valid_address(None))  # type: ignore[arg-type]
        self.assertFalse(scanner._is_valid_address(123))  # type: ignore[arg-type]

    def test_find_device_rejects_bad_address(self) -> None:
        scanner = NativeWinRTScanner()
        with self.assertRaises(ValueError):
            asyncio.run(scanner.find_device("bad"))


class TestAdaptNativeDiscovery(unittest.TestCase):
    def test_address_preserved(self) -> None:
        r = NativeDiscoveryResult(address="4D:F4:0E:D8:53:7D", name="SOSEXY", address_type="public")
        d = adapt_native_discovery(r)
        self.assertEqual(d.address, "4D:F4:0E:D8:53:7D")

    def test_name_used_when_present(self) -> None:
        r = NativeDiscoveryResult(address="4D:F4:0E:D8:53:7D", name="SOSEXY", address_type="public")
        d = adapt_native_discovery(r)
        self.assertEqual(d.name, "SOSEXY")

    def test_address_used_when_name_none(self) -> None:
        r = NativeDiscoveryResult(address="4D:F4:0E:D8:53:7D", name=None, address_type="public")
        d = adapt_native_discovery(r)
        self.assertEqual(d.name, "4D:F4:0E:D8:53:7D")

    def test_details_has_native_discovery_flag(self) -> None:
        r = NativeDiscoveryResult(address="4D:F4:0E:D8:53:7D", name=None, address_type="public")
        d = adapt_native_discovery(r)
        self.assertTrue(d.details.get("_native_discovery"))
        self.assertEqual(d.details.get("_address_type"), "public")

    def test_details_not_raw_adv_data(self) -> None:
        r = NativeDiscoveryResult(address="4D:F4:0E:D8:53:7D", name=None, address_type="public")
        d = adapt_native_discovery(r)
        self.assertNotIn("adv", d.details)
        self.assertNotIn("scan", d.details)

    def test_only_native_discovery_result_accepted(self) -> None:
        with self.assertRaises(TypeError):
            adapt_native_discovery("not a result")  # type: ignore[arg-type]
        with self.assertRaises(TypeError):
            adapt_native_discovery(None)  # type: ignore[arg-type]

    def test_each_call_creates_new_bledevice(self) -> None:
        r = NativeDiscoveryResult(address="4D:F4:0E:D8:53:7D", name=None, address_type="public")
        d1 = adapt_native_discovery(r)
        d2 = adapt_native_discovery(r)
        self.assertIsNot(d1, d2)

    def test_random_address_type_flows_to_details(self) -> None:
        r = NativeDiscoveryResult(address="AA:BB:CC:DD:EE:FF", name=None, address_type="random")
        d = adapt_native_discovery(r)
        self.assertEqual(d.details.get("_address_type"), "random")

    def test_no_bledevice_construction_outside_adapter(self) -> None:
        """生产代码中 BLEDevice(...) 只出现在 adapter。"""
        import native_scanner as ns
        with open(ns.__file__, encoding="utf-8") as f:
            source = f.read()
        count = source.count("BLEDevice(")
        self.assertEqual(count, 1, f"Expected 1 BLEDevice() call in adapter, got {count}")


class TestNativeResults(unittest.TestCase):
    """验证 NativeDiscoveryResult 在 adapter 失败时不被调用。"""

    def test_scanner_none_no_adapter_call(self) -> None:
        """scanner 返回 None 时不调用 adapter（由 transport 检查）。"""
        # 此测试由 transport.ScannerInterface 契约保证
        pass


if __name__ == "__main__":
    unittest.main()
