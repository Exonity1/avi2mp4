/* Core Application Logic for CharmeraTranscoder */

let ffmpeg = null;
let selectedFile = null;
let selectedPreset = 'fast';
let wakeLock = null;

// Custom toBlobURL implementation to load cross-origin worker resources
async function toBlobURL(url, mimeType) {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const blob = await response.blob();
        return URL.createObjectURL(new Blob([blob], { type: mimeType }));
    } catch (error) {
        console.error('Failed to create blob URL:', error);
        throw error;
    }
}

// Format file size helper
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Console Logging Helpers
const consoleLogs = document.getElementById('consoleLogs');
function appendLog(message) {
    if (!consoleLogs) return;
    consoleLogs.textContent += message + '\n';
    const container = document.getElementById('consoleLogContainer');
    if (container) {
        container.scrollTop = container.scrollHeight;
    }
}

function clearLogs() {
    if (consoleLogs) consoleLogs.textContent = '';
}

// Progress UI Updater
function updateProgress(progressVal, stateText) {
    const percent = Math.min(Math.max(Math.round(progressVal * 100), 0), 100);
    const bar = document.getElementById('progressBar');
    const percentText = document.getElementById('progressPercentText');
    const stateTextEl = document.getElementById('progressStateText');

    if (bar) bar.style.width = `${percent}%`;
    if (percentText) percentText.textContent = `${percent}%`;
    if (stateTextEl && stateText) stateTextEl.textContent = stateText;
}

// Wake Lock API Management
async function requestWakeLock() {
    if ('wakeLock' in navigator) {
        try {
            wakeLock = await navigator.wakeLock.request('screen');
            appendLog('[System] Screen Wake Lock activated (screen will stay awake).');
        } catch (err) {
            console.warn('Wake Lock request failed:', err);
            appendLog('[System Warning] Could not activate screen Wake Lock.');
        }
    } else {
        appendLog('[System] Screen Wake Lock not supported by this browser.');
    }
}

function releaseWakeLock() {
    if (wakeLock) {
        try {
            wakeLock.release();
            appendLog('[System] Screen Wake Lock released.');
        } catch (err) {
            console.warn('Wake Lock release failed:', err);
        }
        wakeLock = null;
    }
}

// FFmpeg Engine Loader
async function initFFmpeg() {
    if (ffmpeg) return ffmpeg;

    appendLog('[Transcoder] Starting conversion engine initialization...');
    updateProgress(0, 'Initializing transcoder engine...');

    const { FFmpeg } = window.FFmpegWASM;
    ffmpeg = new FFmpeg();

    // Set up logging hook
    ffmpeg.on('log', ({ message }) => {
        appendLog(message);
    });

    // Set up progress hook
    ffmpeg.on('progress', ({ progress }) => {
        // Only update progress once it starts transcoding
        updateProgress(progress, 'Transcoding video streams...');
    });

    // Load libraries from jsDelivr CDN
    // Using single-threaded core to support static GitHub Pages hosting
    const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd';
    try {
        appendLog('[Transcoder] Downloading core libraries (~31MB)...');
        updateProgress(0.1, 'Downloading core engine (cached on next load)...');
        
        const coreURL = await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript');
        const wasmURL = await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm');

        updateProgress(0.3, 'Loading core WASM binary...');
        await ffmpeg.load({ coreURL, wasmURL });
        
        appendLog('[Transcoder] Engine loaded successfully.');
        return ffmpeg;
    } catch (error) {
        appendLog(`[Transcoder Error] Failed to load core libraries: ${error.message}`);
        throw error;
    }
}

// Reset Selection UI
function resetSelector() {
    selectedFile = null;
    document.getElementById('fileInput').value = '';
    document.getElementById('fileInfoPanel').classList.add('hidden');
    document.getElementById('convertBtn').classList.add('hidden');
    document.getElementById('dropZoneContainer').classList.remove('hidden');
}

// Reset Transcoding State to start fresh
function resetAll() {
    resetSelector();
    document.getElementById('resultPanel').classList.add('hidden');
    document.getElementById('progressPanel').classList.add('hidden');
    document.getElementById('settingsPanel').classList.remove('hidden');
    
    // Revoke object URL to prevent memory leaks
    const videoPreview = document.getElementById('videoPreview');
    if (videoPreview.src) {
        URL.revokeObjectURL(videoPreview.src);
        videoPreview.src = '';
    }
    
    clearLogs();
}

// Transcode Flow
async function startTranscoding() {
    if (!selectedFile) return;

    // Reset progress and log panel
    clearLogs();
    document.getElementById('settingsPanel').classList.add('hidden');
    document.getElementById('convertBtn').classList.add('hidden');
    document.getElementById('fileInfoPanel').classList.add('hidden');
    document.getElementById('progressPanel').classList.remove('hidden');

    try {
        // Keep mobile phone awake
        await requestWakeLock();

        // 1. Initialize engine
        const engine = await initFFmpeg();

        // 2. Read selected file
        appendLog(`[Transcoder] Reading local file: ${selectedFile.name} (${formatBytes(selectedFile.size)})`);
        updateProgress(0.4, 'Reading video data...');
        const arrayBuffer = await selectedFile.arrayBuffer();

        // 3. Write to FFmpeg virtual filesystem
        appendLog('[Transcoder] Mounting video file to virtual filesystem...');
        await engine.writeFile('input.avi', new Uint8Array(arrayBuffer));

        // 4. Run transcoding command
        // Equivalent to: ffmpeg -i input.avi -c:v libx264 -crf 18 -preset [preset] -c:a aac -b:a 128k output.mp4
        appendLog(`[Transcoder] Starting transcode using CRF 18, preset "${selectedPreset}", AAC audio...`);
        updateProgress(0.5, 'Starting FFmpeg encoding...');

        const startTime = performance.now();
        await engine.exec([
            '-i', 'input.avi',
            '-c:v', 'libx264',
            '-crf', '18',
            '-preset', selectedPreset,
            '-c:a', 'aac',
            '-b:a', '128k',
            'output.mp4'
        ]);
        const endTime = performance.now();
        appendLog(`[Transcoder] Encoding finished in ${((endTime - startTime) / 1000).toFixed(2)} seconds.`);

        // 5. Read result
        updateProgress(0.95, 'Reading MP4 output file...');
        appendLog('[Transcoder] Fetching encoded video from virtual filesystem...');
        const data = await engine.readFile('output.mp4');

        // 6. Create Blob URL
        appendLog('[Transcoder] Creating preview URL...');
        const videoBlob = new Blob([data], { type: 'video/mp4' });
        const videoURL = URL.createObjectURL(videoBlob);

        // 7. Clean virtual filesystem to free WebAssembly memory
        appendLog('[Transcoder] Unmounting files to release memory...');
        await engine.deleteFile('input.avi');
        await engine.deleteFile('output.mp4');

        // 8. Populate preview & download links
        const videoPreview = document.getElementById('videoPreview');
        videoPreview.src = videoURL;
        videoPreview.load();

        const downloadBtn = document.getElementById('downloadBtn');
        downloadBtn.href = videoURL;
        
        // Calculate output file name
        const originalName = selectedFile.name;
        const dotIndex = originalName.lastIndexOf('.');
        const baseName = dotIndex !== -1 ? originalName.substring(0, dotIndex) : originalName;
        downloadName = `${baseName}_converted.mp4`;
        downloadBtn.download = downloadName;

        // 9. Update UI states
        document.getElementById('progressPanel').classList.add('hidden');
        document.getElementById('resultPanel').classList.remove('hidden');
        appendLog('[Transcoder] Process completed successfully.');

    } catch (error) {
        appendLog(`[Critical Error] ${error.message}`);
        alert(`An error occurred during conversion: ${error.message}\nCheck logs for more details.`);
        
        // Restore controls
        document.getElementById('progressPanel').classList.add('hidden');
        document.getElementById('fileInfoPanel').classList.remove('hidden');
        document.getElementById('convertBtn').classList.remove('hidden');
        document.getElementById('settingsPanel').classList.remove('hidden');
    } finally {
        // Always release screen lock when finished
        releaseWakeLock();
    }
}

// File Selection Trigger
function handleFileSelect(file) {
    if (!file) return;

    const isAvi = file.name.toLowerCase().endsWith('.avi');
    const isVideo = file.type.startsWith('video/');

    if (!isAvi && !isVideo) {
        alert('Unsupported file format. Please upload a Kodak Charmera .avi video.');
        return;
    }

    selectedFile = file;
    document.getElementById('infoFileName').textContent = file.name;
    document.getElementById('infoFileSize').textContent = formatBytes(file.size);

    document.getElementById('fileInfoPanel').classList.remove('hidden');
    document.getElementById('convertBtn').classList.remove('hidden');
    document.getElementById('dropZoneContainer').classList.add('hidden');
}

// Event Listeners Setup
document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('fileInput');
    const dropZone = document.getElementById('dropZone');
    const removeFileBtn = document.getElementById('removeFileBtn');
    const convertBtn = document.getElementById('convertBtn');
    const resetBtn = document.getElementById('resetBtn');
    const consoleToggle = document.getElementById('consoleToggle');
    const consoleLogContainer = document.getElementById('consoleLogContainer');
    const consoleToggleIcon = document.getElementById('consoleToggleIcon');
    const presetButtons = document.querySelectorAll('[data-preset]');
    const accordionHeaders = document.querySelectorAll('.accordion-header');

    // Preset Selection Handler
    presetButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            selectedPreset = btn.getAttribute('data-preset');
            presetButtons.forEach(b => {
                if (b === btn) {
                    b.classList.add('text-white', 'bg-violet-600/20', 'border-violet-500/30', 'shadow-sm');
                    b.classList.remove('text-zinc-400', 'hover:text-white', 'hover:bg-zinc-900');
                } else {
                    b.classList.remove('text-white', 'bg-violet-600/20', 'border-violet-500/30', 'shadow-sm');
                    b.classList.add('text-zinc-400', 'hover:text-white', 'hover:bg-zinc-900');
                }
            });
        });
    });

    // File Input Trigger
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFileSelect(e.target.files[0]);
        }
    });

    // Drag & Drop Handlers
    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.add('drag-over');
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove('drag-over');
        }, false);
    });

    dropZone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files.length > 0) {
            handleFileSelect(files[0]);
        }
    });

    // Action Handlers
    removeFileBtn.addEventListener('click', resetSelector);
    convertBtn.addEventListener('click', startTranscoding);
    resetBtn.addEventListener('click', resetAll);

    // Collapsible Console Logger Toggle
    consoleToggle.addEventListener('click', () => {
        const isHidden = consoleLogContainer.classList.toggle('hidden');
        if (isHidden) {
            consoleToggleIcon.style.transform = 'rotate(0deg)';
        } else {
            consoleToggleIcon.style.transform = 'rotate(180deg)';
        }
    });

    // Collapsible Accordions (Info Area)
    accordionHeaders.forEach(header => {
        header.addEventListener('click', () => {
            const item = header.closest('.accordion-item');
            const content = item.querySelector('.accordion-content');
            
            // Close all other accordion items (accordion behavior)
            document.querySelectorAll('.accordion-item').forEach(otherItem => {
                if (otherItem !== item && otherItem.classList.contains('active')) {
                    otherItem.classList.remove('active');
                    otherItem.querySelector('.accordion-content').style.maxHeight = '0px';
                }
            });
            
            // Toggle current
            const isActive = item.classList.toggle('active');
            if (isActive) {
                content.style.maxHeight = content.scrollHeight + 'px';
            } else {
                content.style.maxHeight = '0px';
            }
        });
    });

    // PWA Service Worker Registration
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('sw.js')
                .then(reg => {
                    console.log('Service Worker registered successfully with scope:', reg.scope);
                })
                .catch(err => {
                    console.warn('Service Worker registration failed:', err);
                });
        });
    }

    // Wake Lock Visibility Change Handler
    // Re-acquire screen wake lock if user switches tabs and back during conversion
    document.addEventListener('visibilitychange', async () => {
        if (wakeLock !== null && document.visibilityState === 'visible') {
            await requestWakeLock();
        }
    });
});
