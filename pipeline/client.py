"""
Pipeline-owned HTTP client.
Separate from the launcher's client to avoid import-time None capture.
"""

import httpx

_http_client: httpx.AsyncClient | None = None


async def get_client() -> httpx.AsyncClient:
    """Lazily create the shared httpx client on first use."""
    global _http_client
    if _http_client is None:
        # connect timeout is short (fail fast if nothing is listening).
        # read timeout is None because the SimpleAutoSubs event loop can be
        # starved by heavy AI/transcription work for several minutes at a time.
        # The outer poll loop enforces a 1-hour overall ceiling separately.
        _http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(connect=10.0, read=None, write=10.0, pool=10.0)
        )
    return _http_client


async def close_client() -> None:
    global _http_client
    if _http_client:
        await _http_client.aclose()
        _http_client = None
