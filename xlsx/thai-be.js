/*!
 * SeShared.xlsx.thaiBe
 *
 * Thai Buddhist Era date handling for Excel xlsx imports into Univer.
 *
 * Repo:    https://github.com/sesurvey-ai/se-univer-shared
 * License: MIT
 *
 * USAGE (browser, drop-in via CDN):
 *
 *   <script src="https://cdn.jsdelivr.net/gh/sesurvey-ai/se-univer-shared@v1.0.1/xlsx/thai-be.js"></script>
 *   <script>
 *     // After you have a Univer-shaped workbook data (from SheetJS):
 *     SeShared.xlsx.thaiBe.applyToWorkbook(workbookData);
 *     // Then mount as usual: univerAPI.createWorkbook(workbookData);
 *   </script>
 *
 * USAGE (Node, for testing):
 *
 *   const { tryParseThaiBEDateText } = require('./thai-be.js').SeShared.xlsx.thaiBe;
 *   // (UMD-style: also attaches to globalThis)
 *
 * WHAT IT DOES:
 *
 *   Excel with Thai locale silently coerces text dates ("16/05/2569") to
 *   numeric serials when used in arithmetic; Univer's strict formula engine
 *   does not. Thai Excel also stores numeric date serials shifted by +198332
 *   days (= 543 years) so display year is BE.
 *
 *   This module:
 *     1. Detects Thai BE text dates in many formats (dd/mm/yyyy,
 *        yyyy-mm-dd, dd ThaiMonth yyyy, 2-digit years, dd-mm-yyyy,
 *        dd.mm.yyyy, with optional time suffix) → converts to standard
 *        Excel CE serials.
 *     2. Detects Thai-encoded numeric serials (value in [198000, 310000]
 *        with a date format pattern) → subtracts 198332 to get standard CE.
 *     3. Translates `yyyy` → `bbbb` and `yy` → `bb` in number format
 *        patterns across the whole workbook, so formula results also
 *        render in BE (using Univer's built-in Buddhist year format codes).
 */
(function(global) {
    'use strict';

    var SeShared = global.SeShared = global.SeShared || {};
    SeShared.xlsx = SeShared.xlsx || {};

    // ----- Constants -----

    // Thai Excel encodes BE dates by adding 198332 days (543 years) to the
    // standard CE serial. So Thai BE serial 244485 = standard CE serial
    // 46153 = 2026-05-16 (= 2569-05-16 BE).
    var THAI_BE_SERIAL_OFFSET = 198332;

    // Thai month names → 1-12. Covers abbreviations (ม.ค.), full names
    // (มกราคม), and no-dot variants (มค) some data sources use.
    var THAI_MONTH_NAMES = {
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

    // Univer CellValueType enum values used as defaults (callers can
    // override via opts if their Univer version uses different codes).
    var UNIVER_T_STRING_DEFAULT = 1;
    var UNIVER_T_NUMBER_DEFAULT = 2;

    // ----- Pure helpers -----

    /**
     * True if the number format pattern represents a date/time format.
     * Strips quoted literals ("text") and escaped chars (\.) before
     * checking, so patterns like `"date"#,##0` don't false-positive on
     * the literal 'd' inside quotes.
     *
     * @param {string|null|undefined} pattern Excel-style format code
     * @returns {boolean}
     */
    function isDateFormatPattern(pattern) {
        if (!pattern) return false;
        var cleaned = pattern.replace(/"[^"]*"/g, '').replace(/\\./g, '');
        return /[yYdD]/.test(cleaned);
    }

    /**
     * Parse a Thai BE date text. Returns Excel date serial (number) on
     * success, or null if the text doesn't match a recognized pattern.
     *
     * Recognized formats:
     *   - dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy (day-first, any separator)
     *   - yyyy/mm/dd, yyyy-mm-dd, yyyy.mm.dd (year-first, ISO-ish)
     *   - dd ThaiMonthName yyyy (e.g. "16 พ.ค. 2569", "16 พฤษภาคม 2569")
     *   - 2-digit year → assumed Buddhist 25xx (CE 1957-2056)
     *   - Optional time suffix: " HH:MM" or " HH:MM:SS"
     *
     * Year heuristic: >=2400 treated as BE (subtract 543); otherwise CE
     * as-is. Year must fall in [1900, 2900] or returns null.
     *
     * @param {string} text
     * @returns {number|null} Excel serial (1899-12-30 epoch), or null
     */
    function tryParseThaiBEDateText(text) {
        var d, mo, year, rest, m;

        // Format A: dd[sep]mm[sep]yy(yy) — day-first
        m = /^\s*(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(.*)$/.exec(text);
        if (m) {
            d = +m[1]; mo = +m[2]; year = +m[3]; rest = m[4];
        } else {
            // Format B: yyyy[sep]mm[sep]dd — year-first
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

        // 2-digit year → assume Buddhist 25xx (covers CE 1957-2056)
        if (year < 100) year += 2500;

        if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
        if (year < 1900 || year > 2900) return null;

        // Optional time suffix " HH:MM" or " HH:MM:SS"
        var hour = 0, min = 0, sec = 0;
        var trimmedRest = rest.trim();
        if (trimmedRest.length > 0) {
            var tm = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/.exec(trimmedRest);
            if (!tm) return null;
            hour = +tm[1]; min = +tm[2]; sec = tm[3] ? +tm[3] : 0;
            if (hour > 23 || min > 59 || sec > 59) return null;
        }

        // BE → CE conversion for serial calculation
        var ceYear = year >= 2400 ? year - 543 : year;

        var dateMs = Date.UTC(ceYear, mo - 1, d);
        var epochMs = Date.UTC(1899, 11, 30);
        // Excel epoch 1899-12-30: the Lotus-1900-leap bug (Excel treats
        // 1900-02-29 as real) cancels out — raw day count matches Excel
        // for any date >= 1900-03-01.
        var daySerial = Math.round((dateMs - epochMs) / 86400000);
        var timeFraction = (hour * 3600 + min * 60 + sec) / 86400;
        return daySerial + timeFraction;
    }

    // ----- Cell data passes -----

    /**
     * Walk one sheet's cellData and convert Thai BE dates (text + Thai-
     * encoded numeric serials) → standard Excel CE serials. Mutates cells
     * in place. Returns `true` if any conversion happened.
     *
     * After this returns true, call `translateBEPatterns(cellData)` to
     * also flip date format patterns (yyyy→bbbb, yy→bb) so formula
     * outputs render in BE too.
     *
     * @param {Object} cellData Univer's sparse `{ [row]: { [col]: cell } }`
     * @param {Object} [opts]
     * @param {number} [opts.UNIVER_T_STRING=1]
     * @param {number} [opts.UNIVER_T_NUMBER=2]
     * @param {string} [opts.defaultDatePattern='dd/mm/bbbb']
     *        Format applied to converted text cells that have no
     *        existing pattern.
     * @returns {boolean} true if any cell was converted
     */
    function convertCellData(cellData, opts) {
        opts = opts || {};
        var T_STRING = opts.UNIVER_T_STRING != null
            ? opts.UNIVER_T_STRING : UNIVER_T_STRING_DEFAULT;
        var T_NUMBER = opts.UNIVER_T_NUMBER != null
            ? opts.UNIVER_T_NUMBER : UNIVER_T_NUMBER_DEFAULT;
        var defaultPattern = opts.defaultDatePattern || 'dd/mm/bbbb';

        var hasThaiDates = false;
        var rowKeys = Object.keys(cellData);
        for (var i = 0; i < rowKeys.length; i++) {
            var row = cellData[rowKeys[i]];
            var colKeys = Object.keys(row);
            for (var j = 0; j < colKeys.length; j++) {
                var cell = row[colKeys[j]];

                // Case A: text strings that look like Thai BE dates
                if (cell.t === T_STRING && typeof cell.v === 'string') {
                    var serial = tryParseThaiBEDateText(cell.v);
                    if (serial === null) continue;
                    cell.v = serial;
                    cell.t = T_NUMBER;
                    hasThaiDates = true;
                    var existing = cell.s && cell.s.n && cell.s.n.pattern;
                    cell.s = Object.assign({}, cell.s, {
                        n: { pattern: existing || defaultPattern },
                    });
                    continue;
                }

                // Case B: numeric cells already storing a Thai BE serial.
                // Detection: cell has a date-format pattern AND value is
                // in the Thai-encoded range. Standard CE serials top out
                // around 75k for normal data; Thai BE serials start at
                // ~198333 (year 1900) — non-overlapping bands.
                if (cell.t === T_NUMBER && typeof cell.v === 'number'
                    && cell.v >= 198000 && cell.v <= 310000) {
                    var pat = cell.s && cell.s.n && cell.s.n.pattern;
                    if (!isDateFormatPattern(pat)) continue;
                    cell.v = cell.v - THAI_BE_SERIAL_OFFSET;
                    hasThaiDates = true;
                }
            }
        }
        return hasThaiDates;
    }

    /**
     * Walk one sheet's cellData and translate `yyyy`→`bbbb`, `yy`→`bb` in
     * all number format patterns. Use Univer's built-in `bbbb` (4-digit
     * Buddhist year) and `bb` (2-digit) format codes — no patch required.
     *
     * Call AFTER convertCellData() returns true, so formula result cells
     * that inherited `yyyy` from Excel's numFmt also display BE year.
     *
     * @param {Object} cellData Univer's sparse `{ [row]: { [col]: cell } }`
     */
    function translateBEPatterns(cellData) {
        var rowKeys = Object.keys(cellData);
        for (var i = 0; i < rowKeys.length; i++) {
            var row = cellData[rowKeys[i]];
            var colKeys = Object.keys(row);
            for (var j = 0; j < colKeys.length; j++) {
                var cell = row[colKeys[j]];
                var pat = cell.s && cell.s.n && cell.s.n.pattern;
                if (!pat) continue;
                var newPat = pat
                    .replace(/yyyy/g, 'bbbb')
                    .replace(/yy/g, 'bb');
                if (newPat !== pat) {
                    cell.s = Object.assign({}, cell.s, {
                        n: { pattern: newPat },
                    });
                }
            }
        }
    }

    /**
     * Convenience wrapper: apply convertCellData + translateBEPatterns to
     * ALL sheets in a Univer-shaped workbook data object.
     *
     * @param {Object} workbookData Univer's IWorkbookData
     *        (must have `.sheets` = { [sheetId]: { cellData, ... } })
     * @param {Object} [opts] Forwarded to convertCellData
     * @returns {boolean} true if any cell was converted
     */
    function applyToWorkbook(workbookData, opts) {
        if (!workbookData || !workbookData.sheets) return false;
        var sids = Object.keys(workbookData.sheets);
        var anyThaiDates = false;
        for (var i = 0; i < sids.length; i++) {
            var cd = workbookData.sheets[sids[i]].cellData;
            if (!cd) continue;
            if (convertCellData(cd, opts)) anyThaiDates = true;
        }
        if (anyThaiDates) {
            for (var k = 0; k < sids.length; k++) {
                var cd2 = workbookData.sheets[sids[k]].cellData;
                if (cd2) translateBEPatterns(cd2);
            }
        }
        return anyThaiDates;
    }

    // ----- Public API -----

    SeShared.xlsx.thaiBe = {
        version: '1.0.1',
        THAI_BE_SERIAL_OFFSET: THAI_BE_SERIAL_OFFSET,
        THAI_MONTH_NAMES: THAI_MONTH_NAMES,
        isDateFormatPattern: isDateFormatPattern,
        tryParseThaiBEDateText: tryParseThaiBEDateText,
        convertCellData: convertCellData,
        translateBEPatterns: translateBEPatterns,
        applyToWorkbook: applyToWorkbook,
    };

    // CommonJS compat for Node-based unit tests
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { SeShared: SeShared };
    }
})(typeof window !== 'undefined' ? window : globalThis);
