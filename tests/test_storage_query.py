from datetime import datetime

import pytest

from mi_fitness_mcp.models import (
    BodyMeasurement,
    DailyActivity,
    HeartRateSample,
    SleepSession,
    SpO2Sample,
)
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
    db.insert_sleep_session(
        SleepSession(
            id="sleep1",
            sleep_id="night1",
            provider="mi_fitness",
            source_type="cloud_session",
            user_id="u1",
            start_at=datetime.fromisoformat("2025-04-01T23:00:00+08:00"),
            end_at=datetime.fromisoformat("2025-04-02T07:00:00+08:00"),
            duration_minutes=480,
            time_asleep_minutes=450,
            time_awake_minutes=30,
        )
    )
    query = QueryService(db, "u1")
    assert query.get_sleep_sessions("2025-04-01", "2025-04-01") == []
    assert len(query.get_sleep_sessions("2025-04-02", "2025-04-02")) == 1
    assert query.get_data_coverage()[0]["first_date"] == "2025-04-02"


def test_analysis_snapshot_keeps_units_missing_days_and_actual_sleep(tmp_path):
    db = Database(tmp_path / "analysis.db")
    db.insert_sleep_session(
        SleepSession(
            id="sleep1",
            sleep_id="private-id",
            provider="mi_fitness",
            source_type="cloud_session",
            user_id="u1",
            start_at=datetime.fromisoformat("2025-04-01T23:00:00+08:00"),
            end_at=datetime.fromisoformat("2025-04-02T07:00:00+08:00"),
            duration_minutes=480,
            time_asleep_minutes=450,
            time_awake_minutes=30,
            stages=[
                {"stage": "deep", "minutes": 100},
                {"stage": "light", "minutes": 350},
                {"stage": "awake", "minutes": 30},
            ],
        )
    )
    for hour, value in [(7, 60), (8, 80)]:
        db.insert_heart_rate_sample(
            HeartRateSample(
                id=f"hr{hour}",
                provider="mi_fitness",
                source_type="cloud_session",
                user_id="u1",
                timestamp=datetime(2025, 4, 2, hour),
                bpm=value,
                sample_type="resting",
            )
        )
    query = QueryService(db, "u1")
    result = query.get_analysis_snapshot("2025-04-02", "2025-04-03")
    assert result["daily_activity"] == []  # Unavailable activity must not become a zero-filled day.
    assert result["units"]["sleep_duration"] == "minutes"
    assert result["sleep_sessions"][0]["time_asleep_minutes"] == 450
    assert result["sleep_sessions"][0]["stage_minutes"] == {"deep": 100, "light": 350, "awake": 30}
    assert "sleep_id" not in result["sleep_sessions"][0]
    assert result["resting_heart_rate"] == [
        {"date": "2025-04-02", "sample_count": 2, "min": 60, "max": 80, "mean": 70}
    ]
    assert result["spo2"] == []
    assert result["data_quality_notes"]
    with pytest.raises(ValueError, match="1 to 93 days"):
        query.get_analysis_snapshot("2025-04-03", "2025-04-02")
    with pytest.raises(ValueError, match="1 to 93 days"):
        query.get_analysis_snapshot("2025-01-01", "2025-12-31")


def test_sample_coverage_keeps_local_calendar_date(tmp_path):
    db = Database(tmp_path / "coverage.db")
    db.insert_spo2_sample(
        SpO2Sample(
            id="spo2-1",
            provider="mi_fitness",
            source_type="cloud_session",
            user_id="u1",
            timestamp=datetime.fromisoformat("2025-04-02T00:30:00+08:00"),
            spo2_pct=97,
        )
    )
    coverage = QueryService(db, "u1").get_data_coverage()
    assert coverage == [
        {
            "data_type": "spo2",
            "first_date": "2025-04-02",
            "last_date": "2025-04-02",
            "days_with_data": 1,
        }
    ]
