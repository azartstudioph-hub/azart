"""Автообробка фото так, як її робить фотограф.

1. Рівні: біла точка там, де закінчується гістограма (до межі пересвіту),
   чорна точка трохи всередину від її початку. Це головний інструмент.
2. Експозиція — коли обличчя головних людей після рівнів лишаються темними:
   кадр світлішає, а найсвітліші місця м'яко притримуються (без різкого пересвіту).
3. Баланс білого — лише коли білий одяг і шкіра разом показують, що світло
   зсунуте (зелене, жовте, синє, пурпурне). Природний колір не чіпається,
   і поправка ніколи не виводить шкіру з природних меж.
4. Зони, що обробляються окремо:
   * білий одяг на людях (людей відокремлює від фону модель PP-HumanSeg) —
     з нього прибирається чужий відтінок (рожеві відблиски, зелений наліт),
     а якщо після рівнів він вигорає — його світлі місця притримуються;
     маска розтушована і не виходить на фон; візерунок і вишивка не чіпаються;
   * світлі ділянки облич — не впливають на рівні і не пересвічуються;
   * нерівне світло — якщо одна частина кадру помітно темніша за іншу
     (обличчя з одного боку темніші), темніший бік плавно піднімаємо.
5. Фото, якому нічого з цього не потрібно, лишається без змін.
6. Сильний відтінок прибирається не повністю, а як у фотографа — тепло лишається.

Будь-яке автоматичне значення можна вимкнути для окремого фото (список off).
"""
import os, sys
import numpy as np, cv2


def res_dir():
    """Папка з ресурсами: поряд зі скриптом або всередині зібраного .exe."""
    return getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(__file__)))


HERE = res_dir()
YUNET = os.path.join(HERE, 'models', 'yunet2.onnx')
HUMSEG = os.path.join(HERE, 'models', 'pphumanseg.onnx')
LUMW = np.array([0.2126, 0.7152, 0.0722], np.float32)    # лінійна яскравість
LUMA8 = np.array([0.30, 0.59, 0.11], np.float32)         # «яскравість» гістограми Photoshop
VERSION = 2

P = dict(
    # --- рівні (у звичних одиницях 0..255) ---
    white_pct=99.9,      # кінець гістограми: 0,1 % найсвітліших пікселів — відблиски
    white_margin=3.0,    # біла точка трохи правіше від кінця гістограми
    white_gain_min=1.05,   # менше розтягування не варте обробки
    white_floor=150.0,   # не розтягувати більш ніж у 1,7 раза
    black_pct=0.1, black_k=0.62, black_min=6.0, black_cap=12.0,
    # --- обличчя: світлота шкіри L* ---
    face_lift=68.0, face_lift_to=70.0,  # найсвітліше з головних облич темніше — додаємо експозицію
    ev_cap=0.5, main_face=0.6,       # не більше +0.5 EV; головні обличчя — не менші за 0.6 від найбільшого
    face_hi=81.0,                    # світліші біла точка не робить
    # --- баланс білого: зсуви в одиницях a*, b* ---
    w_target=(0.5, 1.0),             # природний білий: ледь теплий
    w_box=((-2.0, 4.0), (-6.5, 4.0)),  # у цих межах білий виглядає білим
    s_target=(14.0, 19.0),           # природна шкіра
    s_box=((8.0, 21.0), (13.0, 25.0)), s_tol=2.5,
    wb_soft=1.5, wb_reg=0.3, wb_dead=2.0, wb_cap=14.0, wb_steps=8, wb_min=2.0, s_w_in=0.15, s_w_out=0.4,
    w_frac0=0.02, w_frac=0.03, donor_w=0.5, inherit_max=0.2, series_dead=0.03,
    # --- білий одяг ---
    wh_L=50.0, wh_C=13.0, wh_seedL=82.0, wh_seedC=9.0, wh_min=0.002, wh_px_shift=2.5,
    wh_box=((-1.0, 1.5), (-3.5, 3.5)), wh_accept=((-3.5, 4.5), (-9.0, 6.0)), wh_comp_C=9.5,
    wh_a_dead=0.6, wh_a_k=0.95, wh_b_dead=3.0, wh_b_k=0.5,
    wh_gate_C=(12.0, 20.0), wh_gate_e=(10.0, 16.0), wh_print=(0.04, 0.12), wh_area=0.01, wh_p90=1.8,
    wh_feather=0.006, mask_side=640, person_thr=0.5, wh_down=5.0,
    wh_hot=10.0, wh_knee=0.72,       # білий одяг вигорає на ≥10 % — притримуємо світлі місця
    # --- світлі ділянки облич ---
    guard_on=0.94, guard_frac=3.0, guard_knee=0.88,
    # --- нерівне світло між обличчями ---
    light_min=9.0, light_min2=14.0, light_k=0.7, light_cap=0.6, light_r2=0.6,
    # --- технічне ---
    map_scale=0.25, tile_rows=384, analysis_side=1400,
    # --- ручні локальні тіні / світла (лише з повзунків) ---
    sh_band=(0.15, 0.26, 0.42, 0.62), hl_band=(0.62, 0.95),
)

# назви автоматичних значень, які можна вимкнути
AUTO_KEYS = ('white', 'black', 'ev', 'gamma', 'temp', 'tint', 'whites', 'whites_hi', 'guard', 'light')
# без чого фото вважається «не потребує обробки»: сама лише чорна точка — не привід
MAJOR = ('white', 'ev', 'gamma', 'temp', 'tint', 'whites', 'whites_hi', 'guard', 'light')

# ------------------------------------------------------------------ базові функції
def s2l(x): return np.where(x <= 0.04045, x/12.92, ((x+0.055)/1.055)**2.4).astype(np.float32)


_S2L = s2l(np.arange(256, dtype=np.float32)/255.0)       # таблиця: uint8 -> лінійне


def s2l8(img8):
    return _S2L[img8]


def l2s(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, x*12.92, 1.055*np.power(x, 1/2.4)-0.055).astype(np.float32)


def chmax(a): return np.maximum(np.maximum(a[..., 0], a[..., 1]), a[..., 2])


def chmin(a): return np.minimum(np.minimum(a[..., 0], a[..., 1]), a[..., 2])


def luma(lin): return lin @ LUMW


def ss(x, a, b):
    """Плавний перехід від 0 до 1 між a і b."""
    t = np.subtract(x, a, dtype=np.float32); t *= 1.0/(b-a+1e-9)
    np.clip(t, 0.0, 1.0, out=t)
    u = np.multiply(t, -2.0); u += 3.0; u *= t; u *= t
    return u


def _box(im, r): return cv2.boxFilter(im, -1, (2*r+1, 2*r+1), borderType=cv2.BORDER_REFLECT)


def guided(I, r, eps):
    mI = _box(I, r); var = np.maximum(_box(I*I, r)-mI*mI, 0)
    a = var/(var+eps); b = mI*(1-a)
    return _box(a, r)*I+_box(b, r)


def lightness(lin):
    """Світлота L* (0..100) лінійного кольору."""
    y = float(np.clip(np.asarray(lin, np.float64) @ LUMW, 0, 1))
    f = y**(1/3) if y > 0.008856 else 7.787*y+16/116
    return 116*f-16


def lab8(rgb8):
    """L* 0..100, a*, b* з 8-бітного sRGB."""
    l = cv2.cvtColor(np.ascontiguousarray(rgb8), cv2.COLOR_RGB2Lab).astype(np.float32)
    l[..., 0] *= 100/255; l[..., 1:] -= 128
    return l


def labf(srgb):
    """Те саме для sRGB 0..1 (float32)."""
    return cv2.cvtColor(np.ascontiguousarray(srgb, np.float32), cv2.COLOR_RGB2Lab)


def lab2srgb(lab):
    return np.clip(cv2.cvtColor(np.ascontiguousarray(lab, np.float32), cv2.COLOR_Lab2RGB), 0, 1)


# ------------------------------------------------------------------ обличчя і шкіра
_YUNET_BYTES = None
_EMPTY = np.zeros(0, np.uint8)


def _yunet_bytes():
    """Модель облич передаємо в OpenCV готовими байтами, а не шляхом до файлу.
    OpenCV на Windows не відкриває файли, у шляху до яких є кирилиця
    (наприклад C:\\Users\\Тимурчик\\...), а Python читає їх без проблем."""
    global _YUNET_BYTES
    if _YUNET_BYTES is None:
        with open(YUNET, 'rb') as fh:
            _YUNET_BYTES = np.frombuffer(fh.read(), np.uint8)
    return _YUNET_BYTES


def detect_faces(rgb8, long_side=1400, thr=0.70, min_px=22):
    h, w = rgb8.shape[:2]; s = min(1.0, long_side/max(h, w))
    sm = rgb8 if s >= 1.0 else cv2.resize(rgb8, (max(int(w*s), 1), max(int(h*s), 1)), interpolation=cv2.INTER_AREA)
    s = sm.shape[1]/w
    det = cv2.FaceDetectorYN.create('onnx', _yunet_bytes(), _EMPTY, (sm.shape[1], sm.shape[0]), thr, 0.3, 500)
    _, f = det.detect(np.ascontiguousarray(sm[:, :, ::-1]))
    faces = []
    if f is not None:
        for d in f:
            if d[14] < thr or d[2] < min_px: continue
            faces.append(dict(sbox=tuple(float(v) for v in d[:4]),
                              box=tuple(float(v)/s for v in d[:4]), score=float(d[14])))
    return sm, faces


_SEG = {}


def _seg_net():
    """Мережа, що відокремлює людей від фону (PP-HumanSeg з OpenCV Zoo).
    Як і модель облич, читається з байтів: шлях до програми може містити кирилицю."""
    if 'net' not in _SEG:
        import threading
        _SEG['lock'] = threading.Lock()
        try:
            with open(HUMSEG, 'rb') as fh:
                _SEG['net'] = cv2.dnn.readNetFromONNX(np.frombuffer(fh.read(), np.uint8))
        except Exception:
            _SEG['net'] = None
    return _SEG['net']


def guided2(I, q, r, eps):
    """Згладжування q з краями, взятими з I (керований фільтр)."""
    mI, mq = _box(I, r), _box(q, r)
    a = (_box(I*q, r)-mI*mq)/(np.maximum(_box(I*I, r)-mI*mI, 0)+eps)
    b = mq-a*mI
    return _box(a, r)*I+_box(b, r)


def person_prob(srgb_small):
    """Де на кадрі люди: 0..1 для кожного пікселя зменшеного кадру (sRGB 0..1).
    Фон (банери, стіни, розмиті декорації) так не приймається за одяг.
    None — якщо модель недоступна: тоді зони визначаються лише за обличчями."""
    net = _seg_net()
    if net is None: return None
    h, w = srgb_small.shape[:2]
    x = cv2.resize(np.ascontiguousarray(srgb_small, np.float32), (192, 192), interpolation=cv2.INTER_AREA)
    try:
        with _SEG['lock']:
            net.setInput(cv2.dnn.blobFromImage((x-0.5)/0.5))
            o = net.forward()[0].astype(np.float32)
    except Exception:
        return None
    e = np.exp(o-o.max(0, keepdims=True)); pr = e[1]/e.sum(0)
    pr = cv2.resize(pr, (w, h), interpolation=cv2.INTER_LINEAR)
    # межа людини — по краях на самому фото, а не по грубій сітці мережі
    g = cv2.cvtColor(np.ascontiguousarray(srgb_small, np.float32), cv2.COLOR_RGB2GRAY)
    return np.clip(guided2(g, pr, max(2, int(round(min(h, w)*0.012))), 2e-3), 0, 1).astype(np.float32)


def _skin_sel(roi, min_px):
    ycc = cv2.cvtColor(np.ascontiguousarray(roi[:, :, ::-1]), cv2.COLOR_BGR2YCrCb)
    base = ((ycc[..., 1] >= 133) & (ycc[..., 1] <= 175) & (ycc[..., 2] >= 76) & (ycc[..., 2] <= 128))
    for lo, hi in ((95, 220), (77, 235), (35, 248)):
        m = base & (ycc[..., 0] > lo) & (ycc[..., 0] < hi)
        if m.sum() >= min_px: return m
    return None


def skin_index(sm, faces, min_px=80):
    """Координати пікселів шкіри (середина лиця) для кожного обличчя окремо."""
    out = []
    H, W = sm.shape[:2]
    for f in faces:
        x, y, w, h = f['sbox']
        x0, x1 = max(int(x+.22*w), 0), min(int(x+.78*w), W)
        y0, y1 = max(int(y+.32*h), 0), min(int(y+.84*h), H)
        roi = sm[y0:y1, x0:x1]
        if roi.size == 0: out.append(None); continue
        m = _skin_sel(roi, min_px)
        if m is None: out.append(None); continue
        yy, xx = np.nonzero(m); out.append((yy+y0, xx+x0))
    return out


def _merge_idx(idx):
    ok = [i for i in idx if i is not None]
    if not ok: return None
    return np.concatenate([i[0] for i in ok]), np.concatenate([i[1] for i in ok])


def skin_L_px(px):
    """Світлота шкіри L* за набором пікселів sRGB 0..1 (N×3)."""
    return lightness(np.median(s2l(np.asarray(px, np.float32)), 0))


def skin_L_of(srgb, idx):
    """Світлота шкіри L* на зображенні sRGB 0..1."""
    if idx is None: return None
    return skin_L_px(srgb[idx[0], idx[1]])


# ------------------------------------------------------------------ тон: баланс, рівні, середні тони
def corr_gains(dt, dn):
    """dt>0 — тепліше, dn>0 — в бік пурпурного. Жоден канал не підсилюється:
    так баланс білого нічого не пересвічує, а яскравість відновлюють рівні."""
    g = np.array([np.exp(dt), np.exp(-dn), np.exp(-dt)], np.float32)
    return g/float(g.max())


def gains_for_shift(L, a, b, da, db, lv=None):
    """Підсилення каналів, що зсувають колір (L, a, b) на (da, db).
    lv — рівні, після яких цей колір виміряно: тоді рахуємо від кольору до рівнів."""
    def pre(v):
        if lv: v = v*(lv['white']-lv['black'])/255.0+lv['black']/255.0
        return s2l(np.clip(v, 0, 1))
    c0 = pre(lab2srgb(np.array([[[L, a, b]]], np.float32))[0, 0])
    c1 = pre(lab2srgb(np.array([[[L, a+da, b+db]]], np.float32))[0, 0])
    g = np.maximum(c1, 1e-4)/np.maximum(c0, 1e-4)
    lg = np.log(g)
    dt = float((lg[0]-lg[2])/2); dn = float((lg[0]+lg[2])/2-lg[1])
    return dt, dn


def knee_of(r):
    """Де починається м'яке притримування світлих місць (1 — ніде).
    З додатною експозицією світлі місця не обрізаються різко, а плавно доходять до білого."""
    k = float(r.get('knee', 1.0) or 1.0)
    ev = float(r.get('ev', 0.0) or 0.0)
    if ev > 0.02: k = min(k, 1.0-min(0.15, 0.3*ev))
    if r.get('light'): k = min(k, 0.92)     # піднятий бік кадру теж не обрізаємо різко
    return k


def levels(v, r):
    """Рівні як у Photoshop: однаково для всіх каналів, v — sRGB 0..1."""
    b, w = r['black']/255.0, r['white']/255.0
    t = (v-b)*(1.0/max(w-b, 1e-3))
    np.maximum(t, 0, out=t)
    kn = knee_of(r)
    if kn < 0.999:
        hi = t > kn
        if hi.any(): t[hi] = kn+(1-kn)*np.tanh((t[hi]-kn)/(1-kn))
    np.minimum(t, 1, out=t)
    g = r.get('gamma', 1.0)
    if abs(g-1) > 1e-3: np.power(t, g, out=t)
    c = r.get('contrast', 0.0)
    if abs(c) > 0.005:
        s = 0.5-np.sin(np.arcsin(np.clip(1-2*t, -1, 1))/3)
        t = t+c*(s-t)
    return t


def channel_luts(r):
    """Таблиці 256 значень на канал: баланс білого, експозиція, рівні."""
    g = corr_gains(r['temp'], r['tint'])*float(2.0**r.get('ev', 0.0))
    lut_lin = np.stack([_S2L*float(g[c]) for c in range(3)])     # для «повільного» шляху
    v = l2s(lut_lin)
    out = np.stack([levels(v[c].copy(), r) for c in range(3)])
    return lut_lin, np.clip(np.round(out*255), 0, 255).astype(np.uint8)


def light_map(shape, light, y0=0, full_h=None):
    """Карта вирівнювання світла в EV для смуги рядків: площина по кадру,
    яка лише піднімає темніший бік (світліший лишається як був)."""
    if not light: return None
    H = full_h or shape[0]; h, w = shape
    xx = (np.arange(w, dtype=np.float32)+0.5)/w-0.5
    yy = (np.arange(y0, y0+h, dtype=np.float32)+0.5)/H-0.5
    return np.maximum(light['x']*xx[None, :]+light['y']*yy[:, None]-float(light.get('c', 0.0)), 0)


# ------------------------------------------------------------------ маски зон
def ellipse_mask(shape, boxes, grow=(0.62, 0.78), soft=(0.65, 1.0)):
    """Маски облич; boxes — частки кадру (x, y, w, h)."""
    hs, ws = shape
    out = np.zeros(shape, np.float32)
    if not boxes: return out
    yy, xx = np.mgrid[0:hs, 0:ws].astype(np.float32)
    for x, y, w, h in boxes:
        cx, cy = (x+w/2)*ws, (y+h/2)*hs
        rx, ry = max(w*grow[0]*ws, 1.5), max(h*grow[1]*hs, 1.5)
        d = np.sqrt(((xx-cx)/rx)**2+((yy-cy)/ry)**2)
        out = np.maximum(out, 1-ss(d, *soft))
    return out


def body_prior(shape, boxes, down=7.5, up=-0.55):
    """Де може бути одяг людей: під обличчями і трохи вбік (down — на скільки висот
    обличчя вниз; up — звідки починати: від'ємне — нижче верху обличчя)."""
    hs, ws = shape
    m = np.zeros(shape, np.uint8)
    for x, y, w, h in boxes:
        x0, x1 = int(max((x-1.6*w)*ws, 0)), int(min((x+w+1.6*w)*ws, ws))
        y0, y1 = int(max((y-up*h)*hs, 0)), int(min((y+down*h)*hs, hs))
        m[y0:y1, x0:x1] = 1
    return m


def face_block(shape, boxes, grow=0.18):
    hs, ws = shape
    m = np.zeros(shape, bool)
    for x, y, w, h in boxes:
        x0, x1 = int(max((x-grow*w)*ws, 0)), int(min((x+w+grow*w)*ws, ws))
        y0, y1 = int(max((y-grow*h)*hs, 0)), int(min((y+h+0.1*h)*hs, hs))
        m[y0:y1, x0:x1] = True
    return m


def small_for_mask(img, p=P):
    """Зменшена копія фіксованого розміру: маски не залежать від роздільності фото."""
    H, W = img.shape[:2]
    k = p['mask_side']/max(H, W)
    if k >= 1: return img
    return cv2.resize(img, (max(int(W*k), 16), max(int(H*k), 16)), interpolation=cv2.INTER_AREA)


def white_regions(srgb_small, boxes, p=P, for_wb=False, person=None):
    """Білі речі на зменшеному кадрі (sRGB 0..1, довша сторона ~640 px).

    Береться не будь-що світле, а окремі ділянки, які:
      * на людях (не фон) — під обличчями і трохи вбік, і це не саме обличчя;
      * мають справді білі місця (насіння);
      * мають рівний відтінок у межах природного білого — тож блакитні, рожеві,
        кремові речі, шкіра і жовтуватий фон сюди не потрапляють.
    Для оцінки балансу білого межі ширші: там важливо побачити і білу річ із сильним відтінком.
    Повертає (мітки ділянок, номери, Lab, {номер: (a, b)}) або None."""
    lab = labf(srgb_small); L, A, B = lab[..., 0], lab[..., 1], lab[..., 2]
    C = np.hypot(A, B)
    hs, ws = L.shape
    # для виправлення — лише верхній одяг: колготки на ногах просвічують шкіру,
    # і їхній теплий відтінок природний; для оцінки балансу — весь одяг
    down = 7.5 if for_wb else p['wh_down']
    # піднята над головою рука — теж одяг; на людях (за маскою людей) це безпечно
    up = 1.2 if (person is not None and not for_wb) else -0.55
    near = body_prior((hs, ws), boxes, down, up).astype(bool) if boxes else np.ones((hs, ws), bool)
    if person is not None: near &= person > p['person_thr']
    cmax = p['wh_C']+(4.0 if for_wb else 0.0)
    cand = ((L > p['wh_L']) & (C < cmax) & (B > -9.0) & (A < 9.0) & (A > -8.0)
            & near & ~face_block((hs, ws), boxes))
    seed = cand & (L > p['wh_seedL']) & (C < p['wh_seedC']+(4.0 if for_wb else 0.0))
    if seed.sum() < 6: return None
    n, lid, st, _ = cv2.connectedComponentsWithStats(cand.astype(np.uint8), connectivity=8)
    seeds_per = np.bincount(lid[seed], minlength=n)
    min_area = max(10, int(p['wh_min']*hs*ws))
    if not boxes: min_area = max(min_area, int(0.005*hs*ws))
    (alo, ahi), (blo, bhi) = p['wh_accept']
    keep, tint = [], {}
    for i in range(1, n):
        area = st[i, cv2.CC_STAT_AREA]
        if area < min_area or seeds_per[i] < max(4, 0.03*area): continue
        x, y, w, h = st[i, cv2.CC_STAT_LEFT], st[i, cv2.CC_STAT_TOP], st[i, cv2.CC_STAT_WIDTH], st[i, cv2.CC_STAT_HEIGHT]
        sl = (slice(y, y+h), slice(x, x+w))
        inner = (lid[sl] == i) & (L[sl] > 65)
        if inner.sum() < 8: continue
        am = float(np.median(A[sl][inner])); bm = float(np.median(B[sl][inner])); cm = float(np.median(C[sl][inner]))
        if for_wb:
            if cm > 14 or not (-9 <= am <= 8) or not (-9 <= bm <= 14): continue
        elif cm > p['wh_comp_C'] or not (alo <= am <= ahi) or not (blo <= bm <= bhi): continue
        keep.append(i); tint[i] = (am, bm)
    if not keep: return None
    return lid, keep, lab, tint


def whites_mask(srgb_small, boxes, p=P, person=None):
    """Зона білого одягу і природний відтінок кожної речі (на зменшеному кадрі).

    Так робить фотограф: виділяє сорочку, розтушовує край виділення і прибирає
    з неї чужий відтінок. Тут зона — білий одяг на людях (white_regions); край
    розтушований і не виходить за межі людини, тож світлий фон поряд не змінюється.
    Тканину з дрібним кольоровим візерунком (квіти на сукні) не чіпаємо: блідий край
    візерунка легко сплутати з відблиском.
    Повертає (маска, a_ref, b_ref, тверда маска, маска одягу без урахування візерунка) або None."""
    if person is None: person = person_prob(srgb_small)
    res = white_regions(srgb_small, boxes, p, person=person)
    if res is None: return None
    lid, keep, lab, tint = res
    (alo, ahi), (blo, bhi) = p['wh_box']
    aref = np.zeros(lid.shape, np.float32); bref = np.zeros(lid.shape, np.float32)
    hard = np.zeros(lid.shape, np.float32)
    for i in keep:
        sel = lid == i
        hard[sel] = 1.0
        # власний відтінок речі — у природних межах білого
        aref[sel] = float(np.clip(tint[i][0], alo, ahi)); bref[sel] = float(np.clip(tint[i][1], blo, bhi))
    m = cv2.dilate(hard, np.ones((3, 3), np.uint8))
    sig = max(1.0, p['wh_feather']*np.hypot(*m.shape))
    # відтінок поширюємо в зону розтушування разом з маскою
    wsum = cv2.GaussianBlur(hard, (0, 0), sig*2)+1e-6
    aref = cv2.GaussianBlur(aref*hard, (0, 0), sig*2)/wsum
    bref = cv2.GaussianBlur(bref*hard, (0, 0), sig*2)/wsum
    m = np.clip(cv2.GaussianBlur(m, (0, 0), sig)*1.6, 0, 1)
    if person is not None: m *= np.clip((person-0.25)/0.5, 0, 1)
    body = m.copy()
    # візерунок — кольорові плями всередині речі (квіти на сукні). Червоні штани чи
    # вишивка поряд — не всередині: біля них якраз і бувають рожеві відблиски
    hu = hard.astype(np.uint8)
    filled = hu.copy()
    cnt, _ = cv2.findContours(hu, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cv2.drawContours(filled, cnt, -1, 1, thickness=-1)
    spots = (filled > 0) & (hu == 0) & (np.hypot(lab[..., 1], lab[..., 2]) > 12)
    r = max(3, int(round(0.012*np.hypot(*m.shape))))
    m *= 1-ss(_box(spots.astype(np.float32), r), *p['wh_print'])
    return m.astype(np.float32), aref.astype(np.float32), bref.astype(np.float32), hard, body.astype(np.float32)


def whites_shift(L, A, B, aref, bref, p=P):
    """На скільки зсунути a*, b* кожного пікселя білої речі: прибираємо відхилення
    від її природного білого — рожеві й червоні відблиски в складках, зелений наліт.
    Жовтуваті тіні лише трохи вирівнюємо, синюваті лишаємо — так виглядає природно,
    а кремова чи блакитна тканина лишається своєю. Насичені кольори (вишивка, шкіра)
    і глибокі тіні не чіпаємо."""
    C = np.hypot(A, B)
    ea = A-aref; eb = B-bref
    # сильно інший колір — це вже інший матеріал (край сукні, візерунок), а не відблиск
    k = (1-ss(C, *p['wh_gate_C']))*ss(L, 38.0, 52.0)*(1-ss(np.hypot(ea, eb), *p['wh_gate_e']))
    da = np.sign(ea)*np.maximum(np.abs(ea)-p['wh_a_dead'], 0)*p['wh_a_k']
    db = np.maximum(eb-p['wh_b_dead'], 0)*p['wh_b_k']
    return k*da, k*db


def apply_whites(out8, mk, p=P):
    """Знімає чужий відтінок з білого одягу на готовому кадрі (лише в межах маски)."""
    m_small, aref_s, bref_s = mk[:3]
    H, W = out8.shape[:2]
    ys, xs = np.nonzero(m_small > 0.01)
    if not len(ys): return out8
    m = cv2.resize(m_small, (W, H), interpolation=cv2.INTER_LINEAR)
    aref = cv2.resize(aref_s, (W, H), interpolation=cv2.INTER_LINEAR)
    bref = cv2.resize(bref_s, (W, H), interpolation=cv2.INTER_LINEAR)
    sy, sx = H/m_small.shape[0], W/m_small.shape[1]
    y0, y1 = max(int(ys.min()*sy)-2, 0), min(int((ys.max()+1)*sy)+2, H)
    x0, x1 = max(int(xs.min()*sx)-2, 0), min(int((xs.max()+1)*sx)+2, W)
    for r0 in range(y0, y1, p['tile_rows']):
        r1 = min(r0+p['tile_rows'], y1)
        mm = m[r0:r1, x0:x1]
        if mm.max() < 0.01: continue
        blk = out8[r0:r1, x0:x1].astype(np.float32)/255.0
        lab = labf(blk)
        da, db = whites_shift(lab[..., 0], lab[..., 1], lab[..., 2], aref[r0:r1, x0:x1], bref[r0:r1, x0:x1], p)
        lab[..., 1] -= mm*da; lab[..., 2] -= mm*db
        out8[r0:r1, x0:x1] = np.clip(lab2srgb(lab)*255+0.5, 0, 255).astype(np.uint8)
    return out8


def protect_whites(rgb8, r, p, zones, out8, m_small):
    """Білий одяг, що вигорає після рівнів: у його зоні світлі місця не обрізаються,
    а плавно доходять до білого — складки й фактура тканини лишаються видимими."""
    H, W = out8.shape[:2]
    ys, xs = np.nonzero(m_small > 0.02)
    if not len(ys): return out8
    r2 = dict(r, knee=p['wh_knee'], whites=0.0, whites_hi=0.0, guard=0.0)
    sy, sx = H/m_small.shape[0], W/m_small.shape[1]
    y0, y1 = max(int(ys.min()*sy)-2, 0), min(int((ys.max()+1)*sy)+2, H)
    x0, x1 = max(int(xs.min()*sx)-2, 0), min(int((xs.max()+1)*sx)+2, W)
    alt = render(rgb8, r2, p, zones)[y0:y1, x0:x1].astype(np.float32)
    m = cv2.resize(m_small, (W, H), interpolation=cv2.INTER_LINEAR)[y0:y1, x0:x1, None]
    cur = out8[y0:y1, x0:x1].astype(np.float32)
    out8[y0:y1, x0:x1] = np.clip(cur+m*(alt-cur)+0.5, 0, 255).astype(np.uint8)
    return out8


def apply_guard(out8, boxes, p=P):
    """Найсвітліші ділянки облич (щоки, лоб, ніс) м'яко притискаємо, щоб не пересвітились."""
    H, W = out8.shape[:2]
    ms = ellipse_mask((max(int(H*p['map_scale']), 32), max(int(W*p['map_scale']), 32)), boxes,
                      grow=(0.62, 0.80), soft=(0.7, 1.05))
    m = cv2.resize(ms, (W, H), interpolation=cv2.INTER_LINEAR)
    k = p['guard_knee']
    for r0 in range(0, H, p['tile_rows']):
        r1 = min(r0+p['tile_rows'], H)
        mm = m[r0:r1]
        if mm.max() < 0.01: continue
        blk = out8[r0:r1].astype(np.float32)/255.0
        Y = np.maximum(blk @ LUMA8, 1e-4)
        hi = Y > k
        if not hi.any(): continue
        Yn = np.where(hi, k+(1-k)*np.tanh((Y-k)/(1-k)*0.85), Y)
        f = 1+mm*(Yn/Y-1)
        out8[r0:r1] = np.clip(blk*f[..., None]*255+0.5, 0, 255).astype(np.uint8)
    return out8


# ------------------------------------------------------------------ аналіз
def _tone_small(sm, r, pre=None):
    """Зменшений кадр після балансу, вирівнювання світла і рівнів (sRGB 0..1)."""
    if pre is None: pre = _pre_small(sm, r)
    return levels(pre.copy(), r)


def _pre_small(sm, r):
    """Зменшений кадр після балансу білого і вирівнювання світла, до рівнів."""
    lin = s2l8(sm)*corr_gains(r['temp'], r['tint'])*float(2.0**r.get('ev', 0.0))
    lm = light_map(sm.shape[:2], r.get('light'))
    if lm is not None: lin = lin*np.exp2(lm)[..., None]
    return l2s(lin)


def _wb(img, faces, boxes, sidx, p, person=None):
    """Оцінка зсуву кольору (da, db), який треба застосувати, і пояснення.
    img — зменшений кадр sRGB 0..1 уже після рівнів (так, як його побачать).
    Свідчення: білий одяг (головне) і шкіра облич (підтвердження)."""
    info = {}
    ww, Iw = 0.0, (0.0, 0.0)
    small = small_for_mask(img, p)
    res = white_regions(small, boxes, p, for_wb=True, person=person)
    if res is not None:
        lid, keep, lab, tint = res
        L, A, B = lab[..., 0], lab[..., 1], lab[..., 2]
        if len(keep) >= 3:
            # ділянки з відтінком, далеким від решти (світлий фон, крем), не рахуємо
            area = np.array([float((lid == i).sum()) for i in keep])
            ta = np.array([tint[i][0] for i in keep]); tb = np.array([tint[i][1] for i in keep])
            ma, mb = _wmedian(ta, area), _wmedian(tb, area)
            keep = [i for i, a_, b_ in zip(keep, ta, tb) if np.hypot(a_-ma, b_-mb) <= 6.0]
        sel = np.isin(lid, keep) & (L > 65) & (L < 96)
        if sel.sum() >= 30:
            wl = np.clip((L[sel]-60)/30, 0.2, 1)
            aw, bw = float(np.average(A[sel], weights=wl)), float(np.average(B[sel], weights=wl))
            frac = float(np.isin(lid, keep).mean())
            ww = float(np.clip((frac-p['w_frac0'])/p['w_frac'], 0, 1))
            Iw = _implied((aw, bw), p['w_box'], p['w_target'], p['wb_soft'])
            info.update(white_ab=(round(aw, 1), round(bw, 1)), white_px=round(100*frac, 2), ww=round(ww, 2))
    ws_, Is = 0.0, (0.0, 0.0)
    pts, wts = [], []
    for f, idx in zip(faces, sidx):
        if idx is None or len(idx[0]) < 60: continue
        med = np.median(img[idx[0], idx[1]], 0)
        l = labf(np.clip(med, 0, 1).reshape(1, 1, 3))[0, 0]
        pts.append((l[1], l[2])); wts.append(f['sbox'][2]**2)
    if pts:
        a_s, b_s = (float(v) for v in np.average(np.array(pts), 0, weights=wts))
        Is = _implied((a_s, b_s), p['s_box'], p['s_target'], p['wb_soft'])
        out = Is != (0.0, 0.0)
        ws_ = min(len(pts), 3)/3.0*(p['s_w_out'] if out else p['s_w_in'])
        info.update(skin_ab=(round(a_s, 1), round(b_s, 1)))
    den = ww+ws_+p['wb_reg']
    da = (ww*Iw[0]+ws_*Is[0])/den; db = (ww*Iw[1]+ws_*Is[1])/den
    # шкіра проти білого одягу: якщо тягнуть у різні боки, по цій осі нічого не робимо
    if ww and ws_:
        if Iw[0]*Is[0] < 0: da = 0.0
        if Iw[1]*Is[1] < 0: db = 0.0
    # обличчя не виводимо з природного кольору: зсув зупиняється, щойно шкіра
    # переходить за природну середину з запасом (кремовий одяг — не привід синити обличчя)
    if pts:
        d = [da, db]
        for k, v in enumerate((a_s, b_s)):
            lo, hi = p['s_target'][k]-p['s_tol'], p['s_target'][k]+p['s_tol']
            if d[k] < 0: d[k] = max(d[k], min(0.0, lo-v))
            elif d[k] > 0: d[k] = min(d[k], max(0.0, hi-v))
        da, db = d
    # мертва зона плавна: на її межі поправка майже нульова, тож фото на межі
    # не перескакує між «треба» і «не треба» від дрібної різниці в кадрі
    mag = float(np.hypot(da, db))
    if mag <= p['wb_dead']: da = db = 0.0
    else:
        f = min(mag-p['wb_dead'], p['wb_cap'])/mag
        da, db = da*f, db*f
    ref = info.get('white_ab') or info.get('skin_ab') or (0.0, 0.0)
    refL = 85.0 if 'white_ab' in info else 65.0
    return da, db, ref, refL, info


def hist_levels(srgb, p=P, skip=None):
    """Біла й чорна точки (0..255) за гістограмою яскравості, як у «Рівнях» Photoshop:
    біла — трохи правіше від кінця гістограми, чорна — трохи всередину від її початку.
    skip — пікселі, які не впливають на білу точку (обличчя: пересвічена щока не повинна
    зупиняти освітлення всього кадру — її бережемо окремо)."""
    Y = (srgb*255.0) @ LUMA8
    Yw = Y if skip is None or skip.mean() > 0.6 else Y[~skip]
    q_hi = float(np.percentile(Yw, p['white_pct'])); q_lo = float(np.percentile(Y, p['black_pct']))
    w = min(255.0, q_hi+p['white_margin'])
    if 255.0/w < p['white_gain_min']: w = 255.0
    w = max(w, p['white_floor'])
    b = min(p['black_k']*q_lo, p['black_cap'])
    if b < p['black_min']: b = 0.0
    return w, b, (q_lo, q_hi)


def _implied(v, box, target, soft):
    out = []
    for k in range(2):
        lo, hi = box[k]
        d = max(lo-v[k], v[k]-hi, 0.0)
        out.append(0.0 if d <= 0 else (target[k]-v[k])*min(d/soft, 1.0))
    return tuple(out)


def _light(sm, faces, sidx, r, p):
    """Нерівне світло: обличчя на одному боці кадру помітно темніші, ніж на іншому."""
    pre = _pre_small(sm, r)
    hs, ws = sm.shape[:2]
    pts = []
    big = max(f['sbox'][2] for f in faces)
    for f, idx in zip(faces, sidx):
        if idx is None or len(idx[0]) < 60: continue
        x, y, w, h = f['sbox']
        if w < p['main_face']*big: continue     # дрібні обличчя на задньому плані не порівнюємо
        pts.append(((x+w/2)/ws-0.5, (y+h/2)/hs-0.5, skin_L_of(pre, idx), w*h))
    if len(pts) < 2: return None
    a = np.array(pts, np.float64)
    X = [np.ones(len(a)), a[:, 0]]
    use_y = len(a) >= 4 and np.ptp(a[:, 1]) > 0.3
    if use_y: X.append(a[:, 1])
    X = np.array(X).T; wts = np.sqrt(a[:, 3]/a[:, 3].max())
    coef, *_ = np.linalg.lstsq(X*wts[:, None], a[:, 2]*wts, rcond=None)
    pred = X @ coef
    spread = float(np.ptp(pred))
    resid = a[:, 2]-pred
    tot = float(np.sum((a[:, 2]-a[:, 2].mean())**2))+1e-6
    r2 = 1-float(np.sum(resid**2))/tot
    if spread < (p['light_min'] if len(a) >= 3 else p['light_min2']) or (len(a) >= 3 and r2 < p['light_r2']): return None
    # L* на 1 EV біля шкіри ≈ 17.6; темний бік піднімаємо, найсвітліше обличчя лишається як було
    k = -p['light_k']/17.6
    gx = float(coef[1]*k); gy = float(coef[2]*k) if use_y else 0.0
    j = int(np.argmax(a[:, 2]))
    c = gx*a[j, 0]+gy*a[j, 1]
    edge = max(gx*sx+gy*sy for sx in (-0.5, 0.5) for sy in (-0.5, 0.5))-c
    if edge > p['light_cap']:
        f = p['light_cap']/edge; gx, gy, c = gx*f, gy*f, c*f
    return dict(x=round(gx, 3), y=round(gy, 3), c=round(c, 3), spread=round(spread, 1))


def analyze(rgb8, p=P, off=(), wb=None, taken=None, **_):
    """Визначає, що потрібно цьому фото. Не залежить від розміру кадру:
    рівні в одиницях 0..255, обличчя — частками кадру.
    wb=(temp, tint) — баланс білого, взятий від інших фото тієї ж зйомки;
    taken — час зйомки (секунди), щоб розрізняти зйомки в одній папці."""
    off = set(off or ())
    sm, faces = detect_faces(rgb8, p['analysis_side'])
    hs, ws = sm.shape[:2]
    boxes = [(f['sbox'][0]/ws, f['sbox'][1]/hs, f['sbox'][2]/ws, f['sbox'][3]/hs) for f in faces]
    r = dict(v=VERSION, faces=len(faces), boxes=[tuple(round(v, 4) for v in b) for b in boxes],
             temp=0.0, tint=0.0, ev=0.0, white=255.0, black=0.0, gamma=1.0,
             whites=0.0, whites_hi=0.0, guard=0.0, light=None,
             shadows=0.0, highlights=0.0, contrast=0.0, sat=0.0)
    sidx = skin_index(sm, faces)
    allidx = _merge_idx(sidx)

    # 1) колір — оцінюємо на кадрі після рівнів, тобто таким, яким його побачать.
    #    Повторюємо, доки кадр із поправкою вже не просить нової (залишок менший
    #    за мертву зону): тож повторна обробка готового фото нічого не змінює.
    base = sm.astype(np.float32)/255.0
    faces_m = ellipse_mask((hs, ws), boxes, grow=(0.62, 0.80), soft=(0.7, 1.05)) > 0.3 if boxes else None
    person = person_prob(small_for_mask(base, p))
    r['person'] = person is not None
    dt = dn = 0.0
    info = {}
    tot = np.zeros(2)
    for step in range(p['wb_steps']):
        cur = _pre_small(sm, dict(temp=dt, tint=dn)) if step else base
        w0, b0, _ = hist_levels(cur, p, faces_m)
        lv0 = dict(white=w0, black=b0, gamma=1.0)
        da, db, ref, refL, inf = _wb(levels(cur.copy(), lv0), faces, boxes, sidx, p, person)
        if step == 0: info = inf
        if not (da or db): break
        # загальний зсув не більший за межу (на випадок дуже сильного відтінку)
        nxt = tot+(da, db); mag = float(np.hypot(*nxt)); last = mag > p['wb_cap']
        if last:
            nxt = nxt*p['wb_cap']/mag; da, db = (float(v) for v in nxt-tot)
        t2, n2 = gains_for_shift(refL, ref[0], ref[1], da, db, lv0)
        dt += t2; dn += n2; tot = nxt
        if last: break
    if float(np.hypot(*tot)) < p['wb_min']: dt = dn = 0.0; tot[:] = 0    # непомітна різниця
    if tot.any(): r['wb_shift'] = tuple(round(float(v), 1) for v in tot)
    r['wb_info'] = info
    r['wb_w'] = info.get('ww', 0.0)
    r['sig'] = signature(sm, sidx, taken)
    r['wb_own'] = (round(dt, 3), round(dn, 3))
    if wb is not None:
        dt, dn = float(wb[0]), float(wb[1]); r['wb_src'] = 'зйомка'
    r['temp'] = 0.0 if 'temp' in off else round(dt, 3)
    r['tint'] = 0.0 if 'tint' in off else round(dn, 3)

    # 2) нерівне світло між обличчями
    if 'light' not in off and len(faces) >= 2:
        r['light'] = _light(sm, faces, sidx, r, p)

    # 3) рівні за гістограмою — по кадру без вирівнювання світла: спершу рівні для
    #    всього кадру, потім темніший бік піднімається поверх них
    w, b, (q_lo, q_hi) = hist_levels(_pre_small(sm, dict(r, light=None)), p, faces_m)
    pre = _pre_small(sm, r)
    r['hist'] = (round(q_lo, 1), round(q_hi, 1))
    if 'white' not in off: r['white'] = round(w, 1)
    if 'black' not in off: r['black'] = round(b, 1)

    # 4) обличчя: світлота шкіри після рівнів
    if allidx is not None:
        px0 = pre[allidx[0], allidx[1]]
        L0 = skin_L_px(sm[allidx[0], allidx[1]].astype(np.float32)/255.0)
        r['skinL'] = round(L0, 1)
        L1 = skin_L_px(levels(px0.copy(), r))
        # біла точка не повинна робити обличчя надто світлим
        lim = max(p['face_hi'], L0)
        if L1 > lim and r['white'] < 255:
            lo, hi = r['white'], 255.0
            for _ in range(14):
                mid = (lo+hi)/2
                if skin_L_px(levels(px0.copy(), dict(r, white=mid))) > lim: lo = mid
                else: hi = mid
            r['white'] = round(hi, 1)
            if 255.0/r['white'] < p['white_gain_min']: r['white'] = 255.0
            L1 = skin_L_px(levels(px0.copy(), r))
        # обличчя головних людей темні — додаємо експозицію, як фотограф повзунком
        # «Експозиція»: світлішає весь кадр, а найсвітліші місця плавно доходять до білого
        if 'ev' not in off:
            big = max(f['sbox'][2] for f in faces)
            main = [idx for f, idx in zip(faces, sidx)
                    if idx is not None and f['sbox'][2] >= p['main_face']*big]
            if main:
                fpx = [s2l(pre[idx[0], idx[1]]) for idx in main]

                def brightest(ev):
                    rr = dict(r, ev=ev)
                    return max(skin_L_px(levels(l2s(x*2.0**ev), rr)) for x in fpx)
                Lm = brightest(0.0)
                r['faceL_main'] = round(Lm, 1)
                if Lm < p['face_lift']:
                    lo, hi = 0.0, p['ev_cap']
                    if brightest(hi) <= p['face_lift_to']: lo = hi
                    else:
                        for _ in range(14):
                            mid = (lo+hi)/2
                            if brightest(mid) < p['face_lift_to']: lo = mid
                            else: hi = mid
                    if lo >= 0.05: r['ev'] = round(lo, 2)
    if r['ev']: pre = _pre_small(sm, r)
    out = _tone_small(sm, r, pre)
    if allidx is not None: r['skinL_out'] = round(skin_L_of(out, allidx), 1)

    # 5) білий одяг (на людях — тож лише там, де є обличчя): чужий відтінок і вигорання світлих місць
    if boxes and ('whites' not in off or 'whites_hi' not in off):
        out_s = small_for_mask(out, p)
        mk = whites_mask(out_s, boxes, p, person)
        if mk is not None and 'whites_hi' not in off:
            body = mk[4] > 0.5
            if body.any():
                r['whites_hot'] = round(100*float(np.mean(chmax(out_s)[body] >= 0.985)), 1)
                if r['whites_hot'] >= p['wh_hot'] and body.mean() >= p['wh_area']*0.5:
                    r['whites_hi'] = 1.0
        if mk is not None and 'whites' not in off:
            m, aref, bref, hard = mk[:4]
            sel = (hard > 0) & (m > 0.5)
            lab_o = labf(out_s)
            da_, db_ = whites_shift(lab_o[..., 0], lab_o[..., 1], lab_o[..., 2], aref, bref, p)
            da_, db_ = da_*m, db_*m
            sh = np.hypot(da_[sel], db_[sel]) if sel.any() else np.zeros(1)
            # помітний відтінок: на десятій частині тканини поправка не менша за поріг
            p90 = float(np.percentile(sh, 90))
            r['whites_px'] = round(100*float(sel.mean()), 2)
            r['whites_amount'] = round(p90, 2)
            r['whites_tinted'] = round(100*float(np.mean(sh > p['wh_px_shift'])), 1)
            if sel.any():
                r['whites_ab'] = (round(float(np.mean(np.abs(da_[sel]))), 2), round(float(np.mean(np.abs(db_[sel]))), 2))
            if p90 >= p['wh_p90'] and sel.mean() >= p['wh_area']:
                r['whites'] = 1.0

    # 6) світлі ділянки облич: на якомусь обличчі помітна пляма майже білого кольору
    if 'guard' not in off and boxes:
        Y = out @ LUMA8
        hot = 0.0
        for b in boxes:
            m = ellipse_mask((hs, ws), [b], grow=(0.42, 0.55), soft=(0.9, 1.0)) > 0.5
            if m.sum() >= 50: hot = max(hot, float(np.mean(Y[m] >= p['guard_on'])))
        r['face_hot'] = round(100*hot, 1)
        if r['face_hot'] >= p['guard_frac']: r['guard'] = 1.0

    # 7) що змінюється
    r['changes'] = changes_of(r, p)
    r['needs'] = any(k in MAJOR for k in r['changes'])
    return r


def changes_of(r, p=P):
    ch = []
    if r.get('white', 255) < 255 and 255.0/r['white'] >= p['white_gain_min']-1e-6: ch.append('white')
    if r.get('black', 0) >= p['black_min']: ch.append('black')
    if abs(r.get('ev', 0)) >= 0.05: ch.append('ev')
    if abs(r.get('gamma', 1)-1) >= 0.015: ch.append('gamma')
    if abs(r.get('temp', 0)) >= 0.004: ch.append('temp')
    if abs(r.get('tint', 0)) >= 0.004: ch.append('tint')
    if r.get('whites'): ch.append('whites')
    if r.get('whites_hi'): ch.append('whites_hi')
    if r.get('guard'): ch.append('guard')
    if r.get('light'): ch.append('light')
    return ch


# ------------------------------------------------------------------ серія (зйомка)
def signature(sm, sidx, taken=None):
    """Ознаки освітлення кадру: колір шкіри і загальний колір світла, час зйомки.
    За різкою зміною цих ознак між сусідніми фото визначаються межі зйомок."""
    lin = s2l8(sm)
    mx, mn = chmax(lin), chmin(lin)
    v = (mx < 0.92) & (mn > 0.02)
    if v.sum() >= 500:
        e = (lin[v]**6).mean(0)**(1/6); ill = np.log(e/e[1])[[0, 2]]
    else:
        ill = np.zeros(2)
    sk = [np.median(lin[i[0], i[1]], 0) for i in sidx if i is not None and len(i[0]) >= 60]
    skin = None
    if sk:
        m = np.median(np.array(sk), 0); skin = np.log(m/max(m[1], 1e-6))[[0, 2]]
    return dict(ill=[round(float(x), 4) for x in ill], skin=None if skin is None else [round(float(x), 4) for x in skin],
                t=None if taken is None else float(taken))


def segments(sigs, jump=0.11, k=2.6, gap=1200.0):
    """Межі зйомок: там, де освітлення між сусідніми фото змінюється стрибком,
    або між знімками минуло понад 20 хвилин (час зйомки з EXIF, якщо він є)."""
    f, t = [], []
    for g in sigs:
        a = np.array(g['skin'] if g and g.get('skin') else [0.0, 0.0])
        b = np.array(g['ill'] if g else [0.0, 0.0])*0.6
        f.append(np.concatenate([a, b]))
        t.append(g.get('t') if g else None)
    f = np.array(f)
    if len(f) < 2: return [list(range(len(f)))]
    d = np.linalg.norm(np.diff(f, axis=0), axis=1)
    thr = max(jump, k*float(np.median(d))) if len(f) >= 3 else float('inf')
    segs, cur = [], [0]
    for i, v in enumerate(d, 1):
        far = t[i] is not None and t[i-1] is not None and abs(t[i]-t[i-1]) > gap
        if v > thr or far: segs.append(cur); cur = []
        cur.append(i)
    segs.append(cur)
    return [x for x in segs if x]


def series_wb(rs, p=P):
    """Баланс білого для фото без власних свідчень (ні білих речей, ні облич) —
    від сусідніх фото тієї ж зйомки, де білі речі є.
    rs — результати analyze у порядку файлів.
    Повертає {номер: (temp, tint)} для фото, яким баланс треба змінити."""
    out = {}
    for seg in segments([r.get('sig') for r in rs]):
        donors = [i for i in seg if rs[i].get('wb_w', 0) >= p['donor_w']]
        if not donors: continue
        w = np.array([rs[i]['wb_w'] for i in donors], np.float64)
        tt = np.array([rs[i]['wb_own'][0] for i in donors]); nn = np.array([rs[i]['wb_own'][1] for i in donors])
        t, n = _agree(tt, w), _agree(nn, w)
        if np.hypot(t, n) < p['series_dead']: t = n = 0.0
        for i in seg:
            if i in donors or rs[i].get('wb_w', 0) >= p['inherit_max']: continue
            # фото з обличчями лишається зі своєю оцінкою: кожен кадр фотограф
            # поправляє окремо, і власна оцінка ближча до того, що він обирає
            if (rs[i].get('wb_info') or {}).get('skin_ab'): continue
            own = rs[i]['wb_own']
            if abs(t-own[0]) > 0.006 or abs(n-own[1]) > 0.006:
                out[i] = (round(float(t), 3), round(float(n), 3))
    return out


def _agree(v, w):
    """Спільна думка фото-«донорів» по одній осі. Трьох і більше — зважена медіана;
    двох — лише якщо обидва просять зсуву в один бік, і тоді менший з них.
    Якщо донори не згодні між собою, серії нічого не передаємо."""
    if len(v) >= 3: return _wmedian(v, w)
    if len(v) == 1: return float(v[0])
    if v[0]*v[1] <= 0: return 0.0
    return float(v[int(np.argmin(np.abs(v)))])


def _wmedian(v, w):
    """Зважена медіана; на рівній межі — середнє двох сусідніх значень."""
    o = np.argsort(v); v, c = v[o], np.cumsum(w[o]); h = c[-1]/2
    i = int(np.searchsorted(c, h))
    if abs(c[i]-h) < 1e-9 and i+1 < len(v): return float((v[i]+v[i+1])/2)
    return float(v[i])


# ------------------------------------------------------------------ відтворення
def _manual_float(r, zones):
    return bool(r.get('light') or zones or abs(r.get('shadows', 0)) > 1e-3
                or abs(r.get('highlights', 0)) > 1e-3 or abs(r.get('sat', 0)) > 1e-3)


def local_gain(Bs, r, p=P):
    """Ручні тіні й світла (EV) за великомасштабною яскравістю Bs (sRGB 0..1)."""
    a, b, c, d = p['sh_band']
    g = r.get('shadows', 0.0)*ss(Bs, a, b)*(1-ss(Bs, c, d))
    e, f = p['hl_band']
    return g-r.get('highlights', 0.0)*ss(Bs, e, f)


def zone_gain(zones, shape):
    hs, ws = shape
    yy, xx = np.mgrid[0:hs, 0:ws].astype(np.float32)
    ev = np.zeros(shape, np.float32); sat = np.zeros(shape, np.float32)
    for z in zones or []:
        x, y, w, h = z['x']*ws, z['y']*hs, z['w']*ws, z['h']*hs
        fe = float(z.get('feather', 0.3))
        if z.get('shape', 'rect') == 'ellipse':
            dd = np.sqrt(((xx-(x+w/2))/max(w/2, 1))**2+((yy-(y+h/2))/max(h/2, 1))**2)
            m = 1-ss(dd, max(1-fe, 0.05), 1.0)
        else:
            fx, fy = max(w*fe, 1), max(h*fe, 1)
            m = (ss(xx, x-fx, x+fx)*(1-ss(xx, x+w-fx, x+w+fx))
                 * ss(yy, y-fy, y+fy)*(1-ss(yy, y+h-fy, y+h+fy)))
        ev += m*float(z.get('ev', 0.0)); sat += m*float(z.get('sat', 0.0))
    return ev, sat


def _float_maps(rgb8, r, p, zones, lut_lin):
    """Повільні карти (EV і насиченість) для ручних тіней/світел, зон і вирівнювання світла."""
    H, W = rgb8.shape[:2]
    sw, sh = max(int(W*p['map_scale']), 48), max(int(H*p['map_scale']), 48)
    small = cv2.resize(rgb8, (sw, sh), interpolation=cv2.INTER_AREA)
    ev = np.zeros((sh, sw), np.float32)
    if abs(r.get('shadows', 0)) > 1e-3 or abs(r.get('highlights', 0)) > 1e-3:
        Y = np.maximum((lut_lin[0][small[..., 0]]*LUMW[0]+lut_lin[1][small[..., 1]]*LUMW[1]
                        + lut_lin[2][small[..., 2]]*LUMW[2]), 1e-5)
        Lg = np.log2(Y)
        Bs = l2s(np.exp2(guided(Lg, max(6, int(min(Lg.shape)*0.07)), 0.10)))
        ev += local_gain(Bs, r, p)
    zev, zsat = zone_gain(zones, (sh, sw))
    ev += zev
    gain = cv2.resize(np.exp2(ev), (W, H), interpolation=cv2.INTER_LINEAR) if np.abs(ev).max() > 1e-4 else None
    zs = cv2.resize(zsat, (W, H), interpolation=cv2.INTER_LINEAR) if np.abs(zsat).max() > 1e-4 else None
    return gain, zs


def _float_block(b8, y0, H, gain, zsat, r, lut_lin):
    lin = np.empty(b8.shape, np.float32)
    for c in range(3): lin[..., c] = lut_lin[c][b8[..., c]]
    lm = light_map(b8.shape[:2], r.get('light'), y0, H)
    if lm is not None: lin *= np.exp2(lm)[..., None]
    if gain is not None: lin *= gain[..., None]
    srgb = levels(l2s(lin), r)
    del lin
    s = float(r.get('sat', 0.0))
    if abs(s) > 1e-3 or zsat is not None:
        f = 1+s*(1-ss(chmax(srgb), 0.85, 0.99)) if abs(s) > 1e-3 else 1.0
        if zsat is not None: f = f+zsat
        yl = (srgb @ LUMA8)[..., None]
        srgb = yl+(srgb-yl)*np.asarray(f, np.float32)[..., None] if np.ndim(f) else yl+(srgb-yl)*f
    np.clip(srgb, 0, 1, out=srgb); srgb *= 255.0; srgb += 0.5
    return srgb.astype(np.uint8)


def render(rgb8, r, p=P, zones=None):
    """Повний кадр. Якщо потрібні лише баланс білого й рівні, кожен канал
    перераховується готовою таблицею — це майже миттєво."""
    H, W = rgb8.shape[:2]
    lut_lin, lut8 = channel_luts(r)
    if not _manual_float(r, zones):
        out = np.empty_like(rgb8)
        for c in range(3): out[..., c] = cv2.LUT(np.ascontiguousarray(rgb8[..., c]), lut8[c])
    else:
        gain, zsat = _float_maps(rgb8, r, p, zones, lut_lin)
        out = np.empty((H, W, 3), np.uint8)
        rows = max(p['tile_rows'], 32)
        for y0 in range(0, H, rows):
            y1 = min(y0+rows, H)
            out[y0:y1] = _float_block(rgb8[y0:y1], y0, H, None if gain is None else gain[y0:y1],
                                      None if zsat is None else zsat[y0:y1], r, lut_lin)
    if r.get('whites') or r.get('whites_hi'):
        small = small_for_mask(out, p).astype(np.float32)/255.0
        mk = whites_mask(small, r.get('boxes') or [], p)
        if mk is not None:
            if r.get('whites_hi'): out = protect_whites(rgb8, r, p, zones, out, mk[4])
            if r.get('whites'): out = apply_whites(out, mk, p)
    if r.get('guard') and r.get('boxes'):
        out = apply_guard(out, r['boxes'], p)
    return out


# ------------------------------------------------------------------ ручні поправки
ADJ_LIMITS = dict(ev=(-2, 2), temp=(-.5, .5), tint=(-.5, .5), shadows=(-1, 2), highlights=(-1, 2),
                  contrast=(-.5, .9), sat=(-.8, .8))


def with_adjust(r, adj, off=()):
    """Ручні поправки поверх автоматичних значень.
    white, black — у рівнях 0..255 (від'ємна біла точка робить кадр світлішим);
    mid — середні тони: додатне значення світлішає (як повзунок у «Рівнях»)."""
    r = dict(r)
    for k in off or ():
        if k == 'white': r['white'] = 255.0
        elif k == 'black': r['black'] = 0.0
        elif k == 'gamma': r['gamma'] = 1.0
        elif k in ('temp', 'tint'): r[k] = 0.0
        elif k in ('whites', 'whites_hi', 'guard'): r[k] = 0.0
        elif k == 'ev': r['ev'] = 0.0
        elif k == 'light': r['light'] = None
    if adj:
        for k, (lo, hi) in ADJ_LIMITS.items():
            if k in adj: r[k] = float(np.clip(float(r.get(k, 0))+float(adj[k]), lo, hi))
        if 'white' in adj:
            r['white'] = float(np.clip(float(r.get('white', 255))+float(adj['white']), 120, 255))
        if 'black' in adj:
            r['black'] = float(np.clip(float(r.get('black', 0))+float(adj['black']), 0, 80))
        if 'mid' in adj:
            r['gamma'] = float(np.clip(float(r.get('gamma', 1.0))-float(adj['mid']), 0.5, 1.6))
        if r['black'] > r['white']-20: r['black'] = max(r['white']-20, 0.0)
    r['changes'] = changes_of(r)
    manual = bool(adj) and any(abs(float(v)) > 1e-9 for v in adj.values())
    r['needs'] = manual or any(k in MAJOR for k in r['changes'])
    return r


def process(path_in, path_out, p=P, zones=None, off=(), adjust=None):
    from PIL import Image
    im = Image.open(path_in); icc = im.info.get('icc_profile')
    a = np.asarray(im.convert('RGB'))
    r = with_adjust(analyze(a, p, off), adjust, off)
    out = render(a, r, p, zones)
    if path_out: Image.fromarray(out).save(path_out, quality=95, subsampling=0, icc_profile=icc)
    return r
