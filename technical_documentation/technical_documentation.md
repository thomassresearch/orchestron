# Orchestron Technical Documentation

**Navigation:** [Next](parallel_rendering.md)

This manual describes Orchestron's architecture, implementation choices and internal contracts. It is intended for developers and maintainers. For application workflows and configuration instructions, see the [User Documentation](../documentation/user_documentation.md).

Chapters explain the current implementation and link to its source, regression tests and detailed design records. Diagrams use Mermaid fenced blocks, which render in compatible Markdown viewers, including GitHub.

## Table of Contents

### 1. [Parallel Csound Rendering](parallel_rendering.md)

- [Scope and architectural choices](parallel_rendering.md#scope-and-architectural-choices)
- [Runtime boundaries and ownership](parallel_rendering.md#runtime-boundaries-and-ownership)
- [Partitioning the performance graph](parallel_rendering.md#partitioning-the-performance-graph)
- [Compiling partition programs](parallel_rendering.md#compiling-partition-programs)
- [Shared memory and process coordination](parallel_rendering.md#shared-memory-and-process-coordination)
- [Synthesis timing and coordination batches](parallel_rendering.md#synthesis-timing-and-coordination-batches)
- [Selection, admission and startup](parallel_rendering.md#selection-admission-and-startup)
- [Live operations, failure and recovery](parallel_rendering.md#live-operations-failure-and-recovery)
- [Performance tradeoffs and evidence](parallel_rendering.md#performance-tradeoffs-and-evidence)
- [Implementation map and verification](parallel_rendering.md#implementation-map-and-verification)

**Navigation:** [Next](parallel_rendering.md)
