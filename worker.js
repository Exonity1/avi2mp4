/* Web Worker for CharmeraTranscoder background execution */

// Mock browser-specific variables to satisfy Webpack environment checks in Web Worker scope
self.document = {
    baseURI: self.location.href,
    getElementsByTagName: () => []
};

// Load the self-contained ffmpeg.wasm wrapper script
importScripts('ffmpeg/ffmpeg.min.js');

let ffmpeg = null;

self.onmessage = async (event) => {
    const { type, data } = event.data;

    if (type === 'LOAD') {
        try {
            const { corePath } = data;
            const { createFFmpeg } = self.FFmpeg;

            // Initialize the FFmpeg object in the worker thread
            ffmpeg = createFFmpeg({
                corePath: corePath,
                mainName: 'main',
                log: false // Custom logging handled via setLogger
            });

            // Pass execution logs back to the main UI thread
            ffmpeg.setLogger(({ message }) => {
                self.postMessage({ type: 'LOG', data: message });
            });

            // Pass progress ratios back to the main UI thread
            ffmpeg.setProgress(({ ratio }) => {
                self.postMessage({ type: 'PROGRESS', data: ratio });
            });

            await ffmpeg.load();
            self.postMessage({ type: 'LOADED' });
        } catch (error) {
            self.postMessage({ type: 'ERROR', data: `Failed to load transcoder engine: ${error.message}` });
        }
    }

    else if (type === 'TRANSCODE') {
        try {
            const { fileData, preset } = data;

            if (!ffmpeg || !ffmpeg.isLoaded()) {
                throw new Error("Transcoder engine is not initialized.");
            }

            // Write input file to the virtual WebAssembly filesystem
            ffmpeg.FS('writeFile', 'input.avi', new Uint8Array(fileData));

            // Execute the conversion command
            // Equivalent to: ffmpeg -i input.avi -c:v libx264 -crf 18 -preset [preset] -c:a aac -b:a 128k output.mp4
            await ffmpeg.run(
                '-i', 'input.avi',
                '-c:v', 'libx264',
                '-crf', '18',
                '-preset', preset,
                '-c:a', 'aac',
                '-b:a', '128k',
                'output.mp4'
            );

            // Read the resulting MP4 file from the virtual filesystem
            const outputData = ffmpeg.FS('readFile', 'output.mp4');

            // Clean up files to release WebAssembly memory immediately
            ffmpeg.FS('unlink', 'input.avi');
            ffmpeg.FS('unlink', 'output.mp4');

            // Send output buffer back to main thread using transferable array buffer to avoid copying memory
            self.postMessage({ type: 'DONE', data: outputData.buffer }, [outputData.buffer]);
        } catch (error) {
            self.postMessage({ type: 'ERROR', data: `Transcoding failed: ${error.message}` });
        }
    }
};
