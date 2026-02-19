SHELL := /bin/bash
.DEFAULT_GOAL := frontend-build

MIDI_PULSE_BIN := tools/midi_pulse
MIDI_PULSE_SRC := tools/midi_pulse.c
MIDI_PULSE_CFLAGS := -O2 -Wall -Wextra -std=c11
MIDI_PULSE_LDFLAGS := -framework CoreMIDI -framework CoreFoundation
MIDI_STATS_BIN := tools/midi_stats
MIDI_STATS_SRC := tools/midi_stats.c

.PHONY: frontend-install frontend-build build test run midi-pulse-build midi-pulse midi-stats-build midi-stats

frontend-install:
	cd frontend && npm install

frontend-build:
	cd frontend && npm run build

build: frontend-build

test:
	uv run pytest backend/tests

run:
	uv run uvicorn backend.app.main:app --reload

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
