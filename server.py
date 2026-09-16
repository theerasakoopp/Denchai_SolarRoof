import http.server
import socketserver
import os
import json
import shutil

import subprocess
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, 'data')
FACETS_PATH = os.path.join(DATA_DIR, 'denchai_solar_facets.geojson')
BACKUP_PATH = os.path.join(DATA_DIR, 'denchai_solar_facets_backup.geojson')
STATS_PATH = os.path.join(DATA_DIR, 'denchai_stats.json')

BUILDINGS_PATH = os.path.join(DATA_DIR, 'denchai_buildings.geojson')
BUILDINGS_BACKUP_PATH = os.path.join(DATA_DIR, 'denchai_buildings_backup.geojson')

import glob

git_candidates = sorted(glob.glob(r"C:\Users\theerasak\AppData\Local\GitHubDesktop\app-*\resources\app\git\cmd\git.exe"))
if git_candidates:
    GIT_PATH = git_candidates[-1]
elif shutil.which("git"):
    GIT_PATH = shutil.which("git")
else:
    GIT_PATH = "git"
print(f"[GIT] Using Git executable at: {GIT_PATH}")

# Create initial backups if not already present
if os.path.exists(FACETS_PATH) and not os.path.exists(BACKUP_PATH):
    shutil.copy2(FACETS_PATH, BACKUP_PATH)
    print(f"[BACKUP] Created initial facets backup at: {BACKUP_PATH}")

if os.path.exists(BUILDINGS_PATH) and not os.path.exists(BUILDINGS_BACKUP_PATH):
    shutil.copy2(BUILDINGS_PATH, BUILDINGS_BACKUP_PATH)
    print(f"[BACKUP] Created initial buildings backup at: {BUILDINGS_BACKUP_PATH}")

class WebGISHandler(http.server.SimpleHTTPRequestHandler):
    def send_head(self):
        # Strip caching headers so browser never gets 304 Not Modified
        if 'If-Modified-Since' in self.headers:
            del self.headers['If-Modified-Since']
        if 'If-None-Match' in self.headers:
            del self.headers['If-None-Match']
        return super().send_head()

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

    def do_GET(self):
        if self.path == '/api/git_status':
            try:
                res = subprocess.run([GIT_PATH, 'status', '--porcelain'], cwd=BASE_DIR, capture_output=True, text=True, encoding='utf-8', errors='replace')
                lines = [line.strip() for line in res.stdout.strip().split('\n') if line.strip()]
                return self.send_json(200, {
                    'has_changes': len(lines) > 0,
                    'changes_count': len(lines),
                    'files': lines
                })
            except Exception as e:
                return self.send_json(500, {'error': str(e)})
        else:
            return super().do_GET()

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
            
            # Find building_ids of deleted facets
            affected_bld_ids = set()
            for feat in data.get('features', []):
                fid = str(feat.get('id') or feat.get('properties', {}).get('id'))
                if fid in target_ids:
                    bld_id = feat.get('properties', {}).get('building_id')
                    if bld_id:
                        affected_bld_ids.add(str(bld_id))

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

                # Sync denchai_buildings.geojson
                if os.path.exists(BUILDINGS_PATH) and affected_bld_ids:
                    try:
                        with open(BUILDINGS_PATH, 'r', encoding='utf-8') as bf:
                            bld_data = json.load(bf)
                        
                        # Check remaining facets for each affected building
                        remaining_facets_by_bld = {}
                        for feat in data['features']:
                            bid = feat.get('properties', {}).get('building_id')
                            if bid:
                                remaining_facets_by_bld.setdefault(str(bid), []).append(feat)

                        new_bld_features = []
                        for bld_feat in bld_data.get('features', []):
                            bid = str(bld_feat.get('id') or bld_feat.get('properties', {}).get('building_id'))
                            if bid in affected_bld_ids:
                                cur_facets = remaining_facets_by_bld.get(bid, [])
                                if not cur_facets:
                                    # All facets of this building were deleted -> remove the building too!
                                    continue
                                else:
                                    # Update building totals
                                    bld_feat['properties']['facet_count'] = len(cur_facets)
                                    bld_feat['properties']['capacity_kwp'] = round(sum(f['properties'].get('capacity_kwp', 0.0) for f in cur_facets), 2)
                                    bld_feat['properties']['energy_kwh'] = round(sum(f['properties'].get('energy_corrected_kwh', f['properties'].get('energy_kwh', 0.0)) for f in cur_facets), 2)
                            new_bld_features.append(bld_feat)

                        bld_data['features'] = new_bld_features
                        temp_bld = BUILDINGS_PATH + '.tmp'
                        with open(temp_bld, 'w', encoding='utf-8') as bf:
                            json.dump(bld_data, bf, ensure_ascii=False)
                        os.replace(temp_bld, BUILDINGS_PATH)
                    except Exception as be:
                        print(f"[BUILDING SYNC ERROR]: {be}", flush=True)

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

        elif self.path == '/api/delete_building':
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8') if content_length > 0 else '{}'
            try:
                req = json.loads(body)
            except Exception:
                req = {}
            
            bld_id = str(req.get('building_id') or req.get('id') or '')
            if not bld_id:
                return self.send_json(400, {'success': False, 'error': 'No building_id provided'})

            # Delete from denchai_buildings.geojson
            deleted_bld = False
            if os.path.exists(BUILDINGS_PATH):
                with open(BUILDINGS_PATH, 'r', encoding='utf-8') as f:
                    b_data = json.load(f)
                b_orig = len(b_data.get('features', []))
                b_data['features'] = [
                    f for f in b_data.get('features', [])
                    if str(f.get('id')) != bld_id and str(f.get('properties', {}).get('building_id')) != bld_id
                ]
                if len(b_data['features']) < b_orig:
                    deleted_bld = True
                    temp_b = BUILDINGS_PATH + '.tmp'
                    with open(temp_b, 'w', encoding='utf-8') as f:
                        json.dump(b_data, f, ensure_ascii=False)
                    os.replace(temp_b, BUILDINGS_PATH)

            # Delete all facets of this building from denchai_solar_facets.geojson
            deleted_facet_count = 0
            remaining_facets = 0
            if os.path.exists(FACETS_PATH):
                with open(FACETS_PATH, 'r', encoding='utf-8') as f:
                    f_data = json.load(f)
                f_orig = len(f_data.get('features', []))
                f_data['features'] = [
                    f for f in f_data.get('features', [])
                    if str(f.get('properties', {}).get('building_id')) != bld_id
                ]
                remaining_facets = len(f_data['features'])
                deleted_facet_count = f_orig - remaining_facets

                if deleted_facet_count > 0:
                    temp_f = FACETS_PATH + '.tmp'
                    with open(temp_f, 'w', encoding='utf-8') as f:
                        json.dump(f_data, f, ensure_ascii=False)
                    os.replace(temp_f, FACETS_PATH)

                    # Update stats
                    if os.path.exists(STATS_PATH):
                        with open(STATS_PATH, 'r', encoding='utf-8') as f:
                            stats = json.load(f)
                        total_cap = sum(feat['properties'].get('capacity_kwp', 0.0) for feat in f_data['features']) / 1000.0
                        total_gen = sum(feat['properties'].get('energy_corrected_kwh', feat['properties'].get('energy_kwh', 0.0)) for feat in f_data['features']) / 1e6
                        tariff = stats.get('standard_tariff_thb', 4.5)
                        stats['total_facets'] = remaining_facets
                        stats['total_capacity_mwp'] = round(total_cap, 2)
                        stats['total_generation_gwh_yr'] = round(total_gen, 2)
                        stats['total_bill_savings_thb_m_yr'] = round(total_gen * 1e6 * tariff / 1e6, 2)
                        stats['total_co2_offset_tons_yr'] = round(total_gen * 1e6 * 0.0004999, 1)
                        temp_stats = STATS_PATH + '.tmp'
                        with open(temp_stats, 'w', encoding='utf-8') as f:
                            json.dump(stats, f, ensure_ascii=False, indent=2)
                        os.replace(temp_stats, STATS_PATH)

            print(f"[QA BLD DELETION] Deleted building {bld_id} (and {deleted_facet_count} facets) | Remaining: {remaining_facets}", flush=True)

            return self.send_json(200, {
                'success': True,
                'building_id': bld_id,
                'deleted_facet_count': deleted_facet_count,
                'remaining_facets': remaining_facets
            })

        elif self.path == '/api/restore_all':
            if os.path.exists(BACKUP_PATH):
                shutil.copy2(BACKUP_PATH, FACETS_PATH)
            if os.path.exists(BUILDINGS_BACKUP_PATH):
                shutil.copy2(BUILDINGS_BACKUP_PATH, BUILDINGS_PATH)
            print("[RESTORE] Restored all facets and buildings from backup", flush=True)
            return self.send_json(200, {'success': True, 'message': 'Restored all facets and buildings from backup'})

        elif self.path == '/api/git_sync':
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8') if content_length > 0 else '{}'
            try:
                req = json.loads(body)
            except Exception:
                req = {}
            
            commit_msg = req.get('message') or f"QA Update: Cleaned rooftop facets and false positives ({datetime.now().strftime('%Y-%m-%d %H:%M:%S')})"

            try:
                git_env = os.environ.copy()
                git_env['PYTHONIOENCODING'] = 'utf-8'

                # 1. git add -A
                add_res = subprocess.run([GIT_PATH, 'add', '-A'], cwd=BASE_DIR, capture_output=True, text=True, encoding='utf-8', errors='replace', env=git_env)
                if add_res.returncode != 0:
                    return self.send_json(500, {'success': False, 'error': add_res.stderr or 'git add failed'})

                # Check if there is anything to commit
                status_res = subprocess.run([GIT_PATH, 'status', '--porcelain'], cwd=BASE_DIR, capture_output=True, text=True, encoding='utf-8', errors='replace', env=git_env)
                if not status_res.stdout.strip():
                    return self.send_json(200, {
                        'success': True,
                        'message': 'ข้อมูลเป็นปัจจุบันแล้ว ไม่มีรายการเปลี่ยนแปลงใหม่ที่ต้องบันทึก',
                        'already_up_to_date': True
                    })

                # 2. git commit -m
                commit_res = subprocess.run([GIT_PATH, 'commit', '-m', commit_msg], cwd=BASE_DIR, capture_output=True, text=True, encoding='utf-8', errors='replace', env=git_env)
                if commit_res.returncode != 0:
                    return self.send_json(500, {'success': False, 'error': commit_res.stderr or 'git commit failed'})

                # 3. git push origin main
                push_res = subprocess.run([GIT_PATH, 'push', 'origin', 'main'], cwd=BASE_DIR, capture_output=True, text=True, encoding='utf-8', errors='replace', env=git_env)
                if push_res.returncode != 0:
                    return self.send_json(500, {'success': False, 'error': push_res.stderr or 'git push failed'})

                # Get short commit hash
                hash_res = subprocess.run([GIT_PATH, 'rev-parse', '--short', 'HEAD'], cwd=BASE_DIR, capture_output=True, text=True, encoding='utf-8', errors='replace', env=git_env)
                commit_hash = hash_res.stdout.strip()

                print(f"[GIT SYNC] Successfully committed & pushed ({commit_hash}): {commit_msg}", flush=True)

                return self.send_json(200, {
                    'success': True,
                    'commit_hash': commit_hash,
                    'message': f'บันทึกและส่งขึ้น GitHub สำเร็จ (Commit: {commit_hash})',
                    'repo_url': 'https://github.com/theerasakoopp/Denchai_SolarRoof',
                    'commit_url': f'https://github.com/theerasakoopp/Denchai_SolarRoof/commit/{commit_hash}'
                })
            except Exception as e:
                print(f"[GIT SYNC ERROR]: {e}", flush=True)
                return self.send_json(500, {'success': False, 'error': str(e)})

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
