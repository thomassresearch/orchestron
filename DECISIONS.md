# VisualCSound Implementation Decisions

This file records implementation decisions taken while building the MVP from `/Users/thuber/Projekte/VisualCSound/ARCHITECTURE.md`.

## 1) Repository Structure

- Decision: Use a monorepo layout with `/Users/thuber/Projekte/VisualCSound/backend` and `/Users/thuber/Projekte/VisualCSound/frontend`.
- Why: Keeps backend and frontend separate while preserving a single project root and shared architecture docs.
- Alternative considered: Splitting into two repositories; rejected to keep iteration and local runtime setup simple.

## 2) Python Package and Dependency Management

- Decision: Use `uv` with a root `pyproject.toml` and editable install (`uv pip install -e '.[dev]'`).
- Why: Satisfies explicit requirement to use `uv` and keeps backend dependency setup reproducible.
- Alternative considered: Plain `requirements.txt`; rejected because requirement requested `uv` package management.

## 3) Backend Framework and API Contracts

- Decision: Implement backend as FastAPI with routers under `/api` for `opcodes`, `patches`, `sessions`, and `midi`, plus WebSocket route `/ws/sessions/{session_id}`.
- Why: Aligns directly with architecture contract and provides clear service boundaries.
- Alternative considered: Single monolithic router; rejected to keep services and route ownership modular.

## 4) Persistence Strategy

- Decision: Persist patches in SQLite using SQLAlchemy ORM (`PatchRecord` with serialized graph JSON).
- Why: Matches architecture expectation (SQLite local-first), supports schema-versioned patch docs.
- Alternative considered: pure file-based JSON storage; rejected because DB-backed CRUD was part of architecture.

## 5) Domain Model Shapes

- Decision: Model patch graph with explicit `nodes`, `connections`, `engine_config`, and typed ports.
- Why: Enables graph validation + deterministic compiler behavior.
- Alternative considered: untyped free-form graph payload; rejected because typed connector rules are a key product requirement.

## 6) Opcode Catalog Scope

- Decision: Start with curated opcode subset (`midi_note`, `adsr`, `oscili`, `k_mul`, `a_mul`, `k_to_a`, `moogladder`, `mix2`, `outs`, `const_k`, `const_i`, `const_a`).
- Why: Allows end-to-end compile/runtime reliability before expanding full CSound opcode surface.
- Alternative considered: parsing entire CSound opcode reference immediately; rejected as high complexity and high risk for first implementation.

## 7) Opcode Metadata Format

- Decision: Keep opcode metadata in Python service (`OpcodeService`) with typed input/output specs and format templates.
- Why: Fast iteration and strong typing in one place.
- Alternative considered: JSON file registry; rejected for now to reduce moving parts in the first MVP.

## 8) Graph Validation Rules

- Decision: Enforce one inbound connection per input port, signal type compatibility, required input presence, and cycle detection.
- Why: Mirrors architecture constraints and prevents invalid CSound generation.
- Alternative considered: permissive validation; rejected because compile/runtime errors become opaque and hard to debug.

## 9) Type Compatibility Policy

- Decision: Allow exact type matches and `i -> k` promotion; block other implicit promotions.
- Why: Keeps patch typing predictable and encourages explicit conversion nodes (`k_to_a`) where needed.
- Alternative considered: broad implicit coercion; rejected to avoid silent sonic errors.

## 10) Compiler Output Strategy

- Decision: Compile patch graph to ORC and wrap into CSD with realtime MIDI options and `massign 0, 1`.
- Why: Provides a practical bridge from visual graph to playable CSound runtime.
- Alternative considered: ORC-only output; rejected because session runtime needs self-contained CSD for direct engine execution.

## 11) Safety in Parameter Expressions

- Decision: Restrict dynamic string expressions for numeric paths to a conservative character whitelist.
- Why: Reduces unsafe template/code injection surface from UI-provided params.
- Alternative considered: unrestricted expression text; rejected on safety grounds.

## 12) Session Runtime Model

- Decision: Keep sessions in memory (`RuntimeSession`) with explicit states (`idle`, `compiled`, `running`, `error`).
- Why: Aligns with architecture and keeps runtime control low-latency.
- Alternative considered: persisting session state in DB; rejected because runtime state is ephemeral and process-local.

## 13) Event Streaming

- Decision: Implement per-session event bus using asyncio queues and WebSocket fanout.
- Why: Supports compile/start/stop/midi telemetry to frontend in real time.
- Alternative considered: polling-only status endpoint; rejected as inferior UX for realtime workflows.

## 14) CSound Engine Integration

- Decision: Add runtime engine abstraction with automatic `ctcsound` backend detection and a mock fallback.
- Why: Keeps app usable when native CSound bindings are unavailable and improves development portability.
- Alternative considered: hard fail if `ctcsound` missing; rejected because it blocks development/testing in unsupported environments.

## 15) MIDI Discovery and Binding

- Decision: Use `mido` for input enumeration when available; fallback to deterministic IAC-like entries.
- Why: Supports macOS loopback workflows while preserving basic behavior in constrained environments.
- Alternative considered: no MIDI enumeration endpoint; rejected because runtime MIDI selection is a core requirement.

## 16) macOS Loopback UX

- Decision: Treat IAC Driver buses as first-class MIDI targets and surface binding via `/api/midi/inputs` + `/api/sessions/{id}/midi-input`.
- Why: Matches architecture goal of integrating with other macOS MIDI software.
- Alternative considered: custom virtual MIDI driver setup; rejected as unnecessary for MVP.

## 17) Icon Strategy

- Decision: Ship curated SVG placeholders for initial opcode set under backend static assets.
- Why: Satisfies iconized node/catalog requirement and keeps rendering crisp.
- Alternative considered: defer icons entirely; rejected because icon discoverability is part of product spec.

## 18) Frontend Framework Choice

- Decision: Use React + TypeScript + Tailwind and Zustand store.
- Why: Matches architecture recommendations and keeps state/actions centralized.
- Alternative considered: Redux Toolkit; rejected to reduce boilerplate in MVP.

## 19) Graph Editor Library

- Decision: Use Rete.js with area/connection/react plugins and typed sockets per signal type.
- Why: Delivers requested visual patch graph behavior and native connection constraints.
- Alternative considered: custom canvas editor; rejected due explicit requirement for Rete.js.

## 20) Frontend State Flow

- Decision: Keep patch graph canonical in store, rebuild Rete view from state, and push graph changes back from editor events.
- Why: Preserves serializable patch state for persistence and compile operations.
- Alternative considered: letting Rete own source-of-truth state; rejected because API persistence/compile needs explicit graph JSON.

## 21) Session Workflow in UI

- Decision: Compile/start operations auto-ensure patch persistence and session existence.
- Why: Removes manual multi-step friction for first-play experience.
- Alternative considered: force user to manually save/create session first; rejected as unnecessary UX overhead.

## 22) Styling Direction

- Decision: Use dark steel + cyan accent visual language with non-default display/body font stacks and gradient background.
- Why: Delivers intentional visual style and avoids boilerplate/plain layout.
- Alternative considered: default utility-only styles; rejected for low visual identity.

## 23) Testing Scope

- Decision: Add backend API tests for health endpoint and patch->session->compile/start/stop flow.
- Why: Validates critical end-to-end MVP path and catches integration regressions.
- Alternative considered: no tests initially; rejected because runtime orchestration is non-trivial and error-prone.

## 24) Health and Operations Endpoints

- Decision: Implement `/api/health` and `/api/health/realtime`.
- Why: Matches architecture observability baseline and enables simple runtime checks.
- Alternative considered: only root health check; rejected because runtime-specific health was explicitly required.

## 25) Error Handling Contract

- Decision: Return detailed compile diagnostics with HTTP 422 when graph compilation fails.
- Why: Gives frontend enough context to surface actionable validation errors.
- Alternative considered: generic 500 errors; rejected due poor debuggability.

## 26) Startup Behavior for Static Assets

- Decision: Ensure static directories are created before FastAPI mounts static files.
- Why: Prevents startup/test failures when custom static path does not exist yet.
- Alternative considered: rely solely on lifespan hook to create directories; rejected because mount happens before lifespan in app construction.

## 27) Documentation Scope

- Decision: Keep architecture in `/Users/thuber/Projekte/VisualCSound/ARCHITECTURE.md`, decisions in `/Users/thuber/Projekte/VisualCSound/DECISIONS.md`, and setup guide in `/Users/thuber/Projekte/VisualCSound/README.md`.
- Why: Separates conceptual architecture, implementation rationale, and practical run instructions.
- Alternative considered: merge everything into one doc; rejected because it reduces clarity as project grows.

## 28) Frontend Validation Constraint

- Decision: Proceed with full frontend source implementation even though `npm install` was not completed in this sandbox run.
- Why: Backend and API could be fully validated now; frontend dependency install was blocked/stalled in environment.
- Alternative considered: delaying frontend implementation until install succeeds; rejected because user requested full implementation in this turn.

## 29) Backend-Served Frontend Endpoint

- Decision: Serve built frontend assets from FastAPI at `/client` when `frontend/dist` exists, and return a `503` guidance response at `/client` when build output is missing.
- Why: Enables single-process distribution of API + UI while giving explicit operator feedback if frontend is not built.
- Alternative considered: always 404 when dist is missing; rejected because the guidance response is clearer during setup.

## 30) Same-Origin API Defaults for `/client`

- Decision: Change frontend default API base from `http://localhost:8000/api` to `/api`, and default WebSocket base to the current browser host/protocol.
- Why: Prevents host mismatch/CORS failures when frontend is served from backend at `/client` (for example using `127.0.0.1` instead of `localhost`).
- Alternative considered: keep absolute localhost URLs and require environment overrides; rejected because same-origin defaults are safer and zero-config for backend-served UI.
