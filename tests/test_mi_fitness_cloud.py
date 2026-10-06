import pytest

from mi_fitness_mcp.adapters.mi_fitness_cloud import (
    MiFitnessCloudAdapter,
    _is_authentication_error,
)


async def _collect(async_iterable):
    items = []
    async for item in async_iterable:
        items.append(item)
    return items


def test_optional_number_helpers():
    adapter = MiFitnessCloudAdapter(user_id="u1", pass_token="p1")
    assert adapter._optional_float(0) is None
    assert adapter._optional_float("1.5") == 1.5
    assert adapter._optional_int(0) is None
    assert adapter._optional_int("7") == 7


def test_parse_value_dict_and_json():
    adapter = MiFitnessCloudAdapter(user_id="u1", pass_token="p1")
    assert adapter._parse_value({"value": {"steps": 1}}) == {"steps": 1}
    assert adapter._parse_value({"value": '{"steps": 2}'}) == {"steps": 2}


def test_record_datetime_uses_zone_offset():
    adapter = MiFitnessCloudAdapter(user_id="u1", pass_token="p1")
    dt = adapter._record_datetime({"time": 0, "zone_offset": 10800})
    assert dt.isoformat().startswith("1970-01-01T03:00:00")


@pytest.mark.asyncio
async def test_iter_daily_activity_aggregates_steps_and_calories(monkeypatch):
    adapter = MiFitnessCloudAdapter(user_id="u1", pass_token="p1")
    adapter._connected = True
    adapter._client = object()

    async def fake_fetch(key, start_date, end_date, region=None):
        if key == "steps":
            return [
                {
                    "time": 1743467400,
                    "zone_offset": 0,
                    "value": '{"steps": 10, "distance": 8, "calories": 1}',
                },
                {
                    "time": 1743467460,
                    "zone_offset": 0,
                    "value": '{"steps": 20, "distance": 16, "calories": 2}',
                },
            ]
        if key == "calories":
            return [
                {"time": 1743467400, "zone_offset": 0, "value": '{"calories": 5}'},
                {"time": 1743467460, "zone_offset": 0, "value": '{"calories": 7}'},
            ]
        return []

    monkeypatch.setattr(adapter, "_fetch_key", fake_fetch)
    async def no_goals(start_date, end_date):
        return []

    monkeypatch.setattr(adapter, "_fetch_daily_goals", no_goals)
    items = await _collect(adapter.iter_daily_activity("2025-04-01", "2025-04-01"))

    assert len(items) == 1
    assert items[0].steps == 30
    assert items[0].distance_m == 24
    assert items[0].active_kcal == 12


@pytest.mark.asyncio
async def test_daily_activity_uses_merged_cloud_goals_including_zero(monkeypatch):
    adapter = MiFitnessCloudAdapter(user_id="u1", pass_token="p1", region="cn")
    adapter._connected = True
    adapter._client = object()

    async def fake_fetch(key, start_date, end_date, region=None):
        return [
            {"time": 1743467400, "sid": "watch", "value": {"steps": 100, "distance": 80, "calories": 5}},
            {"time": 1743467400, "sid": "phone", "value": {"steps": 90, "distance": 70, "calories": 4}},
            # Repeated page-boundary records must not add extra distance/calories.
            {"time": 1743467400, "sid": "watch", "value": {"steps": 100, "distance": 80, "calories": 5}},
            {"time": 1743467460, "sid": "phone", "value": {"steps": 10, "distance": 8, "calories": 1}},
        ]

    async def fake_goals(start_date, end_date):
        return [
            {"time": 1743465600, "update_time": 1, "value": {"goal_items": [{"field": 1, "achieved_value": 95}]}},
            {"time": 1743465600, "update_time": 2, "value": {"goal_items": [
                {"field": 1, "achieved_value": 105},
                {"field": 2, "achieved_value": 6},
                {"field": 4, "achieved_value": 20},
            ]}},
            {"time": 1743552000, "value": {"goal_items": [{"field": 1, "achieved_value": 0}]}},
        ]

    monkeypatch.setattr(adapter, "_fetch_key", fake_fetch)
    monkeypatch.setattr(adapter, "_fetch_daily_goals", fake_goals)
    items = await _collect(adapter.iter_daily_activity("2025-04-01", "2025-04-02"))
    assert [(item.date, item.steps) for item in items] == [("2025-04-01", 105), ("2025-04-02", 0)]
    assert items[0].distance_m == 88
    assert items[0].active_kcal == 6
    assert items[0].active_minutes == 20


@pytest.mark.asyncio
async def test_daily_goals_pagination_filters_outside_window(monkeypatch):
    adapter = MiFitnessCloudAdapter(user_id="u1", pass_token="p1", region="cn")
    calls = []

    async def fake_request(base_url, api_path, payload):
        calls.append(payload.copy())
        if len(calls) == 1:
            return {"data_list": [{"time": 1743465600}], "has_more": True, "next_key": "page2"}
        return {"data_list": [{"time": 1743379200}], "has_more": False}

    monkeypatch.setattr(adapter, "_request", fake_request)
    items = await adapter._fetch_daily_goals("2025-04-01", "2025-04-01")
    assert len(items) == 1
    assert calls[0]["start_time"] == 1743436800
    assert calls[1]["next_key"] == "page2"


@pytest.mark.asyncio
async def test_sleep_stage_totals_do_not_subtract_awake_twice(monkeypatch):
    adapter = MiFitnessCloudAdapter(user_id="u1", pass_token="p1", region="cn")
    adapter._connected = True
    adapter._client = object()
    start = 1743465600
    payload = {
        "bedtime": start, "wake_up_time": start + 540 * 60,
        "duration": 467, "sleep_deep_duration": 129,
        "sleep_light_duration": 338, "sleep_awake_duration": 73,
        "items": [
            {"state": 2, "start_time": start, "end_time": start + 129 * 60},
            {"state": 3, "start_time": start + 129 * 60, "end_time": start + 467 * 60},
            {"state": 5, "start_time": start + 467 * 60, "end_time": start + 540 * 60},
            {"state": 1, "start_time": start, "end_time": start + 60},
        ],
    }

    async def fake_fetch(*args, **kwargs):
        return [{"time": start + 540 * 60, "value": payload}]

    monkeypatch.setattr(adapter, "_fetch_key", fake_fetch)
    sleep = (await _collect(adapter.iter_sleep_sessions("2025-04-01", "2025-04-01")))[0]
    assert sleep.duration_minutes == 540
    assert sleep.time_asleep_minutes == 467
    assert sleep.time_awake_minutes == 73
    assert [(stage.stage, stage.minutes) for stage in sleep.stages] == [("deep", 129), ("light", 338), ("awake", 73)]
    assert adapter._sleep_stage_name(4) == "rem"
    assert adapter._sleep_stage_name("invalid") is None


@pytest.mark.asyncio
@pytest.mark.parametrize("raw_duration", [480, 480 * 60])
async def test_sleep_duration_unit_fallback(monkeypatch, raw_duration):
    adapter = MiFitnessCloudAdapter(user_id="u1", pass_token="p1", region="cn")
    adapter._connected = True
    adapter._client = object()
    start = 1743465600

    async def fake_fetch(*args, **kwargs):
        return [{"time": start + 480 * 60, "value": {
            "bedtime": start, "wake_up_time": start + 480 * 60,
            "duration": raw_duration, "sleep_awake_duration": 30,
        }}]

    monkeypatch.setattr(adapter, "_fetch_key", fake_fetch)
    sleep = (await _collect(adapter.iter_sleep_sessions("2025-04-01", "2025-04-01")))[0]
    assert sleep.duration_minutes == 480
    assert sleep.time_asleep_minutes == 450
    assert sleep.time_awake_minutes == 30


@pytest.mark.asyncio
async def test_fetch_key_rejects_repeated_pagination_cursor(monkeypatch):
    adapter = MiFitnessCloudAdapter(user_id="u1", pass_token="p1", region="cn")
    adapter._client = object()

    async def fake_request(base_url, api_path, payload):
        return {"data_list": [], "has_more": True, "next_key": "same"}

    monkeypatch.setattr(adapter, "_request", fake_request)
    with pytest.raises(RuntimeError, match="cursor loop"):
        await adapter._fetch_key("steps", "2026-07-06", "2026-07-12")


@pytest.mark.asyncio
async def test_connect_failure_closes_client(monkeypatch):
    adapter = MiFitnessCloudAdapter(user_id="u1", pass_token="bad", region="cn")

    async def failed_login(user_id, pass_token):
        raise RuntimeError("invalid credentials")

    monkeypatch.setattr(adapter, "_login_with_token", failed_login)
    assert await adapter.connect() is False
    assert adapter._client is None
    assert "invalid credentials" in adapter.last_error


def test_authentication_error_detection():
    assert _is_authentication_error(401, "denied")
    assert _is_authentication_error(0, "session expired")
    assert _is_authentication_error(-10001, "unknown")
    assert not _is_authentication_error(500, "temporary server failure")
