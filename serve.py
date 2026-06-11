#!/usr/bin/env python3
"""Static server for X-Recorder with caching disabled, so code changes are
picked up on a plain reload (python's default http.server lets browsers cache
heuristically, which serves stale JS/CSS after edits)."""
import http.server
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        super().end_headers()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    http.server.ThreadingHTTPServer(('', port), NoCacheHandler).serve_forever()
