# Installation

> If you just want to run the web UI, the [Docker quick start](../README.md#quick-start-docker)
> needs none of this — it bundles Python and all native libraries. This guide is for running the
> CLI or the web UI directly from a local Python environment.

Requires Python 3.10 or newer. Install [uv](https://docs.astral.sh/uv/getting-started/installation/) first:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

## System prerequisites (WeasyPrint)

PDF rendering uses [WeasyPrint](https://weasyprint.org/), which needs Pango, Cairo, and libgdk-pixbuf at the OS level. Install them once with your package manager:

```bash
# Debian / Ubuntu
sudo apt install libpango-1.0-0 libpangoft2-1.0-0 libcairo2 libgdk-pixbuf2.0-0

# Fedora
sudo dnf install pango cairo gdk-pixbuf2

# macOS (Homebrew)
brew install pango cairo gdk-pixbuf
```

Most modern desktop Linux distros already have these. If the libraries are missing, the package still imports and XML generation still works — only `render_pdf()` (and the CLI's default PDF embedding) will raise a clear `RuntimeError` pointing back to this section.

## Python dependencies

Then clone the repo and sync dependencies:

```bash
uv sync              # installs runtime + dev dependencies into .venv
# or
uv sync --no-dev     # runtime dependencies only (smaller install)
```

`uv sync` creates a `.venv/` in the project root, installs everything pinned via `uv.lock`, and installs the `peppol_sender` package itself in editable mode. No `pip install`, no `python -m venv` — one command.

To run the web UI under gunicorn (see [deployment](deployment.md)), add the optional `prod` group:

```bash
uv sync --group prod   # adds gunicorn alongside the runtime + dev deps
```

## Next steps

- Configure your Peppyrus credentials — see [Configuration](../README.md#configuration).
- Run the tool — see [Usage](usage.md) (CLI + web UI) and [Deployment](deployment.md) (run modes).
