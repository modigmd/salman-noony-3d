# سلمان ونوني

A minimal, mobile-first 3D baby viewer. Select سلمان to view the supplied model, drag to rotate, and pinch to zoom. Select نوني for “Coming soon.”

## Preview

Requires Node.js, with no package installation:

```sh
node preview.cjs
```

Open <http://127.0.0.1:8765/>.

## Website files

`dist/` is the complete static website, including the 3D model, Arabic font, and Three.js. It can be served by any static web host. `.openai/hosting.json` specifies the static output directory for Sites; no Sites project has been registered yet.

Third-party licenses are included with the font and viewer library.
