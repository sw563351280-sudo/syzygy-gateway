"""
Bleak 3.0.2 BLE Transport 模块。

复用已验证的连接/通知/写入模式（阶段 5A.3）。
纯 Bleak 公共 API，不访问 _backend。

协议 UUID 和编码函数来自 protocol.py。
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Callable, Optional

from bleak import BleakClient, BleakScanner  # type: ignore[import-untyped]
from bleak.backends.device import BLEDevice  # type: ignore[import-untyped]
from bleak.backends.characteristic import BleakGATTCharacteristic  # type: ignore[import-untyped]
from bleak.backends.service import BleakGATTService  # type: ignore[import-untyped]
from bleak.exc import BleakError  # type: ignore[import-untyped]

import os as _os
import sys as _sys
_this_dir = _os.path.dirname(_os.path.abspath(__file__))
if _this_dir not in _sys.path:
    _sys.path.insert(0, _this_dir)
from protocol import (  # type: ignore[import-not-found]
    SERVICE_UUID,
    NOTIFY_UUID,
    WRITE_UUID,
    format_hex_payload,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# 常量
# ---------------------------------------------------------------------------

WRITE_RESPONSE_MAX_BYTES = 512

# ---------------------------------------------------------------------------
# 错误
# ---------------------------------------------------------------------------

class TransportError(Exception):
    """transport 层错误。"""


class TransportNotConnectedError(TransportError):
    """操作要求已连接但未连接。"""


class TransportServiceNotFoundError(TransportError):
    """目标 Service/Characteristic 未找到。"""


class TransportWriteError(TransportError):
    """写入失败（含 BleakError/BleakGATTProtocolError 包装）。"""


class TransportDiscoveryError(TransportError):
    """设备发现失败（扫描未找到或异常）。"""


# ---------------------------------------------------------------------------
# 可 mock 接口
# ---------------------------------------------------------------------------

class ScannerInterface:
    """可替换的扫描接口。默认使用 BleakScanner。"""

    async def find_device(
        self, address: str, timeout: float = 15.0
    ) -> BLEDevice | None:
        """按地址查找 BLE 设备。返回 None 表示未找到。"""
        return await BleakScanner.find_device_by_address(
            address, timeout=timeout,
        )


class ClientFactoryInterface:
    """可替换的客户端工厂。默认创建 BleakClient。"""

    def create_client(
        self, address_or_device: str | BLEDevice, timeout: float = 30.0
    ) -> BleakClient:
        """创建 BleakClient（pair=False, UNCACHED）。"""
        return BleakClient(
            address_or_device,
            pair=False,
            winrt={"use_cached_services": False},
            timeout=timeout,
        )


# ---------------------------------------------------------------------------
# 原生 WinRT 扫描 + Bleak 适配
# ---------------------------------------------------------------------------

class NativeScannerAdapter(ScannerInterface):
    """ScannerInterface 的原生 WinRT 实现。

    使用 NativeWinRTScanner 发现设备，通过 adapt_native_discovery 构造 BLEDevice。
    """

    async def find_device(
        self, address: str, timeout: float = 15.0
    ) -> BLEDevice | None:
        from native_scanner import (  # type: ignore[import-not-found]
            NativeWinRTScanner,
            adapt_native_discovery,
        )
        scanner = NativeWinRTScanner()
        result = await scanner.find_device(address, timeout=timeout)
        if result is None:
            return None
        return adapt_native_discovery(result)


class NativeClientFactory(ClientFactoryInterface):
    """ClientFactoryInterface — pair=False, UNCACHED, 传递 address_type。"""

    def create_client(
        self, address_or_device: str | BLEDevice, timeout: float = 30.0
    ) -> BleakClient:
        winrt_config: dict[str, Any] = {"use_cached_services": False}

        # 从 BLEDevice.details 提取原生发现的 address_type
        if isinstance(address_or_device, BLEDevice):
            details = getattr(address_or_device, "details", None) or {}
            at = details.get("_address_type")
            if at in ("public", "random"):
                winrt_config["address_type"] = at

        return BleakClient(
            address_or_device,
            pair=False,
            winrt=winrt_config,
            timeout=timeout,
        )


# ---------------------------------------------------------------------------
# GATT 定位
# ---------------------------------------------------------------------------

class GATTLocator:
    """从 BleakClient.services 中定位 EE01/EE02/EE03。"""

    def __init__(self, client: BleakClient) -> None:
        self._client = client
        self._ee01: BleakGATTService | None = None
        self._ee02: BleakGATTCharacteristic | None = None
        self._ee03: BleakGATTCharacteristic | None = None
        self._located = False

    def locate(self) -> None:
        """在 client.services 中定位 EE01 Service 及 EE02/EE03 Characteristic。

        Raises:
            TransportServiceNotFoundError: 任一项未找到。
        """
        for svc in self._client.services:
            if svc.uuid.lower() == SERVICE_UUID:
                self._ee01 = svc
                for ch in svc.characteristics:
                    cu = ch.uuid.lower()
                    if cu == NOTIFY_UUID:
                        self._ee02 = ch
                    elif cu == WRITE_UUID:
                        self._ee03 = ch
                break

        if self._ee01 is None:
            raise TransportServiceNotFoundError(
                f"Service {SERVICE_UUID} not found"
            )
        if self._ee02 is None:
            raise TransportServiceNotFoundError(
                f"Characteristic {NOTIFY_UUID} not found in {SERVICE_UUID}"
            )
        if self._ee03 is None:
            raise TransportServiceNotFoundError(
                f"Characteristic {WRITE_UUID} not found in {SERVICE_UUID}"
            )

        self._located = True

    @property
    def ee01(self) -> BleakGATTService:
        if not self._located:
            raise TransportError("locate() not called")
        return self._ee01  # type: ignore[return-value]

    @property
    def ee02(self) -> BleakGATTCharacteristic:
        if not self._located:
            raise TransportError("locate() not called")
        return self._ee02  # type: ignore[return-value]

    @property
    def ee03(self) -> BleakGATTCharacteristic:
        if not self._located:
            raise TransportError("locate() not called")
        return self._ee03  # type: ignore[return-value]

    def ee03_has_write(self) -> bool:
        return "write" in (self.ee03.properties or [])


# ---------------------------------------------------------------------------
# Transport
# ---------------------------------------------------------------------------

class BLETransport:
    """Bleak BLE transport — 扫描、连接、通知、写入、清理。

    用法::

        transport = BLETransport()
        await transport.connect("4D:F4:0E:D8:53:7D")
        await transport.start_notify(my_callback)
        await transport.write_ee03(payload)
        await transport.stop_notify()
        await transport.disconnect()
    """

    def __init__(
        self,
        scanner: ScannerInterface | None = None,
        client_factory: ClientFactoryInterface | None = None,
    ) -> None:
        self._scanner = scanner or NativeScannerAdapter()
        self._client_factory = client_factory or NativeClientFactory()
        self._client: BleakClient | None = None
        self._locator: GATTLocator | None = None
        self._notify_callback: Callable[[Any, bytearray], None] | None = None
        self._native_result: Any = None  # NativeDiscoveryResult，供调试

    # ---- 连接 ----

    async def connect(
        self,
        address: str,
        scan_timeout: float = 15.0,
        connect_timeout: float = 30.0,
    ) -> None:
        """扫描目标并建立 Bleak 连接。

        一次原生 WinRT watcher 扫描，受 scan_timeout 限制。
        连接成功后才执行 GATT 定位。
        部分失败时自动清理已创建的资源。
        """
        # 防止重复连接或覆盖未清理的已连接 client
        if self._client is not None:
            if self._client.is_connected:
                raise TransportError("Already connected")
            try:
                await asyncio.wait_for(self._client.disconnect(), timeout=5.0)
            except Exception:
                pass
            self._client = None
            self._locator = None

        # 一次原生 WinRT 扫描
        try:
            device = await self._scanner.find_device(address, timeout=scan_timeout)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            raise TransportDiscoveryError(
                f"BLE scan failed for {address}: {exc}"
            ) from exc
        if device is None:
            raise TransportDiscoveryError(
                f"Device {address} not found via native WinRT scan"
            )

        # 连接 — BLEDevice 原样传入 BleakClient，不触发第二次扫描
        client = self._client_factory.create_client(device, timeout=connect_timeout)
        await asyncio.wait_for(client.connect(), timeout=connect_timeout)

        self._client = client
        self._locator = GATTLocator(client)
        try:
            self._locator.locate()
        except Exception:
            try:
                await asyncio.wait_for(client.disconnect(), timeout=5.0)
            except Exception:
                pass
            self._client = None
            self._locator = None
            raise

        logger.debug("Connected to %s  mtu=%s", address, client.mtu_size)

    @property
    def is_connected(self) -> bool:
        return self._client is not None and self._client.is_connected

    @property
    def mtu_size(self) -> int:
        if self._client is None:
            return 0
        return self._client.mtu_size

    # ---- 通知 ----

    async def start_notify(
        self,
        callback: Callable[[Any, bytearray], None],
        timeout: float = 30.0,
    ) -> None:
        """订阅 EE02 通知。重复调用会先取消旧订阅。"""
        self._require_connected()
        # 重复调用时先取消旧订阅，避免重复 CCCD 写入
        if self._notify_callback is not None:
            try:
                await self.stop_notify(timeout=5.0)
            except Exception:
                pass
        self._notify_callback = callback
        await asyncio.wait_for(
            self._client.start_notify(self._locator.ee02, callback),  # type: ignore[union-attr]
            timeout=timeout,
        )

    async def stop_notify(self, timeout: float = 10.0) -> None:
        """取消 EE02 订阅（幂等）。"""
        if self._client is None or not self._client.is_connected:
            self._notify_callback = None
            return
        if self._notify_callback is None:
            return
        try:
            await asyncio.wait_for(
                self._client.stop_notify(self._locator.ee02),  # type: ignore[union-attr]
                timeout=timeout,
            )
        except Exception:
            logger.debug("stop_notify: ignored exception", exc_info=True)
        finally:
            self._notify_callback = None

    # ---- 写入 ----

    async def write_ee03(self, payload: bytes, timeout: float = 30.0) -> None:
        """向 EE03 写入 payload（write with response）。

        写入前验证：
        - 已连接
        - EE03 包含 write 属性
        - payload 非空
        - payload 长度 ≤ 512

        Raises:
            TransportNotConnectedError: 未连接。
            TransportWriteError: 写入失败或验证失败。
        """
        self._require_connected()

        if not self._locator.ee03_has_write():  # type: ignore[union-attr]
            raise TransportWriteError("EE03 does not support write")

        if not payload:
            raise TransportWriteError("payload is empty")

        if len(payload) > WRITE_RESPONSE_MAX_BYTES:
            raise TransportWriteError(
                f"payload {len(payload)}B exceeds {WRITE_RESPONSE_MAX_BYTES}B limit"
            )

        logger.debug(
            "EE03 write (response=True): %s",
            format_hex_payload(payload),
        )
        try:
            await asyncio.wait_for(
                self._client.write_gatt_char(  # type: ignore[union-attr]
                    self._locator.ee03,  # type: ignore[union-attr]
                    payload,
                    response=True,
                ),
                timeout=timeout,
            )
        except BleakError as exc:
            raise TransportWriteError(f"EE03 write failed: {exc}") from exc

    # ---- 清理 ----

    async def disconnect(self) -> None:
        """断开连接并清理资源（幂等）。"""
        # 先取消通知
        await self.stop_notify()

        if self._client is not None and self._client.is_connected:
            try:
                await asyncio.wait_for(self._client.disconnect(), timeout=10.0)
            except Exception:
                logger.debug("disconnect: ignored exception", exc_info=True)

        self._client = None
        self._locator = None

    # ---- 内部 ----

    def _require_connected(self) -> None:
        if not self.is_connected:
            raise TransportNotConnectedError("Not connected")

    def get_locator(self) -> GATTLocator | None:
        """获取 GATT 定位器（供诊断用）。"""
        return self._locator
