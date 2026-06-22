"""timeline-creator: an Open Notebook creator that turns notebook content into a
chronological **timeline** (emitted as ``timeline.v1``). The LLM produces dated
items (and optional lane groups) — no files — which the creator's own self-contained
view bundle (``view/index.html``) renders in the host's sandboxed iframe.
"""

import json
import re
from importlib import resources
from typing import ClassVar

from ai_prompter import Prompter
from loguru import logger
from open_notebook_creator_sdk import (
    BaseCreator,
    CreationError,
    CreationRequest,
    CreationResult,
    CreatorManifest,
    CreatorView,
    ModelRoleSpec,
)
from open_notebook_creator_sdk.schemas import TimelineV1
from pydantic import BaseModel, Field

__version__ = "0.2.0"

_ITEM_TYPES = {"point", "range", "box", "background"}


class TimelineConfig(BaseModel):
    max_events: int = Field(
        default=20, ge=3, le=60, description="Maximum number of timeline events"
    )
    grouped: bool = Field(
        default=False,
        description="Organize events into labelled lanes (groups) by category.",
    )


def _strip_fences(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n", "", text)
        text = re.sub(r"\n```$", "", text)
    return text.strip()


def _clean_item(raw: object, index: int) -> dict | None:
    """Validate/normalize one timeline item; return None if unusable."""
    if not isinstance(raw, dict):
        return None
    content = (raw.get("content") or "").strip() if isinstance(raw.get("content"), str) else ""
    start = (raw.get("start") or "").strip() if isinstance(raw.get("start"), str) else ""
    if not content or not start:
        return None
    item = {"id": str(raw.get("id") or f"e{index}"), "content": content, "start": start}
    end = raw.get("end")
    if isinstance(end, str) and end.strip():
        item["end"] = end.strip()
    group = raw.get("group")
    if isinstance(group, str) and group.strip():
        item["group"] = group.strip()
    itype = raw.get("type")
    if isinstance(itype, str) and itype in _ITEM_TYPES:
        item["type"] = itype
    return item


class TimelineCreator(BaseCreator):
    config_model: ClassVar[type] = TimelineConfig

    @property
    def manifest(self) -> CreatorManifest:
        return self.build_manifest(
            key="timelines",
            name="Timelines",
            version=__version__,
            description="LLM-generated interactive timeline of events from the content.",
            sdk_compat=">=0.2,<1",
            emits=["timeline.v1"],
            model_roles=[
                ModelRoleSpec(
                    key="text",
                    kind="language",
                    requires=["structured_json"],
                    description="LLM that extracts the chronology.",
                )
            ],
            icon="calendar-clock",
            view=CreatorView(entry="view/index.html"),
        )

    async def generate(self, request: CreationRequest) -> CreationResult:
        cfg = TimelineConfig.model_validate(request.config)
        role = request.models.get("text")
        if role is None:
            return CreationResult(
                status="FAILURE",
                schema_id="timeline.v1",
                data={},
                errors=[CreationError(phase="setup", message="missing 'text' model role")],
                user_message="No language model was provided for timeline generation.",
            )

        template = resources.files("timeline_creator.prompts").joinpath(
            "timeline.jinja"
        ).read_text()
        prompt = Prompter(template_text=template).render(
            {
                "content": request.content.text,
                "max_events": cfg.max_events,
                "grouped": cfg.grouped,
                "instructions": request.instructions,
            }
        )
        llm = role.create_language(structured={"type": "json"}, max_tokens=4000)
        resp = await llm.ainvoke(prompt)
        raw = resp.content if hasattr(resp, "content") else str(resp)
        try:
            parsed = json.loads(_strip_fences(raw))
        except json.JSONDecodeError as e:
            logger.error(f"timelines: non-JSON response: {e}")
            return CreationResult(
                status="FAILURE",
                schema_id="timeline.v1",
                data={},
                errors=[CreationError(phase="parse", message=f"invalid JSON: {e}", retryable=True)],
                user_message="The model returned an unparseable response. Please retry.",
            )

        if not isinstance(parsed, dict):
            return CreationResult(
                status="FAILURE",
                schema_id="timeline.v1",
                data={},
                errors=[CreationError(phase="generate", message="response was not an object")],
                user_message="No timeline could be generated from this content.",
            )

        raw_items = parsed.get("items", []) if isinstance(parsed.get("items"), list) else []
        items = [it for it in (_clean_item(r, i) for i, r in enumerate(raw_items)) if it]
        items = items[: cfg.max_events]

        title = parsed.get("title")
        if not items or not isinstance(title, str) or not title.strip():
            return CreationResult(
                status="FAILURE",
                schema_id="timeline.v1",
                data={},
                errors=[CreationError(phase="generate", message="no usable timeline items")],
                user_message="No timeline could be generated from this content.",
            )

        # Keep only groups actually referenced by an item (and that are well-formed).
        used_groups = {it["group"] for it in items if "group" in it}
        raw_groups = parsed.get("groups", []) if isinstance(parsed.get("groups"), list) else []
        groups = [
            {"id": str(g.get("id")).strip(), "content": (g.get("content") or "").strip()}
            for g in raw_groups
            if isinstance(g, dict)
            and str(g.get("id") or "").strip() in used_groups
            and (g.get("content") or "").strip()
        ]

        data = TimelineV1(title=title.strip(), items=items, groups=groups).model_dump()
        return CreationResult(
            status="SUCCESS",
            schema_id="timeline.v1",
            data=data,
        )
