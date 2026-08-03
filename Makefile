SHELL := /bin/bash
.DEFAULT_GOAL := frontend-build

MIDI_PULSE_BIN := tools/midi_pulse
MIDI_PULSE_SRC := tools/midi_pulse.c
MIDI_PULSE_CFLAGS := -O2 -Wall -Wextra -std=c11
MIDI_PULSE_LDFLAGS := -framework CoreMIDI -framework CoreFoundation
MIDI_STATS_BIN := tools/midi_stats
MIDI_STATS_SRC := tools/midi_stats.c

.PHONY: frontend-install frontend-build frontend-test frontend-check backend-test backend-check check benchmark-runtime build test run run-debug midi-pulse-build midi-pulse midi-stats-build midi-stats

frontend-install:
	cd frontend && npm install

frontend-build:
	cd frontend && npm run build

frontend-test:
	cd frontend && npm test

frontend-check:
	cd frontend && npm run check

backend-test:
	uv run --extra dev pytest backend/tests

backend-check:
	uv run --extra dev ruff check backend/app backend/tests backend/tools

check: backend-check backend-test frontend-check

benchmark-runtime:
	uv run --extra dev python -m backend.tools.benchmark_browser_clock_render
	uv run --extra dev python -m backend.tools.benchmark_sequencer_boundary

build: frontend-build

test: backend-test frontend-test

run:
	uv run uvicorn backend.app.main:app --reload --log-level error --no-access-log

run-debug:
	VISUALCSOUND_DEBUG=1 uv run uvicorn backend.app.main:app --reload --log-level info

midi-pulse-build: $(MIDI_PULSE_BIN)

$(MIDI_PULSE_BIN): $(MIDI_PULSE_SRC)
	clang $(MIDI_PULSE_CFLAGS) -o $(MIDI_PULSE_BIN) $(MIDI_PULSE_SRC) $(MIDI_PULSE_LDFLAGS)

midi-pulse: midi-pulse-build
	@echo "Built $(MIDI_PULSE_BIN)"
	@echo "List destinations: ./$(MIDI_PULSE_BIN) --list"
	@echo "Example send: ./$(MIDI_PULSE_BIN) --dest 0 --channel 1 --interval-ms 10 --count 1000"

midi-stats-build: $(MIDI_STATS_BIN)

$(MIDI_STATS_BIN): $(MIDI_STATS_SRC)
	clang $(MIDI_PULSE_CFLAGS) -o $(MIDI_STATS_BIN) $(MIDI_STATS_SRC) $(MIDI_PULSE_LDFLAGS)

midi-stats: midi-stats-build
	@echo "Built $(MIDI_STATS_BIN)"
	@echo "List sources: ./$(MIDI_STATS_BIN) --list"
	@echo "Example receive: ./$(MIDI_STATS_BIN) --dest 0 --channel 1 --report-every 200"
