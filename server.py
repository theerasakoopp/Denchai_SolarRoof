import http.server
import socketserver

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

if __name__ == '__main__':
    PORT = 8081
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(('', PORT), NoCacheHandler) as httpd:
        print(f"Denchai WebGIS running with NO-CACHE on port {PORT}", flush=True)
        httpd.serve_forever()
