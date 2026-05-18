/*!
 * SeShared.print.pdfGenerator
 *
 * jsPDF + Sarabun (Thai font) + autoTable bootstrap + page-layout math
 * helpers. Lets any project skip the boilerplate of loading jsPDF from
 * CDN, installing Thai font into every doc instance, and computing
 * paper/margin/printable-area math from a Page Setup state.
 *
 * Repo:    https://github.com/sesurvey-ai/se-univer-shared
 * License: MIT
 *
 * QUICK START:
 *
 *   <script src="https://cdn.jsdelivr.net/gh/sesurvey-ai/se-univer-shared@v1.3.0/print/pdf-generator.js"></script>
 *   <script>
 *     // Lazy-load jsPDF + autoTable + Sarabun fonts (once per page):
 *     await SeShared.print.pdfGenerator.loadAssets();
 *
 *     // Now you can create a Thai-ready jsPDF instance:
 *     const { jsPDF } = window.jspdf;
 *     const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
 *     doc.setFont('THSarabun', 'normal');
 *     doc.setFontSize(14);
 *     doc.text('สวัสดี', 20, 20);
 *
 *     // Compute layout from a Page Setup state (paper/margin/scaling)
 *     // — pairs naturally with SeShared.print.pageSetup's state schema.
 *     const layout = SeShared.print.pdfGenerator.computePageLayout(pageSetupState);
 *     // → { paperWidthMm, paperHeightMm, marginsMm, printableArea, scaleFactor }
 *   </script>
 *
 * WHAT THIS MODULE DOES:
 *
 *   1. loadAssets() — fetches jsPDF + autoTable + 2 Sarabun TTF files
 *      from jsdelivr and installs the fonts into every new jsPDF
 *      instance (via jsPDF.API.events 'addFonts' hook). Idempotent.
 *
 *   2. Layout helpers — paper-size lookup, oriented dimensions,
 *      printable-area computation, column-splitting for wide tables.
 *
 *   3. Pure utilities — arrayBuffer → base64 (chunked so big TTF files
 *      don't blow the JS stack).
 *
 * WHAT THIS MODULE DOES NOT DO:
 *
 *   - Render your specific data shape (Univer cellData, table arrays,
 *     records lists, etc.) — that's project glue. Use the helpers here
 *     to make your renderer simpler, but you own the actual draw calls.
 *
 *   - Bundle jsPDF / Sarabun. They're lazy-fetched from jsdelivr at
 *     loadAssets() time so consumers only pay the ~370 KB on first use.
 */
(function(global) {
    'use strict';

    var SeShared = global.SeShared = global.SeShared || {};
    SeShared.print = SeShared.print || {};

    // ----- CDN URLs (pinned versions for stability) -----

    var JSPDF_URL = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';
    var JSPDF_AUTOTABLE_URL = 'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js';
    var SARABUN_REG_URL = 'https://cdn.jsdelivr.net/npm/font-th-sarabun-new@1.0.0/fonts/THSarabunNew-webfont.ttf';
    var SARABUN_BOLD_URL = 'https://cdn.jsdelivr.net/npm/font-th-sarabun-new@1.0.0/fonts/THSarabunNew_bold-webfont.ttf';

    var DEFAULT_FONT_FAMILY = 'THSarabun';

    // ----- Paper sizes (mm) — portrait orientation -----

    var PAPER_SIZES_MM = {
        a3:     { w: 297, h: 420 },
        a4:     { w: 210, h: 297 },
        a5:     { w: 148, h: 210 },
        letter: { w: 215.9, h: 279.4 },
        legal:  { w: 215.9, h: 355.6 },
    };

    // ----- Pure utilities -----

    /**
     * ArrayBuffer → base64. Chunked so big TTFs (>125 KB) don't blow
     * the call stack on String.fromCharCode.apply.
     */
    function arrayBufferToBase64(buffer) {
        var binary = '';
        var bytes = new Uint8Array(buffer);
        var chunkSize = 0x8000;
        for (var i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode.apply(
                null, bytes.subarray(i, i + chunkSize));
        }
        return btoa(binary);
    }

    /**
     * Get paper dimensions in mm for a given paper size + orientation.
     * @param {string} paperSize  'a4' | 'a3' | 'a5' | 'letter' | 'legal'
     * @param {string} orientation  'portrait' | 'landscape'
     * @returns {{ w: number, h: number }}
     */
    function paperToOrientedMm(paperSize, orientation) {
        var p = PAPER_SIZES_MM[paperSize] || PAPER_SIZES_MM.a4;
        if (orientation === 'landscape') {
            return { w: p.h, h: p.w };
        }
        return { w: p.w, h: p.h };
    }

    /**
     * Compute the printable area (inside the margins) for a given page
     * setup state.
     *
     * @param {Object} pageSetupState — pairs with the schema produced
     *        by SeShared.print.pageSetup (paperSize, orientation,
     *        marginTop, marginBottom, marginLeft, marginRight in mm).
     * @returns {{ x, y, w, h }} in mm — x/y are the top-left corner
     *        of the printable area, w/h are dimensions.
     */
    function computePrintableArea(pageSetupState) {
        var paper = paperToOrientedMm(
            pageSetupState.paperSize, pageSetupState.orientation);
        var mt = +pageSetupState.marginTop || 0;
        var mb = +pageSetupState.marginBottom || 0;
        var ml = +pageSetupState.marginLeft || 0;
        var mr = +pageSetupState.marginRight || 0;
        return {
            x: ml, y: mt,
            w: Math.max(0, paper.w - ml - mr),
            h: Math.max(0, paper.h - mt - mb),
        };
    }

    /**
     * Compute the scale factor that should be applied to content widths
     * so the table fits the page according to the user's scaling setting.
     *
     * @param {Object} pageSetupState — must have `scaling` and either
     *        `fitWide`/`fitTall` or `scalePercent` per the schema.
     * @param {Object} contentDims — { totalContentWidthMm, totalContentHeightMm }
     * @param {Object} printableArea — from computePrintableArea()
     * @returns {{ x: number, y: number }} — scale factors per axis (1.0 = no scaling)
     */
    function computeScaleFactor(pageSetupState, contentDims, printableArea) {
        var scaling = pageSetupState.scaling || 'full';
        if (scaling === 'percent') {
            var pct = +pageSetupState.scalePercent || 100;
            var s = Math.max(0.01, pct / 100);
            return { x: s, y: s };
        }
        if (scaling === 'fit') {
            var fw = +pageSetupState.fitWide || 0;
            var ft = +pageSetupState.fitTall || 0;
            var sx = 1, sy = 1;
            if (fw > 0 && contentDims.totalContentWidthMm > 0) {
                sx = (printableArea.w * fw) / contentDims.totalContentWidthMm;
            }
            if (ft > 0 && contentDims.totalContentHeightMm > 0) {
                sy = (printableArea.h * ft) / contentDims.totalContentHeightMm;
            }
            // Use the smaller factor so neither axis overflows
            var s2 = Math.min(sx, sy);
            return { x: s2, y: s2 };
        }
        return { x: 1, y: 1 };  // 'full' = 100%
    }

    /**
     * Convenience: compute everything you typically need to lay out a
     * print from a page setup state.
     */
    function computePageLayout(pageSetupState) {
        var paper = paperToOrientedMm(
            pageSetupState.paperSize, pageSetupState.orientation);
        var printable = computePrintableArea(pageSetupState);
        return {
            paperWidthMm: paper.w,
            paperHeightMm: paper.h,
            marginsMm: {
                top: +pageSetupState.marginTop || 0,
                bottom: +pageSetupState.marginBottom || 0,
                left: +pageSetupState.marginLeft || 0,
                right: +pageSetupState.marginRight || 0,
            },
            printableArea: printable,
        };
    }

    /**
     * Split column-widths into chunks that each fit within the printable
     * width. Used to render wide tables across multiple horizontal pages
     * (Excel's "Page Break" / "Print Area" behaviour for wide content).
     *
     * @param {number[]} widthsMm — column widths in mm
     * @param {number} printableWidthMm — usable width per page in mm
     * @returns {number[][]} — array of column-index arrays per page
     *
     * Example: widths = [50, 50, 50, 50, 50], printable = 110
     *   → [[0,1], [2,3], [4]]
     */
    function splitColumnsForPages(widthsMm, printableWidthMm) {
        // 0.5mm slack absorbs the floating-point spillover from scale
        // calculations (e.g. 14 cols × 12.428mm = 174.009mm vs 174mm
        // printable) — without it, fit-to-N-wide silently produces N+1
        // chunks because of rounding.
        var limit = printableWidthMm + 0.5;
        var chunks = [];
        var current = [];
        var currentW = 0;
        for (var c = 0; c < widthsMm.length; c++) {
            var w = widthsMm[c];
            if (current.length > 0 && currentW + w > limit) {
                chunks.push(current);
                current = [];
                currentW = 0;
            }
            current.push(c);
            currentW += w;
        }
        if (current.length > 0) chunks.push(current);
        return chunks;
    }

    // ----- Script loader -----

    function _loadScript(url) {
        return new Promise(function(resolve, reject) {
            var existing = document.querySelector(
                'script[data-pdfgen-src="' + url + '"]');
            if (existing) {
                if (existing.dataset.pdfgenLoaded === '1') return resolve();
                existing.addEventListener('load', function() { resolve(); });
                existing.addEventListener('error', function() {
                    reject(new Error('Failed to load script: ' + url));
                });
                return;
            }
            var s = document.createElement('script');
            s.src = url;
            s.async = true;
            s.dataset.pdfgenSrc = url;
            s.addEventListener('load', function() {
                s.dataset.pdfgenLoaded = '1';
                resolve();
            });
            s.addEventListener('error', function() {
                reject(new Error('Failed to load script: ' + url));
            });
            document.head.appendChild(s);
        });
    }

    // ----- loadAssets -----

    var _state = { loaded: false, loadingPromise: null };

    /**
     * Lazy-load jsPDF + autoTable plugin + Sarabun fonts. Idempotent —
     * subsequent calls return the same promise. After this resolves:
     *   - `window.jspdf.jsPDF` is available
     *   - Every new `new jsPDF()` has 'THSarabun' (normal + bold)
     *     registered, callable via `doc.setFont('THSarabun', 'normal')`.
     *
     * @param {Object} [opts]
     * @param {string} [opts.fontFamily='THSarabun']
     *        Name used to register fonts inside jsPDF instances
     * @returns {Promise<void>}
     */
    function loadAssets(opts) {
        if (_state.loaded) return Promise.resolve();
        if (_state.loadingPromise) return _state.loadingPromise;

        opts = opts || {};
        var fontFamily = opts.fontFamily || DEFAULT_FONT_FAMILY;

        _state.loadingPromise = (async function() {
            await _loadScript(JSPDF_URL);
            await _loadScript(JSPDF_AUTOTABLE_URL);
            if (!global.jspdf || !global.jspdf.jsPDF) {
                throw new Error('jsPDF global missing after script load');
            }
            var fetchedBufs = await Promise.all([
                fetch(SARABUN_REG_URL).then(function(r) { return r.arrayBuffer(); }),
                fetch(SARABUN_BOLD_URL).then(function(r) { return r.arrayBuffer(); }),
            ]);
            var regB64 = arrayBufferToBase64(fetchedBufs[0]);
            var boldB64 = arrayBufferToBase64(fetchedBufs[1]);
            // Hook into every new jsPDF doc and install the fonts via
            // the VFS. This runs once per `new jsPDF()`, so the fonts
            // are always available without callers having to remember
            // to install them per-doc.
            var jsPDF = global.jspdf.jsPDF;
            jsPDF.API.events.push(['addFonts', function() {
                this.addFileToVFS(fontFamily + '.ttf', regB64);
                this.addFileToVFS(fontFamily + '-Bold.ttf', boldB64);
                this.addFont(fontFamily + '.ttf', fontFamily, 'normal');
                this.addFont(fontFamily + '-Bold.ttf', fontFamily, 'bold');
            }]);
            _state.loaded = true;
        })();

        return _state.loadingPromise.catch(function(err) {
            _state.loadingPromise = null;
            throw err;
        });
    }

    /**
     * Fire-and-forget preload — useful when you can predict the user
     * will print soon (e.g. they entered the Sheet view). Calling this
     * early lets the ~370 KB CDN fetch finish before the user clicks
     * Print, avoiding the "popup blocked because gesture expired"
     * problem that happens when loadAssets runs inside the click handler.
     */
    function preloadAssets(opts) {
        if (_state.loaded || _state.loadingPromise) return;
        loadAssets(opts).catch(function(e) {
            console.warn('[pdf-generator] preload failed (will retry on demand):', e);
        });
    }

    /**
     * True after loadAssets() has finished successfully at least once.
     */
    function isReady() { return _state.loaded; }

    // ----- Public API -----

    SeShared.print.pdfGenerator = {
        version: '1.0.0',
        // CDN URLs (overridable via setUrls if you need to mirror)
        URLS: {
            jspdf: JSPDF_URL,
            autotable: JSPDF_AUTOTABLE_URL,
            sarabunRegular: SARABUN_REG_URL,
            sarabunBold: SARABUN_BOLD_URL,
        },
        DEFAULT_FONT_FAMILY: DEFAULT_FONT_FAMILY,
        PAPER_SIZES_MM: PAPER_SIZES_MM,
        // Asset loaders
        loadAssets: loadAssets,
        preloadAssets: preloadAssets,
        isReady: isReady,
        // Layout math
        paperToOrientedMm: paperToOrientedMm,
        computePrintableArea: computePrintableArea,
        computeScaleFactor: computeScaleFactor,
        computePageLayout: computePageLayout,
        splitColumnsForPages: splitColumnsForPages,
        // Utility
        arrayBufferToBase64: arrayBufferToBase64,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { SeShared: SeShared };
    }
})(typeof window !== 'undefined' ? window : globalThis);
