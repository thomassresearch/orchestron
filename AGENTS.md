# VisualCSound Agent Notes
- Use `visualcsound-opcode-support` whenever asked to add or update opcodes.
- Most feature work spans both `frontend/src` and `backend/app`; keep API and behavior aligned.
- For backend behavior changes, add or update regression tests (start with `backend/tests/test_api.py` and service tests).
- For user-visible workflow or UI changes, update `README.md` and relevant files in `documentation/`.
- Ask the user to provide new screenshots to be saved in `screenshots/` when UI layout or interaction changes.
- Keep localization consistent (EN/DE/FR/ES) when changing labels or integrated help text.
- Creating instruments must be additive: preserve existing example/template fixtures when adding exports or organizing instrument packs. In particular, `examples/analog_drumkit.patch.json` is a build dependency imported by `frontend/src/lib/audioTemplates.ts` and copied by `Dockerfile`; do not delete it during export cleanup. A native `*.orch.instrument.json` export is not a drop-in replacement for a raw patch fixture.
- Before moving, renaming, converting, or removing an example, use `rg` to find its frontend imports, Docker `COPY` instructions, tests, and documentation/skill links. Update all affected references together, ensure `.dockerignore` permits the required build inputs, and include those files in the same version-controlled change.
- Before finishing instrument/example changes, verify the shared build inputs still exist, run `npm --prefix frontend run build`, and run `docker build --target frontend-build .` to check the actual Docker context. If Docker is unavailable, report that check as unperformed. Successful patch compilation or audio validation does not verify the frontend or Docker build.
