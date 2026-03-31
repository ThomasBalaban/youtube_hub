"""
FastAPI router for reading/writing youtube_shorts_publisher settings.
Include this in launcher.py:

    from publisher_routes import router as publisher_router
    app.include_router(publisher_router, prefix="/launcher")
"""

import re
import os
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/publisher")

THIS_DIR = os.path.dirname(os.path.abspath(__file__))
PARENT_DIR = os.path.dirname(THIS_DIR)
SETTINGS_PATH = os.path.join(PARENT_DIR, "youtube_shorts_publisher", "settings.py")


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

    def get_bool(name: str) -> bool:
        m = re.search(rf"^{name}\s*=\s*(True|False)", content, re.MULTILINE)
        return m.group(1) == "True" if m else False

    def get_int(name: str) -> int:
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

    def replace_bool(name: str, value: bool) -> None:
        nonlocal content
        content = re.sub(
            rf"^({name}\s*=\s*)(True|False)",
            rf"\g<1>{value}",
            content,
            flags=re.MULTILINE,
        )

    def replace_int(name: str, value: int) -> None:
        nonlocal content
        content = re.sub(
            rf"^({name}\s*=\s*)\d+",
            rf"\g<1>{value}",
            content,
            flags=re.MULTILINE,
        )

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