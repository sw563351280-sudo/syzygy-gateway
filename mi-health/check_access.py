#!/usr/bin/env python3
"""One-command, non-sensitive connectivity check for Xiaomi health access."""
from __future__ import annotations

import argparse
import asyncio
from datetime import datetime
from pathlib import Path
import sys
from zoneinfo import ZoneInfo

ALLOWED_API_BASES = {"https://hlth.io.mi.com", "https://ru.hlth.io.mi.com"}


def uid(value: str) -> int:
    if not value.isdecimal():
        raise argparse.ArgumentTypeError("uid must contain digits only")
    return int(value)


def api_base(value: str) -> str:
    normalized = value.strip().rstrip("/")
    if normalized not in ALLOWED_API_BASES:
        raise argparse.ArgumentTypeError("api base is not an allowed Xiaomi health endpoint")
    return normalized


def safe_error_label(error: Exception) -> str:
    """Expose only numeric protocol metadata, never response bodies or credentials."""
    parts = [f"CHECK_FAILED {type(error).__name__}"]
    for attribute in ("code", "status_code"):
        value = getattr(error, attribute, None)
        if isinstance(value, (int, float)):
            parts.append(f"{attribute}={value}")
    return " ".join(parts)


async def check_access(user_id: int, token_file: Path, base_url: str) -> None:
    from loguru import logger
    from mi_fitness import MiHealthClient

    logger.disable("mi_fitness")
    today = datetime.now(ZoneInfo("Asia/Shanghai")).date()
    async with MiHealthClient.from_token(str(token_file), base_url=base_url) as client:
        records = await asyncio.wait_for(client.get_steps(user_id, today), timeout=45)
    print(f"CHECK_OK steps_records={len(records)}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Check Xiaomi health access without printing health data.")
    parser.add_argument("--uid", type=uid, required=True, help="Xiaomi user ID to check")
    parser.add_argument(
        "--token-file",
        type=Path,
        default=Path("/opt/syzygy/data/mi-health/token.json"),
        help="path to the locally stored Xiaomi token",
    )
    parser.add_argument("--api-base", type=api_base, default="https://hlth.io.mi.com")
    args = parser.parse_args()
    try:
        asyncio.run(check_access(args.uid, args.token_file, args.api_base))
    except TimeoutError:
        print("CHECK_TIMEOUT")
        return 2
    except Exception as error:
        print(safe_error_label(error))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
