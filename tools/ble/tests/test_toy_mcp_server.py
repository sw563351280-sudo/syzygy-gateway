"""Regression tests for duration-free toy controls."""

from __future__ import annotations

import asyncio
import os
import sys
import unittest
from pathlib import Path


os.environ.setdefault("TOY_BLE_ADDRESS", "00:11:22:33:44:55")
os.environ.setdefault("TOY_MCP_TOKEN", "test-token")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import toy_mcp_server  # noqa: E402


class TestDurationFreeControls(unittest.TestCase):
    def setUp(self) -> None:
        self.original_is_live = toy_mcp_server._is_live
        self.original_vibrate = toy_mcp_server._do_vibrate
        self.original_suction = toy_mcp_server._do_suction
        self.calls: list[tuple[str, int]] = []
        toy_mcp_server._is_live = lambda: True

        async def record_vibrate(intensity: int) -> None:
            self.calls.append(("vibration", intensity))

        async def record_suction(intensity: int) -> None:
            self.calls.append(("suction", intensity))

        toy_mcp_server._do_vibrate = record_vibrate
        toy_mcp_server._do_suction = record_suction

    def tearDown(self) -> None:
        toy_mcp_server._is_live = self.original_is_live
        toy_mcp_server._do_vibrate = self.original_vibrate
        toy_mcp_server._do_suction = self.original_suction

    def test_schemas_only_require_intensity(self) -> None:
        for name in ("toy_vibrate", "toy_suction"):
            tool = next(item for item in toy_mcp_server.TOOLS_DEF if item["name"] == name)
            schema = tool["inputSchema"]
            self.assertEqual(schema["required"], ["intensity"])
            self.assertNotIn("duration_seconds", schema["properties"])

    def test_vibration_and_suction_stay_active_until_stopped(self) -> None:
        # Supplying a legacy duration is harmless, but it no longer controls timing.
        vibration = asyncio.run(toy_mcp_server._execute_tool(
            "toy_vibrate", {"intensity": 40, "duration_seconds": 30}
        ))
        suction = asyncio.run(toy_mcp_server._execute_tool("toy_suction", {"intensity": 20}))

        self.assertEqual(self.calls, [("vibration", 40), ("suction", 20)])
        self.assertEqual(vibration, "OK intensity=40; active until stopped")
        self.assertEqual(suction, "OK intensity=20; active until stopped")
        self.assertFalse(hasattr(toy_mcp_server, "_schedule_auto_stop"))


if __name__ == "__main__":
    unittest.main()
