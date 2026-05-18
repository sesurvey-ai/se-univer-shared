# Page Setup Modal

Module: [`print/page-setup.js`](../print/page-setup.js)
Namespace: `window.SeShared.print.pageSetup`

Drop-in **modal UI + state management** for print page setup — paper size, orientation, margins, scaling, header/footer, print titles, print area. Consumer wires up their own PDF preview rendering + actual print execution via callbacks.

## ทำไมต้องมี module นี้

Univer (และ canvas-based UI อื่นๆ) ไม่มี Page Setup modal built-in ที่ใช้งานได้กับ Thai UX (ภาษาไทย, margin presets ที่คุ้นเคย, BE-friendly defaults) ผู้ใช้ที่มาจาก Office/Excel คาดหวัง UI แบบเดิม

Module นี้:
- ✅ inject HTML + CSS เข้า page อัตโนมัติ (idempotent)
- ✅ manage state + localStorage persistence
- ✅ Thai labels พร้อมใช้
- ✅ Margin/scaling presets เหมือน Excel
- ✅ Print Titles (rows/cols ซ้ำ) + Print Area
- ✅ Responsive (มือถือ stack แนวตั้ง)
- ❌ **ไม่มี** PDF preview rendering (consumer ใส่ผ่าน callback)
- ❌ **ไม่มี** actual print execution (consumer ใส่ผ่าน callback)

แยก scope ทำให้ใช้ได้กับ project ที่ใช้ jsPDF, pdfmake, html2canvas, หรืออะไรก็ตาม

## Quick Start

```html
<script src="https://cdn.jsdelivr.net/gh/sesurvey-ai/se-univer-shared@v1.2.0/print/page-setup.js"></script>

<script>
const ps = SeShared.print.pageSetup.init({
    storageKey: 'my_app_page_setup',
    onSave: async (state) => {
        // user pressed "ถัดไป" — state has paperSize, orientation,
        // margins (mm), scaling, repeatRow/Col, printArea, etc.
        const pdfBlob = await myPdfGenerator(state);
        // hand off to print/preview module (or your own):
        SeShared.print.preview.printPdfBlob(pdfBlob);
    },
});

// Open modal from a button click / Ctrl+P intercept:
document.getElementById('myPrintBtn').addEventListener('click', () => ps.open());
</script>
```

## State Schema

```js
{
    paperSize: 'a4' | 'a3' | 'a5' | 'letter' | 'legal',
    orientation: 'portrait' | 'landscape',
    marginTop:    number,  // mm (default 19)
    marginBottom: number,  // mm
    marginLeft:   number,  // mm
    marginRight:  number,  // mm
    header: boolean,
    footer: boolean,
    scaling: 'full' | 'fit' | 'percent',
    fitWide:  number,  // pages wide (only when scaling='fit')
    fitTall:  number,  // pages tall (only when scaling='fit'; 0 = unlimited)
    scalePercent: number,  // 10..400 (only when scaling='percent')
    repeatRowStart: number,  // 1-based row, 0 = no repeat
    repeatRowEnd:   number,
    repeatColStart: number,  // 1-based col, 0 = no repeat
    repeatColEnd:   number,
    printArea: string,  // A1-style like "A1:G100", '' = entire sheet
    blackAndWhite: boolean,
}
```

## API

### `init(opts) → control`

Inject modal markup + CSS into the page. Returns a control object.

| Opt | Type | Default | Description |
|---|---|---|---|
| `storageKey` | `string` | `'se_page_setup_v1'` | localStorage key for state persistence |
| `container` | `HTMLElement` | `document.body` | Where to append the modal overlay |
| `onSave` | `Function` | — | `(state) => void` called when user clicks "ถัดไป" |
| `onReset` | `Function` | — | `() => void` called when user clicks "รีเซ็ตค่าเริ่มต้น" |
| `onClose` | `Function` | — | `() => void` called whenever modal closes (any reason) |

### `control.open(openOpts?)`

Show the modal.

| Opt | Default | Description |
|---|---|---|
| `openOpts.state` | (load from storage) | Pre-fill the form with this state |
| `openOpts.scope` | `'current'` | Initial "พิมพ์" dropdown value: `'current'` or `'selection'` |

### `control.close()`

Hide the modal.

### `control.getState() → state`

Read live form values (not persisted) and return as state object.

### `control.setState(state)`

Overwrite the form with the given state (merged over defaults).

### `control.loadFromStorage()`

Re-seed the form from localStorage.

### `control.saveToStorage()`

Persist current form values to localStorage.

### `control.getOverlayEl() → HTMLElement`

Direct access to the modal overlay element — useful for adding custom event listeners or styling tweaks.

### `control.getCanvasEl() → HTMLCanvasElement`

Direct access to the preview canvas. Module doesn't render anything into it — consumer can draw PDF preview here via PDF.js or whatever they prefer.

### `control.destroy()`

Remove the modal from the DOM. Safe to call once when you're done with it (single-page-app teardown).

## Standalone Utilities

```js
SeShared.print.pageSetup.DEFAULTS         // default state object
SeShared.print.pageSetup.MARGIN_PRESETS   // { normal, narrow, wide } in mm

SeShared.print.pageSetup.loadState(key)             // load + merge with defaults
SeShared.print.pageSetup.saveState(state, key)      // persist to localStorage

SeShared.print.pageSetup.colIdxToLetter(0)          // → "A"
SeShared.print.pageSetup.letterToColIdx("AB")       // → 27

SeShared.print.pageSetup.marginPresetFromState(state)   // → 'normal' | 'narrow' | 'wide' | 'custom'
SeShared.print.pageSetup.scalingPresetFromState(state)  // → 'full' | 'fitwidth' | 'fitheight' | 'fitpage' | 'percent'
```

## Integration with other modules

```html
<!-- Load all three for the full print flow -->
<script src="https://cdn.jsdelivr.net/gh/sesurvey-ai/se-univer-shared@v1.2.0/print/preview.js"></script>
<script src="https://cdn.jsdelivr.net/gh/sesurvey-ai/se-univer-shared@v1.2.0/print/page-setup.js"></script>

<script>
const ps = SeShared.print.pageSetup.init({
    onSave: async (state) => {
        const pdfBlob = await myPdfGenerator(state);
        SeShared.print.preview.printPdfBlob(pdfBlob);
    },
});

// Ctrl+P → open Page Setup
SeShared.print.preview.interceptPrintShortcut(() => ps.open());
</script>
```

## CSS Customization

Module uses class prefix `psh-` (Page Setup Helper) to avoid clashing with consumer CSS. Customize via CSS variables on `.psh-card`:

```css
.psh-card {
    --bg:       #ffffff;
    --ink:      #1a3a4d;   /* primary text/border colour */
    --accent:   #c44a2c;   /* focus ring + toggle 'on' colour */
    --paper:    #ffffff;
    --surface:  #ffffff;
    --surface-2:#f4f5f7;   /* preview area background */
}
```

Override in your app's stylesheet (loaded after the CDN script) to re-theme.

## Things to Know

- **CSS is injected once globally** when `init()` is first called. Multiple modal instances share the same stylesheet — fine since the rules are scoped under `.psh-card`.
- **Modal doesn't render preview itself** — `psh-canvas` element is provided empty. Use `control.getCanvasEl()` to draw into it (typically via PDF.js after generating a preview PDF).
- **"ถัดไป" auto-persists**: state is saved to localStorage right before calling `onSave`, even if `onSave` throws.
- **"รีเซ็ตค่าเริ่มต้น" does NOT persist** — only updates the form. User still has to press "ถัดไป" to save.
- **`scope: 'selection'`** in `open()` is a hint for the consumer's print pipeline to use the user's current cell selection as the print area. The modal itself doesn't capture the selection — consumer should populate `state.printArea` before calling `open({ state })`.

## License

MIT
