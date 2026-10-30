import asyncio,copy,hashlib,importlib.util,json,os,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('worker',Path(__file__).with_name('worker.py'));w=importlib.util.module_from_spec(spec);spec.loader.exec_module(w)
def brief():
 t='<html><head></head><body>{{text:title}} {{text:size}}<img src="{{asset:hero}}"></body></html>'
 return {'schemaVersion':2,'productKey':'K02','productName':'몽모 50cm','template':{'html':t,'sha256':hashlib.sha256(t.encode()).hexdigest()},'facts':{'size':'50cm'},'sources':['https://cherop.com/all/?idx=101'],'texts':{'title':'몽모','size':'50cm'},'lockedTextKeys':['size'],'assetCatalog':{'photo':{'productKey':'K02','url':'https://cdn.imweb.me/test.png'}}}
def plan(): return {'texts':{'title':'곁에 두는 몽모','size':'50cm'},'assets':{'hero':'photo'},'issues':[]}
class Tests(unittest.TestCase):
 def test_template_tampering(self):
  b=brief();b['template']['html']+='changed'
  with self.assertRaises(w.Blocked):w.validate_brief(b)
 def test_locked_facts(self):
  p=plan();p['texts']['size']='30cm'
  with self.assertRaises(w.Blocked):w.assemble(brief(),p,{'photo':'data:image/png;base64,AA=='})
 def test_no_new_safety_claim(self):
  p=plan();p['texts']['title']='신생아 사용 가능'
  with self.assertRaises(w.Blocked):w.assemble(brief(),p,{'photo':'x'})
 def test_text_escaped(self):
  p=plan();p['texts']['title']='<script>alert(1)</script>'
  self.assertNotIn('<script>',w.assemble(brief(),p,{'photo':'data:image/png;base64,AA=='}))
 def test_ssrf(self):
  for url in ['http://cherop.com','https://127.0.0.1/','https://cherop.com@evil.test/','https://cherop.com:444/']:
   with self.assertRaises(w.Blocked):w.read_url(url,{'cherop.com'})
 def test_missing_settings_blocks(self):
  with patch.dict(os.environ,{},clear=True),tempfile.TemporaryDirectory() as d:
   with self.assertRaises(w.Blocked):asyncio.run(w.run(brief(),Path(d)))
 def exercise(self,reviews):
  async def capture(text,out,revision):
   paths=[]
   for width in (360,390,430):
    p=out/f'r{revision}-{width}-0.png';p.write_bytes(b'fixture');paths.append(p)
   return paths,[]
  def fake_model(content,schema):
   if 'texts' in schema['properties']:return plan(),{}
   return reviews.pop(0),{}
  def source(url,*args):return (b'<html>50cm</html>','text/html') if 'cherop.com' in url else (b'fixture','image/png')
  with tempfile.TemporaryDirectory() as d,patch.dict(os.environ,{'OPENAI_API_KEY':'test','CHEROP_TEXT_MODEL':'test'}),patch.object(w,'model_call',fake_model),patch.object(w,'capture',capture),patch.object(w,'read_url',source):
   result=asyncio.run(w.run(brief(),Path(d)))
   self.assertEqual((Path(d)/'index.html').exists(),result['status']=='review')
   self.assertFalse(result['previewPublished'])
   return result
 def test_pass_is_review_not_approved(self):
  r=self.exercise([{'pass':True,'issues':[]} for _ in range(3)])
  self.assertEqual(r['status'],'review');self.assertEqual(r['revision'],0)
 def test_repair_then_recheck(self):
  r=self.exercise([{'pass':False,'issues':['사진 잘림']} for _ in range(3)]+[{'pass':True,'issues':[]} for _ in range(3)])
  self.assertEqual(r['revision'],1);self.assertEqual(r['visualReview'],'passed')
 def test_three_failures_block(self):
  r=self.exercise([{'pass':False,'issues':['사진 잘림']} for _ in range(9)])
  self.assertEqual(r['status'],'blocked');self.assertEqual(r['revision'],2)
if __name__=='__main__':unittest.main()
