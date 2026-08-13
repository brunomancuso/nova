"""
Dev server for Nova Drill Control.

Default: HTTPS with a self-signed cert. Use --http for plain HTTP.

Run:
    python server.py                # HTTPS on :8443 (default)
    python server.py --http         # HTTP on :8000
    python server.py --port 5000    # custom port
"""

import argparse
import os, ssl, socket, http.server, json

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

class NovaHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/api/drills':
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
        else:
            super().do_GET()

    def do_POST(self):
        if self.path == '/api/drills':
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

    server = http.server.HTTPServer((args.host, port), NovaHandler)

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
