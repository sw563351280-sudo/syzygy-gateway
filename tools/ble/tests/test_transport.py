"""
Bleak transport 单元测试。

纯离线 — 不连接真实 BLE 设备，不发送 payload。
测试参数验证、导入、mock 边界、清理语义。
"""

from __future__ import annotations

import asyncio
import os
import sys
import unittest
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from bleak.backends.device import BLEDevice  # type: ignore[import-untyped]
from bleak.backends.characteristic import BleakGATTCharacteristic  # type: ignore[import-untyped]
from bleak.backends.service import BleakGATTService  # type: ignore[import-untyped]

# 被测试模块
from ble_transport import (  # type: ignore[import-not-found]
    WRITE_RESPONSE_MAX_BYTES,
    BLETransport,
    ClientFactoryInterface,
    GATTLocator,
    ScannerInterface,
    TransportDiscoveryError,
    TransportError,
    TransportNotConnectedError,
    TransportServiceNotFoundError,
    TransportWriteError,
)


# ---------------------------------------------------------------------------
# 辅助
# ---------------------------------------------------------------------------

def _make_mock_char(uuid: str, handle: int, properties: list[str]) -> MagicMock:
    ch = MagicMock(spec=BleakGATTCharacteristic)
    ch.uuid = uuid
    ch.handle = handle
    ch.properties = list(properties)
    return ch


def _make_mock_service(uuid: str, handle: int, characteristics: list[MagicMock]) -> MagicMock:
    svc = MagicMock(spec=BleakGATTService)
    svc.uuid = uuid
    svc.handle = handle
    svc.characteristics = characteristics
    return svc


def _make_mock_device(address: str = "4D:F4:0E:D8:53:7D") -> BLEDevice:
    return BLEDevice(address, address, {})


# ---------------------------------------------------------------------------
# 测试
# ---------------------------------------------------------------------------


class TestConstants(unittest.TestCase):
    def test_write_max(self) -> None:
        self.assertEqual(WRITE_RESPONSE_MAX_BYTES, 512)


class TestGATTLocator(unittest.TestCase):
    """GATTLocator 服务/特征定位测试。"""

    def _make_client(self, services: list[MagicMock]) -> MagicMock:
        client = MagicMock()
        client.services = services
        return client

    def test_locate_success(self) -> None:
        ee02 = _make_mock_char("0000ee02-0000-1000-8000-00805f9b34fb", 9, ["notify"])
        ee03 = _make_mock_char("0000ee03-0000-1000-8000-00805f9b34fb", 12, ["write"])
        ee01 = _make_mock_service("0000ee01-0000-1000-8000-00805f9b34fb", 8, [ee02, ee03])
        client = self._make_client([ee01])

        loc = GATTLocator(client)
        loc.locate()
        self.assertTrue(loc.ee03_has_write())
        self.assertEqual(loc.ee02.handle, 9)
        self.assertEqual(loc.ee03.handle, 12)

    def test_service_not_found(self) -> None:
        client = self._make_client([])
        loc = GATTLocator(client)
        with self.assertRaises(TransportServiceNotFoundError):
            loc.locate()

    def test_ee02_not_found(self) -> None:
        ee01 = _make_mock_service("0000ee01-0000-1000-8000-00805f9b34fb", 8, [])
        client = self._make_client([ee01])
        loc = GATTLocator(client)
        with self.assertRaises(TransportServiceNotFoundError):
            loc.locate()

    def test_ee03_not_found(self) -> None:
        ee02 = _make_mock_char("0000ee02-0000-1000-8000-00805f9b34fb", 9, ["notify"])
        ee01 = _make_mock_service("0000ee01-0000-1000-8000-00805f9b34fb", 8, [ee02])
        client = self._make_client([ee01])
        loc = GATTLocator(client)
        with self.assertRaises(TransportServiceNotFoundError):
            loc.locate()

    def test_properties_before_locate_raises(self) -> None:
        client = self._make_client([])
        loc = GATTLocator(client)
        with self.assertRaises(TransportError):
            _ = loc.ee03

    def test_ee03_no_write_property(self) -> None:
        ee02 = _make_mock_char("0000ee02-0000-1000-8000-00805f9b34fb", 9, ["notify"])
        ee03 = _make_mock_char("0000ee03-0000-1000-8000-00805f9b34fb", 12, ["notify"])
        ee01 = _make_mock_service("0000ee01-0000-1000-8000-00805f9b34fb", 8, [ee02, ee03])
        client = self._make_client([ee01])
        loc = GATTLocator(client)
        loc.locate()
        self.assertFalse(loc.ee03_has_write())


class TestTransportValidation(unittest.TestCase):
    """BLETransport 参数和状态验证测试（不需要真实 BLE）。"""

    def setUp(self) -> None:
        self.mock_scanner = MagicMock(spec=ScannerInterface)
        self.mock_factory = MagicMock(spec=ClientFactoryInterface)

    def _make_connected_transport(self) -> tuple[BLETransport, MagicMock, MagicMock]:
        """创建一个已 mock 连接的 transport。"""
        t = BLETransport(scanner=self.mock_scanner, client_factory=self.mock_factory)

        mock_client = MagicMock()
        mock_client.is_connected = True
        mock_client.mtu_size = 64

        ee02 = _make_mock_char("0000ee02-0000-1000-8000-00805f9b34fb", 9, ["notify"])
        ee03 = _make_mock_char("0000ee03-0000-1000-8000-00805f9b34fb", 12, ["write"])
        ee01 = _make_mock_service("0000ee01-0000-1000-8000-00805f9b34fb", 8, [ee02, ee03])
        mock_client.services = [ee01]

        # 注入 mock client
        t._client = mock_client
        t._locator = GATTLocator(mock_client)
        t._locator.locate()

        return t, mock_client, ee02, ee03

    def test_not_connected_write_raises(self) -> None:
        t = BLETransport(scanner=self.mock_scanner, client_factory=self.mock_factory)
        with self.assertRaises(TransportNotConnectedError):
            asyncio.run(t.write_ee03(b"\x00" * 12))

    def test_not_connected_start_notify_raises(self) -> None:
        t = BLETransport(scanner=self.mock_scanner, client_factory=self.mock_factory)
        with self.assertRaises(TransportNotConnectedError):
            asyncio.run(t.start_notify(lambda s, d: None))

    def test_empty_payload_raises(self) -> None:
        t, _, _, _ = self._make_connected_transport()
        with self.assertRaises(TransportWriteError):
            asyncio.run(t.write_ee03(b""))

    def test_oversize_payload_raises(self) -> None:
        t, _, _, _ = self._make_connected_transport()
        with self.assertRaises(TransportWriteError):
            asyncio.run(t.write_ee03(b"\x00" * 513))

    def test_boundary_512_ok(self) -> None:
        """512 字节应在允许范围内。"""
        t, client, _, _ = self._make_connected_transport()
        client.write_gatt_char = AsyncMock()
        payload = b"\x00" * 512
        asyncio.run(t.write_ee03(payload))
        client.write_gatt_char.assert_awaited_once()

    def test_is_connected(self) -> None:
        t = BLETransport(scanner=self.mock_scanner, client_factory=self.mock_factory)
        self.assertFalse(t.is_connected)
        t._client = MagicMock()
        t._client.is_connected = True
        self.assertTrue(t.is_connected)

    def test_mtu_size(self) -> None:
        t = BLETransport()
        self.assertEqual(t.mtu_size, 0)
        t._client = MagicMock()
        t._client.mtu_size = 64
        self.assertEqual(t.mtu_size, 64)

    def test_already_connected_raises(self) -> None:
        t = BLETransport(scanner=self.mock_scanner, client_factory=self.mock_factory)
        t._client = MagicMock()
        t._client.is_connected = True
        with self.assertRaises(TransportError):
            asyncio.run(t.connect("AA:BB:CC:DD:EE:FF"))

    def test_connect_cleans_stale_client(self) -> None:
        """上次 partial-fail 遗留的非连接 client 应在 connect 前清理。"""
        t = BLETransport(scanner=self.mock_scanner, client_factory=self.mock_factory)
        stale = MagicMock()
        stale.is_connected = False
        stale.disconnect = AsyncMock()
        t._client = stale
        t._locator = None

        device = _make_mock_device()
        self.mock_scanner.find_device = AsyncMock(return_value=device)
        new_client = MagicMock()
        new_client.is_connected = False
        new_client.connect = AsyncMock()
        new_client.services = [
            _make_mock_service("0000ee01-0000-1000-8000-00805f9b34fb", 8, [
                _make_mock_char("0000ee02-0000-1000-8000-00805f9b34fb", 9, ["notify"]),
                _make_mock_char("0000ee03-0000-1000-8000-00805f9b34fb", 12, ["write"]),
            ])
        ]
        self.mock_factory.create_client = MagicMock(return_value=new_client)

        asyncio.run(t.connect("AA:BB:CC:DD:EE:FF"))
        stale.disconnect.assert_awaited_once()

    def test_connect_locate_failure_disconnects(self) -> None:
        """locate() 失败时应断开新创建的 client。"""
        t = BLETransport(scanner=self.mock_scanner, client_factory=self.mock_factory)
        device = _make_mock_device()
        self.mock_scanner.find_device = AsyncMock(return_value=device)
        client = MagicMock()
        client.connect = AsyncMock()
        client.disconnect = AsyncMock()
        client.services = []  # 无 EE01
        self.mock_factory.create_client = MagicMock(return_value=client)

        with self.assertRaises(TransportServiceNotFoundError):
            asyncio.run(t.connect("AA:BB:CC:DD:EE:FF"))
        client.disconnect.assert_awaited_once()
        self.assertIsNone(t._client)

    def test_start_notify_repeated_cancels_old(self) -> None:
        """重复 start_notify 先取消旧订阅再建立新订阅。"""
        t, client, _, _ = self._make_connected_transport()
        client.start_notify = AsyncMock()
        client.stop_notify = AsyncMock()

        cb1 = lambda s, d: None
        asyncio.run(t.start_notify(cb1))
        cb2 = lambda s, d: None
        asyncio.run(t.start_notify(cb2))
        client.stop_notify.assert_awaited_once()
        self.assertIs(t._notify_callback, cb2)


class TestTransportCleanup(unittest.TestCase):
    """清理语义测试（幂等 disconnect）。"""

    def test_disconnect_when_not_connected_noop(self) -> None:
        t = BLETransport()
        # 不应抛异常
        asyncio.run(t.disconnect())
        self.assertFalse(t.is_connected)

    def test_disconnect_stops_notify_first(self) -> None:
        t = BLETransport()
        client = MagicMock()
        client.is_connected = True
        client.stop_notify = AsyncMock()
        client.disconnect = AsyncMock()
        ee02 = _make_mock_char("0000ee02-0000-1000-8000-00805f9b34fb", 9, ["notify"])
        ee03 = _make_mock_char("0000ee03-0000-1000-8000-00805f9b34fb", 12, ["write"])
        ee01 = _make_mock_service("0000ee01-0000-1000-8000-00805f9b34fb", 8, [ee02, ee03])
        client.services = [ee01]
        t._client = client
        t._locator = GATTLocator(client)
        t._locator.locate()
        t._notify_callback = lambda s, d: None

        asyncio.run(t.disconnect())

        client.stop_notify.assert_awaited_once()
        client.disconnect.assert_awaited_once()

    def test_repeated_disconnect_safe(self) -> None:
        t = BLETransport()
        client = MagicMock()
        client.is_connected = True
        client.stop_notify = AsyncMock()
        client.disconnect = AsyncMock()
        ee02 = _make_mock_char("0000ee02-0000-1000-8000-00805f9b34fb", 9, ["notify"])
        ee03 = _make_mock_char("0000ee03-0000-1000-8000-00805f9b34fb", 12, ["write"])
        ee01 = _make_mock_service("0000ee01-0000-1000-8000-00805f9b34fb", 8, [ee02, ee03])
        client.services = [ee01]
        t._client = client
        t._locator = GATTLocator(client)
        t._locator.locate()
        t._notify_callback = lambda s, d: None

        # 第一次 disconnect
        asyncio.run(t.disconnect())
        # 第二次 disconnect — 应该安全
        asyncio.run(t.disconnect())


class TestTransportWriteOrder(unittest.TestCase):
    """写入验证 — response=True、使用 EE03 对象、失败不重试。"""

    def setUp(self) -> None:
        self.mock_scanner = MagicMock(spec=ScannerInterface)
        self.mock_factory = MagicMock(spec=ClientFactoryInterface)

    def _make_connected_transport(self) -> tuple[BLETransport, MagicMock, MagicMock, MagicMock]:
        t = BLETransport(scanner=self.mock_scanner, client_factory=self.mock_factory)
        client = MagicMock()
        client.is_connected = True
        client.mtu_size = 64
        ee02 = _make_mock_char("0000ee02-0000-1000-8000-00805f9b34fb", 9, ["notify"])
        ee03 = _make_mock_char("0000ee03-0000-1000-8000-00805f9b34fb", 12, ["write"])
        ee01 = _make_mock_service("0000ee01-0000-1000-8000-00805f9b34fb", 8, [ee02, ee03])
        client.services = [ee01]
        t._client = client
        t._locator = GATTLocator(client)
        t._locator.locate()
        return t, client, ee02, ee03

    def test_write_uses_response_true(self) -> None:
        t = BLETransport()
        client = MagicMock()
        client.is_connected = True
        client.write_gatt_char = AsyncMock()
        ee02 = _make_mock_char("0000ee02-0000-1000-8000-00805f9b34fb", 9, ["notify"])
        ee03 = _make_mock_char("0000ee03-0000-1000-8000-00805f9b34fb", 12, ["write"])
        ee01 = _make_mock_service("0000ee01-0000-1000-8000-00805f9b34fb", 8, [ee02, ee03])
        client.services = [ee01]
        t._client = client
        t._locator = GATTLocator(client)
        t._locator.locate()

        payload = bytes.fromhex("A10100020007110000081104")
        asyncio.run(t.write_ee03(payload))

        # 验证：使用 EE03 对象 + response=True
        call_args = client.write_gatt_char.call_args
        self.assertEqual(call_args[0][0], ee03)  # first arg is the char object
        self.assertEqual(call_args[0][1], payload)
        self.assertTrue(call_args[1].get("response"))  # keyword response=True

    def test_write_failure_no_retry(self) -> None:
        from bleak.exc import BleakError

        t = BLETransport()
        client = MagicMock()
        client.is_connected = True
        client.write_gatt_char = AsyncMock(side_effect=BleakError("Access Denied"))
        ee02 = _make_mock_char("0000ee02-0000-1000-8000-00805f9b34fb", 9, ["notify"])
        ee03 = _make_mock_char("0000ee03-0000-1000-8000-00805f9b34fb", 12, ["write"])
        ee01 = _make_mock_service("0000ee01-0000-1000-8000-00805f9b34fb", 8, [ee02, ee03])
        client.services = [ee01]
        t._client = client
        t._locator = GATTLocator(client)
        t._locator.locate()

        payload = bytes.fromhex("A10100020007110000081104")
        with self.assertRaises(TransportWriteError):
            asyncio.run(t.write_ee03(payload))

        # 只调用一次 — 无重试
        self.assertEqual(client.write_gatt_char.call_count, 1)


class TestScannerInterface(unittest.TestCase):
    """默认 ScannerInterface 使用 BleakScanner。"""

    def test_default_scanner(self) -> None:
        si = ScannerInterface()
        self.assertIsNotNone(si)

    def test_scanner_objects_passed_through(self) -> None:
        """scanner 返回的 BLEDevice 应与传给 client factory 的是同一对象。"""
        device = _make_mock_device()
        scanner = MagicMock(spec=ScannerInterface)
        scanner.find_device = AsyncMock(return_value=device)
        factory = MagicMock(spec=ClientFactoryInterface)

        client = MagicMock()
        client.is_connected = False
        client.connect = AsyncMock()
        client.services = [
            _make_mock_service("0000ee01-0000-1000-8000-00805f9b34fb", 8, [
                _make_mock_char("0000ee02-0000-1000-8000-00805f9b34fb", 9, ["notify"]),
                _make_mock_char("0000ee03-0000-1000-8000-00805f9b34fb", 12, ["write"]),
            ])
        ]
        factory.create_client = MagicMock(return_value=client)

        t = BLETransport(scanner=scanner, client_factory=factory)
        asyncio.run(t.connect(address="AA:BB:CC:DD:EE:FF"))

        # scanner 返回的 device 就是传给 factory 的 device
        factory.create_client.assert_called_once()
        passed_device = factory.create_client.call_args[0][0]
        self.assertIs(passed_device, device)

    def test_scanner_returns_none_raises(self) -> None:
        """scanner 返回 None 时 connect 抛 TransportDiscoveryError。"""
        scanner = MagicMock(spec=ScannerInterface)
        scanner.find_device = AsyncMock(return_value=None)
        factory = MagicMock(spec=ClientFactoryInterface)

        t = BLETransport(scanner=scanner, client_factory=factory)
        with self.assertRaises(TransportDiscoveryError):
            asyncio.run(t.connect("AA:BB:CC:DD:EE:FF"))
        factory.create_client.assert_not_called()

    def test_scanner_exception_preserves_cause(self) -> None:
        """scanner 抛异常时异常链保留。"""
        scanner = MagicMock(spec=ScannerInterface)
        scanner.find_device = AsyncMock(side_effect=RuntimeError("radio off"))
        factory = MagicMock(spec=ClientFactoryInterface)

        t = BLETransport(scanner=scanner, client_factory=factory)
        with self.assertRaises(TransportDiscoveryError) as ctx:
            asyncio.run(t.connect("AA:BB:CC:DD:EE:FF"))
        self.assertIsInstance(ctx.exception.__cause__, RuntimeError)
        factory.create_client.assert_not_called()

    def test_scan_timeout_passed_to_scanner(self) -> None:
        """connect 的 scan_timeout 传递给 scanner.find_device。"""
        scanner = MagicMock(spec=ScannerInterface)
        scanner.find_device = AsyncMock(return_value=_make_mock_device())
        factory = MagicMock(spec=ClientFactoryInterface)
        client = MagicMock()
        client.is_connected = False
        client.connect = AsyncMock()
        client.services = [
            _make_mock_service("0000ee01-0000-1000-8000-00805f9b34fb", 8, [
                _make_mock_char("0000ee02-0000-1000-8000-00805f9b34fb", 9, ["notify"]),
                _make_mock_char("0000ee03-0000-1000-8000-00805f9b34fb", 12, ["write"]),
            ])
        ]
        factory.create_client = MagicMock(return_value=client)

        t = BLETransport(scanner=scanner, client_factory=factory)
        asyncio.run(t.connect("AA:BB:CC:DD:EE:FF", scan_timeout=7.5))
        scanner.find_device.assert_awaited_once()
        # 验证 timeout 参数传入了
        self.assertEqual(scanner.find_device.call_args[1]["timeout"], 7.5)

    def test_connect_scan_timeout_default(self) -> None:
        """默认 scan_timeout=15.0 传入 scanner。"""
        scanner = MagicMock(spec=ScannerInterface)
        scanner.find_device = AsyncMock(return_value=_make_mock_device())
        factory = MagicMock(spec=ClientFactoryInterface)
        client = MagicMock()
        client.is_connected = False
        client.connect = AsyncMock()
        client.services = [
            _make_mock_service("0000ee01-0000-1000-8000-00805f9b34fb", 8, [
                _make_mock_char("0000ee02-0000-1000-8000-00805f9b34fb", 9, ["notify"]),
                _make_mock_char("0000ee03-0000-1000-8000-00805f9b34fb", 12, ["write"]),
            ])
        ]
        factory.create_client = MagicMock(return_value=client)

        t = BLETransport(scanner=scanner, client_factory=factory)
        asyncio.run(t.connect("AA:BB:CC:DD:EE:FF"))
        self.assertEqual(scanner.find_device.call_args[1]["timeout"], 15.0)

    def test_no_bledevice_construction(self) -> None:
        import ble_transport as bt
        with open(bt.__file__, encoding="utf-8") as f:
            source = f.read()
        lines = [l for l in source.split("\n")
                 if not l.strip().startswith("#") and not l.strip().startswith('"""')]
        code = "\n".join(lines)
        self.assertNotIn("BLEDevice(", code)

    def test_transport_no_manual_bledevice_construction(self) -> None:
        """transport 生产代码不包含手工 BLEDevice(address, address, {}) 构造。"""
        import ble_transport as bt
        with open(bt.__file__, encoding="utf-8") as f:
            source = f.read()
        # 排除注释和类型标注后，不应有 BLEDevice(" 的构造调用
        lines = [l for l in source.split("\n")
                 if not l.strip().startswith("#") and not l.strip().startswith('"""')]
        code = "\n".join(lines)
        self.assertNotIn("BLEDevice(address", code)
        self.assertNotIn("BLEDevice(\n", code)


class TestClientFactoryInterface(unittest.TestCase):
    """默认 ClientFactoryInterface 创建 BleakClient（pair=False, UNCACHED）。"""

    def test_default_factory_creates_client_with_correct_params(self) -> None:
        device = _make_mock_device()
        factory = ClientFactoryInterface()
        client = factory.create_client(device, timeout=30.0)
        self.assertIsNotNone(client)
        # 验证 BleakClient 已创建（pair=False 通过构造函数传入）
        from bleak import BleakClient as RealBleakClient
        self.assertIsInstance(client, RealBleakClient)

    def test_factory_with_address_string(self) -> None:
        factory = ClientFactoryInterface()
        client = factory.create_client("4D:F4:0E:D8:53:7D", timeout=20.0)
        self.assertIsNotNone(client)
        from bleak import BleakClient as RealBleakClient
        self.assertIsInstance(client, RealBleakClient)


class TestPayloadEncodingConsistency(unittest.TestCase):
    """验证 transport 使用的 payload 编码与阶段 5A.3 已验证帧一致。"""

    def setUp(self) -> None:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
        from protocol import encode_stop
        self.encode_stop = encode_stop

    def test_stop_frame_matches_verified(self) -> None:
        succ, vib = self.encode_stop(suction_nonce=0xA1, vibration_nonce=0xA2)
        # 阶段 5A.3 Bleak SUCCESS 验证帧
        self.assertEqual(succ, bytes.fromhex("A10100020007110000081104"))
        self.assertEqual(vib, bytes.fromhex("A20100020001110000021101"))
        self.assertEqual(len(succ), 12)
        self.assertEqual(len(vib), 12)


class TestNoBLEImportsInTests(unittest.TestCase):
    """确保 transport 不直接导入 WinRT/bleak 内部 API。"""

    def test_transport_uses_only_public_api(self) -> None:
        import ble_transport as bt
        source_file = bt.__file__ or ""
        if source_file:
            with open(source_file, encoding="utf-8") as f:
                lines = f.readlines()
            # 排注释和 docstring 后的可执行代码
            code_lines = [l for l in lines if not l.strip().startswith("#") and not l.strip().startswith('"""')]
            code_str = "".join(code_lines)
            self.assertNotIn("write_value_with_result", code_str,
                             "transport 不应直接调用 WinRT write_value_with_result 方法")
            self.assertNotIn("from winrt", code_str,
                             "transport 不应直接导入 WinRT 模块")


if __name__ == "__main__":
    unittest.main()
