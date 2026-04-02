"""
FastAPI router for reading/writing youtube_shorts_publisher settings
and reading its output data files.
"""

import re
import os
import json
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/publisher")

THIS_DIR      = os.path.dirname(os.path.abspath(__file__))
PARENT_DIR    = os.path.dirname(THIS_DIR)
PUBLISHER_DIR = os.path.join(PARENT_DIR, "youtube_shorts_publisher")
SETTINGS_PATH = os.path.join(PUBLISHER_DIR, "settings.py")

# ─── Known data files ─────────────────────────────────────────────────────────

DATA_FILES = {
    "draft_analysis": {
        "label":       "Draft Analysis",
        "description": "AI-generated metadata for each analyzed draft",
        "path":        "draft_analysis.json",
    },
    "failed_shorts": {
        "label":       "Failed Shorts",
        "description": "Shorts that errored during analysis or download",
        "path":        "failed_shorts_data.json",
    },
    "backtrack_videos": {
        "label":       "Backtrack Videos",
        "description": "Draft + scheduled videos containing 'Backtrack'",
        "path":        "saved_shorts_data/backtrack_videos.json",
    },
    "draft_videos": {
        "label":       "Draft Videos",
        "description": "All draft videos found during last scrape",
        "path":        "saved_shorts_data/draft_videos.json",
    },
    "scheduled_videos": {
        "label":       "Scheduled Videos",
        "description": "All scheduled videos with publish timestamps",
        "path":        "saved_shorts_data/scheduled_videos.json",
    },
}


# ─── Settings ─────────────────────────────────────────────────────────────────

class PublisherSettings(BaseModel):
    PROCESS_SINGLE_VIDEO: bool
    ENABLE_SCRAPING_MODE: bool
    ENABLE_ANALYSIS_MODE: bool
    VIDEOS_TO_PROCESS_COUNT: int
    TEST_MODE: bool


def _read_settings() -> PublisherSettings:
    if not os.path.exists(SETTINGS_PATH):
        raise HTTPException(status_code=404, detail=f"settings.py not found at {SETTINGS_PATH}")
    with open(SETTINGS_PATH, "r") as f:
        content = f.read()

    def get_bool(name):
        m = re.search(rf"^{name}\s*=\s*(True|False)", content, re.MULTILINE)
        return m.group(1) == "True" if m else False

    def get_int(name):
        m = re.search(rf"^{name}\s*=\s*(\d+)", content, re.MULTILINE)
        return int(m.group(1)) if m else 0

    return PublisherSettings(
        PROCESS_SINGLE_VIDEO=get_bool("PROCESS_SINGLE_VIDEO"),
        ENABLE_SCRAPING_MODE=get_bool("ENABLE_SCRAPING_MODE"),
        ENABLE_ANALYSIS_MODE=get_bool("ENABLE_ANALYSIS_MODE"),
        VIDEOS_TO_PROCESS_COUNT=get_int("VIDEOS_TO_PROCESS_COUNT"),
        TEST_MODE=get_bool("TEST_MODE"),
    )


def _write_settings(settings: PublisherSettings) -> None:
    if not os.path.exists(SETTINGS_PATH):
        raise HTTPException(status_code=404, detail=f"settings.py not found at {SETTINGS_PATH}")
    with open(SETTINGS_PATH, "r") as f:
        content = f.read()

    def replace_bool(name, value):
        nonlocal content
        content = re.sub(rf"^({name}\s*=\s*)(True|False)", rf"\g<1>{value}", content, flags=re.MULTILINE)

    def replace_int(name, value):
        nonlocal content
        content = re.sub(rf"^({name}\s*=\s*)\d+", rf"\g<1>{value}", content, flags=re.MULTILINE)

    replace_bool("PROCESS_SINGLE_VIDEO", settings.PROCESS_SINGLE_VIDEO)
    replace_bool("ENABLE_SCRAPING_MODE", settings.ENABLE_SCRAPING_MODE)
    replace_bool("ENABLE_ANALYSIS_MODE", settings.ENABLE_ANALYSIS_MODE)
    replace_int("VIDEOS_TO_PROCESS_COUNT", settings.VIDEOS_TO_PROCESS_COUNT)
    replace_bool("TEST_MODE", settings.TEST_MODE)

    with open(SETTINGS_PATH, "w") as f:
        f.write(content)


@router.get("/settings")
def get_settings():
    return _read_settings()


@router.post("/settings")
def post_settings(settings: PublisherSettings):
    _write_settings(settings)
    return {"ok": True}


# ─── Data files ────────────────────────────────────────────────────────────────

@router.get("/data/files")
def list_data_files():
    result = []
    for key, defn in DATA_FILES.items():
        full = os.path.join(PUBLISHER_DIR, defn["path"])
        exists = os.path.exists(full)
        result.append({
            "key":         key,
            "label":       defn["label"],
            "description": defn["description"],
            "path":        defn["path"],
            "exists":      exists,
            "size":        os.path.getsize(full) if exists else 0,
            "modified":    os.path.getmtime(full) if exists else None,
        })
    return result


@router.get("/data/file")
def get_data_file(key: str):
    if key not in DATA_FILES:
        raise HTTPException(404, f"Unknown file: {key}")
    full = os.path.join(PUBLISHER_DIR, DATA_FILES[key]["path"])
    if not os.path.exists(full):
        raise HTTPException(404, f"File not yet generated: {DATA_FILES[key]['path']}")
    try:
        with open(full, "r", encoding="utf-8") as f:
            data = json.load(f)
        return {"key": key, "label": DATA_FILES[key]["label"], "data": data}
    except Exception as e:
        raise HTTPException(500, str(e))


@router.delete("/data/file")
def delete_data_file(key: str):
    if key not in DATA_FILES:
        raise HTTPException(404, f"Unknown file: {key}")
    full = os.path.join(PUBLISHER_DIR, DATA_FILES[key]["path"])
    if not os.path.exists(full):
        raise HTTPException(404, "File not found")
    os.remove(full)
    return {"ok": True}