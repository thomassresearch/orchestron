# Performance Creator contract fixture

`all_sources.json` is a versioned synthetic song authored through the portable
Performance Creator model. It contains all five source types, nine Score
definitions, shared references and compact CLI history. `before` is the exact
pre-edit arrangement, `config` is the authored performance, and `wire` is its
runtime projection.

Backend tests validate runtime/export behavior, and the frontend imports this
same fixture to verify persistence, autosave and GUI replay of CLI history.
Update these representations deliberately together when the contract changes.
Tests must not regenerate this fixture or read developer examples.
