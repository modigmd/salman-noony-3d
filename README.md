# سلمان ونوني

A minimal, mobile-first 3D baby viewer. Select سلمان to view the supplied model, drag to rotate, and pinch to zoom. His cheeks lag and wobble with rotation, then settle; zoom does not trigger the effect. The added cheek motion respects the device's reduced-motion preference. Select نوني for “Coming soon.”

Live website: <https://modigmd.github.io/salman-noony-3d/>

GitHub Pages publishes the root of the `gh-pages` branch. To publish updated files from `dist/`:

```sh
git add dist
git commit -m "Update website"
git push origin main
git subtree push --prefix=dist origin gh-pages
```

## Preview

Requires Node.js, with no package installation:

```sh
node preview.cjs
```

Open <http://127.0.0.1:8765/>.

## Cheek verification

Run `node --test tests/cheek-physics.test.mjs` for the spring and mask checks.
Run `node tests/check-cheek-render.cjs`, then open <http://127.0.0.1:8766/tests/cheek-render.html> for GPU, frame-rate, and equal-camera front/side comparisons. “Run checks” reports results; “Save views” writes PNGs to the ignored `qa/` directory. The fixtures and their test-only inspection state are outside the published `dist/` directory.
Open <http://127.0.0.1:8766/tests/production-check.html> and run the integration checks for the actual viewer's input and lifecycle handlers in a mobile-size frame.

## Website files

`dist/` is the complete static website, including the 3D model, Arabic font, and Three.js. It can be served by any static web host. `.openai/hosting.json` specifies the static output directory for Sites; no Sites project has been registered yet.

Third-party licenses are included with the font and viewer library.
