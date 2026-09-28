# Serve docs/ like GitHub Pages: under /digital-assistant/, extensionless -> .html
import http.server, os, sys
ROOT = sys.argv[1]
class H(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        path = path.split('?')[0].split('#')[0]
        if not path.startswith('/digital-assistant/'): return '/nonexistent'
        p = os.path.join(ROOT, path[len('/digital-assistant/'):])
        if os.path.isdir(p): p = os.path.join(p, 'index.html')
        if not os.path.exists(p) and os.path.exists(p + '.html'): p += '.html'
        return p
    def log_message(self, *a): pass
H.extensions_map['.mjs'] = 'text/javascript'
http.server.ThreadingHTTPServer(('127.0.0.1', 8765), H).serve_forever()
