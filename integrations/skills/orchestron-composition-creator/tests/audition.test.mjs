// Uses the repository's existing jsdom dependency; no browser runtime is bundled with the skill.
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import assert from "node:assert/strict";
import {test} from "node:test";
const require = createRequire(new URL("../../../../frontend/package.json", import.meta.url));
const {JSDOM} = require("jsdom");
const asset = name => readFileSync(new URL(`../assets/${name}`, import.meta.url), "utf8");
const tick = () => new Promise(resolve => setTimeout(resolve, 15));
const score = {title:"Hybrid",meter:[6,8],length_qn:"6",parts:[{events:[{pitch_midi:62,onset_qn:"0",duration_qn:"1",velocity:90}]}]};
const candidate = {id:"hybrid",kind:"answer",score,review:{decision:"pending",feedback:"",locks:[]}};
const malicious = '<img src=x onerror="window.injected=true">';
const history = {
  version:1, roots:["hybrid"], assembly:[],
  nodes:[
    {id:"original",title:"Original",steps:[],sources:[],gap:"Not recorded",meter:[6,8]},
    {id:"rhythm",title:"Rhythm",steps:[],sources:[],meter:[6,8]},
    {id:"hybrid",title:"Hybrid",meter:[6,8],origin:"supplied",sources:[
      {candidate_id:"original",role:"pitch",review:{feedback:"Keep opening"}},
      {candidate_id:"rhythm",role:"rhythm",review:{decision:"keep"}}],steps:[
      {function:"arvo.transformations.scalar_transposition",description:malicious,evidence:"captured",parameters:{steps:2,in_place:false},inputs:[62,64],output:[65,67]},
      {function:"orchestron.restore_locks",description:"Preserve opening",evidence:"captured",parameters:{locks:[{start_qn:"0",end_qn:"3"}],protected_silence:[{start_qn:"1",end_qn:"3"}]},inputs:[],output:[]}
    ]}
  ]
};
async function setup(item = candidate) {
  const dom = new JSDOM(asset("audition.html"), {url:"http://127.0.0.1:8123/",runScripts:"outside-only"});
  const {window} = dom, requests = [];
  window.structuredClone = structuredClone;
  window.HTMLMediaElement.prototype.pause = function(){this.dataset.playing="false";};
  window.HTMLMediaElement.prototype.play = function(){this.dataset.playing="true";};
  window.fetch = async url => {
    requests.push(url);
    return {ok:true,json:async()=>structuredClone(url.startsWith("/api/trace/") ? history : {
      revision:1,brief:{title:"Test",key:"D",mode:"dorian",tempo:108,meter:[6,8]},
      rounds:[{ids:["hybrid"]}],candidates:{hybrid:item}
    })};
  };
  window.eval(asset("trace.js")); window.eval(asset("audition.js"));
  await tick();
  return {dom,window,document:window.document,requests};
}
test("comparison cards have localized labels and retain their protected opening", async () => {
  const kinds = ["ending_settled", "ending_suspended", "ending_peak", "ending_space", "harmony_1", "harmony_2"];
  for (const kind of kinds) {
    const {dom,window,document} = await setup({...candidate,kind,review:{...candidate.review,locks:[{start_qn:"0",end_qn:"4"}]}});
    try {
      const labels = [];
      for (const language of ["en","de","fr","es"]) {
        const select=document.querySelector("#language");select.value=language;select.dispatchEvent(new window.Event("change"));
        const title=document.querySelector(".card h2").textContent;
        assert.notEqual(title,kind);assert.ok(title.length > 0);labels.push(title);
        assert.equal(document.querySelector("audio").getAttribute("aria-label"),title);
        assert.equal(document.querySelector(".field input").value,"0:4");
      }
      assert.equal(new Set(labels).size,4);
    } finally {dom.window.close();}
  }
});
test("history loads on expansion without disrupting playback or unsaved reviews", async () => {
  const {dom,window,document,requests} = await setup();
  try {
    const details = document.querySelector(".creation-trace");
    assert.equal(details.tagName,"DETAILS"); assert.equal(details.open,false);
    assert.deepEqual(requests,["/api/session"]);
    const audio = document.querySelector("audio"), feedback = document.querySelector("textarea");
    audio.play(); feedback.value="My unsaved feedback"; feedback.dispatchEvent(new window.Event("input"));
    details.open=true; await tick();
    assert.deepEqual(requests,["/api/session","/api/trace/hybrid"]);
    assert.equal(document.querySelector("audio"),audio); assert.equal(audio.dataset.playing,"true");
    assert.equal(document.querySelector("textarea"),feedback); assert.equal(feedback.value,"My unsaved feedback");
    assert.match(document.querySelector(".card-status").textContent,/Unsaved/);
    assert.deepEqual([...details.querySelectorAll("h3")].map(n=>n.textContent),["Original","Rhythm","Hybrid"]);
    assert.match(details.textContent,/Incomplete history/);
    assert.match(details.textContent,/Pitch \/ primary parent: Original/);
    assert.match(details.textContent,/Rhythm source: Rhythm/);
    assert.match(details.textContent,/Measure 1, beat 1 → Measure 2, beat 1 \(0:3 qn\)/);
    assert.match(details.textContent,/Saved locks for future development/);
    const data = [...details.querySelectorAll(".trace-data")].find(n=>n.querySelector("summary").textContent==="Parameters");
    data.open=true; assert.match(data.querySelector("pre").textContent,/"in_place": false/);
    assert.ok(details.textContent.includes(malicious)); assert.equal(details.querySelector("img"),null);
    assert.equal(window.injected,undefined);
    assert.equal(details.querySelector("a").getAttribute("download"),"hybrid-history.json");
    details.open=false; await tick(); details.open=true; await tick();
    assert.equal(requests.filter(r=>r.startsWith("/api/trace/")).length,1);
  } finally { dom.window.close(); }
});
test("history labels follow all four supported languages", async () => {
  const {dom,window,document} = await setup();
  try {
    for (const [language,title] of Object.entries({en:"How this melody was created",de:"So entstand diese Melodie",fr:"Comment cette mélodie a été créée",es:"Cómo se creó esta melodía"})) {
      const select=document.querySelector("#language"); select.value=language; select.dispatchEvent(new window.Event("change"));
      const details=document.querySelector(".creation-trace"); assert.equal(details.firstChild.textContent,title);
      details.open=true; await tick(); assert.equal(details.querySelectorAll("h3").length,3);
      assert.ok(!details.textContent.includes("undefined"));
    }
  } finally { dom.window.close(); }
});
test("a failed history request can be retried without losing edits", async () => {
  const {dom,window,document} = await setup();
  try {
    let attempts=0;
    window.fetch=async()=>({ok:++attempts>1,json:async()=>attempts>1?history:{error:"Missing creation history candidate: absent"}});
    const details=document.querySelector(".creation-trace"); details.open=true; await tick();
    assert.match(details.textContent,/Missing creation history candidate: absent/);
    details.open=false; await tick(); details.open=true; await tick();
    assert.equal(details.querySelectorAll("h3").length,3);
  } finally { dom.window.close(); }
});
test("saving a review updates future locks without replacing the historical steps", async () => {
  const {dom,window,document} = await setup();
  try {
    const details=document.querySelector(".creation-trace"); details.open=true; await tick();
    const step=details.querySelector(".trace-step"); step.open=true;
    const historical=details.querySelector(".trace-steps");
    document.querySelector('.field input').value="0:1";
    window.fetch=async()=>({ok:true,json:async()=>({revision:2})});
    document.querySelector(".save").click(); await tick();
    assert.match(details.querySelector(".trace-ranges").textContent,/0:1 qn/);
    assert.equal(details.querySelector(".trace-steps"),historical);
    assert.equal(step.open,true);
    assert.match(details.textContent,/0:3 qn/);
  } finally { dom.window.close(); }
});
