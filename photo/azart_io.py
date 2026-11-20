"""Читання і запис фото (файл навмисно не названо imageio — так зветься відома бібліотека): враховується орієнтація з EXIF та ручний поворот,
зберігаються колірний профіль і решта EXIF."""
import numpy as np
from PIL import Image, ImageOps

ORIENT = 274


def crop_box(crop):
    """Кадрування (частки кадру після повороту) або None, якщо кадр цілий."""
    if not crop: return None
    try:
        x, y, w, h = (float(crop[k]) for k in ('x', 'y', 'w', 'h'))
    except (KeyError, TypeError, ValueError):
        return None
    x, y = min(max(x, 0.0), 0.95), min(max(y, 0.0), 0.95)
    w, h = min(max(w, 0.05), 1.0-x), min(max(h, 0.05), 1.0-y)
    if w >= 0.999 and h >= 0.999: return None
    return x, y, w, h


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
        W, H = im.size
        x0, y0 = int(round(c[0]*W)), int(round(c[1]*H))
        x1, y1 = max(int(round((c[0]+c[2])*W)), x0+1), max(int(round((c[1]+c[3])*H)), y0+1)
        im = _fit(im.crop((x0, y0, min(x1, W), min(y1, H))), max_side)
    return np.asarray(im), meta


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
