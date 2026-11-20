"""Читання і запис фото (файл навмисно не названо imageio — так зветься відома бібліотека): враховується орієнтація з EXIF та ручний поворот,
зберігаються колірний профіль і решта EXIF."""
import numpy as np
from PIL import Image, ImageOps

ORIENT = 274


def load(path, rotate=0, max_side=None):
    """Повертає (масив RGB, дані для запису). Орієнтація вже застосована."""
    im = Image.open(path)
    if max_side:
        im.draft('RGB', (max_side*2, max_side*2))
    # спершу розвертаємо пікселі за міткою EXIF: Pillow сам прибирає мітку
    im = ImageOps.exif_transpose(im)
    meta = dict(icc=im.info.get('icc_profile'), exif=im.info.get('exif'))
    im = im.convert('RGB')
    if max_side and max(im.size) > max_side:
        s = max_side/max(im.size)
        im = im.resize((max(int(im.width*s), 1), max(int(im.height*s), 1)), Image.LANCZOS)
    if rotate % 360:
        im = im.rotate(-(rotate % 360), expand=True)
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
