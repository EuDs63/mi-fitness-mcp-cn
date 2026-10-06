import pytest

from mi_fitness_mcp import auth, server
from mi_fitness_mcp.config import Config
from mi_fitness_mcp.models import DailyActivity
from mi_fitness_mcp.storage import Database


def web_logins(tmp_path, rows):
    db = Database(tmp_path / "web.db")
    with db._get_connection() as conn:
        conn.execute("""CREATE TABLE api_keys (
            key TEXT, user_id TEXT, pass_token TEXT, region TEXT,
            created_at TEXT, revoked INTEGER
        )""")
        conn.executemany("INSERT INTO api_keys VALUES (?,?,?,?,?,?)", rows)
        conn.commit()
    return db


def test_mcp_reuses_latest_single_account_web_login(tmp_path, monkeypatch):
    db = web_logins(
        tmp_path,
        [
            ("old-key", "u1", "", "cn", "2026-01-01", 0),
            ("new-key", "u1", "", "cn", "2026-01-02", 0),
            ("revoked-key", "u2", "", "cn", "2026-01-03", 1),
        ],
    )
    monkeypatch.setattr(
        auth,
        "load_api_key_secret",
        lambda key: {"old-key": "old-token", "new-key": "new-token"}.get(key),
    )
    assert auth.resolve_mcp_credentials(Config(), db) == ("u1", "new-token", "cn")


def test_multiple_accounts_require_explicit_selection(tmp_path, monkeypatch):
    db = web_logins(
        tmp_path,
        [
            ("a", "u1", "", "cn", "2026-01-01", 0),
            ("b", "u2", "", "de", "2026-01-02", 0),
        ],
    )
    monkeypatch.setattr(auth, "load_api_key_secret", lambda key: "test-token")
    with pytest.raises(ValueError, match="Multiple local accounts"):
        auth.resolve_mcp_credentials(Config(), db)
    assert auth.resolve_mcp_credentials(Config(), db, "b") == ("u2", "test-token", "de")


def test_explicit_revoked_key_does_not_fall_back_to_manual_credentials(tmp_path, monkeypatch):
    db = web_logins(tmp_path, [("revoked", "u1", "", "cn", "2026-01-01", 1)])
    monkeypatch.setattr(auth, "load_mi_fitness_token", lambda: ("manual-user", "manual-token"))
    with pytest.raises(ValueError, match="invalid or revoked"):
        auth.resolve_mcp_credentials(Config(mode="mi_fitness_cloud"), db, "revoked")


def test_manual_setup_and_missing_web_login(tmp_path, monkeypatch):
    db = Database(tmp_path / "manual.db")
    monkeypatch.setattr(auth, "load_mi_fitness_token", lambda: ("manual-user", "manual-token"))
    assert auth.resolve_mcp_credentials(Config(mode="mi_fitness_cloud", region="de"), db) == (
        "manual-user",
        "manual-token",
        "de",
    )
    assert auth.resolve_mcp_credentials(Config(), db) is None


def test_mcp_queries_resolved_account_without_connecting_to_cloud(tmp_path, monkeypatch):
    db = Database(tmp_path / "offline.db")
    db.insert_daily_activity(
        DailyActivity(
            id="u1-activity",
            provider="mi_fitness",
            source_type="cloud_session",
            user_id="u1",
            date="2026-01-01",
            steps=105,
            distance_m=88,
            active_kcal=6,
        )
    )
    db.insert_daily_activity(
        DailyActivity(
            id="u2-activity",
            provider="mi_fitness",
            source_type="cloud_session",
            user_id="u2",
            date="2026-01-01",
            steps=999,
            distance_m=800,
            active_kcal=80,
        )
    )
    monkeypatch.setattr(server, "load_config", lambda: Config(database_path=db.db_path))
    monkeypatch.setattr(server, "resolve_mcp_credentials", lambda *args: ("u1", "token", "cn"))
    for name in ("config", "db", "adapter", "sync_service", "query_service", "credentials_error"):
        monkeypatch.setattr(server, name, None)
    server._initialize_services()
    assert server.config.mode == "mi_fitness_cloud"
    assert server.config.region == "cn"
    assert server.adapter.is_connected() is False
    assert server.query_service.get_daily_summaries("2026-01-01", "2026-01-01")[0]["steps"] == 105


@pytest.mark.asyncio
async def test_tool_metadata_identifies_cached_reads_and_cloud_sync():
    tools = {tool.name: tool for tool in await server.list_tools()}
    assert tools["get_analysis_snapshot"].annotations.readOnlyHint is True
    assert tools["get_analysis_snapshot"].annotations.openWorldHint is False
    assert tools["sync_data"].annotations.readOnlyHint is False
    assert tools["sync_data"].annotations.destructiveHint is False


@pytest.mark.asyncio
async def test_mcp_errors_are_marked_and_successes_are_structured(monkeypatch):
    result = await server.call_tool("unknown-tool", {})
    assert result.isError is True
    assert result.structuredContent["status"] == "error"

    class Query:
        def get_analysis_snapshot(self, start, end):
            if start > end:
                raise ValueError("Invalid date range")
            return {"daily_activity": [{"date": start, "steps": 100}]}

    monkeypatch.setattr(server, "query_service", Query())
    result = await server.call_tool(
        "get_analysis_snapshot", {"start_date": "2026-01-01", "end_date": "2026-01-02"}
    )
    assert result.isError is False
    assert result.structuredContent["data"]["daily_activity"][0]["steps"] == 100
    result = await server.call_tool(
        "get_analysis_snapshot", {"start_date": "2026-01-02", "end_date": "2026-01-01"}
    )
    assert result.isError is True
