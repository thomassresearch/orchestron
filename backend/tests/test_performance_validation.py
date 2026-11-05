from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import HTTPException

from backend.app.services.performance_validation import validate_performance


def test_validation_checks_storage_bounds_before_authored_content():
    service = Mock()
    service._validate_config.side_effect = HTTPException(status_code=422, detail="size limit")
    container = SimpleNamespace(performance_service=service, session_service=Mock())
    with pytest.raises(HTTPException, match="size limit"):
        validate_performance(container, {"config": {}})
    service.normalize_config.assert_not_called()
    container.session_service._validate_session_instruments.assert_not_called()


def test_validation_does_not_create_or_prepare_runtime():
    service = Mock()
    service.normalize_config.side_effect = lambda c: c
    container = SimpleNamespace(performance_service=service, session_service=Mock())
    result = validate_performance(container, {"config": {"version": 22, "instruments": []}})
    assert result["validation"]["preparation"] == "not_run"
    assert container.session_service.mock_calls == []
    service.create_performance.assert_not_called()
