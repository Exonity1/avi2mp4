import http.server
import socketserver
import sys

PORT = 8000

class MyHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Enable CORS headers
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

# Set up custom MIME type mappings to override incorrect Windows Registry entries
MyHTTPRequestHandler.extensions_map.update({
    '.js': 'application/javascript',
    '.wasm': 'application/wasm',
    '.css': 'text/css',
    '.html': 'text/html',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
})

Handler = MyHTTPRequestHandler

# Allow instant reuse of the port when restarting
socketserver.TCPServer.allow_reuse_address = True

try:
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print(f"Local Server running at http://localhost:{PORT}")
        sys.stdout.flush()
        httpd.serve_forever()
except Exception as e:
    print(f"Error starting server: {e}", file=sys.stderr)
    sys.exit(1)
except KeyboardInterrupt:
    print("\nShutting down server...")
    sys.exit(0)
