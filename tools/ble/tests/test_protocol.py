"""
离线协议模块单元测试。

纯离线，不涉及 BLE / 网络。
"""

from __future__ import annotations

import unittest
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from protocol import (  # type: ignore[import-not-found]
    PAYLOAD_LENGTH,
    EvidenceLevel,
    InvalidPayloadError,
    ProtocolError,
    ProtocolNotEstablishedError,
    build_tutorial_evidence,
    compare_payloads,
    decode_frame,
    encode_suction,
    encode_vibration,
    encode_stop,
    format_hex_payload,
    inspect_payload,
    parse_hex_payload,
    validate_payload_length,
)

# ---------------------------------------------------------------------------
# Golden fixtures (TUTORIAL_CONFIRMED)
# ---------------------------------------------------------------------------

# 吮吸 nonce=0xAA intensity=1
GOLDEN_SUCTION_1 = bytes.fromhex("AA0100020007110100081104")

# 震动 nonce=0xAA intensity=1
GOLDEN_VIBRATION_1 = bytes.fromhex("AA0100020001110100021101")

# 吮吸停止 nonce=0xAA intensity=0
GOLDEN_SUCTION_STOP = bytes.fromhex("AA0100020007110000081104")

# 震动停止 nonce=0xAA intensity=0
GOLDEN_VIBRATION_STOP = bytes.fromhex("AA0100020001110000021101")


class TestParseHexPayload(unittest.TestCase):
    """parse_hex_payload 测试。"""

    _VALID = bytes(range(12))

    def test_valid_uppercase(self) -> None:
        result = parse_hex_payload("00 01 02 03 04 05 06 07 08 09 0A 0B")
        self.assertEqual(result, self._VALID)

    def test_valid_lowercase(self) -> None:
        result = parse_hex_payload("00 01 02 03 04 05 06 07 08 09 0a 0b")
        self.assertEqual(result, self._VALID)

    def test_valid_no_spaces(self) -> None:
        result = parse_hex_payload("000102030405060708090A0B")
        self.assertEqual(result, self._VALID)

    def test_valid_extra_spaces(self) -> None:
        result = parse_hex_payload("  00  01  02  03  04  05  06  07  08  09  0A  0B  ")
        self.assertEqual(result, self._VALID)

    def test_non_hex_characters(self) -> None:
        with self.assertRaises(InvalidPayloadError):
            parse_hex_payload("00 01 GG 03 04 05 06 07 08 09 0A 0B")

    def test_odd_length(self) -> None:
        with self.assertRaises(InvalidPayloadError):
            parse_hex_payload("00 01 02 03 04 05 06 07 08 09 0A 0")

    def test_odd_length_no_spaces(self) -> None:
        with self.assertRaises(InvalidPayloadError):
            parse_hex_payload("000102030405060708090A0")

    def test_11_bytes(self) -> None:
        with self.assertRaises(InvalidPayloadError):
            parse_hex_payload("00 01 02 03 04 05 06 07 08 09 0A")

    def test_13_bytes(self) -> None:
        with self.assertRaises(InvalidPayloadError):
            parse_hex_payload("00 01 02 03 04 05 06 07 08 09 0A 0B 0C")

    def test_empty_string(self) -> None:
        with self.assertRaises(InvalidPayloadError):
            parse_hex_payload("")

    def test_whitespace_only(self) -> None:
        with self.assertRaises(InvalidPayloadError):
            parse_hex_payload("   ")

    def test_input_not_modified(self) -> None:
        original = "00 01 02 03 04 05 06 07 08 09 0A 0B"
        result = parse_hex_payload(original)
        self.assertEqual(original, "00 01 02 03 04 05 06 07 08 09 0A 0B")
        self.assertIsInstance(result, bytes)


class TestFormatHexPayload(unittest.TestCase):
    """format_hex_payload 测试。"""

    def test_format_uppercase(self) -> None:
        result = format_hex_payload(bytes(range(12)))
        self.assertEqual(result, "00 01 02 03 04 05 06 07 08 09 0A 0B")

    def test_format_all_bytes(self) -> None:
        result = format_hex_payload(b"\x00\xFF\xAB")
        self.assertEqual(result, "00 FF AB")

    def test_format_empty(self) -> None:
        result = format_hex_payload(b"")
        self.assertEqual(result, "")

    def test_roundtrip(self) -> None:
        original = bytes([0x12, 0x34, 0xAB, 0xCD, 0x00, 0xFF,
                          0x01, 0x02, 0x03, 0x04, 0x05, 0x06])
        formatted = format_hex_payload(original)
        parsed = parse_hex_payload(formatted)
        self.assertEqual(parsed, original)


class TestValidatePayloadLength(unittest.TestCase):
    """validate_payload_length 测试。"""

    def test_valid_12_bytes(self) -> None:
        validate_payload_length(b"\x00" * 12)

    def test_11_bytes_raises(self) -> None:
        with self.assertRaises(InvalidPayloadError):
            validate_payload_length(b"\x00" * 11)

    def test_13_bytes_raises(self) -> None:
        with self.assertRaises(InvalidPayloadError):
            validate_payload_length(b"\x00" * 13)

    def test_empty_raises(self) -> None:
        with self.assertRaises(InvalidPayloadError):
            validate_payload_length(b"")


class TestComparePayloads(unittest.TestCase):
    """compare_payloads 测试。"""

    def test_identical(self) -> None:
        diffs = compare_payloads(bytes(range(12)), bytes(range(12)))
        self.assertEqual(diffs, [])

    def test_single_byte_diff(self) -> None:
        left = bytes(range(12))
        right = left[:5] + bytes([0xFF]) + left[6:]
        diffs = compare_payloads(left, right)
        self.assertEqual(len(diffs), 1)
        self.assertEqual(diffs[0].offset, 5)
        self.assertEqual(diffs[0].left_byte, 5)
        self.assertEqual(diffs[0].right_byte, 0xFF)

    def test_multi_byte_diff(self) -> None:
        left = bytes(range(12))
        right = bytes([0xFF, 0xFE]) + bytes(range(2, 12))
        diffs = compare_payloads(left, right)
        self.assertEqual(len(diffs), 2)
        self.assertEqual({d.offset for d in diffs}, {0, 1})

    def test_all_bytes_differ(self) -> None:
        left = bytes(range(12))
        right = bytes([255 - b for b in range(12)])
        diffs = compare_payloads(left, right)
        self.assertEqual(len(diffs), 12)

    def test_input_not_modified(self) -> None:
        left = bytes(range(12))
        right = bytes([0xFF] * 12)
        orig_left = bytes(left)
        orig_right = bytes(right)
        compare_payloads(left, right)
        self.assertEqual(left, orig_left)
        self.assertEqual(right, orig_right)


class TestInspectPayload(unittest.TestCase):
    """inspect_payload 测试。"""

    def test_inspect_without_evidence(self) -> None:
        payload = GOLDEN_SUCTION_1
        info = inspect_payload(payload, evidence=None)
        self.assertEqual(info.length, 12)
        self.assertEqual(len(info.fields), 12)

    def test_inspect_11_bytes_raises(self) -> None:
        with self.assertRaises(InvalidPayloadError):
            inspect_payload(b"\x00" * 11)


class TestGoldenFixtures(unittest.TestCase):
    """Golden fixture 逐字节验证。"""

    def test_suction_golden(self) -> None:
        payload = encode_suction(intensity=1, nonce=0xAA)
        self.assertEqual(payload, GOLDEN_SUCTION_1)
        self.assertEqual(len(payload), 12)

    def test_vibration_golden(self) -> None:
        payload = encode_vibration(intensity=1, nonce=0xAA)
        self.assertEqual(payload, GOLDEN_VIBRATION_1)
        self.assertEqual(len(payload), 12)

    def test_suction_stop_golden(self) -> None:
        payload = encode_suction(intensity=0, nonce=0xAA)
        self.assertEqual(payload, GOLDEN_SUCTION_STOP)
        self.assertEqual(len(payload), 12)

    def test_vibration_stop_golden(self) -> None:
        payload = encode_vibration(intensity=0, nonce=0xAA)
        self.assertEqual(payload, GOLDEN_VIBRATION_STOP)
        self.assertEqual(len(payload), 12)

    def test_stop_returns_two_frames(self) -> None:
        succ, vib = encode_stop(suction_nonce=0xAA, vibration_nonce=0xBB)
        self.assertEqual(succ, encode_suction(intensity=0, nonce=0xAA))
        self.assertEqual(vib, encode_vibration(intensity=0, nonce=0xBB))
        self.assertEqual(len(succ), 12)
        self.assertEqual(len(vib), 12)

    def test_stop_order(self) -> None:
        succ, vib = encode_stop(suction_nonce=0x01, vibration_nonce=0x02)
        self.assertEqual(succ[0], 0x01)   # suction nonce
        self.assertEqual(succ[5], 0x07)   # suction func_id
        self.assertEqual(succ[7], 0x00)   # intensity=0
        self.assertEqual(vib[0], 0x02)    # vibration nonce
        self.assertEqual(vib[5], 0x01)    # vibration func_id
        self.assertEqual(vib[7], 0x00)    # intensity=0


class TestEncodeSuction(unittest.TestCase):
    """encode_suction 测试。"""

    def test_intensity_0(self) -> None:
        result = encode_suction(intensity=0, nonce=0xAA)
        self.assertEqual(result[7], 0)
        self.assertEqual(result[5], 0x07)

    def test_intensity_100(self) -> None:
        result = encode_suction(intensity=100, nonce=0xAA)
        self.assertEqual(result[7], 100)
        self.assertEqual(len(result), 12)

    def test_nonce_0(self) -> None:
        result = encode_suction(intensity=50, nonce=0)
        self.assertEqual(result[0], 0)
        self.assertEqual(len(result), 12)

    def test_nonce_255(self) -> None:
        result = encode_suction(intensity=50, nonce=255)
        self.assertEqual(result[0], 255)
        self.assertEqual(len(result), 12)

    def test_intensity_minus_1(self) -> None:
        with self.assertRaises(ValueError):
            encode_suction(intensity=-1, nonce=0xAA)

    def test_intensity_101(self) -> None:
        with self.assertRaises(ValueError):
            encode_suction(intensity=101, nonce=0xAA)

    def test_nonce_minus_1(self) -> None:
        with self.assertRaises(ValueError):
            encode_suction(intensity=50, nonce=-1)

    def test_nonce_256(self) -> None:
        with self.assertRaises(ValueError):
            encode_suction(intensity=50, nonce=256)

    def test_intensity_bool_true(self) -> None:
        with self.assertRaises(TypeError):
            encode_suction(intensity=True, nonce=0xAA)  # type: ignore[arg-type]

    def test_intensity_bool_false(self) -> None:
        with self.assertRaises(TypeError):
            encode_suction(intensity=False, nonce=0xAA)  # type: ignore[arg-type]

    def test_nonce_bool(self) -> None:
        with self.assertRaises(TypeError):
            encode_suction(intensity=50, nonce=True)  # type: ignore[arg-type]

    def test_intensity_float(self) -> None:
        with self.assertRaises(TypeError):
            encode_suction(intensity=50.0, nonce=0xAA)  # type: ignore[arg-type]

    def test_intensity_str(self) -> None:
        with self.assertRaises(TypeError):
            encode_suction(intensity="50", nonce=0xAA)  # type: ignore[arg-type]

    def test_intensity_none(self) -> None:
        with self.assertRaises(TypeError):
            encode_suction(intensity=None, nonce=0xAA)  # type: ignore[arg-type]

    def test_fixed_bytes(self) -> None:
        result = encode_suction(intensity=50, nonce=0x55)
        self.assertEqual(result[1], 0x01)
        self.assertEqual(result[2], 0x00)
        self.assertEqual(result[3], 0x02)
        self.assertEqual(result[4], 0x00)
        self.assertEqual(result[6], 0x11)
        self.assertEqual(result[8], 0x00)
        self.assertEqual(result[9], 0x08)
        self.assertEqual(result[10], 0x11)
        self.assertEqual(result[11], 0x04)

    def test_deterministic(self) -> None:
        a = encode_suction(intensity=50, nonce=0x42)
        b = encode_suction(intensity=50, nonce=0x42)
        self.assertEqual(a, b)


class TestEncodeVibration(unittest.TestCase):
    """encode_vibration 测试。"""

    def test_intensity_0(self) -> None:
        result = encode_vibration(intensity=0, nonce=0xAA)
        self.assertEqual(result[7], 0)
        self.assertEqual(result[5], 0x01)

    def test_intensity_100(self) -> None:
        result = encode_vibration(intensity=100, nonce=0xAA)
        self.assertEqual(result[7], 100)
        self.assertEqual(len(result), 12)

    def test_fixed_bytes(self) -> None:
        result = encode_vibration(intensity=50, nonce=0x55)
        self.assertEqual(result[1], 0x01)
        self.assertEqual(result[2], 0x00)
        self.assertEqual(result[3], 0x02)
        self.assertEqual(result[4], 0x00)
        self.assertEqual(result[6], 0x11)
        self.assertEqual(result[8], 0x00)
        self.assertEqual(result[9], 0x02)
        self.assertEqual(result[10], 0x11)
        self.assertEqual(result[11], 0x01)

    def test_deterministic(self) -> None:
        a = encode_vibration(intensity=50, nonce=0x42)
        b = encode_vibration(intensity=50, nonce=0x42)
        self.assertEqual(a, b)

    def test_intensity_bool_rejected(self) -> None:
        with self.assertRaises(TypeError):
            encode_vibration(intensity=True, nonce=0xAA)  # type: ignore[arg-type]

    def test_intensity_out_of_range(self) -> None:
        with self.assertRaises(ValueError):
            encode_vibration(intensity=200, nonce=0xAA)


class TestEncodeStop(unittest.TestCase):
    """encode_stop 测试。"""

    def test_returns_tuple_of_two(self) -> None:
        result = encode_stop(suction_nonce=0x01, vibration_nonce=0x02)
        self.assertIsInstance(result, tuple)
        self.assertEqual(len(result), 2)
        self.assertIsInstance(result[0], bytes)
        self.assertIsInstance(result[1], bytes)

    def test_both_intensity_zero(self) -> None:
        succ, vib = encode_stop(suction_nonce=0x01, vibration_nonce=0x02)
        self.assertEqual(succ[7], 0)
        self.assertEqual(vib[7], 0)

    def test_suction_first_vibration_second(self) -> None:
        succ, vib = encode_stop(suction_nonce=0x10, vibration_nonce=0x20)
        self.assertEqual(succ[5], 0x07)   # suction func_id
        self.assertEqual(vib[5], 0x01)    # vibration func_id


class TestDecodeFrame(unittest.TestCase):
    """decode_frame 测试。"""

    def test_decode_suction(self) -> None:
        cmd = decode_frame(GOLDEN_SUCTION_1)
        self.assertEqual(cmd.kind.value, "suction")
        self.assertEqual(cmd.intensity, 1)
        self.assertEqual(cmd.nonce, 0xAA)
        self.assertEqual(cmd.func_id, 0x07)

    def test_decode_vibration(self) -> None:
        cmd = decode_frame(GOLDEN_VIBRATION_1)
        self.assertEqual(cmd.kind.value, "vibration")
        self.assertEqual(cmd.intensity, 1)
        self.assertEqual(cmd.nonce, 0xAA)
        self.assertEqual(cmd.func_id, 0x01)

    def test_decode_stop(self) -> None:
        cmd = decode_frame(GOLDEN_SUCTION_STOP)
        self.assertEqual(cmd.kind.value, "stop")
        self.assertEqual(cmd.intensity, 0)

    def test_decode_roundtrip_suction(self) -> None:
        payload = encode_suction(intensity=75, nonce=0x42)
        cmd = decode_frame(payload)
        self.assertEqual(cmd.intensity, 75)
        self.assertEqual(cmd.nonce, 0x42)
        self.assertEqual(cmd.payload, payload)

    def test_decode_11_bytes_raises(self) -> None:
        with self.assertRaises(InvalidPayloadError):
            decode_frame(b"\x00" * 11)


class TestEvidence(unittest.TestCase):
    """ProtocolEvidence 测试。"""

    def test_build_tutorial_evidence(self) -> None:
        ev = build_tutorial_evidence()
        self.assertEqual(len(ev.fields), 12)
        self.assertTrue(ev.fields[0].evidence_level == EvidenceLevel.TUTORIAL_CONFIRMED)
        self.assertTrue(ev.fields[5].evidence_level == EvidenceLevel.TUTORIAL_CONFIRMED)
        self.assertTrue(ev.fields[7].evidence_level == EvidenceLevel.TUTORIAL_CONFIRMED)

    def test_tutorial_evidence_has_no_unknown(self) -> None:
        ev = build_tutorial_evidence()
        self.assertEqual(ev.unknown_fields, 0)
        self.assertEqual(ev.confirmed_fields, 12)

    def test_all_fields_have_label(self) -> None:
        ev = build_tutorial_evidence()
        for f in ev.fields:
            self.assertNotEqual(f.label, "UNKNOWN", f"offset {f.offset} has no label")


class TestConstants(unittest.TestCase):
    """常量验证。"""

    def test_payload_length(self) -> None:
        self.assertEqual(PAYLOAD_LENGTH, 12)


class TestNoBLEImports(unittest.TestCase):
    """确保 protocol 模块不导入 BLE 库。"""

    def test_no_bleak(self) -> None:
        import protocol
        self.assertFalse(hasattr(protocol, "bleak"))

    def test_no_asyncio_in_protocol(self) -> None:
        import protocol
        self.assertFalse(hasattr(protocol, "asyncio"))


if __name__ == "__main__":
    unittest.main()
