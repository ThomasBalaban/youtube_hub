"""FastAPI router exposing the authenticated YouTube account.

Mounted at /launcher/account in launcher.py. Reads the centralized OAuth
token at youtube_hub/config/oauth/token_youtube_readonly.json, refreshes the
access token against Google, then asks `youtube.channels.list` for snippet
data and returns the channel title + avatar URL for sidebar display.

Hits Google at most once per process per CACHE_TTL seconds.
"""

import json
import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, Optional

import httpx
from fastapi import APIRouter, HTTPException

# Locate the centralized OAuth files via shared_secrets
THIS_DIR = Path(__file__).resolve().parent
HUB_CONFIG_DIR = THIS_DIR / "config"
if str(HUB_CONFIG_DIR) not in sys.path:
    sys.path.insert(0, str(HUB_CONFIG_DIR))
from shared_secrets import get_oauth_token_path  # noqa: E402

TOKEN_FILE = get_oauth_token_path("youtube_readonly")

router = APIRouter(prefix="/account")

CACHE_TTL_SECONDS = 3600  # refresh channel info at most once per hour
_cache: Dict[str, Any] = {"data": None, "expires_at": 0.0}


async def _refresh_access_token() -> str:
    if not TOKEN_FILE.exists():
        raise HTTPException(
            status_code=503,
            detail=(
                f"OAuth token not found at {TOKEN_FILE}. "
                "Run the publisher's `analyze_draft_shorts.py` once to "
                "complete the YouTube login flow."
            ),
        )
    try:
        tok = json.loads(TOKEN_FILE.read_text())
    except (OSError, json.JSONDecodeError) as e:
        raise HTTPException(500, f"Failed to read token file: {e}")

    required = ("token_uri", "client_id", "client_secret", "refresh_token")
    missing = [k for k in required if not tok.get(k)]
    if missing:
        raise HTTPException(
            500,
            f"Token file is missing fields: {', '.join(missing)}",
        )

    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.post(
            tok["token_uri"],
            data={
                "client_id": tok["client_id"],
                "client_secret": tok["client_secret"],
                "refresh_token": tok["refresh_token"],
                "grant_type": "refresh_token",
            },
        )
    if r.status_code != 200:
        raise HTTPException(
            502,
            f"OAuth token refresh failed ({r.status_code}): {r.text[:300]}",
        )
    body = r.json()
    access_token = body.get("access_token")
    if not access_token:
        raise HTTPException(502, "Refresh response missing access_token")
    return access_token


async def _fetch_channel_info() -> Dict[str, Any]:
    access_token = await _refresh_access_token()
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get(
            "https://www.googleapis.com/youtube/v3/channels",
            params={"part": "snippet", "mine": "true"},
            headers={"Authorization": f"Bearer {access_token}"},
        )
    if r.status_code != 200:
        raise HTTPException(
            502, f"YouTube API error ({r.status_code}): {r.text[:300]}"
        )
    items = r.json().get("items") or []
    if not items:
        raise HTTPException(404, "No channel found for authenticated user")
    snippet = items[0].get("snippet", {})
    thumbs = snippet.get("thumbnails") or {}
    avatar = (
        (thumbs.get("default") or {}).get("url")
        or (thumbs.get("medium") or {}).get("url")
        or (thumbs.get("high") or {}).get("url")
    )
    return {
        "channel_id": items[0].get("id"),
        "title": snippet.get("title"),
        "handle": snippet.get("customUrl"),
        "avatar_url": avatar,
    }


@router.get("/me")
async def me(refresh: bool = False) -> Dict[str, Any]:
    """Return the authenticated channel's title + avatar.

    Pass ?refresh=1 to bypass the in-memory cache.
    """
    now = time.time()
    if not refresh and _cache["data"] and _cache["expires_at"] > now:
        return {**_cache["data"], "cached": True}

    data = await _fetch_channel_info()
    _cache["data"] = data
    _cache["expires_at"] = now + CACHE_TTL_SECONDS
    return {**data, "cached": False}
