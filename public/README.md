# Andamio Credential Demo

This is an interactive, client-side sandbox for designing and previewing Andamio credentials.

It provides a visualizer that allows users to preview changes to module titles, cryptographic hashes, and visual themes.

## Architecture

The demo is a pure static web application (`HTML` / `CSS` / `Vanilla JS`). It does not require a backend or a Python runtime.
* `generator.js` is a direct JavaScript port of the core ring-geometry logic found in `generator/gen.py`.
* `app.js` manages state and re-renders the SVG to the DOM on every input change.
* `assets/courses.json` holds a snapshot of real, on-chain credential metadata for the dice functionality.

## Tradeoffs: JS Port vs. Python Generator

While this client-side JS port is incredibly fast and perfect for a UI/UX sandbox, it is strictly a **visual presentation tool** and can not be used to mint production badges. 

Here is exactly what was ported to the JavaScript generator and what was intentionally left out:

| Feature / Logic | Python (`gen.py`) | JavaScript (`generator.js`) |
| :--- | :---: | :---: |
| **Proof-Ring Geometry (Math)** | ✅ | ✅ |
| **Color Palettes & Token Mapping** | ✅ | ✅ |
| **Responsive Text Wrapping** | ✅ | ✅ |
| **Light/Dark Interior Theme Toggle** | ✅ | ✅ |
| **Fonts served first-party (no third-party requests)** | ✅ | ✅ *(page-level, `styles/badge_fonts.css`)* |
| **W3C OB3 JSON-LD Metadata Injection** | ✅ | ❌ |
| **Fonts embedded in the SVG itself (self-contained file)** | ✅ | ❌ |


> **NB:**
>
> `generator/gen.py` is canon for two reasons:
>
> 1. **Missing Cryptographic Proof (OB3 Metadata):** 
   The JS port only outputs the visual SVG geometry. The Python generator constructs a full W3C Verifiable Credential (Open Badges 3.0 standard) and permanently bakes it into hidden `<metadata>` and `<openbadges:credential>` tags inside the SVG. An SVG saved from this web demo contains no verifiable schema or identity data.
>   
> 2. **Fonts live on the page, not in the SVG:**
   The designer serves its fonts from this host: `styles/badge_fonts.css` is a byte copy of `generator/fonts.css` (the Archivo / Spline Sans Mono faces every badge embeds; `make designer-fonts` regenerates it and CI pins them equal), and `styles/fonts.css` carries Outfit for the UI (`python3 generator/embed_fonts.py designer`). The preview SVG carries no `@font-face` of its own, so an SVG lifted out of the page falls back to system fonts. The Python generator injects the faces into every SVG, so its output is self-contained in any environment.

## Possibilities in the Future

Despite these tradeoffs, it is possible to implement the Python generator:

* **WASM Integration:** We could compile the Python generator to WebAssembly. This would allow the browser to generate the true, fully compliant, offline-ready OB3 SVG artifact instantly on the client side without needing a server.
* **API Backend:** We could refactor this frontend to send its state to a lightweight Python backend API, displaying a fast preview via JS but utilizing the Python server to download the "Official" badge.
