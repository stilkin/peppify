FROM python:3.12-slim-bookworm

# WeasyPrint native dependencies (see https://doc.courtbouillon.org/weasyprint/stable/first_steps.html).
RUN apt-get update && apt-get install -y --no-install-recommends \
      libpango-1.0-0 \
      libpangoft2-1.0-0 \
      libharfbuzz0b \
      libcairo2 \
      libgdk-pixbuf-2.0-0 \
      libffi-dev \
      shared-mime-info \
      fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.5 /uv /usr/local/bin/uv

WORKDIR /app

# Dependency layer — cached unless pyproject.toml or uv.lock changes.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --group prod --no-install-project

# Source layer.
COPY peppol_sender/ peppol_sender/
COPY webapp/ webapp/
COPY schemas/ schemas/
# LICENSE + README.md are required by pyproject.toml (license + readme metadata);
# the final `uv sync` builds the peppify package and hatchling validates both.
COPY cli.py sample_invoice.json LICENSE README.md ./

# Finalize install with project code in place.
RUN uv sync --frozen --no-dev --group prod

RUN useradd --create-home --uid 1000 appuser && chown -R appuser /app
USER appuser

EXPOSE 5000

CMD ["uv", "run", "gunicorn", "webapp.app:app", \
     "-b", "0.0.0.0:5000", \
     "--workers", "2", \
     "--access-logfile", "-", \
     "--error-logfile", "-"]
