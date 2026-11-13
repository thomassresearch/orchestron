# Diagnostic image only. Does not rebuild, tag or restart the running application.
ARG BASE_IMAGE=visualcsound-browser-clock:local
FROM rust:1.90-bookworm AS worker-build
WORKDIR /worker
COPY backend/experiments/rust_worker/Cargo.toml backend/experiments/rust_worker/Cargo.lock ./
COPY backend/experiments/rust_worker/lib.rs ./
RUN cargo build --release --offline

FROM ${BASE_IMAGE}
WORKDIR /app
COPY backend/ ./backend/
COPY --from=worker-build /worker/target/release/liborchestron_worker_experiment.so /experiment/
# Record the same source/binary identity as the host build, without adding a runtime dependency.
RUN .venv/bin/python -c "import hashlib,json; from pathlib import Path; p=Path('/experiment/liborchestron_worker_experiment.so'); root=Path('backend/experiments/rust_worker'); p.with_suffix('.so.json').write_text(json.dumps({'library_sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'sources':{n:hashlib.sha256((root/n).read_bytes()).hexdigest() for n in ('lib.rs','Cargo.toml')},'rustc':'rust:1.90-bookworm'}))"
RUN mkdir -p backend/experiments/rust_worker/_native && cp /experiment/liborchestron_worker_experiment.so* backend/experiments/rust_worker/_native/
RUN VISUALCSOUND_SEQUENCER_IMPLEMENTATION=cython .venv/bin/python -c "from backend.app.services.sequencer_playback import implementation; assert implementation == 'cython'"
ENTRYPOINT [".venv/bin/python", "-m", "backend.experiments.rust_worker.benchmark", "--library", "/experiment/liborchestron_worker_experiment.so"]
