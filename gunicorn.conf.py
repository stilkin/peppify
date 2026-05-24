"""Gunicorn config — honors BIND_HOST / BIND_PORT from the environment.

Loaded automatically when running ``gunicorn webapp.app:app`` from the repo root.
The Docker image overrides the bind with an explicit ``-b 0.0.0.0:5000`` on the
CMD (host exposure is controlled by the compose port mapping instead), so this
``bind`` only takes effect for bare-metal runs.
"""

import os

bind = f"{os.getenv('BIND_HOST', '127.0.0.1')}:{os.getenv('BIND_PORT', '5000')}"

# Import the app once in the master and fork workers from it, so every worker
# shares one session-signing key even when SECRET_KEY is unset. Without this, a
# multi-worker run would mint a different random key per worker and the login
# session would only validate on whichever worker happened to set it. Preloading
# also means webapp.app's import-time warn_if_exposed() fires once in the master.
preload_app = True
