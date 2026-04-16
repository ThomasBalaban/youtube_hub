"""
pipeline/config.py

Single source of truth for the launcher's base URL.

launcher.py writes its actual port into os.environ["LAUNCHER_PORT"] at startup,
so this always reflects the real port regardless of how the process was spawned.

Port assignments (all in 9000s range):
  9010 — default (direct: python launcher.py)
  9011 — external UI  (LAUNCHER_PORT=9011 python launcher.py)
  9020 — SimpleAutoSubs API
"""

import os

LAUNCHER_PORT = int(os.environ.get("LAUNCHER_PORT", 9010))
LAUNCHER_BASE = f"http://localhost:{LAUNCHER_PORT}"