"""Generate Android launcher icons for Capacitor using the committed encoded web image."""
from pathlib import Path
from PIL import Image
import sys
app=sys.argv[1]
if app not in ('client','admin'): raise SystemExit('Invalid app')
base=Image.open(Path('apps')/app/'assets'/'icon-512.png').convert('RGBA')
sizes={'mdpi':48,'hdpi':72,'xhdpi':96,'xxhdpi':144,'xxxhdpi':192}
for density,size in sizes.items():
 target=Path('android/app/src/main/res')/('mipmap-'+density)
 target.mkdir(parents=True,exist_ok=True)
 icon=base.resize((size,size),Image.Resampling.LANCZOS)
 for name in ('ic_launcher.png','ic_launcher_round.png','ic_launcher_foreground.png'):
  icon.save(target/name,optimize=True)
