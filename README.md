# Daiblos Spine Observatory

A responsive, browser-based Spine 3.8 viewer for the assets published in
[bungaku-moe/DaiblosCoreAssets](https://github.com/bungaku-moe/DaiblosCoreAssets).

**[Open the live viewer](https://h0nok4.github.io/DBLive2DViewer/)**

The viewer organizes the upstream files into a searchable character and CG library, then combines each main skeleton with its matching Effect layers. The interface is available in English and Simplified Chinese and remembers the selected language.

## Highlights

- Browse 131 characters and 75 CG entries from a generated asset manifest.
- Switch character skins or CG scenes without leaving the current entry.
- Load from a local asset checkout first and fall back to GitHub-hosted assets automatically.
- Merge matching background and foreground Effect skeletons into the main scene.
- Inspect animations, skeleton skins, slots, attachments, and live render layers.
- Search layers and hide individual slots or complete skeleton groups.
- Extract stable visual snapshots from state-style animations, including multi-color outfit states, without relying on an animation's final reset frame.
- Preserve Idle underneath partial overlay actions to avoid frozen bones and duplicate attachments.
- Detect overlapping character forms and hide inactive variants during playback.
- Correct common atlas size, premultiplied-alpha, mipmap, and texture-edge issues found in the source files.
- Share the selected model, animation, and visual states through the page URL.
- Drag, zoom, flip, pause, change playback speed, inspect skeleton debug data, and enter fullscreen.

## Quick start

Requirements: a current Node.js release and npm.

```bash
git clone https://github.com/H0nok4/DBLive2DViewer.git
cd DBLive2DViewer
npm install
npm run dev
```

Open <http://127.0.0.1:4173/>.

The development server can run without a local asset checkout. Missing files are requested on demand from the upstream GitHub repository.

## Download the complete asset repository

For faster and more reliable local browsing, synchronize the complete upstream asset set:

```bash
npm run assets:sync
```

This command creates `DaiblosCoreAssets/` in the project root. The directory is ignored by Git, so the multi-gigabyte asset set is not committed to this repository.

The synchronizer:

1. Creates or updates a lightweight Git checkout of the upstream repository.
2. Downloads and verifies asset files in parallel.
3. Resumes incomplete downloads by skipping files that already match their expected size.
4. Regenerates the grouped character and CG manifest.

When local files are available, the header reports `LOCAL DISK`. Otherwise the viewer reports `REMOTE` and uses the hosted fallback.

## Build and preview

```bash
npm run build
npm run preview
```

The production output is written to `dist/`.

## Refresh the asset manifest

After the upstream repository adds or renames models, run:

```bash
npm run generate:manifest
```

The generator reads the GitHub tree and rewrites `src/data/assets.generated.json`, grouping Break models as character skins and matching Effect models with their main variant.

## Deploy to GitHub Pages

The Vite build uses a relative base path and can be hosted from a project subdirectory. To build and publish `dist/` to the `gh-pages` branch:

```bash
npm run deploy
```

Configure the repository's Pages source to deploy from the root of the `gh-pages` branch.

The deployed site does not include the local asset checkout. Models are fetched on demand from [DaiblosCoreAssets](https://github.com/bungaku-moe/DaiblosCoreAssets), keeping this viewer repository and its deployment small.

## Project structure

```text
src/
├── components/          Viewer, controls, and layer inspector
├── data/                Generated asset manifest
├── lib/                 Asset URLs and Spine/atlas loading
├── i18n.tsx             English and Simplified Chinese UI strings
├── App.tsx              Library and control-deck composition
└── styles.css           Responsive application styling
scripts/                 Asset synchronization and manifest generation
```

## Asset notice

This project provides an index and preview interface only. Game assets are loaded from the upstream repository and remain the property of their respective rights holders. Follow the upstream repository's terms and all applicable rights-holder requirements when using them.
