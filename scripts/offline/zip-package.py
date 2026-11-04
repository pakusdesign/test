"""Zip a prepared offline package. Keep Unix executable bits for start.command and tools."""

import sys
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

root = Path(sys.argv[1]).resolve()
destination = Path(sys.argv[2]).resolve()
with ZipFile(destination, 'w', compression=ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:
    for item in sorted(root.rglob('*')):
        if item.is_dir() or item.is_file():
            archive.write(item, item.relative_to(root.parent))
print(f'{destination}: {destination.stat().st_size} bytes')
if destination.stat().st_size >= 2_000_000_000:
    raise SystemExit('GitHub Release принимает файлы меньше 2 ГиБ; пакет нужно разделить.')
