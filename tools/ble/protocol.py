"""
SOSEXY BLE 离线协议模块。

基于教程 PDF「啵啵贝接入claude教程（速通手把手版）」的 12 字节 payload 规则。
纯数据结构 + 纯函数。不导入 bleak/winrt/asyncio。
不包含真实设备地址、不执行 BLE 操作、不发送 payload。
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

# ---------------------------------------------------------------------------
# 常量
# ---------------------------------------------------------------------------

PAYLOAD_LENGTH: int = 12

SERVICE_UUID: str = "0000ee01-0000-1000-8000-00805f9b34fb"
NOTIFY_UUID: str = "0000ee02-0000-1000-8000-00805f9b34fb"
WRITE_UUID: str = "0000ee03-0000-1000-8000-00805f9b34fb"

# 备用端点（用途未确认）
ALT_SERVICE_UUID: str = "0000ae00-0000-1000-8000-00805f9b34fb"
ALT_NOTIFY_UUID: str = "0000ae02-0000-1000-8000-00805f9b34fb"
ALT_WRITE_UUID: str = "0000ae01-0000-1000-8000-00805f9b34fb"

# 命令常量（教程已确认）
INTENSITY_MIN: int = 0
INTENSITY_MAX: int = 100
NONCE_MIN: int = 0
NONCE_MAX: int = 255

FUNC_ID_VIBRATION: int = 0x01
FUNC_ID_SUCTION: int = 0x07

TAIL_VIBRATION: tuple[int, int, int] = (0x02, 0x11, 0x01)
TAIL_SUCTION: tuple[int, int, int] = (0x08, 0x11, 0x04)

# 固定字节
FIXED_BYTE_1: int = 0x01   # offset 1
FIXED_BYTE_3: int = 0x02   # offset 3
FIXED_BYTE_6: int = 0x11   # offset 6

# ---------------------------------------------------------------------------
# 错误类型
# ---------------------------------------------------------------------------

class ProtocolError(Exception):
    """协议相关错误基类。"""


class InvalidPayloadError(ProtocolError):
    """payload 格式或长度无效。"""


class ProtocolNotEstablishedError(ProtocolError):
    """协议编码规则尚未确认，无法生成 payload。"""


# ---------------------------------------------------------------------------
# 证据类型
# ---------------------------------------------------------------------------

class EvidenceLevel(Enum):
    """证据等级。"""
    GATT_CONFIRMED = "GATT_CONFIRMED"         # 本机设备枚举直接确认
    TUTORIAL_CONFIRMED = "TUTORIAL_CONFIRMED"  # PDF 源码明确给出
    DEVICE_OBSERVED = "DEVICE_OBSERVED"        # 实际设备测试确认
    UNKNOWN = "UNKNOWN"                        # 没有证据


class CommandKind(Enum):
    """命令类型。"""
    SUCTION = "suction"
    VIBRATION = "vibration"
    STOP = "stop"
    UNKNOWN = "unknown"


@dataclass(frozen=True)
class FieldEvidence:
    """单个协议字段的证据。"""
    offset: int
    label: str = "UNKNOWN"
    known_values: list[int] = field(default_factory=list)
    meaning: str = "UNKNOWN"
    evidence_level: EvidenceLevel = EvidenceLevel.UNKNOWN
    evidence: str = "无样本"


@dataclass(frozen=True)
class ProtocolEvidence:
    """完整 12 字节协议的已知证据。"""
    fields: list[FieldEvidence] = field(default_factory=lambda: [
        FieldEvidence(offset=i) for i in range(PAYLOAD_LENGTH)
    ])
    command_samples: dict[CommandKind, list[bytes]] = field(default_factory=dict)

    @property
    def has_any_sample(self) -> bool:
        return any(self.command_samples.values())

    @property
    def confirmed_fields(self) -> int:
        return sum(
            1 for f in self.fields
            if f.evidence_level in (EvidenceLevel.GATT_CONFIRMED, EvidenceLevel.TUTORIAL_CONFIRMED)
        )

    @property
    def unknown_fields(self) -> int:
        return sum(1 for f in self.fields if f.evidence_level == EvidenceLevel.UNKNOWN)


@dataclass(frozen=True)
class PayloadDiff:
    """两个 payload 的逐字节差异。"""
    offset: int
    left_byte: int
    right_byte: int


@dataclass(frozen=True)
class PayloadInfo:
    """解析后的 payload 信息。"""
    raw: bytes
    hex_string: str
    length: int
    fields: list[FieldEvidence] = field(default_factory=list)


@dataclass(frozen=True)
class EncodedCommand:
    """编码后的命令信息。"""
    kind: CommandKind
    intensity: int
    nonce: int
    payload: bytes
    func_id: int
    tail: tuple[int, int, int]
    description: str


# ---------------------------------------------------------------------------
# 默认证据（基于教程 PDF + GATT 枚举）
# ---------------------------------------------------------------------------

def build_tutorial_evidence() -> ProtocolEvidence:
    """构建基于当前教程和 GATT 枚举的协议证据。"""
    fields: list[FieldEvidence] = []
    for i in range(PAYLOAD_LENGTH):
        if i == 0:
            fields.append(FieldEvidence(
                offset=0, label="nonce",
                meaning="随机/计数器字节, 0x00–0xFF",
                evidence_level=EvidenceLevel.TUTORIAL_CONFIRMED,
                evidence="教程 random.randint(0, 255)",
            ))
        elif i == 1:
            fields.append(FieldEvidence(
                offset=1, label="fixed_1",
                known_values=[0x01], meaning="固定字节",
                evidence_level=EvidenceLevel.TUTORIAL_CONFIRMED,
                evidence="教程码字 0x01",
            ))
        elif i == 2:
            fields.append(FieldEvidence(
                offset=2, label="fixed_2",
                known_values=[0x00], meaning="固定字节 (保留)",
                evidence_level=EvidenceLevel.TUTORIAL_CONFIRMED,
                evidence="教程码字 0x00",
            ))
        elif i == 3:
            fields.append(FieldEvidence(
                offset=3, label="fixed_3",
                known_values=[0x02], meaning="固定字节",
                evidence_level=EvidenceLevel.TUTORIAL_CONFIRMED,
                evidence="教程码字 0x02",
            ))
        elif i == 4:
            fields.append(FieldEvidence(
                offset=4, label="fixed_4",
                known_values=[0x00], meaning="固定字节 (保留)",
                evidence_level=EvidenceLevel.TUTORIAL_CONFIRMED,
                evidence="教程码字 0x00",
            ))
        elif i == 5:
            fields.append(FieldEvidence(
                offset=5, label="func_id",
                meaning="命令类型: 0x01=震动, 0x07=吮吸",
                evidence_level=EvidenceLevel.TUTORIAL_CONFIRMED,
                evidence="教程 func_id",
            ))
        elif i == 6:
            fields.append(FieldEvidence(
                offset=6, label="fixed_6",
                known_values=[0x11], meaning="固定字节",
                evidence_level=EvidenceLevel.TUTORIAL_CONFIRMED,
                evidence="教程码字 0x11",
            ))
        elif i == 7:
            fields.append(FieldEvidence(
                offset=7, label="intensity",
                meaning="强度 0–100",
                evidence_level=EvidenceLevel.TUTORIAL_CONFIRMED,
                evidence="教程 intensity 0..100",
            ))
        elif i == 8:
            fields.append(FieldEvidence(
                offset=8, label="fixed_8",
                known_values=[0x00], meaning="固定字节 (保留)",
                evidence_level=EvidenceLevel.TUTORIAL_CONFIRMED,
                evidence="教程码字 0x00",
            ))
        elif i in (9, 10, 11):
            tail_idx = i - 9
            fields.append(FieldEvidence(
                offset=i, label=f"tail[{tail_idx}]",
                meaning=f"命令尾缀 byte {tail_idx}",
                evidence_level=EvidenceLevel.TUTORIAL_CONFIRMED,
                evidence="教程 tail[{0}]".format(tail_idx),
            ))
    return ProtocolEvidence(fields=fields)


# ---------------------------------------------------------------------------
# 纯函数：解析/格式化/比较
# ---------------------------------------------------------------------------

_HEX_PATTERN = re.compile(r"^[0-9A-Fa-f]+$")


def parse_hex_payload(text: str) -> bytes:
    """解析十六进制文本 → bytes。

    Args:
        text: 十六进制字符串，可含空格，大小写不敏感。

    Returns:
        12 字节 payload。

    Raises:
        InvalidPayloadError: 格式无效或长度不正确。
    """
    cleaned = re.sub(r"\s+", "", text.strip())
    if not cleaned:
        raise InvalidPayloadError("Empty input")

    if not _HEX_PATTERN.match(cleaned):
        raise InvalidPayloadError(f"Non-hex characters in input: '{text.strip()}'")

    if len(cleaned) % 2 != 0:
        raise InvalidPayloadError(
            f"Odd number of hex characters ({len(cleaned)}): '{text.strip()}'"
        )

    result = bytes.fromhex(cleaned)
    validate_payload_length(result)
    return result


def format_hex_payload(payload: bytes) -> str:
    """bytes → 大写两位十六进制，字节间一个空格。"""
    return " ".join(f"{b:02X}" for b in payload)


def validate_payload_length(payload: bytes) -> None:
    """严格要求 12 字节。

    Raises:
        InvalidPayloadError: 长度不是 12。
    """
    if len(payload) != PAYLOAD_LENGTH:
        raise InvalidPayloadError(
            f"Payload must be {PAYLOAD_LENGTH} bytes, got {len(payload)}"
        )


def compare_payloads(left: bytes, right: bytes) -> list[PayloadDiff]:
    """逐字节比较两个 payload，返回所有差异。"""
    validate_payload_length(left)
    validate_payload_length(right)

    diffs: list[PayloadDiff] = []
    for i in range(PAYLOAD_LENGTH):
        if left[i] != right[i]:
            diffs.append(PayloadDiff(offset=i, left_byte=left[i], right_byte=right[i]))
    return diffs


def inspect_payload(
    payload: bytes,
    evidence: ProtocolEvidence | None = None,
) -> PayloadInfo:
    """检查 payload 并生成结构信息。"""
    validate_payload_length(payload)

    if evidence is None:
        evidence = build_tutorial_evidence()

    fields: list[FieldEvidence] = [
        FieldEvidence(
            offset=ef.offset,
            label=ef.label,
            known_values=[payload[ef.offset]] + ef.known_values,
            meaning=ef.meaning,
            evidence_level=ef.evidence_level,
            evidence=ef.evidence,
        )
        for ef in evidence.fields
    ]

    return PayloadInfo(
        raw=payload,
        hex_string=format_hex_payload(payload),
        length=len(payload),
        fields=fields,
    )


# ---------------------------------------------------------------------------
# 编码函数（TUTORIAL_CONFIRMED）
# ---------------------------------------------------------------------------

def _validate_intensity(intensity: int) -> None:
    """校验强度值。拒绝 bool、float 子类。"""
    if type(intensity) is not int:
        raise TypeError(
            f"intensity must be a strict int, got {type(intensity).__name__}"
        )
    if intensity < INTENSITY_MIN or intensity > INTENSITY_MAX:
        raise ValueError(
            f"intensity must be {INTENSITY_MIN}..{INTENSITY_MAX}, got {intensity}"
        )


def _validate_nonce(nonce: int) -> None:
    """校验 nonce。拒绝 bool。"""
    if type(nonce) is not int:
        raise TypeError(
            f"nonce must be a strict int, got {type(nonce).__name__}"
        )
    if nonce < NONCE_MIN or nonce > NONCE_MAX:
        raise ValueError(
            f"nonce must be {NONCE_MIN}..{NONCE_MAX}, got {nonce}"
        )


def _encode_frame(nonce: int, func_id: int, intensity: int, tail: tuple[int, int, int]) -> bytes:
    """编码单个 12 字节命令帧。

    Payload structure:
        [nonce, 0x01, 0x00, 0x02, 0x00, func_id, 0x11, intensity, 0x00, tail[0], tail[1], tail[2]]
    """
    return bytes([
        nonce,
        0x01,
        0x00,
        0x02,
        0x00,
        func_id,
        0x11,
        intensity,
        0x00,
        tail[0],
        tail[1],
        tail[2],
    ])


def encode_suction(intensity: int, nonce: int) -> bytes:
    """编码吮吸命令。

    Args:
        intensity: 0–100 (strict int, bool rejected)。
        nonce: 0–255 (strict int, bool rejected)。

    Returns:
        12 字节 payload。

    Raises:
        TypeError: intensity 或 nonce 不是 strict int。
        ValueError: 超出范围。
    """
    _validate_nonce(nonce)
    _validate_intensity(intensity)
    return _encode_frame(nonce, FUNC_ID_SUCTION, intensity, TAIL_SUCTION)


def encode_vibration(intensity: int, nonce: int) -> bytes:
    """编码震动命令。

    Args:
        intensity: 0–100 (strict int, bool rejected)。
        nonce: 0–255 (strict int, bool rejected)。

    Returns:
        12 字节 payload。

    Raises:
        TypeError: intensity 或 nonce 不是 strict int。
        ValueError: 超出范围。
    """
    _validate_nonce(nonce)
    _validate_intensity(intensity)
    return _encode_frame(nonce, FUNC_ID_VIBRATION, intensity, TAIL_VIBRATION)


def encode_stop(suction_nonce: int, vibration_nonce: int) -> tuple[bytes, bytes]:
    """编码停止命令（吮吸停止 → 震动停止，两帧）。

    Returns:
        (suction_stop_payload, vibration_stop_payload)，各 12 字节。
    """
    return (
        encode_suction(intensity=0, nonce=suction_nonce),
        encode_vibration(intensity=0, nonce=vibration_nonce),
    )


def decode_frame(payload: bytes) -> EncodedCommand:
    """解码 12 字节 payload → EncodedCommand。

    Raises:
        InvalidPayloadError: 长度不是 12 或 func_id 无法识别。
    """
    validate_payload_length(payload)

    func_id = payload[5]
    intensity = payload[7]
    nonce = payload[0]
    tail = (payload[9], payload[10], payload[11])

    if func_id == FUNC_ID_SUCTION and tail == TAIL_SUCTION:
        kind = CommandKind.SUCTION if intensity > 0 else CommandKind.STOP
        desc = f"suction intensity={intensity}" if intensity > 0 else f"suction STOP (intensity=0)"
    elif func_id == FUNC_ID_VIBRATION and tail == TAIL_VIBRATION:
        kind = CommandKind.VIBRATION if intensity > 0 else CommandKind.STOP
        desc = f"vibration intensity={intensity}" if intensity > 0 else f"vibration STOP (intensity=0)"
    else:
        raise InvalidPayloadError(
            f"Unrecognized func_id=0x{func_id:02X} or tail={format_hex_payload(bytes(tail))}"
        )

    return EncodedCommand(
        kind=kind,
        intensity=intensity,
        nonce=nonce,
        payload=payload,
        func_id=func_id,
        tail=tail,
        description=desc,
    )


# ---------------------------------------------------------------------------
# 字段描述（供 dry-run CLI 使用）
# ---------------------------------------------------------------------------

_OFFSET_DESCRIPTIONS: dict[int, str] = {
    0: "nonce (0x00–0xFF)",
    1: "fixed (0x01)",
    2: "fixed (0x00)",
    3: "fixed (0x02)",
    4: "fixed (0x00)",
    5: "func_id (0x01=vibration, 0x07=suction)",
    6: "fixed (0x11)",
    7: "intensity (0–100)",
    8: "fixed (0x00)",
    9: "tail[0]",
    10: "tail[1]",
    11: "tail[2]",
}


def get_field_descriptions() -> dict[int, str]:
    """返回 offset → 字段描述映射。"""
    return dict(_OFFSET_DESCRIPTIONS)
