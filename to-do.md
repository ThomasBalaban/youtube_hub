# TODO

- [ ] Wire the sibling apps to read API keys from `youtube_hub/config/secrets.json`
      via `shared_secrets.py` (instead of each keeping their own `config.json` /
      `gemjam.py`). Apps to update:
    - shorts_analyzer (`config.py` / `config.json`)
    - shorts_strategist (`config.py` / `config.json`)
    - shorts-auto-editor (`utils/config.py` / `utils/config.json`)
    - youtube_shorts_publisher (`gemjam.py` / `settings.py`)
    - backtrack_scanner (if/when it grows API usage)
- [ ] Fix the subtitle connection.
- [ ] Fix the output on the shorts editor.
