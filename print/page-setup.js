/*!
 * SeShared.print.pageSetup
 *
 * Drop-in Page Setup modal for web apps (Univer, Konva, etc) — handles
 * UI + state + localStorage persistence. Consumer wires in their own
 * print/preview pipeline via callbacks.
 *
 * Repo:    https://github.com/sesurvey-ai/se-univer-shared
 * License: MIT
 *
 * QUICK START:
 *
 *   <script src="https://cdn.jsdelivr.net/gh/sesurvey-ai/se-univer-shared@v1.2.0/print/page-setup.js"></script>
 *   <script>
 *     const ps = SeShared.print.pageSetup.init({
 *         storageKey: 'my_app_page_setup',
 *         onSave: (state) => {
 *             // user clicked "ถัดไป" — state has paperSize/orientation/
 *             // margins/scaling/printArea/etc. Run your print pipeline.
 *             startPrintWith(state);
 *         },
 *         onPreviewRequest: async (state) => {
 *             // optional — return a PDF Blob; modal renders it via
 *             // PDF.js into the preview canvas. Skip to hide preview.
 *             return await myCustomPdfRenderer(state);
 *         },
 *     });
 *     ps.open();   // show modal
 *   </script>
 *
 * STATE SCHEMA:
 *
 *   {
 *     paperSize:      'a4' | 'a3' | 'a5' | 'letter' | 'legal',
 *     orientation:    'portrait' | 'landscape',
 *     marginTop, marginBottom, marginLeft, marginRight: mm (number),
 *     header, footer: boolean,
 *     scaling:        'full' | 'fit' | 'percent',
 *     fitWide, fitTall: number (only when scaling='fit')
 *     scalePercent:   number (only when scaling='percent')
 *     repeatRowStart, repeatRowEnd: 1-based row numbers (0 = no repeat)
 *     repeatColStart, repeatColEnd: 1-based col indices (0 = no repeat)
 *     printArea:      A1-style range like "A1:G100" ("" = entire sheet)
 *     blackAndWhite:  boolean
 *   }
 */
(function(global) {
    'use strict';

    var SeShared = global.SeShared = global.SeShared || {};
    SeShared.print = SeShared.print || {};

    // ----- Constants -----

    var DEFAULTS = {
        paperSize: 'a4',
        orientation: 'portrait',
        marginTop: 19, marginBottom: 19,
        marginLeft: 18, marginRight: 18,
        header: false, footer: false,
        scaling: 'full',
        fitWide: 1, fitTall: 0,
        scalePercent: 100,
        repeatRowStart: 0, repeatRowEnd: 0,
        repeatColStart: 0, repeatColEnd: 0,
        printArea: '',
        blackAndWhite: false,
    };

    // Excel-equivalent margin presets (mm). Anything not matching one of
    // these triples falls through to "custom" in the dropdown.
    var MARGIN_PRESETS = {
        normal: { top: 19, bottom: 19, left: 18, right: 18 },
        narrow: { top: 6,  bottom: 6,  left: 6,  right: 6  },
        wide:   { top: 25, bottom: 25, left: 25, right: 25 },
    };

    // ----- Pure utilities -----

    /** 0-based column index → A1-style letter ("A", "Z", "AA"…). */
    function colIdxToLetter(idx) {
        if (idx == null || idx < 0) return '';
        var n = idx + 1, s = '';
        while (n > 0) {
            var rem = (n - 1) % 26;
            s = String.fromCharCode(65 + rem) + s;
            n = Math.floor((n - 1) / 26);
        }
        return s;
    }

    /** "A" / "Z" / "AA" → 0-based column index. -1 on bad input. */
    function letterToColIdx(letter) {
        if (!letter) return -1;
        var s = String(letter).toUpperCase().replace(/[^A-Z]/g, '');
        if (!s) return -1;
        var n = 0;
        for (var i = 0; i < s.length; i++) {
            n = n * 26 + (s.charCodeAt(i) - 64);
        }
        return n - 1;
    }

    function marginPresetFromState(state) {
        for (var k in MARGIN_PRESETS) {
            var p = MARGIN_PRESETS[k];
            if (state.marginTop === p.top && state.marginBottom === p.bottom
                && state.marginLeft === p.left && state.marginRight === p.right) {
                return k;
            }
        }
        return 'custom';
    }

    function scalingPresetFromState(state) {
        if (!state.scaling || state.scaling === 'full') return 'full';
        if (state.scaling === 'percent') return 'percent';
        if (state.scaling === 'fit') {
            if (state.fitWide === 1 && state.fitTall === 0) return 'fitwidth';
            if (state.fitWide === 0 && state.fitTall === 1) return 'fitheight';
            if (state.fitWide === 1 && state.fitTall === 1) return 'fitpage';
        }
        return 'full';
    }

    // ----- localStorage -----

    function loadState(storageKey) {
        try {
            var raw = localStorage.getItem(storageKey);
            if (!raw) return Object.assign({}, DEFAULTS);
            return Object.assign({}, DEFAULTS, JSON.parse(raw));
        } catch (e) {
            return Object.assign({}, DEFAULTS);
        }
    }

    function saveState(state, storageKey) {
        try { localStorage.setItem(storageKey, JSON.stringify(state)); }
        catch (e) { console.warn('[page-setup] localStorage write failed:', e); }
    }

    // ----- CSS (injected once on first init) -----

    var CSS = (
        '.psh-modal-overlay{position:fixed;inset:0;background:rgba(15,23,42,0.5);' +
        'display:flex;align-items:center;justify-content:center;z-index:1000;' +
        'padding:16px;font-family:"Segoe UI",Tahoma,sans-serif;color:#1e293b;}' +
        '.psh-card{--bg:#fff;--ink:#1a3a4d;--accent:#c44a2c;--paper:#fff;' +
        '--ink-12:rgba(26,58,77,.12);--ink-18:rgba(26,58,77,.18);' +
        '--ink-32:rgba(26,58,77,.32);--ink-55:rgba(26,58,77,.55);' +
        '--ink-72:rgba(26,58,77,.72);--surface:#fff;--surface-2:#f4f5f7;' +
        'background:var(--paper);border-radius:14px;width:100%;max-width:1280px;' +
        'height:92vh;max-height:92vh;display:flex;flex-direction:column;' +
        'box-shadow:0 1px 3px rgba(0,0,0,.06),0 24px 60px -8px rgba(26,58,77,.28);' +
        'font-size:14px;color:var(--ink);' +
        'font-family:"IBM Plex Sans Thai",system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif;' +
        '-webkit-font-smoothing:antialiased;overflow:hidden;}' +
        '.psh-topbar{display:flex;align-items:center;gap:14px;padding:16px 22px;' +
        'border-bottom:1px solid var(--ink-12);background:var(--paper);}' +
        '.psh-title{font-size:18px;font-weight:600;color:var(--ink);letter-spacing:-.01em;}' +
        '.psh-count{font-size:11px;color:var(--ink-55);' +
        'font-family:"IBM Plex Mono",ui-monospace,monospace;letter-spacing:.02em;}' +
        '.psh-spacer{flex:1;}' +
        '.psh-body{flex:1 1 auto;display:flex;min-height:0;}' +
        '.psh-footbar{display:flex;align-items:center;gap:8px;padding:12px 24px;' +
        'border-top:1px solid var(--ink-12);background:var(--surface);}' +
        '.psh-preview-area{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;' +
        'position:relative;background:var(--surface-2);padding:28px 28px 80px;gap:14px;}' +
        '.psh-canvas-wrap{flex:1 1 auto;min-height:0;overflow:auto;' +
        'display:flex;align-items:flex-start;justify-content:center;}' +
        '.psh-canvas-inner{position:relative;display:inline-block;background:var(--paper);' +
        'border-radius:2px;box-shadow:0 1px 1px rgba(0,0,0,.04),0 4px 16px rgba(0,0,0,.06),' +
        '0 24px 60px -16px rgba(0,0,0,.18);}' +
        '.psh-canvas-inner canvas{display:block;max-width:100%;height:auto;border-radius:2px;}' +
        '.psh-margin-overlay{position:absolute;inset:0;pointer-events:none;}' +
        '.psh-margin-line{position:absolute;border-color:var(--ink-18);' +
        'border-style:dashed;border-width:0;}' +
        '.psh-margin-line-top{top:0;left:0;right:0;border-top-width:1px;}' +
        '.psh-margin-line-bottom{bottom:0;left:0;right:0;border-top-width:1px;}' +
        '.psh-margin-line-left{top:0;bottom:0;left:0;border-left-width:1px;}' +
        '.psh-margin-line-right{top:0;bottom:0;right:0;border-left-width:1px;}' +
        '.psh-page-nav{position:absolute;bottom:20px;left:50%;transform:translateX(-50%);' +
        'display:inline-flex;align-items:center;gap:4px;background:#fff;' +
        'border:1px solid var(--ink-12);border-radius:100px;padding:4px;z-index:2;}' +
        '.psh-nav-btn{background:transparent;border:0;color:var(--ink-72);' +
        'width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center;' +
        'border-radius:100px;cursor:pointer;font-size:14px;font-family:inherit;line-height:1;' +
        'transition:background .15s,color .15s;}' +
        '.psh-nav-btn:hover{background:var(--ink-12);color:var(--ink);}' +
        '.psh-nav-btn:disabled{opacity:.35;cursor:not-allowed;}' +
        '.psh-nav-label{font-family:"IBM Plex Mono",ui-monospace,monospace;' +
        'font-size:11px;color:var(--ink-72);padding:0 8px;font-variant-numeric:tabular-nums;' +
        'letter-spacing:.02em;min-width:40px;text-align:center;}' +
        '.psh-sidebar{flex:0 0 380px;border-left:1px solid var(--ink-12);overflow:auto;' +
        'background:var(--surface);display:flex;flex-direction:column;}' +
        '.psh-sidebar .psh-form{padding:22px 24px 18px;}' +
        '.psh-card .psh-form-row{display:flex;flex-direction:column;margin-bottom:16px;gap:8px;}' +
        '.psh-card .psh-form-row > label.psh-field-label{font-size:11.5px;' +
        'color:var(--ink-72);font-weight:500;font-family:inherit;}' +
        '.psh-card select,.psh-card input[type=number],.psh-card input[type=text]{' +
        'width:100%;padding:11px 14px;font-size:13px;border:1px solid var(--ink-18);' +
        'border-radius:8px;background:var(--paper);color:var(--ink);font-family:inherit;' +
        'transition:border-color .15s,box-shadow .15s;}' +
        '.psh-card select{appearance:none;-webkit-appearance:none;padding-right:36px;' +
        'background-image:url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 16 16\' fill=\'none\' stroke=\'%231a3a4d\' stroke-opacity=\'0.55\' stroke-width=\'1.6\' stroke-linecap=\'round\' stroke-linejoin=\'round\'><polyline points=\'4 6 8 10 12 6\'/></svg>");' +
        'background-repeat:no-repeat;background-position:right 12px center;' +
        'background-size:16px 16px;cursor:pointer;}' +
        '.psh-card input[type=number]{font-family:"IBM Plex Mono",ui-monospace,monospace;' +
        'font-size:12.5px;text-align:center;width:64px;padding:8px 10px;}' +
        '.psh-card select:hover,.psh-card input:hover{border-color:var(--ink-32);}' +
        '.psh-card select:focus,.psh-card input:focus{outline:none;border-color:var(--accent);' +
        'box-shadow:0 0 0 3px rgba(196,74,44,.18);}' +
        '.psh-radio-bar{display:flex;gap:0;background:rgba(26,58,77,.08);padding:3px;' +
        'border-radius:7px;border:1px solid var(--ink-12);}' +
        '.psh-radio-bar label{flex:1;text-align:center;border:none;padding:8px 12px;' +
        'border-radius:5px;cursor:pointer;font-size:12.5px;background:transparent;' +
        'color:var(--ink-55);transition:background .2s,color .2s,box-shadow .2s;}' +
        '.psh-radio-bar label:has(input:checked){background:var(--paper);color:var(--ink);' +
        'font-weight:500;box-shadow:0 1px 2px rgba(0,0,0,.06);}' +
        '.psh-radio-bar input{display:none;}' +
        '.psh-sub-form{margin-top:0;}' +
        '.psh-group{margin-top:6px;padding-top:14px;border-top:1px solid var(--ink-12);}' +
        '.psh-group-title{padding:0 0 10px 0;font-size:11px;font-weight:600;color:var(--ink);}' +
        '.psh-group-body{padding:0 0 6px 0;display:flex;flex-direction:column;gap:4px;}' +
        '.psh-margins-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:6px;}' +
        '.psh-margins-grid label{font-size:11.5px;color:var(--ink-72);display:flex;' +
        'flex-direction:column;gap:4px;align-items:flex-start;}' +
        '.psh-margins-grid input{width:100%;}' +
        '.psh-card .psh-check-row{display:flex;align-items:center;justify-content:space-between;' +
        'gap:12px;padding:6px 0;font-size:13px;color:var(--ink);cursor:pointer;}' +
        '.psh-card .psh-group .psh-check-row input[type=checkbox]{appearance:none;' +
        '-webkit-appearance:none;width:32px;height:19px;background:var(--ink-18);' +
        'border-radius:100px;position:relative;cursor:pointer;transition:background .2s;' +
        'flex-shrink:0;margin:0;order:2;}' +
        '.psh-card .psh-group .psh-check-row input[type=checkbox]::after{content:"";' +
        'position:absolute;top:2px;left:2px;width:15px;height:15px;background:var(--paper);' +
        'border-radius:100px;box-shadow:0 1px 2px rgba(0,0,0,.18);' +
        'transition:transform .2s cubic-bezier(.3,.7,.3,1);}' +
        '.psh-card .psh-group .psh-check-row input[type=checkbox]:checked{background:var(--accent);}' +
        '.psh-card .psh-group .psh-check-row input[type=checkbox]:checked::after{transform:translateX(13px);}' +
        '.psh-card .psh-btn{padding:10px 18px;font-size:13px;font-weight:500;' +
        'border-radius:8px;border:1px solid transparent;font-family:inherit;cursor:pointer;' +
        'transition:background .15s,border-color .15s,color .15s,transform .05s;}' +
        '.psh-card .psh-btn:active{transform:translateY(.5px);}' +
        '.psh-card .psh-btn.primary{background:var(--ink);color:var(--paper);' +
        'border-color:var(--ink);}' +
        '.psh-card .psh-btn.primary:hover{background:rgba(26,58,77,.85);}' +
        '.psh-card .psh-btn.secondary{background:transparent;color:var(--ink-72);}' +
        '.psh-card .psh-btn.secondary:hover{background:var(--ink-12);color:var(--ink);}' +
        '@media (max-width:1100px){.psh-card{max-width:100vw;max-height:100vh;height:100vh;' +
        'border-radius:0;}.psh-body{flex-direction:column;}.psh-sidebar{flex:0 0 auto;' +
        'border-left:none;border-top:1px solid var(--ink-12);max-height:50vh;}' +
        '.psh-preview-area{padding:14px 14px 70px 14px;}}'
    );

    // ----- HTML template (Thai labels) -----

    var HTML_TEMPLATE = (
        '<div class="psh-card">' +
          '<div class="psh-topbar">' +
            '<span class="psh-title">การตั้งค่าการพิมพ์</span>' +
            '<span class="psh-count">ทั้งหมด: <span data-psh="pageCount">—</span> หน้า</span>' +
            '<span class="psh-spacer"></span>' +
            '<button type="button" class="psh-btn secondary" data-psh="cancel">ยกเลิก</button>' +
            '<button type="button" class="psh-btn primary" data-psh="next">ถัดไป</button>' +
          '</div>' +
          '<div class="psh-body">' +
            '<div class="psh-preview-area">' +
              '<div class="psh-canvas-wrap">' +
                '<div class="psh-canvas-inner">' +
                  '<canvas data-psh="canvas"></canvas>' +
                  '<div class="psh-margin-overlay">' +
                    '<div class="psh-margin-line psh-margin-line-top"></div>' +
                    '<div class="psh-margin-line psh-margin-line-bottom"></div>' +
                    '<div class="psh-margin-line psh-margin-line-left"></div>' +
                    '<div class="psh-margin-line psh-margin-line-right"></div>' +
                  '</div>' +
                '</div>' +
              '</div>' +
              '<div class="psh-page-nav">' +
                '<button type="button" class="psh-nav-btn" data-psh="navPrev" title="ก่อนหน้า">&#9664;</button>' +
                '<span class="psh-nav-label"><span data-psh="navCurrent">1</span> / <span data-psh="navTotal">1</span></span>' +
                '<button type="button" class="psh-nav-btn" data-psh="navNext" title="ถัดไป">&#9654;</button>' +
              '</div>' +
            '</div>' +
            '<aside class="psh-sidebar"><div class="psh-form">' +
              _row('พิมพ์',
                '<select data-psh="psPrintScope">' +
                  '<option value="current">แผ่นงานปัจจุบัน</option>' +
                  '<option value="selection">เซลล์ที่เลือก</option>' +
                '</select>') +
              _row('ขนาดกระดาษ',
                '<select data-psh="psPaperSize">' +
                  '<option value="a4">A4 (21.0cm × 29.7cm)</option>' +
                  '<option value="a3">A3 (29.7cm × 42.0cm)</option>' +
                  '<option value="a5">A5 (14.8cm × 21.0cm)</option>' +
                  '<option value="letter">Letter (21.6cm × 27.9cm)</option>' +
                  '<option value="legal">Legal (21.6cm × 35.6cm)</option>' +
                '</select>') +
              _row('การวางแนวของหน้า',
                '<div class="psh-radio-bar">' +
                  '<label><input type="radio" name="pshOri" value="portrait"> แนวตั้ง</label>' +
                  '<label><input type="radio" name="pshOri" value="landscape"> แนวนอน</label>' +
                '</div>') +
              _row('สเกล',
                '<div style="display:flex;align-items:center;gap:8px;">' +
                  '<select data-psh="psScalingPreset" style="flex:1;min-width:0;">' +
                    '<option value="full">ขนาดเต็ม 100%</option>' +
                    '<option value="fitwidth">พอดีกับความกว้าง (1 หน้ากว้าง)</option>' +
                    '<option value="fitheight">พอดีกับความยาว (1 หน้ายาว)</option>' +
                    '<option value="fitpage">พอดีกับหน้า (1×1)</option>' +
                    '<option value="percent">กำหนดตัวเลขเอง…</option>' +
                  '</select>' +
                  '<span data-psh="psScalingCustom" style="display:none;white-space:nowrap;">' +
                    '<input type="number" data-psh="psScalePercent" min="10" max="400" step="5" style="width:64px;"> %' +
                  '</span>' +
                '</div>') +
              _row('ขอบ',
                '<select data-psh="psMarginPreset">' +
                  '<option value="normal">ปกติ (1.91/1.91/1.78/1.78 cm)</option>' +
                  '<option value="narrow">แคบ (0.64/0.64/0.64/0.64 cm)</option>' +
                  '<option value="wide">กว้าง (2.54/2.54/2.54/2.54 cm)</option>' +
                  '<option value="custom">กำหนดตัวเลขเอง…</option>' +
                '</select>' +
                '<div class="psh-sub-form" data-psh="psMarginCustom" style="display:none">' +
                  '<div class="psh-margins-grid">' +
                    '<label>บน <input type="number" data-psh="psMarginTop" min="0" max="50" step="1"></label>' +
                    '<label>ล่าง <input type="number" data-psh="psMarginBottom" min="0" max="50" step="1"></label>' +
                    '<label>ซ้าย <input type="number" data-psh="psMarginLeft" min="0" max="50" step="1"></label>' +
                    '<label>ขวา <input type="number" data-psh="psMarginRight" min="0" max="50" step="1"></label>' +
                  '</div>' +
                '</div>') +
              '<div class="psh-group">' +
                '<div class="psh-group-title">การจัดรูปแบบ</div>' +
                '<div class="psh-group-body">' +
                  '<label class="psh-check-row">' +
                    '<input type="checkbox" data-psh="psBlackAndWhite"> พิมพ์ขาว-ดำ (ไม่ใช้สี bg / text)' +
                  '</label>' +
                '</div>' +
              '</div>' +
              '<div class="psh-group">' +
                '<div class="psh-group-title">ส่วนหัวและส่วนท้าย</div>' +
                '<div class="psh-group-body">' +
                  '<label class="psh-check-row"><input type="checkbox" data-psh="psHeader"> แสดงหัวกระดาษ</label>' +
                  '<label class="psh-check-row"><input type="checkbox" data-psh="psFooter"> แสดงเลขหน้าด้านล่าง</label>' +
                '</div>' +
              '</div>' +
              '<div class="psh-group">' +
                '<div class="psh-group-title">พิมพ์ซ้ำทุกหน้า (Print Titles)</div>' +
                '<div class="psh-group-body">' +
                  '<label class="psh-check-row">แถวบนสุดที่ซ้ำ: row' +
                    '<input type="number" data-psh="psRepeatRowStart" min="0" max="999" step="1" style="width:56px;margin:0 4px;"> ถึง' +
                    '<input type="number" data-psh="psRepeatRowEnd" min="0" max="999" step="1" style="width:56px;margin:0 4px;">' +
                  '</label>' +
                  '<label class="psh-check-row">คอลัมน์ซ้ายที่ซ้ำ: column' +
                    '<input type="text" data-psh="psRepeatColStart" maxlength="3" placeholder="A" style="width:48px;margin:0 4px;text-transform:uppercase;"> ถึง' +
                    '<input type="text" data-psh="psRepeatColEnd" maxlength="3" placeholder="A" style="width:48px;margin:0 4px;text-transform:uppercase;">' +
                  '</label>' +
                '</div>' +
              '</div>' +
              '<input type="hidden" data-psh="psPrintArea" value="">' +
            '</div></aside>' +
          '</div>' +
          '<div class="psh-footbar">' +
            '<button type="button" class="psh-btn secondary" data-psh="reset">รีเซ็ตค่าเริ่มต้น</button>' +
            '<span class="psh-spacer"></span>' +
          '</div>' +
        '</div>'
    );

    function _row(label, body) {
        return '<div class="psh-form-row"><label class="psh-field-label">'
            + label + '</label>' + body + '</div>';
    }

    // ----- CSS injection (idempotent) -----

    var _cssInjected = false;
    function _injectCss() {
        if (_cssInjected) return;
        var style = document.createElement('style');
        style.setAttribute('data-psh-styles', '1');
        style.textContent = CSS;
        document.head.appendChild(style);
        _cssInjected = true;
    }

    // ----- Form ↔ state binding -----

    function _qs(root, name) {
        return root.querySelector('[data-psh="' + name + '"]');
    }

    function _seedForm(root, state) {
        _qs(root, 'psPaperSize').value = state.paperSize;
        var ori = root.querySelector('input[name=pshOri][value=' + state.orientation + ']');
        if (ori) ori.checked = true;
        _qs(root, 'psMarginTop').value = state.marginTop;
        _qs(root, 'psMarginBottom').value = state.marginBottom;
        _qs(root, 'psMarginLeft').value = state.marginLeft;
        _qs(root, 'psMarginRight').value = state.marginRight;
        _qs(root, 'psHeader').checked = !!state.header;
        _qs(root, 'psFooter').checked = !!state.footer;
        var scalingPreset = scalingPresetFromState(state);
        _qs(root, 'psScalingPreset').value = scalingPreset;
        _qs(root, 'psScalePercent').value = state.scalePercent || 100;
        _qs(root, 'psScalingCustom').style.display =
            (scalingPreset === 'percent') ? '' : 'none';
        var marginPreset = marginPresetFromState(state);
        _qs(root, 'psMarginPreset').value = marginPreset;
        _qs(root, 'psMarginCustom').style.display =
            (marginPreset === 'custom') ? '' : 'none';
        _qs(root, 'psRepeatRowStart').value = state.repeatRowStart > 0 ? state.repeatRowStart : 0;
        _qs(root, 'psRepeatRowEnd').value = state.repeatRowEnd > 0 ? state.repeatRowEnd : 0;
        _qs(root, 'psRepeatColStart').value =
            state.repeatColStart > 0 ? colIdxToLetter(state.repeatColStart - 1) : '';
        _qs(root, 'psRepeatColEnd').value =
            state.repeatColEnd > 0 ? colIdxToLetter(state.repeatColEnd - 1) : '';
        _qs(root, 'psPrintArea').value = state.printArea || '';
        _qs(root, 'psBlackAndWhite').checked = !!state.blackAndWhite;
    }

    function _readForm(root) {
        var oriEl = root.querySelector('input[name=pshOri]:checked');
        var colStart = letterToColIdx(_qs(root, 'psRepeatColStart').value);
        var colEnd = letterToColIdx(_qs(root, 'psRepeatColEnd').value);
        var scalingPreset = _qs(root, 'psScalingPreset').value || 'full';
        var scaling = 'full', fitWide = 1, fitTall = 0;
        if (scalingPreset === 'fitwidth') { scaling = 'fit'; fitWide = 1; fitTall = 0; }
        else if (scalingPreset === 'fitheight') { scaling = 'fit'; fitWide = 0; fitTall = 1; }
        else if (scalingPreset === 'fitpage') { scaling = 'fit'; fitWide = 1; fitTall = 1; }
        else if (scalingPreset === 'percent') { scaling = 'percent'; }
        return {
            paperSize: _qs(root, 'psPaperSize').value || 'a4',
            orientation: (oriEl && oriEl.value) || 'landscape',
            marginTop: +_qs(root, 'psMarginTop').value || 0,
            marginBottom: +_qs(root, 'psMarginBottom').value || 0,
            marginLeft: +_qs(root, 'psMarginLeft').value || 0,
            marginRight: +_qs(root, 'psMarginRight').value || 0,
            header: _qs(root, 'psHeader').checked,
            footer: _qs(root, 'psFooter').checked,
            scaling: scaling,
            fitWide: fitWide, fitTall: fitTall,
            scalePercent: Math.max(10, Math.min(400,
                +_qs(root, 'psScalePercent').value || 100)),
            repeatRowStart: Math.max(0, +_qs(root, 'psRepeatRowStart').value || 0),
            repeatRowEnd: Math.max(0, +_qs(root, 'psRepeatRowEnd').value || 0),
            repeatColStart: colStart >= 0 ? colStart + 1 : 0,
            repeatColEnd: colEnd >= 0 ? colEnd + 1 : 0,
            printArea: _qs(root, 'psPrintArea').value.trim().toUpperCase(),
            blackAndWhite: _qs(root, 'psBlackAndWhite').checked,
        };
    }

    // ----- init -----

    /**
     * Initialize the Page Setup modal. Idempotent CSS injection — safe
     * to call multiple times for multiple modal instances.
     *
     * @param {Object} [opts]
     * @param {string} [opts.storageKey='se_page_setup_v1']
     * @param {HTMLElement} [opts.container=document.body]
     *        Where to append the modal overlay
     * @param {Function} [opts.onSave]
     *        (state) => void — called when user clicks "ถัดไป"
     * @param {Function} [opts.onReset]
     *        () => void — called when user clicks "รีเซ็ตค่าเริ่มต้น"
     * @param {Function} [opts.onClose]
     *        () => void — called when modal closes (any reason)
     * @returns {Object} control API
     */
    function init(opts) {
        opts = opts || {};
        var storageKey = opts.storageKey || 'se_page_setup_v1';
        var container = opts.container || document.body;

        _injectCss();

        var overlay = document.createElement('div');
        overlay.className = 'psh-modal-overlay';
        overlay.style.display = 'none';
        overlay.innerHTML = HTML_TEMPLATE;
        container.appendChild(overlay);

        // Click overlay (outside the card) to close
        overlay.addEventListener('click', function(e) {
            if (e.target === overlay) close();
        });

        // Cancel button
        _qs(overlay, 'cancel').addEventListener('click', close);

        // Next button → emit save with current form state
        _qs(overlay, 'next').addEventListener('click', function() {
            var state = _readForm(overlay);
            saveState(state, storageKey);
            if (typeof opts.onSave === 'function') {
                try { opts.onSave(state); }
                catch (err) { console.error('[page-setup] onSave threw:', err); }
            }
            close();
        });

        // Reset button → reseed form with defaults (don't persist until Next)
        _qs(overlay, 'reset').addEventListener('click', function() {
            _seedForm(overlay, Object.assign({}, DEFAULTS));
            if (typeof opts.onReset === 'function') {
                try { opts.onReset(); }
                catch (err) { console.error('[page-setup] onReset threw:', err); }
            }
        });

        // Re-show/hide custom sub-forms when their dropdown changes
        _qs(overlay, 'psScalingPreset').addEventListener('change', function(e) {
            _qs(overlay, 'psScalingCustom').style.display =
                (e.target.value === 'percent') ? '' : 'none';
        });
        _qs(overlay, 'psMarginPreset').addEventListener('change', function(e) {
            var p = MARGIN_PRESETS[e.target.value];
            if (p) {
                _qs(overlay, 'psMarginTop').value = p.top;
                _qs(overlay, 'psMarginBottom').value = p.bottom;
                _qs(overlay, 'psMarginLeft').value = p.left;
                _qs(overlay, 'psMarginRight').value = p.right;
                _qs(overlay, 'psMarginCustom').style.display = 'none';
            } else {
                _qs(overlay, 'psMarginCustom').style.display = '';
            }
        });

        function open(openOpts) {
            openOpts = openOpts || {};
            var seed = openOpts.state || loadState(storageKey);
            _seedForm(overlay, seed);
            // Per-print-job scope/print-area: reset to default each open
            // (printArea is normally an in-memory derived value)
            _qs(overlay, 'psPrintArea').value = '';
            _qs(overlay, 'psPrintScope').value = openOpts.scope || 'current';
            overlay.style.display = 'flex';
        }

        function close() {
            overlay.style.display = 'none';
            if (typeof opts.onClose === 'function') {
                try { opts.onClose(); }
                catch (err) { console.error('[page-setup] onClose threw:', err); }
            }
        }

        return {
            open: open,
            close: close,
            getState: function() { return _readForm(overlay); },
            setState: function(state) {
                _seedForm(overlay, Object.assign({}, DEFAULTS, state || {}));
            },
            loadFromStorage: function() {
                _seedForm(overlay, loadState(storageKey));
            },
            saveToStorage: function() {
                saveState(_readForm(overlay), storageKey);
            },
            getOverlayEl: function() { return overlay; },
            getCanvasEl: function() { return _qs(overlay, 'canvas'); },
            destroy: function() {
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            },
        };
    }

    // ----- Public API -----

    SeShared.print.pageSetup = {
        version: '1.0.0',
        DEFAULTS: DEFAULTS,
        MARGIN_PRESETS: MARGIN_PRESETS,
        colIdxToLetter: colIdxToLetter,
        letterToColIdx: letterToColIdx,
        marginPresetFromState: marginPresetFromState,
        scalingPresetFromState: scalingPresetFromState,
        loadState: loadState,
        saveState: saveState,
        init: init,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { SeShared: SeShared };
    }
})(typeof window !== 'undefined' ? window : globalThis);
