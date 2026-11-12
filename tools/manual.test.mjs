import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {loadManual, selectEntries, navigation, contents, headings, anchors, validateManual, pdfLink, reconcilePageNumbers} from './manual.mjs';

function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'orchestron-manual-test-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const manifest={version:1,root:{path:'intro.md',children:[{path:'design.md',children:[{path:'graph.md'}]},{path:'perform.md'}]},excluded:[{path:'developer.md',reason:'Developer procedures'}]};
  const writeManifest=()=>fs.writeFileSync(path.join(root,'manual.json'),JSON.stringify(manifest));
  writeManifest();
  for (const name of ['intro','design','graph','perform','developer']) fs.writeFileSync(path.join(root,name+'.md'),'# '+name+'\n\nBody\n');
  let manual=loadManual(root);
  for(const entry of manual.entries) fs.writeFileSync(entry.file,`# ${entry.title}\n\n${navigation(manual,entry)}\n\n${entry.children.length?contents(entry)+'\n\n':''}Body\n\n${navigation(manual,entry)}\n`);
  return {root,manifest,writeManifest,load:()=>loadManual(root)};
}

test('manifest determines hierarchy and cross-links cannot reorder or add pages',t=>{
 const f=fixture(t);const before=f.load();
 fs.appendFileSync(path.join(f.root,'graph.md'),'\n[other](perform.md) [developer](developer.md) [cycle](intro.md)\n');
 const after=f.load();
 assert.deepEqual(after.entries.map(e=>[e.path,e.parent?.path,e.depth]),before.entries.map(e=>[e.path,e.parent?.path,e.depth]));
 assert.deepEqual(selectEntries(after,path.join(f.root,'design.md')).map(e=>e.path),['design.md','graph.md']);
 assert.throws(()=>selectEntries(after,path.join(f.root,'developer.md')),/not a declared/);
});
test('duplicate ownership and duplicate exclusion fail',t=>{
 const f=fixture(t);f.manifest.root.children.push({path:'graph.md'});f.writeManifest();assert.throws(f.load,/Duplicate/);
 f.manifest.root.children.pop();f.manifest.excluded.push({path:'design.md',reason:'duplicate'});f.writeManifest();assert.throws(f.load,/Duplicate/);
});
test('an alias cannot give a physical file two owners', t => {
 const f = fixture(t);
 fs.symlinkSync(path.join(f.root, 'graph.md'), path.join(f.root, 'alias.md'));
 f.manifest.root.children.push({path: 'alias.md'});
 f.writeManifest();
 assert.throws(f.load, /Duplicate manual ownership/);
});
test('missing, escaping and unclassified files fail',t=>{
 const f=fixture(t);f.manifest.root.children.push({path:'missing.md'});f.writeManifest();assert.throws(f.load,/Missing/);
 f.manifest.root.children.at(-1).path='../outside.md';f.writeManifest();assert.throws(f.load,/escapes/);
 f.manifest.root.children.pop();f.writeManifest();fs.writeFileSync(path.join(f.root,'orphan.md'),'# Orphan\n');assert.throws(f.load,/Unclassified/);
});
test('symlink escape and reasonless exclusions fail',t=>{
 const f=fixture(t);fs.unlinkSync(path.join(f.root,'graph.md'));fs.symlinkSync(import.meta.filename,path.join(f.root,'graph.md'));assert.throws(f.load,/symlink escapes/);
 fs.unlinkSync(path.join(f.root,'graph.md'));fs.writeFileSync(path.join(f.root,'graph.md'),'# Graph\n');f.manifest.excluded[0].reason='';f.writeManifest();assert.throws(f.load,/reason/);
});
test('navigation, contents, local files, anchors and prohibited headings are validated',t=>{
 const f=fixture(t);assert.doesNotThrow(()=>validateManual(f.load()));
 const file=path.join(f.root,'graph.md');const original=fs.readFileSync(file,'utf8');
 for(const [content,error] of [[original.replace('[Up](design.md)','[Up](perform.md)'),/navigation/],[original.replace('Body','[bad](missing.png)'),/missing local/],[original.replace('Body','[bad](design.md#missing)'),/missing heading/],[original.replace('Body','## Screenshot'),/prohibited/]]){
  fs.writeFileSync(file,content);assert.throws(()=>validateManual(f.load()),error);
 }
 fs.writeFileSync(file,original);const index=path.join(f.root,'design.md');fs.writeFileSync(index,fs.readFileSync(index,'utf8').replace('- [graph](graph.md)','- [wrong](graph.md)'));assert.throws(()=>validateManual(f.load()),/contents/);
});
test('heading anchors support formatting, repeated headings and aliases but exclude code',()=>{
 const md='# Guide\n\n## **Sound**\n\n## Sound\n\n<a id="old"></a>\n\n```\n## Code\n```';
 assert.deepEqual(headings(md).map(h=>h.slug),['guide','sound','sound-1']);
 assert.deepEqual([...anchors(md)],['guide','sound','sound-1','old']);
 assert.deepEqual([...anchors('```html\n<a id="not-a-destination"></a>\n```')], []);
 assert.deepEqual(headings('# Reference\n\n## `control_flow`\n\n## _Title_').map(h=>h.slug),['reference','control_flow','title']);
});

test('the real manual owns each reported topic under the agreed chapter', () => {
 const manual = loadManual(path.resolve(import.meta.dirname, '../documentation'));
 const parents = new Map(manual.entries.map(entry => [entry.path, entry.parent?.path]));
 for (const page of ['configuration/midi_setup_and_inputs.md', ...['live_status_and_safety_controls', 'multitrack_arranger', 'instrument_automation', 'score_sequencers', 'sequencer_timing'].map(name => `performance/${name}.md`)]) {
  assert.equal(parents.get(page), 'performance/performance.md', page);
 }
 for (const name of ['supported_opcodes', 'input_formula_assistant', 'control_flow', 'midi_legato', 'opcode_catalog_and_documentation', 'graph_editor', 'gen_table_editor', 'performance_controls']) {
  assert.equal(parents.get(`instrument_design/${name}.md`), 'instrument_design/instrument_design.md', name);
 }
 for (const name of ['steel_string_waveguide', 'ambient_techno', 'hsb_mono', 'enough_and_logan', 'goa_trance_fm_lead']) {
  assert.equal(parents.get(`instrument_design/${name}.md`), 'supplied/instruments.md', name);
 }
 assert.equal(parents.get('performance/standard_effects.md'), 'supplied/supplied.md');
 assert.deepEqual(manual.excluded.map(entry => entry.path), ['docker_images.md']);
 assert.ok(manual.entries.findIndex(entry => entry.path === 'instrument_design/instrument_design.md') < manual.entries.findIndex(entry => entry.path === 'performance/performance.md'));
});

test('outline reconciliation identifies nested pages and repeated titles in full heading order',()=>{
 const xml='<item title="Cover" page="1"><item title="Chapter" page="4"><item title="Controls" page="4"/><item title="Guide &amp; details" page="6"><item title="Controls" page="7"/></item></item></item>';
 const files=[{outlineHeadings:['Chapter','Controls']},{outlineHeadings:['Guide & details','Controls']}];
 assert.deepEqual(reconcilePageNumbers(xml,files,4),[4,6]);
 assert.throws(()=>reconcilePageNumbers(xml,files.slice(0,1),4),/headings; expected/);
 assert.throws(()=>reconcilePageNumbers(xml,[{outlineHeadings:['Chapter','Wrong','Guide & details','Controls']}],4),/heading mismatch/);
});
test('PDF links retain same-page and cross-page fragments and reject missing anchors',()=>{
 const root='/manual';const pages=new Map([[root+'/a.md','doc-a'],[root+'/b.md','doc-b']]);const hs=new Map([[root+'/a.md',new Set(['same'])],[root+'/b.md',new Set(['sound','sound-1'])]]);
 const resolve=(href)=>pdfLink(href,root+'/a.md',pages,hs,(file,fragment)=>'repo:'+file+'#'+fragment);
 assert.equal(resolve('#same'),'#doc-a-same');assert.equal(resolve('b.md#sound-1'),'#doc-b-sound-1');assert.equal(resolve('b.md'),'#doc-b-sound');
 assert.throws(()=>resolve('b.md#missing'),/Missing PDF heading/);
 assert.equal(resolve('other.md#detail'),'repo:/manual/other.md#detail');assert.equal(resolve('https://example.com'),'https://example.com');
});
