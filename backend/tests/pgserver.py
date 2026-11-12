"""Starts a throwaway PostgreSQL server for database tests.

Needs the PostgreSQL server binaries (initdb, pg_ctl). If they are missing the
database tests are skipped, unless REQUIRE_POSTGRES=1 is set (CI sets it), in
which case they fail loudly.
"""
import glob
import os
import pathlib
import platform
import shutil
import socket
import subprocess
import tempfile
import uuid

import psycopg
import pytest

ROOT = pathlib.Path(__file__).resolve().parents[2]
MIGRATIONS = sorted((ROOT / "supabase" / "migrations").glob("*.sql"))
AUTH_STUB = ROOT / "supabase" / "tests" / "00_auth_stub.sql"


def find_binary(name):
    found = shutil.which(name)
    if found:
        return found
    patterns = [
        f"/usr/lib/postgresql/*/bin/{name}",
        f"/opt/homebrew/opt/postgresql*/bin/{name}",
        f"/usr/local/opt/postgresql*/bin/{name}",
    ]
    for pattern in patterns:
        matches = sorted(glob.glob(pattern))
        if matches:
            return matches[-1]
    return None


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class PgServer:
    def __init__(self, port, socket_dir):
        self.port = port
        self.socket_dir = socket_dir

    def url(self, dbname="postgres"):
        return f"postgresql://postgres@127.0.0.1:{self.port}/{dbname}"


def _env():
    # macOS refuses to start Postgres without a valid locale.
    locale = "en_US.UTF-8" if platform.system() == "Darwin" else "C.UTF-8"
    env = dict(os.environ)
    env.update(LC_ALL=locale, LANG=locale)
    return env


@pytest.fixture(scope="session")
def pg_server():
    initdb = find_binary("initdb")
    pg_ctl = find_binary("pg_ctl")
    if not initdb or not pg_ctl:
        if os.getenv("REQUIRE_POSTGRES") == "1":
            pytest.fail("PostgreSQL server binaries are required but were not found.")
        pytest.skip("PostgreSQL server binaries not found")

    data_dir = tempfile.mkdtemp(prefix="pgdata-", dir="/tmp")
    socket_dir = tempfile.mkdtemp(prefix="pgsock-", dir="/tmp")
    port = free_port()
    env = _env()

    subprocess.run(
        [initdb, "-D", data_dir, "-A", "trust", "-U", "postgres", "-E", "UTF8"],
        check=True, capture_output=True, env=env,
    )
    log_file = os.path.join(data_dir, "server.log")
    subprocess.run(
        [pg_ctl, "start", "-D", data_dir, "-w", "-l", log_file, "-o",
         f"-p {port} -c listen_addresses=127.0.0.1 -c unix_socket_directories={socket_dir} "
         f"-c fsync=off -c synchronous_commit=off -c max_connections=200"],
        check=True, capture_output=True, env=env,
    )
    server = PgServer(port, socket_dir)

    # Template database with the stub + all migrations applied once.
    with psycopg.connect(server.url(), autocommit=True) as conn:
        conn.execute("create database template_app")
    with psycopg.connect(server.url("template_app"), autocommit=True) as conn:
        conn.execute(AUTH_STUB.read_text())
        for migration in MIGRATIONS:
            conn.execute(migration.read_text())

    yield server

    subprocess.run([pg_ctl, "stop", "-D", data_dir, "-m", "immediate"],
                   capture_output=True, env=env)
    shutil.rmtree(data_dir, ignore_errors=True)
    shutil.rmtree(socket_dir, ignore_errors=True)


@pytest.fixture()
def db_url(pg_server):
    """A fresh, fully migrated database for one test."""
    name = "t_" + uuid.uuid4().hex[:12]
    with psycopg.connect(pg_server.url(), autocommit=True) as conn:
        conn.execute(f'create database "{name}" template template_app')
    yield pg_server.url(name)
    with psycopg.connect(pg_server.url(), autocommit=True) as conn:
        conn.execute(f'drop database if exists "{name}" with (force)')
