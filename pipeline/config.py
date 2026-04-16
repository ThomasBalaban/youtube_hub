"""
pipeline/config.py

Dynamic launcher base URL — re-evaluated on every call so late env
changes (e.g. LAUNCHER_PORT set by launcher.py after module import) are
always reflected in HTTP calls.

Port assignments (all in 9000s range):
  9011  — YouTube Hub Launcher (default for standalone AND director-ui managed)
  9020  — SimpleAutoSubs API
"""

import os


def get_launcher_base() -> str:
    """Return the current launcher base URL, reading LAUNCHER_PORT from env."""
    port = int(os.environ.get("LAUNCHER_PORT", 9011))
    return f"http://localhost:{port}"


# Module-level constant kept for any legacy references,
# but ALL pipeline steps should call get_launcher_base() instead.
LAUNCHER_PORT = int(os.environ.get("LAUNCHER_PORT", 9011))
LAUNCHER_BASE = get_launcher_base()