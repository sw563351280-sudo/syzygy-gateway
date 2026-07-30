#!/usr/bin/env python3
"""
离线协议 dry-run CLI。

纯离线：parse / compare / inspect / encode。
不导入 bleak/winrt/asyncio，不执行 BLE 操作。
"""

from __future__ import annotations

import argparse
import sys

from protocol import (
    PAYLOAD_LENGTH,
    EvidenceLevel,
    EncodedCommand,
    ProtocolNotEstablishedError,
    build_tutorial_evidence,
    compare_payloads,
    decode_frame,
    encode_suction,
    encode_vibration,
    encode_stop,
    format_hex_payload,
    get_field_descriptions,
    inspect_payload,
    parse_hex_payload,
)


def _parse_nonce(text: str) -> int:
    """解析 nonce 参数：支持十进制、0xAA、AA。"""
    text = text.strip()
    if text.lower().startswith("0x"):
        val = int(text, 16)
    elif all(c in "0123456789ABCDEFabcdef" for c in text) and len(text) == 2:
        # 两位纯十六进制（不含 0x 前缀）
        val = int(text, 16)
    else:
        val = int(text, 10)
    return val


def _print_payload(payload: bytes, label: str = "Payload") -> None:
    """打印 payload 及其字段分解。"""
    info = inspect_payload(payload)
    fields_desc = get_field_descriptions()
    print(f"{label} ({info.length} bytes): {info.hex_string}")
    print(f"  Offset  Value   Description")
    for f in info.fields:
        val = f.known_values[0] if f.known_values else 0
        desc = fields_desc.get(f.offset, f.meaning)
        level = f.evidence_level.value
        print(f"    {f.offset:>4}   0x{val:02X}    {desc}  [{level}]")


def _print_encoded(cmd: EncodedCommand) -> None:
    """打印编码后的命令信息。"""
    print(f"DRY RUN: no BLE operation performed")
    print(f"Command        : {cmd.kind.value}")
    print(f"Intensity      : {cmd.intensity}")
    print(f"Nonce          : 0x{cmd.nonce:02X} ({cmd.nonce})")
    print(f"Func ID        : 0x{cmd.func_id:02X}")
    print(f"Tail           : {format_hex_payload(bytes(cmd.tail))}")
    _print_payload(cmd.payload, "Payload       ")
    print(f"Description    : {cmd.description}")


# ---------------------------------------------------------------------------
# 子命令
# ---------------------------------------------------------------------------

def cmd_parse(args: argparse.Namespace) -> int:
    try:
        payload = parse_hex_payload(args.text)
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    try:
        cmd = decode_frame(payload)
        _print_encoded(cmd)
    except Exception:
        _print_payload(payload, "Payload")
        print(f"DRY RUN: no BLE operation performed")
    return 0


def cmd_compare(args: argparse.Namespace) -> int:
    try:
        left = parse_hex_payload(args.left)
    except Exception as exc:
        print(f"Error parsing LEFT: {exc}", file=sys.stderr)
        return 1
    try:
        right = parse_hex_payload(args.right)
    except Exception as exc:
        print(f"Error parsing RIGHT: {exc}", file=sys.stderr)
        return 1

    diffs = compare_payloads(left, right)

    print(f"DRY RUN: no BLE operation performed")
    print(f"Left  ({len(left)} bytes): {format_hex_payload(left)}")
    print(f"Right ({len(right)} bytes): {format_hex_payload(right)}")

    if not diffs:
        print("Result: IDENTICAL")
    else:
        print(f"Result: {len(diffs)} byte(s) differ")
        for d in diffs:
            print(f"  offset {d.offset:>2}:  left=0x{d.left_byte:02X} ({d.left_byte:>3})  "
                  f"right=0x{d.right_byte:02X} ({d.right_byte:>3})")
    return 0


def cmd_inspect(args: argparse.Namespace) -> int:
    try:
        payload = parse_hex_payload(args.text)
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    info = inspect_payload(payload)
    fields_desc = get_field_descriptions()

    print(f"DRY RUN: no BLE operation performed")
    print(f"Payload length : {info.length} bytes")
    print(f"Hex            : {info.hex_string}")
    print()
    print(f"  {'Offset':<8} {'Hex':<6} {'Dec':<5} {'Description':<40} {'Evidence'}")
    print(f"  {'-'*8} {'-'*6} {'-'*5} {'-'*40} {'-'*16}")
    for f in info.fields:
        val = f.known_values[0] if f.known_values else 0
        desc = fields_desc.get(f.offset, f.meaning)
        level = f.evidence_level.value
        print(f"  {f.offset:<8} 0x{val:02X}   {val:<5} {desc:<40} {level}")
    return 0


def cmd_encode(args: argparse.Namespace) -> int:
    sub = args.encode_sub

    try:
        if sub == "suction":
            intensity = args.intensity
            nonce = _parse_nonce(args.nonce)
            payload = encode_suction(intensity=intensity, nonce=nonce)
            cmd = decode_frame(payload)
            _print_encoded(cmd)

        elif sub == "vibration":
            intensity = args.intensity
            nonce = _parse_nonce(args.nonce)
            payload = encode_vibration(intensity=intensity, nonce=nonce)
            cmd = decode_frame(payload)
            _print_encoded(cmd)

        elif sub == "stop":
            s_nonce = _parse_nonce(args.suction_nonce)
            v_nonce = _parse_nonce(args.vibration_nonce)
            succ, vib = encode_stop(suction_nonce=s_nonce, vibration_nonce=v_nonce)

            print(f"DRY RUN: no BLE operation performed")
            print(f"Stop sequence (suction stop → vibration stop):")
            print()

            cmd_s = decode_frame(succ)
            print(f"  Frame 1/2 — {cmd_s.description}")
            _print_payload(succ, "  Payload       ")
            print()

            cmd_v = decode_frame(vib)
            print(f"  Frame 2/2 — {cmd_v.description}")
            _print_payload(vib, "  Payload       ")
        else:
            print(f"Unknown encode subcommand: {sub}", file=sys.stderr)
            return 1
    except (ValueError, TypeError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    except ProtocolNotEstablishedError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    return 0


# ---------------------------------------------------------------------------
# 入口
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="离线 BLE 协议 dry-run 工具"
    )
    sub = parser.add_subparsers(dest="command", help="子命令")

    # parse
    p_parse = sub.add_parser("parse", help="解析十六进制 payload")
    p_parse.add_argument("text", type=str, help="十六进制文本 (可含空格)")

    # compare
    p_cmp = sub.add_parser("compare", help="比较两个 payload")
    p_cmp.add_argument("left", type=str, help="第一个 payload (hex)")
    p_cmp.add_argument("right", type=str, help="第二个 payload (hex)")

    # inspect
    p_inspect = sub.add_parser("inspect", help="检查 payload 结构")
    p_inspect.add_argument("text", type=str, help="十六进制文本 (可含空格)")

    # encode
    p_encode = sub.add_parser("encode", help="编码命令")
    e_sub = p_encode.add_subparsers(dest="encode_sub", help="命令类型")

    p_suction = e_sub.add_parser("suction", help="编码吮吸命令")
    p_suction.add_argument("--intensity", type=int, required=True, help="强度 (0–100)")
    p_suction.add_argument("--nonce", type=str, required=True, help="nonce (0–255, 十进制/0xAA/AA)")

    p_vibration = e_sub.add_parser("vibration", help="编码震动命令")
    p_vibration.add_argument("--intensity", type=int, required=True, help="强度 (0–100)")
    p_vibration.add_argument("--nonce", type=str, required=True, help="nonce (0–255, 十进制/0xAA/AA)")

    p_stop = e_sub.add_parser("stop", help="编码停止命令")
    p_stop.add_argument("--suction-nonce", type=str, required=True, help="吮吸停止 nonce")
    p_stop.add_argument("--vibration-nonce", type=str, required=True, help="震动停止 nonce")

    args = parser.parse_args()

    if args.command is None:
        parser.print_help()
        sys.exit(0)

    handlers = {
        "parse": cmd_parse,
        "compare": cmd_compare,
        "inspect": cmd_inspect,
        "encode": cmd_encode,
    }

    handler = handlers.get(args.command)
    if handler:
        sys.exit(handler(args))
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
