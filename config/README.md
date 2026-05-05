# Centralized secrets

`secrets.json` is the canonical source of API keys for every sibling app under
`youtube-automator/`. It is gitignored. Use `secrets.example.json` as the
template when bootstrapping a fresh checkout.

`shared_secrets.py` is the loader. Sibling apps should import it directly off
disk (see the docstring at the top of the file) rather than copying keys.

## Keys currently tracked

| Key                          | Used by                                               |
| ---------------------------- | ----------------------------------------------------- |
| `GEMINI_API_KEY`             | shorts_analyzer, shorts_strategist, shorts-auto-editor |
| `GEMINI_API_KEY_PUBLISHER`   | youtube_shorts_publisher (`gemjam.py`)                |
| `YOUTUBE_API_KEY`            | shorts_analyzer (Data API)                            |
| `ANTHROPIC_API_KEY`          | shorts_strategist (Claude critic)                     |
| `OPENAI_API_KEY`             | shorts-auto-editor (Whisper transcription)            |

## Override

Set `YOUTUBE_HUB_SECRETS_FILE=/path/to/other/secrets.json` to point the loader
at a different file (handy for separate dev/prod profiles). Individual keys
can also be overridden via their normal env vars — env wins over file.
