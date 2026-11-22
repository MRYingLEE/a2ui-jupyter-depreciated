# a2ui-form

Ask for feedback with an A2UI form over Jupyter stdin. The frontend renders the
form inline in the cell output and returns its data when the form's submit
button is pressed. It needs a frontend with the A2UI stdin bridge (the
experimental enriched input build of `jupyterlab_widgets`); see
`typescript/renderers/form/README.md` for the protocol.

```python
from a2ui_form import a2ui_form_input, A2UIInputCancelled

try:
    answer = a2ui_form_input(
        [
            {"name": "name", "label": "Name", "required": True},
            {"name": "age", "type": "number", "label": "Age"},
            {"name": "color", "type": "choice", "options": ["red", "green"]},
        ],
        title="Tell us about you",
    )
except A2UIInputCancelled:
    answer = None
```

Use `a2ui_input(messages, submit=[...], cancel=[...])` to show arbitrary A2UI
v1.0 messages; it returns `{"action", "context", "data"}`. `a2ui_form(fields)`
returns the messages that `a2ui_form_input` shows.

The package has no dependencies and works in Pyodide and xeus-python.
