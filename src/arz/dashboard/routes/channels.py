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
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="name required")
    members_raw = body.get("members") or []
    members = []
    for m in members_raw:
        if isinstance(m, str):
            members.append(ChannelMember(agent=m))
        elif isinstance(m, dict) and m.get("agent"):
            members.append(ChannelMember(**m))
    try:
        ch = get_channel_store().create(name, members)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return _channel_to_dict(ch)


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
    body = await request.json()
    from_ = (body.get("from") or "user").strip()
    text = (body.get("text") or "").strip()
    in_reply_to = body.get("in_reply_to")
    if not text:
        raise HTTPException(status_code=422, detail="text required")
    try:
        msg = get_channel_store().post(slug, from_, text, in_reply_to)
    except KeyError:
        raise HTTPException(status_code=404, detail="Channel not found")
    out = msg.model_dump()
    return out
