"""Loopback-only audition UI. A saved review does not implicitly resume an agent."""

from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
from pathlib import Path
import secrets
from urllib.parse import unquote, urlsplit

from . import session
from .score import CompositionError


def asset_path(name: str) -> Path:
    packaged = Path(__file__).parent / "assets" / name
    return packaged if packaged.is_file() else Path(__file__).parents[2] / "assets" / name


def make_server(directory: Path, port: int = 0) -> ThreadingHTTPServer:
    directory = directory.resolve()
    token = secrets.token_urlsafe(32)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def reply(self, status: int, body: bytes, content_type: str = "application/json"):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header(
                "Content-Security-Policy",
                "default-src 'self'; script-src 'self'; style-src 'self'; media-src 'self'; connect-src 'self'; frame-ancestors 'none'",
            )
            self.end_headers()
            self.wfile.write(body)

        def json_reply(self, status: int, value: dict):
            self.reply(status, json.dumps(value, ensure_ascii=False).encode())

        def trusted(self) -> bool:
            authority = f"127.0.0.1:{self.server.server_port}"
            if self.headers.get("Host") != authority or self.headers.get("Origin") not in (None, f"http://{authority}"):
                self.json_reply(403, {"error": "Use the loopback audition URL."})
                return False
            return True

        def do_GET(self):
            if not self.trusted():
                return
            path = unquote(urlsplit(self.path).path)
            try:
                if path == "/":
                    body = asset_path("audition.html").read_text().replace("__SESSION_TOKEN__", token).encode()
                    self.reply(200, body, "text/html; charset=utf-8")
                elif path == "/favicon.ico":
                    self.reply(204, b"", "image/x-icon")
                elif path in ("/audition.js", "/audition.css"):
                    target = asset_path(path[1:])
                    self.reply(200, target.read_bytes(), "text/javascript" if path.endswith(".js") else "text/css")
                elif path == "/api/session":
                    self.json_reply(200, session.load(directory))
                elif path.startswith("/media/"):
                    pieces = path.split("/")
                    if len(pieces) != 4 or pieces[3] not in (
                        "mix.wav",
                        "solo.wav",
                        "mix.mid",
                        "solo.mid",
                        "score.musicxml",
                    ):
                        raise CompositionError("Unknown preview file.")
                    session.candidate(session.load(directory), pieces[2])
                    target = directory / "previews" / pieces[2] / pieces[3]
                    self.reply(
                        200, target.read_bytes(), mimetypes.guess_type(target.name)[0] or "application/octet-stream"
                    )
                else:
                    self.json_reply(404, {"error": "Not found."})
            except (CompositionError, FileNotFoundError):
                self.json_reply(404, {"error": "Preview unavailable. Render this candidate with the composition CLI."})

        def do_POST(self):
            if not self.trusted():
                return
            if self.headers.get("X-Session-Token") != token:
                self.json_reply(403, {"error": "Reload the audition page before saving."})
                return
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= 65536 or self.headers.get("Content-Type") != "application/json":
                    raise CompositionError("Expected a JSON review no larger than 64 KiB.")
                if self.path != "/api/review":
                    self.json_reply(404, {"error": "Not found."})
                    return
                body = json.loads(self.rfile.read(size))
                if not isinstance(body, dict) or type(body.get("revision")) is not int:
                    raise CompositionError("A review needs the current session revision.")
                state = session.review(
                    directory,
                    body["id"],
                    body["decision"],
                    body.get("feedback", ""),
                    body.get("locks", []),
                    body["revision"],
                )
                self.json_reply(200, state)
            except (CompositionError, KeyError, ValueError, TypeError) as exc:
                self.json_reply(409 if "session changed" in str(exc).lower() else 400, {"error": str(exc)})

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.daemon_threads = True
    return server
