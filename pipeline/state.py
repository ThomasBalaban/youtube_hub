"""
Shared mutable state for the pipeline.
All modules import from here — single source of truth.
"""

import json
import os
import time
from collections import deque
from typing import Optional
import asyncio

THIS_DIR     = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HISTORY_FILE = os.path.join(THIS_DIR, "pipeline_history.json")

# ── Pipeline control state ────────────────────────────────────────────────────

state: dict = {
    "running":        False,
    "step":           "idle",   # idle | scanning | processing | waiting | error
    "step_label":     "—",
    "next_scan_at":   None,     # epoch float
    "last_run_at":    None,
    "last_run_files": 0,
    "errors":         [],
}

task: Optional[asyncio.Task] = None

# ── Logs ──────────────────────────────────────────────────────────────────────

logs: deque = deque(maxlen=1000)


def log(msg: str) -> None:
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    logs.append(line)
    print(f"[pipeline] {line}", flush=True)


# ── History ───────────────────────────────────────────────────────────────────

history: dict = {}   # filename → ISO timestamp (or "deleted")
runs:    list = []   # recent run records, newest first (max 20)


def load_history() -> None:
    """
    Load history from disk into the existing dict object IN-PLACE.
    Must not rebind the `history` name — other modules imported it as a
    direct reference to this dict, so reassignment would leave them pointing
    at the old empty object.
    """
    history.clear()
    if os.path.exists(HISTORY_FILE):
        try:
            with open(HISTORY_FILE, "r", encoding="utf-8") as f:
                history.update(json.load(f))
            log(f"📋 Loaded pipeline history: {len(history)} entries")
        except Exception as e:
            log(f"⚠️ Could not load history: {e}")
    else:
        log("📋 No pipeline history found — starting fresh")


def save_history() -> None:
    try:
        with open(HISTORY_FILE, "w", encoding="utf-8") as f:
            json.dump(history, f, indent=2)
    except Exception as e:
        log(f"⚠️ Could not save history: {e}")