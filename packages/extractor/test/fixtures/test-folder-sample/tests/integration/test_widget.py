from tests.test_rate_limiter import test_direct_under_tests


def test_build_widget_branches(count):
    if count > 0:
        return count
    return 0
