"""
FastAPI router for YouTube Shorts Publisher management.
Mounted at /launcher/publisher in launcher.py.

Provides:
  GET/POST  /publisher/settings          — runtime flags (written to runtime_settings.json)
  GET/POST  /publisher/schedule-times    — daily post times (written to hub_settings.json)
  GET       /publisher/data/files        — list viewable output JSON files
  GET       /publisher/data/file?key=    — read a specific output file
  DELETE    /publisher/data/file?key=    — delete a specific output file
  POST      /publisher/check-unuploaded  — run the upload audit script
"""

import json
import os
import subprocess
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/publisher")

THIS_DIR         = os.path.dirname(os.path.abspath(__file__))
PARENT_DIR       = os.path.dirname(THIS_DIR)
PUBLISHER_DIR    = os.path.join(PARENT_DIR, "youtube_shorts_publisher")
HUB_SETTINGS     = os.path.join(THIS_DIR, "hub_settings.json")
RUNTIME_SETTINGS = os.path.join(PUBLISHER_DIR, "runtime_settings.json")

# ── Data files the frontend can browse ───────────────────────────────────────

DATA_FILES: dict = {
    "draft_analysis": {
        "label":       "Draft Analysis",
        "description": "AI-generated metadata for analyzed draft Shorts",
        "path":        "draft_analysis.json",
    },
    "failed_shorts": {
        "label":       "Failed Shorts",
        "description": "Shorts that failed during analysis or download",
        "path":        "failed_shorts_data.json",
    },
    "draft_videos": {
        "label":       "Draft Videos",
        "description": "All current draft videos from YouTube Studio",
        "path":        os.path.join("saved_shorts_data", "draft_videos.json"),
    },
    "scheduled_videos": {
        "label":       "Scheduled Videos",
        "description": "All scheduled videos with timestamps",
        "path":        os.path.join("saved_shorts_data", "scheduled_videos.json"),
    },
    "backtrack_videos": {
        "label":       "Backtrack Videos",
        "description": "Subset of draft/scheduled videos containing 'Backtrack' in the title",
        "path":        os.path.join("saved_shorts_data", "backtrack_videos.json"),
    },
}

_RUNTIME_DEFAULTS = {
    "PROCESS_SINGLE_VIDEO":    False,
    "ENABLE_SCRAPING_MODE":    False,
    "ENABLE_ANALYSIS_MODE":    False,
    "ENABLE_UPLOAD_MODE":      True,
    "UPLOAD_LIMIT":            0,
    "VIDEOS_TO_PROCESS_COUNT": 100,
}

# ── Pydantic models ───────────────────────────────────────────────────────────

class PublisherSettings(BaseModel):
    PROCESS_SINGLE_VIDEO:    bool = False
    ENABLE_SCRAPING_MODE:    bool = False
    ENABLE_ANALYSIS_MODE:    bool = False
    ENABLE_UPLOAD_MODE:      bool = False
    VIDEOS_TO_PROCESS_COUNT: int  = 50

class ScheduleTimesPayload(BaseModel):
    times: list[str]

# ── Internal helpers ──────────────────────────────────────────────────────────

def _read_runtime() -> dict:
    if os.path.exists(RUNTIME_SETTINGS):
        try:
            with open(RUNTIME_SETTINGS, "r", encoding="utf-8") as f:
                saved = json.load(f)
            # Merge onto defaults so any new keys always exist
            return {**_RUNTIME_DEFAULTS, **saved}
        except Exception:
            pass
    return dict(_RUNTIME_DEFAULTS)


def _write_runtime(data: dict) -> None:
    os.makedirs(os.path.dirname(RUNTIME_SETTINGS), exist_ok=True)
    with open(RUNTIME_SETTINGS, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def _read_hub() -> dict:
    if os.path.exists(HUB_SETTINGS):
        try:
            with open(HUB_SETTINGS, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def _write_hub(patch: dict) -> None:
    data = _read_hub()
    data.update(patch)
    with open(HUB_SETTINGS, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

# ── Settings ──────────────────────────────────────────────────────────────────

@router.get("/settings")
def get_settings():
    return _read_runtime()


@router.post("/settings")
def post_settings(payload: PublisherSettings):
    current = _read_runtime()
    current.update(payload.model_dump())
    _write_runtime(current)
    return {"ok": True}

# ── Schedule times ─────────────────────────────────────────────────────────────

_DEFAULT_TIMES = ["10:00", "12:00", "16:00", "18:00", "20:00"]


@router.get("/schedule-times")
def get_schedule_times():
    return {"times": _read_hub().get("schedule_times", _DEFAULT_TIMES)}


@router.post("/schedule-times")
def post_schedule_times(payload: ScheduleTimesPayload):
    _write_hub({"schedule_times": payload.times})
    return {"ok": True}

# ── Data file viewer ───────────────────────────────────────────────────────────

@router.get("/data/files")
def list_data_files():
    result = []
    for key, defn in DATA_FILES.items():
        full   = os.path.join(PUBLISHER_DIR, defn["path"])
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
        raise HTTPException(404, f"Unknown file key: {key}")

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
        raise HTTPException(404, f"Unknown file key: {key}")

    full = os.path.join(PUBLISHER_DIR, DATA_FILES[key]["path"])
    if not os.path.exists(full):
        raise HTTPException(404, f"File not found: {DATA_FILES[key]['path']}")

    try:
        os.remove(full)
        return {"ok": True, "deleted": DATA_FILES[key]["path"]}
    except Exception as e:
        raise HTTPException(500, str(e))

# ── Check Unuploaded ──────────────────────────────────────────────────────────

@router.post("/check-unuploaded")
def run_check_unuploaded():
    from service_defs import conda_python

    python_exe = conda_python("publisher")
    script     = os.path.join(PUBLISHER_DIR, "uploader", "check_unuploaded.py")

    if not os.path.exists(script):
        raise HTTPException(404, "check_unuploaded.py not found in publisher directory")

    try:
        result = subprocess.run(
            [python_exe, "-u", script],
            cwd=PUBLISHER_DIR,
            capture_output=True,
            text=True,
            timeout=120,
        )
        output = result.stdout + result.stderr
        return {"ok": result.returncode == 0, "output": output}
    except subprocess.TimeoutExpired:
        raise HTTPException(408, "Audit script timed out after 120s")
    except Exception as e:
        raise HTTPException(500, str(e))