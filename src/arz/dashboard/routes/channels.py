"""Channels CRUD + post."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status

from arz.channels import ChannelMember, get_channel_store
from arz.dashboard.token_auth import require_token

router = APIRouter(dependencies=[Depends(require_token)])


def _channel_to_dict(ch) -> dict:
    data = ch.model_dump()
    for m in data.get("messages", []):
        if "from_" in m:
            m["from"] = m.pop("from_")
    return data


@router.get("/api/channels")
async def list_channels() -> list[dict]:
    return [_channel_to_dict(c) for c in get_channel_store().list()]


@router.get("/api/channels/{slug}")
async def get_channel(slug: str) -> dict:
    ch = get_channel_store().get(slug)
    if ch is None:
        raise HTTPException(status_code=404, detail="Channel not found")
    return _channel_to_dict(ch)


@router.post("/api/channels", status_code=status.HTTP_201_CREATED)
async def create_channel(request: Request) -> dict:
    body = await request.json()
    preset = (body.get("preset") or "").strip()
    name = (body.get("name") or "").strip()
    topic = (body.get("topic") or "").strip()
    idle_timeout_s = int(body.get("idle_timeout_s") or 1800)
    members_raw = body.get("members") or []

    # Hydrate from preset if requested.
    if preset and preset != "custom":
        from arz.channel_runner import PRESETS

        spec = PRESETS.get(preset)
        if spec is None:
            raise HTTPException(status_code=422, detail=f"unknown preset {preset!r}")
        if not name:
            name = spec["name"]
        if not topic:
            topic = spec["topic"]
        if not members_raw:
            members_raw = spec["members"]

    if not name:
        raise HTTPException(status_code=422, detail="name required")

    members = []
    for m in members_raw:
        if isinstance(m, str):
            members.append(ChannelMember(agent=m))
        elif isinstance(m, dict) and m.get("agent"):
            members.append(ChannelMember(**m))
    try:
        ch = get_channel_store().create(
            name,
            members,
            topic=topic,
            preset=preset or "custom",
            idle_timeout_s=idle_timeout_s,
        )
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return _channel_to_dict(ch)


@router.get("/api/channels/_/presets")
async def list_presets() -> list[dict]:
    """Return the built-in channel presets."""
    from arz.channel_runner import PRESETS

    return [{"id": k, **v} for k, v in PRESETS.items()]


@router.delete("/api/channels/{slug}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_channel(slug: str) -> None:
    if not get_channel_store().delete(slug):
        raise HTTPException(status_code=404, detail="Channel not found")


@router.post("/api/channels/{slug}/members", status_code=status.HTTP_201_CREATED)
async def add_member(slug: str, request: Request) -> dict:
    body = await request.json()
    if not body.get("agent"):
        raise HTTPException(status_code=422, detail="agent required")
    try:
        ch = get_channel_store().add_member(slug, ChannelMember(**body))
    except KeyError:
        raise HTTPException(status_code=404, detail="Channel not found")
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return _channel_to_dict(ch)


@router.post("/api/channels/{slug}/post", status_code=status.HTTP_201_CREATED)
async def post_message(slug: str, request: Request) -> dict:
    """Post a message into a channel.

    When ``from`` is "user" (the default), the channel runner is fired:
    orchestrator + specialists drive the conversation forward in the
    background. The HTTP call returns immediately with the user's
    message; the UI polls /api/channels/{slug} to watch replies land.
    """
    body = await request.json()
    from_ = (body.get("from") or "user").strip()
    text = (body.get("text") or "").strip()
    in_reply_to = body.get("in_reply_to")
    if not text:
        raise HTTPException(status_code=422, detail="text required")

    if from_ == "user":
        # Channel runner posts the user message AND drives the orchestrator
        # in one shot. Posting here too produces a duplicate. Auto-wake an
        # archived/idle channel so user posts always re-activate it.
        from arz.channel_runner import get_channel_runner
        from arz.channels import get_channel_store as _get_store

        store = _get_store()
        try:
            ch = store.get(slug)
        except Exception:
            ch = None
        if ch is None:
            raise HTTPException(status_code=404, detail="Channel not found")
        if ch.status != "active":
            store.wake(slug)

        runner = get_channel_runner()
        if runner is not None:
            import asyncio
            import logging as _log

            _logger = _log.getLogger(__name__)

            async def _run() -> None:
                try:
                    await runner.post_user(slug, text)
                except Exception:
                    _logger.exception("channel_runner.post_user failed", extra={"channel": slug})

            asyncio.create_task(_run())
        else:
            # No runner wired — just persist the message so it doesn't vanish.
            try:
                store.post(slug, from_, text, in_reply_to)
            except KeyError:
                raise HTTPException(status_code=404, detail="Channel not found")
        # Return the most-recent message snapshot so the UI sees the post immediately.
        ch2 = store.get(slug)
        last = ch2.messages[-1] if ch2 and ch2.messages else None
        return last.model_dump() if last else {"id": 0}

    try:
        msg = get_channel_store().post(slug, from_, text, in_reply_to)
    except KeyError:
        raise HTTPException(status_code=404, detail="Channel not found")
    return msg.model_dump()


@router.post("/api/channels/{slug}/wake", status_code=status.HTTP_200_OK)
async def wake_channel(slug: str) -> dict:
    ch = get_channel_store().wake(slug)
    if ch is None:
        raise HTTPException(status_code=404, detail="Channel not found")
    return _channel_to_dict(ch)


@router.post("/api/channels/{slug}/dismiss", status_code=status.HTTP_200_OK)
async def dismiss_channel(slug: str) -> dict:
    ch = get_channel_store().dismiss(slug)
    if ch is None:
        raise HTTPException(status_code=404, detail="Channel not found")
    return _channel_to_dict(ch)
