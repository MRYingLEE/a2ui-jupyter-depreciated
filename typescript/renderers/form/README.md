# @a2ui/form

Renders an A2UI v1.0 surface as a one-shot form and ends it with the form's own
action buttons. Used by the Jupyter "feature enriched input" stdin bridge, and
designed for reuse by enriched output.

## Entry points

- `@a2ui/form` (`dist/form.js`, bundles React and the A2UI renderer):
  `mountA2uiForm(element, messages, {submit, cancel, onAction})` returns
  `{result, data(), cancel(), dispose()}`. `result` resolves with
  `{status: 'submitted', action, context, data}` when a submit action is
  raised, or `{status: 'cancelled'}`. It rejects when the messages cannot be
  rendered. `data` is the surface data model.
- `@a2ui/form/kernel` (`dist/kernel.js`, dependency-free): the stdin protocol
  codec and the form builder.

## Stdin protocol v1

The kernel calls its normal `input()` with the prompt
`jupyterlite-a2ui-input:v1:` + JSON:

```json
{"messages": [...], "prompt": "", "submit": ["submit"], "cancel": ["cancel"]}
```

- `messages`: 1–256 A2UI v1.0 messages for a single surface. The first, and
  only the first, is `createSurface`; `deleteSurface` is not allowed.
- `submit`: 1–16 action names that end the form with its data. `cancel`: 0–16
  action names that cancel it. The lists are disjoint.
- The request is at most 256 KiB.

The frontend replies with one of:

```json
{"status": "ok", "action": "submit", "context": {}, "data": {}}
{"status": "cancelled"}
{"status": "error", "code": "render_failed"}
```

Replies are at most 64 KiB and 16 levels deep. Other actions are not sent to
the kernel.

## Form builder

`a2uiForm(fields, options)` builds a single `createSurface` message for a card
with one component per field and Cancel/Submit buttons. Field types: `text`,
`longText`, `password`, `number`, `checkbox`, `choice`, `multiChoice`,
`slider`, `date`, `time`, `datetime`. `required: true` adds checks that also
disable the submit button. A2UI text fields store numbers as text, so
`coerceA2uiFormData(fields, data)` converts `number` fields.

The Python (`a2ui-form`), R (hera) and JavaScript kernel helpers produce the
same messages; `tests/fixtures/form-builder.json` pins the output for all of
them.
