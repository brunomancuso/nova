"""
Dev server for Nova Drill Control.

Default: HTTPS with a self-signed cert. Use --http for plain HTTP.

Run:
    python server.py                # HTTPS on :8443 (default)
    python server.py --http         # HTTP on :8000
    python server.py --port 5000    # custom port
"""

import argparse
import os, ssl, socket, http.server, json, re
from urllib.parse import urlparse, unquote

CERT  = "cert.pem"
KEY   = "key.pem"
ROOT  = os.path.dirname(os.path.abspath(__file__))

# ── Generate self-signed cert if missing ─────────────────────────────────────
if not os.path.exists(CERT) or not os.path.exists(KEY):
    print("Generating self-signed certificate...")
    import datetime, ipaddress
    from cryptography import x509
    from cryptography.x509.oid import NameOID
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    # Collect all local IPs for the SAN so Android accepts the cert
    local_ips = []
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None):
            ip = info[4][0]
            if not ip.startswith("127.") and ":" not in ip:
                local_ips.append(ipaddress.IPv4Address(ip))
    except Exception:
        pass
    local_ips.append(ipaddress.IPv4Address("127.0.0.1"))

    san = x509.SubjectAlternativeName(
        [x509.DNSName("localhost")]
        + [x509.IPAddress(ip) for ip in local_ips]
    )

    cert = (
        x509.CertificateBuilder()
        .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "localhost")]))
        .issuer_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "localhost")]))
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(datetime.datetime.utcnow())
        .not_valid_after(datetime.datetime.utcnow() + datetime.timedelta(days=3650))
        .add_extension(san, critical=False)
        .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
        .sign(key, hashes.SHA256())
    )

    with open(KEY,  "wb") as f:
        f.write(key.private_bytes(serialization.Encoding.PEM,
                                   serialization.PrivateFormat.TraditionalOpenSSL,
                                   serialization.NoEncryption()))
    with open(CERT, "wb") as f:
        f.write(cert.public_bytes(serialization.Encoding.PEM))

    print(f"  cert.pem / key.pem written.")
    print(f"  IPs included in cert: {[str(ip) for ip in local_ips]}")

# ── Start HTTPS server ────────────────────────────────────────────────────────
os.chdir(ROOT)
DATA_FILE = os.path.join(ROOT, 'drills_data.json')

# A profile is the name of a drills_data.<profile>.json file. The UI shows the
# profile name in uppercase, the file name is stored lowercase.
PROFILE_RE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9 _-]{0,31}$')
EMPTY_STORE = {"dataA": [], "dataB": [], "dataC": [], "dataD": []}


def profile_path(name):
    return os.path.join(ROOT, f'drills_data.{str(name).lower()}.json')


def list_profiles():
    names = []
    try:
        for entry in os.listdir(ROOT):
            m = re.fullmatch(r'drills_data\.(.+)\.json', entry)
            if m and PROFILE_RE.match(m.group(1)):
                names.append(m.group(1))
    except OSError:
        pass
    return sorted(names)


def seed_data():
    """Drill data used to seed a brand-new profile: the shipped drills_data.json,
    otherwise an empty store."""
    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass
    return dict(EMPTY_STORE)


class NovaHandler(http.server.SimpleHTTPRequestHandler):
    def _json(self, code, payload):
        body = json.dumps(payload).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlparse(self.path).path

        if path == '/api/drills':
            if os.path.exists(DATA_FILE):
                with open(DATA_FILE, 'r', encoding='utf-8') as f:
                    body = f.read().encode('utf-8')
            else:
                body = b'{}'
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', len(body))
            self.end_headers()
            self.wfile.write(body)

        elif path == '/api/profiles':
            self._json(200, {"profiles": list_profiles()})

        else:
            super().do_GET()

    def do_POST(self):
        path = unquote(urlparse(self.path).path)

        if path == '/api/drills':
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            try:
                data = json.loads(body)
                with open(DATA_FILE, 'w', encoding='utf-8') as f:
                    json.dump(data, f, indent=2)
                resp = b'{"ok":true}'
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(resp))
                self.end_headers()
                self.wfile.write(resp)
            except Exception as e:
                msg = str(e).encode()
                self.send_response(500)
                self.send_header('Content-Length', len(msg))
                self.end_headers()
                self.wfile.write(msg)

        # Create a profile file (empty, or a copy of another profile).
        elif path == '/api/profiles':
            length = int(self.headers.get('Content-Length', 0) or 0)
            try:
                req = json.loads(self.rfile.read(length) or b'{}')
            except Exception:
                return self._json(400, {"error": "invalid json"})

            # Profile names are uppercase in the UI, lowercase in the file name.
            name = str(req.get('name') or '').strip().lower()
            src  = str(req.get('from') or '').strip().lower()
            if not PROFILE_RE.match(name):
                return self._json(400, {"error": "invalid name"})

            dst = profile_path(name)
            if os.path.exists(dst):
                return self._json(409, {"error": "already exists"})

            if src:
                if not PROFILE_RE.match(src) or not os.path.exists(profile_path(src)):
                    return self._json(404, {"error": "source profile missing"})
                with open(profile_path(src), 'r', encoding='utf-8') as f:
                    data = json.load(f)
            else:
                data = seed_data()

            with open(dst, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2)
            return self._json(200, {"ok": True, "name": name})

        # Rename a profile file (profile names are always uppercase).
        elif path == '/api/profiles/rename':
            length = int(self.headers.get('Content-Length', 0) or 0)
            try:
                req = json.loads(self.rfile.read(length) or b'{}')
            except Exception:
                return self._json(400, {"error": "invalid json"})

            src = str(req.get('from') or '').strip().lower()
            dst = str(req.get('to') or '').strip().lower()
            if not PROFILE_RE.match(src) or not PROFILE_RE.match(dst):
                return self._json(400, {"error": "invalid name"})
            if not os.path.exists(profile_path(src)):
                return self._json(404, {"error": "profile missing"})
            if src == dst:
                return self._json(200, {"ok": True, "name": dst})
            if os.path.exists(profile_path(dst)):
                return self._json(409, {"error": "already exists"})
            os.replace(profile_path(src), profile_path(dst))
            return self._json(200, {"ok": True, "name": dst})

        # Write one profile's drill data back to its file.
        elif path.startswith('/api/profile/'):
            name = path[len('/api/profile/'):]
            if not PROFILE_RE.match(name):
                return self._json(400, {"error": "invalid name"})
            length = int(self.headers.get('Content-Length', 0) or 0)
            try:
                data = json.loads(self.rfile.read(length) or b'{}')
            except Exception:
                return self._json(400, {"error": "invalid json"})
            with open(profile_path(name), 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2)
            return self._json(200, {"ok": True})

        else:
            self.send_error(404)

    def log_message(self, format, *args):
        pass  # suppress per-request access logs

def main():
    parser = argparse.ArgumentParser(description="Serve the Nova app over HTTPS or HTTP.")
    parser.add_argument("--https", action="store_true",
                        help="Serve over HTTPS (this is the default)")
    parser.add_argument("--http", action="store_true",
                        help="Serve plain HTTP instead of HTTPS")
    parser.add_argument("--port", type=int, default=None,
                        help="Port to listen on (default: 8443 for HTTPS, 8000 for HTTP)")
    parser.add_argument("--host", default="0.0.0.0", help="Bind address")
    args = parser.parse_args()

    use_https = (not args.http) or args.https
    port = args.port if args.port is not None else (8443 if use_https else 8000)
    scheme = "https" if use_https else "http"

    # Threaded: a browser keep-alive connection must not block the API calls
    # made by the profile picker.
    server = http.server.ThreadingHTTPServer((args.host, port), NovaHandler)

    if use_https:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(CERT, KEY)
        server.socket = ctx.wrap_socket(server.socket, server_side=True)

    print(f"Serving {scheme.upper()} on port {port}...")
    try:
        ips = set()
        for info in socket.getaddrinfo(socket.gethostname(), None):
            ip = info[4][0]
            if not ip.startswith("127.") and ":" not in ip:
                ips.add(ip)
        for ip in sorted(ips):
            print(f"  {scheme}://{ip}:{port}")
    except Exception:
        pass
    print(f"  {scheme}://localhost:{port}")
    if use_https:
        print("On Android: accept the security warning (Advanced → Proceed) — it's your own cert.")
    print("Press Ctrl+C to stop.\n")

    server.serve_forever()


if __name__ == "__main__":
    main()
