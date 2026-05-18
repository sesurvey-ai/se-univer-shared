# Print Preview Utilities

Module: [`print/preview.js`](../print/preview.js)
Namespace: `window.SeShared.print.preview`

Print-helper utilities for web apps — particularly **canvas-based UIs** (Univer, Konva, Fabric) where the browser's native `@media print` rules don't apply because content is drawn to `<canvas>` instead of the DOM.

## ปัญหาที่แก้

| ปัญหา | สาเหตุ | สิ่งที่ module แก้ |
|---|---|---|
| Ctrl+P พิมพ์ออกมาเป็นหน้าว่าง | Canvas-rendered apps (Univer/Konva) ไม่อยู่ใน printable DOM | `interceptPrintShortcut()` — route Ctrl+P ไปยัง custom handler ของคุณ |
| PDF print flow เปลือง 2 clicks | เปิด PDF ใน tab → user กด print เอง | `printPdfBlob()` — auto-fire print dialog หลัง popup load |
| Popup ถูก block | Browser block popup ตอน user gesture หมดอายุ | `printPdfBlob()` มี fallback download อัตโนมัติ |

## Quick Start

```html
<script src="https://cdn.jsdelivr.net/gh/sesurvey-ai/se-univer-shared@v1.1.0/print/preview.js"></script>

<script>
    // 1. Route Ctrl+P to your custom print flow (e.g. PDF generation)
    SeShared.print.preview.interceptPrintShortcut(() => {
        myCustomPrintFlow();
    });

    // 2. Inside your print flow: generate PDF → auto-print
    async function myCustomPrintFlow() {
        const pdfBlob = await generatePdf();
        SeShared.print.preview.printPdfBlob(pdfBlob, {
            filename: 'sheet_export.pdf',
        });
    }
</script>
```

## API

### `printPdfBlob(blob, opts?) → { success, method }`

Print a PDF blob. Opens it in a popup window and auto-triggers the print dialog. Falls back to a download if the popup is blocked.

**Arguments:**

| Name | Type | Default | Description |
|---|---|---|---|
| `blob` | `Blob` | required | PDF blob (e.g. from `jsPDF.output('blob')`) |
| `opts.filename` | `string` | `'document.pdf'` | Used for download fallback filename + popup window name |
| `opts.printDelay` | `number` | `300` | ms to wait after popup load before calling `print()` |
| `opts.urlRevokeDelay` | `number` | `60000` | ms before `URL.revokeObjectURL()` on the temp blob URL |

**Returns:** `{ success: boolean, method: 'popup' | 'download' }`

### `printPdfUrl(url, opts?) → { success, method }`

Like `printPdfBlob` but for an existing URL (you manage the blob lifecycle yourself).

**Arguments:** same as `printPdfBlob` plus:

| Name | Type | Default | Description |
|---|---|---|---|
| `opts.revokeUrlOnFinish` | `boolean` | `false` | If `true`, calls `URL.revokeObjectURL(url)` after `urlRevokeDelay` |

### `interceptPrintShortcut(handler) → uninstall`

Install a Ctrl+P / Cmd+P global handler. Returns a function you can call to remove it.

**Arguments:**

| Name | Type | Description |
|---|---|---|
| `handler` | `Function` | Invoked with the keyboard event when Ctrl+P (or Cmd+P) is pressed |

**Returns:** uninstall function

```js
const uninstall = SeShared.print.preview.interceptPrintShortcut((e) => {
    myCustomPrintFlow();
});

// Later: stop intercepting
uninstall();
```

## วิธีใช้กับ jsPDF

```js
async function exportAndPrintSheet() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    // ... draw content with doc.autoTable, doc.text, etc.

    const blob = doc.output('blob');
    const result = SeShared.print.preview.printPdfBlob(blob, {
        filename: `sheet_${Date.now()}.pdf`,
    });

    if (result.method === 'download') {
        console.warn('Popup was blocked — printed via download instead');
    }
}
```

## วิธีใช้กับ Univer

```js
// 1. Install Ctrl+P interceptor on app boot
SeShared.print.preview.interceptPrintShortcut(() => {
    printActiveView();
});

function printActiveView() {
    const activeView = getCurrentView();  // your view-tracking logic
    if (activeView === 'spreadsheet') {
        // Univer's canvas can't be scraped by @media print
        printSpreadsheetViaPdf();
    } else {
        // Regular DOM tables/lists — native @media print works
        window.print();
    }
}

async function printSpreadsheetViaPdf() {
    const blob = await renderUniverSheetToPdf();  // your jsPDF logic
    SeShared.print.preview.printPdfBlob(blob);
}
```

## Caveats

- **PDF viewer cross-frame restriction**: Chrome's embedded PDF viewer sometimes blocks `popup.print()` calls when the viewer iframe is cross-origin. The module catches the error and logs a warning — the user can still print manually via the viewer toolbar.
- **Popup permission**: First-time visitors may see Chrome's popup blocker. The fallback `<a download>` ensures they at least get the file.
- **Mobile Safari**: `window.print()` inside a popup may not show a print dialog on iOS — Safari prefers `share → print`. The module's behavior on mobile is best-effort.
- **Module does NOT generate PDFs**: that's your responsibility (jsPDF, pdfmake, html2canvas, etc.). This module handles only the **delivery** to the print dialog.

## License

MIT
