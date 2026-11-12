# Appendix — Technical Background

Technical material retained during the manual reorganization. Historical version numbers describe the source snapshot, not the current support matrix. Consult [AGENTS.md](../../AGENTS.md) and its linked source contracts when changing behavior.

For Codex plugin installation, run `make -C integrations` from the repository
root to package all four skills. The versioned ZIP appears in
`integrations/plugin-dist/`. It includes skill sources, preview assets, and
dependency lockfiles; `uv` installs the Python dependencies on first use.
See the [plugin build and installation guide](https://github.com/thomassresearch/orchestron/blob/main/integrations/README.md#build-the-plugin-zip).
Installed skills resolve commands from their own directory; keep musical work
and edit sessions outside the plugin. After verifying the plugin, remove
duplicate standalone skill installations while retaining the repository sources.
