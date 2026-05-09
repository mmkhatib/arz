"""Capability snapshot — sanity tests for the compact text rendering."""

from __future__ import annotations

from arz.capabilities import (
    AgentProfile,
    CapabilitySnapshot,
    CloudModel,
    LocalModel,
    McpServerSummary,
    capabilities_block,
)


def test_block_renders_with_empty_snapshot() -> None:
    snap = CapabilitySnapshot(
        clis={},
        cloud_models=[],
        local_models=[],
        agents=[],
        mcps=[],
        builtin_tools=[],
    )
    out = capabilities_block(snap)
    assert out.startswith("<capabilities>")
    assert out.endswith("</capabilities>")
    assert "at most 3 subagents" in out


def test_block_lists_installed_and_missing_clis() -> None:
    snap = CapabilitySnapshot(
        clis={"claude-code": True, "kiro-cli": False},
        cloud_models=[],
        local_models=[],
        agents=[],
        mcps=[],
        builtin_tools=[],
    )
    out = capabilities_block(snap)
    assert "Installed CLIs: claude-code" in out
    assert "Available but not installed: kiro-cli" in out


def test_block_renders_models_with_tier_and_context() -> None:
    snap = CapabilitySnapshot(
        clis={},
        cloud_models=[
            CloudModel("opus", "claude-code", "frontier", 200, "best brain"),
            CloudModel("haiku", "claude-code", "cheap", 200, "fast"),
        ],
        local_models=[LocalModel("qwen2.5", 19.0, 24)],
        agents=[],
        mcps=[],
        builtin_tools=[],
    )
    out = capabilities_block(snap)
    assert "opus" in out
    assert "frontier" in out
    assert "haiku" in out
    assert "cheap" in out
    assert "qwen2.5" in out
    assert "19.0GB" in out


def test_block_renders_agents() -> None:
    snap = CapabilitySnapshot(
        clis={},
        cloud_models=[],
        local_models=[],
        agents=[
            AgentProfile("coder", "claude-code", "opus", "implements features", "trust_reads"),
            AgentProfile("reviewer", "kiro-cli", "", "reviews diffs", "normal", is_default=True),
        ],
        mcps=[],
        builtin_tools=[],
    )
    out = capabilities_block(snap)
    assert "@coder" in out
    assert "@reviewer" in out
    assert "★default" in out


def test_block_renders_mcps_split_by_enabled() -> None:
    snap = CapabilitySnapshot(
        clis={},
        cloud_models=[],
        local_models=[],
        agents=[],
        mcps=[
            McpServerSummary("github", "claude", True),
            McpServerSummary("linear", "claude", False),
        ],
        builtin_tools=["Read", "Write", "Bash"],
    )
    out = capabilities_block(snap)
    assert "MCP servers (enabled): claude:github" in out
    assert "MCP servers (disabled): claude:linear" in out
    assert "Read, Write, Bash" in out
