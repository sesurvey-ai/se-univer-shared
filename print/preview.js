/*!
 * SeShared.print.preview
 *
 * Print-helper utilities for web apps — primarily for canvas-based UIs
 * (Univer, Konva, Fabric) where the browser's native @media print rules
 * don't apply because content is drawn to <canvas>, not the DOM.
 *
 * Repo:    https://github.com/sesurvey-ai/se-univer-shared
 * License: MIT
 *
 * USAGE (browser, drop-in via CDN):
 *
 *   <script src="https://cdn.jsdelivr.net/gh/sesurvey-ai/se-univer-shared@v1.1.0/print/preview.js"></script>
 *   <script>
 *     // Hijack Ctrl+P so the user gets your custom print flow:
 *     SeShared.print.preview.interceptPrintShortcut(() => myPrintFn());
 *
 *     // Print a generated PDF blob (e.g. from jsPDF):
 *     const pdfBlob = doc.output('blob');
 *     SeShared.print.preview.printPdfBlob(pdfBlob, { filename: 'report.pdf' });
 *   </script>
 *
 * WHAT IT SOLVES:
 *
 *   1. Canvas-based apps (Univer Sheets, etc.) render to a <canvas>
 *      element. Browser's default Ctrl+P / native print dialog uses
 *      @media print to traverse the DOM — but canvas content can't be
 *      scraped that way → users get a blank page. interceptPrintShortcut
 *      lets you route Ctrl+P to your own print logic (e.g. PDF export).
 *
 *   2. Once you've generated a PDF, the typical flow is to open it in a
 *      new tab and let the user click the tab's print button. Two extra
 *      clicks. printPdfBlob opens a popup + auto-fires window.print() so
 *      the user sees the native print dialog immediately. Falls back to
 *      a regular download if popups are blocked.
 */
(function(global) {
    'use strict';

    var SeShared = global.SeShared = global.SeShared || {};
    SeShared.print = SeShared.print || {};

    // ----- printPdfBlob / printPdfUrl -----

    /**
     * Print a PDF blob: open in a popup window and auto-trigger the
     * browser's print dialog there. Falls back to a regular download if
     * the popup is blocked (e.g. user gesture expired during slow PDF
     * generation).
     *
     * @param {Blob} blob - The PDF blob (e.g. jsPDF's doc.output('blob'))
     * @param {Object} [opts]
     * @param {string} [opts.filename='document.pdf']
     *        Used as the popup's window name and the download fallback name
     * @param {number} [opts.printDelay=300]
     *        ms to wait after popup load before calling print() — gives
     *        the embedded PDF viewer time to render
     * @param {number} [opts.urlRevokeDelay=60000]
     *        ms to wait before URL.revokeObjectURL() on the blob URL
     * @returns {{ success: boolean, method: 'popup'|'download' }}
     */
    function printPdfBlob(blob, opts) {
        if (!(blob instanceof Blob)) {
            throw new TypeError('printPdfBlob: first argument must be a Blob');
        }
        var url = URL.createObjectURL(blob);
        try {
            return printPdfUrl(url, Object.assign(
                { revokeUrlOnFinish: true }, opts || {}));
        } catch (e) {
            URL.revokeObjectURL(url);
            throw e;
        }
    }

    /**
     * Print a PDF from an existing URL (blob: or http: URL).
     *
     * @param {string} url - URL pointing to the PDF
     * @param {Object} [opts] - same as printPdfBlob plus:
     * @param {boolean} [opts.revokeUrlOnFinish=false]
     *        If true, calls URL.revokeObjectURL(url) after urlRevokeDelay
     * @returns {{ success: boolean, method: 'popup'|'download' }}
     */
    function printPdfUrl(url, opts) {
        opts = opts || {};
        var filename = opts.filename || 'document.pdf';
        var printDelay = opts.printDelay != null ? opts.printDelay : 300;
        var urlRevokeDelay = opts.urlRevokeDelay != null
            ? opts.urlRevokeDelay : 60000;
        var revokeUrlOnFinish = !!opts.revokeUrlOnFinish;

        var maybeRevoke = function() {
            if (revokeUrlOnFinish) {
                setTimeout(function() { URL.revokeObjectURL(url); },
                    urlRevokeDelay);
            }
        };

        // Try popup first: window.open the PDF, wait for load, auto-print.
        // window.print() inside the popup works because we hold a
        // same-window reference (we opened it). Chrome's PDF viewer
        // prints the PDF, not the wrapping page.
        var win = global.open(url, '_blank');
        if (win) {
            var trigger = function() {
                try { win.focus(); win.print(); }
                catch (e) {
                    /* PDF viewer cross-frame restriction — user can
                       still print manually via the viewer's toolbar */
                    console.warn('[print.preview] popup.print failed:', e);
                }
            };
            if (win.document && win.document.readyState === 'complete') {
                setTimeout(trigger, printDelay);
            } else {
                win.addEventListener('load', function() {
                    setTimeout(trigger, printDelay);
                });
                // Safety net for PDF viewer quirks where load doesn't fire
                setTimeout(trigger, Math.max(printDelay * 5, 1500));
            }
            maybeRevoke();
            return { success: true, method: 'popup' };
        }

        // Popup blocked — fall back to <a download>. Bulletproof since
        // anchor clicks aren't intercepted by popup blockers.
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        maybeRevoke();
        return { success: true, method: 'download' };
    }

    // ----- interceptPrintShortcut -----

    /**
     * Install a global Ctrl+P / Cmd+P handler that runs your custom
     * print function instead of the browser's native print dialog.
     *
     * The default Ctrl+P uses @media print rules — for canvas-rendered
     * UIs (Univer Sheets, etc.) that produces a blank page since canvas
     * content isn't part of the printable DOM. Route to your own
     * generator (PDF export, page-setup modal, ...) instead.
     *
     * @param {Function} handler - invoked with the keyboard event when
     *        Ctrl+P (or Cmd+P on Mac) is pressed without modifiers
     * @returns {Function} call to uninstall the handler
     */
    function interceptPrintShortcut(handler) {
        if (typeof handler !== 'function') {
            throw new TypeError('interceptPrintShortcut: handler must be a function');
        }
        var listener = function(e) {
            var isPrintKey = (e.ctrlKey || e.metaKey)
                && !e.altKey && !e.shiftKey
                && (e.key === 'p' || e.key === 'P');
            if (!isPrintKey) return;
            e.preventDefault();
            e.stopPropagation();
            try { handler(e); }
            catch (err) {
                console.error('[print.preview] handler threw:', err);
            }
        };
        // Capture phase so we beat any nested handler in the page.
        document.addEventListener('keydown', listener, true);
        return function uninstall() {
            document.removeEventListener('keydown', listener, true);
        };
    }

    // ----- Public API -----

    SeShared.print.preview = {
        version: '1.0.0',
        printPdfBlob: printPdfBlob,
        printPdfUrl: printPdfUrl,
        interceptPrintShortcut: interceptPrintShortcut,
    };

    // CommonJS compat for Node-based unit tests
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { SeShared: SeShared };
    }
})(typeof window !== 'undefined' ? window : globalThis);
