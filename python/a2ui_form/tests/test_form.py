# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import json
import re
from pathlib import Path

import pytest

from a2ui_form import (
    MARKER,
    A2UIInputCancelled,
    A2UIInputError,
    a2ui_form,
    a2ui_form_input,
    a2ui_input,
    coerce_form_data,
    create_request,
    decode_reply,
)
from a2ui_form._form import _js_number

FIXTURE = json.loads(
    (
        Path(__file__).parents[3]
        / "typescript/renderers/form/tests/fixtures/form-builder.json"
    ).read_text()
)


def _snake(options):
    return {re.sub(r"[A-Z]", lambda m: "_" + m[0].lower(), k): v for k, v in options.items()}


@pytest.mark.parametrize("case", FIXTURE["builder"], ids=lambda case: case["name"])
def test_builder_matches_shared_fixture(case):
    assert a2ui_form(case["fields"], **_snake(case["options"])) == case["messages"]


@pytest.mark.parametrize("case", FIXTURE["coercion"])
def test_coercion_matches_shared_fixture(case):
    if case.get("error"):
        with pytest.raises(A2UIInputError):
            coerce_form_data(case["fields"], case["data"])
    else:
        assert coerce_form_data(case["fields"], case["data"]) == case["expected"]


@pytest.mark.parametrize(
    ("value", "text"),
    [(42, "42"), (3.0, "3"), (1.5, "1.5"), (-0.000001, "-0.000001"), (1e-7, "1e-7"),
     (1e21, "1e+21"), (123456789012.5, "123456789012.5"), (1.25e-10, "1.25e-10")],
)
def test_number_defaults_are_formatted_like_javascript(value, text):
    assert _js_number(value) == text


def test_request_round_trip():
    messages = a2ui_form([{"name": "answer"}])
    request = create_request(messages, prompt="Answer", cancel=())
    assert request.startswith(MARKER)
    assert json.loads(request[len(MARKER):]) == {
        "messages": messages,
        "prompt": "Answer",
        "submit": ["submit"],
        "cancel": [],
    }


@pytest.mark.parametrize(
    "messages",
    [
        [],
        [{"version": "1.0", "updateDataModel": {"surfaceId": "s", "path": "/", "value": {}}}],
        [{"version": "1.0", "createSurface": {"surfaceId": "s", "catalogId": "c"}},
         {"version": "1.0", "deleteSurface": {"surfaceId": "s"}}],
        [{"version": "1.0", "createSurface": {"surfaceId": "s", "catalogId": "c"}},
         {"version": "1.0", "updateComponents": {"surfaceId": "t", "components": []}}],
        [{"version": "1.0", "createSurface": {"surfaceId": "s", "catalogId": float("nan")}}],
    ],
)
def test_invalid_requests_are_rejected(messages):
    with pytest.raises(A2UIInputError):
        create_request(messages)


def test_invalid_action_names_are_rejected():
    messages = a2ui_form([{"name": "a"}])
    for options in ({"submit": ()}, {"submit": "submit"}, {"submit": ["a b"]},
                    {"submit": ["go"], "cancel": ["go"]}):
        with pytest.raises(A2UIInputError):
            create_request(messages, **options)


def test_decode_reply_outcomes():
    ok = '{"status":"ok","action":"submit","context":{},"data":{"a":"1"}}'
    assert decode_reply(ok, ["submit"]) == {"action": "submit", "context": {}, "data": {"a": "1"}}
    with pytest.raises(A2UIInputError, match="not requested"):
        decode_reply(ok, ["save"])
    with pytest.raises(A2UIInputCancelled):
        decode_reply('{"status":"cancelled"}', ["submit"])
    with pytest.raises(A2UIInputError, match="render_failed"):
        decode_reply('{"status":"error","code":"render_failed"}', ["submit"])
    for raw in ('{"status":"ok","status":"ok"}', '{"status":"ok"}', "NaN", "[]",
                '{"status":"ok","action":"submit","context":{},"data":{"n":9007199254740993}}'):
        with pytest.raises(A2UIInputError):
            decode_reply(raw, ["submit"])


def test_a2ui_input_uses_stdin():
    prompts = []

    def fake_input(prompt):
        prompts.append(prompt)
        return '{"status":"ok","action":"go","context":{"x":1},"data":{"a":"b"}}'

    messages = a2ui_form([{"name": "a"}], submit_action="go")
    result = a2ui_input(messages, submit=["go"], input=fake_input)
    assert result == {"action": "go", "context": {"x": 1}, "data": {"a": "b"}}
    assert prompts[0].startswith(MARKER)


def test_a2ui_form_input_returns_coerced_data():
    def fake_input(prompt):
        request = json.loads(prompt[len(MARKER):])
        assert request["submit"] == ["save"] and request["cancel"] == []
        return '{"status":"ok","action":"save","context":{},"data":{"age":"41","ok":true}}'

    fields = [{"name": "age", "type": "number"}, {"name": "ok", "type": "checkbox"}]
    data = a2ui_form_input(fields, submit_action="save", cancel_label=None, input=fake_input)
    assert data == {"age": 41, "ok": True}


@pytest.mark.parametrize(
    "fields",
    [[], [{"name": "a"}, {"name": "a"}], [{"name": "1a"}], [{"name": "a", "type": "color"}],
     [{"name": "a", "type": "choice"}], [{"name": "a", "type": "slider"}],
     [{"name": "a", "type": "checkbox", "value": "yes"}],
     [{"name": "a", "type": "slider", "max": True}]],
)
def test_invalid_fields_are_rejected(fields):
    with pytest.raises(A2UIInputError):
        a2ui_form(fields)
