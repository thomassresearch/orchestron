FROM node:20-bookworm AS frontend-build
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# Keep the repository-relative JSON imports available to Vite and TypeScript.
COPY examples/instruments/template/analog_drumkit.patch.json ../examples/instruments/template/
COPY backend/app/data/opcodes.json ../backend/app/data/
# TypeScript checks frontend tests too, including their shared fixture imports.
COPY backend/tests/fixtures/ ../backend/tests/fixtures/
RUN npm run build

FROM python:3.13-slim-bookworm AS backend-base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    RAWWAVE_PATH=/usr/share/stk/rawwaves

RUN apt-get update && apt-get install -y --no-install-recommends \
    alsa-utils \
    dpkg-dev \
    csound \
    csound-plugins \
    libasound2 \
    libffi8 \
    libjack-jackd2-0 \
    stk \
    && rm -rf /var/lib/apt/lists/*

RUN set -eux; \
    apt-get update; \
    if apt-cache show libcsnd6-6.0v5 >/dev/null 2>&1; then \
      apt-get install -y --no-install-recommends libcsnd6-6.0v5; \
    elif apt-cache show libcsnd6-6.0 >/dev/null 2>&1; then \
      apt-get install -y --no-install-recommends libcsnd6-6.0; \
    else \
      echo "No libcsnd6 runtime package found in apt repositories"; \
      apt-cache search libcsnd6 || true; \
      exit 1; \
    fi; \
    rm -rf /var/lib/apt/lists/*

# ctcsound on Linux loads unversioned names ("libcsound64.so", "libcsnd6.so").
# Some Debian installs only provide versioned files, so add symlinks when needed.
RUN set -eux; \
    arch="$(dpkg-architecture -qDEB_HOST_MULTIARCH)"; \
    ldconfig; \
    mkdir -p "/usr/lib/${arch}"; \
    for base in libcsound64 libcsnd6; do \
      target="$(ldconfig -p | awk -v b="${base}" '$1 == (b ".so") { print $NF; exit } $1 ~ ("^" b "\\.so\\.") { print $NF; exit }')"; \
      if [ -z "${target}" ]; then \
        target="$(find /usr/lib /lib -type f \( -name "${base}.so.*" -o -name "${base}-*.so.*" \) 2>/dev/null | head -n 1 || true)"; \
      fi; \
      if [ -n "${target}" ] && [ ! -e "/usr/lib/${arch}/${base}.so" ]; then \
        ln -s "${target}" "/usr/lib/${arch}/${base}.so"; \
      fi; \
    done

RUN pip install --no-cache-dir uv

FROM backend-base AS backend-build
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libasound2-dev libffi-dev libjack-jackd2-dev pkg-config \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY pyproject.toml uv.lock README.md hatch_build.py ./
COPY backend ./backend
RUN VISUALCSOUND_BUILD_CYTHON=required uv sync --frozen --no-dev --no-editable

FROM backend-base AS app
WORKDIR /app
COPY pyproject.toml uv.lock README.md hatch_build.py ./
COPY backend ./backend
COPY --from=backend-build /app/.venv ./.venv
# Local source precedes site-packages; expose the image's prebuilt extension there.
COPY --from=backend-build /app/.venv/lib/python3.13/site-packages/backend/app/services/_sequencer_playback*.so* ./backend/app/services/
RUN VISUALCSOUND_SEQUENCER_IMPLEMENTATION=cython .venv/bin/python -c \
    "import ctcsound, numpy; from backend.app.services.sequencer_playback import implementation; assert implementation == 'cython'"

COPY frontend ./frontend
COPY --from=frontend-build /build/frontend/dist ./frontend/dist
COPY Makefile ./Makefile

EXPOSE 8000

CMD [".venv/bin/python", "-m", "backend.app.main", "--audio-output-mode", "browser_clock", "--host", "0.0.0.0", "--port", "8000", "--no-reload", "--log-level", "info","--debug"]
