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

    def send_json(self, status_code, data_obj):
        resp_bytes = json.dumps(data_obj, ensure_ascii=False).encode('utf-8')
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(resp_bytes)))
        self.send_header('Connection', 'close')
        self.end_headers()
        self.wfile.write(resp_bytes)

    def do_POST(self):
        if self.path == '/api/delete_facet':
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8') if content_length > 0 else '{}'
            try:
                req = json.loads(body)
            except Exception:
                req = {}
            
            target_ids = set()
            if 'id' in req and req['id']:
                target_ids.add(str(req['id']))
            if 'ids' in req and isinstance(req['ids'], list):
                target_ids.update(str(x) for x in req['ids'] if x)

            if not target_ids:
                return self.send_json(400, {'success': False, 'error': 'No ID provided'})

            # Ensure backup exists before modification
            if not os.path.exists(BACKUP_PATH) and os.path.exists(FACETS_PATH):
                shutil.copy2(FACETS_PATH, BACKUP_PATH)

            if not os.path.exists(FACETS_PATH):
                return self.send_json(404, {'success': False, 'error': 'Facets file not found'})

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
                # Atomic write to prevent file corruption
                temp_facets = FACETS_PATH + '.tmp'
                with open(temp_facets, 'w', encoding='utf-8') as f:
                    json.dump(data, f, ensure_ascii=False)
                os.replace(temp_facets, FACETS_PATH)

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

                    temp_stats = STATS_PATH + '.tmp'
                    with open(temp_stats, 'w', encoding='utf-8') as f:
                        json.dump(stats, f, ensure_ascii=False, indent=2)
                    os.replace(temp_stats, STATS_PATH)

            print(f"[QA DELETION] Deleted {deleted_count} facets: {list(target_ids)} | Remaining: {new_len}", flush=True)

            return self.send_json(200, {
                'success': True,
                'deleted_ids': list(target_ids),
                'deleted_count': deleted_count,
                'remaining_facets': new_len
            })

        elif self.path == '/api/restore_all':
            if os.path.exists(BACKUP_PATH):
                shutil.copy2(BACKUP_PATH, FACETS_PATH)
                print("[RESTORE] Restored all facets from backup", flush=True)
                return self.send_json(200, {'success': True, 'message': 'Restored all facets from backup'})
            else:
                return self.send_json(404, {'success': False, 'error': 'No backup found'})

        else:
            self.send_response(404)
            self.send_header('Content-Length', '0')
            self.send_header('Connection', 'close')
            self.end_headers()

if __name__ == '__main__':
    PORT = 8081
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(('', PORT), WebGISHandler) as httpd:
        print(f"Denchai WebGIS running with NO-CACHE & QA Delete API on port {PORT}", flush=True)
        httpd.serve_forever()
