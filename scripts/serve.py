#!/usr/bin/env python3
"""Local dev server that tells the browser never to cache, so edits show up on a normal refresh.

Usage: python3 scripts/serve.py [port]   (default 8000), then open http://127.0.0.1:8000
"""
import functools
import http.server
import os
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
    handler = functools.partial(NoCacheHandler, directory=root)
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        print(f"Serving HSR Tools at http://127.0.0.1:{port} (no caching)")
        httpd.serve_forever()
