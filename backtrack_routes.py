import os
import json
from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/backtrack")

THIS_DIR = os.path.dirname(os.path.abspath(__file__))
PARENT_DIR = os.path.dirname(THIS_DIR)
BACKTRACK_DIR = os.path.join(PARENT_DIR, "backtrack_scanner")

DATA_FILES = {
    "copied_inventory": {
        "label": "Copied Inventory",
        "description": "Ledger of all successfully copied Backtrack videos",
        "path": "copied_inventory.json",
    },
    "deleted_ledger": {
        "label": "Deleted Ledger",
        "description": "Record of duplicate files removed during clustering",
        "path": "deleted_ledger.json",
    },
}

@router.get("/data/files")
def list_data_files():
    result = []
    for key, defn in DATA_FILES.items():
        full = os.path.join(BACKTRACK_DIR, defn["path"])
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
        raise HTTPException(404, f"Unknown file: {key}")
    
    full = os.path.join(BACKTRACK_DIR, DATA_FILES[key]["path"])
    if not os.path.exists(full):
        raise HTTPException(404, f"File not yet generated: {DATA_FILES[key]['path']}")
    
    try:
        with open(full, "r", encoding="utf-8") as f:
            data = json.load(f)
        return {"key": key, "label": DATA_FILES[key]["label"], "data": data}
    except Exception as e:
        raise HTTPException(500, str(e))