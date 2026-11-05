from pathlib import Path
import json,zipfile,html,math
from PIL import Image,ImageOps,ImageDraw
root=Path('artifacts/redesign'); rows=json.loads((root/'screenshot-manifest.json').read_text()); inventory=json.loads((root/'route-inventory.json').read_text())
(root/'thumbnails').mkdir(exist_ok=True)
for inv in inventory:
 matches=[r for r in rows if r['route']==inv['route'] and r['role']==inv['role'] and r['state']=='default']
 if matches:
  r=matches[0];inv.update(reviewed=True,screenshotStatus=r['screenshotStatus'],browserTestStatus=r['browserTestStatus'],screenshots=r['screenshots'],limitations=r['errors']+[f'Page overflow: {d}' for d in r['overflow']])
(root/'route-inventory.json').write_text(json.dumps(inventory,indent=2))
# Separate thumbnail filenames by device to avoid collisions in the gallery.
for r in rows:
 for device,file in r['screenshots'].items():
  im=Image.open(root/file).convert('RGB');im=im.crop((0,0,im.width,min(im.height,900 if device=='desktop' else 844)));im=ImageOps.contain(im,(320,200));canvas=Image.new('RGB',(320,200),'#fafbff');canvas.paste(im,((320-im.width)//2,0));canvas.save(root/'thumbnails'/f'{device}-{Path(file).stem}.jpg',quality=80)
sheets=[]
for part in range(math.ceil(len(rows)/12)):
 subset=rows[part*12:part*12+12];sheet=Image.new('RGB',(1000,math.ceil(len(subset)/2)*266),'#fafbff');draw=ImageDraw.Draw(sheet)
 for j,r in enumerate(subset):
  x=(j%2)*500;y=(j//2)*266;label=f"{r['role']} | {r['route']} | {r['state']}";draw.text((x+8,y+8),label[:76],fill='#292d32')
  for k,device in enumerate(['desktop','mobile']):
   file=r['screenshots'].get(device)
   if file:
    im=Image.open(root/'thumbnails'/f'{device}-{Path(file).stem}.jpg');im.thumbnail((240,220));sheet.paste(im,(x+8+k*245,y+32))
  draw.text((x+8,y+240),r['browserTestStatus'],fill='#5932ea')
 name=f'contact-sheet-{part+1:02}.jpg';sheet.save(root/name,quality=85);sheets.append(name)
failed=[r for r in rows if r['browserTestStatus']!='passed'];missing=[r for r in inventory if r['screenshotStatus']!='captured']
lines=['# SoftLans Edu — skrinshotlar galereyasi','',f'{len(inventory)} route/rol yozuvi; {len(rows)} ekran holati; {sum(len(r["screenshots"]) for r in rows)} skrinshot. Brauzerda muammoli holatlar: {len(failed)}. Yetishmayotgan route/rol skrinshotlari: {len(missing)}.','', '[Desktop ZIP](screenshots-desktop.zip) · [Mobile ZIP](screenshots-mobile.zip) · [Barcha skrinshotlar ZIP](all-screenshots.zip) · [HTML galereya](gallery.html)','', '[Figma 0:3](figma-reference.png) · [Avvalgi dashboard](before-dashboard.png)','', '## Vizual indeks','']
lines += [f'[![Vizual indeks {i+1}]({s})]({s})' for i,s in enumerate(sheets)]
lines+=['','## Route va holatlar','', '| Rol | Route / holat | Desktop | Mobile | Tekshiruv |','|---|---|---|---|---|']
for r in rows:
 links=[]
 for device in ['desktop','mobile']:
  file=r['screenshots'].get(device);links.append(f'[![{device}](thumbnails/{device}-{Path(file).stem}.jpg)]({file})' if file else 'Mavjud emas')
 lines.append(f'| {r["role"]} | `{r["route"]}` · {r["state"]} | {links[0]} | {links[1]} | {r["browserTestStatus"]} |')
lines+=['','## Tekshiruv chegaralari','','Bu galereya lokal React ilovasi va haqiqiy API’dan olingan. MongoDB replica set va barcha yozuvlar bir martalik sun’iy sinov ma’lumotlari. Har bir screenshot uchun konsol xatolari va sahifa overflow tekshirildi. Pixel-perfect yoki WCAG sertifikati da’vo qilinmaydi. To‘liq foydalanuvchi oqimlari smoke-results.json va test natijalari bilan alohida qayd etilgan.']
if failed:
 lines+=['','### Qolgan muammolar','']+[f'- `{r["route"]}` ({r["role"]}, {r["state"]}): '+ '; '.join(r['errors']+[f'Overflow {d}' for d in r['overflow']]) for r in failed]
(root/'SCREENSHOT_INDEX.md').write_text('\n'.join(lines)+'\n')
checks=['# Route review checklist','']+[f'- [{"x" if r["browserTestStatus"]=="passed" else " "}] `{r["route"]}` — {r["role"]}: {r["screenshotStatus"]}, {r["browserTestStatus"]}' for r in inventory]
(root/'ROUTE_CHECKLIST.md').write_text('\n'.join(checks)+'\n')
cards=[]
for r in rows:
 images=''.join(f'<a href="{html.escape(f)}"><img loading="lazy" src="thumbnails/{d}-{Path(f).stem}.jpg" alt="{d}"></a>' for d,f in r['screenshots'].items())
 cards.append(f'<article data-role="{r["role"]}"><h2>{html.escape(r["route"])}</h2><p>{r["role"]} · {r["state"]} · {r["browserTestStatus"]}</p>{images}</article>')
(root/'gallery.html').write_text('<!doctype html><html lang="uz"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SoftLans Edu — ekranlar</title><style>body{font:15px system-ui;background:#fafbff;color:#292d32;margin:32px}h1{color:#5932ea}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,650px),1fr));gap:24px}article{padding:24px;background:white;border:1px solid #eceef5;border-radius:24px}h2{overflow-wrap:anywhere}img{max-width:47%;border:1px solid #eceef5;margin-right:8px}a{color:#5932ea}</style><h1>SoftLans Edu · Skrinshotlar</h1><p><a href="all-screenshots.zip">Barchasini yuklab olish</a> · <a href="SCREENSHOT_INDEX.md">To‘liq indeks</a></p><main>'+''.join(cards)+'</main></html>')
for device in ['desktop','mobile']:
 with zipfile.ZipFile(root/f'screenshots-{device}.zip','w',zipfile.ZIP_DEFLATED) as z:
  for p in (root/'screenshots'/device).glob('*.png'):z.write(p,p.relative_to(root))
with zipfile.ZipFile(root/'all-screenshots.zip','w',zipfile.ZIP_DEFLATED) as z:
 for p in root.rglob('*'):
  if p.is_file() and p.suffix!='.zip':z.write(p,p.relative_to(root))
print(f'{len(rows)} states, {len(failed)} failures, {len(missing)} missing; archives generated')
