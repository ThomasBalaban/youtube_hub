"""
Pipeline-owned HTTP client.
Separate from the launcher's client to avoid import-time None capture.
"""

import httpx

_http_client: httpx.AsyncClient | None = None


# pipeline/client.py

async def get_client() -> httpx.AsyncClient:
    """Lazily create the shared httpx client on first use."""
    global _http_client
    if _http_client is None:
        _http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(connect=10.0, read=None, write=10.0, pool=10.0),
            trust_env=False  # Prevents VPNs/proxies from blocking the local request
        )
    return _http_client


async def close_client() -> None:
    global _http_client
    if _http_client:
        await _http_client.aclose()
        _http_client = None
