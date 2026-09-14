import http.server
import socketserver
import os
import json
import shutil

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, 'data')
FACETS_PATH = os.path.join(DATA_DIR, 'denchai_solar_facets.geojson')
BACKUP_PATH = os.path.join(DATA_DIR, 'denchai_solar_facets_backup.geojson')
STATS_PATH = os.path.join(DATA_DIR, 'denchai_stats.json')

# Create an initial backup if not already present
if os.path.exists(FACETS_PATH) and not os.path.exists(BACKUP_PATH):
    shutil.copy2(FACETS_PATH, BACKUP_PATH)
    print(f"[BACKUP] Created initial facets backup at: {BACKUP_PATH}")

class WebGISHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def do_POST(self):
        if self.path == '/api/delete_facet':
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8')
            try:
                req = json.loads(body)
            except Exception:
                req = {}
            
            target_ids = set()
            if 'id' in req:
                target_ids.add(str(req['id']))
            if 'ids' in req and isinstance(req['ids'], list):
                target_ids.update(str(x) for x in req['ids'])

            if not target_ids:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(b'{"success": false, "error": "No ID provided"}')
                return

            # Ensure backup exists before modification
            if not os.path.exists(BACKUP_PATH):
                shutil.copy2(FACETS_PATH, BACKUP_PATH)

            with open(FACETS_PATH, 'r', encoding='utf-8') as f:
                data = json.load(f)

            orig_len = len(data.get('features', []))
            data['features'] = [
                feat for feat in data.get('features', [])
                if str(feat.get('id')) not in target_ids and str(feat.get('properties', {}).get('id')) not in target_ids
            ]
            new_len = len(data['features'])
            deleted_count = orig_len - new_len

            if deleted_count > 0:
                with open(FACETS_PATH, 'w', encoding='utf-8') as f:
                    json.dump(data, f, ensure_ascii=False)

                # Recalculate statistics in denchai_stats.json
                if os.path.exists(STATS_PATH):
                    with open(STATS_PATH, 'r', encoding='utf-8') as f:
                        stats = json.load(f)

                    total_cap = sum(feat['properties'].get('capacity_kwp', 0.0) for feat in data['features']) / 1000.0
                    total_gen = sum(feat['properties'].get('energy_corrected_kwh', feat['properties'].get('energy_kwh', 0.0)) for feat in data['features']) / 1e6
                    tariff = stats.get('standard_tariff_thb', 4.5)

                    stats['total_facets'] = new_len
                    stats['total_capacity_mwp'] = round(total_cap, 2)
                    stats['total_generation_gwh_yr'] = round(total_gen, 2)
                    stats['total_bill_savings_thb_m_yr'] = round(total_gen * 1e6 * tariff / 1e6, 2)
                    stats['total_co2_offset_tons_yr'] = round(total_gen * 1e6 * 0.0004999, 1)

                    with open(STATS_PATH, 'w', encoding='utf-8') as f:
                        json.dump(stats, f, ensure_ascii=False, indent=2)

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            resp = json.dumps({
                'success': True,
                'deleted_ids': list(target_ids),
                'deleted_count': deleted_count,
                'remaining_facets': new_len
            })
            self.wfile.write(resp.encode('utf-8'))
            return

        elif self.path == '/api/restore_all':
            if os.path.exists(BACKUP_PATH):
                shutil.copy2(BACKUP_PATH, FACETS_PATH)
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(b'{"success": true, "message": "Restored all facets from backup"}')
            else:
                self.send_response(404)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(b'{"success": false, "error": "No backup found"}')
            return

        else:
            self.send_response(404)
            self.end_headers()

if __name__ == '__main__':
    PORT = 8081
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(('', PORT), WebGISHandler) as httpd:
        print(f"Denchai WebGIS running with NO-CACHE & QA Delete API on port {PORT}", flush=True)
        httpd.serve_forever()
