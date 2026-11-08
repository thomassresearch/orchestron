"""Deterministic graph operations without native/runtime dependencies."""
from __future__ import annotations

import heapq


def topological_order(nodes, edges) -> tuple[str, ...]:
    nodes = set(nodes)
    incoming = dict.fromkeys(nodes, 0)
    successors = {node: set() for node in nodes}
    for source, target in set(edges):
        if source not in nodes or target not in nodes:
            raise ValueError("Dependency references an unknown stage.")
        successors[source].add(target)
        incoming[target] += 1
    ready = [node for node in nodes if not incoming[node]]
    heapq.heapify(ready)
    result = []
    while ready:
        node = heapq.heappop(ready)
        result.append(node)
        for target in sorted(successors[node]):
            incoming[target] -= 1
            if not incoming[target]:
                heapq.heappush(ready, target)
    if len(result) != len(nodes):
        raise ValueError("Dependency graph contains a cycle.")
    return tuple(result)


def reachable(starts, adjacency) -> set[str]:
    seen, todo = set(), list(starts)
    while todo:
        node = todo.pop()
        if node not in seen:
            seen.add(node)
            todo.extend(adjacency[node])
    return seen


def strongly_connected_components(nodes, edges) -> tuple[tuple[str, ...], ...]:
    """Iterative Kosaraju traversal; long valid graphs do not consume Python stack."""
    forward = {node: set() for node in nodes}
    reverse = {node: set() for node in nodes}
    for source, target in edges:
        forward[source].add(target)
        reverse[target].add(source)
    seen, finished = set(), []
    for root in sorted(forward):
        todo = [(root, False)]
        while todo:
            node, exiting = todo.pop()
            if exiting:
                finished.append(node)
            elif node not in seen:
                seen.add(node)
                todo.append((node, True))
                todo.extend((child, False) for child in sorted(forward[node], reverse=True) if child not in seen)
    seen, groups = set(), []
    for root in reversed(finished):
        if root in seen:
            continue
        group, todo = set(), [root]
        while todo:
            node = todo.pop()
            if node not in seen:
                seen.add(node)
                group.add(node)
                todo.extend(reverse[node])
        groups.append(tuple(sorted(group)))
    return tuple(sorted(groups))
