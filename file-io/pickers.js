/*!
 * SeShared.fileIo.pickers
 *
 * Cross-browser file save/open helpers. Uses the File System Access API
 * (Chrome/Edge) for in-place save with persistent file handles; falls
 * back to <a download> / <input type=file> on Firefox/Safari/Brave.
 *
 * Repo:    https://github.com/sesurvey-ai/se-univer-shared
 * License: MIT
 *
 * QUICK START:
 *
 *   <script src="https://cdn.jsdelivr.net/gh/sesurvey-ai/se-univer-shared@v1.4.0/file-io/pickers.js"></script>
 *   <script>
 *     // Save a blob (uses native picker if available, download if not)
 *     const result = await SeShared.fileIo.pickers.saveBlob(blob, {
 *         suggestedName: 'workbook.se.json',
 *         types: [
 *             { description: 'SE workbook',
 *               accept: { 'application/json': ['.se.json'] } },
 *         ],
 *     });
 *     if (result.cancelled) return;
 *     // result.handle is set when method='fsa' — keep it for in-place re-save
 *
 *     // Later: re-save without prompting again
 *     await SeShared.fileIo.pickers.writeBlobToHandle(result.handle, newBlob);
 *
 *     // Open a file
 *     const open = await SeShared.fileIo.pickers.openFile({
 *         types: [{
 *             description: 'SE / Excel workbook',
 *             accept: {
 *                 'application/json': ['.se', '.se.json', '.json'],
 *                 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
 *             },
 *         }],
 *         accept: '.se,.se.json,.json,.xlsx',  // for fallback <input>
 *     });
 *     if (!open.cancelled) processFile(open.file);
 *   </script>
 *
 * WHY THIS EXISTS:
 *
 *   The File System Access API gives you a FileSystemFileHandle you can
 *   keep around — re-saving doesn't prompt, just writes in place. Great
 *   UX where supported (Chrome/Edge on desktop, secure contexts only).
 *
 *   But Firefox, Safari, and Brave (by default) don't implement it.
 *   Those browsers need <a download> for save and <input type=file>
 *   for open. Apps have to write that fallback every time. This module
 *   does the detection + fallback dance once, behind a uniform API.
 *
 *   It also handles the "stale handle" failure (InvalidStateError when
 *   the user moved/deleted the file externally between reads), and the
 *   readwrite permission re-prompt that newer Chromes require.
 */
(function(global) {
    'use strict';

    var SeShared = global.SeShared = global.SeShared || {};
    SeShared.fileIo = SeShared.fileIo || {};

    // ----- Capability detection -----

    /**
     * True if the File System Access API (showOpenFilePicker /
     * showSaveFilePicker) is available in this context.
     *
     * Notes:
     *   - Requires a secure context (HTTPS or localhost)
     *   - Brave ships with the API disabled by default — users can
     *     enable it at brave://flags/#file-system-access-api
     *   - Firefox and Safari don't implement it
     */
    function hasFileSystemAccess() {
        return typeof global.showOpenFilePicker === 'function'
            && typeof global.showSaveFilePicker === 'function';
    }

    // ----- saveBlob -----

    /**
     * Save a blob to disk. Tries the FSA native picker first; falls back
     * to a regular <a download> when unavailable.
     *
     * @param {Blob} blob
     * @param {Object} opts
     * @param {string} opts.suggestedName  — default filename in picker /
     *        download attribute
     * @param {Array<{description: string, accept: Object}>} [opts.types]
     *        File type filters for the native picker (ignored by fallback)
     * @returns {Promise<{
     *     success: boolean,
     *     method: 'fsa' | 'download',
     *     handle?: FileSystemFileHandle,  // present when method='fsa'
     *     name?: string,                  // resolved final filename
     *     cancelled?: boolean,            // true if user cancelled the picker
     * }>}
     */
    async function saveBlob(blob, opts) {
        if (!(blob instanceof Blob)) {
            throw new TypeError('saveBlob: first argument must be a Blob');
        }
        opts = opts || {};
        var suggestedName = opts.suggestedName || 'download';

        if (hasFileSystemAccess()) {
            var handle;
            try {
                handle = await global.showSaveFilePicker({
                    suggestedName: suggestedName,
                    types: opts.types || [],
                    excludeAcceptAllOption: false,
                });
            } catch (e) {
                if (e && e.name === 'AbortError') {
                    return { success: false, method: 'fsa', cancelled: true };
                }
                throw e;
            }
            var f = await handle.getFile();
            await writeBlobToHandle(handle, blob);
            return {
                success: true,
                method: 'fsa',
                handle: handle,
                name: f.name,
            };
        }

        // Fallback: <a download>. Bulletproof — popup blockers can't
        // intercept an anchor click that originates from a real user
        // gesture.
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = suggestedName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        // Revoke after 60s — long enough for the browser to read it,
        // short enough to release the memory.
        setTimeout(function() { URL.revokeObjectURL(url); }, 60000);
        return {
            success: true,
            method: 'download',
            name: suggestedName,
        };
    }

    // ----- openFile -----

    /**
     * Open a file from disk. Tries the FSA native picker first; falls
     * back to <input type="file"> when unavailable.
     *
     * @param {Object} [opts]
     * @param {Array<{description, accept}>} [opts.types]
     *        FSA file type filters (ignored by fallback)
     * @param {string} [opts.accept]
     *        Fallback <input> accept attr (comma-separated MIMEs/exts)
     * @param {boolean} [opts.multiple=false]
     *        Allow multiple file selection
     * @returns {Promise<{
     *     success: boolean,
     *     method: 'fsa' | 'input',
     *     file?: File,                         // single mode
     *     handle?: FileSystemFileHandle,       // single + fsa only
     *     files?: File[],                      // multiple mode (always set)
     *     handles?: FileSystemFileHandle[],    // multiple + fsa only
     *     cancelled?: boolean,
     * }>}
     */
    async function openFile(opts) {
        opts = opts || {};
        var multiple = !!opts.multiple;

        if (hasFileSystemAccess()) {
            var handles;
            try {
                handles = await global.showOpenFilePicker({
                    types: opts.types || [],
                    multiple: multiple,
                    excludeAcceptAllOption: false,
                });
            } catch (e) {
                if (e && e.name === 'AbortError') {
                    return { success: false, method: 'fsa', cancelled: true };
                }
                throw e;
            }
            var files = await Promise.all(handles.map(function(h) {
                return h.getFile();
            }));
            var result = { success: true, method: 'fsa', files: files };
            if (!multiple) {
                result.file = files[0];
                result.handle = handles[0];
            } else {
                result.handles = handles;
            }
            return result;
        }

        // Fallback: <input type="file">
        return new Promise(function(resolve) {
            var input = document.createElement('input');
            input.type = 'file';
            if (opts.accept) input.accept = opts.accept;
            if (multiple) input.multiple = true;
            input.style.display = 'none';
            var settled = false;
            input.addEventListener('change', function() {
                if (settled) return;
                settled = true;
                var pickedFiles = input.files ? Array.from(input.files) : [];
                if (input.parentNode) input.parentNode.removeChild(input);
                if (pickedFiles.length === 0) {
                    resolve({ success: false, method: 'input', cancelled: true });
                    return;
                }
                var result = { success: true, method: 'input', files: pickedFiles };
                if (!multiple) result.file = pickedFiles[0];
                resolve(result);
            });
            // <input type=file> doesn't fire 'cancel' reliably across
            // browsers — there's no clean signal for "user closed the
            // picker without choosing". The element will just sit in the
            // DOM until the next pickFile() call replaces it. Acceptable
            // for typical usage; if the consumer needs a cancel signal,
            // they can rely on the change event silence.
            document.body.appendChild(input);
            input.click();
        });
    }

    // ----- writeBlobToHandle -----

    /**
     * Re-save a blob into an existing FileSystemFileHandle (no picker
     * prompt). Handles the read-write permission re-prompt and refreshes
     * cached file metadata before opening the writable.
     *
     * @param {FileSystemFileHandle} handle
     * @param {Blob} blob
     * @throws {Error} if permission is denied or write fails. Use
     *         isStaleHandleError(err) to detect the file-moved case.
     * @returns {Promise<void>}
     */
    async function writeBlobToHandle(handle, blob) {
        if (!handle) throw new Error('writeBlobToHandle: missing handle');
        if (!(blob instanceof Blob)) {
            throw new TypeError('writeBlobToHandle: blob must be a Blob');
        }
        // Newer Chrome versions require re-prompting for write permission
        // even on a handle that previously had it (the permission can
        // expire across navigations or be downgraded by the user).
        if (typeof handle.queryPermission === 'function') {
            var perm = await handle.queryPermission({ mode: 'readwrite' });
            if (perm !== 'granted'
                && typeof handle.requestPermission === 'function') {
                perm = await handle.requestPermission({ mode: 'readwrite' });
            }
            if (perm !== 'granted') {
                throw new Error('Write permission denied');
            }
        }
        // Refresh the handle's cached metadata before opening the
        // writable. Without this, a stale mtime/size from a previous
        // read triggers:
        //   InvalidStateError: An operation that depends on state
        //   cached in an interface object was made but the state had
        //   changed since it was read from disk.
        // A no-op getFile() round-trip is enough to re-sync.
        try { if (handle.getFile) await handle.getFile(); }
        catch (e) { /* will surface again from createWritable if real */ }
        var writable = await handle.createWritable();
        try { await writable.write(blob); }
        finally { await writable.close(); }
    }

    // ----- isStaleHandleError -----

    /**
     * Detect whether an Error from writeBlobToHandle indicates a stale
     * handle — i.e. the file was moved, deleted, or renamed externally
     * between the time we got the handle and now. Callers should drop
     * the dead handle and re-prompt with saveBlob().
     *
     * @param {*} err
     * @returns {boolean}
     */
    function isStaleHandleError(err) {
        if (!err) return false;
        if (err.name === 'InvalidStateError') return true;
        if (err.name === 'NotFoundError') return true;
        return /state cached|no longer exists|cannot be found/i
            .test(err.message || '');
    }

    // ----- Public API -----

    SeShared.fileIo.pickers = {
        version: '1.0.0',
        hasFileSystemAccess: hasFileSystemAccess,
        saveBlob: saveBlob,
        openFile: openFile,
        writeBlobToHandle: writeBlobToHandle,
        isStaleHandleError: isStaleHandleError,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { SeShared: SeShared };
    }
})(typeof window !== 'undefined' ? window : globalThis);
