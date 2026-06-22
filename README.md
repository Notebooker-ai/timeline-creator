# timeline-creator

An [Open Notebook](https://open-notebook.ai) **creator** plugin: turns notebook
content into an interactive **timeline** of events.

- Emits the `timeline.v1` artifact schema, rendered by the creator's own
  self-contained view bundle (`view/index.html`) in the host's sandboxed iframe.
- Data-only — the LLM extracts dated items (and optional lane groups); no files.
- Implements the [`open-notebook-creator-sdk`](https://github.com/Notebooker-ai/open-notebook-creator-sdk) `BaseCreator` contract; registers under `open_notebook.creators`.

## Model roles

| role | kind | requires |
|------|------|----------|
| `text` | language | `structured_json` |

## Config

| field | default | notes |
|-------|---------|-------|
| `max_events` | 20 | 3–60 |
| `grouped` | false | organize events into labelled lanes |

## Dev

```bash
uv sync --extra dev
uv run pytest
```

MIT licensed.
