# Adoption Brief — for Claude in other Univer projects (se-office, future apps)

**Paste this whole file into your Claude Code session when starting adoption of `se-univer-shared` in a new project.**

---

You're working in a Univer-based web app in the **sesurvey-ai** org (e.g. `se-office`). Another project (`se-report`) just finished adopting the **`se-univer-shared`** helper hub at https://github.com/sesurvey-ai/se-univer-shared. The same modules apply here — your project uses the same Univer + jsPDF + Sarabun + File-System-Access stack, just without the iSurvey fetch layer.

## Your task

Replace the inline equivalents of these 5 concerns with CDN-loaded calls into the shared modules. Refactor incrementally — one module per commit, test after each, only then move to the next.

## The 5 shared modules

| Module | Replaces what in your code |
|---|---|
| [`xlsx/thai-be.js`](./xlsx/thai-be.js) | Inline Thai BE date conversion for xlsx imports (text "dd/mm/yyyy" + Thai-encoded number serials) |
| [`print/preview.js`](./print/preview.js) | Inline popup `window.open` + `popup.print()` + popup-blocker fallback download for PDF blobs |
| [`print/page-setup.js`](./print/page-setup.js) | Inline Page Setup modal HTML + CSS + state mgmt + localStorage + (with v1.1.0+) live PDF preview pane |
| [`print/pdf-generator.js`](./print/pdf-generator.js) | Inline `loadJsPdfAssets()`, Sarabun font installer, `arrayBufferToBase64`, `splitColumnsForPages`, paper-size math |
| [`file-io/pickers.js`](./file-io/pickers.js) | Inline `pickFileViaInput`, `writeBlobToHandle`, `isStaleHandleError`, FSA-vs-fallback dispatch |

## How to load (pattern used in se-report)

Each module gets a lazy loader that follows the project's existing convention (`loadSheetJsAssets` / `loadUniverAssets`). Single-flight promise, throw on missing global, **pinned to a git commit SHA** (NOT a tag — jsDelivr takes 5-30 min to mirror new tags, but commit SHAs work immediately).

```js
const SE_UNIVER_SHARED_FOO_URL = 'https://cdn.jsdelivr.net/gh/sesurvey-ai/se-univer-shared@<COMMIT_SHA>/<path>';
const fooState = { loaded: false, loadingPromise: null };
function loadFooAssets() {
    if (fooState.loaded) return Promise.resolve();
    if (fooState.loadingPromise) return fooState.loadingPromise;
    fooState.loadingPromise = _loadUniverScript(SE_UNIVER_SHARED_FOO_URL).then(() => {
        if (!window.SeShared || !window.SeShared.foo || !window.SeShared.foo.bar) {
            throw new Error('SeShared.foo.bar global missing after script load');
        }
        fooState.loaded = true;
    });
    return fooState.loadingPromise.catch(err => { fooState.loadingPromise = null; throw err; });
}
```

**Current pinnable commit** = `34545b0` (which is v1.5.1 of the hub). Use that as `<COMMIT_SHA>` for all 5 modules. If the hub ships a newer release later, bump.

## Recommended adoption order (lowest → highest risk)

| Step | Module | Why this order |
|---|---|---|
| 1 | `file-io/pickers.js` | Surgical 3-function replacement (`pickFileViaInput`, `writeBlobToHandle`, `isStaleHandleError`). Easy win, low blast radius. |
| 2 | `print/preview.js` | Replace the popup-print logic in your PDF-export flow. ~40 lines of nuanced code → 1 call. |
| 3 | `print/pdf-generator.js` | Replace `loadJsPdfAssets` body + `arrayBufferToBase64` + `splitColumnsForPages`. The function names stay so callers don't change. |
| 4 | `xlsx/thai-be.js` | If your project handles xlsx imports with Thai BE dates, this is where formulas + dates render correctly without forking Univer. Call `SeShared.xlsx.thaiBe.applyToWorkbook(workbookData)` between SheetJS parse and Univer mount. |
| 5 | `print/page-setup.js` | Biggest refactor — removes the inline modal HTML (~175 lines) + CSS (~400 lines) + JS state mgmt + preview pipeline (~700 lines). The shared module's `init()` returns a control API; wire `onSave` to your existing print pipeline and `preview.generatePdf` to your inline PDF renderer. |

After step 5, the inline Page Setup code becomes dead but you can leave it for a separate cleanup commit so the working refactor commit stays focused.

## Per-module integration recipes

### file-io/pickers

```js
// Open
const r = await SeShared.fileIo.pickers.openFile({
    types: [{ description: '...', accept: { 'application/json': ['.json'], '...': ['.xlsx'] } }],
    accept: '.json,.xlsx',
});
if (r.cancelled) return;
processFile(r.file);  // r.handle is set when FSA picker was used

// Save
const r = await SeShared.fileIo.pickers.saveBlob(blob, {
    suggestedName: 'foo.xlsx',
    types: [{ description: 'Excel', accept: { '...': ['.xlsx'] } }],
});

// Re-save without prompting
try {
    await SeShared.fileIo.pickers.writeBlobToHandle(handle, blob);
} catch (err) {
    if (SeShared.fileIo.pickers.isStaleHandleError(err)) {
        // file moved/deleted — re-prompt with saveBlob
    } else throw err;
}
```

### print/preview

```js
// PDF blob → popup + auto-print + fallback download
SeShared.print.preview.printPdfBlob(pdfBlob, { filename: 'report.pdf' });

// Optional: Ctrl+P interceptor for canvas-based UIs
SeShared.print.preview.interceptPrintShortcut(() => myCustomPrintFn());
```

### print/pdf-generator

```js
// Lazy-load jsPDF + autoTable + Sarabun (~370KB, idempotent)
await SeShared.print.pdfGenerator.loadAssets();

// Now `new jsPDF()` has THSarabun (normal + bold) registered
const { jsPDF } = window.jspdf;
const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
doc.setFont('THSarabun', 'normal');
// ... your rendering

// Layout math from a page-setup state
const layout = SeShared.print.pdfGenerator.computePageLayout(pageSetupState);
// { paperWidthMm, paperHeightMm, marginsMm, printableArea }

// Wide-table pagination
const chunks = SeShared.print.pdfGenerator.splitColumnsForPages(widthsMm, printableWidthMm);
```

### xlsx/thai-be

```js
const wb = XLSX.read(buf, {
    type: 'array',
    sheetStubs: true,   // KEEP formula-only cells (default would drop them)
    cellNF: true,       // populate cell.z with resolved number format
});
const workbookData = yourExistingConverter(wb);

// Layer 4 in one call — converts text dates + Thai-encoded number serials,
// translates yyyy→bbbb so formula results render in BE year too
SeShared.xlsx.thaiBe.applyToWorkbook(workbookData);

univerAPI.createWorkbook(workbookData);
```

See `docs/XLSX_THAI_BE.md` in the hub for the full theory.

### print/page-setup

```js
// Lazy singleton
let _sharedPsInstance = null;
async function _ensurePs() {
    if (_sharedPsInstance) return _sharedPsInstance;
    await loadPageSetupAssets();
    _sharedPsInstance = SeShared.print.pageSetup.init({
        storageKey: 'my_app_page_setup',
        onSave: (state) => {
            // User clicked "ถัดไป" — fire your actual print pipeline
            myPrintWithState(state);
        },
        preview: {
            // Module debounces + caches; you just return a PDF Blob
            generatePdf: async (state) => {
                if (!hasMountedWorkbook()) return null;
                return await myPdfRenderer(state);  // returns Blob
            },
        },
    });
    return _sharedPsInstance;
}

async function openPageSetupModal() {
    const ps = await _ensurePs();
    ps.open({ state: loadFromLocalStorage(), scope: 'current' });
}

function closePageSetupModal() {
    if (_sharedPsInstance) _sharedPsInstance.close();
}
```

The shared module ships its own Thai-labelled HTML + CSS + state + PDF.js preview rendering. Your project's modal HTML + CSS + state mgmt becomes dead code after this step — delete it in a follow-up commit.

## Things to watch for

1. **jsDelivr tag lag** — `@v1.5.1` may 404 for 5-30 min after push; use `@<commit-sha>` instead. Confirmed pattern.
2. **Brave with FSA disabled** — `hasFileSystemAccess()` returns false; module's fallback (`<a download>` / `<input>`) handles it transparently.
3. **Page Setup live preview cache** — fixed in v1.1.1 of `print/page-setup` (clears on close so reopening rebuilds against current workbook data). Make sure you pin to `@34545b0` or newer.
4. **Module versions are per-module** — `xlsx/thai-be.js` is at 1.0.x while `print/pdf-generator.js` is at 1.0.0 etc. The hub-level git tag (v1.5.x) is the snapshot version; individual modules track their own.
5. **Don't fork modules locally** — patch upstream in `se-univer-shared` and bump pin. Local forks drift and lose bug fixes.

## What se-report did, line-by-line

If you want a concrete reference, look at se-report's `templates/index.html` after these commits:
- `97b7550` — file-io adoption (Phase 2b'' part 1)
- `ef5e499` — print/preview adoption (part 2)
- `65ac3b1` — print/pdf-generator adoption (part 3)
- `7309233` — print/page-setup adoption (part 4)
- `3777096` — cleanup commit removing ~1100 dead lines

Each commit message has a careful before/after explanation of what got replaced. Pull them up if a recipe above isn't enough.

## When you're done

Verify each integration in the browser before committing:
1. The relevant global is set (`window.SeShared.<category>.<name>`)
2. The functionality works end-to-end (open a file, generate a PDF, etc.)
3. No console errors about missing functions

Then push and let Dokploy auto-deploy. Test in production after ~2-5 min.

Good luck — most of the hard work is already in the shared modules, this is mostly plumbing.
