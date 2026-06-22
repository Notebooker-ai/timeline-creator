"""Tests for TimelineCreator with a stubbed language model (no network)."""

from __future__ import annotations

import json
import tempfile

import pytest
from timeline_creator import TimelineCreator
from open_notebook_creator_sdk import ContentBundle, CreationRequest, ModelRole
from open_notebook_creator_sdk.testing import assert_creator_compliant, assert_result_compliant


class _FakeResp:
    def __init__(self, content):
        self.content = content


class _FakeLLM:
    def __init__(self, payload):
        self._payload = payload

    async def ainvoke(self, _):
        return _FakeResp(self._payload)


class _FakeRole(ModelRole):
    payload: str = ""

    def create_language(self, **_):
        return _FakeLLM(self.payload)


def _role(obj):
    return _FakeRole(provider="f", model="f", payload=json.dumps(obj))


def test_static_compliance():
    assert_creator_compliant(TimelineCreator())


@pytest.mark.asyncio
async def test_generate_valid_timeline():
    creator = TimelineCreator()
    payload = {
        "title": "Apollo Program",
        "items": [
            {"id": "e1", "content": "Program begins", "start": "1961"},
            {"id": "e2", "content": "First crewed flight", "start": "1968", "end": "1969", "type": "range"},
            {"content": "Moon landing", "start": "1969-07-20"},
        ],
    }
    with tempfile.TemporaryDirectory() as td:
        req = CreationRequest(
            content=ContentBundle(text="Some content"),
            config={"max_events": 20},
            models={"text": _role(payload)},
            output_dir=td,
            artifact_id="a",
        )
        result = await creator.generate(req)
        assert result.status == "SUCCESS"
        assert_result_compliant(creator, result)
        assert result.data["title"] == "Apollo Program"
        assert len(result.data["items"]) == 3
        # missing id was backfilled
        assert all(it["id"] for it in result.data["items"])


@pytest.mark.asyncio
async def test_drops_invalid_items_and_keeps_used_groups():
    creator = TimelineCreator()
    payload = {
        "title": "Mixed",
        "items": [
            {"id": "e1", "content": "Has group", "start": "2000", "group": "g1"},
            {"id": "e2", "content": "No date"},          # invalid: no start
            {"id": "e3", "start": "2001"},                # invalid: no content
        ],
        "groups": [
            {"id": "g1", "content": "Lane One"},
            {"id": "g2", "content": "Unused"},            # dropped: not referenced
        ],
    }
    with tempfile.TemporaryDirectory() as td:
        req = CreationRequest(
            content=ContentBundle(text="x"),
            config={"grouped": True},
            models={"text": _role(payload)},
            output_dir=td,
            artifact_id="a",
        )
        result = await creator.generate(req)
        assert result.status == "SUCCESS"
        assert len(result.data["items"]) == 1
        assert [g["id"] for g in result.data["groups"]] == ["g1"]


@pytest.mark.asyncio
async def test_respects_max_events():
    creator = TimelineCreator()
    items = [{"id": f"e{i}", "content": f"Event {i}", "start": str(2000 + i)} for i in range(10)]
    with tempfile.TemporaryDirectory() as td:
        req = CreationRequest(
            content=ContentBundle(text="x"),
            config={"max_events": 4},
            models={"text": _role({"title": "T", "items": items})},
            output_dir=td,
            artifact_id="a",
        )
        result = await creator.generate(req)
        assert result.status == "SUCCESS"
        assert len(result.data["items"]) == 4


@pytest.mark.asyncio
async def test_failure_when_no_items():
    creator = TimelineCreator()
    with tempfile.TemporaryDirectory() as td:
        req = CreationRequest(
            content=ContentBundle(text="x"),
            models={"text": _role({"title": "T", "items": []})},
            output_dir=td,
            artifact_id="a",
        )
        result = await creator.generate(req)
        assert result.status == "FAILURE"


@pytest.mark.asyncio
async def test_no_text_role_is_failure():
    creator = TimelineCreator()
    with tempfile.TemporaryDirectory() as td:
        req = CreationRequest(content=ContentBundle(text="x"), output_dir=td, artifact_id="a")
        result = await creator.generate(req)
        assert result.status == "FAILURE"
        assert result.errors[0].phase == "setup"


def test_manifest_declares_view_bundle_and_it_ships():
    """The creator owns its UI: the manifest points at a shipped HTML view bundle."""
    from importlib import resources

    m = TimelineCreator().manifest
    assert m.view is not None
    assert m.view.entry == "view/index.html"
    asset = resources.files("timeline_creator").joinpath(m.view.entry)
    assert asset.is_file()
    html = asset.read_text()
    # self-contained + speaks the host handshake + dispatches our schema
    assert "open-notebook:ready" in html
    assert "open-notebook:artifact" in html
    assert "timeline.v1" in html
    assert 'src="http' not in html  # no external scripts (sandbox-safe, offline)
    # owns date parsing so a bare year isn't misread as epoch-milliseconds
    assert "setFullYear" in html
