from __future__ import annotations

import argparse
import base64
import json
import os
import re
import threading
from datetime import datetime
from functools import partial
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

APP_NAME = "linqing-minimal-trade-board"
ROOT_DIR = Path(__file__).resolve().parent
MAX_BODY_BYTES = 12 * 1024 * 1024
MODULE_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")


def resolve_state_file() -> Path:
    explicit_state_file = os.environ.get("BOARD_STATE_FILE", "").strip()
    if explicit_state_file:
        return Path(explicit_state_file).expanduser().resolve()

    data_dir = (
        os.environ.get("BOARD_DATA_DIR", "").strip()
        or os.environ.get("RAILWAY_VOLUME_MOUNT_PATH", "").strip()
        or os.environ.get("RENDER_DISK_MOUNT_PATH", "").strip()
    )
    if data_dir:
        return Path(data_dir).expanduser().resolve() / "state.json"

    return ROOT_DIR / "state.json"

def now_text() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def default_store() -> dict[str, Any]:
    return {
        "app": APP_NAME,
        "revision": 0,
        "savedAt": None,
        "state": None,
        "modules": {},
    }


def default_module_store() -> dict[str, Any]:
    return {
        "revision": 0,
        "savedAt": None,
        "state": {},
    }


def sanitize_module_store(raw: Any) -> dict[str, Any]:
    data = raw if isinstance(raw, dict) else {}
    revision = data.get("revision")

    try:
        revision_number = max(0, int(revision))
    except (TypeError, ValueError):
        revision_number = 0

    saved_at = data.get("savedAt")
    state = data.get("state") if isinstance(data.get("state"), dict) else {}

    return {
        "revision": revision_number,
        "savedAt": str(saved_at) if saved_at else None,
        "state": state,
    }


def sanitize_modules(raw: Any) -> dict[str, dict[str, Any]]:
    if not isinstance(raw, dict):
        return {}

    modules: dict[str, dict[str, Any]] = {}
    for raw_module_id, raw_module in raw.items():
        module_id = str(raw_module_id or "").strip()
        if MODULE_ID_PATTERN.fullmatch(module_id):
            modules[module_id] = sanitize_module_store(raw_module)

    return modules


def sanitize_store(raw: Any) -> dict[str, Any]:
    data = raw if isinstance(raw, dict) else {}
    revision = data.get("revision")

    try:
        revision_number = max(0, int(revision))
    except (TypeError, ValueError):
        revision_number = 0

    saved_at = data.get("savedAt")
    state = data.get("state") if isinstance(data.get("state"), dict) else None

    return {
        "app": str(data.get("app") or APP_NAME),
        "revision": revision_number,
        "savedAt": str(saved_at) if saved_at else None,
        "state": state,
        "modules": sanitize_modules(data.get("modules")),
    }


def load_store(state_path: Path) -> dict[str, Any]:
    if not state_path.exists():
        return default_store()

    try:
        raw = json.loads(state_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default_store()

    return sanitize_store(raw)


def write_store(state_path: Path, store: dict[str, Any]) -> None:
    state_path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(store, ensure_ascii=False, indent=2)
    temp_path = state_path.with_suffix(".tmp")
    temp_path.write_text(payload, encoding="utf-8")
    temp_path.replace(state_path)


def base_state() -> dict[str, Any]:
    return {
        "bankCash": None,
        "accounts": [],
        "holdings": [],
        "plans": [],
    }


def extract_module_id(path: str) -> str | None:
    prefix = "/api/modules/"
    if not path.startswith(prefix):
        return None

    module_id = path[len(prefix) :].strip("/")
    if not MODULE_ID_PATTERN.fullmatch(module_id):
        raise ValueError("Invalid module id.")

    return module_id


def module_response_payload(module_id: str, raw_module: Any) -> dict[str, Any]:
    module_store = sanitize_module_store(raw_module)
    return {
        "moduleId": module_id,
        "revision": module_store["revision"],
        "savedAt": module_store["savedAt"],
        "state": module_store["state"],
    }


def ensure_state(store: dict[str, Any], fallback_state: Any = None) -> dict[str, Any]:
    if isinstance(store.get("state"), dict):
        return store["state"]

    if isinstance(fallback_state, dict):
        store["state"] = fallback_state
        return store["state"]

    store["state"] = base_state()
    return store["state"]


def upsert_item(items: list[dict[str, Any]], next_item: dict[str, Any]) -> None:
    next_id = str(next_item.get("id") or "").strip()
    for index, item in enumerate(items):
        if str(item.get("id") or "").strip() == next_id:
            items[index] = next_item
            return

    items.append(next_item)


def find_item(items: list[dict[str, Any]], item_id: str) -> dict[str, Any] | None:
    target_id = str(item_id or "").strip()
    for item in items:
        if str(item.get("id") or "").strip() == target_id:
            return item

    return None


def apply_action(store: dict[str, Any], envelope: dict[str, Any]) -> dict[str, Any]:
    action = envelope.get("action")
    if not isinstance(action, dict):
        raise ValueError("Missing action payload.")

    action_type = str(action.get("type") or "").strip()
    fallback_state = envelope.get("fallbackState")

    if action_type == "replaceState":
        next_state = action.get("state")
        if not isinstance(next_state, dict):
            raise ValueError("replaceState requires a state object.")

        store["state"] = next_state
    else:
        state = ensure_state(store, fallback_state)

        if action_type == "updateBankCash":
            state["bankCash"] = action.get("bankCash")
        elif action_type == "updateAccountCash":
            account_id = str(action.get("accountId") or "").strip()
            account = find_item(state.setdefault("accounts", []), account_id)
            if account is None:
                raise ValueError(f"Unknown account id: {account_id}")

            account["availableCash"] = action.get("availableCash")
        elif action_type == "updateHoldingPrice":
            holding_id = str(action.get("holdingId") or "").strip()
            holding = find_item(state.setdefault("holdings", []), holding_id)
            if holding is None:
                raise ValueError(f"Unknown holding id: {holding_id}")

            holding["currentPrice"] = action.get("currentPrice")
            holding["marketValueOverride"] = None
            holding["floatingPnlOverride"] = None
        elif action_type == "upsertHoldingBundle":
            holding = action.get("holding")
            plans = action.get("plans")
            if not isinstance(holding, dict):
                raise ValueError("upsertHoldingBundle requires a holding object.")
            if not isinstance(plans, list):
                raise ValueError("upsertHoldingBundle requires a plans array.")

            holding_id = str(holding.get("id") or "").strip()
            if not holding_id:
                raise ValueError("Holding id is required.")

            upsert_item(state.setdefault("holdings", []), holding)
            state["plans"] = [
                plan
                for plan in state.setdefault("plans", [])
                if str(plan.get("holdingId") or "").strip() != holding_id
            ] + plans
        elif action_type == "addPlan":
            plan = action.get("plan")
            if not isinstance(plan, dict):
                raise ValueError("addPlan requires a plan object.")

            plans = state.setdefault("plans", [])
            plan_id = str(plan.get("id") or "").strip()
            state["plans"] = [
                current_plan
                for current_plan in plans
                if str(current_plan.get("id") or "").strip() != plan_id
            ]
            state["plans"].append(plan)
        else:
            raise ValueError(f"Unsupported action type: {action_type}")

    store["app"] = APP_NAME
    store["revision"] = int(store.get("revision") or 0) + 1
    store["savedAt"] = now_text()
    return store


class BoardRequestHandler(SimpleHTTPRequestHandler):
    server_version = "LinqingBoard/1.0"

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Cache-Control", "no-store")
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self) -> None:
        path = urlsplit(self.path).path
        if path == "/api/health":
            self.handle_get_health()
            return
        if not self.authorize():
            return
        if path == "/api/state":
            self.handle_get_state()
            return
        try:
            module_id = extract_module_id(path)
        except ValueError as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            return
        if module_id:
            self.handle_get_module_state(module_id)
            return

        super().do_GET()

    def do_POST(self) -> None:
        if not self.authorize():
            return

        path = urlsplit(self.path).path
        if path == "/api/actions":
            self.handle_post_action()
            return
        if path == "/api/state":
            self.handle_replace_state()
            return
        try:
            module_id = extract_module_id(path)
        except ValueError as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            return
        if module_id:
            self.handle_replace_module_state(module_id)
            return

        self.send_error(HTTPStatus.NOT_FOUND)

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        self.send_cors_headers()
        super().end_headers()

    def send_json(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_cors_headers(self) -> None:
        allowed_origin = getattr(self.server, "allowed_origin", "")
        if not allowed_origin:
            return

        request_origin = self.headers.get("Origin", "")
        if not request_origin and allowed_origin != "*":
            return

        if allowed_origin != "*" and request_origin != allowed_origin:
            return

        self.send_header("Access-Control-Allow-Origin", "*" if allowed_origin == "*" else request_origin)
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Vary", "Origin")

        if allowed_origin != "*":
            self.send_header("Access-Control-Allow-Credentials", "true")

    def authorize(self) -> bool:
        expected_header = getattr(self.server, "expected_auth_header", None)
        if not expected_header:
            return True

        if self.headers.get("Authorization") == expected_header:
            return True

        self.send_response(HTTPStatus.UNAUTHORIZED)
        self.send_header("WWW-Authenticate", 'Basic realm="Linqing Board"')
        self.end_headers()
        return False

    def read_json_body(self) -> dict[str, Any]:
        raw_length = self.headers.get("Content-Length", "0")

        try:
            content_length = int(raw_length)
        except ValueError as error:
            raise ValueError("Invalid Content-Length header.") from error

        if content_length <= 0:
            raise ValueError("Request body is empty.")
        if content_length > MAX_BODY_BYTES:
            raise ValueError("Request body is too large.")

        body = self.rfile.read(content_length)
        try:
            payload = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ValueError("Request body must be valid UTF-8 JSON.") from error

        if not isinstance(payload, dict):
            raise ValueError("Request body must be a JSON object.")

        return payload

    def load_store(self) -> dict[str, Any]:
        state_path: Path = getattr(self.server, "state_path")
        store_lock: threading.Lock = getattr(self.server, "store_lock")
        with store_lock:
            return load_store(state_path)

    def save_store(self, store: dict[str, Any]) -> None:
        state_path: Path = getattr(self.server, "state_path")
        store_lock: threading.Lock = getattr(self.server, "store_lock")
        with store_lock:
            write_store(state_path, sanitize_store(store))

    def handle_get_state(self) -> None:
        store = self.load_store()
        self.send_json(HTTPStatus.OK, store)

    def handle_get_module_state(self, module_id: str) -> None:
        store = self.load_store()
        modules = store.get("modules") if isinstance(store.get("modules"), dict) else {}
        self.send_json(HTTPStatus.OK, module_response_payload(module_id, modules.get(module_id)))

    def handle_get_health(self) -> None:
        store = self.load_store()
        self.send_json(
            HTTPStatus.OK,
            {
                "ok": True,
                "app": APP_NAME,
                "revision": store.get("revision", 0),
                "savedAt": store.get("savedAt"),
            },
        )

    def handle_post_action(self) -> None:
        try:
            payload = self.read_json_body()
            store_lock: threading.Lock = getattr(self.server, "store_lock")
            state_path: Path = getattr(self.server, "state_path")
            with store_lock:
                store = load_store(state_path)
                next_store = apply_action(store, payload)
                write_store(state_path, sanitize_store(next_store))
        except ValueError as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            return

        self.send_json(HTTPStatus.OK, sanitize_store(next_store))

    def handle_replace_state(self) -> None:
        try:
            payload = self.read_json_body()
            next_state = payload.get("state")
            if not isinstance(next_state, dict):
                raise ValueError("state must be a JSON object.")

            store_lock: threading.Lock = getattr(self.server, "store_lock")
            state_path: Path = getattr(self.server, "state_path")

            with store_lock:
                current_store = load_store(state_path)
                next_store = sanitize_store(
                    {
                        "app": APP_NAME,
                        "revision": int(current_store.get("revision") or 0) + 1,
                        "savedAt": now_text(),
                        "state": next_state,
                    }
                )
                write_store(state_path, next_store)
        except ValueError as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            return

        self.send_json(HTTPStatus.OK, next_store)

    def handle_replace_module_state(self, module_id: str) -> None:
        try:
            payload = self.read_json_body()
            next_state = payload.get("state")
            if not isinstance(next_state, dict):
                raise ValueError("state must be a JSON object.")

            store_lock: threading.Lock = getattr(self.server, "store_lock")
            state_path: Path = getattr(self.server, "state_path")

            with store_lock:
                current_store = load_store(state_path)
                modules = sanitize_modules(current_store.get("modules"))
                current_module = modules.get(module_id, default_module_store())
                saved_at = now_text()

                modules[module_id] = sanitize_module_store(
                    {
                        "revision": int(current_module.get("revision") or 0) + 1,
                        "savedAt": saved_at,
                        "state": next_state,
                    }
                )

                next_store = sanitize_store(
                    {
                        "app": APP_NAME,
                        "revision": int(current_store.get("revision") or 0) + 1,
                        "savedAt": saved_at,
                        "state": current_store.get("state"),
                        "modules": modules,
                    }
                )
                write_store(state_path, next_store)
        except ValueError as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            return

        self.send_json(
            HTTPStatus.OK,
            module_response_payload(module_id, next_store["modules"].get(module_id)),
        )


def build_expected_auth_header() -> str | None:
    username = os.environ.get("BOARD_USERNAME", "").strip()
    password = os.environ.get("BOARD_PASSWORD", "")

    if not username and not password:
        return None

    if not username or not password:
        raise SystemExit("BOARD_USERNAME and BOARD_PASSWORD must be set together.")

    credentials = f"{username}:{password}".encode("utf-8")
    token = base64.b64encode(credentials).decode("ascii")
    return f"Basic {token}"


def make_server(
    host: str = "0.0.0.0",
    port: int = 8000,
    root_dir: Path = ROOT_DIR,
    state_path: Path | None = None,
) -> ThreadingHTTPServer:
    handler = partial(BoardRequestHandler, directory=str(root_dir))
    server = ThreadingHTTPServer((host, port), handler)
    server.allowed_origin = os.environ.get("BOARD_ALLOW_ORIGIN", "").strip()
    server.expected_auth_header = build_expected_auth_header()
    server.root_dir = root_dir
    server.state_path = state_path or resolve_state_file()
    server.store_lock = threading.Lock()
    return server


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Serve the Linqing board with shared sync storage.")
    parser.add_argument("--host", default=os.environ.get("BOARD_HOST", "0.0.0.0"))
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("PORT") or os.environ.get("BOARD_PORT", "8000")),
    )
    return parser.parse_args()


def print_startup_notes(host: str, port: int, state_path: Path) -> None:
    print(f"Serving {ROOT_DIR}")
    print(f"State file: {state_path}")
    print(f"Local: http://127.0.0.1:{port}")

    if host == "0.0.0.0":
        print(f"LAN:   http://<this-computer-ip>:{port}")
        print("Outside home: expose this same server with Tailscale, Cloudflare Tunnel, or router port forwarding.")

    if os.environ.get("BOARD_USERNAME"):
        print("Basic auth: enabled")

    if os.environ.get("BOARD_ALLOW_ORIGIN"):
        print(f"CORS allow origin: {os.environ['BOARD_ALLOW_ORIGIN']}")


def main() -> None:
    args = parse_args()
    httpd = make_server(args.host, args.port)
    print_startup_notes(args.host, args.port, httpd.state_path)

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server...")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
