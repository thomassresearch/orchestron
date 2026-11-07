"""Failed latency probes must remain visible and ineligible in archived reports."""
import copy

from analyze import latency_assessment


def run():
    return {'state': 'complete', 'errors': [], 'settings': {'mode': 'auto'},
            'specification': {'id': 'diagnostic'},
            'calibration': [{'frameError': 0}] * 16, 'warmupTrials': [{}] * 4,
            'trials': [{'outputLatencyMs': 120., 'before': {'ring': [0, 0, 0]},
                        'after': {'ring': [0, 0, 0]}} for _ in range(128)],
            'start': {'ring': [0, 0, 0]}, 'end': {'ring': [0, 0, 0]}}


def test_failed_partial_probe_is_reported_without_a_statistical_pass():
    single, parallel = run(), run()
    parallel.update(state='failed', errors=['Foreground not quiet'], trials=parallel['trials'][:107])
    parallel['end']['ring'][2] = 106
    saved = copy.deepcopy(parallel)
    result = latency_assessment(single, parallel)
    assert result['decision'] == 'incomplete' and 'difference' not in result
    assert result['runs']['parallel']['observed_ms']['count'] == 107
    assert result['runs']['parallel']['errors'] == ['Foreground not quiet']
    assert result['runs']['parallel']['entire_phase_underruns'] == 106
    assert parallel == saved


def test_failed_calibration_is_not_replaced_with_descriptive_success():
    parallel = run()
    parallel['calibration'] = [{'frameError': 2}] * 16
    assert latency_assessment(run(), parallel)['decision'] == 'incomplete'


def test_complete_probes_keep_the_existing_statistical_comparison():
    result = latency_assessment(run(), run())
    assert result['decision'] == 'pass'
    assert result['difference']['replicates'] == 10000
    assert result['parallel_ms']['count'] == 128
