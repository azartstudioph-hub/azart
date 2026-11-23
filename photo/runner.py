"""Обробка цілої папки.

1. Аналіз кожного фото: що йому потрібно (рівні, баланс білого, білий одяг тощо)
   і чи потрібно взагалі. Фото, яким нічого не потрібно, не обробляються.
2. Зйомки: фото однієї зйомки освітлені однаково, тому баланс білого для кадрів
   без білих речей береться від сусідніх кадрів, де білі речі є. Межі зйомок
   визначаються за різкою зміною освітлення або перервою в часі зйомки.
3. Обробка лише потрібних фото.

Фото шукаються і в підпапках: у результаті зберігається та сама структура папок.

Функції, які виконують процеси-помічники, мають бути саме тут, у звичайному модулі:
інакше вони не працюють у зібраному .exe."""
import os, sys, shutil
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, cv2
import enhance as E, azart_io as IO

EXT = ('.jpg', '.jpeg')
SCAN_SIDE = 1400


TMP_DIR = '__azart_tmp'


def _natural(s):
    """Ключ для сортування як у Провіднику: «IMG_2» раніше за «IMG_10»."""
    import re
    return [int(t) if t.isdigit() else t.lower().translate(_UA) for t in re.split(r'(\d+)', s)]


# українські літери на свої місця в абетці (ґ після г, є після е, і та ї після и)
_UA = str.maketrans({'ґ': 'г\uffff', 'є': 'е\uffff', 'і': 'и\uffff', 'ї': 'и\uffff\uffff'})


def files_in(src, skip=(), deep=True):
    """Фото папки разом із підпапками (наприклад, папки замовників усередині групи).
    skip — назви папок першого рівня, які не беремо (папка результату).
    Порядок: спершу фото самої папки, далі підпапки за назвою."""
    skip = {str(x).strip().lower() for x in skip if x}
    out = []
    for root, dirs, names in os.walk(src):
        top = os.path.normcase(os.path.abspath(root)) == os.path.normcase(os.path.abspath(src))
        dirs[:] = sorted((d for d in dirs if not d.startswith('.') and d != TMP_DIR and d.lower() != '$recycle.bin'
                          and not (top and d.strip().lower() in skip)), key=_natural)
        out += [os.path.join(root, n) for n in sorted(names, key=_natural)
                if n.lower().endswith(EXT) and not n.startswith('._')]
        if not deep: break
    rel = lambda f: os.path.relpath(f, src)
    return sorted(out, key=lambda f: (_natural(os.path.dirname(rel(f))), _natural(os.path.basename(f))))


# ------------------------------------------------------------------ аналіз
def scan_one(a):
    """Аналіз одного фото. a = (шлях, поворот, вимкнені значення, баланс зйомки або None, кадрування)."""
    path, rotate, off, wb = a[:4]
    crop = a[4] if len(a) > 4 else None
    try:
        rgb, _ = IO.load(path, rotate, max_side=SCAN_SIDE, crop=crop)
        r = E.analyze(rgb, off=off, wb=wb, taken=IO.taken_time(path))
        r['mark'] = IO.has_mark(path)
        return r
    except Exception:
        import traceback
        return dict(error=traceback.format_exc(limit=2), mark=False, needs=False, changes=[])


def scan_args(path, st, wb=None):
    st = st or {}
    return (path, int(st.get('rotate', 0) or 0), tuple(st.get('off') or ()), wb, st.get('crop'))


def series(paths, rs):
    """Баланс білого по зйомках: {шлях: (temp, tint)} для фото, яким його треба взяти від серії.
    Уже оброблені програмою фото в розрахунку не беруть участі."""
    idx = [i for i, r in enumerate(rs) if r and 'error' not in r and not r.get('mark')]
    forced = E.series_wb([rs[i] for i in idx])
    return {paths[idx[k]]: wb for k, wb in forced.items()}


def scan(paths, settings=None, mapper=map, progress=None, stop=None):
    """Аналіз усіх фото і балансу по зйомках.
    Повертає ({шлях: результат analyze}, {шлях: баланс зйомки})."""
    settings = settings or {}
    rs = []
    for k, r in enumerate(mapper(scan_one, [scan_args(p, settings.get(p)) for p in paths])):
        rs.append(r)
        if progress: progress(k+1, len(paths), paths[k], r)
        if stop and stop(): return None, None
    out = dict(zip(paths, rs))
    forced = series(paths, rs)
    if forced:
        todo = [p for p in paths if p in forced]
        for p, r in zip(todo, mapper(scan_one, [scan_args(p, settings.get(p), forced[p]) for p in todo])):
            if 'error' not in r: out[p] = r
    return out, forced


# ------------------------------------------------------------------ обробка
def process_one(path, dst, r=None, zones=None, adjust=None, off=(), rotate=0, wb=None, crop=None):
    rgb, meta = IO.load(path, rotate, crop=crop)
    if r is None:
        r = E.analyze(rgb, off=off, wb=wb, taken=IO.taken_time(path))
    r = E.with_adjust(r, adjust, off)
    out = E.render(rgb, r, E.P, zones)
    if dst: IO.save(out, dst, meta)
    return r


def work(a):
    """Одне фото для паралельної обробки:
    (шлях, куди, аналіз, зони, поправки, вимкнені, поворот, баланс, кадрування)."""
    path, dst, r, zones, adjust, off, rotate, wb = a[:8]
    crop = a[8] if len(a) > 8 else None
    try:
        process_one(path, dst, r, zones, adjust, off, rotate, wb, crop)
        return None
    except Exception:
        import traceback
        return '%s: %s' % (os.path.basename(path), traceback.format_exc(limit=1))


def manual(st):
    """Чи має фото ручні поправки, зони чи кадрування."""
    st = st or {}
    return (bool(st.get('zones')) or IO.crop_box(st.get('crop')) is not None
            or any(abs(float(v)) > 1e-9 for v in (st.get('adjust') or {}).values()))


def wanted(r, st):
    """Чи обробляти фото: вибір користувача, ручні поправки, інакше — висновок аналізу."""
    st = st or {}
    mode = st.get('mode') or 'auto'
    if mode == 'skip': return False
    if mode == 'force' or manual(st): return True
    if not r or r.get('mark') or 'error' in r: return False
    return bool(r.get('needs'))


def run(src, dst, log=print):
    """Обробка папки без вікна: python runner.py папка папка_результату.
    Оброблені фото — в dst; фото, яким обробка не потрібна, копіюються туди без змін."""
    inside = os.path.normcase(os.path.abspath(dst)).startswith(os.path.normcase(os.path.abspath(src))+os.sep)
    skip = ('оброблені',)+((os.path.basename(os.path.normpath(dst)),) if inside else ())   # папки результатів
    files = files_in(src, skip=skip)
    log('Фото в папці й підпапках: %d' % len(files))
    rs, _ = scan(files, progress=lambda i, n, p, r: log('  аналіз %d/%d %s' % (i, n, os.path.relpath(p, src))))
    for f in files:
        r = rs[f]; name = os.path.relpath(f, src); out = os.path.join(dst, name)
        os.makedirs(os.path.dirname(out), exist_ok=True)
        if wanted(r, None):
            process_one(f, out, r)
            log('  %-24s оброблено: %s' % (name, ', '.join(r.get('changes') or [])))
        else:
            shutil.copy2(f, out)
            log('  %-24s без змін' % name)
    return rs


# ------------------------------------------------------------------ процеси
def lower_priority():
    """Нижчий пріоритет: комп'ютер лишається чутливим, поки йде обробка."""
    try:
        if os.name == 'nt':
            import ctypes
            k = ctypes.windll.kernel32
            k.SetPriorityClass(k.GetCurrentProcess(), 0x00004000)   # BELOW_NORMAL
        else:
            os.nice(10)
    except Exception:
        pass


def init_worker():
    """Кожен процес працює в один потік: інакше процеси б'ються за ядра
    і ноутбук підвисає, хоча роботи виконується не більше."""
    try: cv2.setNumThreads(1)
    except Exception: pass
    lower_priority()


def default_workers():
    n = os.cpu_count() or 2
    return max(1, min(n-1, 4))      # одне ядро лишаємо системі


if __name__ == '__main__':
    a = sys.argv[1:]
    run(a[0], a[1])
