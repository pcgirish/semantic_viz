"""Imported from every cluster in the repo. A clustering driven by import count alone
pulls the whole repo around this file; a correct one leaves it in its own utility
cluster."""


class Money:
    def __init__(self, cents: int) -> None:
        self._cents = cents

    def as_cents(self) -> int:
        return self._cents
