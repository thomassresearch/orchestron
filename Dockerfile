FROM node:20-bookworm AS frontend-build
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.14-slim-bookworm AS app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    alsa-utils \
    build-essential \
    csound \
    ffmpeg \
    libasound2 \
    libasound2-dev \
    libffi-dev \
    libjack-jackd2-0 \
    libjack-jackd2-dev \
    libopus0 \
    libsrtp2-1 \
    libsrtp2-dev \
    pkg-config \
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

WORKDIR /app
COPY pyproject.toml uv.lock README.md ./
COPY backend ./backend
RUN uv sync --no-dev --extra streaming
RUN .venv/bin/python -c "import ctcsound, av, aiortc; print('ctcsound/av/aiortc import ok')"

COPY frontend ./frontend
COPY --from=frontend-build /build/frontend/dist ./frontend/dist
COPY Makefile ./Makefile

EXPOSE 8000

CMD [".venv/bin/python", "-m", "backend.app.main", "--audio-output-mode", "streaming", "--host", "0.0.0.0", "--port", "8000", "--no-reload", "--log-level", "info","--debug"]
