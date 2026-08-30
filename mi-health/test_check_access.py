import unittest

from check_access import api_base, safe_error_label, uid


class CheckAccessTest(unittest.TestCase):
    def test_uid_requires_decimal_digits(self):
        self.assertEqual(uid("2960546247"), 2960546247)
        with self.assertRaises(Exception):
            uid("invalid")

    def test_api_base_requires_known_xiaomi_endpoint(self):
        self.assertEqual(api_base("https://ru.hlth.io.mi.com/"), "https://ru.hlth.io.mi.com")
        with self.assertRaises(Exception):
            api_base("https://example.com")

    def test_error_label_omits_exception_message(self):
        error = RuntimeError("credential=do-not-display")
        error.code = -4002001
        error.status_code = 200
        self.assertEqual(safe_error_label(error), "CHECK_FAILED RuntimeError code=-4002001 status_code=200")


if __name__ == "__main__":
    unittest.main()
