# Diagnostic image only. Supply an app image built from this checkout and the
# vendored Cargo sources as a named Docker build context ("crates").
ARG BASE_IMAGE=visualcsound-browser-clock:local
FROM rust:1.90-bookworm AS compile
WORKDIR /probe
COPY --from=crates . /crates
COPY tools/experiments/rust_coordinator/Cargo.* tools/experiments/rust_coordinator/*.rs ./
RUN cargo build --release --locked --offline --config 'source.crates-io.replace-with="vendored"' --config 'source.vendored.directory="/crates"'

FROM ${BASE_IMAGE}
WORKDIR /app
COPY backend/ backend/
COPY tools/experiments/rust_coordinator/ tools/experiments/rust_coordinator/
COPY --from=compile /probe/target/release/libcoordinator_probe.so output/rust-coordinator/target/release/
ENV VISUALCSOUND_SEQUENCER_IMPLEMENTATION=cython
RUN .venv/bin/python -c "import json; from tools.experiments.rust_coordinator.benchmark import LIBRARY,native_stamp,default_library; default_library(); LIBRARY.with_suffix('.stamp.json').write_text(json.dumps(native_stamp())); from backend.app.services.sequencer_playback import implementation; assert implementation=='cython'"
ENTRYPOINT [".venv/bin/python", "-m", "tools.experiments.rust_coordinator.benchmark"]
