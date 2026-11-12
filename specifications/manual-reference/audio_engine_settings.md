# Audio Engine Settings — Technical Background

Technical material retained during the manual reorganization. Historical version numbers describe the source snapshot, not the current support matrix. Consult [AGENTS.md](../../AGENTS.md) and its linked source contracts when changing behavior.

Parallel playback normally exchanges **256 samples** between workers at a time. This reduces
communication overhead while each instrument keeps its existing synthesis block size and
scheduled note/controller timing. A live action received after a batch has begun takes effect
at the next available batch; 256 samples span about **5.3 ms at 48 kHz**. This is separate from
the browser's playback queue and does not change exported CSDs.

The patch engine sample rate and `ksmps` still determine synthesis timing. The Software/Hardware Buffer fields are passed to Csound, but do not control browser playback buffering: the headless worker reads `spout` after each `performKsmps()` call. Changing `-b` or `-B` does not enlarge the browser queue.
