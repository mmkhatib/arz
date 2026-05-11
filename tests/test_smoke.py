"""Smoke tests — the package imports cleanly and ABCs load."""

from __future__ import annotations


def test_package_imports() -> None:
    import arz

    assert arz.__version__ == "0.7.27"


def test_llm_provider_abc_importable() -> None:
    from arz.providers import LLMEvent, LLMProvider

    assert LLMProvider.__abstractmethods__
    assert LLMEvent.__dataclass_fields__  # type: ignore[attr-defined]


def test_messaging_surface_abc_importable() -> None:
    from arz.surfaces import IncomingMessage, MessagingSurface, OutgoingMessage

    assert MessagingSurface.__abstractmethods__
    assert IncomingMessage.__dataclass_fields__  # type: ignore[attr-defined]
    assert OutgoingMessage.__dataclass_fields__  # type: ignore[attr-defined]
