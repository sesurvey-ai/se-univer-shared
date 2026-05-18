# Importing Thai-Locale Excel Files into Univer

แนวทาง 4 ชั้นในการนำเข้าไฟล์ `.xlsx` ที่บันทึกจาก Excel locale ไทย (มี Buddhist Era dates + formulas) เข้า [Univer](https://univer.ai) Sheet ให้ render + คำนวณตรงกับ Excel — **โดยไม่ต้อง fork Univer**

---

## ทางลัด: ใช้ Module สำเร็จรูป

Module [`xlsx/thai-be.js`](../xlsx/thai-be.js) ใน repo นี้ implement **Layer 4 ทั้งหมด** (Thai BE handling) พร้อมใช้ทันที — ครอบคลุม Case A (text dates) + Case B (Excel-encoded numeric serials) + pattern translation

```html
<script src="https://cdn.jsdelivr.net/gh/sesurvey-ai/se-univer-shared@v1.0.1/xlsx/thai-be.js"></script>

<script>
async function importExcel(file) {
    const buf = await file.arrayBuffer();

    // Layer 1: SheetJS options
    const wb = XLSX.read(buf, {
        type: 'array',
        sheetStubs: true,
        cellNF: true,
    });

    // Layers 2-3: ของฝั่ง consumer (xlsxWorkbookToUniver ของแต่ละ project)
    const workbookData = yourExistingConverter(wb);

    // Layer 4: ทำให้สำเร็จด้วย 1 บรรทัด
    SeShared.xlsx.thaiBe.applyToWorkbook(workbookData);

    univerAPI.createWorkbook(workbookData);
}
</script>
```

**API:**

| Function | ใช้เมื่อ |
|---|---|
| `applyToWorkbook(workbookData, opts?)` | สะดวกที่สุด — apply ทั้ง 2 ฟังก์ชันข้างล่างให้ทุก sheet ในไฟล์ |
| `convertCellData(cellData, opts?)` | ทำเฉพาะการแปลง (Case A + B) ใน 1 sheet — return `true` ถ้าเจอ |
| `translateBEPatterns(cellData)` | ทำเฉพาะ pattern translation (yyyy→bbbb) ใน 1 sheet |
| `tryParseThaiBEDateText(text)` | pure parser — ส่ง text เข้า ได้ Excel serial หรือ `null` |
| `isDateFormatPattern(pattern)` | check ว่า format string เป็น date format หรือไม่ |

**Opts:** ถ้า Univer version ของคุณใช้ CellValueType enum ต่างจาก default `{ UNIVER_T_STRING: 1, UNIVER_T_NUMBER: 2 }` ให้ override ผ่าน opts

---

## ปัญหาที่ต้องแก้ทีละชั้น

| Layer | ปัญหา | สาเหตุ |
|---|---|---|
| 1 | Formulas หายเมื่อ SheetJS parse | SheetJS drop cells ที่ `<v>` ว่าง (ไฟล์บันทึกด้วย `fullCalcOnLoad=1` ไม่ cache value) |
| 2 | Univer ไม่คำนวณ formula | `v` field มีค่า (แม้เป็น `''` หรือ `0`) → engine คิดว่ามี cached value แล้ว skip recompute |
| 3 | Date/currency แสดงเป็นเลขดิบ | numFmt pattern ไม่ถูก preserve จาก SheetJS → ส่งเข้า Univer |
| 4 | Thai BE dates ผิดทั้งวันและปี | Excel coerce text `"16/05/2569"` (BE) → date serial ผ่าน locale; Univer's engine เป็น strict typing ไม่ทำ |

---

## Layer 1 — SheetJS Read Options

```js
const wb = XLSX.read(buf, {
    type: 'array',
    sheetStubs: true,  // keep cells with formula-but-no-value
    cellNF: true,      // populate cell.z with resolved format pattern
});
```

**ทำไม:**
- `sheetStubs: true` — default ของ SheetJS จะ drop cells ที่ `<v></v>` ว่าง (แม้มี `<f>FORMULA</f>`) flag นี้บังคับให้เก็บไว้เป็น stub (`cell.t === 'z'`)
- `cellNF: true` — `cell.z` จะถูก populate ด้วย format pattern ที่ resolve แล้ว เช่น `"dd/mm/yyyy"` (รวมกรณี numFmtId 167 ที่ไฟล์ไม่มี definition แต่ SheetJS รู้ default)

---

## Layer 2 — Formula-only Cell Handling

```js
for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[addr];
        if (!cell) continue;
        const v = cell.v;
        // Stub cells (t='z') carry filler v=0; treat as no-value
        const isStub = cell.t === 'z';
        const hasValue = !isStub
            && !(v === null || v === undefined || v === '');
        if (!hasValue && !cell.f && !cell.z) continue;
        if (!cellData[r]) cellData[r] = {};
        let cellObj;
        if (hasValue) {
            const isNum = typeof v === 'number' && Number.isFinite(v);
            cellObj = {
                v: isNum ? v : String(v),
                t: isNum ? 2 : 1,  // Univer: 2=NUMBER, 1=STRING
            };
        } else {
            // CRITICAL: omit `v` and `t` entirely so Univer's formula engine
            // recomputes on mount. Setting v: 0 or v: '' makes engine treat
            // as cached value and skip computation, leaving cell blank.
            cellObj = {};
        }
        if (cell.f) {
            // SheetJS strips leading '='; Univer wants it back
            cellObj.f = cell.f.startsWith('=') ? cell.f : '=' + cell.f;
        }
        if (cell.z && cell.z !== 'General') {
            cellObj.s = Object.assign({}, cellObj.s, {
                n: { pattern: cell.z },
            });
        }
        cellData[r][c] = cellObj;
    }
}
```

**กุญแจสำคัญ:** สำหรับ formula-only cells ต้อง **omit `v` field โดยสิ้นเชิง** (ไม่ใช่ set เป็น `''` หรือ `0`) ไม่เช่นนั้น Univer's formula engine จะ skip recompute เพราะเข้าใจว่ามี cached value แล้ว

---

## Layer 3 — numFmt Preservation (Optional Deep Path)

ถ้า `cell.z` จาก SheetJS ยังไม่พอ (เช่นมี styled-empty cells ที่ SheetJS มองไม่เห็น), parse `xl/styles.xml` ตรงๆ:

```js
const EXCEL_BUILTIN_NUMFMTS = {
    0: 'General', 1: '0', 2: '0.00',
    3: '#,##0', 4: '#,##0.00',
    9: '0%', 10: '0.00%', 11: '0.00E+00',
    14: 'm/d/yyyy', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy',
    18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM', 20: 'h:mm', 21: 'h:mm:ss',
    22: 'm/d/yyyy h:mm', 49: '@',
};
```

OOXML reserves IDs 0-49 (Excel ไม่ serialize เพราะถือว่ามาตรฐาน); custom IDs เริ่มที่ 164+ ใน `<numFmts>` element

Parse styles.xml → build map `numFmtId → pattern` → attach `s.n.pattern` ให้ cell

**Univer ใช้ Excel format codes ตรงๆ** ผ่าน `s.n.pattern` — ไม่ต้องแปลงเป็น ICU pattern

---

## Layer 4 — Thai BE Pre-processing 🎯

Excel ที่ตั้ง locale ไทยมีพฤติกรรมพิเศษ 2 อย่างที่ Univer ไม่ทำ:

1. **Auto-coerce text date** — `"16/05/2569"` (text) + `30` → date arithmetic
2. **Display year ใน BE format** — `dd/mm/yyyy` กับ Thai locale แสดงปีเป็น 2569 ไม่ใช่ 2026

วิธีแก้ทั้งสอง:

### 4a. Parser (รองรับหลายรูปแบบ)

```js
const THAI_BE_SERIAL_OFFSET = 198332;  // 543 years in days

const THAI_MONTH_NAMES = {
    'ม.ค.':1,'มกราคม':1,'มค':1,
    'ก.พ.':2,'กุมภาพันธ์':2,'กพ':2,
    'มี.ค.':3,'มีนาคม':3,'มีค':3,
    'เม.ย.':4,'เมษายน':4,'เมย':4,
    'พ.ค.':5,'พฤษภาคม':5,'พค':5,
    'มิ.ย.':6,'มิถุนายน':6,'มิย':6,
    'ก.ค.':7,'กรกฎาคม':7,'กค':7,
    'ส.ค.':8,'สิงหาคม':8,'สค':8,
    'ก.ย.':9,'กันยายน':9,'กย':9,
    'ต.ค.':10,'ตุลาคม':10,'ตค':10,
    'พ.ย.':11,'พฤศจิกายน':11,'พย':11,
    'ธ.ค.':12,'ธันวาคม':12,'ธค':12,
};

// Detect if a number format is a date/time format. Strips quoted literals
// ("text") and escaped chars (\.) so patterns like `"date"#,##0` don't
// trigger a false positive on the literal 'd' inside quotes.
function isDateFormatPattern(pattern) {
    if (!pattern) return false;
    const cleaned = pattern.replace(/"[^"]*"/g, '').replace(/\\./g, '');
    return /[yYdD]/.test(cleaned);
}

function tryParseThaiBEDateText(text) {
    let d, mo, year, rest, m;

    // Format A: dd[sep]mm[sep]yy(yy) with sep = / - .
    m = /^\s*(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(.*)$/.exec(text);
    if (m) {
        d = +m[1]; mo = +m[2]; year = +m[3]; rest = m[4];
    } else {
        // Format B: yyyy[sep]mm[sep]dd
        m = /^\s*(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})(.*)$/.exec(text);
        if (m) {
            year = +m[1]; mo = +m[2]; d = +m[3]; rest = m[4];
        } else {
            // Format C: dd ThaiMonthName yy(yy)
            m = /^\s*(\d{1,2})\s+(\S+)\s+(\d{2,4})(.*)$/.exec(text);
            if (m && THAI_MONTH_NAMES[m[2]] != null) {
                d = +m[1]; mo = THAI_MONTH_NAMES[m[2]];
                year = +m[3]; rest = m[4];
            } else {
                return null;
            }
        }
    }

    // 2-digit year → assume Buddhist 25xx (CE 1957-2056 — modern range)
    if (year < 100) year += 2500;

    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    if (year < 1900 || year > 2900) return null;

    // Optional time suffix " HH:MM" or " HH:MM:SS"
    let hour = 0, min = 0, sec = 0;
    const trimmedRest = rest.trim();
    if (trimmedRest.length > 0) {
        const tm = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/.exec(trimmedRest);
        if (!tm) return null;
        hour = +tm[1]; min = +tm[2]; sec = tm[3] ? +tm[3] : 0;
        if (hour > 23 || min > 59 || sec > 59) return null;
    }

    // Year heuristic: >=2400 → BE (subtract 543); else CE as-is
    const ceYear = year >= 2400 ? year - 543 : year;

    const dateMs = Date.UTC(ceYear, mo - 1, d);
    const epochMs = Date.UTC(1899, 11, 30);
    // Excel epoch 1899-12-30: the Lotus-1900-leap bug cancels out — raw
    // day count matches Excel for any date >= 1900-03-01.
    const daySerial = Math.round((dateMs - epochMs) / 86400000);
    const timeFraction = (hour * 3600 + min * 60 + sec) / 86400;
    return daySerial + timeFraction;
}
```

**รูปแบบที่รองรับ:**

| Input | Output (Excel serial) | แสดงผล (dd/mm/bbbb) |
|---|---|---|
| `"16/05/2569"` | 46158 | `16/05/2569` |
| `"16-05-2569"` | 46158 | `16/05/2569` |
| `"16.05.2569"` | 46158 | `16/05/2569` |
| `"2569/05/16"` | 46158 | `16/05/2569` |
| `"2569-05-16"` | 46158 | `16/05/2569` |
| `"16/05/69"` (2-digit) | 46158 | `16/05/2569` |
| `"16/05/2024"` (CE) | 45428 | `16/05/2567` |
| `"16/05/2200"` (BE outside 2400+) | 109710 | `16/05/2200` |
| `"16/05/2569 14:30"` | 46158.604 | `16/05/2569 14:30` |
| `"16/05/2569 14:30:45"` | 46158.605 | `16/05/2569 14:30:45` |
| `"16 พ.ค. 2569"` | 46158 | `16/05/2569` |
| `"16 พฤษภาคม 2569"` | 46158 | `16/05/2569` |
| `"01 มกราคม 2570"` | 46388 | `01/01/2570` |
| `"not a date"` | `null` | (skipped) |
| `"32/13/2569"` (invalid) | `null` | (skipped) |
| `"16/05/3000"` (out of range) | `null` | (skipped) |

### 4b. Conversion Pass (Text + Excel-Encoded Numbers)

```js
let hasThaiDates = false;
for (const sid of sheetOrder) {
    const cellData = sheets[sid].cellData;
    for (const rk of Object.keys(cellData)) {
        const row = cellData[rk];
        for (const ck of Object.keys(row)) {
            const cell = row[ck];

            // Case A: text strings that look like Thai BE dates
            if (cell.t === 1 && typeof cell.v === 'string') {
                const serial = tryParseThaiBEDateText(cell.v);
                if (serial === null) continue;
                cell.v = serial;
                cell.t = 2;                        // STRING → NUMBER
                hasThaiDates = true;
                const existingPattern = cell.s && cell.s.n
                    && cell.s.n.pattern;
                cell.s = Object.assign({}, cell.s, {
                    n: { pattern: existingPattern || 'dd/mm/bbbb' },
                });
                continue;
            }

            // Case B: numeric cells already storing a Thai BE serial.
            // Thai Excel writes 244485 for "16/05/2569 BE" = standard CE
            // serial 46153 + 198332. Detection: cell has a date-format
            // pattern AND value is in the Thai-encoded range. Standard CE
            // serials top out around 75k for normal data (year 2105);
            // Thai BE serials start at ~198333 (year 1900) → non-overlap.
            if (cell.t === 2 && typeof cell.v === 'number'
                && cell.v >= 198000 && cell.v <= 310000) {
                const pat = cell.s && cell.s.n && cell.s.n.pattern;
                if (!isDateFormatPattern(pat)) continue;
                cell.v = cell.v - THAI_BE_SERIAL_OFFSET;
                hasThaiDates = true;
            }
        }
    }
}
```

### 4c. Pattern Translation (BE Display Throughout)

```js
// If ANY cell was a Thai BE date, propagate BE display to ALL date cells
// in the workbook — including formula results that inherited `yyyy` from
// Excel's numFmt. Otherwise: inputs render BE, outputs render CE → confusing
if (hasThaiDates) {
    for (const sid of sheetOrder) {
        const cellData = sheets[sid].cellData;
        for (const rk of Object.keys(cellData)) {
            const row = cellData[rk];
            for (const ck of Object.keys(row)) {
                const cell = row[ck];
                const pat = cell.s && cell.s.n && cell.s.n.pattern;
                if (!pat) continue;
                const newPat = pat
                    .replace(/yyyy/g, 'bbbb')      // 4-digit BE year
                    .replace(/yy/g, 'bb');         // 2-digit BE year
                if (newPat !== pat) {
                    cell.s = Object.assign({}, cell.s, {
                        n: { pattern: newPat },
                    });
                }
            }
        }
    }
}
```

### กุญแจสำคัญ: Univer มี `bbbb` built-in อยู่แล้ว

Univer's numfmt plugin support Excel format codes สำหรับ Buddhist year ตรงๆ — **ไม่ต้อง runtime patch หรือ fork**

```js
// Verify in browser console (after Univer presets loaded):
window.UniverSheetsNumfmt.getPatternPreview('dd/mm/bbbb', 46158)
// → { result: "16/05/2569" }
```

| Format code | Output (serial 46158 = 16/05/2026 CE) |
|---|---|
| `dd/mm/yyyy` | `16/05/2026` |
| `dd/mm/bbbb` | `16/05/2569` |
| `dd/mm/bb` | `16/05/69` |
| `"BE "bbbb"-"mm"-"dd` | `BE 2569-05-16` |

---

## ลำดับการเรียก (Order Matters)

```js
async function xlsxToUniver(buf) {
    const wb = XLSX.read(buf, {
        type: 'array',
        sheetStubs: true,
        cellNF: true,
    });

    // Pass 1: main cell extraction (Layer 1 + 2)
    const cellData = extractCells(wb);

    // Pass 2: numFmt + style merge from styles.xml (Layer 3, optional)
    await mergeStylesXml(cellData, buf);

    // Pass 3: Thai BE conversion + pattern translation (Layer 4)
    convertThaiBEDates(cellData);

    return buildUniverWorkbookData(cellData);
}
```

**สำคัญ:** Layer 4 ต้องทำ **หลัง** Layer 3 เพราะต้องอ่าน pattern ที่ Layer 3 set ไว้ (e.g. `cell.z = 'dd/mm/yyyy'`) ก่อนค่อยแปลงเป็น `bbbb`

---

## Verified Outcomes

ทดสอบกับไฟล์ Excel Thai locale (75k cells, 792 formulas, fullCalcOnLoad=1):

| | Before | After |
|---|---|---|
| Formulas imported | 0/792 ❌ | **792/792** ✓ |
| Univer computes | n/a | ✓ |
| Date display | `244515` (raw number) | `15/06/2569` (BE — ตรง Excel) |
| Formula result | `00/01/1900` | `15/06/2569` (= I2 + 30) |
| VLOOKUP cross-sheet | `0` | `"ค่าบริการสำรวจอุบัติเหตุ จ.ชลบุรี"` (ตรง Excel) |

---

## ข้อจำกัดที่ยังมี

1. **Mixed number/string types in lookup columns** — VLOOKUP ของ Univer handle ได้ดีระดับหนึ่ง แต่ edge cases ที่ Excel coerce แบบ aggressive อาจไม่ match
2. **Excel-specific functions** — Univer's formula engine ไม่ครบ Excel's ~400+ functions; XLOOKUP, FILTER, dynamic arrays อาจไม่ work
3. **Array formulas** (`<f t="array">`) — SheetJS CE expand ได้บางส่วน Univer's array spill behavior อาจต่างจาก Excel
4. **External references** (`[OtherFile.xlsx]Sheet1!A1`) — preserve formula text แต่คำนวณไม่ได้
5. **Locale date formats นอกเหนือจากที่ระบุ** — รองรับ dd/mm/yyyy, yyyy-mm-dd, dd ThaiMonth yyyy (+ separator / - . + time suffix + 2-digit year + Thai month names) ถ้าไฟล์ใช้ format อื่น (เช่น month-first `mm/dd/yyyy` US-style) ต้องเพิ่ม regex variant ใน `tryParseThaiBEDateText`

---

## ข้อมูล Univer ที่ใช้พึ่งพา (สำหรับ pin version)

- `@univerjs/presets` (core preset bundles formula engine)
- `@univerjs/sheets-numfmt` — exposes `getPatternPreview()` global ใช้ verify pattern เป็น `window.UniverSheetsNumfmt.getPatternPreview(pattern, value)`

**ทดสอบบน Univer v0.x** (CDN ผ่าน unpkg): `bbbb` format code stable ตั้งแต่ Univer release แรกๆ — โอกาส break ต่ำ

---

## License

โค้ดในเอกสารนี้เผยแพร่ภายใต้ MIT License — ใช้/ดัดแปลง/แจกจ่ายได้อิสระ
