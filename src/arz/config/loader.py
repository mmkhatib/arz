"""TOML config loader with environment variable overlay.

Resolution order (highest to lowest priority):
    1. Environment variables  (ARZ_PROVIDER__NAME, ARZ_DASHBOARD__PORT, …)
    2. User config            (~/.arz/config.toml)
    3. Bundled defaults       (src/arz/config/defaults.toml)
"""

from __future__ import annotations

import os
import tomllib
from pathlib import Path
from typing import Any

import tomli_w

from arz.config.schema import ArzConfig

_USER_CONFIG = Path.home() / ".arz" / "config.toml"


def _load_toml(path: Path) -> dict[str, Any]:
    try:
        with open(path, "rb") as f:
            return tomllib.load(f)
    except FileNotFoundError:
        return {}


def _deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    """Recursively merge override into base; override wins on conflict."""
    merged = dict(base)
    for key, value in override.items():
        if key in merged and isinstance(merged[key], dict) and isinstance(value, dict):
            merged[key] = _deep_merge(merged[key], value)
        else:
            merged[key] = value
    return merged


def _apply_env(data: dict[str, Any]) -> dict[str, Any]:
    """Overlay ARZ_* env vars onto the config dict.

    ARZ_PROVIDER__NAME=kiro-cli  →  data["provider"]["name"] = "kiro-cli"
    ARZ_DASHBOARD__PORT=8888     →  data["dashboard"]["port"] = "8888"
    """
    for key, value in os.environ.items():
        if not key.startswith("ARZ_"):
            continue
        parts = key[4:].lower().split("__", 1)
        if len(parts) == 2:
            section, field = parts
            if section not in data:
                data[section] = {}
            data[section][field] = value
        else:
            data[parts[0]] = value
    return data


def load_config(path: Path | None = None) -> ArzConfig:
    """Load and validate the Arz configuration.

    Args:
        path: Optional explicit config file path. Defaults to ~/.arz/config.toml.
    """
    # Load bundled defaults
    defaults_file = Path(__file__).parent / "defaults.toml"
    data = _load_toml(defaults_file)

    # Merge user config
    user_path = path or _USER_CONFIG
    data = _deep_merge(data, _load_toml(user_path))

    # Overlay environment variables
    data = _apply_env(data)

    return ArzConfig.model_validate(data)


def save_config(config: ArzConfig, path: Path | None = None) -> None:
    """Persist config to TOML (only the user-writable sections, not defaults)."""
    user_path = path or _USER_CONFIG
    user_path.parent.mkdir(parents=True, exist_ok=True)

    data = config.model_dump(exclude_none=True)
    with open(user_path, "wb") as f:
        tomli_w.dump(data, f)
