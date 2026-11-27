# Copyright 2024 Google LLC
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

"""The A2UI input protocol (v1) and the simple form builder.

This mirrors ``typescript/renderers/form/src/protocol.ts`` and ``builder.ts``.
Both are checked against ``typescript/renderers/form/tests/fixtures/form-builder.json``.
"""

from __future__ import annotations

import builtins
import json
import math
import re
from collections.abc import Callable, Mapping, Sequence
from decimal import Decimal
from typing import Any, NoReturn, TypeGuard

MARKER = "jupyterlite-a2ui-input:v1:"
MAX_REQUEST_BYTES = 262144
MAX_REPLY_BYTES = 65536
MAX_MESSAGES = 256
MAX_ACTIONS = 16
MAX_REQUEST_DEPTH = 32
MAX_REPLY_DEPTH = 16
MAX_FIELDS = 64
MAX_SAFE_INTEGER = 2**53 - 1
BASIC_CATALOG_ID = "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"
FIELD_TYPES = (
    "text",
    "longText",
    "password",
    "number",
    "checkbox",
    "choice",
    "multiChoice",
    "slider",
    "date",
    "time",
    "datetime",
)

_ACTION_NAME = re.compile(r"[A-Za-z][A-Za-z0-9_.:-]{0,127}\Z")
_ERROR_CODE = re.compile(r"[a-z][a-z0-9_]{0,63}\Z")
_FIELD_NAME = re.compile(r"[A-Za-z][A-Za-z0-9_]{0,63}\Z")
_DECIMAL = re.compile(r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?\Z")
_OPERATIONS = ("createSurface", "updateComponents", "updateDataModel")
_TEXT_VARIANTS = {
    "text": "shortText",
    "longText": "longText",
    "password": "obscured",
    "number": "number",
}


class A2UIInputError(RuntimeError):
    """An A2UI input request or reply was invalid or could not be completed."""


class A2UIInputCancelled(A2UIInputError):  # noqa: N818 - matches the other helpers
    """The user cancelled the A2UI input form."""


def _fail(message: str) -> NoReturn:
    raise A2UIInputError(message)


def _utf8_size(value: str) -> int:
    try:
        return len(value.encode("utf-8"))
    except UnicodeEncodeError as error:
        raise A2UIInputError("Invalid Unicode") from error


def _is_number(value: Any) -> TypeGuard[int | float]:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _is_list(value: Any) -> TypeGuard[Sequence[Any]]:
    return isinstance(value, Sequence) and not isinstance(
        value, (str, bytes, bytearray)
    )


def _copy_json(value: Any, max_depth: int, depth: int = 0) -> Any:
    """Copy a value as plain JSON, rejecting what JSON cannot represent exactly."""
    if depth > max_depth:
        _fail("Value is nested too deeply")
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, str):
        _utf8_size(value)
        return value
    if _is_number(value):
        if isinstance(value, float) and not math.isfinite(value):
            _fail("Unsupported number")
        if (isinstance(value, int) or value.is_integer()) and abs(
            value
        ) > MAX_SAFE_INTEGER:
            _fail("Unsupported number")
        return value
    if _is_list(value):
        return [_copy_json(item, max_depth, depth + 1) for item in value]
    if isinstance(value, Mapping):
        result = {}
        for key, item in value.items():
            if not isinstance(key, str):
                _fail("Object keys must be strings")
            _utf8_size(key)
            result[key] = _copy_json(item, max_depth, depth + 1)
        return result
    _fail("Unsupported value")


def _unique_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON key")
        result[key] = value
    return result


def _reject_constant(value: str) -> None:
    raise ValueError(f"invalid JSON constant: {value}")


def _action_names(names: Any, minimum: int) -> list[str]:
    result = list(names) if _is_list(names) else None
    if (
        result is None
        or not minimum <= len(result) <= MAX_ACTIONS
        or any(
            not isinstance(name, str) or not _ACTION_NAME.fullmatch(name)
            for name in result
        )
        or len(set(result)) != len(result)
    ):
        _fail(
            f"submit and cancel must list up to {MAX_ACTIONS} unique, valid action"
            " names"
        )
    return result


def _validate_messages(messages: Any) -> list[dict[str, Any]]:
    if not _is_list(messages) or not 1 <= len(messages) <= MAX_MESSAGES:
        _fail(f"messages must be a list of 1 to {MAX_MESSAGES} A2UI messages")
    copied = _copy_json(messages, MAX_REQUEST_DEPTH)
    if not isinstance(copied, list):
        _fail("messages must be a list of A2UI messages")
    surface_id = None
    for index, message in enumerate(copied):
        if not isinstance(message, dict) or message.get("version") != "1.0":
            _fail("Each message must be an A2UI v1.0 message object")
        operation = next((name for name in _OPERATIONS if name in message), None)
        if len(message) != 2 or operation is None:
            _fail(
                "Each message must contain one createSurface, updateComponents or "
                "updateDataModel operation"
            )
        if (operation == "createSurface") != (index == 0):
            _fail("The first message, and only the first, must be createSurface")
        body = message[operation]
        found = body.get("surfaceId") if isinstance(body, dict) else None
        if not isinstance(found, str) or not found:
            _fail("Each message must name a surfaceId")
        surface_id = surface_id or found
        if found != surface_id:
            _fail("All messages must target the created surface")
    return copied


def create_request(
    messages: Sequence[Mapping[str, Any]],
    *,
    prompt: str = "",
    submit: Sequence[str] = ("submit",),
    cancel: Sequence[str] = ("cancel",),
) -> str:
    """Build the marked stdin prompt for an A2UI input request."""
    if not isinstance(prompt, str):
        _fail("prompt must be a string")
    _utf8_size(prompt)
    submit_names = _action_names(submit, 1)
    cancel_names = _action_names(cancel, 0)
    if set(submit_names) & set(cancel_names):
        _fail("An action cannot both submit and cancel")
    request = MARKER + json.dumps(
        {
            "messages": _validate_messages(messages),
            "prompt": prompt,
            "submit": submit_names,
            "cancel": cancel_names,
        },
        ensure_ascii=False,
        separators=(",", ":"),
        allow_nan=False,
    )
    if _utf8_size(request) > MAX_REQUEST_BYTES:
        _fail("Request is too large")
    return request


def decode_reply(raw: str, submit: Sequence[str]) -> dict[str, Any]:
    """Decode the stdin reply into ``{"action", "context", "data"}``."""
    if not isinstance(raw, str) or _utf8_size(raw) > MAX_REPLY_BYTES:
        _fail("Invalid or oversized reply")
    try:
        reply = json.loads(
            raw, object_pairs_hook=_unique_pairs, parse_constant=_reject_constant
        )
    except (ValueError, RecursionError) as error:
        raise A2UIInputError("Invalid JSON reply") from error
    if not isinstance(reply, dict):
        _fail("Invalid reply envelope")
    if reply == {"status": "cancelled"}:
        raise A2UIInputCancelled("A2UI input cancelled")
    if (
        set(reply) == {"status", "code"}
        and reply["status"] == "error"
        and isinstance(reply["code"], str)
        and _ERROR_CODE.fullmatch(reply["code"])
    ):
        _fail(f"Frontend A2UI input error: {reply['code']}")
    if set(reply) != {"status", "action", "context", "data"} or reply["status"] != "ok":
        _fail("Invalid reply envelope")
    action = reply["action"]
    if not isinstance(action, str) or not _ACTION_NAME.fullmatch(action):
        _fail("Invalid action name")
    if not isinstance(reply["context"], dict) or not isinstance(reply["data"], dict):
        _fail("Action context and data must be objects")
    context = _copy_json(reply["context"], MAX_REPLY_DEPTH - 1)
    data = _copy_json(reply["data"], MAX_REPLY_DEPTH - 1)
    if action not in submit:
        _fail("Reply action was not requested")
    return {"action": action, "context": context, "data": data}


def a2ui_input(
    messages: Sequence[Mapping[str, Any]],
    *,
    prompt: str = "",
    submit: Sequence[str] = ("submit",),
    cancel: Sequence[str] = ("cancel",),
    input: Callable[[str], str] | None = None,  # noqa: A002 - tests replace the stdin call
) -> dict[str, Any]:
    """Show A2UI messages as a form and wait for one of its submit actions.

    Returns ``{"action", "context", "data"}`` where ``data`` is the surface data
    model. Raises :class:`A2UIInputCancelled` when the form is cancelled.
    """
    request = create_request(messages, prompt=prompt, submit=submit, cancel=cancel)
    # Kernels replace builtins.input per execution, so look it up at call time.
    read = builtins.input if input is None else input
    return decode_reply(read(request), list(submit))


# --- Form builder -------------------------------------------------------------


def _js_number(value: int | float) -> str:
    """Format a number as JavaScript's ``String(number)`` does."""
    if isinstance(value, int) or (value.is_integer() and abs(value) < 1e21):
        return str(int(value))
    sign = "-" if value < 0 else ""
    decimal_tuple = Decimal(repr(abs(value))).normalize().as_tuple()
    _, digit_tuple, exponent = decimal_tuple
    if not isinstance(exponent, int):
        _fail("Number must be finite")
    digits = "".join(map(str, digit_tuple))
    k = len(digits)
    n = exponent + k
    if k <= n <= 21:
        text = digits + "0" * (n - k)
    elif 0 < n <= 21:
        text = f"{digits[:n]}.{digits[n:]}"
    elif -6 < n <= 0:
        text = "0." + "0" * -n + digits
    else:
        mantissa = digits[0] + (f".{digits[1:]}" if k > 1 else "")
        text = f"{mantissa}e{'+' if n - 1 >= 0 else '-'}{abs(n - 1)}"
    return sign + text


def _finite(value: Any, description: str) -> int | float:
    if not _is_number(value) or not math.isfinite(value):
        _fail(f"{description} must be a finite number")
    return value


def _options(field: Mapping[str, Any], name: str) -> list[dict[str, str]]:
    raw = field.get("options")
    if not _is_list(raw) or not raw:
        _fail(f'Field "{name}" needs a non-empty options list')
    options: list[dict[str, str]] = []
    for option in raw:
        if isinstance(option, str):
            options.append({"label": option, "value": option})
        elif (
            isinstance(option, Mapping)
            and isinstance(option.get("label"), str)
            and isinstance(option.get("value"), str)
        ):
            options.append({"label": option["label"], "value": option["value"]})
        else:
            _fail(f'Field "{name}" has an invalid option')
    if len({option["value"] for option in options}) != len(options):
        _fail(f'Field "{name}" has duplicate option values')
    return options


def _default_value(field: Mapping[str, Any], name: str, kind: str) -> Any:
    value = field.get("value")
    if kind == "checkbox":
        if value is None:
            return False
        if not isinstance(value, bool):
            _fail(f'Field "{name}" value must be a boolean')
        return value
    if kind in ("choice", "multiChoice"):
        if value is None:
            return []
        items = [value] if isinstance(value, str) else value
        if not _is_list(items) or not all(isinstance(item, str) for item in items):
            _fail(f'Field "{name}" value must be a string or a list of strings')
        return list(items)
    if kind == "slider":
        if value is None:
            minimum = field.get("min")
            return 0 if minimum is None else minimum
        return _finite(value, f'Field "{name}" value')
    if value is None:
        return ""
    if kind == "number" and _is_number(value):
        return _js_number(_finite(value, f'Field "{name}" value'))
    if not isinstance(value, str):
        expected = "a number or string" if kind == "number" else "a string"
        _fail(f'Field "{name}" value must be {expected}')
    return value


def _required_check(name: str) -> dict[str, Any]:
    return {"@call": "required", "args": {"value": {"@path": f"/{name}"}}}


def _field_component(
    field: Mapping[str, Any], name: str, kind: str, label: str
) -> dict[str, Any]:
    component_id = f"field_{name}"
    value = {"@path": f"/{name}"}
    variant = _TEXT_VARIANTS.get(kind)
    if variant:
        component: dict[str, Any] = {
            "id": component_id,
            "component": "TextField",
            "label": label,
            "value": value,
            "variant": variant,
        }
        if field.get("placeholder") is not None:
            if not isinstance(field["placeholder"], str):
                _fail(f'Field "{name}" placeholder must be a string')
            component["placeholder"] = field["placeholder"]
        return component
    if kind == "checkbox":
        return {
            "id": component_id,
            "component": "CheckBox",
            "label": label,
            "value": value,
        }
    if kind in ("choice", "multiChoice"):
        return {
            "id": component_id,
            "component": "ChoicePicker",
            "label": label,
            "variant": "mutuallyExclusive" if kind == "choice" else "multipleSelection",
            "options": _options(field, name),
            "value": value,
        }
    if kind == "slider":
        minimum = field.get("min")
        component = {
            "id": component_id,
            "component": "Slider",
            "label": label,
            "min": 0 if minimum is None else _finite(minimum, f'Field "{name}" min'),
            "max": _finite(field.get("max"), f'Field "{name}" max'),
            "value": value,
        }
        steps = field.get("steps")
        if steps is not None:
            if (
                not isinstance(steps, int)
                or isinstance(steps, bool)
                or not 1 <= steps <= MAX_SAFE_INTEGER
            ):
                _fail(f'Field "{name}" steps must be a positive integer')
            component["steps"] = steps
        return component
    return {
        "id": component_id,
        "component": "DateTimeInput",
        "label": label,
        "value": value,
        "enableDate": kind != "time",
        "enableTime": kind != "date",
    }


def a2ui_form(
    fields: Sequence[Mapping[str, Any]],
    *,
    title: str | None = None,
    surface_id: str = "a2ui-form",
    submit_label: str = "Submit",
    cancel_label: str | None = "Cancel",
    submit_action: str = "submit",
    cancel_action: str = "cancel",
) -> list[dict[str, Any]]:
    """Build the A2UI v1.0 messages for a simple form.

    Each field is a mapping with ``name`` and optional ``type`` (one of
    :data:`FIELD_TYPES`, default ``"text"``), ``label``, ``value``,
    ``placeholder``, ``options``, ``min``, ``max``, ``steps`` and ``required``.
    ``cancel_label=None`` leaves out the cancel button.
    """
    if not _is_list(fields) or not 1 <= len(fields) <= MAX_FIELDS:
        _fail(f"fields must be a list of 1 to {MAX_FIELDS} field specifications")
    for option, value in (
        ("surfaceId", surface_id),
        ("submitLabel", submit_label),
        ("submitAction", submit_action),
    ):
        if not isinstance(value, str) or not value:
            _fail(f"{option} must be a non-empty string")
    if title is not None and not isinstance(title, str):
        _fail("title must be a string")
    if cancel_label is not None:
        if not isinstance(cancel_label, str) or not cancel_label:
            _fail("cancelLabel must be a non-empty string or null")
        if not isinstance(cancel_action, str) or not cancel_action:
            _fail("cancelAction must be a non-empty string")

    names: set[str] = set()
    data_model: dict[str, Any] = {}
    field_components = []
    required = []
    for field in fields:
        name = field.get("name") if isinstance(field, Mapping) else None
        if not isinstance(name, str) or not _FIELD_NAME.fullmatch(name):
            _fail(
                "Each field needs a name of letters, digits and underscores starting"
                " with a letter"
            )
        if name in names:
            _fail(f'Duplicate field name "{name}"')
        names.add(name)
        kind = field.get("type")
        kind = "text" if kind is None else kind
        if not isinstance(kind, str) or kind not in FIELD_TYPES:
            _fail(f'Field "{name}" has unknown type "{kind}"')
        label = field.get("label")
        label = name if label is None else label
        if not isinstance(label, str):
            _fail(f'Field "{name}" label must be a string')
        data_model[name] = _default_value(field, name, kind)
        component = _field_component(field, name, kind, label)
        if field.get("required"):
            component["@checks"] = [
                {"condition": _required_check(name), "message": f"{label} is required"}
            ]
            required.append(name)
        field_components.append(component)

    submit: dict[str, Any] = {
        "id": "form_submit",
        "component": "Button",
        "child": "form_submit_label",
        "variant": "primary",
        "action": {"event": {"name": submit_action}},
    }
    if required:
        condition = (
            _required_check(required[0])
            if len(required) == 1
            else {
                "@call": "and",
                "args": {"values": [_required_check(n) for n in required]},
            }
        )
        submit["@checks"] = [
            {"condition": condition, "message": "Complete the required fields"}
        ]
    buttons: list[dict[str, Any]] = []
    button_ids = []
    if cancel_label is not None:
        button_ids.append("form_cancel")
        buttons += [
            {
                "id": "form_cancel",
                "component": "Button",
                "child": "form_cancel_label",
                "action": {"event": {"name": cancel_action}},
            },
            {"id": "form_cancel_label", "component": "Text", "text": cancel_label},
        ]
    button_ids.append("form_submit")
    buttons += [
        submit,
        {"id": "form_submit_label", "component": "Text", "text": submit_label},
    ]

    children: list[str] = []
    components: list[dict[str, Any]] = [
        {"id": "root", "component": "Card", "child": "form_column"},
        {"id": "form_column", "component": "Column", "children": children},
    ]
    if title is not None:
        children.append("form_title")
        components.append(
            {"id": "form_title", "component": "Text", "text": f"### {title}"}
        )
    children += [component["id"] for component in field_components]
    children.append("form_actions")
    components += field_components
    components.append({
        "id": "form_actions",
        "component": "Row",
        "justify": "end",
        "children": button_ids,
    })
    components += buttons
    return [{
        "version": "1.0",
        "createSurface": {
            "surfaceId": surface_id,
            "catalogId": BASIC_CATALOG_ID,
            "components": components,
            "dataModel": data_model,
        },
    }]


def coerce_form_data(
    fields: Sequence[Mapping[str, Any]], data: Mapping[str, Any]
) -> dict[str, Any]:
    """Convert ``number`` fields, stored as text by A2UI, to numbers.

    Empty values become ``None``; text that is not a number raises an error.
    """
    result = dict(data)
    for field in fields:
        name = field.get("name")
        if field.get("type") != "number" or name not in result:
            continue
        value = result[name]
        if not isinstance(value, str):
            continue
        text = value.strip()
        if not text:
            result[name] = None
            continue
        number = float(text) if _DECIMAL.fullmatch(text) else math.nan
        if not math.isfinite(number):
            _fail(f'Field "{name}" is not a number')
        if number.is_integer() and abs(number) <= MAX_SAFE_INTEGER:
            number = int(number)
        result[name] = number
    return result


def a2ui_form_input(
    fields: Sequence[Mapping[str, Any]],
    *,
    prompt: str = "",
    input: Callable[[str], str] | None = None,  # noqa: A002 - tests replace the stdin call
    **options: Any,
) -> dict[str, Any]:
    """Show a simple form and return its data, with number fields as numbers.

    Accepts the :func:`a2ui_form` options. Raises :class:`A2UIInputCancelled`
    when the form is cancelled.
    """
    messages = a2ui_form(fields, **options)
    cancel_label = options.get("cancel_label", "Cancel")
    result = a2ui_input(
        messages,
        prompt=prompt,
        submit=(options.get("submit_action", "submit"),),
        cancel=()
        if cancel_label is None
        else (options.get("cancel_action", "cancel"),),
        input=input,
    )
    return coerce_form_data(fields, result["data"])
