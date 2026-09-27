# Saved graph before legato

`library_patch.json` is the complete API snapshot taken before this migration:
56 nodes, library ID e7dae45d-3aca-4f67-bc7d-fef3ac29e4b7, Melody type, the user
layout and maxalloc node driven by a const_i value of 1. The five performance
controller IDs, parameters, all connections and layout data are preserved.
`build_flute.py` applies the legato transformation to this snapshot idempotently.
