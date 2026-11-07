"""Reproduce the T07c comparison without registering production eligibility."""
import argparse
from dataclasses import asdict
import gzip
import hashlib
import json
from pathlib import Path

from backend.app.engine.render_qualification import QualificationEvidence
from backend.tools.qualify_partition_browser import compare_latency, compare_recovery, distribution


def read(path):
    if not path.exists():
        path = path.with_suffix(path.suffix+'.gz')
    with (gzip.open(path, 'rt') if path.suffix == '.gz' else path.open()) as stream:
        return json.load(stream)


def soak_summary(run):
    return {'seconds': run['elapsedSeconds'], 'underruns': run['ring'][2], 'overruns': run['ring'][5],
            'warmup_underruns': run['initialRing'][2], 'warmup_overruns': run['initialRing'][5],
            'minimum_sampled_queue': min(d['queuedFrames'] for d in run['diagnostics']),
            'render_audio_ratio': distribution([d['renderTimeRatio'] for d in run['diagnostics']]),
            'errors': run['errors'], 'frontend_error': run['frontendError'],
            'ring_capacity_frames': run['ringCapacityFrames'], 'peak': run['peak'],
            'renderer': run['info']['renderer'], 'connections': run['connections']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--raw-dir', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    prior = Path('specifications/parallel-csound-rendering/measurements')
    native = read(prior/'t07b-final-container-4.json')
    old_browser = read(prior/'t07b-browser-realtime4.json')
    result = {'protocol': 't07c-test-plan.md', 'registered_qualification_records': 0, 'workloads': {}}
    for case in (2, 4):
        runs = {mode: {phase: read(args.raw_dir/f'rt{case}-{mode}-{phase}.json')
                       for phase in ('latency', 'recovery', 'resources', 'soak', 'finish')}
                for mode in ('single', 'parallel')}
        if case == 4:
            # The fresh parallel interval is for matched probes, not a new thirty-minute claim.
            runs['parallel']['probe_prewarm'] = runs['parallel']['soak']
            runs['parallel']['soak'] = old_browser['arms']['parallel']['clean_soak']
        single, parallel = runs['single'], runs['parallel']
        for field in ('specification', 'audioSettings', 'ringCapacityFrames'):
            if single['soak'][field] != parallel['soak'][field]:
                raise ValueError(f'Unmatched {field} for realtime_{case}')
        entry = {'soaks': {mode: soak_summary(r['soak']) for mode, r in runs.items()},
                 'settings': single['soak']['audioSettings'],
                 'recovery': compare_recovery(single['recovery'], parallel['recovery']),
                 'latency': compare_latency(single['latency'], parallel['latency']),
                 'final_errors': {mode: {'worker': r['finish']['errors'], 'frontend': r['finish']['frontendError']}
                                  for mode, r in runs.items()},
                 'private_memory_bytes': {mode: r['resources']['private_bytes'] for mode, r in runs.items()},
                 'soak_provenance': 'Sequential T07c arms' if case == 2 else
                     'Clean isolated T07c single; retained T07b parallel with concurrent-host caveat'}
        performance = native['cases'][f'realtime_{case}/k32']
        entry['native'] = {mode: performance[mode]['wall_ms'] for mode in ('single', 'parallel')}
        entry['native']['p95_reduction'] = performance['p95_reduction']
        if 'worst_recovery_ms_bounds' in entry['recovery']:
            identity = performance['parallel']['runs'][0]['identity']
            settings = json.dumps(entry['settings'], sort_keys=True)
            # Numerical evaluation of the existing predicate. These are diagnostic
            # measurements, not an exact artifact registration or release approval.
            evidence = QualificationEvidence(**identity, workload=f'realtime_{case}',
                report_digest=hashlib.sha256(json.dumps(entry, sort_keys=True).encode()).hexdigest(),
                single_settings=settings, parallel_settings=settings, effective_cpus=4,
                single_p95_ms=entry['native']['single']['p95'], parallel_p95_ms=entry['native']['parallel']['p95'],
                single_p99_ms=entry['native']['single']['p99'], parallel_p99_ms=entry['native']['parallel']['p99'],
                single_browser_seconds=entry['soaks']['single']['seconds'],
                parallel_browser_seconds=entry['soaks']['parallel']['seconds'],
                single_underruns=entry['soaks']['single']['underruns'],
                parallel_underruns=entry['soaks']['parallel']['underruns'],
                stress_single_underruns=entry['recovery']['total_underruns']['single'],
                stress_parallel_underruns=entry['recovery']['total_underruns']['parallel'],
                stress_single_recovery_ms=entry['recovery']['worst_recovery_ms_bounds']['single'][1],
                stress_parallel_recovery_ms=entry['recovery']['worst_recovery_ms_bounds']['parallel'][1],
                private_memory_bytes=entry['private_memory_bytes']['parallel'], native_correctness=True, final_image=True)
            entry['existing_predicate'] = {'rejection': evidence.rejection(), 'inputs': asdict(evidence),
                'scope': 'Numerical check only; reuses exact-image native identities, does not register app artifacts'}
        else:
            entry['existing_predicate'] = {'rejection': 'incomplete_recovery_measurement'}
        entry['observations_clean'] = all(
            not s['errors'] and not s['frontend_error'] and s['overruns'] == 0
            for s in entry['soaks'].values()) and all(
                not e['worker'] and not e['frontend'] for e in entry['final_errors'].values())
        entry['renderer_verified'] = all(
            parallel[phase]['info']['renderer']['selected'] == 'parallel'
            and not parallel[phase]['info']['renderer']['failed']
            and parallel[phase]['info']['renderer']['fallback_reason'] is None
            and single[phase]['info']['renderer'] is None
            for phase in ('soak', 'finish'))
        entry['decision'] = ('pass' if entry['existing_predicate']['rejection'] is None and entry['observations_clean']
                             and entry['renderer_verified']
                             and entry['latency']['decision'] == entry['recovery']['decision'] == 'pass'
                             else 'not_passed')
        result['workloads'][f'realtime_{case}'] = entry
    result['G7_measurements'] = ('pass' if all(w['decision'] == 'pass' for w in result['workloads'].values())
                                 else 'not_passed')
    args.output.write_text(json.dumps(result, indent=2, allow_nan=False)+'\n')
    print(json.dumps({k: v['decision'] for k, v in result['workloads'].items()}))
