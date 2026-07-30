@echo off
set TOY_BLE_ADDRESS=4D:F4:0E:D8:53:7D
set TOY_MCP_TOKEN=111111
echo Starting Toy MCP Server...
echo BLE Address: %TOY_BLE_ADDRESS%
echo HTTP: http://127.0.0.1:8000
echo.
.venv\Scripts\python.exe tools\ble\toy_mcp_server.py
pause
