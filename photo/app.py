"""Локальний застосунок: перегляд «до/після», підсумкові автоматичні значення з можливістю
вимкнути кожне, ручні поправки, зони, поворот, обробка папки і збереження результату.
Запуск:  python app.py [шлях_до_папки_з_фото]

Фото беруться і з підпапок (наприклад, папки замовників усередині папки групи);
у списку й у результаті зберігається та сама структура.

Після відкриття папки програма аналізує кожне фото і позначає, яким обробка потрібна,
а яким ні. Обробляються лише потрібні. Результат зберігається або окремою папкою
(оригінали не змінюються), або замість оригіналів — на вибір."""
import os, sys, json, io, shutil, threading, webbrowser, traceback, time, glob, subprocess
from concurrent.futures import ProcessPoolExecutor
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import enhance as E, runner as R, azart_io as IO

HERE = E.res_dir()
SETTINGS_FILE = 'azart-settings.json'
TMP_DIR = R.TMP_DIR
PREVIEW_MAX = 1280
SIDES = (PREVIEW_MAX, 2600, 0)      # розміри перегляду: звичайний, збільшений, повний (0)
PING_VERSION = 2
LOCK = threading.Lock()
WANT = {}          # останній запитаний кадр «після» для кожного вікна
STATE = dict(src=None, files=[], rel={}, small={}, info={}, wb={}, settings={}, job=None, scan=None,
             workers=None, gen=0, processed=[], out={}, skip=())
INFO_KEYS = ('white', 'black', 'gamma', 'temp', 'tint', 'whites', 'guard', 'light',
             'ev', 'shadows', 'highlights', 'contrast', 'sat')


# ------------------------------------------------------------------ налаштування
def blank():
    return dict(zones=[], adjust={}, rotate=0, off=[], mode='auto', crop=None)


def rel_of(f):
    """Шлях фото відносно відкритої папки, через «/» (так його бачить вікно програми)."""
    return os.path.relpath(f, STATE['src']).replace(os.sep, '/')


def crop_dict(c):
    b = IO.crop_box(c)
    if b is None: return None
    d = dict(zip(('x', 'y', 'w', 'h'), (round(v, 5) for v in b[:4])))
    if b[4]: d['a'] = round(b[4], 3)
    return d


def crop_key(c):
    b = IO.crop_box(c)
    return None if b is None else tuple(round(v, 4) for v in b)


def load_settings(src):
    p = os.path.join(src, SETTINGS_FILE)
    if os.path.exists(p):
        try: return json.load(open(p, encoding='utf-8'))
        except Exception: pass
    return {}


def save_settings():
    if not STATE['src']: return
    data = {}
    for f, s in STATE['settings'].items():
        keep = {k: v for k, v in s.items() if v and not (k == 'mode' and v == 'auto')}
        if keep: data[rel_of(f)] = keep
    p = os.path.join(STATE['src'], SETTINGS_FILE)
    try:
        if data: json.dump(data, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        elif os.path.exists(p): os.remove(p)
    except OSError:
        pass


def st_of(f):
    return STATE['settings'].setdefault(f, blank())


def open_folder(src, skip=None):
    """Відкриває папку разом із підпапками. skip — назва папки результату всередині неї:
    її фото в список не беремо."""
    if skip is None: skip = last_skip()
    skip = tuple(x for x in ((skip,) if isinstance(skip, str) else skip) if x and not os.path.isabs(x))
    remember_folder(src, skip)
    files = R.files_in(src, skip=skip)
    saved = load_settings(src)
    with LOCK:
        STATE['gen'] += 1
        STATE.update(src=src, files=files, small={}, info={}, wb={}, settings={}, job=None, skip=skip,
                     processed=[], out={}, scan=dict(i=0, n=len(files), done=not files, name=''))
        STATE['rel'] = {rel_of(f): f for f in files}
        for f in files:
            s = saved.get(rel_of(f)) or {}
            STATE['settings'][f] = dict(zones=s.get('zones', []), adjust=s.get('adjust', {}),
                                        rotate=int(s.get('rotate', 0) or 0),
                                        off=[k for k in (s.get('off') or []) if k in E.AUTO_KEYS],
                                        mode=s.get('mode') if s.get('mode') in ('force', 'skip') else 'auto',
                                        crop=crop_dict(s.get('crop')))
        gen = STATE['gen']
    if files: threading.Thread(target=scan_folder, args=(gen,), daemon=True).start()
    return files


def workers_n():
    return max(1, min(int(STATE.get('workers') or R.default_workers()), 8))


def mapper_for(n):
    """Паралельний map у процесах-помічниках (або звичайний, якщо процес один)."""
    if n <= 1: return map, None
    ex = ProcessPoolExecutor(max_workers=n, initializer=R.init_worker)
    return (lambda fn, args: ex.map(fn, args, chunksize=1)), ex


def key_of(f):
    s = st_of(f)
    wb = STATE['wb'].get(f)
    return (int(s.get('rotate') or 0), tuple(sorted(s.get('off') or ())), None if wb is None else tuple(wb),
            crop_key(s.get('crop')))


def scan_folder(gen):
    """Фоновий аналіз усіх фото папки: статус кожного видно в списку одразу."""
    try:
        with LOCK:
            files = list(STATE['files'])
            sets = {f: dict(st_of(f)) for f in files}
        alive = lambda: STATE['gen'] == gen

        def prog(i, n, p, r):
            if not alive(): return
            with LOCK:
                STATE['scan'].update(i=i, n=n, name=rel_of(p))
                if p not in STATE['info'] or STATE['info'][p].get('key') is None:
                    STATE['info'][p] = dict(r=r, key=(sets[p]['rotate'], tuple(sorted(sets[p]['off'] or ())), None,
                                                      crop_key(sets[p].get('crop'))))
        mp, ex = mapper_for(workers_n())
        try:
            rs, forced = R.scan(files, sets, mp, prog, stop=lambda: not alive())
        finally:
            if ex: ex.shutdown(wait=False)
        if rs is None or not alive(): return
        with LOCK:
            STATE['wb'] = {f: tuple(v) for f, v in (forced or {}).items()}
            for f, r in rs.items():
                s = sets[f]
                STATE['info'][f] = dict(r=r, key=(s['rotate'], tuple(sorted(s['off'] or ())),
                                                  STATE['wb'].get(f), crop_key(s.get('crop'))))
            STATE['scan'].update(done=True, name='')
    except Exception:
        traceback.print_exc()
        if STATE['gen'] == gen: STATE['scan'].update(done=True, error=traceback.format_exc(limit=2))


# ------------------------------------------------------------------ прев'ю
def small_image(f, full=False, side=PREVIEW_MAX):
    """Зменшений кадр для перегляду; full — без кадрування (для вибору рамки);
    side — більша сторона (0 — повний розмір, для збільшення колесом миші)."""
    s = st_of(f)
    crop = None if full else s.get('crop')
    key = (f, s['rotate'], crop_key(crop), side)
    cache = STATE['small']
    if key not in cache:
        arr, _ = IO.load(f, s['rotate'], max_side=side or None, crop=crop)
        if len(cache) >= 4: cache.pop(next(iter(cache)))
        cache[key] = arr
    return cache[key]


def side_of(q):
    try: v = int((q.get('side') or [PREVIEW_MAX])[0])
    except ValueError: v = PREVIEW_MAX
    return v if v in SIDES else PREVIEW_MAX


def analysis(f):
    """Результат аналізу з урахуванням повороту, вимкнених значень і балансу зйомки."""
    key = key_of(f)
    inf = STATE['info'].get(f)
    if inf and inf.get('key') == key: return inf['r']
    s = st_of(f)
    r = E.analyze(small_image(f), off=tuple(s.get('off') or ()), wb=STATE['wb'].get(f), taken=IO.taken_time(f))
    r['mark'] = IO.has_mark(f)
    STATE['info'][f] = dict(r=r, key=key)
    return r


def status_of(f):
    """Що показати в списку: wait — ще аналізується, need — потребує обробки,
    ok — не потребує, done — уже оброблене програмою, err — не вдалося прочитати."""
    inf = STATE['info'].get(f)
    s = st_of(f)
    r = inf['r'] if inf else None
    if r is None: st = 'wait'
    elif 'error' in r: st = 'err'
    elif r.get('mark'): st = 'done'
    else: st = 'need' if r.get('needs') else 'ok'
    return dict(st=st, will=R.wanted(r, s) if r is not None else (s.get('mode') == 'force' or R.manual(s)),
                manual=R.manual(s), mode=s.get('mode') or 'auto', rotate=s.get('rotate') or 0,
                done=f in STATE['processed'])


def jpeg(arr, q=86):
    b = io.BytesIO(); Image.fromarray(arr).save(b, 'JPEG', quality=q); return b.getvalue()


# ------------------------------------------------------------------ пакетна обробка
def batch():
    for v in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS',
              'NUMEXPR_NUM_THREADS', 'VECLIB_MAXIMUM_THREADS'):
        os.environ[v] = '1'        # процеси-помічники не множать потоки
    src = STATE['src']; tmp = os.path.join(src, TMP_DIR); gen = STATE['gen']
    STATE['job'] = dict(stage='scan', done=False, i=0, n=0, name='', errors=[])
    try:
        # спершу дочекатися аналізу всієї папки: від нього залежить, що обробляти
        while not (STATE['scan'] or {}).get('done'):
            if STATE['gen'] != gen: return
            sc = STATE['scan'] or {}
            STATE['job'].update(i=sc.get('i', 0), n=sc.get('n', 0), name=sc.get('name', ''))
            time.sleep(0.4)
        shutil.rmtree(tmp, ignore_errors=True); os.makedirs(tmp, exist_ok=True)
        with LOCK:
            todo = []
            STATE['out'] = {f: o for f, o in STATE['out'].items() if not o.startswith(tmp+os.sep)}
            for f in STATE['files']:
                inf = STATE['info'].get(f); s = st_of(f)
                if not R.wanted(inf['r'] if inf else None, s): continue
                r = inf['r'] if inf and inf.get('key') == key_of(f) and 'error' not in inf['r'] else None
                out = os.path.join(tmp, os.path.relpath(f, src))      # та сама структура підпапок
                os.makedirs(os.path.dirname(out), exist_ok=True)
                todo.append((f, out, r, s.get('zones'), s.get('adjust'),
                             tuple(s.get('off') or ()), s.get('rotate') or 0, STATE['wb'].get(f), s.get('crop')))
        STATE['job'] = dict(stage='process', done=False, i=0, n=len(todo), name='', errors=[],
                            skipped=len(STATE['files'])-len(todo), workers=workers_n())
        STATE['processed'] = []
        mp, ex = mapper_for(min(workers_n(), max(len(todo), 1)))
        try:
            for k, err in enumerate(mp(R.work, todo)):
                STATE['job'].update(i=k+1, name=rel_of(todo[k][0]))
                if err: STATE['job']['errors'].append(err)
                else:
                    STATE['processed'].append(todo[k][0])
                    STATE['out'][todo[k][0]] = todo[k][1]
        finally:
            if ex: ex.shutdown()
        STATE['job'].update(done=True, tmp=tmp)
    except Exception:
        STATE['job'] = dict(stage='process', done=True, error=traceback.format_exc())


def tmp_names(tmp):
    """Оброблені файли в тимчасовій папці: шляхи відносно неї (з підпапками)."""
    out = []
    for root, _, names in os.walk(tmp):
        out += [os.path.relpath(os.path.join(root, n), tmp) for n in names]
    return sorted(out)


def save_results(folder, replace=False, copy_rest=True):
    """Переносить оброблені фото: у папку результату (оригінали не змінюються)
    або замість оригіналів. В окрему папку можна докласти й фото без змін — тоді
    там буде повний набір. Структура підпапок зберігається."""
    src = STATE['src']; tmp = os.path.join(src, TMP_DIR)
    STATE['job'] = dict(stage='save', done=False, i=0, n=0, name='', replace=bool(replace))
    try:
        names = tmp_names(tmp) if os.path.isdir(tmp) else []
        if replace:
            STATE['job']['n'] = len(names)
            for k, nm in enumerate(names):
                f = os.path.join(src, nm)
                os.replace(os.path.join(tmp, nm), f)
                with LOCK:
                    # поправки вже всередині файлу: застосувати їх удруге не можна
                    STATE['settings'][f] = blank()
                    STATE['info'][f] = dict(r=dict(mark=True, needs=False, changes=[]), key=None)
                    STATE['wb'].pop(f, None)
                    STATE['out'][f] = f
                    STATE['small'] = {k2: v for k2, v in STATE['small'].items() if k2[0] != f}
                STATE['job'].update(i=k+1, name=nm)
            save_settings()
            dst = src
        else:
            dst = folder if os.path.isabs(folder) else os.path.join(src, folder)
            os.makedirs(dst, exist_ok=True)
            rest = []
            if copy_rest:
                done = {os.path.normcase(n) for n in names}
                rest = [f for f in STATE['files'] if os.path.normcase(os.path.relpath(f, src)) not in done
                        and not os.path.exists(os.path.join(dst, os.path.relpath(f, src)))]
            STATE['job']['n'] = len(names)+len(rest)
            for k, nm in enumerate(names):
                to = os.path.join(dst, nm)
                os.makedirs(os.path.dirname(to), exist_ok=True)
                shutil.move(os.path.join(tmp, nm), to)
                f = os.path.join(src, nm)
                if f in STATE['settings']: STATE['out'][f] = to
                STATE['job'].update(i=k+1, name=nm)
            for k, f in enumerate(rest):
                to = os.path.join(dst, os.path.relpath(f, src))
                os.makedirs(os.path.dirname(to), exist_ok=True)
                shutil.copy2(f, to)     # точна копія, без перестиснення
                STATE['job'].update(i=len(names)+k+1, name=rel_of(f))
        shutil.rmtree(tmp, ignore_errors=True)
        STATE['processed'] = []
        STATE['job'].update(done=True, dst=dst, saved=len(names))
    except Exception:
        STATE['job'] = dict(stage='save', done=True, error=traceback.format_exc())


# ------------------------------------------------------------------ Photoshop
def find_photoshop():
    """Шлях до Photoshop: збережений користувачем, з реєстру Windows або зі стандартних папок."""
    saved = recent().get('photoshop')
    if saved and os.path.exists(saved): return saved
    found = []
    if os.name == 'nt':
        try:
            import winreg
            for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
                try:
                    with winreg.OpenKey(hive, r'Software\Microsoft\Windows\CurrentVersion\App Paths\Photoshop.exe') as k:
                        found.append(winreg.QueryValue(k, None))
                except OSError: pass
            try:
                with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r'SOFTWARE\Adobe\Photoshop') as k:
                    for i in range(winreg.QueryInfoKey(k)[0]):
                        try:
                            with winreg.OpenKey(k, winreg.EnumKey(k, i)) as v:
                                found.append(os.path.join(winreg.QueryValueEx(v, 'ApplicationPath')[0], 'Photoshop.exe'))
                        except OSError: pass
            except OSError: pass
        except Exception:
            pass
        for base in {os.environ.get('ProgramFiles', r'C:\Program Files'), os.environ.get('ProgramW6432', r'C:\Program Files'),
                     os.environ.get('ProgramFiles(x86)', r'C:\Program Files (x86)')}:
            found += sorted(glob.glob(os.path.join(base, 'Adobe', 'Adobe Photoshop*', 'Photoshop.exe')), reverse=True)
    elif sys.platform == 'darwin':
        found += sorted(glob.glob('/Applications/Adobe Photoshop*/Adobe Photoshop*.app'), reverse=True)
    found = [f.strip('"') for f in found if f]
    ok = [f for f in found if os.path.exists(f)]
    # найновіша версія: «Adobe Photoshop 2025» новіша за «2024» і за «CC 2019»
    ok.sort(key=lambda f: R._natural(f), reverse=True)
    return ok[0] if ok else None


def open_in_photoshop(paths, exe=None):
    """Відкриває фото в Photoshop (якщо він уже відкритий — у ньому ж)."""
    exe = exe or find_photoshop()
    if not exe: return None
    for i in range(0, len(paths), 20):        # частинами: довжина команди в Windows обмежена
        part = paths[i:i+20]
        if sys.platform == 'darwin':
            subprocess.Popen(['open', '-a', exe] + part)
        else:
            flags = getattr(subprocess, 'DETACHED_PROCESS', 0) | getattr(subprocess, 'CREATE_NEW_PROCESS_GROUP', 0)
            subprocess.Popen([exe] + part, close_fds=True, creationflags=flags if os.name == 'nt' else 0)
        if i+20 < len(paths): time.sleep(1.5)
    return exe


def photoshop_file(f):
    """Що відкривати: оброблене фото, якщо воно вже є, інакше оригінал."""
    o = STATE['out'].get(f)
    return (o, True) if o and os.path.exists(o) else (f, False)


# ------------------------------------------------------------------ сервер
class H(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, *a): pass

    def _send(self, code, body, ctype='application/json; charset=utf-8', extra=None):
        self.send_response(code); self.send_header('Content-Type', ctype)
        if self.path.startswith('/api/ping'):
            # єдина відповідь, доступна іншим сайтам: лише факт, що програма запущена.
            # Решта адрес лишаються без CORS, тому сторонній сайт не дістанеться до фото.
            self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        for k, v in (extra or {}).items(): self.send_header(k, v)
        self.end_headers(); self.wfile.write(body)

    def _json(self, obj, code=200):
        self._send(code, json.dumps(obj, ensure_ascii=False).encode('utf-8'))

    def _pack(self):
        with LOCK:
            return dict(src=STATE['src'], files=[rel_of(f) for f in STATE['files']],
                        settings={rel_of(f): STATE['settings'][f] for f in STATE['files']},
                        status={rel_of(f): status_of(f) for f in STATE['files']},
                        scan=STATE['scan'], cores=os.cpu_count() or 2, workers=workers_n(),
                        tmp=bool(STATE['processed']), skip=list(STATE['skip']))

    def _file(self, q):
        return STATE['rel'].get((q.get('file') or [''])[0])

    def do_GET(self):
        u = urlparse(self.path); q = parse_qs(u.query)
        try:
            if u.path in ('/', '/index.html'):
                return self._send(200, open(os.path.join(HERE, 'ui.html'), 'rb').read(),
                                  'text/html; charset=utf-8')
            if u.path == '/api/ping':
                return self._json(dict(app='azart-photo', version=PING_VERSION))
            if u.path == '/api/state': return self._json(self._pack())
            if u.path == '/api/open':
                p = q.get('path', [''])[0].strip().strip('"')
                if not os.path.isdir(p): return self._json(dict(error='Папку не знайдено: '+p), 400)
                open_folder(p, q.get('skip', [None])[0]); return self._json(self._pack())
            if u.path in ('/api/before', '/api/after'):
                f = self._file(q)
                if not f: return self._json(dict(error='немає файлу'), 404)
                side = side_of(q)
                # поки чекали на обробку попереднього, вікно могло вже попросити новіший кадр:
                # тоді цей не рахуємо (інакше при русі повзунка на великому масштабі набирається черга)
                sid, tok = q.get('sid', [''])[0][:40], int(q.get('tok', ['0'])[0] or 0)
                if u.path == '/api/after' and sid:
                    WANT[sid] = max(WANT.get(sid, 0), tok)
                with LOCK:
                    if u.path == '/api/after' and sid and tok < WANT.get(sid, 0):
                        return self._send(204, b'', 'text/plain')
                    s = st_of(f)
                    if u.path == '/api/before':
                        full = q.get('full', [''])[0] == '1'
                        try: W, H = IO.full_size(f, s['rotate'], None if full else s.get('crop'))
                        except Exception: W = H = 0
                        return self._send(200, jpeg(small_image(f, full=full, side=side), 90 if side != PREVIEW_MAX else 86),
                                          'image/jpeg', {'X-Size': '%d,%d' % (W, H)})
                    base = analysis(f)
                    r = E.with_adjust(base, s.get('adjust'), s.get('off'))
                    body = jpeg(E.render(small_image(f, side=side), r, zones=s.get('zones')),
                                90 if side != PREVIEW_MAX else 86)
                    info = dict(values={k: r.get(k) for k in INFO_KEYS},
                                auto={k: base.get(k) for k in E.AUTO_KEYS},
                                changes=base.get('changes') or [], off=list(s.get('off') or []),
                                needs=bool(base.get('needs')), status=status_of(f),
                                series=base.get('wb_src') == 'зйомка', error=base.get('error'))
                return self._send(200, body, 'image/jpeg',
                                  {'X-Info': json.dumps(info), 'X-Token': q.get('tok', [''])[0]})
            if u.path == '/api/progress':
                return self._json(STATE['job'] or dict(done=True, stage='none'))
            if u.path == '/api/photoshop':
                return self._json(dict(exe=find_photoshop()))
        except Exception:
            return self._json(dict(error=traceback.format_exc()), 500)
        self._send(404, b'not found', 'text/plain')

    def do_POST(self):
        u = urlparse(self.path)
        data = json.loads(self.rfile.read(int(self.headers.get('Content-Length') or 0)) or b'{}')
        try:
            if u.path == '/api/settings':
                f = STATE['rel'].get(data.get('file') or '')
                if not f: return self._json(dict(error='немає файлу'), 404)
                with LOCK:
                    s = st_of(f)
                    for k in ('zones', 'adjust', 'rotate'):
                        if k in data: s[k] = data[k]
                    if 'crop' in data: s['crop'] = crop_dict(data['crop'])
                    if 'off' in data: s['off'] = [k for k in data['off'] if k in E.AUTO_KEYS]
                    if data.get('mode') in ('auto', 'force', 'skip'): s['mode'] = data['mode']
                save_settings(); return self._json(dict(ok=True, status=status_of(f)))
            if u.path == '/api/apply_all':
                with LOCK:
                    s = st_of(STATE['rel'][data['from']])
                    to = [STATE['rel'][x] for x in data.get('to') or () if x in STATE['rel']] or STATE['files']
                    for f in to:
                        st_of(f)['adjust'] = dict(s.get('adjust', {}))
                        st_of(f)['off'] = list(s.get('off') or [])
                save_settings(); return self._json(self._pack())
            if u.path == '/api/mode':
                with LOCK:
                    if data.get('mode') in ('auto', 'force', 'skip'):
                        for x in data.get('files') or ():
                            if x in STATE['rel']: st_of(STATE['rel'][x])['mode'] = data['mode']
                save_settings(); return self._json(self._pack())
            if u.path == '/api/photoshop':
                exe = (data.get('exe') or '').strip().strip('"') or None
                if exe:
                    if os.path.isdir(exe):
                        c = glob.glob(os.path.join(exe, 'Photoshop.exe')) + glob.glob(os.path.join(exe, '*.app'))
                        exe = c[0] if c else exe
                    if not os.path.exists(exe): return self._json(dict(error='Файл не знайдено: '+exe), 400)
                    remember(photoshop=exe)
                files = [STATE['rel'][x] for x in data.get('files') or () if x in STATE['rel']]
                if not files: return self._json(dict(error='Не вибрано фото'), 400)
                with LOCK: picked = [photoshop_file(f) for f in files]
                used = open_in_photoshop([p for p, _ in picked], exe)
                if not used: return self._json(dict(error='not_found'))
                return self._json(dict(ok=True, exe=used, n=len(picked), processed=sum(1 for _, d in picked if d)))
            if u.path == '/api/process':
                if (STATE['job'] or {}).get('done') is False:
                    return self._json(dict(error='Обробка вже йде'), 409)
                if data.get('workers'): STATE['workers'] = int(data['workers'])
                threading.Thread(target=batch, daemon=True).start()
                return self._json(dict(ok=True))
            if u.path == '/api/save':
                if (STATE['job'] or {}).get('done') is False:
                    return self._json(dict(error='Зачекайте, поки завершиться обробка'), 409)
                threading.Thread(target=save_results, args=(data.get('folder') or 'оброблені',
                                 bool(data.get('replace')), data.get('copy_rest', True) is not False),
                                 daemon=True).start()
                return self._json(dict(ok=True))
        except Exception:
            return self._json(dict(error=traceback.format_exc()), 500)
        self._send(404, b'not found', 'text/plain')


# ------------------------------------------------------------------ запуск із сайту
PROTOCOL = 'azart'
RECENT = os.path.join(os.path.expanduser('~'), '.azart-photo.json')


def recent():
    try: return json.load(open(RECENT, encoding='utf-8')) or {}
    except Exception: return {}


def remember(**kw):
    d = recent(); d.update(kw)
    try: json.dump(d, open(RECENT, 'w', encoding='utf-8'), ensure_ascii=False)
    except Exception: pass


def remember_folder(src, skip=()):
    remember(last=src, skip=list(skip))


def last_skip():
    return tuple(recent().get('skip') or ('оброблені',))


def last_folder():
    d = recent().get('last')
    return d if d and os.path.isdir(d) else None


def register_protocol():
    """Дозволяє сторінці адміністратора запускати програму посиланням azart://.
    Запис іде лише в розділ поточного користувача, права адміністратора не потрібні.
    Виконується при кожному запуску, тому переміщення папки нічого не ламає."""
    if os.name != 'nt' or not getattr(sys, 'frozen', False): return False
    try:
        import winreg
        cmd = '"%s" "%%1"' % sys.executable
        base = 'Software\\Classes\\' + PROTOCOL
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, base) as k:
            winreg.SetValueEx(k, None, 0, winreg.REG_SZ, 'URL:AZART Photo')
            winreg.SetValueEx(k, 'URL Protocol', 0, winreg.REG_SZ, '')
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, base + '\\shell\\open\\command') as k:
            winreg.SetValueEx(k, None, 0, winreg.REG_SZ, cmd)
        return True
    except Exception:
        return False


def main():
    arg = sys.argv[1] if len(sys.argv) > 1 else ''
    from_site = arg.lower().startswith(PROTOCOL + ':')   # запуск кнопкою на сайті
    port = int(os.environ.get('AZART_PORT', '8765'))
    url = 'http://127.0.0.1:%d/' % port
    R.lower_priority()
    register_protocol()

    try:
        srv = ThreadingHTTPServer(('127.0.0.1', port), H)
    except OSError:
        # порт зайнятий — програма вже працює; просто показуємо її вікно
        print('AZART вже запущено:', url)
        if not from_site: webbrowser.open(url)
        return

    src = '' if from_site else arg
    if not src: src = last_folder() or ('' if from_site else os.getcwd())
    if src and os.path.isdir(src): open_folder(src)

    print('AZART — обробка фото. Відкрийте в браузері:', url)
    # коли запуск іде з сайту, вкладку відкриває сам сайт — інакше їх було б дві
    if not from_site and not os.environ.get('AZART_NOBROWSER'):
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    try: srv.serve_forever()
    except KeyboardInterrupt: pass


if __name__ == '__main__':
    import multiprocessing
    multiprocessing.freeze_support()
    main()
