"""Centralized API-key loader for the youtube-automator sibling projects.

The youtube_hub project owns the canonical secrets file. Other sibling apps
(shorts_analyzer, shorts_strategist, shorts-auto-editor, youtube_shorts_publisher,
backtrack_scanner) should read from here instead of keeping their own copies.

Usage from a sibling project:

    import sys, pathlib
    HUB_CONFIG = pathlib.Path(__file__).resolve().parents[2] / "youtube_hub" / "config"
    sys.path.insert(0, str(HUB_CONFIG))
    from shared_secrets import get_gemini_api_key, get_openai_api_key

The exact `parents[N]` depends on how deeply nested the importing file is
relative to its sibling-project root.

Override location with env var YOUTUBE_HUB_SECRETS_FILE if needed.
"""

import json
import os
from pathlib import Path
from typing import Optional

_HERE = Path(__file__).resolve().parent
_DEFAULT_SECRETS_PATH = _HERE / "secrets.json"

_cached: Optional[dict] = None


def _secrets_path() -> Path:
    override = os.environ.get("YOUTUBE_HUB_SECRETS_FILE")
    if override:
        return Path(override)
    return _DEFAULT_SECRETS_PATH


def load_secrets(refresh: bool = False) -> dict:
    """Load and cache the secrets file. Returns {} if missing."""
    global _cached
    if _cached is not None and not refresh:
        return _cached
    path = _secrets_path()
    if not path.is_file():
        _cached = {}
        return _cached
    with open(path, "r", encoding="utf-8") as f:
        _cached = json.load(f)
    return _cached


def get_secret(name: str, default: str = "") -> str:
    """Return a secret, preferring an env-var override over the file."""
    env = os.environ.get(name)
    if env:
        return env
    return load_secrets().get(name, default)


def get_gemini_api_key() -> str:
    return get_secret("GEMINI_API_KEY")


def get_gemini_api_key_publisher() -> str:
    """Separate Gemini key historically used by youtube_shorts_publisher."""
    return get_secret("GEMINI_API_KEY_PUBLISHER") or get_gemini_api_key()


def get_youtube_api_key() -> str:
    return get_secret("YOUTUBE_API_KEY")


def get_anthropic_api_key() -> str:
    return get_secret("ANTHROPIC_API_KEY")


def get_openai_api_key() -> str:
    return get_secret("OPENAI_API_KEY")


# ── OAuth credentials ─────────────────────────────────────────────────────
# YouTube OAuth client_secret + token files live under config/oauth/.
# Tokens are split by scope (each scope needs its own refresh token).

_OAUTH_DIR = _HERE / "oauth"


def get_oauth_dir() -> Path:
    return _OAUTH_DIR


def get_oauth_client_secrets_path() -> Path:
    """Path to the canonical Desktop OAuth client_secret.json."""
    return _OAUTH_DIR / "client_secret.json"


def get_oauth_token_path(scope_name: str) -> Path:
    """Path to a token file for a given scope.

    `scope_name` is a short identifier — e.g. 'youtube_readonly' or
    'yt_analytics'. The file is named `token_<scope_name>.json` and may not
    exist yet (the OAuth flow creates it on first run).
    """
    return _OAUTH_DIR / f"token_{scope_name}.json"


def export_to_env() -> None:
    """Populate os.environ with any secrets that aren't already set.

    Convenient for libraries (anthropic, google-genai, openai) that auto-pick
    up their keys from environment variables.
    """
    for k, v in load_secrets().items():
        if v and not os.environ.get(k):
            os.environ[k] = v
