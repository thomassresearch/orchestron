"""Branch-aware structural estimates; resource ownership still covers every case."""
from collections import Counter


def estimate_patch_work(graph, resources):
    """Common DSP plus the heaviest selectable case of each independent block.

    If/Switch choose exactly one case per note. Different notes may overlap, so
    use the maximum case, never an average or the currently selected MIDI note.
    The model currently forbids nested blocks; each root block can run alongside
    every other root block and their maxima must therefore be summed.
    """
    work = Counter(r.node for r in resources if r.scope == "voice")
    conditional = set()
    selected_work = 0
    for block in graph.control_flow.values():
        for case in block.cases:
            conditional.update(case.node_ids)
        selected_work += max(sum(work[node] for node in case.node_ids) for case in block.cases)
    return 1 + sum(value for node, value in work.items() if node not in conditional) + selected_work
