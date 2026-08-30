import dataclasses
import datetime as dt
import unittest

from mi_health_service import to_safe_json, validate_date


@dataclasses.dataclass
class Sample:
    score: int
    uid: str
    token: str


class MiHealthServiceTest(unittest.TestCase):
    def test_validate_date_rejects_invalid_calendar_day(self):
        self.assertEqual(validate_date("2026-08-30"), dt.date(2026, 8, 30))
        with self.assertRaises(ValueError):
            validate_date("2026-02-30")

    def test_safe_json_removes_identity_and_credentials(self):
        result = to_safe_json(Sample(score=90, uid="account-id", token="secret"))
        self.assertEqual(result, {"score": 90})


if __name__ == "__main__":
    unittest.main()
