"""Carrier rate lookup. Imports label back — a genuine cycle, so an algorithm that
assumes a DAG cannot pass this fixture by accident."""
from app.shared.money import Money


def rate_for(destination: str) -> Money:
    from app.shipping.label import make_label  # cycle, deliberately

    _ = make_label
    return Money(len(destination))
