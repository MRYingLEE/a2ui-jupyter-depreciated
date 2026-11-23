# JavaScript kernel examples

These notebooks correspond to the [Python examples](../../../../python/a2ui_jupyter/examples).
Use the JupyterLite JavaScript kernel `0.4.0-alpha.5` and a site that provides
anywidget 0.11. The stable JavaScript kernel 0.3.0 does not implement widget
communications.

Build the renderer from the repository root:

```bash
corepack yarn workspace @a2ui/jupyter build
```

Copy the notebooks into the site's contents. Put `kernel.js`, `widget.js`,
and `widget.css` from the renderer's `dist/` folder in the site's `content/a2ui/`
directory, as in the
[JupyterLite demo](https://github.com/MRYingLEE/a2ui-jupyterlite-demo/tree/jupyter-js-kernel).
JupyterLite serves those files under `files/a2ui/` relative to the site, and
the notebooks resolve that path even when the site has a URL prefix. Select
the JavaScript kernel and run the cells in order.

The interactive notebooks use `onAction` or `onMessage` callbacks. A cell
cannot wait for a click in this kernel; use a later cell to inspect a stored
action. Each numbered notebook and the smoke test has the same filename
and behavior as its Python counterpart.
