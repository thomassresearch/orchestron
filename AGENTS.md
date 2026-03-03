# VisualCSound Agent Notes
- Use `visualcsound-opcode-support` whenever asked to add or update opcodes.
- Most feature work spans both `frontend/src` and `backend/app`; keep API and behavior aligned.
- For backend behavior changes, add or update regression tests (start with `backend/tests/test_api.py` and service tests).
- For user-visible workflow or UI changes, update `README.md` and relevant files in `documentation/`.
- Ask the user to provide new screenshots to be saved in `screenshots/` when UI layout or interaction changes.
- Keep localization consistent (EN/DE/FR/ES) when changing labels or integrated help text.
