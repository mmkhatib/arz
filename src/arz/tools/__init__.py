"""User-defined tools — discoverable Python files in ``~/.arz/tools/``.

Each tool file declares a ``tool_spec`` dict and an async ``run(input)`` callable:

    # ~/.arz/tools/echo.py
    tool_spec = {
        "name": "echo",
        "description": "Echo input back",
        "input_schema": {
            "type": "object",
            "properties": {"text": {"type": "string"}},
            "required": ["text"],
        },
    }

    async def run(input: dict) -> str:
        return input.get("text", "")

The registry hot-reloads when files change. Exposing these to LLM providers
requires an MCP bridge (not yet wired) — for now they're surfaced via the
dashboard's ``/api/tools`` endpoint and listed in the UI for inspection and
per-session allowlisting.
"""

from arz.tools.registry import ToolRegistry, ToolSpec

__all__ = ["ToolRegistry", "ToolSpec"]
