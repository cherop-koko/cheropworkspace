"""Convert approved self-contained HTML into an immutable slot template + editable brief.
Usage: python prepare_template.py approved.html output.json PRODUCT_KEY
No resampling, image regeneration, or source-file overwrite.
"""
import sys,json,re,hashlib,base64
from bs4 import BeautifulSoup, NavigableString, Comment, Doctype
from pathlib import Path
src,out,key=sys.argv[1:]
asset_dir=Path(out).with_suffix('').with_name(Path(out).stem+'-assets');asset_dir.mkdir(parents=True,exist_ok=True)
s=BeautifulSoup(Path(src).read_text(),'html.parser')
assets={}; texts={}; asset_map={}
def asset(value):
 if value not in asset_map:
  name='a'+str(len(assets)).zfill(3)
  mime,data=value.split(';base64,');raw=base64.b64decode(data)
  ext={'data:image/png':'png','data:image/jpeg':'jpg','data:image/gif':'gif','data:image/webp':'webp','data:font/woff2':'woff2'}[mime]
  if raw[:4]==b'RIFF':ext='webp'
  filename=name+'.'+ext;(asset_dir/filename).write_bytes(raw)
  assets[name]='inputs/'+asset_dir.name+'/'+filename;asset_map[value]=name
 return '{{asset:'+asset_map[value]+'}}'
for img in s.select('img'):
 img['src']=asset(img['src'])
for style in s.select('style'):
 style.string=re.sub(r'data:[^\s)\"\']+',lambda m:asset(m[0]),style.get_text())
for node in list(s.find_all(string=True)):
 if isinstance(node,(Comment,Doctype)) or node.parent.name in ('style','script') or not node.strip(): continue
 name='t'+str(len(texts)).zfill(3);texts[name]=str(node);node.replace_with(NavigableString('{{text:'+name+'}}'))
for x in s.select('script'): x.decompose()
html=str(s)
# Fixed CSP prevents template JS/forms and unintended external requests when opened.
csp='<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src \'self\' data: file:; font-src \'self\' data: file:; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'">'
html=html.replace('<meta charset="utf-8"/>','<meta charset="utf-8"/>'+csp)
hash=hashlib.sha256(html.encode()).hexdigest()
bundle={'schemaVersion':1,'productKey':key,'template':{'id':'approved-'+hash[:16],'sha256':hash,'html':html},'texts':texts,'assets':assets,'evidence':{'productConfirmed':False,'assetsConfirmed':False,'kcConfirmed':False,'source':'','reviewer':''}}
Path(out).write_text(json.dumps(bundle,ensure_ascii=False))
Path(out+'.manifest.json').write_text(json.dumps({'templateId':bundle['template']['id'],'sha256':hash,'texts':texts,'assets':list(assets),'source':src},ensure_ascii=False,indent=2))
print(json.dumps({'sha256':hash,'texts':len(texts),'assets':len(assets),'bytes':Path(out).stat().st_size}))
