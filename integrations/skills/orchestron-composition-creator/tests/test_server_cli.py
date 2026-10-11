from http.client import HTTPConnection
import json
import re
from threading import Thread

import pytest

from orchestron_composition import session
from orchestron_composition.cli import main
from orchestron_composition.server import make_server


def test_http_review_survives_reload_and_rejects_stale_or_cross_origin_writes(tmp_path):
    session.create(tmp_path, {}, 45)
    identity = session.generate(tmp_path, count=1)[0]
    server = make_server(tmp_path)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:

        def request(method, path, body=None, headers=None):
            connection = HTTPConnection("127.0.0.1", server.server_port, timeout=3)
            connection.request(method, path, body, headers or {})
            result = connection.getresponse()
            payload = result.read()
            status = result.status
            connection.close()
            return status, payload

        status, html = request("GET", "/")
        assert status == 200
        token = re.search(rb'name="session-token" content="([^"]+)"', html)[1].decode()
        headers = {"Content-Type": "application/json", "X-Session-Token": token}
        body = json.dumps(
            {
                "id": identity,
                "revision": 1,
                "decision": "favourite",
                "feedback": "More space",
                "locks": [{"start_qn": "0", "end_qn": "2"}],
            }
        )
        assert request("POST", "/api/review", body, headers)[0] == 200
        loaded = json.loads(request("GET", "/api/session")[1])
        assert loaded["candidates"][identity]["review"]["feedback"] == "More space"
        assert "trace" not in loaded["candidates"][identity]
        trace_status, payload = request("GET", f"/api/trace/{identity}")
        assert trace_status == 200
        history = json.loads(payload)
        assert history["roots"] == [identity]
        assert history["nodes"][0]["steps"][0]["function"] == "orchestron.new_phrase"
        assert request("GET", "/trace.js")[0] == 200
        assert request("GET", "/api/trace/missing")[0] == 400
        assert loaded["revision"] == 2
        assert request("POST", "/api/review", body, headers)[0] == 409
        assert request("POST", "/api/review", body, {**headers, "Origin": "https://example.org"})[0] == 403
        assert request("POST", "/api/review", body, {"Content-Type": "application/json"})[0] == 403
        assert request("GET", "/api/session", headers={"Host": "example.org"})[0] == 403
        assert request("GET", "/media/../../session.json")[0] == 404
        assert session.load(tmp_path)["revision"] == 2
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)


def test_cli_end_to_end_and_selection_gate(tmp_path, capsys):
    path, output = tmp_path / "session", tmp_path / "export"
    assert main(["init", str(path), "--title", "CLI test", "--no-harmony"]) == 0
    capsys.readouterr()
    assert main(["generate", str(path), "--count", "1"]) == 0
    identity = json.loads(capsys.readouterr().out)["result"]["candidates"][0]
    assert main(["export", str(path), "--ids", identity, "--output", str(output)]) == 1
    assert not output.exists()
    capsys.readouterr()
    assert main(["review", str(path), identity, "--decision", "keep", "--lock", "0:2"]) == 0
    capsys.readouterr()
    assert main(["export", str(path), "--ids", identity, identity, "--output", str(output)]) == 0
    assert json.loads((output / "orchestron-score.json").read_text())["version"] == 2
    assert json.loads((output / "composition.json").read_text())["length_qn"] == "16"
    assert (output / "mix.wav").is_file() and (output / "score.musicxml").is_file()
    capsys.readouterr()
    before = (output / "composition.json").read_bytes()
    assert main(["export", str(path), "--ids", identity, "--output", str(output)]) == 1
    assert (output / "composition.json").read_bytes() == before


@pytest.mark.parametrize("lock", ["2:1", "-1:2", "0:99", "nope"])
def test_invalid_locks_do_not_write_session(lock, tmp_path, capsys):
    session.create(tmp_path, {}, 1)
    identity = session.generate(tmp_path, count=1)[0]
    before = (tmp_path / "session.json").read_bytes()
    assert main(["review", str(tmp_path), identity, "--decision", "keep", f"--lock={lock}"]) == 1
    assert (tmp_path / "session.json").read_bytes() == before
