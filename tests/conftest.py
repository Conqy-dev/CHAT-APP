"""Test setup: start the real server on a free port with a throwaway SQLite database,
so every test talks to it over genuine TCP connections (HTTP and WebSocket)."""
import itertools
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

import httpx
import pytest

ROOT = Path(__file__).resolve().parent.parent


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))  # port 0 = let the OS pick an unused port
        return s.getsockname()[1]


@pytest.fixture(scope="session")
def server(tmp_path_factory):
    """Start the app once for the whole test run. Returns (http_base_url, tcp_port, log_file)."""
    port, tcp_port = free_port(), free_port()
    tmp = tmp_path_factory.mktemp("server")
    log_file = tmp / "server.log"
    env = {**os.environ, "DATABASE_URL": f"sqlite:///{(tmp / 'test.db').as_posix()}", "SECRET_KEY": "test-secret",
           "TCP_HOST": "127.0.0.1", "TCP_PORT": str(tcp_port), "LOG_FILE": str(log_file), "LOG_LEVEL": "DEBUG"}
    server = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.main:app", "--port", str(port)],
        cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    url = f"http://127.0.0.1:{port}"
    for _ in range(100):  # wait up to 10 s for the server to accept connections
        try:
            httpx.get(url + "/health")
            break
        except httpx.ConnectError:
            time.sleep(0.1)
    else:
        server.kill()
        pytest.fail("Server did not start")
    yield url, tcp_port, log_file
    server.terminate()
    server.wait()


@pytest.fixture(scope="session")
def base_url(server):
    return server[0]


@pytest.fixture(scope="session")
def tcp_port(server):
    return server[1]


@pytest.fixture(scope="session")
def server_log(server):
    return server[2]


_counter = itertools.count()


@pytest.fixture
def new_user(base_url):
    """Factory: new_user() registers a unique user and returns a logged-in HTTP client."""
    clients = []

    def make(password="password1"):
        client = httpx.Client(base_url=base_url)
        name = f"user{next(_counter)}_{time.time_ns() % 10**6}"
        r = client.post("/api/register", json={"username": name, "password": password})
        assert r.status_code == 200, r.text
        client.user = r.json()["user"]
        clients.append(client)
        return client

    yield make
    for c in clients:
        c.close()
