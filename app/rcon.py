"""Minimal Minecraft (Source Engine) RCON client. Sufficient for the
backup engine to send `save-off`, `save-all flush`, `save-on`. No deps."""
from __future__ import annotations

import socket
import struct
from typing import Self

_TYPE_AUTH = 3
_TYPE_COMMAND = 2


class RconError(RuntimeError):
    pass


class Rcon:
    def __init__(self, host: str, port: int, password: str, timeout: float = 5.0) -> None:
        self.host = host
        self.port = port
        self.password = password
        self.timeout = timeout
        self._sock: socket.socket | None = None

    def __enter__(self) -> Self:
        self._sock = socket.create_connection((self.host, self.port), timeout=self.timeout)
        self._send(_TYPE_AUTH, self.password)
        resp_id, _ = self._recv()
        if resp_id == -1:
            raise RconError("rcon authentication failed")
        return self

    def __exit__(self, *_args) -> None:
        if self._sock is not None:
            try:
                self._sock.close()
            finally:
                self._sock = None

    def command(self, cmd: str) -> str:
        self._send(_TYPE_COMMAND, cmd)
        return self._recv()[1]

    def _send(self, type_: int, body: str) -> None:
        assert self._sock is not None
        body_bytes = body.encode("utf-8") + b"\x00\x00"
        # request id is fixed at 1; we don't pipeline
        packet = struct.pack("<ii", 1, type_) + body_bytes
        self._sock.sendall(struct.pack("<i", len(packet)) + packet)

    def _recv(self) -> tuple[int, str]:
        size = struct.unpack("<i", self._recvn(4))[0]
        if size < 10:
            raise RconError(f"malformed rcon packet (size={size})")
        req_id, _type = struct.unpack("<ii", self._recvn(8))
        body = self._recvn(size - 10).rstrip(b"\x00")
        # trailing two null bytes
        self._recvn(2)
        return req_id, body.decode("utf-8", errors="replace")

    def _recvn(self, n: int) -> bytes:
        assert self._sock is not None
        chunks: list[bytes] = []
        remaining = n
        while remaining:
            chunk = self._sock.recv(remaining)
            if not chunk:
                raise RconError("rcon connection closed mid-packet")
            chunks.append(chunk)
            remaining -= len(chunk)
        return b"".join(chunks)
