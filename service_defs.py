"""
Service definitions for Project Hub.
Assumes this project lives as a sibling to SimpleAutoSubs and youtube_shorts_publisher.

To add a new project, just append another entry to SERVICE_DEFS below.
"""

import os
import sys
from typing import Dict, Any

THIS_DIR   = os.path.dirname(os.path.abspath(__file__))
PARENT_DIR = os.path.dirname(THIS_DIR)  # shared parent folder


def conda_python(env_name: str) -> str:
    """Resolve the Python executable for a named conda environment."""
    conda_exe = os.environ.get("CONDA_EXE", "")
    if conda_exe:
        conda_root = os.path.dirname(os.path.dirname(conda_exe))
    else:
        conda_prefix = os.environ.get("CONDA_PREFIX", "")
        if conda_prefix:
            parts = conda_prefix.split(os.sep + "envs" + os.sep)
            conda_root = parts
        else:
            conda_root = os.path.expanduser("~/miniconda3")
            if not os.path.isdir(conda_root):
                conda_root = os.path.expanduser("~/anaconda3")

    env_dir = os.path.join(conda_root, "envs", env_name)
    if not os.path.isdir(env_dir):
        print(f"⚠️  Conda env '{env_name}' not found at {env_dir} — falling back to sys.executable")
        return sys.executable

    # macOS: prefer framework build so tkinter windows appear
    if sys.platform == "darwin":
        fw = os.path.join(env_dir, "python.app", "Contents", "MacOS", "python")
        if os.path.exists(fw):
            return fw

    # Windows: python.exe is in the env root folder
    if os.name == "nt":
        for name in ("python.exe", "pythonw.exe"):
            candidate = os.path.join(env_dir, name)
            if os.path.exists(candidate):
                return candidate

    # Linux / macOS standard
    for name in ("python3", "python"):
        candidate = os.path.join(env_dir, "bin", name)
        if os.path.exists(candidate):
            return candidate

    print(f"⚠️  No python binary found in conda env '{env_name}' — falling back")
    return sys.executable


# ─────────────────────────────────────────────────────────────────────────────
# Add new projects here.
#
# health_check options:
#   "process" — just checks if the PID is alive (use for GUI/desktop apps)
#   "http"    — polls health_url with GET (use for FastAPI / web servers)
#   "tcp"     — opens a TCP connection to port (use for socket servers)
#
# color_hint: accent colour shown on the card border when the service is online.
# ─────────────────────────────────────────────────────────────────────────────

SERVICE_DEFS: Dict[str, Dict[str, Any]] = {
    "simple_auto_subs": {
        "label":        "SimpleAutoSubs (GUI)",
        "description":  "Auto-transcribes mic & desktop audio, embeds comic-book onomatopoeia, and generates AI titles for gaming clips",
        "cmd":          [conda_python("simpleautosubs"), "main.py"],
        "cwd":          os.path.join(PARENT_DIR, "SimpleAutoSubs"),
        "port":         None,
        "health_check": "process",
        "managed":      True,
        "is_gui":       True,
        "color_hint":   "#63e2b7",     # teal
    },
    "simple_auto_subs_api": {
        "label":        "SimpleAutoSubs API",
        "description":  "Headless REST API for the Hub to queue videos, change settings, and run subtitle processing without the GUI",
        "cmd":          [conda_python("simpleautosubs"), "-u", "api_server.py"],
        "cwd":          os.path.join(PARENT_DIR, "SimpleAutoSubs"),
        "port":         8020,
        "health_check": "http",
        "health_url":   "http://localhost:8020/health",
        "managed":      True,
        "is_gui":       False,
        "color_hint":   "#34d399",     # emerald
    },
    "youtube_publisher": {
        "label":        "YouTube Shorts Publisher",
        "description":  "Analyzes draft YouTube Shorts with Gemini AI and auto-publishes them via Playwright browser automation",
        "cmd":          [conda_python("publisher"), "main.py"],
        "cwd":          os.path.join(PARENT_DIR, "youtube_shorts_publisher"),
        "port":         None,
        "health_check": "process",
        "managed":      True,
        "is_gui":       True,
        "color_hint":   "#f87171",     # red
    },

    # ── Template for future projects ──────────────────────────────────────────
    # "my_new_project": {
    #     "label":        "My New Project",
    #     "description":  "What it does",
    #     "cmd":          [conda_python("my-env-name"), "main.py"],
    #     "cwd":          os.path.join(PARENT_DIR, "my_new_project"),
    #     "port":         None,
    #     "health_check": "process",
    #     "managed":      True,
    #     "is_gui":       False,
    #     "color_hint":   "#a855f7",
    # },
}

# How many times to poll the health check before giving up on startup
BOOT_RETRIES: Dict[str, int] = {
    "simple_auto_subs":     5,
    "simple_auto_subs_api": 12,   # Heavier imports — give it more time
    "youtube_publisher":    8,
}