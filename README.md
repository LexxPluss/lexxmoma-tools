# LexxMoMa Tools

Static site that collects the LexxMoMa evaluation tools, published with GitHub Pages.
Everything under `site/` is served as-is (no build step).

## Layout

```
site/                      ← published root (https://<org>.github.io/<repo>/)
├ index.html               ← landing page (edit the TOOLS array to add/change a tool)
├ 404.html
├ .nojekyll
├ assets/                  ← logo, favicon, analytics (track.js), shared theme + header (theme.js)
├ library/                 ← LexxMoMa Tour
├ simulator/               ← Motion Simulator (2D)
├ process-sketch/          ← Process Sketch (beta)
├ lexxmoma-roi/            ← ROI Calculator
├ robot-sier-map/          ← Robot SIer Database
└ members/factory-map/     ← Factory Map (internal, encrypted data)
.github/workflows/pages.yml ← deploys site/ on push to main
```

## Preview locally

```sh
python3 -m http.server 8000 -d site
```

Open http://localhost:8000/. Use a local server rather than opening `index.html` directly
(`file://` blocks some features, e.g. the Factory Map's encrypted data loading).

## Publishing

Pushing changes under `site/` to `main` runs `.github/workflows/pages.yml`, which uploads `site/`
and deploys it. It can also be run manually from the Actions tab.

One-time repo setup: **Settings → Pages → Build and deployment → Source = "GitHub Actions"**.

## Updating tools

This repository is the source of truth for all tools. Edit files under `site/` directly and open a PR;
do not copy in packages (zip) from elsewhere.

- **ROI Calculator** and **Process Sketch** are built: edit `src/`, then run `python3 build.py` in
  `site/lexxmoma-roi/` or `site/process-sketch/` and commit both `src/` and `dist/`.
  CI fails if `dist/` does not match `src/`.
- Tests: `node site/lexxmoma-roi/test/calc.test.js`, `node site/process-sketch/test/continuity.test.cjs`.
- **Factory Map** data (`members/factory-map/data.enc.*`) is encrypted by the tools team's internal build;
  only replace those two files, never commit plaintext data.
- Keep each file's line endings (several tool files use CRLF).
- Never commit internal-only content (`internal/`, `safety-navi/`, `crx-eoat-tool/`, SIer `scripts/` and `data/raw/`).
  `.gitignore` blocks them and CI refuses to deploy if they appear.

## Shared theme and header (`site/assets/theme.js`)

Every page loads it in `<head>` before CSS (404 copies the styles inline).

- Light by default; the toggle `<button class="lx-theme-btn" data-lx-theme-toggle>` switches to dark and the choice
  is shared by all pages (`localStorage["lx_theme"]`). Style dark mode with `:root[data-theme="dark"]`.
- Header (ROI Calculator style): `.lx-hdr` > `.lx-title` > `a.lx-brand` (`img.lx-logo` + `.lx-wordmark`) + `.lx-tool`.
  The logo always links back to the landing page.

## Adding a tool to the landing page

Add one entry to `TOOLS` in `site/index.html`:

| field | meaning |
|---|---|
| `status` | `web` (live), `beta`, `soon`, `plan`, `internal` |
| `href` | relative path under `site/` (omit for `soon` / `plan`) |
| `phase` | evaluation stages, e.g. `["検討","設計"]` |
| `desc`, `points` | short description and optional bullet list |

Put the analytics tag before the tool's `</body>`: `<script src="../assets/track.js" data-tool="<id>"></script>`.
