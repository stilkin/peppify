"""Gunicorn config — honors BIND_HOST / BIND_PORT from the environment.

Loaded automatically when running ``gunicorn webapp.app:app`` from the repo root.
The Docker image overrides the bind with an explicit ``-b 0.0.0.0:5000`` on the
CMD (host exposure is controlled by the compose port mapping instead), so this
``bind`` only takes effect for bare-metal runs.
"""

import os

bind = f"{os.getenv('BIND_HOST', '127.0.0.1')}:{os.getenv('BIND_PORT', '5000')}"


def on_starting(server: object) -> None:  # noqa: ARG001
    from webapp.app import warn_if_exposed

    warn_if_exposed()
