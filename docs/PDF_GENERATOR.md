# PDF Generator Helpers (jsPDF + Sarabun + Layout Math)

Module: [`print/pdf-generator.js`](../print/pdf-generator.js)
Namespace: `window.SeShared.print.pdfGenerator`

Boilerplate-eliminator for projects that want to generate PDFs with jsPDF + Thai (Sarabun) font support. Provides:

1. **Lazy-load jsPDF + autoTable + Sarabun TTFs** (one async call, idempotent)
2. **Auto-install Thai font** into every `new jsPDF()` instance
3. **Layout math** — paper dimensions, printable area, scaling, column splitting
4. **Pure utilities** — `arrayBufferToBase64`, `paperToOrientedMm`

## ทำไมต้องมี module นี้

ทุก project ที่อยาก print PDF ภาษาไทยจาก web app ทำขั้นตอนเหมือนกัน:

1. Lazy-load jsPDF จาก CDN (~150KB)
2. Lazy-load jspdf-autotable (~80KB)
3. Fetch 2 TTF ของ Sarabun (~140KB)
4. Convert TTF → base64 (chunked, ระวัง stack overflow)
5. Install ผ่าน `jsPDF.API.events.push(['addFonts', ...])`

Module นี้ encapsulate ขั้นตอนพวกนี้เป็น 1 บรรทัด:

```js
await SeShared.print.pdfGenerator.loadAssets();
// jsPDF + Sarabun พร้อมใช้แล้ว
```

แล้วบวกกับ **layout math** ที่ทำงานคู่กับ [Page Setup state schema](PAGE_SETUP.md) — ทำให้ render PDF ง่ายขึ้นมาก

## ที่ Module **ไม่** ทำให้

- ❌ Render data ของคุณเป็น PDF (เพราะ data shape ต่างกันทุก project)
- ❌ Bundle jsPDF/Sarabun (lazy-fetch จาก CDN ครั้งแรกที่เรียก `loadAssets()`)
- ❌ Header/footer text rendering (project-specific data)
- ❌ Cell-style → autoTable styling translation (depends on source format)

Consumer ยัง implement actual draw calls — module นี้แค่ตัด boilerplate ออก

## Quick Start

```html
<script src="https://cdn.jsdelivr.net/gh/sesurvey-ai/se-univer-shared@v1.3.0/print/pdf-generator.js"></script>

<script>
async function exportToPdf() {
    // Lazy-load assets (~370KB first time, cached after)
    await SeShared.print.pdfGenerator.loadAssets();

    // Create a Thai-ready jsPDF instance
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4',
    });
    doc.setFont('THSarabun', 'normal');
    doc.setFontSize(14);
    doc.text('สวัสดี — ใบส่งของเลขที่ 1001', 20, 20);

    // autoTable is registered globally — works out of the box
    doc.autoTable({
        startY: 30,
        head: [['คอลัมน์ A', 'คอลัมน์ B']],
        body: [['ค่า 1', 'ค่า 2'], ['ค่า 3', 'ค่า 4']],
        styles: { font: 'THSarabun', fontSize: 11 },
    });

    return doc.output('blob');
}
</script>
```

## Pairing กับ Page Setup

`print/pdf-generator.js` ทำงานคู่กับ [`print/page-setup.js`](PAGE_SETUP.md) — state schema เดียวกัน:

```js
const ps = SeShared.print.pageSetup.init({
    onSave: async (state) => {
        // Compute layout from the page-setup state
        const layout = SeShared.print.pdfGenerator.computePageLayout(state);
        // → { paperWidthMm, paperHeightMm, marginsMm, printableArea }

        // Create jsPDF with the right paper/orientation
        await SeShared.print.pdfGenerator.loadAssets();
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({
            orientation: state.orientation,
            unit: 'mm',
            format: state.paperSize,
        });

        // ...render content inside layout.printableArea...

        const blob = doc.output('blob');
        SeShared.print.preview.printPdfBlob(blob);
    },
});
```

## API

### `loadAssets(opts?) → Promise<void>`

Lazy-load jsPDF, autoTable, and Sarabun fonts. Idempotent.

| Opt | Default | Description |
|---|---|---|
| `opts.fontFamily` | `'THSarabun'` | Name used to register fonts (e.g. `doc.setFont('THSarabun', 'normal')`) |

### `preloadAssets(opts?)`

Fire-and-forget version. Call when you can predict the user will print soon (e.g. they opened the print-eligible view) — avoids the "popup blocked because gesture expired" problem when the CDN fetch happens inside the click handler.

### `isReady() → boolean`

`true` if `loadAssets()` has finished successfully at least once.

### `paperToOrientedMm(paperSize, orientation) → { w, h }`

Get paper dimensions in mm.

```js
paperToOrientedMm('a4', 'portrait')   // → { w: 210, h: 297 }
paperToOrientedMm('a4', 'landscape')  // → { w: 297, h: 210 }
paperToOrientedMm('letter', 'portrait')  // → { w: 215.9, h: 279.4 }
```

### `computePrintableArea(pageSetupState) → { x, y, w, h }`

Returns the printable area in mm — what's left after applying margins.

```js
computePrintableArea({
    paperSize: 'a4', orientation: 'landscape',
    marginTop: 19, marginBottom: 19, marginLeft: 18, marginRight: 18,
})
// → { x: 18, y: 19, w: 261, h: 172 }
```

### `computeScaleFactor(pageSetupState, contentDims, printableArea) → { x, y }`

Computes scale factors per axis based on the `scaling` setting (`'full'` / `'fit'` / `'percent'`).

```js
const printable = computePrintableArea(state);
const scale = computeScaleFactor(state,
    { totalContentWidthMm: 350, totalContentHeightMm: 200 },
    printable);
// → { x: 0.745..., y: 0.745... } when scaling='fit' fitWide=1 fitTall=1
```

### `computePageLayout(pageSetupState) → layout`

Convenience: combines `paperToOrientedMm` + `computePrintableArea` into one call.

```js
computePageLayout({
    paperSize: 'a4', orientation: 'landscape',
    marginTop: 19, marginBottom: 19, marginLeft: 18, marginRight: 18,
})
// → {
//     paperWidthMm: 297, paperHeightMm: 210,
//     marginsMm: { top: 19, bottom: 19, left: 18, right: 18 },
//     printableArea: { x: 18, y: 19, w: 261, h: 172 },
//   }
```

### `splitColumnsForPages(widthsMm, printableWidthMm) → number[][]`

Splits column widths into chunks that each fit a page. Useful for wide tables that need horizontal pagination.

```js
splitColumnsForPages([50, 50, 50, 50, 50], 110)
// → [[0, 1], [2, 3], [4]]
//    page 1 has cols 0+1, page 2 has cols 2+3, page 3 has col 4

splitColumnsForPages([100, 100], 250)
// → [[0, 1]]  // fits on one page
```

Includes a 0.5mm slack to absorb floating-point spillover from scale calculations.

### `arrayBufferToBase64(buffer) → string`

Chunked conversion (won't blow the stack on big TTFs).

### Constants

```js
SeShared.print.pdfGenerator.PAPER_SIZES_MM
// {
//     a3:     { w: 297, h: 420 },
//     a4:     { w: 210, h: 297 },
//     a5:     { w: 148, h: 210 },
//     letter: { w: 215.9, h: 279.4 },
//     legal:  { w: 215.9, h: 355.6 },
// }

SeShared.print.pdfGenerator.DEFAULT_FONT_FAMILY  // 'THSarabun'

SeShared.print.pdfGenerator.URLS  // CDN URLs (for mirroring / version-pinning)
```

## Full Print Flow with All 3 Modules

```html
<script src="https://cdn.jsdelivr.net/gh/sesurvey-ai/se-univer-shared@v1.3.0/print/preview.js"></script>
<script src="https://cdn.jsdelivr.net/gh/sesurvey-ai/se-univer-shared@v1.3.0/print/page-setup.js"></script>
<script src="https://cdn.jsdelivr.net/gh/sesurvey-ai/se-univer-shared@v1.3.0/print/pdf-generator.js"></script>

<script>
// 1. Preload assets when user enters print-eligible view
SeShared.print.pdfGenerator.preloadAssets();

// 2. Page Setup modal → on save, generate PDF and trigger print dialog
const ps = SeShared.print.pageSetup.init({
    onSave: async (state) => {
        await SeShared.print.pdfGenerator.loadAssets();
        const layout = SeShared.print.pdfGenerator.computePageLayout(state);

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({
            orientation: state.orientation,
            unit: 'mm',
            format: state.paperSize,
        });
        doc.setFont('THSarabun', 'normal');
        // ... render your content using layout.printableArea ...
        const blob = doc.output('blob');

        SeShared.print.preview.printPdfBlob(blob, { filename: 'report.pdf' });
    },
});

// 3. Ctrl+P → open Page Setup
SeShared.print.preview.interceptPrintShortcut(() => ps.open());
</script>
```

## Versioning Notes

- **jsPDF and Sarabun are pinned** to known-good versions inside this module's `URLS` constant.
- To override (mirror, version bump), modify `URLS.*` before calling `loadAssets()`:
  ```js
  SeShared.print.pdfGenerator.URLS.jspdf = 'https://my-mirror.example.com/jspdf.js';
  await SeShared.print.pdfGenerator.loadAssets();
  ```

## License

MIT
