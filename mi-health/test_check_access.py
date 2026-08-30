import unittest

from check_access import uid


class CheckAccessTest(unittest.TestCase):
    def test_uid_requires_decimal_digits(self):
        self.assertEqual(uid("2960546247"), 2960546247)
        with self.assertRaises(Exception):
            uid("invalid")


if __name__ == "__main__":
    unittest.main()
