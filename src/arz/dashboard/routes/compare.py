"""Compare endpoint — run a single prompt against an arbitrary model.

Used by the dashboard's compare-view UI to generate an alt-model response for
side-by-side comparison without polluting the user's primary session.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import AsyncIterator

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from arz.acp.types import EVENT_COMPLETE, EVENT_TEXT_CHUNK
from arz.dashboard.sse import sse_chunk, sse_complete, sse_error
from arz.dashboard.token_auth import require_token

router = APIRouter(dependencies=[Depends(require_token)])

log = logging.getLogger(__name__)


class CompareBody(BaseModel):
    prompt: str = Field(min_length=1, max_length=20_000)
    provider: str = "claude-code"
    model: str = Field(min_length=1, max_length=120)


async def _stream(prompt: str, provider_name: str, model: str) -> AsyncIterator[str]:
    """One-shot run of ``prompt`` through a fresh provider; yields SSE strings."""
    if provider_name == "claude-code":
        from arz.providers.claude_code import ClaudeCodeProvider
        provider = ClaudeCodeProvider(model=model)
    elif provider_name == "kiro-cli":
        from arz.providers.kiro_cli import KiroCliProvider
        provider = KiroCliProvider(model=model)
    elif provider_name == "codex":
        from arz.providers.codex import CodexProvider
        provider = CodexProvider(model=model)
    elif provider_name == "gemini":
        from arz.providers.gemini import GeminiProvider
        provider = GeminiProvider(model=model)
    elif provider_name == "ollama":
        from arz.providers.ollama import OllamaProvider
        provider = OllamaProvider(model=model)
    else:
        yield sse_error(f"Unsupported provider: {provider_name}")
        return

    try:
        await provider.start()
        async for event in provider.stream(prompt):
            if event.kind == EVENT_TEXT_CHUNK and event.text:
                yield sse_chunk(event.text)
            elif event.kind == EVENT_COMPLETE:
                usage_dict = event.usage.to_dict() if event.usage else None
                yield sse_complete(
                    event.stop_reason or "end_turn",
                    context_pct=event.context_usage_pct or 0.0,
                    usage=usage_dict,
                )
                return
        yield sse_complete("end_turn")
    except Exception as e:
        log.exception("Compare run failed")
        yield sse_error(str(e))
    finally:
        try:
            await provider.shutdown()
        except Exception:
            pass


@router.post("/api/compare")
async def compare(body: CompareBody, request: Request) -> StreamingResponse:
    return StreamingResponse(
        _stream(body.prompt, body.provider, body.model),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
