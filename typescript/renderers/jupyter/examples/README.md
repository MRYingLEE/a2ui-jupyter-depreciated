# JavaScript kernel examples

These notebooks correspond to the [Python examples](../../../../python/a2ui_jupyter/examples).
Use the JupyterLite JavaScript kernel `0.4.0-alpha.5` and a site that provides
anywidget 0.11. The stable JavaScript kernel 0.3.0 does not implement widget
communications.

Build the renderer from the repository root:

```bash
corepack yarn workspace @a2ui/jupyter build
```

Copy the notebooks into the site's contents. Host `kernel.js`, `widget.js`,
and `widget.css` from the renderer's `dist/` folder together at
`/files/a2ui/`, as in the
[JupyterLite demo](https://github.com/MRYingLEE/jupyterlite-demo). If the site
is deployed under a URL prefix, change the adapter URL in the first code cell
of each notebook to include that prefix. Select the JavaScript kernel and run
the cells in order.

The interactive notebooks use `onAction` or `onMessage` callbacks. A cell
cannot wait for a click in this kernel; use a later cell to inspect a stored
action. Each numbered notebook and the manual smoke test has the same filename
and behavior as its Python counterpart.
