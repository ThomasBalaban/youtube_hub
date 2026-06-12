"""
FastAPI router for reading/writing shorts-auto-editor settings.
Stored in hub_settings.json inside the shorts-auto-editor project directory.
Settings are available via the launcher even when the API server is offline.
"""
import json
import os
from typing import Any, Dict, List
from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/subtitler-settings")

THIS_DIR    = os.path.dirname(os.path.abspath(__file__))
PARENT_DIR  = os.path.dirname(THIS_DIR)
SETTINGS_FILE = os.path.join(THIS_DIR, "hub_settings.json")


DEFAULTS: dict = {
    "animation_type": "Auto",
    "sync_offset": -0.15,
    "output_dir": os.path.join(os.path.expanduser("~"), "Desktop"),
    "enable_trimming": True,
    # Processing toggles / inputs (global).
    "camera_mode": "vtuber",          # "vtuber" | "facecam" | "none"
    "game_subtitles_enabled": True,
    "onomatopoeia_enabled": True,
    "mic_track_index": "a:1",
    "game_track_index": "a:2",
    # Layout presets for zoom focus, edited from the subtitler "Layout" tab.
    "region_presets": [],
    "active_preset": "",
}


class SubtitlerSettings(BaseModel):
    animation_type: str
    sync_offset: float
    output_dir: str
    enable_trimming: bool
    camera_mode: str = "vtuber"
    game_subtitles_enabled: bool = True
    onomatopoeia_enabled: bool = True
    mic_track_index: str = "a:1"
    game_track_index: str = "a:2"


class RegionsPayload(BaseModel):
    region_presets: List[Dict[str, Any]]
    active_preset: str


def _read_raw() -> dict:
    """Return the full saved settings dict (all keys), or {} if unreadable."""
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def _read() -> dict:
    # Merge saved values onto defaults so new keys always exist, while
    # preserving any extra keys other tools (scheduler, backtrack) persist.
    return {**DEFAULTS, **_read_raw()}


def _write_merged(updates: dict) -> None:
    """Read-modify-write: update only the given keys, preserving everything
    else already in hub_settings.json (region presets, schedule, etc.)."""
    data = _read_raw()
    data.update(updates)
    os.makedirs(os.path.dirname(SETTINGS_FILE), exist_ok=True)
    with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


@router.get("/settings")
def get_settings():
    return _read()


@router.post("/settings")
def post_settings(s: SubtitlerSettings):
    _write_merged(s.model_dump())
    return {"ok": True}


@router.get("/regions")
def get_regions():
    data = _read()
    return {
        "region_presets": data.get("region_presets", []),
        "active_preset": data.get("active_preset", ""),
    }


@router.post("/regions")
def post_regions(p: RegionsPayload):
    _write_merged({
        "region_presets": p.region_presets,
        "active_preset": p.active_preset,
    })
    return {"ok": True}
