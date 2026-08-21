from app.billing.invoice import build_invoice
from app.shared.money import Money


def test_build_invoice() -> None:
    assert build_invoice("o1", Money(500))["total"] == 500
