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

"""Ask for feedback with an A2UI form over Jupyter stdin.

The frontend renders the form inline and returns its data model when one of the
form's submit actions is raised. This needs a frontend that understands the
``jupyterlite-a2ui-input:v1:`` stdin protocol.
"""

from ._form import (
    BASIC_CATALOG_ID,
    FIELD_TYPES,
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

__all__ = [
    "BASIC_CATALOG_ID",
    "FIELD_TYPES",
    "MARKER",
    "A2UIInputCancelled",
    "A2UIInputError",
    "a2ui_form",
    "a2ui_form_input",
    "a2ui_input",
    "coerce_form_data",
    "create_request",
    "decode_reply",
]
