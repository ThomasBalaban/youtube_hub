"""
Service definitions for Project Hub.
Assumes this project lives as a sibling to SimpleAutoSubs and youtube_shorts_publisher.

To add a new project, just append another entry to SERVICE_DEFS below.
"""

import os
import shutil
import sys
from typing import Dict, Any, List

THIS_DIR   = os.path.dirname(os.path.abspath(__file__))
PARENT_DIR = os.path.dirname(THIS_DIR)  # shared parent folder


def conda_python(env_name: str) -> List[str]:
    """
    Resolve the Python binary for the named conda environment.
    Prints detailed diagnostics so failures are visible in the launcher log.
    """
    print(f"[conda_python] Resolving env '{env_name}'")
    print(f"[conda_python] sys.executable = {sys.executable}")
    print(f"[conda_python] CONDA_EXE      = {os.environ.get('CONDA_EXE', '<not set>')}")
    print(f"[conda_python] CONDA_PREFIX   = {os.environ.get('CONDA_PREFIX', '<not set>')}")

    # ── 1. Find conda root ────────────────────────────────────────────────────
    conda_root = ""

    conda_exe_env = os.environ.get("CONDA_EXE", "")
    if conda_exe_env and os.path.isfile(conda_exe_env):
        conda_root = os.path.dirname(os.path.dirname(conda_exe_env))
        print(f"[conda_python] conda root via CONDA_EXE: {conda_root}")
    else:
        conda_on_path = shutil.which("conda")
        if conda_on_path:
            conda_root = os.path.dirname(os.path.dirname(conda_on_path))
            print(f"[conda_python] conda root via PATH: {conda_root}")
        else:
            candidates = [
                os.path.expanduser("~/miniconda3"),
                os.path.expanduser("~/anaconda3"),
                os.path.expanduser("~/miniforge3"),
                "/opt/homebrew/Caskroom/miniconda/base",
                "/usr/local/miniconda3",
            ]
            for c in candidates:
                print(f"[conda_python] checking hardcoded path: {c}  exists={os.path.isdir(c)}")
                if os.path.isdir(os.path.join(c, "envs")):
                    conda_root = c
                    print(f"[conda_python] conda root via hardcoded: {conda_root}")
                    break

    if not conda_root:
        print(f"[conda_python] ❌ Could not find conda root — falling back to sys.executable")
        return [sys.executable, "-u"]

    # ── 2. Find env dir ───────────────────────────────────────────────────────
    env_dir = os.path.join(conda_root, "envs", env_name)
    print(f"[conda_python] env_dir = {env_dir}  exists={os.path.isdir(env_dir)}")

    if not os.path.isdir(env_dir):
        print(f"[conda_python] ❌ Env dir not found — falling back to sys.executable")
        return [sys.executable, "-u"]

    # ── 3. List what's in bin/ so we can see what's available ────────────────
    bin_dir = os.path.join(env_dir, "bin")
    if os.path.isdir(bin_dir):
        py_bins = [f for f in os.listdir(bin_dir) if f.startswith("python")]
        print(f"[conda_python] python* binaries in {bin_dir}: {py_bins}")
    else:
        print(f"[conda_python] ❌ bin dir not found: {bin_dir}")
        return [sys.executable, "-u"]

    # ── 4. macOS framework build (tkinter / GUI apps) ─────────────────────────
    if sys.platform == "darwin":
        fw = os.path.join(env_dir, "python.app", "Contents", "MacOS", "python")
        if os.path.isfile(fw):
            print(f"[conda_python] ✅ Using framework build: {fw}")
            return [fw, "-u"]

    # ── 5. Try python3 then python then any python3.x ────────────────────────
    for name in ("python3", "python"):
        candidate = os.path.join(bin_dir, name)
        if os.path.isfile(candidate):
            print(f"[conda_python] ✅ Found: {candidate}")
            return [candidate, "-u"]

    # Try any python3.x (e.g. python3.11)
    for name in sorted(py_bins, reverse=True):
        if name.startswith("python3.") or name.startswith("python2."):
            candidate = os.path.join(bin_dir, name)
            if os.path.isfile(candidate):
                print(f"[conda_python] ✅ Found versioned binary: {candidate}")
                return [candidate, "-u"]

    print(f"[conda_python] ❌ No python binary found in {bin_dir} — falling back to sys.executable")
    return [sys.executable, "-u"]


# ─────────────────────────────────────────────────────────────────────────────
# Add new projects here.
# ─────────────────────────────────────────────────────────────────────────────

SERVICE_DEFS: Dict[str, Dict[str, Any]] = {
    "simple_auto_subs": {
        "label":        "SimpleAutoSubs",
        "description":  "Auto-transcribes mic & desktop audio, embeds comic-book onomatopoeia, and generates AI titles for gaming clips",
        "cmd":          [*conda_python("simpleautosubs"), "main.py"],
        "cwd":          os.path.join(PARENT_DIR, "SimpleAutoSubs"),
        "port":         None,
        "health_check": "process",
        "managed":      True,
        "is_gui":       True,
        "color_hint":   "#63e2b7",
    },
    "youtube_publisher": {
        "label":        "YouTube Shorts Publisher",
        "description":  "Analyzes draft YouTube Shorts with Gemini AI and auto-publishes them via Playwright browser automation",
        "cmd":          [conda_python("publisher"), os.path.join(PARENT_DIR, "youtube_shorts_publisher", "main.py")],
        "cwd":          os.path.join(PARENT_DIR, "youtube_shorts_publisher"),
        "port":         None,
        "health_check": "process",
        "managed":      True,
        "is_gui":       True,
        "color_hint":   "#f87171",
    },

    # ── Template ──────────────────────────────────────────────────────────────
    # "my_new_project": {
    #     "label":        "My New Project",
    #     "description":  "What it does",
    #     "cmd":          [*conda_python("my-env-name"), "main.py"],
    #     "cwd":          os.path.join(PARENT_DIR, "my_new_project"),
    #     "port":         None,
    #     "health_check": "process",
    #     "managed":      True,
    #     "is_gui":       False,
    #     "color_hint":   "#a855f7",
    # },
}

BOOT_RETRIES: Dict[str, int] = {
    "simple_auto_subs":  5,
    "youtube_publisher": 8,
}