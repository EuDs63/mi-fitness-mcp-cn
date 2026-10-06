from datetime import datetime

from mi_fitness_mcp.models import BodyMeasurement, DailyActivity, HeartRateSample, SleepSession
from mi_fitness_mcp.services.query_service import QueryService
from mi_fitness_mcp.storage import Database


def test_storage_and_query_roundtrip(tmp_path):
    db = Database(tmp_path / "test.db")

    activity = DailyActivity(
        id="a1",
        provider="mi_fitness",
        source_type="cloud_session",
        user_id="u1",
        date="2025-04-01",
        steps=1000,
        distance_m=800,
        active_kcal=50,
    )
    hr = HeartRateSample(
        id="hr1",
        provider="mi_fitness",
        source_type="cloud_session",
        user_id="u1",
        timestamp=datetime(2025, 4, 1, 12, 0, 0),
        bpm=70,
        sample_type="passive",
    )
    body = BodyMeasurement(
        id="w1",
        provider="mi_fitness",
        source_type="cloud_session",
        user_id="u1",
        timestamp=datetime(2025, 4, 1, 7, 0, 0),
        weight_kg=101.5,
        bmi=28.0,
    )

    db.insert_daily_activity(activity)
    db.insert_heart_rate_sample(hr)
    db.insert_body_measurement(body)

    query = QueryService(db, "u1")
    assert len(query.get_daily_summaries("2025-04-01", "2025-04-01")) == 1
    assert len(query.get_heart_rate_samples("2025-04-01", "2025-04-01")) == 1
    assert len(query.get_body_measurements("2025-04-01", "2025-04-01")) == 1


def test_sleep_queries_use_local_wake_up_date(tmp_path):
    db = Database(tmp_path / "sleep.db")
    db.insert_sleep_session(SleepSession(
        id="sleep1", sleep_id="night1", provider="mi_fitness",
        source_type="cloud_session", user_id="u1",
        start_at=datetime.fromisoformat("2025-04-01T23:00:00+08:00"),
        end_at=datetime.fromisoformat("2025-04-02T07:00:00+08:00"),
        duration_minutes=480, time_asleep_minutes=450, time_awake_minutes=30,
    ))
    query = QueryService(db, "u1")
    assert query.get_sleep_sessions("2025-04-01", "2025-04-01") == []
    assert len(query.get_sleep_sessions("2025-04-02", "2025-04-02")) == 1
