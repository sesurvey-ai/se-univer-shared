# File I/O Pickers (cross-browser Save/Open)

Module: [`file-io/pickers.js`](../file-io/pickers.js)
Namespace: `window.SeShared.fileIo.pickers`

Cross-browser file save/open helpers. Uses the **File System Access API** (Chrome/Edge) for in-place save with persistent file handles, falls back to `<a download>` / `<input type="file">` on Firefox/Safari/Brave.

## ทำไมต้องมี module นี้

File System Access API ให้ UX ดี (เปิดไฟล์ → save ทับได้เลยไม่ต้อง prompt อีก) แต่ support เฉพาะ Chrome/Edge

ทุก app ที่อยากให้ทำงานข้ามเบราว์เซอร์เลย duplicate fallback code เหมือนกัน:

- เช็ค `window.showSaveFilePicker` มีไหม
- ถ้ามี → `showSaveFilePicker(...)` → keep handle → re-save in place
- ถ้าไม่มี → สร้าง `<a download>` → trigger click → revoke URL

Module นี้ encapsulate logic นี้ + handle edge cases:

- Permission re-prompt (Chrome ขอ readwrite ใหม่บางครั้ง)
- Stale handle detection (user ลบ/ย้ายไฟล์ระหว่าง session)
- Refresh cached metadata ก่อน `createWritable()` (กัน InvalidStateError)
- AbortError (user cancel picker) → `cancelled: true` แทนที่จะ throw

## Browser Support

| Browser | API Detection | Behavior |
|---|---|---|
| Chrome / Edge (HTTPS / localhost) | ✓ FSA | Native picker + handle for in-place save |
| Brave (default) | ✗ | Fallback to download/input |
| Brave (flag enabled) | ✓ FSA | Native picker |
| Firefox | ✗ | Fallback |
| Safari | ✗ | Fallback |

## Quick Start

```html
<script src="https://cdn.jsdelivr.net/gh/sesurvey-ai/se-univer-shared@v1.4.0/file-io/pickers.js"></script>

<script>
// Save
const result = await SeShared.fileIo.pickers.saveBlob(myBlob, {
    suggestedName: 'workbook.se.json',
    types: [
        { description: 'SE workbook',
          accept: { 'application/json': ['.se.json'] } },
    ],
});

if (result.cancelled) return;
console.log(`Saved via ${result.method}: ${result.name}`);
// If method === 'fsa', keep result.handle for in-place re-save later

// Open
const open = await SeShared.fileIo.pickers.openFile({
    types: [{
        description: 'SE / Excel workbook',
        accept: {
            'application/json': ['.se', '.se.json', '.json'],
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
        },
    }],
    accept: '.se,.se.json,.json,.xlsx',  // for the fallback <input>
});

if (!open.cancelled) {
    processFile(open.file);
    if (open.handle) keepForLaterReSave(open.handle);
}

// Re-save without prompting (when you have a handle)
try {
    await SeShared.fileIo.pickers.writeBlobToHandle(handle, newBlob);
} catch (err) {
    if (SeShared.fileIo.pickers.isStaleHandleError(err)) {
        // File was moved/deleted — re-prompt with saveBlob
        alert('ไฟล์เดิมหายไป — กรุณาเลือกที่บันทึกใหม่');
        await SeShared.fileIo.pickers.saveBlob(newBlob, { suggestedName: oldName });
    } else {
        throw err;
    }
}
</script>
```

## API

### `hasFileSystemAccess() → boolean`

Detect whether the current browser/context supports the File System Access API. Use for branching UI (e.g. show "Save" only when FSA is available, since fallback can only do "Save As").

```js
if (SeShared.fileIo.pickers.hasFileSystemAccess()) {
    showSaveButton();
}
```

### `saveBlob(blob, opts) → Promise<result>`

Save a blob to disk. Tries the FSA picker first; falls back to `<a download>`.

| Opt | Required | Description |
|---|---|---|
| `suggestedName` | recommended | Default filename in picker / download attribute |
| `types` | no | FSA type filters (ignored by fallback) — `[{ description, accept }]` |

**Returns:**

```js
{
    success: boolean,
    method: 'fsa' | 'download',
    handle?: FileSystemFileHandle,  // present only when method='fsa'
    name?: string,                  // final filename (whatever user chose)
    cancelled?: boolean,            // true if user closed the picker
}
```

### `openFile(opts?) → Promise<result>`

Open a file from disk. Tries FSA picker; falls back to `<input type="file">`.

| Opt | Required | Description |
|---|---|---|
| `types` | no | FSA type filters |
| `accept` | no | Fallback `<input>` accept attribute (comma-separated) |
| `multiple` | no | Allow multiple file selection (default `false`) |

**Returns (single mode):**

```js
{
    success: boolean,
    method: 'fsa' | 'input',
    file?: File,
    handle?: FileSystemFileHandle,  // only when method='fsa'
    files?: File[],                 // always set
    cancelled?: boolean,
}
```

**Returns (multiple mode):**

```js
{
    success: boolean,
    method: 'fsa' | 'input',
    files: File[],
    handles?: FileSystemFileHandle[],  // only when method='fsa'
    cancelled?: boolean,
}
```

### `writeBlobToHandle(handle, blob) → Promise<void>`

Re-save a blob into an existing `FileSystemFileHandle` without prompting. Handles permission re-prompts and metadata refresh.

Throws on permission denied or write failure. Catch and check `isStaleHandleError(err)` to handle the file-moved case gracefully.

```js
try {
    await writeBlobToHandle(handle, blob);
    console.log('Saved');
} catch (err) {
    if (isStaleHandleError(err)) {
        // file gone — fall through to Save As
    } else {
        throw err;
    }
}
```

### `isStaleHandleError(err) → boolean`

Detect whether an Error from `writeBlobToHandle` means the file was moved, deleted, or renamed externally. Detects `InvalidStateError`, `NotFoundError`, and messages containing "state cached" / "no longer exists" / "cannot be found".

## Common Recipes

### Save → keep handle → re-save without prompting

```js
let currentHandle = null;
let currentName = null;

async function saveAs(blob) {
    const r = await SeShared.fileIo.pickers.saveBlob(blob, {
        suggestedName: currentName || 'document.json',
        types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
    });
    if (r.cancelled) return;
    if (r.handle) currentHandle = r.handle;
    currentName = r.name;
}

async function save(blob) {
    if (!currentHandle) return saveAs(blob);
    try {
        await SeShared.fileIo.pickers.writeBlobToHandle(currentHandle, blob);
    } catch (err) {
        if (SeShared.fileIo.pickers.isStaleHandleError(err)) {
            currentHandle = null;
            return saveAs(blob);
        }
        throw err;
    }
}
```

### Open file → process by extension

```js
const r = await SeShared.fileIo.pickers.openFile({
    types: [...],
    accept: '.json,.xlsx',
});
if (r.cancelled) return;

const f = r.file;
if (/\.xlsx?$/i.test(f.name)) {
    const buf = await f.arrayBuffer();
    // process xlsx
} else {
    const text = await f.text();
    // process json
}
```

### Branching UI based on FSA support

```js
const fsa = SeShared.fileIo.pickers.hasFileSystemAccess();

// Hide the "Save" button on browsers that can only Save As
document.getElementById('saveBtn').style.display = fsa ? '' : 'none';

// Adjust the Open button tooltip
document.getElementById('openBtn').title = fsa
    ? 'เปิดไฟล์ (Chrome/Edge — รองรับ Save in-place)'
    : 'เปิดไฟล์';
```

## Edge Cases Handled

- **AbortError** (user cancels picker) → returned as `{ cancelled: true }`, not thrown.
- **Permission re-prompt** — Chrome may downgrade an old handle's permission; `writeBlobToHandle` re-asks before opening writable.
- **Stale cached state** — refreshes metadata via no-op `getFile()` before `createWritable()` (prevents `InvalidStateError: state cached`).
- **Brave with FSA disabled** — same fallback path as Firefox/Safari (detection happens at runtime).
- **Multiple file picker without `multiple: true`** — picker returns single file, `result.file` is set.
- **Cross-tab handle re-use** — handles persist across page reloads when stored in IndexedDB, but this module doesn't manage that (consumer's responsibility).

## License

MIT
