#!/usr/bin/env python3
"""Create or refresh the Xiaomi token file without exposing it to Syzygy."""
from __future__ import annotations

import asyncio
import os
from pathlib import Path


async def main() -> None:
    from mi_fitness import XiaomiAuth

    target = Path(os.environ.get("MI_HEALTH_TOKEN_FILE", "/opt/syzygy/data/mi-health/token.json"))
    target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)

    async def show_qr(image_url: str, login_url: str) -> None:
        print("请在可信设备上扫描以下登录二维码地址；不要把该地址或任何 token 发到聊天中：")
        print(image_url)
        print("登录跳转地址：", login_url)

    async with XiaomiAuth() as auth:
        await auth.login_qr(qr_callback=show_qr)
        auth.save_token(str(target))
    os.chmod(target, 0o600)
    print(f"登录完成，token 已保存到 {target}（权限 600）。")


if __name__ == "__main__":
    asyncio.run(main())
