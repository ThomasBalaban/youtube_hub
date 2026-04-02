"""
FastAPI router for reading/writing SimpleAutoSubs settings.
Stored in hub_settings.json inside the SimpleAutoSubs project directory.
Settings are available via the launcher even when the API server is offline.
"""
import json
import os
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
}


class SubtitlerSettings(BaseModel):
    animation_type: str
    sync_offset: float
    output_dir: str
    enable_trimming: bool


def _read() -> dict:
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                saved = json.load(f)
            # Merge saved values onto defaults so new keys always exist
            return {**DEFAULTS, **{k: saved[k] for k in DEFAULTS if k in saved}}
        except Exception:
            pass
    return dict(DEFAULTS)


def _write(data: dict) -> None:
    os.makedirs(os.path.dirname(SETTINGS_FILE), exist_ok=True)
    with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


@router.get("/settings")
def get_settings():
    return _read()


@router.post("/settings")
def post_settings(s: SubtitlerSettings):
    _write(s.model_dump())
    return {"ok": True}