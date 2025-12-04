/**
 * OBS Print Progress Overlay for Klipper/Moonraker
 * 
 * Displays real-time 3D printer status including:
 * - Print progress percentage and progress bar
 * - Current/total layer information
 * - Hotend, bed, and optional chamber temperatures
 * - Time estimates (progress-based, slicer estimate, elapsed time)
 * - Live camera feed
 * - G-code thumbnail preview
 * 
 * Features:
 * - Multi-printer support via printers.json
 * - Automatic metadata extraction from G-code files
 * - Fallback layer/time calculations from filenames
 * - Theme system with CSS variables
 * - Automatic chamber temperature detection
 * - Debug mode for troubleshooting
 */

(async function () {
    // ============================================================
    // UTILITY FUNCTIONS (must be defined first due to hoisting)
    // ============================================================
    
    /**
     * Parse various boolean representations to actual boolean
     * Handles: true/false, 1/0, yes/no, string/boolean types
     */
    function parseBool(val) {
        if (val === undefined || val === null) return false;
        if (typeof val === 'boolean') return val;
        const str = String(val).toLowerCase();
        return str === 'true' || str === '1' || str === 'yes';
    }

    const body = document.body || document.documentElement;

    // ============================================================
    // CONFIGURATION VARIABLES
    // These are initialized from HTML data attributes, then
    // overridden by printers.json or query parameters
    // ============================================================
    
    let PRINTER_IP = body.dataset.printerIp || 'localhost';
    let PRINTER_NAME = body.dataset.printerName || 'Printer';
    let UPDATE_INTERVAL = Number(body.dataset.updateInterval) || 2000;  // Polling interval in ms
    let DEBUG = parseBool(body.dataset.debug || 'false');
    let CAMERA_URL = body.dataset.cameraUrl || '';
    let CAMERA_FLIP_X = parseBool(body.dataset.cameraFlipX || 'false');  // Mirror horizontally
    let CAMERA_FLIP_Y = parseBool(body.dataset.cameraFlipY || 'false');  // Flip vertically
    let SHOW_CHAMBER = parseBool(body.dataset.chamberEnabled || body.dataset.showChamber || 'false');

    // ============================================================
    // METADATA CACHE
    // Stores parsed G-code metadata to avoid re-fetching
    // ============================================================
    
    const metadataCache = {
        filename: null,    // Current filename being tracked
        data: null,        // Parsed metadata (layer_height, estimated_time, etc.)
        source: null       // Where metadata came from: 'api', 'gcode-header', or null
    };

    // ============================================================
    // CHAMBER TEMPERATURE DETECTION
    // Klipper doesn't have a standard chamber sensor name, so we
    // try common patterns and cache the result
    // ============================================================
    
    const chamberCandidates = [
        'temperature_sensor chamber',
        'temperature_sensor chamber_temp',
        'temperature_sensor chamber-temp',
        'temperature_sensor enclosure_temp',
        'temperature_sensor enclosure',
        'temperature_host enclosure_temp',
        'temperature_host enclosure',
        'temperature_sensor chamber2',
        'temperature_sensor enclosure_upper',
        'temperature_sensor chamber_average'
    ];
    let chamberObjectName = null;        // Cached chamber sensor name
    let objectListCache = null;          // Cached list of available Klipper objects
    let objectListFetchedAt = 0;         // Timestamp of last object list fetch

    // ============================================================
    // CONFIGURATION FUNCTIONS
    // ============================================================
    
    /**
     * Apply configuration from printers.json or query params
     * Updates global variables and HTML data attributes
     * 
     * @param {Object} cfg - Configuration object with printer settings
     * @param {string} [cfg.name] - Printer display name
     * @param {string} [cfg.ip] - Printer IP address or hostname
     * @param {string} [cfg.cameraUrl] - Camera stream URL
     * @param {boolean} [cfg.cameraFlipX] - Mirror camera horizontally
     * @param {boolean} [cfg.cameraFlipY] - Flip camera vertically
     * @param {boolean} [cfg.chamberEnabled] - Show chamber temperature
     * @param {number} [cfg.updateInterval] - Polling interval in milliseconds
     */
    function applyConfig(cfg) {
        const b = body;
        const config = cfg || {};

        PRINTER_NAME = config.name || config.label || b.dataset.printerName || 'Printer';
        PRINTER_IP = config.ip || config.host || b.dataset.printerIp || 'localhost';
        CAMERA_URL = config.camera || '';  // Don't fallback to old dataset value
        CAMERA_FLIP_X = parseBool(config.flipHorizontal ?? b.dataset.cameraFlipX ?? 'false');
        CAMERA_FLIP_Y = parseBool(config.flipVertical ?? b.dataset.cameraFlipY ?? 'false');
        SHOW_CHAMBER = parseBool(config.showChamber ?? b.dataset.chamberEnabled ?? b.dataset.showChamber ?? 'false');
        UPDATE_INTERVAL = Number(config.updateInterval || config.intervalMs || b.dataset.updateInterval || 2000) || 2000;
        DEBUG = parseBool(config.debug ?? b.dataset.debug ?? 'false');
        
        console.log('[OBS Print Progress] DEBUG mode:', DEBUG);
        if (DEBUG) {
            console.log('[OBS Print Progress] Config loaded:', {
                name: PRINTER_NAME,
                ip: PRINTER_IP,
                camera: CAMERA_URL,
                showChamber: SHOW_CHAMBER
            });
        }

        // Auto-generate camera URL if not explicitly provided in config
        if (!CAMERA_URL && PRINTER_IP && PRINTER_IP !== 'localhost') {
            CAMERA_URL = `http://${PRINTER_IP}/webcam/?action=stream`;
        }

        b.dataset.printerName = PRINTER_NAME;
        b.dataset.printerIp = PRINTER_IP;
        b.dataset.cameraUrl = CAMERA_URL;
        b.dataset.cameraFlipX = String(CAMERA_FLIP_X);
        b.dataset.cameraFlipY = String(CAMERA_FLIP_Y);
        b.dataset.chamberEnabled = String(SHOW_CHAMBER);
        b.dataset.updateInterval = String(UPDATE_INTERVAL);
        b.dataset.debug = String(DEBUG);
    }

    /**
     * Validate printer configuration object
     * Checks for required fields and valid values
     * 
     * @param {Object} config - Configuration object to validate
     * @param {boolean} [isFromList=false] - Whether this is from printers.json (requires 'id' field)
     * @returns {{valid: boolean, errors: string[]}} Validation result
     */
    function validateConfig(config, isFromList = false) {
        const errors = [];
        
        if (!config || typeof config !== 'object') {
            errors.push('Configuration must be an object');
            return { valid: false, errors };
        }

        // Required fields for printers.json entries
        if (isFromList) {
            if (!config.id || typeof config.id !== 'string' || !config.id.trim()) {
                errors.push('Printer configuration missing required "id" field');
            }
        }

        // Required fields for all configs
        if (!config.name && !config.label) {
            errors.push('Printer configuration missing "name" field');
        }
        
        if (!config.ip && !config.host) {
            errors.push('Printer configuration missing "ip" field (IP address or hostname)');
        } else {
            const ip = config.ip || config.host;
            if (typeof ip !== 'string' || !ip.trim()) {
                errors.push('Printer "ip" must be a non-empty string');
            }
        }

        // Optional field validation
        if (config.updateInterval !== undefined) {
            const interval = Number(config.updateInterval);
            if (!Number.isFinite(interval) || interval < 500 || interval > 60000) {
                errors.push('updateInterval must be between 500 and 60000 milliseconds');
            }
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * Validate array of printer configurations
     * 
     * @param {Array} printerList - Array of printer config objects
     * @returns {{valid: boolean, errors: string[], validConfigs: Array}} Validation result
     */
    function validatePrinterList(printerList) {
        if (!Array.isArray(printerList)) {
            return {
                valid: false,
                errors: ['printers.json must contain a "printers" array'],
                validConfigs: []
            };
        }

        if (printerList.length === 0) {
            return {
                valid: false,
                errors: ['printers.json "printers" array is empty'],
                validConfigs: []
            };
        }

        const allErrors = [];
        const validConfigs = [];
        const ids = new Set();

        printerList.forEach((config, index) => {
            const result = validateConfig(config, true);
            
            if (!result.valid) {
                result.errors.forEach(err => {
                    allErrors.push(`Printer #${index + 1}: ${err}`);
                });
            } else {
                // Check for duplicate IDs
                if (ids.has(config.id)) {
                    allErrors.push(`Printer #${index + 1}: Duplicate id "${config.id}"`);
                } else {
                    ids.add(config.id);
                    validConfigs.push(config);
                }
            }
        });

        return {
            valid: allErrors.length === 0 && validConfigs.length > 0,
            errors: allErrors,
            validConfigs
        };
    }

    /**
     * Load printer configuration from multiple sources (priority order):
     * 1. printers.json file (main config)
     * 2. Query parameters (?printer=id or ?ip=...&name=...)
     * 3. Inline PRINTER_CONFIG in HTML
     * 4. HTML data attributes (fallback)
     * 
     * @returns {Object} Merged configuration object
     */
    async function loadConfig() {
        const query = new URLSearchParams(window.location.search);
        const key = (
            query.get('printer') ||
            query.get('printers') || // common typo
            query.get('id') ||
            query.get('name') ||
            ''
        ).toLowerCase();
        
        console.log('[OBS Print Progress] Loading config for printer key:', key || '(default/first)');
        
        const queryOverride = parseQueryConfig(query);
        if (queryOverride) {
            console.log('[OBS Print Progress] Query params found:', queryOverride);
        }

        const list = await fetchPrinterList();
        console.log('[OBS Print Progress] Printer list loaded:', list);
        
        if (list && list.length) {
            const found = selectConfig(list, key);
            const base = found || list[0];
            console.log('[OBS Print Progress] Selected config:', base);
            const merged = { ...base, ...queryOverride };
            console.log('[OBS Print Progress] Final config (with overrides):', merged);
            return merged;
        }

        if (queryOverride && queryOverride.ip) return queryOverride;
        if (window.PRINTER_CONFIG) return { ...window.PRINTER_CONFIG, ...queryOverride };
        return queryOverride || null;
    }

    async function fetchPrinterList() {
        console.log('[OBS Print Progress] Fetching printer list...');
        
        // Inline JSON script fallback (avoids file:// CORS)
        const inlineList = readInlinePrinterList();
        if (inlineList) {
            console.log('[OBS Print Progress] Using inline printer list');
            const validation = validatePrinterList(inlineList);
            if (!validation.valid) {
                console.error('[OBS Print Progress] Inline printer list validation errors:', validation.errors);
                showConfigError(`Configuration errors:\n${validation.errors.join('\n')}`);
            }
            return validation.validConfigs.length > 0 ? validation.validConfigs : inlineList;
        }

        // Global JS variable fallback (window.PRINTERS or window.PRINTER_CONFIGS)
        const globalList = readGlobalPrinterList();
        if (globalList) {
            console.log('[OBS Print Progress] Using global printer list');
            const validation = validatePrinterList(globalList);
            if (!validation.valid) {
                console.error('[OBS Print Progress] Global printer list validation errors:', validation.errors);
                showConfigError(`Configuration errors:\n${validation.errors.join('\n')}`);
            }
            return validation.validConfigs.length > 0 ? validation.validConfigs : globalList;
        }

        // First attempt: printers.json (preferred)
        const main = await fetchJsonConfig('printers.json');
        if (main) {
            const validation = validatePrinterList(main);
            if (!validation.valid) {
                console.error('[OBS Print Progress] printers.json validation errors:', validation.errors);
                showConfigError(`Configuration errors in printers.json:\n${validation.errors.join('\n')}`);
            }
            return validation.validConfigs.length > 0 ? validation.validConfigs : main;
        }

        // Fallback: example file (template)
        const example = await fetchJsonConfig('printers.json.example');
        if (example) {
            const validation = validatePrinterList(example);
            if (!validation.valid) {
                console.error('[OBS Print Progress] printers.json.example validation errors:', validation.errors);
            }
            return validation.validConfigs.length > 0 ? validation.validConfigs : example;
        }

        return null;
    }

    async function fetchJsonConfig(path) {
        const url = new URL(path, window.location.href).href;
        console.log('[OBS Print Progress] Fetching config from:', url);
        
        // Try fetch with timeout
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 2000); // 2 second timeout
            
            const resp = await fetch(url, { signal: controller.signal });
            clearTimeout(timeout);
            
            if (resp.ok) {
                const json = await resp.json();
                console.log('[OBS Print Progress] Config loaded from', path, ':', json);
                if (Array.isArray(json)) return json;
                if (Array.isArray(json.printers)) return json.printers;
            } else {
                console.warn('[OBS Print Progress] Config fetch failed:', resp.status, resp.statusText);
            }
        } catch (err) {
            if (err.name === 'AbortError') {
                console.warn(`[OBS Print Progress] Timeout fetching ${url}`);
            } else {
                console.warn(`[OBS Print Progress] Could not fetch ${url}:`, err?.message || err);
            }
        }

        // Fallback to XHR for file:// contexts where fetch is blocked by CORS
        if (location.protocol === 'file:') {
            try {
                const json = await loadJsonViaXhr(url);
                if (Array.isArray(json)) return json;
                if (Array.isArray(json?.printers)) return json.printers;
            } catch (err) {
                console.warn(`Could not load ${url} via XHR:`, err?.message || err);
            }
        }
        return null;
    }

    function readInlinePrinterList() {
        const ids = ['printers-config', 'printers-json', 'printer-config'];
        for (const id of ids) {
            const script = document.getElementById(id);
            if (!script) continue;
            try {
                const txt = script.textContent || script.innerText;
                if (!txt) continue;
                const json = JSON.parse(txt);
                if (Array.isArray(json)) return json;
                if (Array.isArray(json.printers)) return json.printers;
            } catch (err) {
                console.warn(`Could not parse inline printers JSON from #${id}:`, err?.message || err);
            }
        }
        return null;
    }

    function readGlobalPrinterList() {
        const candidates = [window.PRINTERS, window.PRINTER_CONFIGS];
        for (const candidate of candidates) {
            if (!candidate) continue;
            if (Array.isArray(candidate)) return candidate;
            if (Array.isArray(candidate.printers)) return candidate.printers;
        }
        return null;
    }

    function loadJsonViaXhr(path) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', path, true);
            xhr.overrideMimeType('application/json');
            xhr.onreadystatechange = () => {
                if (xhr.readyState !== 4) return;
                if (xhr.status === 0 || (xhr.status >= 200 && xhr.status < 300)) {
                    try {
                        const data = JSON.parse(xhr.responseText);
                        resolve(data);
                    } catch (err) {
                        reject(err);
                    }
                } else {
                    reject(new Error(`XHR ${xhr.status}`));
                }
            };
            xhr.onerror = () => reject(new Error('XHR network error'));
            xhr.send();
        });
    }

    /**
     * Parse query parameters into configuration object
     * Supports: ?debug=true, ?ip=..., ?name=..., ?camera=..., ?flipX=1, ?flipY=1, ?chamber=1, ?interval=2000
     */
    function parseQueryConfig(query) {
        if (!query) return {};
        const cfg = {};
        if (query.get('ip')) cfg.ip = query.get('ip');
        if (query.get('host')) cfg.ip = query.get('host');
        if (query.get('name')) cfg.name = query.get('name');
        if (query.get('label')) cfg.name = query.get('label');
        if (query.get('camera')) cfg.camera = query.get('camera');
        if (query.get('flipX')) cfg.flipHorizontal = parseBool(query.get('flipX'));
        if (query.get('flipHorizontal')) cfg.flipHorizontal = parseBool(query.get('flipHorizontal'));
        if (query.get('flipY')) cfg.flipVertical = parseBool(query.get('flipY'));
        if (query.get('flipVertical')) cfg.flipVertical = parseBool(query.get('flipVertical'));
        if (query.get('chamber')) cfg.showChamber = parseBool(query.get('chamber'));
        if (query.get('showChamber')) cfg.showChamber = parseBool(query.get('showChamber'));
        if (query.get('interval')) cfg.updateInterval = Number(query.get('interval'));
        if (query.get('updateInterval')) cfg.updateInterval = Number(query.get('updateInterval'));
        if (query.get('debug')) cfg.debug = parseBool(query.get('debug'));
        return cfg;
    }

    function selectConfig(list, key) {
        if (!key) return null;
        const lowerKey = key.toLowerCase();
        return list.find(cfg => {
            const id = String(cfg.id || cfg.name || cfg.label || '').toLowerCase();
            return id === lowerKey;
        }) || null;
    }

    function setPrinterName() {
        const printerNameEl = document.getElementById('printerName');
        if (printerNameEl) {
            printerNameEl.textContent = PRINTER_NAME;
        }
    }

    /**
     * Setup camera feed with retry logic
     * Automatically retries failed camera loads up to 3 times with exponential backoff
     */
    function setupCamera() {
        const cameraEl = document.getElementById('cameraFeed');
        if (!cameraEl) return;
        
        if (CAMERA_URL) {
            let retryCount = 0;
            const maxRetries = 3;
            
            const loadCamera = () => {
                cameraEl.src = CAMERA_URL + (retryCount > 0 ? `?retry=${retryCount}&t=${Date.now()}` : '');
                cameraEl.classList.remove('hidden');
                const flips = [];
                if (CAMERA_FLIP_X) flips.push('scaleX(-1)');
                if (CAMERA_FLIP_Y) flips.push('scaleY(-1)');
                cameraEl.style.transform = flips.join(' ');
            };
            
            // Show camera only when loaded successfully
            cameraEl.onload = () => {
                cameraEl.classList.add('loaded');
                if (DEBUG && retryCount > 0) {
                    console.log(`[OBS Print Progress] Camera loaded successfully after ${retryCount} retries`);
                }
            };
            
            cameraEl.onerror = () => {
                cameraEl.classList.remove('loaded');
                retryCount++;
                
                if (retryCount <= maxRetries) {
                    const delay = Math.min(1000 * Math.pow(2, retryCount - 1), 8000); // Exponential backoff: 1s, 2s, 4s
                    console.warn(`[OBS Print Progress] Camera feed failed to load, retrying in ${delay}ms (attempt ${retryCount}/${maxRetries})...`);
                    setTimeout(loadCamera, delay);
                } else {
                    console.error('[OBS Print Progress] Camera feed failed to load after all retries');
                }
            };
            
            loadCamera();
        } else {
            cameraEl.classList.add('hidden');
        }
    }

    await initialize();

    async function initialize() {
        const cfg = await loadConfig();
        if (!cfg) {
            showConfigError('No printer config found. Ensure printers.json is readable or pass ?ip=...&name=... in the URL.');
            return;
        }
        applyConfig(cfg);
        setPrinterName();
        setupCamera();
        
        // Start fetching immediately without waiting for chamber
        fetchPrintStatus();
        setInterval(fetchPrintStatus, UPDATE_INTERVAL);
        
        // Update chamber in background (don't block)
        updateChamber();
    }

    async function extractThumbnailFromGcode(filename) {
        try {
            const path = normalizeFilename(filename);
            if (!path) return null;

            const url = `http://${PRINTER_IP}/server/files/${encodeURI(path)}`;

            const resp = await fetch(url, {
                headers: { Range: "bytes=0-100000" }  // Reduced from 250KB to 100KB
            });

            if (!resp.ok) {
                console.warn("Thumbnail header fetch failed:", resp.status, url);
                return null;
            }

            const text = await resp.text();

            // Find all thumbnail blocks, keep the last (usually 300x300)
            const blockRegex = /; thumbnail begin \d+x\d+ \d+([\s\S]*?); thumbnail end/g;
            let match;
            let lastBlock = null;

            while ((match = blockRegex.exec(text)) !== null) {
                const block = match[1];
                const b64 = block
                    .split("\n")
                    .map(line => line.trim().replace(/^;/, "").trim())
                    .filter(Boolean)
                    .join("");
                lastBlock = b64;
            }

            return lastBlock;
        } catch (err) {
            console.error("extractThumbnailFromGcode error:", err);
            return null;
        }
    }

    function hideThumbnail() {
        const thumbEl = document.getElementById("thumbnail");
        const fileLabel = document.getElementById("thumbnailFilename");
        if (thumbEl) {
            thumbEl.src = "";
            thumbEl.style.display = "none";
            thumbEl.removeAttribute("data-loaded-for");
        }
        if (fileLabel) {
            fileLabel.textContent = "--";
        }
    }

    // Track API connection retry attempts
    let apiRetryCount = 0;
    const maxApiRetries = 5;
    let apiRetryTimeout = null;

    /**
     * Fetch printer status from Moonraker API with automatic retry on failure
     * Implements exponential backoff for connection errors
     */
    async function fetchPrintStatus() {
        try {
            const response = await fetch(`http://${PRINTER_IP}/printer/objects/query?display_status&print_stats&virtual_sdcard&extruder&heater_bed&toolhead`);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            // Reset retry count on successful fetch
            apiRetryCount = 0;
            
            const data = await response.json();
            
            const status = data.result.status;
            const printStats = status.print_stats;
            const displayStatus = status.display_status;
            const virtualSdcard = status.virtual_sdcard;
            const extruder = status.extruder;
            const heaterBed = status.heater_bed;
            const toolhead = status.toolhead;

            await ensureMetadataLoaded(printStats.filename, printStats.state);
            
            if (extruder) {
                const hotendTemp = Math.round(extruder.temperature);
                const hotendTarget = Math.round(extruder.target);
                document.getElementById('hotendTemp').textContent = `${hotendTemp}\u00B0C / ${hotendTarget}\u00B0C`;
            }
            
            if (heaterBed) {
                const bedTemp = Math.round(heaterBed.temperature);
                const bedTarget = Math.round(heaterBed.target);
                document.getElementById('bedTemp').textContent = `${bedTemp}\u00B0C / ${bedTarget}\u00B0C`;
            }

            await updateChamber();
            
            const statusElement = document.getElementById('status');
            const state = printStats.state;
            statusElement.textContent = state.charAt(0).toUpperCase() + state.slice(1);
            
            if (state === 'printing') {
                statusElement.className = 'status-pill ok';
                
                // Prefer the virtual_sdcard progress (matches what Mainsail shows), fall back to display_status
                const rawProgress = virtualSdcard.progress ?? displayStatus.progress ?? 0;
                const progress = Math.max(0, Math.min(1, Number(rawProgress) || 0));
                const percentage = Math.round(progress * 100);
                document.getElementById('progressBar').style.width = percentage + '%';
                document.getElementById('percentage').textContent = percentage + '%';
                
                const { currentLayer, totalLayer } = getLayerInfo(printStats, displayStatus, toolhead);
                document.getElementById('layerInfo').textContent = formatLayerInfo(currentLayer, totalLayer);
                const printDuration = printStats.print_duration || 0;
                const estimateRemaining = computeRemainingFromProgress(progress, printDuration);
                const slicerTotal = getSlicerTotalSeconds(metadataCache.data, printStats.info);
                const slicerRemaining = slicerTotal !== null && slicerTotal !== undefined
                    ? Math.max(0, slicerTotal - printDuration)
                    : null;
                const elapsedTime = getElapsedTime(printStats);

                setTimeValue('timeEstimate', estimateRemaining);
                setTimeValue('timeSlicer', slicerRemaining);
                setTimeValue('timeTotal', elapsedTime);

                updateDebug({
                    state,
                    progress,
                    filename: printStats.filename,
                    toolheadZ: toolhead?.position?.[2],
                    slicerInfo: printStats.info || {},
                    metadata: metadataCache,
                    currentLayer,
                    totalLayer,
                    metadataLayer: computeLayerFromMetadata(toolhead, metadataCache.data),
                    progressLayer: computeLayerFromProgress(displayStatus, metadataCache.data),
                    estimateRemaining,
                    slicerRemaining,
                    slicerTotal,
                    elapsedTime
                });
                
                document.getElementById('filename').textContent = formatFilename(printStats.filename) || 'Unknown';
                
                // Thumbnail display
                const thumbEl = document.getElementById("thumbnail");
                const previewContainer = document.getElementById("previewFloating");
                
                if (thumbEl) {
                    const normalized = normalizeFilename(printStats.filename);
                    const loadedFor = thumbEl.dataset.loadedFor || "";

                    if (normalized && loadedFor !== normalized) {
                        thumbEl.dataset.loadedFor = normalized;
                        // Keep hidden while loading
                        thumbEl.style.display = "none";
                        if (previewContainer) previewContainer.classList.remove('loaded');

                        extractThumbnailFromGcode(normalized).then(b64 => {
                            if (b64 && b64.length > 100) {  // Sanity check for valid base64
                                thumbEl.src = `data:image/png;base64,${b64}`;
                                thumbEl.style.display = "block";
                                if (previewContainer) previewContainer.classList.add('loaded');

                                const fileLabel = document.getElementById("thumbnailFilename");
                                if (fileLabel) {
                                    fileLabel.textContent = printStats.filename || "--";
                                }
                            } else {
                                hideThumbnail();
                            }
                        }).catch(err => {
                            console.error("Thumbnail load error:", err);
                            hideThumbnail();
                        });
                    }
                }
                
            } else if (state === 'paused') {
                statusElement.className = 'status-pill idle';
                document.getElementById('layerInfo').textContent = '--';
                
                // Show slicer total time even when paused (if available)
                const slicerTotal = getSlicerTotalSeconds(metadataCache.data, printStats.info);
                setTimeValue('timeEstimate', null);
                setTimeValue('timeSlicer', slicerTotal);
                setTimeValue('timeTotal', getElapsedTime(printStats));
                hideThumbnail();
            } else {
                statusElement.className = 'status-pill idle';
                document.getElementById('progressBar').style.width = '0%';
                document.getElementById('percentage').textContent = '0%';
                
                // Show slicer total time even when idle (if available)
                const slicerTotal = getSlicerTotalSeconds(metadataCache.data, printStats.info);
                setTimeValue('timeEstimate', null);
                setTimeValue('timeSlicer', slicerTotal);
                setTimeValue('timeTotal', null);
                document.getElementById('layerInfo').textContent = '--';
                document.getElementById('filename').textContent = '--';
                hideThumbnail();
            }
            
        } catch (error) {
            const statusEl = document.getElementById('status');
            statusEl.className = 'status-pill error';
            
            // Determine if this is a retryable error
            const isNetworkError = error.message?.includes('Failed to fetch') || 
                                   error.message?.includes('NetworkError') ||
                                   error.message?.includes('TypeError');
            
            // Retry logic for network errors
            if (isNetworkError && apiRetryCount < maxApiRetries) {
                apiRetryCount++;
                const delay = Math.min(2000 * Math.pow(2, apiRetryCount - 1), 30000); // 2s, 4s, 8s, 16s, 30s
                
                statusEl.textContent = `Retrying... (${apiRetryCount}/${maxApiRetries})`;
                console.warn(`[OBS Print Progress] API connection failed, retrying in ${delay}ms (attempt ${apiRetryCount}/${maxApiRetries})...`);
                
                // Clear any existing retry timeout
                if (apiRetryTimeout) {
                    clearTimeout(apiRetryTimeout);
                }
                
                // Schedule retry
                apiRetryTimeout = setTimeout(() => {
                    fetchPrintStatus();
                }, delay);
                
                return; // Don't show full error yet
            }
            
            // Provide more specific error messages for non-retryable or exhausted retries
            if (error.message?.includes('Failed to fetch') || error.message?.includes('NetworkError')) {
                statusEl.textContent = `Unreachable: ${PRINTER_IP}`;
                console.error(`[OBS Print Progress] Cannot connect to printer at ${PRINTER_IP}. Check IP address and network connection.`);
            } else if (error.message?.includes('HTTP 401') || error.message?.includes('HTTP 403')) {
                statusEl.textContent = 'Authentication Error';
                console.error('[OBS Print Progress] Authentication required. Check Moonraker configuration.');
            } else if (error.message?.includes('HTTP 404')) {
                statusEl.textContent = 'API Not Found';
                console.error('[OBS Print Progress] Moonraker API endpoint not found. Verify Moonraker is running.');
            } else {
                statusEl.textContent = 'Connection Error';
                console.error('[OBS Print Progress] Error fetching print status:', error);
            }
            
            updateDebug({ error: error?.message || String(error), retries: apiRetryCount });
            hideThumbnail();
        }
    }

    /**
     * Display configuration error to user and in console
     * Shows error in status pill and debug info area
     * 
     * @param {string} msg - Error message to display
     */
    function showConfigError(msg) {
        console.error(msg);
        const statusElement = document.getElementById('status');
        if (statusElement) {
            statusElement.textContent = 'Config Error';
            statusElement.className = 'status-pill error';
        }
        const debugEl = document.getElementById('debugInfo');
        if (debugEl) {
            debugEl.textContent = msg;
            debugEl.classList.remove('hidden');
        }
    }

    /**
     * Update chamber temperature display
     * Fetches current chamber temp and updates UI chip
     * Shows/hides chip based on availability and SHOW_CHAMBER setting
     */
    async function updateChamber() {
        const chamberChip = document.getElementById('chamberChip');
        if (!chamberChip) return;

        const temps = await fetchChamberTemp();
        if (temps) {
            chamberChip.classList.remove('hidden');
            document.getElementById('chamberTemp').textContent = `${temps.current}\u00B0C / ${temps.target}\u00B0C`;
        } else if (SHOW_CHAMBER) {
            chamberChip.classList.remove('hidden');
            document.getElementById('chamberTemp').textContent = '--';
        } else {
            chamberChip.classList.add('hidden');
        }
    }

    /**
     * Fetch chamber temperature from Klipper
     * Tries cached object name first, then iterates through known candidates
     * 
     * @returns {Promise<{current: number, target: number}|null>} Temperature data or null if unavailable
     */
    async function fetchChamberTemp() {
        const objName = await getChamberObjectName();
        if (objName) {
            const data = await querySingleObject(objName);
            const parsed = parseTempEntry(data);
            if (parsed) return parsed;
        }

        // fallback: try known candidates directly
        for (const obj of chamberCandidates) {
            const data = await querySingleObject(obj);
            const parsed = parseTempEntry(data);
            if (parsed) {
                chamberObjectName = obj; // cache the one that worked
                return parsed;
            }
        }
        return null;
    }

    /**
     * Get the chamber temperature sensor object name from Klipper
     * Returns cached name if available, otherwise searches object list
     * 
     * @returns {Promise<string|null>} Klipper object name or null if not found
     */
    async function getChamberObjectName() {
        if (chamberObjectName) return chamberObjectName;
        const objects = await fetchObjectList();
        if (!objects) return null;

        const lower = objects.map(o => o.toLowerCase());
        for (const candidate of chamberCandidates) {
            const idx = lower.indexOf(candidate.toLowerCase());
            if (idx !== -1) {
                chamberObjectName = objects[idx]; // preserve original case
                return chamberObjectName;
            }
        }
        return null;
    }

    /**
     * Fetch list of all Klipper objects from printer
     * Caches result for 30 seconds to avoid excessive API calls
     * 
     * @returns {Promise<string[]|null>} Array of object names or null on error
     */
    async function fetchObjectList() {
        const now = Date.now();
        if (objectListCache && now - objectListFetchedAt < 30000) {
            return objectListCache;
        }
        try {
            const resp = await fetch(`http://${PRINTER_IP}/printer/objects/list`);
            if (!resp.ok) return null;
            const json = await resp.json();
            const list = json.result?.objects;
            if (Array.isArray(list)) {
                objectListCache = list;
                objectListFetchedAt = now;
                return list;
            }
        } catch (err) {
            // ignore
        }
        return null;
    }

    /**
     * Query a specific Klipper object by name
     * 
     * @param {string} objName - Klipper object name (e.g., 'temperature_sensor chamber')
     * @returns {Promise<Object|null>} Object data or null on error
     */
    async function querySingleObject(objName) {
        try {
            const resp = await fetch(`http://${PRINTER_IP}/printer/objects/query?${encodeURIComponent(objName)}`);
            if (!resp.ok) return null;
            const json = await resp.json();
            const status = json.result?.status;
            if (!status) return null;
            const key = Object.keys(status)[0];
            return status[key] || null;
        } catch {
            return null;
        }
    }

    /**
     * Parse temperature data from Klipper object
     * Handles various temperature field names and formats
     * 
     * @param {Object} entry - Temperature object from Klipper
     * @returns {{current: number, target: number}|null} Parsed temperature data
     */
    function parseTempEntry(entry) {
        if (!entry) return null;
        const current = Math.round(entry.temperature ?? entry.temp ?? entry.current ?? entry.temper);
        const targetRaw = entry.target ?? entry.target_temp ?? entry.target_temperature;
        const target = targetRaw !== undefined && targetRaw !== null ? Math.round(targetRaw) : Math.round(entry.temperature ?? entry.temp ?? 0);
        if (!Number.isFinite(current)) return null;
        return {
            current,
            target: Number.isFinite(target) ? target : current
        };
    }

    /**
     * Format layer information for display
     * Handles various combinations of current/total availability
     * 
     * @param {number|null} current - Current layer number
     * @param {number|null} total - Total layer count
     * @returns {string} Formatted string (e.g., '45 / 120', '45 / --', '--')
     */
    function formatLayerInfo(current, total) {
        const hasCurrent = current !== null && current !== undefined && current > 0;
        const hasTotal = total !== null && total !== undefined && total > 0;
        
        if (!hasCurrent && !hasTotal) return '--';
        if (hasCurrent && hasTotal) return `${current} / ${total}`;
        if (hasCurrent) return `${current} / --`;  // Show current with unknown total
        return `-- / ${total}`;  // Show total when current unknown
    }

    /**
     * Format seconds into HH:MM:SS or MM:SS display
     * 
     * @param {number} seconds - Time in seconds
     * @returns {string} Formatted time string or '--' if invalid
     */
    function formatTime(seconds) {
        if (!seconds || seconds < 0) return '--';
        
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        
        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        } else if (minutes > 0) {
            return `${minutes}m ${secs}s`;
        } else {
            return `${secs}s`;
        }
    }

    function setTimeValue(elementId, seconds) {
        const el = document.getElementById(elementId);
        if (!el) return;
        if (seconds === null || seconds === undefined || seconds < 0 || !Number.isFinite(seconds)) {
            el.textContent = '--';
        } else {
            el.textContent = formatTime(seconds);
        }
    }

    function computeRemainingFromProgress(progress, printDuration) {
        if (progress > 0 && progress < 1) {
            const totalTime = printDuration / progress;
            return totalTime - printDuration;
        }
        return null;
    }

    function getSlicerTotalSeconds(metadata, slicerInfo) {
        const candidates = [
            metadata?.estimated_time,
            metadata?.slicer_estimated_time,
            metadata?.slicer_time,
            metadata?.estimated_print_time,
            metadata?.slicer_estimated_duration,
            metadata?.print_time,
            slicerInfo?.estimated_time,
            slicerInfo?.slicer_time,
            slicerInfo?.slicer_estimated_time,
            slicerInfo?.estimated_print_time,
            slicerInfo?.slicer_estimated_duration
        ];

        for (const value of candidates) {
            const num = asNumber(value);
            if (num && num > 0) {
                return num;
            }
        }
        return null;
    }

    /**
     * Get elapsed time from print_stats
     * Prefers total_duration (includes pauses), falls back to print_duration
     */
    function getElapsedTime(printStats) {
        const totalDuration = asNumber(printStats?.total_duration);
        const printDuration = asNumber(printStats?.print_duration);
        return totalDuration ?? printDuration ?? null;
    }

    /**
     * Get current and total layer information from multiple sources
     * Priority order:
     * 1. Klipper's print_stats.info (slicer embedded data)
     * 2. Calculated from metadata + toolhead Z position
     * 3. Calculated from progress percentage + total layers
     * 4. Fallback estimate from Z height assuming 0.2mm layers
     * 
     * @returns {Object} { currentLayer, totalLayer }
     */
    function getLayerInfo(printStats, displayStatus, toolhead) {
        const slicerInfo = printStats.info || {};
        const slicerCurrent = asNumber(
            slicerInfo.current_layer ??
            slicerInfo.currentLayer ??
            slicerInfo.layer_current ??
            slicerInfo.layer
        );
        const slicerTotal = asNumber(
            slicerInfo.total_layer ??
            slicerInfo.totalLayer ??
            slicerInfo.layer_count ??
            slicerInfo.layerTotal ??
            slicerInfo.totalLayers
        );
        
        const metadataLayer = computeLayerFromMetadata(toolhead, metadataCache.data);
        const progressLayer = computeLayerFromProgress(displayStatus, metadataCache.data);
        
        // Fallback: if no metadata, estimate layer from Z height with common layer height
        let fallbackCurrent = null;
        const currentZ = toolhead?.position?.[2];
        if (currentZ !== undefined && currentZ !== null && currentZ > 0 && !metadataLayer.current) {
            // Assume 0.2mm layer height if we have no other info
            fallbackCurrent = Math.max(1, Math.floor(currentZ / 0.2));
        }
        
        return {
            currentLayer: firstNonNull(slicerCurrent, metadataLayer.current, progressLayer.current, fallbackCurrent),
            totalLayer: firstNonNull(slicerTotal, metadataLayer.total, progressLayer.total)
        };
    }

    /**
     * Calculate layer info from metadata and current Z position
     * Uses layer_height, first_layer_height, and object_height from metadata
     * Current layer = (currentZ - firstLayerHeight) / layerHeight + 1
     * 
     * @returns {Object} { current, total } - both can be null if data unavailable
     */
    function computeLayerFromMetadata(toolhead, metadata) {
        if (!metadata) return { current: null, total: null };
        
        const layerHeight = metadata.layer_height;
        const firstLayerHeight = metadata.first_layer_height || layerHeight;
        const objectHeight = metadata.object_height;
        const layerCount = asNumber(
            metadata.layer_count ??
            metadata.total_layer ??
            metadata.total_layers
        );
        const currentZ = toolhead?.position?.[2];
        
        let total = layerCount || null;
        if (!total && layerHeight && objectHeight) {
            total = Math.max(1, Math.round(((objectHeight - firstLayerHeight) / layerHeight) + 1));
        }

        let current = null;
        if (layerHeight && currentZ !== undefined && currentZ !== null) {
            const calc = Math.floor(((currentZ - firstLayerHeight) / layerHeight) + 1);
            current = Math.max(1, calc);
            if (total) {
                current = Math.min(total, current);
            }
        }

        return { current, total };
    }

    /**
     * Calculate current layer from print progress percentage
     * Multiplies progress (0-1) by total layer count
     * Less accurate than Z-based calculation but works when metadata available
     * 
     * @returns {Object} { current, total } - current can be null if no progress
     */
    function computeLayerFromProgress(displayStatus, metadata) {
        if (!metadata) return { current: null, total: null };
        
        const total = asNumber(
            metadata.layer_count ??
            metadata.total_layer ??
            metadata.total_layers
        );
        const progress = typeof displayStatus?.progress === 'number' ? displayStatus.progress : null;

        if (!total || progress === null || progress <= 0) {
            return { current: null, total: total || null };
        }

        const current = Math.max(1, Math.min(total, Math.round(progress * total)));
        return { current, total };
    }

    function firstNonNull(...values) {
        for (const value of values) {
            if (value !== null && value !== undefined) {
                return value;
            }
        }
        return null;
    }

    /**
     * Convert value to number if possible, return null if invalid
     * Used for safely parsing numeric metadata values
     */
    function asNumber(value) {
        const num = Number(value);
        return Number.isFinite(num) ? num : null;
    }

    /**
     * Ensure metadata is loaded and cached for the current print job
     * Tries multiple strategies:
     * 1. Moonraker metadata API (if file has been analyzed)
     * 2. Parse G-code header comments
     * 3. Extract layer height from filename (e.g., "_0.2_" = 0.2mm)
     * 4. Extract estimated time from filename (e.g., "1h46m" = 1hr 46min)
     * 5. Calculate missing values from available data
     */
    async function ensureMetadataLoaded(filename, state) {
        if (state !== 'printing' || !filename) {
            return;
        }

        if (metadataCache.filename === filename && metadataCache.data) {
            return;
        }

        if (DEBUG) console.log('Loading metadata for:', filename);
        metadataCache.filename = filename;
        const metaResult = await fetchMetadata(filename);
        metadataCache.data = metaResult?.data || null;
        metadataCache.source = metaResult?.source || null;
        
        if (DEBUG) console.log('[OBS Print Progress] Raw metadata before filename parsing:', metadataCache.data);
        
        // ============================================================
        // FILENAME-BASED METADATA EXTRACTION
        // When Moonraker hasn't analyzed the file yet (404 on metadata API),
        // we can extract useful info from common filename patterns:
        // 
        // Layer Height: "_0.2_" or ".0.2." or "0.2mm" → 0.2mm
        // Estimated Time: "1h46m" → 1 hour 46 minutes
        //                 "2h30m" → 2 hours 30 minutes  
        //                 "45m" → 45 minutes
        // 
        // This allows the overlay to work immediately instead of showing
        // blank values for the first few seconds of a print.
        // ============================================================
        
        // Try to extract layer height from filename as last resort
        if (metadataCache.data && !metadataCache.data.layer_height) {
            if (DEBUG) console.log('[OBS Print Progress] No layer_height in metadata, trying filename:', filename);
            // Match patterns like "_0.2_", "_0.2.", " 0.2 ", "0.2mm"
            const filenameMatch = filename.match(/[_\s\.]0\.(\d+)(?:[_\s\.]|mm|$)/i);
            if (filenameMatch) {
                const inferredHeight = Number(`0.${filenameMatch[1]}`);
                if (DEBUG) console.log('[OBS Print Progress] Filename match found:', filenameMatch[0], 'Height:', inferredHeight);
                
                if (inferredHeight >= 0.05 && inferredHeight <= 0.5) {
                    metadataCache.data.layer_height = inferredHeight;
                    if (DEBUG) console.log('[OBS Print Progress] Inferred layer height from filename:', inferredHeight);
                    
                    // Recalculate layer count if we have object height
                    if (metadataCache.data.object_height && !metadataCache.data.layer_count) {
                        const firstLayer = metadataCache.data.first_layer_height || inferredHeight;
                        metadataCache.data.layer_count = Math.max(1, Math.round(((metadataCache.data.object_height - firstLayer) / inferredHeight) + 1));
                        if (DEBUG) console.log('[OBS Print Progress] Calculated layer_count:', metadataCache.data.layer_count);
                    }
                } else {
                    if (DEBUG) console.log('[OBS Print Progress] Inferred height out of range:', inferredHeight);
                }
            } else {
                if (DEBUG) console.log('[OBS Print Progress] No layer height pattern found in filename');
            }
        }
        
        // Try to extract estimated time from filename (e.g., "1h46m", "2h30m", "45m")
        if (metadataCache.data && !metadataCache.data.estimated_time) {
            const timeMatch = filename.match(/(\d+)h(\d+)m|(\d+)h|(\d+)m(?!m)/i);
            if (timeMatch) {
                let seconds = 0;
                if (timeMatch[1] && timeMatch[2]) {
                    // Format: "1h46m"
                    seconds = (parseInt(timeMatch[1]) * 3600) + (parseInt(timeMatch[2]) * 60);
                } else if (timeMatch[3]) {
                    // Format: "2h"
                    seconds = parseInt(timeMatch[3]) * 3600;
                } else if (timeMatch[4]) {
                    // Format: "45m"
                    seconds = parseInt(timeMatch[4]) * 60;
                }
                
                if (seconds > 0) {
                    metadataCache.data.estimated_time = seconds;
                    if (DEBUG) console.log('[OBS Print Progress] Inferred estimated_time from filename:', seconds, 'seconds');
                }
            }
        }
        
        if (DEBUG) console.log('Metadata loaded:', metadataCache.source, metadataCache.data);
    }

    async function fetchMetadata(filename) {
        try {
            const fileParam = normalizeFilename(filename);
            if (!fileParam) {
                return null;
            }

            const apiMeta = await fetchMetadataFromApi(fileParam);
            if (apiMeta) {
                return { data: apiMeta, source: 'api' };
            }

            const headerMeta = await fetchMetadataFromGcode(fileParam);
            if (headerMeta) {
                return { data: headerMeta, source: 'gcode-header' };
            }

            return null;
        } catch (err) {
            console.error('Error fetching metadata:', err);
            return null;
        }
    }

    async function fetchMetadataFromApi(fileParam) {
        // Only try the exact filename - Moonraker knows the path
        try {
            const url = `http://${PRINTER_IP}/server/files/metadata?filename=${encodeURIComponent(fileParam)}`;
            if (DEBUG) console.log('Fetching metadata from API:', url);
            
            const response = await fetch(url, {
                method: 'GET',
                cache: 'no-cache'
            });
            
            if (response.ok) {
                const data = await response.json();
                if (DEBUG) console.log('Metadata received:', data.result);
                return data.result;
            } else {
                if (DEBUG) console.log('Metadata API returned:', response.status, response.statusText);
            }
        } catch (err) {
            if (DEBUG) console.error('Metadata API error:', err);
        }
        return null;
    }

    async function fetchMetadataFromGcode(fileParam) {
        try {
            if (DEBUG) console.log('[OBS Print Progress] Fetching metadata from gcode header for:', fileParam);
            
            const candidates = [
                fileParam,
                fileParam.replace(/^gcodes\//, ''),
                `gcodes/${fileParam}`,
                `printer_data/${fileParam}`,
                `gcode_files/${fileParam.replace(/^gcodes\//, '')}`
            ];

            for (const candidate of candidates) {
                const safePath = encodeURI(candidate);
                const url = `http://${PRINTER_IP}/server/files/${safePath}`;
                
                if (DEBUG) console.log('[OBS Print Progress] Trying gcode path:', url);
                
                const response = await fetch(url, {
                    headers: { Range: 'bytes=0-65535' }
                });

                if (!response.ok) {
                    if (DEBUG) console.log('[OBS Print Progress] Gcode fetch failed:', response.status);
                    continue;
                }

                if (DEBUG) console.log('[OBS Print Progress] Gcode header fetched successfully from:', candidate);
                const text = await response.text();
                const parsed = parseGcodeHeader(text);
                if (parsed) {
                    if (DEBUG) console.log('[OBS Print Progress] Successfully parsed gcode metadata');
                    return parsed;
                }
            }

            if (DEBUG) console.log('[OBS Print Progress] No gcode metadata found from any path');
            return null;
        } catch (err) {
            if (DEBUG) console.error('[OBS Print Progress] Error fetching gcode metadata:', err);
            return null;
        }
    }

    function parseGcodeHeader(text) {
        if (!text) return null;

        const meta = {};
        const lines = text.split(/\r?\n/).slice(0, 500);
        const numberFromLine = (line, regex) => {
            const match = line.match(regex);
            if (!match) return null;
            const num = Number(match[1]);
            return Number.isFinite(num) ? num : null;
        };

        if (DEBUG) console.log('[OBS Print Progress] Parsing gcode header, first 10 comment lines:');
        let debugLineCount = 0;

        for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line.startsWith(';')) continue;
            
            if (DEBUG && debugLineCount < 10) {
                console.log('  ', line);
                debugLineCount++;
            }

            const lower = line.toLowerCase();
            
            // Layer height variations
            meta.layer_height = meta.layer_height ?? numberFromLine(lower, /layer[_ ]?height[:=\s]\s*([\d.]+)/i);
            meta.layer_height = meta.layer_height ?? numberFromLine(lower, /;\s*layer_height\s*=\s*([\d.]+)/i);
            
            // First layer height
            meta.first_layer_height = meta.first_layer_height ?? numberFromLine(lower, /first[_ ]?layer[_ ]?height[:=\s]\s*([\d.]+)/i);
            meta.first_layer_height = meta.first_layer_height ?? numberFromLine(lower, /initial[_ ]?layer[_ ]?height[:=\s]\s*([\d.]+)/i);
            
            // Layer count variations
            meta.layer_count = meta.layer_count ?? numberFromLine(lower, /layer[_ ]?(?:count|total|totals?)[:=\s]\s*([\d]+)/i);
            meta.layer_count = meta.layer_count ?? numberFromLine(lower, /total[_ ]?layers?[:=\s]\s*([\d]+)/i);
            meta.layer_count = meta.layer_count ?? numberFromLine(lower, /;\s*total_layer_count\s*=\s*([\d]+)/i);
            
            // Estimated time
            meta.estimated_time = meta.estimated_time ?? numberFromLine(lower, /(?:estimated[_ ]?time|estimated[_ ]?print[_ ]?time|print[_ ]?time)[:=\s]\s*([\d.]+)/i);
            meta.estimated_time = meta.estimated_time ?? numberFromLine(lower, /;time[:=\s]\s*([\d.]+)/i);
            meta.estimated_time = meta.estimated_time ?? numberFromLine(lower, /;\s*estimated_printing_time\(normal\)\s*=\s*([\d.]+)/i);
            
            // Object height
            const heightVal = numberFromLine(lower, /(?:maxz|max_z|height|object[_ ]?height)[:=\s]\s*([\d.]+)/i);
            if (heightVal !== null) {
                meta.object_height = meta.object_height ?? heightVal;
            }
        }

        if (DEBUG) {
            console.log('[OBS Print Progress] Parsed gcode metadata:', meta);
        }

        if (!meta.object_height && meta.layer_height && meta.layer_count) {
            meta.object_height = meta.layer_height * meta.layer_count;
        }
        
        // If we have object_height but no layer_height, try common defaults
        if (meta.object_height && !meta.layer_height && !meta.layer_count) {
            // Try to infer from filename (e.g., "0.2" in filename)
            const heightMatch = text.match(/;\s*(?:layer[_ ]?height|Layer height).*?(0\.\d+)/i);
            if (heightMatch) {
                meta.layer_height = Number(heightMatch[1]);
                if (DEBUG) console.log('[OBS Print Progress] Inferred layer height from text:', meta.layer_height);
            }
        }
        
        // Additional fallback: calculate layer_count from object_height if we have layer_height
        if (meta.object_height && meta.layer_height && !meta.layer_count) {
            const firstLayer = meta.first_layer_height || meta.layer_height;
            meta.layer_count = Math.max(1, Math.round(((meta.object_height - firstLayer) / meta.layer_height) + 1));
            if (DEBUG) console.log('[OBS Print Progress] Calculated layer_count from height:', meta.layer_count);
        }

        if (meta.layer_height || meta.first_layer_height || meta.layer_count || meta.object_height) {
            return meta;
        }

        return null;
    }

    function normalizeFilename(filename) {
        if (!filename) return null;
        
        // Remove common path prefixes
        let name = filename.replace(/^~\//, '')
                           .replace(/^\//, '')
                           .replace(/^printer_data\/gcodes\//, 'gcodes/')
                           .replace(/^gcode_files\//, 'gcodes/')
                           .replace(/^files\//, '');
        
        // If it doesn't start with gcodes/, add it
        if (!name.startsWith('gcodes/')) {
            name = `gcodes/${name}`;
        }
        
        return name;
    }

    function formatFilename(filename) {
        if (!filename) return null;
        const normalized = filename.split('/').pop();
        const withoutExt = normalized.replace(/\.gcode$/i, '');
        return withoutExt;
    }

    function updateDebug(info) {
        if (!DEBUG) return;
        const el = document.getElementById('debugInfo');
        if (!el) return;

        if (info?.error) {
            el.textContent = `ERROR: ${info.error}`;
            el.classList.remove('hidden');
            return;
        }

        const lines = [];
        lines.push(`state=${info.state}`);
        lines.push(`progress=${(info.progress ?? 0) * 100}%`);
        lines.push(`filename=${info.filename}`);
        lines.push(`toolheadZ=${info.toolheadZ}`);

        const slicerInfo = info.slicerInfo || {};
        lines.push(`slicer: current=${slicerInfo.current_layer ?? slicerInfo.currentLayer ?? slicerInfo.layer_current ?? slicerInfo.layer ?? 'null'} total=${slicerInfo.total_layer ?? slicerInfo.totalLayer ?? slicerInfo.layer_count ?? slicerInfo.layerTotal ?? slicerInfo.totalLayers ?? 'null'}`);

        const meta = info.metadata || {};
        const metaKeys = meta.data ? Object.keys(meta.data).filter(k => !k.startsWith('_')).join(',') : 'none';
        lines.push(`metadata: source=${meta.source || 'none'} filename=${meta.filename || 'n/a'} keys=${metaKeys}`);

        const mLayer = info.metadataLayer || {};
        lines.push(`metadataLayer: current=${mLayer.current ?? 'null'} total=${mLayer.total ?? 'null'}`);

        const pLayer = info.progressLayer || {};
        lines.push(`progressLayer: current=${pLayer.current ?? 'null'} total=${pLayer.total ?? 'null'}`);

        lines.push(`chosen: current=${info.currentLayer ?? 'null'} total=${info.totalLayer ?? 'null'}`);
        lines.push(`estimateRemaining=${info.estimateRemaining ?? 'null'}`);
        lines.push(`slicerRemaining=${info.slicerRemaining ?? 'null'} total=${info.slicerTotal ?? 'null'}`);

        el.textContent = lines.join('\n');
        el.classList.remove('hidden');
    }

    fetchPrintStatus();
    setInterval(fetchPrintStatus, UPDATE_INTERVAL);
})();
