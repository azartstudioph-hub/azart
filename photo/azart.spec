# Збірка самостійного застосунку: pyinstaller azart.spec
# Результат: dist/AZART/AZART.exe — Python на комп'ютері не потрібен.
# Власні модулі не можна називати як відомі бібліотеки (imageio, utils тощо):
# PyInstaller застосує до них правила тих бібліотек і збірка впаде.
# Файл сумісний і з PyInstaller 5.x, і з 6.x: шифрування байт-коду не вмикаємо,
# бо в 6.x його прибрали, і спроба його задати ламає збірку.

a = Analysis(
    ['app.py'],
    pathex=['.'],
    binaries=[],
    datas=[('ui.html', '.'), ('models/yunet2.onnx', 'models'), ('models/pphumanseg.onnx', 'models'),
           ('models/README.md', 'models'), ('README.md', '.')],
    hiddenimports=['enhance', 'runner', 'azart_io'],
    hookspath=[], runtime_hooks=[],
    excludes=['matplotlib', 'tkinter', 'scipy', 'skimage', 'pandas', 'IPython'],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name='AZART',
          debug=False, strip=False, upx=False, console=True)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name='AZART')
