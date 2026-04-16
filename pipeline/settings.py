"""
Hub settings access and inventory management for the pipeline.
"""

import json
import os

from pipeline.state import history, log, save_history

THIS_DIR          = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HUB_SETTINGS_FILE = os.path.join(THIS_DIR, "hub_settings.json")
BACKTRACK_DIR     = os.path.join(os.path.dirname(THIS_DIR), "backtrack_scanner")

MAX_FILES_PER_RUN = 3


# ── Hub settings ──────────────────────────────────────────────────────────────

def read_hub_settings() -> dict:
    if os.path.exists(HUB_SETTINGS_FILE):
        try:
            with open(HUB_SETTINGS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def write_hub_settings(patch: dict) -> None:
    data = read_hub_settings()
    data.update(patch)
    with open(HUB_SETTINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


# ── Inventory ─────────────────────────────────────────────────────────────────

def read_inventory() -> dict:
    inv_path = os.path.join(BACKTRACK_DIR, "copied_inventory.json")

    if not os.path.exists(inv_path):
        log("⚠️ copied_inventory.json not found")
        return {}

    try:
        size = os.path.getsize(inv_path)
        if size == 0:
            log("⚠️ copied_inventory.json is empty — skipping")
            return {}

        with open(inv_path, "r", encoding="utf-8") as f:
            raw = f.read().strip()

        if not raw:
            log("⚠️ copied_inventory.json contains only whitespace — skipping")
            return {}

        return json.loads(raw)

    except (ValueError, json.JSONDecodeError) as e:
        # Catches empty/partial writes from scanner running concurrently
        log(f"⚠️ copied_inventory.json is not valid JSON — skipping ({e})")
        return {}
    except Exception as e:
        log(f"⚠️ Could not read inventory: {e}")
        return {}


def get_new_files() -> list:
    """
    Return up to MAX_FILES_PER_RUN (filename, full_path) tuples not yet in
    history. Files in the inventory but missing from disk (cluster-deleted)
    are auto-marked as handled so they never re-appear.
    """
    inventory = read_inventory()
    settings  = read_hub_settings()
    dest_dir  = settings.get(
        "backtrack_dest_dir", "/Users/thomasbalaban/Downloads/todoshorts"
    )

    new_files = []
    for filename in inventory:
        if filename in history:
            continue
        full_path = os.path.join(dest_dir, filename)
        if os.path.exists(full_path):
            new_files.append((filename, full_path))
        else:
            log(f"⚠️ File deleted/missing, marking as handled: {filename}")
            history[filename] = "deleted"
            save_history()

    new_files.sort(key=lambda x: x[0])
    selected = new_files[:MAX_FILES_PER_RUN]

    if new_files:
        log(f"📂 {len(inventory)} in inventory, {len(new_files)} new, selecting {len(selected)}")
    return selected