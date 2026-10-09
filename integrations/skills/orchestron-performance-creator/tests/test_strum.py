import pytest
from orchestron.cli import orchestron_cli as cli


def test_strum_config_and_runtime_round_trip():
    step = {'note': 60, 'chord': 'maj', 'strumDirection': 'down', 'strumSpreadPercent': 100}
    config = {'version': 18, 'instruments': [], 'sequencer': {'tracks': [
        {'id': 'lead', 'midiChannel': 1, 'pads': [{'steps': [step]}]}]}}
    restored = cli.normalize_performance_config(config, [])
    assert restored['version'] == 19
    assert restored['sequencer']['tracks'][0]['pads'][0]['steps'][0] == step
    runtime = cli.build_runtime_config(restored)['tracks'][0]['pads'][0]['steps'][0]
    assert runtime['strum_direction'] == 'down'
    assert runtime['strum_spread_percent'] == 100
    step['note'] = None
    assert cli.build_runtime_config(restored)['tracks'][0]['pads'][0]['steps'][0]['strum_spread_percent'] == 100


@pytest.mark.parametrize('values', [{'strumDirection': 'random'}, {'strumSpreadPercent': 101},
                                   {'strumSpreadPercent': True}, {'strumSpreadPercent': 1.5}])
def test_strum_validation(values):
    with pytest.raises(cli.OrchestronCliError, match='strum'):
        cli.normalize_performance_config({'version': 19, 'instruments': [], 'sequencer': {
            'tracks': [{'pads': [{'steps': [values]}]}]}}, [])
