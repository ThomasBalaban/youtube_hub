# TODO

- [ ] Auto-run items when Twitch starts / stops.

## Done

- [x] Centralize API keys in `youtube_hub/config/secrets.json` and migrate
      sibling apps (`shorts_analyzer`, `shorts_strategist`, `shorts-auto-editor`,
      `youtube_shorts_publisher`) to read from `shared_secrets.py`.
- [x] Centralize YouTube OAuth (client_secret + tokens) under
      `youtube_hub/config/oauth/`. Analyzer analytics + publisher draft scanner
      now resolve their paths via `shared_secrets.get_oauth_*`.

## Loose ends from the migration

- The old per-project `config.json` files still exist and still contain copies
  of the keys (`shorts_analyzer/config.json`, `shorts_strategist/config.json`,
  `shorts-auto-editor/utils/config.json`). Nothing reads them anymore — safe to
  delete after a full smoke test confirms the apps still work.
