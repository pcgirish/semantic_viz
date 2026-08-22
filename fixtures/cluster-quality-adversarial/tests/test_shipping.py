from app.shipping.label import make_label


def test_make_label() -> None:
    assert make_label("SE")["to"] == "SE"
