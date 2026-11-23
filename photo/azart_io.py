"""Читання і запис фото (файл навмисно не названо imageio — так зветься відома бібліотека): враховується орієнтація з EXIF та ручний поворот,
зберігаються колірний профіль і решта EXIF."""
import math
import numpy as np, cv2
from PIL import Image, ImageOps

ORIENT = 274


def crop_box(crop):
    """Кадрування або None, якщо кадр цілий: (x, y, w, h, a).
    x, y, w, h — частки кадру після повороту (рамка до нахилу), a — нахил рамки
    в градусах за годинниковою стрілкою навколо її центру (вирівнювання горизонту)."""
    if not crop: return None
    try:
        x, y, w, h = (float(crop[k]) for k in ('x', 'y', 'w', 'h'))
        a = float(crop.get('a') or 0.0)
    except (KeyError, TypeError, ValueError, AttributeError):
        return None
    if not all(map(math.isfinite, (x, y, w, h, a))): return None
    a = max(-45.0, min(45.0, a))
    if abs(a) < 0.01:
        a = 0.0
        x, y = min(max(x, 0.0), 0.95), min(max(y, 0.0), 0.95)
        w, h = min(max(w, 0.05), 1.0-x), min(max(h, 0.05), 1.0-y)
        if w >= 0.999 and h >= 0.999: return None
    else:
        # нахилена рамка: центр у межах кадру, розмір — розумний
        w, h = min(max(w, 0.05), 1.5), min(max(h, 0.05), 1.5)
        cx, cy = min(max(x+w/2, 0.0), 1.0), min(max(y+h/2, 0.0), 1.0)
        x, y = cx-w/2, cy-h/2
    return x, y, w, h, a


def apply_crop(arr, c):
    """Вирізає рамку c = (x, y, w, h, a) з масиву; нахилена рамка вирівнюється."""
    H, W = arr.shape[:2]
    x, y, w, h, a = c
    if not a:
        x0, y0 = int(round(x*W)), int(round(y*H))
        x1, y1 = max(int(round((x+w)*W)), x0+1), max(int(round((y+h)*H)), y0+1)
        return arr[y0:min(y1, H), x0:min(x1, W)]
    cx, cy, bw, bh = (x+w/2)*W, (y+h/2)*H, w*W, h*H
    ow, oh = max(int(round(bw)), 1), max(int(round(bh)), 1)
    t = math.radians(a); cs, sn = math.cos(t), math.sin(t)
    # піксель результату (u, v) береться з точки центр + R(a)·(u - ow/2, v - oh/2)
    M = np.array([[cs, -sn, cx-cs*ow/2+sn*oh/2],
                  [sn, cs, cy-sn*ow/2-cs*oh/2]], np.float64)
    return cv2.warpAffine(np.ascontiguousarray(arr), M, (ow, oh),
                          flags=cv2.INTER_CUBIC | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REPLICATE)


def _fit(im, side):
    if side and max(im.size) > side:
        s = side/max(im.size)
        im = im.resize((max(int(im.width*s), 1), max(int(im.height*s), 1)), Image.LANCZOS)
    return im


def load(path, rotate=0, max_side=None, crop=None):
    """Повертає (масив RGB, дані для запису). Орієнтація вже застосована,
    далі — ручний поворот і кадрування."""
    c = crop_box(crop)
    side = int(max_side/max(c[2], c[3])) if (max_side and c) else max_side
    im = Image.open(path)
    if side:
        im.draft('RGB', (side*2, side*2))
    # спершу розвертаємо пікселі за міткою EXIF: Pillow сам прибирає мітку
    im = ImageOps.exif_transpose(im)
    meta = dict(icc=im.info.get('icc_profile'), exif=im.info.get('exif'))
    im = _fit(im.convert('RGB'), side)
    if rotate % 360:
        im = im.rotate(-(rotate % 360), expand=True)
    if c:
        im = _fit(Image.fromarray(apply_crop(np.asarray(im), c)), max_side)
    return np.asarray(im), meta


def full_size(path, rotate=0, crop=None):
    """Розмір кадру в пікселях оригіналу (після орієнтації, повороту й кадрування)."""
    with Image.open(path) as im:
        W, H = im.size
        try: o = im.getexif().get(ORIENT, 1)
        except Exception: o = 1
    if o in (5, 6, 7, 8): W, H = H, W
    if (rotate or 0) % 180: W, H = H, W
    c = crop_box(crop)
    if c: W, H = max(int(round(c[2]*W)), 1), max(int(round(c[3]*H)), 1)
    return W, H


MARK = b'AZART auto 2'


def save(arr, path, meta=None, quality=95, mark=True):
    """Записує JPEG з тим самим колірним профілем і EXIF. Позначка в коментарі файлу
    каже програмі при наступному відкритті папки, що фото вже оброблене."""
    kw = dict(quality=quality, subsampling=0)
    if meta:
        if meta.get('icc'): kw['icc_profile'] = meta['icc']
        if meta.get('exif'): kw['exif'] = meta['exif']
    if mark: kw['comment'] = MARK
    Image.fromarray(arr).save(path, 'JPEG', **kw)


def has_mark(path):
    """Чи це фото вже оброблене програмою AZART."""
    try:
        with Image.open(path) as im:
            c = im.info.get('comment') or b''
        return (c if isinstance(c, bytes) else str(c).encode('utf-8', 'ignore')).startswith(b'AZART auto')
    except Exception:
        return False


def taken_time(path):
    """Час зйомки з EXIF (секунди) або None. Потрібен, щоб відрізнити зйомки в одній папці."""
    import time
    try:
        with Image.open(path) as im:
            ex = im.getexif()
            v = ex.get_ifd(0x8769).get(36867) or ex.get(306)
        if not v: return None
        return time.mktime(time.strptime(str(v).strip()[:19], '%Y:%m:%d %H:%M:%S'))
    except Exception:
        return None
