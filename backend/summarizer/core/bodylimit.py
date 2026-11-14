"""Refuse oversized JSON requests.

File uploads are streamed with their own limits. Every other request body is small JSON, so anything larger than a couple of
megabytes is a mistake or an attack, and reading it would only use memory.

Two checks, because a client chooses how to announce its body:
* a declared size (Content-Length) over the limit is refused straight away, before a byte is read;
* a body with NO declared size (chunked transfer) is counted as it arrives and cut off once it passes the limit,
  so leaving the header out does not get around the first check.
"""
import os

from starlette.types import ASGIApp, Message, Receive, Scope, Send

DEFAULT_MAX_JSON_BYTES = 2 * 1024 * 1024
MESSAGE = "This request is too large."
BODY = (b'{"code":"request_too_large","message":"' + MESSAGE.encode() + b'","detail":"' + MESSAGE.encode() + b'"}')


def max_json_bytes() -> int:
    try:
        return max(1024, int(os.getenv("MAX_JSON_BODY_KB", "2048")) * 1024)
    except ValueError:
        return DEFAULT_MAX_JSON_BYTES


class _TooLarge(Exception):
    pass


async def _refuse(send: Send) -> None:
    await send({"type": "http.response.start", "status": 413,
                "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(BODY)).encode())]})
    await send({"type": "http.response.body", "body": BODY})


class JsonBodyLimit:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = {k.lower(): v for k, v in scope.get("headers", [])}
        if not headers.get(b"content-type", b"").lower().startswith(b"application/json"):
            return await self.app(scope, receive, send)

        limit = max_json_bytes()
        declared = headers.get(b"content-length", b"")
        if declared.isdigit() and int(declared) > limit:
            return await _refuse(send)

        seen = 0
        exceeded = False
        started = False

        async def counted_receive() -> Message:
            nonlocal seen, exceeded
            message = await receive()
            if message["type"] == "http.request":
                seen += len(message.get("body", b""))
                if seen > limit:
                    exceeded = True
                    raise _TooLarge()   # stops the application reading (and keeping) any more of the body
            return message

        async def tracked_send(message: Message) -> None:
            nonlocal started
            if exceeded:
                # Whatever the application answers to a body it could not finish reading (FastAPI says 400), the
                # honest answer is "too large". Its own messages are dropped, ours is sent once.
                if not started:
                    started = True
                    await _refuse(send)
                return
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, counted_receive, tracked_send)
        except _TooLarge:
            if not started:
                started = True
                await _refuse(send)


def install_body_limit(app) -> None:
    app.add_middleware(JsonBodyLimit)
