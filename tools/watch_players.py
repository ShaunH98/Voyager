"""Make human players on the local test server ops in spectator mode, so they can watch the bot.

Polls the server over RCON every few seconds. Any player other than the bot who joins is made an
op and switched to spectator (fly through walls, left-click the bot to see through its eyes,
or type /gamemode survival to play alongside it).

    python tools/watch_players.py            # reads testserver/server.properties for port + password
"""
import socket
import struct
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BOT = "bot"


def props():
    p = {}
    for line in (ROOT / "testserver" / "server.properties").read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            p[k] = v
    return p


class Rcon:
    def __init__(self, port, password):
        self.s = socket.create_connection(("127.0.0.1", port), timeout=10)
        self.rid = 0
        if self._send(3, password)[0] == -1:
            raise RuntimeError("RCON login refused")

    def _send(self, kind, body):
        self.rid += 1
        data = struct.pack("<ii", self.rid, kind) + body.encode("utf-8") + b"\x00\x00"
        self.s.sendall(struct.pack("<i", len(data)) + data)
        (n,) = struct.unpack("<i", self._recv(4))
        rid, _ = struct.unpack("<ii", self._recv(8))
        return rid, self._recv(n - 8)[:-2].decode("utf-8", "replace")

    def _recv(self, n):
        buf = b""
        while len(buf) < n:
            chunk = self.s.recv(n - len(buf))
            if not chunk:
                raise ConnectionError("RCON closed")
            buf += chunk
        return buf

    def cmd(self, c):
        return self._send(2, c)[1]


def main():
    p = props()
    port, pw = int(p.get("rcon.port", 25575)), p["rcon.password"]
    done = set()
    while True:
        try:
            r = Rcon(port, pw)
            while True:
                out = r.cmd("list")
                names = out.split(":", 1)[1] if ":" in out else ""
                for name in [n.strip() for n in names.split(",") if n.strip()]:
                    if name != BOT and name not in done:
                        r.cmd(f"op {name}")
                        r.cmd(f"gamemode spectator {name}")
                        r.cmd(f"tp {name} {BOT}")
                        print(f"{name}: op, spectator, teleported to the bot", flush=True)
                        done.add(name)
                left = {n for n in done if n not in names}
                done -= left
                time.sleep(3)
        except (OSError, ConnectionError, RuntimeError) as e:
            print(f"waiting for server ({e})", flush=True)
            time.sleep(5)


if __name__ == "__main__":
    sys.exit(main())
