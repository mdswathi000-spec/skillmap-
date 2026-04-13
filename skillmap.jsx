import { useState, useRef, useCallback, useEffect } from "react";

const DEFAULT_SKILLS = ["python","java","c++","javascript","typescript","html","css","react","vue","angular","node.js","mongodb","mysql","postgresql","aws","azure","gcp","docker","kubernetes","git","sql","rest api","graphql","machine learning","data analytics","linux","django","flask","spring boot","redis"];

const SKILL_CATEGORIES = {
  "Frontend": ["html","css","javascript","typescript","react","vue","angular"],
  "Backend": ["python","java","c++","node.js","django","flask","spring boot","rest api","graphql"],
  "Database": ["sql","mongodb","mysql","postgresql","redis"],
  "DevOps / Cloud": ["aws","azure","gcp","docker","kubernetes","git","linux"],
  "Data / AI": ["machine learning","data analytics"],
};

const PRIORITY_MAP = {
  "python":5,"javascript":5,"react":5,"sql":5,"git":5,
  "typescript":4,"docker":4,"aws":4,"node.js":4,
  "java":4,"mongodb":4,"postgresql":4,
  "machine learning":3,"kubernetes":3,"vue":3,
};

function getPriority(skill) { return PRIORITY_MAP[skill.toLowerCase()] || 2; }

function getYTLink(skill) {
  return `https://www.youtube.com/results?search_query=learn+${encodeURIComponent(skill)}+tutorial+2024`;
}
function getRoadmapLink(skill) {
  return `https://roadmap.sh/search?q=${encodeURIComponent(skill)}`;
}

// ── tiny colour helpers ─────────────────────────────────────────────────────
const CATEGORY_COLORS = {
  "Frontend":       { bg:"rgba(251,191,36,0.10)",  border:"rgba(251,191,36,0.30)",  text:"#fbbf24" },
  "Backend":        { bg:"rgba(96,165,250,0.10)",   border:"rgba(96,165,250,0.30)",  text:"#60a5fa" },
  "Database":       { bg:"rgba(167,139,250,0.10)",  border:"rgba(167,139,250,0.30)", text:"#a78bfa" },
  "DevOps / Cloud": { bg:"rgba(52,211,153,0.10)",   border:"rgba(52,211,153,0.30)",  text:"#34d399" },
  "Data / AI":      { bg:"rgba(251,113,133,0.10)",  border:"rgba(251,113,133,0.30)", text:"#fb7185" },
  "Other":          { bg:"rgba(148,163,184,0.10)",  border:"rgba(148,163,184,0.25)", text:"#94a3b8" },
};
function catOf(skill) {
  for (const [cat, list] of Object.entries(SKILL_CATEGORIES))
    if (list.includes(skill.toLowerCase())) return cat;
  return "Other";
}
function colOf(skill) { return CATEGORY_COLORS[catOf(skill)]; }

// ── extract text from PDF via PDF.js (loaded from CDN) ─────────────────────
async function extractPdfText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const pdfjsLib = window["pdfjs-dist/build/pdf"];
        if (!pdfjsLib) throw new Error("PDF.js not loaded");
        pdfjsLib.GlobalWorkerOptions.workerSrc =
          "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        const pdf = await pdfjsLib.getDocument({ data: e.target.result }).promise;
        let text = "";
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          text += content.items.map((s) => s.str).join(" ") + "\n";
        }
        resolve(text);
      } catch (err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

// ── Claude API call (uses artifact proxy – no CORS, no key needed) ──────────
async function callClaude(messages, onChunk) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      stream: true,
      messages,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API ${res.status}: ${err}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const raw = line.slice(6).trim();
      if (raw === "[DONE]") return;
      try {
        const j = JSON.parse(raw);
        if (j.delta?.text) onChunk(j.delta.text);
      } catch {}
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════
export default function SkillMap() {
  const [page, setPage]             = useState("upload"); // upload | results
  const [skills, setSkills]         = useState(DEFAULT_SKILLS);
  const [newSkill, setNewSkill]     = useState("");
  const [file, setFile]             = useState(null);
  const [dragging, setDragging]     = useState(false);
  const [loading, setLoading]       = useState(false);
  const [loadMsg, setLoadMsg]       = useState("");
  const [error, setError]           = useState("");
  const [results, setResults]       = useState(null);
  const [aiText, setAiText]         = useState("");
  const [aiDone, setAiDone]         = useState(false);
  const [activeTab, setActiveTab]   = useState("overview");
  const [filterCat, setFilterCat]   = useState("All");
  const [resumeText, setResumeText] = useState("");
  const [showRaw, setShowRaw]       = useState(false);
  const fileRef = useRef();

  // load PDF.js once
  useEffect(() => {
    if (!window["pdfjs-dist/build/pdf"]) {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
      document.head.appendChild(s);
    }
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f?.type === "application/pdf") setFile(f);
    else setError("Please drop a PDF file.");
  }, []);

  const addSkill = () => {
    const v = newSkill.trim().toLowerCase();
    if (v && !skills.includes(v)) { setSkills(s => [...s, v]); }
    setNewSkill("");
  };
  const removeSkill = (s) => setSkills(prev => prev.filter(x => x !== s));

  const analyze = async () => {
    if (!file || !skills.length) return;
    setError(""); setLoading(true); setAiText(""); setAiDone(false);

    try {
      setLoadMsg("📄 Extracting text from PDF…");
      const text = await extractPdfText(file);
      setResumeText(text);
      const lower = text.toLowerCase();

      setLoadMsg("🔍 Detecting skill gaps…");
      const found   = skills.filter(s => lower.includes(s));
      const missing = skills.filter(s => !lower.includes(s))
                            .sort((a,b) => getPriority(b) - getPriority(a));
      const score   = Math.round((found.length / skills.length) * 100);

      // categorised breakdown
      const cats = {};
      for (const [cat, list] of Object.entries(SKILL_CATEGORIES)) {
        const f = list.filter(s => skills.includes(s) && found.includes(s));
        const m = list.filter(s => skills.includes(s) && missing.includes(s));
        if (f.length || m.length) cats[cat] = { found: f, missing: m };
      }
      // others
      const knownSkills = Object.values(SKILL_CATEGORIES).flat();
      const otherFound   = found.filter(s => !knownSkills.includes(s));
      const otherMissing = missing.filter(s => !knownSkills.includes(s));
      if (otherFound.length || otherMissing.length)
        cats["Other"] = { found: otherFound, missing: otherMissing };

      setResults({ found, missing, score, cats, totalSkills: skills.length });
      setLoading(false);
      setPage("results");

      // stream AI coach
      setLoadMsg("");
      setAiText("");
      const prompt = `You are an expert tech career coach. Analyze this resume gap report and give personalized, honest, actionable advice.

Resume snippet (first 1500 chars): ${text.substring(0,1500)}

Skill Gap Report:
• Skills FOUND (${found.length}): ${found.join(", ") || "none"}
• Skills MISSING (${missing.length}): ${missing.join(", ") || "none"}  
• Overall match score: ${score}%

Write 5–7 sentences covering:
1. A genuine assessment of their current skill profile
2. The TOP 3 missing skills to focus on first (and why each matters in the job market)
3. One concrete 30-day learning plan step
4. Career path suggestion based on their existing skills
5. Encouragement

Be specific, warm and direct. No bullet points — flowing paragraphs only.`;

      await callClaude([{ role:"user", content: prompt }], (chunk) => {
        setAiText(prev => prev + chunk);
      });
      setAiDone(true);

    } catch (err) {
      setLoading(false);
      setError("Error: " + err.message);
    }
  };

  const reset = () => {
    setPage("upload"); setFile(null); setResults(null);
    setAiText(""); setAiDone(false); setError(""); setResumeText("");
    setActiveTab("overview"); setFilterCat("All");
  };

  // ── RENDER ────────────────────────────────────────────────────────────────
  return (
    <div style={S.root}>
      {/* animated background */}
      <div style={S.bg}>
        <div style={{...S.orb, width:600,height:600,background:"#7c3aed",top:-200,left:-200,animationDelay:"0s"}}/>
        <div style={{...S.orb, width:500,height:500,background:"#0891b2",bottom:-150,right:-150,animationDelay:"-7s"}}/>
        <div style={{...S.orb, width:350,height:350,background:"#059669",top:"40%",left:"45%",animationDelay:"-14s"}}/>
      </div>

      <div style={S.wrap}>
        {page === "upload" ? (
          <UploadPage
            file={file} setFile={setFile} dragging={dragging}
            setDragging={setDragging} handleDrop={handleDrop}
            skills={skills} newSkill={newSkill} setNewSkill={setNewSkill}
            addSkill={addSkill} removeSkill={removeSkill}
            analyze={analyze} loading={loading} loadMsg={loadMsg}
            error={error} fileRef={fileRef}
          />
        ) : (
          <ResultsPage
            results={results} aiText={aiText} aiDone={aiDone}
            activeTab={activeTab} setActiveTab={setActiveTab}
            filterCat={filterCat} setFilterCat={setFilterCat}
            resumeText={resumeText} showRaw={showRaw} setShowRaw={setShowRaw}
            fileName={file?.name} reset={reset}
          />
        )}
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Clash+Display:wght@500;600;700&family=Cabinet+Grotesk:wght@300;400;500;700;800&family=JetBrains+Mono:wght@400;500&display=swap');
        @keyframes drift{0%{transform:translate(0,0) scale(1)}100%{transform:translate(50px,40px) scale(1.15)}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:translateY(0)}}
        @keyframes blink{50%{opacity:0}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
        .fadeUp{animation:fadeUp 0.5s ease both}
        .cursor::after{content:"▌";animation:blink 0.7s infinite;color:#7c3aed}
        ::-webkit-scrollbar{width:6px;height:6px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:#334155;border-radius:3px}
      `}</style>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  UPLOAD PAGE
// ═══════════════════════════════════════════════════════════════════════════
function UploadPage({ file, setFile, dragging, setDragging, handleDrop,
  skills, newSkill, setNewSkill, addSkill, removeSkill,
  analyze, loading, loadMsg, error, fileRef }) {

  return (
    <div className="fadeUp" style={{maxWidth:720,margin:"0 auto",padding:"40px 0 80px"}}>
      {/* Header */}
      <div style={{textAlign:"center",marginBottom:48}}>
        <div style={S.logoRow}>
          <span style={S.logoIcon}>⬡</span>
          <span style={S.logoText}>SkillMap</span>
        </div>
        <h1 style={S.h1}>Know Your Gaps.<br/><span style={S.gradient}>Get Hired Faster.</span></h1>
        <p style={S.sub}>Drop your resume. Our AI maps every skill gap and builds your learning roadmap.</p>
      </div>

      {/* Step 1 – Upload */}
      <div style={S.card}>
        <Label>Step 1 — Resume PDF</Label>
        <div
          style={{...S.dropZone, ...(dragging?S.dropZoneActive:{}), ...(file?S.dropZoneDone:{})}}
          onDragOver={e=>{e.preventDefault();setDragging(true)}}
          onDragLeave={()=>setDragging(false)}
          onDrop={handleDrop}
          onClick={()=>fileRef.current?.click()}
        >
          <input ref={fileRef} type="file" accept=".pdf" style={{display:"none"}}
            onChange={e=>{ if(e.target.files[0]) setFile(e.target.files[0]); }} />
          {file ? (
            <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap",justifyContent:"center"}}>
              <span style={{fontSize:32}}>✅</span>
              <div>
                <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:13,color:"#a78bfa"}}>{file.name}</div>
                <div style={{fontSize:12,color:"#64748b",marginTop:2}}>{(file.size/1024).toFixed(1)} KB</div>
              </div>
              <button style={S.btnXs} onClick={e=>{e.stopPropagation();setFile(null);}}>✕ Remove</button>
            </div>
          ) : (
            <>
              <div style={{fontSize:40,marginBottom:10}}>📄</div>
              <div style={{fontWeight:600,fontSize:15,marginBottom:4}}>Drop your PDF here</div>
              <div style={{color:"#64748b",fontSize:13}}>or click to browse</div>
            </>
          )}
        </div>
      </div>

      {/* Step 2 – Skills */}
      <div style={S.card}>
        <Label>Step 2 — Skills to Benchmark</Label>
        <div style={{display:"flex",gap:8,marginBottom:14}}>
          <input
            style={S.input} placeholder="Add custom skill (e.g. fastapi, rust…)"
            value={newSkill} onChange={e=>setNewSkill(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&addSkill()}
          />
          <button style={S.btnAdd} onClick={addSkill}>+ Add</button>
        </div>
        {/* category quick-add */}
        <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:14}}>
          {Object.entries(SKILL_CATEGORIES).map(([cat,list])=>(
            <button key={cat} style={S.btnCat}
              onClick={()=>{
                const toAdd = list.filter(s=>!skills.includes(s));
                if(toAdd.length) skills.push(...toAdd), setNewSkill(""); /* trigger re-render */
                /* use functional update: */
              }}
              title={`Add all ${cat} skills`}
            >+{cat}</button>
          ))}
        </div>
        <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
          {skills.map(s=>{
            const c = colOf(s);
            return (
              <span key={s} style={{...S.chip,background:c.bg,borderColor:c.border,color:c.text}}>
                {s}
                <span style={{cursor:"pointer",opacity:0.6,marginLeft:4}} onClick={()=>removeSkill(s)}>×</span>
              </span>
            );
          })}
        </div>
        <div style={{marginTop:10,fontSize:12,color:"#475569"}}>{skills.length} skills selected</div>
      </div>

      {error && <div style={S.errorBox}>{error}</div>}

      {loading ? (
        <div style={S.loadBox}>
          <div style={S.spinner}/>
          <div style={{color:"#94a3b8",fontSize:14}}>{loadMsg}</div>
        </div>
      ) : (
        <button style={{...S.btnMain,...(!file||!skills.length?S.btnDisabled:{})}}
          onClick={analyze} disabled={!file||!skills.length}>
          ✦ &nbsp;Analyze My Resume
        </button>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  RESULTS PAGE
// ═══════════════════════════════════════════════════════════════════════════
function ResultsPage({ results, aiText, aiDone, activeTab, setActiveTab,
  filterCat, setFilterCat, resumeText, showRaw, setShowRaw, fileName, reset }) {

  const { found, missing, score, cats, totalSkills } = results;
  const tabs = ["overview","roadmap","breakdown","raw"];

  // filtered missing for roadmap
  const cats2 = filterCat==="All" ? Object.keys(cats)
               : cats[filterCat] ? [filterCat] : [];

  return (
    <div className="fadeUp" style={{maxWidth:860,margin:"0 auto",padding:"32px 0 80px"}}>
      {/* Top bar */}
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:32,flexWrap:"wrap"}}>
        <button style={S.btnBack} onClick={reset}>← New Analysis</button>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:"#475569",marginBottom:2}}>{fileName}</div>
          <div style={{fontFamily:"'Clash Display',sans-serif",fontSize:20,fontWeight:700}}>Resume Gap Report</div>
        </div>
        <ScoreBadge score={score}/>
      </div>

      {/* Stat row */}
      <div style={S.statRow}>
        <StatCard num={found.length}   label="Skills Found"   color="#34d399" icon="✓"/>
        <StatCard num={missing.length} label="Skills Missing" color="#f87171" icon="✗"/>
        <StatCard num={totalSkills}    label="Total Checked"  color="#60a5fa" icon="⬡"/>
        <StatCard num={`${score}%`}    label="Match Rate"     color="#a78bfa" icon="◉"/>
      </div>

      {/* Progress bar */}
      <div style={S.progressWrap}>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:12,color:"#64748b",marginBottom:8}}>
          <span>Skill coverage</span><span style={{fontFamily:"'JetBrains Mono',monospace"}}>{found.length}/{totalSkills}</span>
        </div>
        <div style={S.progressTrack}>
          <div style={{...S.progressFill,width:`${score}%`}}/>
        </div>
        <div style={{display:"flex",gap:4,flexWrap:"wrap",marginTop:8}}>
          {Object.entries(SKILL_CATEGORIES).map(([cat,list])=>{
            const c = cats[cat]; if (!c) return null;
            const pct = c.found.length/(c.found.length+c.missing.length)*100;
            const col = CATEGORY_COLORS[cat];
            return (
              <div key={cat} style={{...S.miniBar,background:col.bg,borderColor:col.border}}>
                <span style={{color:col.text,fontSize:11}}>{cat}</span>
                <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:col.text,marginLeft:6}}>{Math.round(pct)}%</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* AI Coach */}
      <div style={S.aiCard}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14}}>
          <span style={S.aiBadge}>✦ AI Career Coach</span>
          {!aiDone && <div style={{...S.spinner,width:16,height:16,borderWidth:2}}/>}
        </div>
        <div style={{fontSize:15,lineHeight:1.85,color:"#e2e8f0"}} className={!aiDone?"cursor":""}>
          {aiText || <span style={{color:"#475569"}}>Generating your personalized coaching…</span>}
        </div>
      </div>

      {/* Tabs */}
      <div style={S.tabRow}>
        {tabs.map(t=>(
          <button key={t} style={{...S.tab,...(activeTab===t?S.tabActive:{})}}
            onClick={()=>setActiveTab(t)}>
            {t==="overview"?"📊 Overview":t==="roadmap"?"🗺️ Roadmap":t==="breakdown"?"🔬 Breakdown":"📝 Raw Text"}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab==="overview" && (
        <OverviewTab found={found} missing={missing} cats={cats}/>
      )}
      {activeTab==="roadmap" && (
        <RoadmapTab missing={missing} cats={cats} filterCat={filterCat} setFilterCat={setFilterCat}/>
      )}
      {activeTab==="breakdown" && (
        <BreakdownTab cats={cats}/>
      )}
      {activeTab==="raw" && (
        <div style={S.card}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
            <Label>Extracted Resume Text</Label>
            <button style={S.btnXs} onClick={()=>setShowRaw(v=>!v)}>{showRaw?"Hide":"Show"}</button>
          </div>
          {showRaw && (
            <pre style={{fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:"#94a3b8",whiteSpace:"pre-wrap",lineHeight:1.7,maxHeight:400,overflowY:"auto",background:"#0f172a",padding:16,borderRadius:8}}>
              {resumeText || "No text extracted."}
            </pre>
          )}
          {!showRaw && <div style={{color:"#475569",fontSize:13}}>Click Show to view extracted text.</div>}
        </div>
      )}
    </div>
  );
}

// ─── Overview tab ──────────────────────────────────────────────────────────
function OverviewTab({ found, missing }) {
  return (
    <div>
      <div style={S.card}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:16}}>
          <span style={{...S.dot,background:"#34d399"}}/>
          <span style={S.sectionTitle}>Skills You Already Have</span>
          <span style={S.badge}>{found.length}</span>
        </div>
        {found.length ? (
          <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
            {found.map(s=>{
              const c=colOf(s);
              return <span key={s} style={{...S.chip,background:c.bg+"",borderColor:c.border,color:c.text}}>✓ {s}</span>;
            })}
          </div>
        ) : <Empty text="No matching skills found on your resume."/>}
      </div>

      <div style={S.card}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:16}}>
          <span style={{...S.dot,background:"#f87171"}}/>
          <span style={S.sectionTitle}>Skills to Develop</span>
          <span style={{...S.badge,background:"rgba(248,113,113,0.1)",color:"#f87171",borderColor:"rgba(248,113,113,0.25)"}}>{missing.length}</span>
        </div>
        {missing.length ? (
          <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
            {missing.map(s=>{
              const pri=getPriority(s);
              return (
                <span key={s} style={{...S.chip,background:"rgba(248,113,113,0.06)",borderColor:"rgba(248,113,113,0.2)",color:"#fca5a5",position:"relative"}}>
                  ✗ {s}
                  {pri>=4 && <span style={S.hotDot} title="High demand skill">🔥</span>}
                </span>
              );
            })}
          </div>
        ) : <Empty text="🎉 No skill gaps found! Your resume matches all benchmarks." green/>}
      </div>
    </div>
  );
}

// ─── Roadmap tab ───────────────────────────────────────────────────────────
function RoadmapTab({ missing, filterCat, setFilterCat }) {
  const allCats = ["All", ...Object.keys(SKILL_CATEGORIES), "Other"];
  const filtered = filterCat==="All" ? missing
                 : missing.filter(s => catOf(s)===filterCat);
  return (
    <div style={S.card}>
      <Label style={{marginBottom:14}}>Learning Roadmap — prioritised by market demand</Label>
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:20}}>
        {allCats.map(cat=>(
          <button key={cat} style={{...S.btnCat,...(filterCat===cat?S.btnCatActive:{})}}
            onClick={()=>setFilterCat(cat)}>{cat}</button>
        ))}
      </div>
      {filtered.length===0 && <Empty text="No missing skills in this category." green/>}
      <div style={{display:"grid",gap:12}}>
        {filtered.map((s,i)=>{
          const pri=getPriority(s), col=colOf(s);
          return (
            <div key={s} style={S.roadCard}>
              <div style={{...S.roadNum,color:col.text,borderColor:col.border,background:col.bg}}>
                {String(i+1).padStart(2,"0")}
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                  <span style={{fontFamily:"'Clash Display',sans-serif",fontWeight:700,fontSize:16}}>{s.toUpperCase()}</span>
                  {pri>=4 && <span style={{fontSize:11,background:"rgba(251,191,36,0.1)",color:"#fbbf24",border:"1px solid rgba(251,191,36,0.25)",borderRadius:100,padding:"2px 8px"}}>HIGH DEMAND</span>}
                  <span style={{fontSize:11,background:col.bg,color:col.text,border:`1px solid ${col.border}`,borderRadius:100,padding:"2px 8px"}}>{catOf(s)}</span>
                </div>
                <div style={{fontSize:12,color:"#475569",marginTop:3}}>Priority score: {"★".repeat(pri)}{"☆".repeat(5-pri)}</div>
              </div>
              <div style={{display:"flex",gap:8,flexShrink:0,flexWrap:"wrap"}}>
                <a href={getYTLink(s)} target="_blank" rel="noreferrer" style={S.linkBtn}>▶ YouTube</a>
                <a href={getRoadmapLink(s)} target="_blank" rel="noreferrer" style={{...S.linkBtn,background:"rgba(6,182,212,0.15)",color:"#22d3ee",borderColor:"rgba(6,182,212,0.3)"}}>🗺 Roadmap</a>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Breakdown tab ─────────────────────────────────────────────────────────
function BreakdownTab({ cats }) {
  return (
    <div style={{display:"grid",gap:14}}>
      {Object.entries(cats).map(([cat,{found,missing}])=>{
        const col=CATEGORY_COLORS[cat]||CATEGORY_COLORS["Other"];
        const total=found.length+missing.length;
        const pct=total?Math.round(found.length/total*100):0;
        return (
          <div key={cat} style={{...S.card,borderColor:col.border}}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12,flexWrap:"wrap"}}>
              <span style={{fontFamily:"'Clash Display',sans-serif",fontWeight:700,fontSize:15,color:col.text}}>{cat}</span>
              <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:col.text,marginLeft:"auto"}}>{pct}% covered</span>
            </div>
            <div style={{height:6,background:"#1e293b",borderRadius:100,overflow:"hidden",marginBottom:12}}>
              <div style={{height:"100%",width:`${pct}%`,background:`linear-gradient(90deg,${col.text},${col.text}88)`,borderRadius:100,transition:"width 1s ease"}}/>
            </div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {found.map(s=><span key={s} style={{...S.chip,background:col.bg,borderColor:col.border,color:col.text,fontSize:12}}>✓ {s}</span>)}
              {missing.map(s=><span key={s} style={{...S.chip,background:"rgba(248,113,113,0.06)",borderColor:"rgba(248,113,113,0.2)",color:"#fca5a5",fontSize:12}}>✗ {s}</span>)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Small helpers ──────────────────────────────────────────────────────────
function StatCard({ num, label, color, icon }) {
  return (
    <div style={S.statCard}>
      <div style={{fontSize:11,color:"#475569",marginBottom:6,textTransform:"uppercase",letterSpacing:"0.1em"}}>{icon} {label}</div>
      <div style={{fontFamily:"'Clash Display',sans-serif",fontSize:32,fontWeight:700,color,lineHeight:1}}>{num}</div>
    </div>
  );
}
function ScoreBadge({ score }) {
  const color = score>=80?"#34d399":score>=50?"#fbbf24":"#f87171";
  return (
    <div style={{textAlign:"center",background:"#0f172a",border:`2px solid ${color}`,borderRadius:12,padding:"10px 18px",minWidth:80}}>
      <div style={{fontFamily:"'Clash Display',sans-serif",fontSize:28,fontWeight:700,color,lineHeight:1}}>{score}%</div>
      <div style={{fontSize:10,color:"#475569",marginTop:2,textTransform:"uppercase",letterSpacing:"0.1em"}}>Match</div>
    </div>
  );
}
function Label({children}) {
  return <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,letterSpacing:"0.15em",textTransform:"uppercase",color:"#475569",marginBottom:14}}>{children}</div>;
}
function Empty({text,green}) {
  return <div style={{color:green?"#34d399":"#475569",fontSize:14,padding:"12px 0"}}>{text}</div>;
}

// ═══════════════════════════════════════════════════════════════════════════
//  STYLES
// ═══════════════════════════════════════════════════════════════════════════
const S = {
  root:{ minHeight:"100vh",background:"#020817",color:"#e2e8f0",fontFamily:"'Cabinet Grotesk',sans-serif",position:"relative",overflow:"hidden" },
  bg:{ position:"fixed",inset:0,pointerEvents:"none",zIndex:0 },
  orb:{ position:"absolute",borderRadius:"50%",filter:"blur(100px)",opacity:0.08,animation:"drift 20s ease-in-out infinite alternate" },
  wrap:{ position:"relative",zIndex:1,padding:"0 20px" },

  logoRow:{ display:"flex",alignItems:"center",gap:10,justifyContent:"center",marginBottom:20 },
  logoIcon:{ fontSize:28,color:"#7c3aed" },
  logoText:{ fontFamily:"'Clash Display',sans-serif",fontSize:22,fontWeight:700,letterSpacing:"-0.5px" },
  h1:{ fontFamily:"'Clash Display',sans-serif",fontSize:"clamp(32px,5vw,56px)",fontWeight:700,lineHeight:1.1,letterSpacing:"-1.5px",marginBottom:14,textAlign:"center" },
  gradient:{ background:"linear-gradient(135deg,#7c3aed,#0891b2)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",backgroundClip:"text" },
  sub:{ color:"#64748b",fontSize:16,fontWeight:300,textAlign:"center",maxWidth:500,margin:"0 auto" },

  card:{ background:"#0f172a",border:"1px solid #1e293b",borderRadius:14,padding:"24px",marginBottom:16 },
  dropZone:{ border:"2px dashed #1e293b",borderRadius:10,padding:"36px 20px",textAlign:"center",cursor:"pointer",transition:"all 0.25s" },
  dropZoneActive:{ borderColor:"#7c3aed",background:"rgba(124,58,237,0.05)" },
  dropZoneDone:{ borderColor:"#34d399",background:"rgba(52,211,153,0.04)" },

  input:{ flex:1,background:"#1e293b",border:"1px solid #334155",borderRadius:8,padding:"10px 14px",color:"#e2e8f0",fontSize:14,fontFamily:"'Cabinet Grotesk',sans-serif",outline:"none" },
  btnAdd:{ background:"#7c3aed",border:"none",borderRadius:8,padding:"10px 18px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"'Cabinet Grotesk',sans-serif",whiteSpace:"nowrap" },
  btnCat:{ background:"#1e293b",border:"1px solid #334155",borderRadius:100,padding:"4px 12px",color:"#64748b",fontSize:11,cursor:"pointer",fontFamily:"'JetBrains Mono',monospace",transition:"all 0.2s" },
  btnCatActive:{ background:"rgba(124,58,237,0.15)",borderColor:"rgba(124,58,237,0.4)",color:"#a78bfa" },
  btnXs:{ background:"#1e293b",border:"1px solid #334155",borderRadius:6,padding:"4px 10px",color:"#94a3b8",fontSize:11,cursor:"pointer",fontFamily:"'Cabinet Grotesk',sans-serif" },
  btnBack:{ background:"#1e293b",border:"1px solid #334155",borderRadius:8,padding:"8px 14px",color:"#94a3b8",fontSize:13,cursor:"pointer",fontFamily:"'Cabinet Grotesk',sans-serif" },
  btnMain:{ width:"100%",padding:"16px",background:"linear-gradient(135deg,#7c3aed,#0ea5e9)",border:"none",borderRadius:14,color:"#fff",fontFamily:"'Clash Display',sans-serif",fontSize:17,fontWeight:700,cursor:"pointer",boxShadow:"0 4px 30px rgba(124,58,237,0.4)",transition:"transform 0.2s,box-shadow 0.2s" },
  btnDisabled:{ opacity:0.4,cursor:"not-allowed" },

  chip:{ display:"inline-flex",alignItems:"center",borderRadius:100,padding:"5px 12px",fontSize:12,fontFamily:"'JetBrains Mono',monospace",border:"1px solid",transition:"transform 0.15s",cursor:"default" },
  hotDot:{ fontSize:11,marginLeft:4 },

  errorBox:{ background:"rgba(239,68,68,0.08)",border:"1px solid rgba(239,68,68,0.25)",borderRadius:10,padding:"12px 16px",color:"#fca5a5",fontSize:14,marginBottom:16 },
  loadBox:{ display:"flex",flexDirection:"column",alignItems:"center",gap:14,padding:"36px",textAlign:"center" },
  spinner:{ width:40,height:40,border:"3px solid #1e293b",borderTopColor:"#7c3aed",borderRadius:"50%",animation:"spin 0.8s linear infinite" },

  statRow:{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:16 },
  statCard:{ background:"#0f172a",border:"1px solid #1e293b",borderRadius:12,padding:"16px" },

  progressWrap:{ background:"#0f172a",border:"1px solid #1e293b",borderRadius:14,padding:"20px",marginBottom:16 },
  progressTrack:{ height:8,background:"#1e293b",borderRadius:100,overflow:"hidden" },
  progressFill:{ height:"100%",background:"linear-gradient(90deg,#7c3aed,#0891b2,#059669)",borderRadius:100,transition:"width 1.2s cubic-bezier(0.22,1,0.36,1)" },
  miniBar:{ display:"flex",alignItems:"center",borderRadius:100,padding:"3px 10px",border:"1px solid",fontSize:11,fontFamily:"'JetBrains Mono',monospace" },

  aiCard:{ background:"#0f172a",border:"1px solid #1e293b",borderRadius:14,padding:"24px",marginBottom:16,position:"relative",overflow:"hidden" },
  aiBadge:{ background:"linear-gradient(135deg,rgba(124,58,237,0.15),rgba(8,145,178,0.15))",border:"1px solid rgba(124,58,237,0.3)",borderRadius:100,padding:"4px 12px",fontSize:11,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:"#a78bfa",fontFamily:"'JetBrains Mono',monospace" },

  tabRow:{ display:"flex",gap:4,background:"#0f172a",border:"1px solid #1e293b",borderRadius:10,padding:4,marginBottom:16,flexWrap:"wrap" },
  tab:{ flex:1,padding:"9px 12px",border:"none",borderRadius:8,background:"transparent",color:"#64748b",fontSize:13,cursor:"pointer",fontFamily:"'Cabinet Grotesk',sans-serif",fontWeight:500,transition:"all 0.2s",minWidth:80 },
  tabActive:{ background:"#1e293b",color:"#e2e8f0" },

  dot:{ width:8,height:8,borderRadius:"50%",display:"inline-block",flexShrink:0 },
  sectionTitle:{ fontFamily:"'Clash Display',sans-serif",fontWeight:700,fontSize:16 },
  badge:{ marginLeft:"auto",background:"rgba(52,211,153,0.1)",color:"#34d399",border:"1px solid rgba(52,211,153,0.25)",borderRadius:100,padding:"2px 10px",fontSize:12,fontFamily:"'JetBrains Mono',monospace" },

  roadCard:{ background:"#0f172a",border:"1px solid #1e293b",borderRadius:12,padding:"16px 20px",display:"flex",alignItems:"center",gap:14,transition:"border-color 0.2s,transform 0.2s",flexWrap:"wrap" },
  roadNum:{ width:36,height:36,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'JetBrains Mono',monospace",fontSize:12,border:"1px solid",flexShrink:0 },
  linkBtn:{ display:"inline-flex",alignItems:"center",gap:5,background:"rgba(124,58,237,0.12)",color:"#a78bfa",border:"1px solid rgba(124,58,237,0.25)",borderRadius:8,padding:"7px 12px",textDecoration:"none",fontSize:12,fontWeight:600,fontFamily:"'Cabinet Grotesk',sans-serif",transition:"opacity 0.2s" },
};
