SHELL := /bin/bash
.DEFAULT_GOAL := frontend-build

.PHONY: frontend-install frontend-build build test run

frontend-install:
	cd frontend && npm install

frontend-build:
	cd frontend && npm run build

build: frontend-build

test:
	uv run pytest backend/tests

run:
	uv run uvicorn backend.app.main:app --reload
