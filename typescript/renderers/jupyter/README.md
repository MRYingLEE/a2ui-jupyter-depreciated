# A2UI Jupyter renderer

This workspace builds the browser widget and kernel adapter for the A2UI
Jupyter renderer. The renderer displays A2UI v1.0 surfaces in JupyterLab and
JupyterLite. Python and JavaScript kernel APIs are documented in the
[Python package README](../../../python/a2ui_jupyter/README.md) and this file.

## Installation

For Python kernels, install `a2ui-jupyter` as described in the
[Python package README](../../../python/a2ui_jupyter/README.md). The TypeScript
workspace is not a separately installed notebook package. For the JupyterLite
JavaScript kernel, build and host its adapter and widget assets as described
below.

## Build

From the repository root, build the widget and its workspace dependencies:

```bash
corepack yarn workspace @a2ui/jupyter build
```

The build writes `widget.js`, `widget.css`, and `kernel.js` to `dist/`. It also
copies the widget assets into the Python package. Build these assets before
building the Python distribution; generated files are not tracked in Git.

## Use in a notebook

The JavaScript kernel adapter mirrors the Python surface API, except it cannot
wait for user input:

```javascript
const {A2UISurface} = await import('/files/a2ui/kernel.js'); // adjust to your site
const surface = new A2UISurface();
display(surface);
surface.onAction(action => console.log(action));
surface.send(messages);
```

In this kernel, a running cell cannot receive widget messages. Use callbacks
such as `onAction` or read queued actions from a later cell with
`surface.takeAction()`. See [Kernel support](#kernel-support).

## Examples

The [JavaScript examples](./examples/) contain six numbered notebooks and a
manual smoke test. They correspond to the [Python notebooks](../../../python/a2ui_jupyter/examples/).
Open the notebooks from the JupyterLite site's contents, select the JavaScript
kernel, and run their cells in order. Change the adapter URL in the first cell
if the site does not serve it from `/files/a2ui/kernel.js`.

## Kernel support

The Python package supports IPython kernels according to the compatibility
table in the [Python package README](../../../python/a2ui_jupyter/README.md#kernel-support).
The JavaScript adapter targets the JupyterLite JavaScript kernel
`0.4.0-alpha.5` and an anywidget 0.11 frontend. It does not provide awaited
input methods; callbacks and later-cell queue reads are supported.

## JupyterLite

Host `kernel.js`, `widget.js`, and `widget.css` together on the JupyterLite
site. The JavaScript adapter imports the widget and stylesheet from URLs
relative to `kernel.js`. The site must provide anywidget 0.11, matching the
adapter's `~0.11.*` module version. See the [JavaScript examples README](./examples/README.md)
for setup and the [JupyterLite demo](https://github.com/MRYingLEE/jupyterlite-demo)
for deployment configuration and kernel smoke tests.

The Python package also runs in JupyterLite with supported Python kernels.
See the [Python package README](../../../python/a2ui_jupyter/README.md#jupyterlite)
for the xeus-python installation steps and kernel limitations.

## After the user submits

The browser widget hides a surface after an action whose name contains
`submit`. It shows the surface again when the agent sends `updateComponents`
or `createSurface` for it. Other actions do not hide the surface. See
[After the user submits](../../../python/a2ui_jupyter/README.md#after-the-user-submits)
for handling queued actions and example responses.

## Performance

Each widget loads a JavaScript bundle of about 900 KB. The Python README
documents message-log synchronization and saved widget state in
[Performance](../../../python/a2ui_jupyter/README.md#performance).

## Manual test

For the JavaScript kernel, build the assets, host them together on a JupyterLite
site, copy the example notebooks to its contents, and run
[`smoke_test.ipynb`](../../../python/a2ui_jupyter/examples/smoke_test.ipynb). The test
displays a surface, sends an action, and reads it in a later cell. The
[JupyterLite demo](https://github.com/MRYingLEE/jupyterlite-demo) contains a
browser smoke test. For a JupyterLab test with a Python kernel, see
[Manual test](../../../python/a2ui_jupyter/README.md#manual-test).

## Saved widget output

JupyterLite notebooks that save widget state retain the asset URLs, not copies
of the assets. The files must remain available at those URLs when a notebook is
reopened. See [Saved widget output](../../../python/a2ui_jupyter/README.md#saved-widget-output)
for the Python package's saved-state behavior.

## Tests

From the repository root:

```bash
corepack yarn workspace @a2ui/jupyter test
corepack yarn workspace @a2ui/jupyter typecheck
corepack yarn workspace @a2ui/jupyter lint
uv run pytest python/a2ui_jupyter/tests
```

The tests cover the widget bridge, built bundle, JavaScript adapter, and
notebook examples. The Python tests cover message validation and queue
behavior. The separate [JupyterLite demo](https://github.com/MRYingLEE/jupyterlite-demo)
contains deployment inputs and kernel smoke tests.
