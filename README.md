# se-univer-shared

Shared helpers/utilities for [Univer](https://univer.ai)-based projects across the **sesurvey-ai** organization.

Modules are designed to be **drop-in** via [jsDelivr CDN](https://www.jsdelivr.com/) — no build step, no npm install required.

## Available Modules

| Path | Namespace | Purpose |
|---|---|---|
| [`xlsx/thai-be.js`](xlsx/thai-be.js) | `SeShared.xlsx.thaiBe` | Convert Thai Buddhist Era dates (text + Excel-encoded serials) when importing xlsx into Univer |
| [`print/preview.js`](print/preview.js) | `SeShared.print.preview` | Print PDF blobs via popup + auto-print, Ctrl+P interceptor for canvas-based UIs |
| [`print/page-setup.js`](print/page-setup.js) | `SeShared.print.pageSetup` | Drop-in Page Setup modal (Thai UI) — paper/orientation/margins/scaling/print-titles/print-area + localStorage |

More modules to be added as common patterns emerge (file I/O, UI components, etc).

## Quick Start

```html
<!-- Load specific module(s) you need -->
<script src="https://cdn.jsdelivr.net/gh/sesurvey-ai/se-univer-shared@v1.2.0/xlsx/thai-be.js"></script>

<script>
    // Each module attaches to window.SeShared.<category>.<name>
    SeShared.xlsx.thaiBe.applyToWorkbook(workbookData);
</script>
```

## Versioning

- **Pin to a specific tag** for production stability:
  `cdn.jsdelivr.net/gh/sesurvey-ai/se-univer-shared@v1.2.0/...`
- **Pin to a branch** for auto-updates (jsDelivr caches ~24h):
  `cdn.jsdelivr.net/gh/sesurvey-ai/se-univer-shared@main/...`

Follows [SemVer](https://semver.org/): bumping major = breaking API; minor = additive features; patch = bug fixes.

## Repository Layout

```
se-univer-shared/
├── xlsx/                 ← Excel-specific modules
├── docx/                 ← Word-specific modules (future)
├── print/                ← Print/preview helpers (future)
├── file-io/              ← Save/Open helpers (future)
├── core/                 ← Pure utilities shared across modules (future)
├── ui/                   ← Reusable UI components (future)
└── docs/                 ← Per-module documentation
```

## Contributing

This is an internal sesurvey-ai library. To add a feature:

1. Identify the right category folder (or create one if new domain)
2. Add module file using kebab-case name (e.g. `xlsx/new-thing.js`)
3. Attach API to `SeShared.<category>.<camelCaseName>`
4. Write `docs/<UPPER_SNAKE_NAME>.md` explaining the module
5. Update this README's "Available Modules" table
6. Bump version + tag (`v1.x.0` for new feature, `v1.0.x` for bug fix)

**Module design rules:**

- **No project-specific glue** — module must be pure / accept dependencies as parameters
- **Document every public function** with JSDoc
- **Test in plain Node** when possible (no DOM required)
- **No external runtime deps** beyond what the consuming project already loads (e.g. SheetJS, Univer)

## License

MIT — see [LICENSE](LICENSE)
