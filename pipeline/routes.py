"""
FastAPI router for the Auto-Run pipeline.
All HTTP endpoints live here; business logic lives in other modules.
"""

import asyncio
import time

from fastapi import APIRouter
from pydantic import BaseModel

from pipeline.state   import state, logs, history, runs, task
from pipeline.client  import close_client
from pipeline.settings import read_hub_settings, write_hub_settings
from pipeline.loop    import pipeline_loop
import pipeline.state as _state_module

router = APIRouter(prefix="/pipeline")


# ── Pydantic models ───────────────────────────────────────────────────────────

class DestDirPayload(BaseModel):
    backtrack_dest_dir: str


# ── Control ───────────────────────────────────────────────────────────────────

@router.post("/start")
async def start_pipeline():
    if state["running"]:
        return {"ok": False, "reason": "already_running"}

    state["running"]    = True
    state["step"]       = "idle"
    state["errors"]     = []
    logs.clear()

    _state_module.task = asyncio.create_task(pipeline_loop())
    return {"ok": True}


@router.post("/stop")
async def stop_pipeline():
    state["running"]        = False
    state["next_scan_at"]   = None

    t = _state_module.task
    if t and not t.done():
        t.cancel()

    await close_client()
    return {"ok": True}


# ── Status ────────────────────────────────────────────────────────────────────

@router.get("/status")
def get_status():
    next_scan_in = None
    if state["next_scan_at"]:
        next_scan_in = max(0, int(state["next_scan_at"] - time.time()))

    return {
        "running":        state["running"],
        "step":           state["step"],
        "step_label":     state["step_label"],
        "next_scan_in":   next_scan_in,
        "last_run_at":    state["last_run_at"],
        "last_run_files": state["last_run_files"],
        "errors":         state["errors"],
        "history_count":  len(history),
    }


# ── Logs ──────────────────────────────────────────────────────────────────────

@router.get("/logs")
def get_logs(last: int = 300):
    return {"lines": list(logs)[-last:]}


@router.delete("/logs")
def clear_logs():
    logs.clear()
    return {"ok": True}


# ── Runs ──────────────────────────────────────────────────────────────────────

@router.get("/runs")
def get_runs():
    return {"runs": runs}


# ── Settings ──────────────────────────────────────────────────────────────────

@router.get("/settings")
def get_settings():
    d = read_hub_settings()
    return {
        "backtrack_dest_dir": d.get(
            "backtrack_dest_dir", "/Users/thomasbalaban/Downloads/todoshorts"
        )
    }


@router.post("/settings")
def post_settings(payload: DestDirPayload):
    write_hub_settings({"backtrack_dest_dir": payload.backtrack_dest_dir})
    return {"ok": True}
