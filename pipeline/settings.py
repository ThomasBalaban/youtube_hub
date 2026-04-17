"""
Hub settings access and inventory management for the pipeline.
"""

import json
import os

from pipeline.state import history, log, save_history

THIS_DIR          = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HUB_SETTINGS_FILE = os.path.join(THIS_DIR, "hub_settings.json")
BACKTRACK_DIR     = os.path.join(os.path.dirname(THIS_DIR), "backtrack_scanner")


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
        log(f"⚠️ copied_inventory.json not found (looked in: {inv_path})")
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
        log(f"⚠️ copied_inventory.json is not valid JSON — skipping ({e})")
        return {}
    except Exception as e:
        log(f"⚠️ Could not read inventory: {e}")
        return {}


def get_new_files() -> list:
    """
    Return all (filename, full_path) tuples not yet processed.

    Handles three cases:
      - Not in history at all + exists on disk  → queue it
      - In history as "deleted" but back on disk → un-delete and re-queue
        (happens when the user clears the dest folder and the scanner
        re-copies the same filenames, or when cluster-cleanup trashed a
        file that has since been restored)
      - In history as "deleted" and still missing → skip (already handled)
      - In history with a timestamp              → skip (already processed)
    """
    inventory = read_inventory()
    settings  = read_hub_settings()
    dest_dir  = settings.get(
        "backtrack_dest_dir", "/Users/thomasbalaban/Downloads/todoshorts"
    )

    log(f"🔍 dest_dir: {dest_dir}")
    log(f"📋 Inventory: {len(inventory)} total entries | History: {len(history)} entries")

    if not inventory:
        log("⚠️ Inventory is empty — nothing to check")
        return []

    new_files            = []
    already_processed    = 0
    resurrected          = 0
    missing_from_disk    = 0
    history_changed      = False

    for filename in inventory:
        full_path = os.path.join(dest_dir, filename)
        hist_val  = history.get(filename)

        if hist_val is None:
            # Never seen before
            if os.path.exists(full_path):
                new_files.append((filename, full_path))
            else:
                log(f"⚠️ New inventory entry missing from disk: {filename}")
                history[filename] = "deleted"
                history_changed = True
                missing_from_disk += 1

        elif hist_val == "deleted":
            # Was previously trashed — check if it came back
            if os.path.exists(full_path):
                log(f"🔄 Resurrected (was deleted, now on disk): {filename}")
                del history[filename]
                history_changed = True
                new_files.append((filename, full_path))
                resurrected += 1
            else:
                missing_from_disk += 1

        else:
            # Has a real timestamp — already processed, skip
            already_processed += 1

    if history_changed:
        save_history()

    log(
        f"📊 {already_processed} already processed | "
        f"{missing_from_disk} missing from disk | "
        f"{resurrected} resurrected | "
        f"{len(new_files)} ready to process"
    )

    new_files.sort(key=lambda x: x[0])
    return new_files