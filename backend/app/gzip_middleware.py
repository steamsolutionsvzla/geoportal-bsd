"""GZip selectivo por tamaño.

Comprime respuestas pequeñas/medianas, pero deja pasar sin comprimir las
respuestas grandes (p. ej. GeoJSON de capas pesadas). Comprimir cientos de MB
bloquea el backend y hace que la petición tarde más que la propia descarga.
"""
import gzip

from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

EXCLUDED_CONTENT_TYPES = (
    "text/event-stream",
    # Descargas: ya vienen comprimidas o son binarios grandes.
    "application/zip",
    "application/x-zip-compressed",
    "application/octet-stream",
)


class SizeLimitedGZipMiddleware:
    def __init__(
        self,
        app: ASGIApp,
        minimum_size: int = 1024,
        max_size_bytes: int = 20 * 1024 * 1024,
        compresslevel: int = 6,
    ) -> None:
        self.app = app
        self.minimum_size = minimum_size
        self.max_size_bytes = max_size_bytes
        self.compresslevel = compresslevel

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = Headers(scope=scope)
        if "gzip" not in headers.get("Accept-Encoding", ""):
            await self.app(scope, receive, send)
            return

        responder = _SizeLimitedResponder(
            self.app,
            self.minimum_size,
            self.max_size_bytes,
            self.compresslevel,
        )
        await responder(scope, receive, send)


class _SizeLimitedResponder:
    def __init__(
        self,
        app: ASGIApp,
        minimum_size: int,
        max_size_bytes: int,
        compresslevel: int,
    ) -> None:
        self.app = app
        self.minimum_size = minimum_size
        self.max_size_bytes = max_size_bytes
        self.compresslevel = compresslevel

        self.send: Send
        self.initial_message: Message = {}
        self.started = False
        self.compress: bool | None = None

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        self.send = send
        await self.app(scope, receive, self._send_with_compression)

    def _decide_compression(self, message: Message) -> bool:
        headers = Headers(raw=message["headers"])
        if "content-encoding" in headers:
            return False
        if headers.get("content-type", "").startswith(EXCLUDED_CONTENT_TYPES):
            return False

        # Sin Content-Length no se puede saber el tamaño: no comprimir.
        raw_length = headers.get("content-length")
        if raw_length is None:
            return False
        try:
            length = int(raw_length)
        except ValueError:
            return False

        return self.minimum_size <= length <= self.max_size_bytes

    async def _send_with_compression(self, message: Message) -> None:
        message_type = message["type"]

        if message_type == "http.response.start":
            self.initial_message = message
            self.compress = self._decide_compression(message)
            return

        if message_type == "http.response.pathsend":
            if not self.started:
                self.started = True
                await self.send(self.initial_message)
            await self.send(message)
            return

        if message_type != "http.response.body":
            return

        if not self.started:
            self.started = True
            body = message.get("body", b"")
            more_body = message.get("more_body", False)

            # Respuesta de un solo bloque y dentro del umbral.
            if self.compress and not more_body:
                compressed = gzip.compress(body, compresslevel=self.compresslevel)
                headers = MutableHeaders(raw=self.initial_message["headers"])
                headers.add_vary_header("Accept-Encoding")
                headers["Content-Encoding"] = "gzip"
                headers["Content-Length"] = str(len(compressed))
                message["body"] = compressed
                await self.send(self.initial_message)
                await self.send(message)
                return

            # Streaming: comprimir un stream de tamaño conocido es raro;
            # se envía sin comprimir para no retener toda la respuesta.
            await self.send(self.initial_message)
            await self.send(message)
            return

        await self.send(message)
