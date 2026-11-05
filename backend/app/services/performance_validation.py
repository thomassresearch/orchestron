"""Read-only validation of the exact authored proposal; no session or library writes."""

from fastapi import HTTPException
from pydantic import ValidationError

from backend.app.models.performance import MasterRepairRequest
from backend.app.models.session import SessionInstrumentValidationRequest


def validate_performance(container, body: dict) -> dict:
    try:
        if set(body) != {"config"}:
            raise ValueError("Expected only config; preparation is a separate runtime operation.")
        config = body["config"]
        container.performance_service._validate_config(config)
        MasterRepairRequest.model_validate(body)
        config = container.performance_service.normalize_config(config)
        instruments = [
            {
                "id": i.get("id"),
                "patch_id": i.get("patchId"),
                "midi_channel": i.get("midiChannel", 1),
                "performance_controller_values": i.get("performanceControllerValues", {}),
                "performance_controller_midi_ccs": i.get("performanceControllerMidiCCs", {}),
                **(
                    {
                        "effect_routes": [
                            {"source_id": r["sourceId"], "channel": r["channel"]} for r in i.get("effectRoutes", [])
                        ]
                    }
                    if "audioGraph" not in config
                    else {}
                ),
            }
            for i in config.get("instruments", [])
        ]
        routing = {"instruments": [], "resolved_routes": []}
        if instruments:
            request = SessionInstrumentValidationRequest.model_validate(
                {
                    "instruments": instruments,
                    "audio_graph": config.get("audioGraph"),
                    "mixer": config.get("mixer", {}),
                }
            )
            routing = container.session_service._validate_session_instruments(request).model_dump(mode="json")
        elif config.get("audioGraph", {}).get("routes"):
            raise ValueError("Audio routes require rack instruments.")
        return {
            "valid": True,
            "config_version": config.get("version"),
            "validation": {"authored": "passed", "routing": "passed", "preparation": "not_run"},
            "instrument_count": len(instruments),
            "resolved_route_count": len(routing["resolved_routes"]),
            **routing,
        }
    except (ValidationError, ValueError, TypeError, KeyError) as exc:
        raise HTTPException(
            status_code=422,
            detail={"code": "invalid_performance", "path": "config", "message": str(exc), "stateChanged": False},
        ) from exc
