import { jsPDF } from 'jspdf'
import { useState, useCallback, useEffect } from 'react'



// ─── Taxonomy constants ───────────────────────────────────────────────────────

const FUNCTION_LEVELS = [
  { id: 'process-specialist',  label: 'Process Specialist',  description: 'Executes defined processes' },
  { id: 'process-manager',     label: 'Process Manager',     description: 'Improves and manages processes' },
  { id: 'people-manager',      label: 'People Manager',      description: 'Manages who does the work' },
  { id: 'strategic-manager',   label: 'Strategic Manager',   description: 'Manages people executing strategy-linked initiatives' },
  { id: 'strategic-advisor',   label: 'Strategic Advisor',   description: 'Recommends what should happen, no binding authority' },
  { id: 'strategic-executive', label: 'Strategic Executive', description: 'Decides what should happen, binding authority' },
]

const SENIORITY_BANDS = [
  { label: 'Junior',      min: 0, max: 2 },
  { label: 'Experienced', min: 2, max: 5 },
  { label: 'Senior',      min: 5, max: 8 },
  { label: 'Mature',      min: 8, max: Infinity },
]

const EVAL_DIMS = [
  { id: 'fields',   label: 'Knowledge area accuracy', desc: 'Did the Knowledge Area labels make sense?' },
  { id: 'years',    label: 'Years math',              desc: 'Did the numbers add up correctly?' },
  { id: 'function', label: 'Function accuracy',       desc: 'Were the function tags correct?' },
  { id: 'industry', label: 'Industry accuracy',       desc: 'Were the NAICS industry tags correct?' },
]

const FW_OPTIONS = [
  { id: 'onet',      label: 'O*NET' },
  { id: 'soc_minor', label: 'SOC minor groups' },
  { id: 'equal',     label: 'About equal' },
  { id: 'neither',   label: 'Neither worked' },
]

const SCORE_LABELS = { 1: 'Poor', 2: 'OK', 3: 'Good' }

function getSeniority(years) {
  const n = Number(years) || 0
  return SENIORITY_BANDS.find(b => n >= b.min && n < b.max)?.label ?? 'Junior'
}

// ─── API prompts ──────────────────────────────────────────────────────────────

const SHARED_SYSTEM = `You are a resume taxonomy classifier for TinyNet, a recruiting platform that helps non-linear career candidates get fairly evaluated.

Extract all dimensions and respond ONLY with valid JSON, no markdown, no preamble, no backticks.

Rules:
- total_years: calculate from actual work history dates, not self-reported summaries
- For evidence fields: ALWAYS prefer a direct quote or paraphrase from the resume. Use single quotes not double quotes inside evidence text. Only use AI synthesis (clearly marked with 'Based on...') when no specific resume text supports the classification
- CRITICAL for function evidence: The evidence must justify WHY this specific function level applies. Process Specialist = executing defined processes. Process Manager = designing/improving processes. People Manager = managing direct reports. Strategic = setting direction. Provide 2-4 bullet points of evidence using partial quotes from the resume, each tagged with company and role. Format as: "· Company (Role): 'partial quote or paraphrase'" separated by the · character. Do NOT reuse the same quote across multiple functions.
- For knowledge area evidence: provide 2-3 bullet points tagged by company and role, NO quotes needed. Format as: "· Company (Role): brief description of relevant work" separated by the · character.
- For industry evidence: one sentence explaining which companies map to this industry and why.
- Years across industries MUST sum to total_years
- Function years reflect time spent operating at that level — they do NOT need to sum to total_years. A candidate can operate at multiple function levels within the same role or simultaneously across roles. For example, someone who spent 3 years as a senior analyst doing both process execution AND process design would get years credited to both Process Specialist and Process Manager.

JSON structure (no other text):
{
  "summary": "one plain sentence describing what this person actually does",
  "total_years": 0,
  "strengths": "1-2 sentences highlighting what genuinely sets this candidate apart, referencing specific experience",
  "functions": [{"name": "Process Specialist|Process Manager|People Manager|Strategic Manager|Strategic Advisor|Strategic Executive", "years": 0, "evidence": "Direct quote or paraphrase from resume with company name. If no direct quote, write Based on [company]: [synthesis]"}],
  "industries": [{"name": "NAICS sector", "years": 0, "evidence": "Which companies map to this industry and why"}],
  "tools": [],
  "credentials": [{"type": "Degree|Certification|License", "name": "", "institution": "", "year": ""}]
}

NAICS sectors to use: Agriculture, Mining, Utilities, Construction, Manufacturing, Wholesale Trade, Retail Trade, Transportation and Warehousing, Information, Finance and Insurance, Real Estate, Professional and Technical Services, Management of Companies, Administrative and Support Services, Educational Services, Health Care and Social Assistance, Arts and Entertainment, Accommodation and Food Services, Government, Nonprofit and Social Services, Other`

function buildOnetSystem(totalYears) {
  return `You are a resume taxonomy classifier. Extract Knowledge Area / Discipline using O*NET Knowledge category names.

Rules:
1. Return between 3 and 6 knowledge areas — no more, no fewer.
2. DO NOT collapse distinct types of work into a single broad category. Each meaningfully different domain of knowledge the candidate has demonstrated must appear as its own entry. For example, compliance work, customer operations work, and data analysis work are three distinct areas — they must not be merged into one.
3. DO NOT create a catch-all category. If a candidate did customer service AND compliance AND data work, all three must appear separately.
4. Treat overlap as separate dimensions, not as a reason to consolidate. A candidate can know both "Law and Government" and "Customer and Personal Service" — list both.
5. Use only these O*NET category names: Administration and Management, Clerical, Economics and Accounting, Sales and Marketing, Customer and Personal Service, Personnel and Human Resources, Production and Processing, Computers and Electronics, Engineering and Technology, Design, Mechanical, Mathematics, Physics, Chemistry, Biology, Psychology, Sociology and Anthropology, Geography, Medicine and Dentistry, Therapy and Counseling, Education and Training, English Language, Fine Arts, Philosophy and Theology, Public Safety and Security, Law and Government, Telecommunications, Communications and Media, Transportation

CRITICAL MATH: The candidate has exactly ${totalYears} total professional years. Years across all fields MUST sum to exactly ${totalYears}. Distribute proportionally across all identified areas.

For each field include evidence: a direct quote or paraphrase from the resume with company name. Use single quotes not double quotes within evidence text. Use "Based on [company]: [synthesis]" only if no direct quote is available.

Respond ONLY with valid JSON: {"fields":[{"name":"","years":0,"evidence":""}]}`
}


function buildSocMinorSystem(totalYears) {
  return `You are a resume taxonomy classifier. Extract Knowledge Area / Discipline using SOC 2018 minor group names.
Map what the candidate demonstrably knows and has done — focus on work performed, not job title.

Use only these SOC 2018 minor group names:
Business Operations Specialists, Financial Specialists, Computer Occupations, Mathematical Science Occupations,
Architects Surveyors and Cartographers, Engineers, Drafters and Engineering Technicians,
Life Scientists, Physical Scientists, Social Scientists and Related Workers, Occupational Health and Safety Specialists,
Counselors Social Workers and Community Service Specialists, Religious Workers,
Lawyers Judges and Related Workers, Legal Support Workers,
Postsecondary Teachers, Primary and Secondary School Teachers, Other Teachers and Instructors, Librarians Curators and Archivists,
Art and Design Workers, Entertainers and Performers, Media and Communication Workers, Media and Communication Equipment Workers,
Health Diagnosing and Treating Practitioners, Health Technologists and Technicians,
Home Health and Personal Care Aides, Occupational and Physical Therapist Assistants, Other Healthcare Support,
Firefighting and Prevention Workers, Law Enforcement Workers, Other Protective Service Workers,
Food Preparation and Serving Workers,
Personal Appearance Workers, Animal Care and Service Workers, Entertainment Attendants, Other Personal Care and Service Workers,
Retail Sales Workers, Sales Representatives Services, Sales Representatives Wholesale and Manufacturing, Other Sales Workers,
Financial Clerks, Information and Record Clerks, Secretaries and Administrative Assistants, Other Office and Administrative Support,
Agricultural Workers, Forest Conservation and Logging Workers,
Construction Trades Workers, Extraction Workers,
Electrical and Electronic Equipment Mechanics and Repairers, Vehicle and Mobile Equipment Mechanics, Other Installation Maintenance and Repair,
Plant and System Operators, Assemblers and Fabricators, Food Processing Workers, Metal Workers and Plastic Workers, Other Production Workers,
Air Transportation Workers, Motor Vehicle Operators, Rail Transportation Workers, Water Transportation Workers, Material Moving Workers

Rules:
1. Return between 3 and 6 knowledge areas.
2. DO NOT collapse distinct types of work. Each meaningfully different domain must appear separately.
3. DO NOT create catch-all categories. Compliance work, customer operations, and data analysis are separate.
4. Treat overlap as separate dimensions.

CRITICAL MATH: Candidate has exactly ${totalYears} total professional years. Years across all fields MUST sum to exactly ${totalYears}.

For each field include evidence: direct quote or paraphrase from resume with company name. Use single quotes not double quotes within evidence text. Use "Based on [company]: [synthesis]" only if no direct quote available.

Respond ONLY with valid JSON: {"fields":[{"name":"","years":0,"evidence":""}]}`
}
// ─── API ──────────────────────────────────────────────────────────────────────

async function callAPI(system, userContent) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      temperature: 0,
      system,
      messages: [{ role: 'user', content: userContent }],
    }),
  })
  const data = await res.json()
  const raw = (data.content || []).map(b => b.text || '').join('').replace(/```json|```/g, '').trim()
  try {
    return JSON.parse(raw)
  } catch(e) {
    throw new Error('Could not parse classifier response — try again.')
  }
}

function normalizeYears(items, total) {
  if (!items || !items.length || !total) return items
  const sum = items.reduce((s, i) => s + (Number(i.years) || 0), 0)
  if (sum === 0) return items
  return items.map(i => ({ ...i, years: Math.round((Number(i.years) / sum) * total * 10) / 10 }))
}

// ─── Small shared components ──────────────────────────────────────────────────

function DomainEditor({ items, onChange, placeholder = 'Domain' }) {
  const update = (i, key, val) => onChange(items.map((item, idx) => idx === i ? { ...item, [key]: val } : item))
  const remove = i => onChange(items.filter((_, idx) => idx !== i))
  const add = () => onChange([...items, { name: '', years: 0, evidence: '' }])
  return (
    <div>
      {items.map((item, i) => (
        <div key={i} className="flex gap-2 mb-2 items-center">
          <input className="flex-1 px-3 py-1.5 text-sm border border-stone-200 rounded-lg bg-white text-stone-800 focus:outline-none focus:border-stone-400" value={item.name} placeholder={placeholder} onChange={e => update(i, 'name', e.target.value)} />
          <input className="w-16 px-2 py-1.5 text-sm border border-stone-200 rounded-lg bg-white text-stone-800 focus:outline-none focus:border-stone-400 text-center" type="number" min="0" max="40" value={item.years} placeholder="yrs" onChange={e => update(i, 'years', Number(e.target.value))} />
          <button onClick={() => remove(i)} className="text-stone-300 hover:text-stone-500 text-lg leading-none px-1">x</button>
        </div>
      ))}
      <button onClick={add} className="text-xs text-stone-400 hover:text-stone-600 underline">+ add</button>
    </div>
  )
}

function CredentialEditor({ items, onChange }) {
  const update = (i, key, val) => onChange(items.map((item, idx) => idx === i ? { ...item, [key]: val } : item))
  const remove = i => onChange(items.filter((_, idx) => idx !== i))
  const add = () => onChange([...items, { type: 'Degree', name: '', institution: '', year: '' }])
  return (
    <div>
      {items.map((item, i) => (
        <div key={i} className="flex gap-2 mb-2 items-center flex-wrap">
          <select className="px-2 py-1.5 text-sm border border-stone-200 rounded-lg bg-white text-stone-800 focus:outline-none" value={item.type} onChange={e => update(i, 'type', e.target.value)}>
            <option>Degree</option><option>Certification</option><option>License</option>
          </select>
          <input className="flex-1 min-w-32 px-3 py-1.5 text-sm border border-stone-200 rounded-lg bg-white text-stone-800 focus:outline-none focus:border-stone-400" value={item.name} placeholder="Name" onChange={e => update(i, 'name', e.target.value)} />
          <input className="flex-1 min-w-28 px-3 py-1.5 text-sm border border-stone-200 rounded-lg bg-white text-stone-800 focus:outline-none focus:border-stone-400" value={item.institution} placeholder="Institution" onChange={e => update(i, 'institution', e.target.value)} />
          <input className="w-20 px-2 py-1.5 text-sm border border-stone-200 rounded-lg bg-white text-stone-800 focus:outline-none focus:border-stone-400 text-center" value={item.year} placeholder="Year" onChange={e => update(i, 'year', e.target.value)} />
          <button onClick={() => remove(i)} className="text-stone-300 hover:text-stone-500 text-lg leading-none px-1">x</button>
        </div>
      ))}
      <button onClick={add} className="text-xs text-stone-400 hover:text-stone-600 underline">+ add</button>
    </div>
  )
}

// ─── Expandable row ───────────────────────────────────────────────────────────

function ExpandableRow({ label, years, evidence, accentClass }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-stone-100 last:border-0">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-stone-50 transition-colors text-left">
        <div className="flex items-center gap-3">
          <span className={`text-xs font-medium px-2.5 py-1 rounded-lg border ${accentClass}`}>{label}</span>
          <span className="text-xs text-stone-400">{years}y</span>
        </div>
        <span className={`text-stone-300 text-sm transition-transform duration-150 inline-block ${open ? 'rotate-90' : ''}`}>›</span>
      </button>
      {open && evidence && (
        <div className="px-5 pb-4">
          <p className="text-xs text-stone-500 leading-relaxed bg-stone-50 rounded-lg px-4 py-3 border border-stone-100 italic">{evidence}</p>
        </div>
      )}
    </div>
  )
}

// ─── Recruiter card ───────────────────────────────────────────────────────────

function RecruiterCard({ profile, framework }) {
  const [copied, setCopied] = useState(false)

  const copyText = () => {
    const el = document.getElementById('recruiter-profile')
    if (el) navigator.clipboard.writeText(el.innerText).catch(() => {})
  }

  const downloadHTML = () => {    const p = profile
    const fw = framework || 'O*NET'

    const chipStyle = (bg, color) => `display:inline-block;padding:3px 10px;border-radius:6px;font-size:11px;font-weight:600;background:${bg};color:${color};margin:2px 3px 2px 0;`

    const renderRow = (label, years, evidence, bg, color) => `
      <div style="border-bottom:1px solid #f0f0f0;">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 16px;">
          <span style="${chipStyle(bg, color)}">${label}</span>
          <span style="font-size:11px;color:#999;">${years}y</span>
        </div>
        ${evidence ? `<div style="padding:0 16px 10px;font-size:11px;color:#777;font-style:italic;line-height:1.5;">${evidence}</div>` : ''}
      </div>`

    const functions = (p.functions || []).map(fn => {
      const name = typeof fn === 'string' ? fn : fn.name
      const years = typeof fn === 'object' ? fn.years : 0
      const evidence = typeof fn === 'object' ? fn.evidence : ''
      return renderRow(`${getSeniority(years)} ${name}`, years, evidence, '#eef0fb', '#3730a3')
    }).join('')

    const fields = (p.fields || []).map(f =>
      renderRow(f.name, f.years, f.evidence, '#f3f4f6', '#374151')
    ).join('')

    const industries = (p.industries || []).map(ind =>
      renderRow(ind.name, ind.years, ind.evidence, '#f0fdf9', '#0f6e56')
    ).join('')

    const tools = (p.tools || []).map(t =>
      `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;background:#f5f5f5;color:#666;border:1px solid #e0e0e0;margin:2px 3px 2px 0;">${t}</span>`
    ).join('')

    const credentials = (p.credentials || []).map(c =>
      `<div style="margin-bottom:6px;font-size:12px;">
        <span style="font-size:10px;font-weight:700;color:#aaa;text-transform:uppercase;letter-spacing:.06em;margin-right:8px;">${c.type}</span>
        <strong>${c.name}</strong>${c.institution ? ` · ${c.institution}` : ''}${c.year ? ` · ${c.year}` : ''}
      </div>`
    ).join('')

    const section = (label, body, sub = '') => `
      <div style="border-bottom:1px solid #eee;">
        <div style="padding:12px 16px 4px;">
          <span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#aaa;">${label}${sub ? ` <span style="font-weight:400;text-transform:none;letter-spacing:0;color:#ccc;">${sub}</span>` : ''}</span>
        </div>
        ${body}
      </div>`

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>TinyNet Profile</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'DM Sans', Arial, sans-serif; background: #f7f5f0; display: flex; justify-content: center; padding: 40px 16px; }
  .card { background: white; border-radius: 16px; overflow: hidden; max-width: 680px; width: 100%; box-shadow: 0 2px 16px rgba(0,0,0,0.08); }
  @media print {
    body { background: white; padding: 0; }
    .card { box-shadow: none; border-radius: 0; }
    .no-print { display: none !important; }
  }
</style>
</head>
<body>
<div class="card">
  <div style="background:#1c1917;padding:24px;">
    <p style="color:#78716c;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;">TinyNet · Taxonomy Profile</p>
    <p style="color:#d6d3d1;font-size:13px;line-height:1.6;">${p.summary || ''}</p>
  </div>

  ${section('Function', functions)}
  ${section('Knowledge Area / Discipline', fields, `(${fw})`)}
  ${section('Industry', industries, '(NAICS)')}

  ${p.strengths ? `
  <div style="border-bottom:1px solid #eee;padding:16px;background:#fafaf9;">
    <p style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#aaa;margin-bottom:8px;">Strengths</p>
    <p style="font-size:13px;color:#555;line-height:1.6;">${p.strengths}</p>
  </div>` : ''}

  ${tools ? `<div style="border-bottom:1px solid #eee;padding:16px;">
    <p style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#aaa;margin-bottom:8px;">Tooling &amp; Methods</p>
    ${tools}
  </div>` : ''}

  ${credentials ? `<div style="border-bottom:1px solid #eee;padding:16px;">
    <p style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#aaa;margin-bottom:8px;">Education &amp; Credentials</p>
    ${credentials}
  </div>` : ''}

  <div style="padding:12px 16px;display:flex;justify-content:space-between;align-items:center;">
    <span style="font-size:10px;color:#ccc;">Candidate-owned · read-only for recruiters</span>
    <span style="font-size:10px;color:#ccc;">TinyNet</span>
  </div>

  <div class="no-print" style="padding:12px 16px;background:#f9f9f9;border-top:1px solid #eee;text-align:center;">
    <button onclick="window.print()" style="padding:8px 20px;background:#1c1917;color:white;border:none;border-radius:8px;font-size:12px;cursor:pointer;font-family:inherit;">Print / Save as PDF</button>
  </div>
</div>
</body>
</html>`

    // Download as HTML file
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'TinyNet_Profile.html'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const downloadPDF = () => {
    const p = profile
    const fw = framework || 'O*NET'

    const pill = (label, years, textColor, bgColor, borderColor) =>
      `<div style="display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid #f0f0f0;">
        <span style="display:inline-block;padding:2px 10px;border-radius:20px;font-size:10px;font-weight:600;background:${bgColor};color:${textColor};border:1px solid ${borderColor};">${label}</span>
        <span style="font-size:9.5px;color:#aaa;font-weight:500;">${years}y</span>
      </div>`

    const bullets = (items) => items.length
      ? `<ul style="margin:4px 0 8px;padding-left:14px;">${items.map(i => `<li style="font-size:9.5px;color:#666;line-height:1.55;margin-bottom:2px;">${i}</li>`).join('')}</ul>`
      : ''

    const sectionHead = (label, sub='') =>
      `<p style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#aaa;margin:16px 0 6px;">${label}${sub ? ` <span style="font-weight:400;text-transform:none;letter-spacing:0;color:#ccc;">${sub}</span>` : ''}</p>`

    const fnHtml = (p.functions || []).map(fn => {
      const name = typeof fn === 'string' ? fn : fn.name
      const years = typeof fn === 'object' ? fn.years : 0
      const ev = (typeof fn === 'object' ? fn.evidence : '') || ''
      const evItems = ev.split(/[·•]/).map(s => s.trim()).filter(Boolean)
      return pill(`${getSeniority(years)} ${name}`, years, '#312e81', '#eef0fb', '#c7d2fe') + bullets(evItems)
    }).join('')

    const fieldHtml = (p.fields || []).map(f => {
      const evItems = (f.evidence || '').split(/[·•]/).map(s => s.trim()).filter(Boolean)
      return pill(f.name, f.years, '#292524', '#f5f5f4', '#e7e5e4') + bullets(evItems)
    }).join('')

    const indHtml = (p.industries || []).map(ind => {
      const evItems = (ind.evidence || '').split(/[·•]/).map(s => s.trim()).filter(Boolean)
      return pill(ind.name, ind.years, '#134e4a', '#f0fdf9', '#99f6e4') + bullets(evItems)
    }).join('')

    const toolsHtml = (p.tools || []).map(t =>
      `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:9px;background:#f5f5f5;color:#666;border:1px solid #e5e5e5;margin:2px 3px 2px 0;">${t}</span>`
    ).join('')

    const credsHtml = (p.credentials || []).map(c =>
      `<div style="display:flex;align-items:baseline;gap:8px;padding:5px 0;border-bottom:1px solid #f0f0f0;">
        <span style="font-size:7.5px;font-weight:700;color:#aaa;text-transform:uppercase;letter-spacing:.06em;min-width:65px;">${c.type}</span>
        <span style="font-size:10.5px;font-weight:600;color:#1c1917;">${c.name}${c.institution ? `<span style="font-weight:400;color:#888;"> · ${c.institution}</span>` : ''}${c.year ? `<span style="color:#bbb;"> · ${c.year}</span>` : ''}</span>
      </div>`
    ).join('')

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>TinyNet Profile</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,400;0,500;0,600;1,400&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'DM Sans', Arial, sans-serif;
    background: #f5f3ef;
    padding: 32px 24px;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .page {
    background: white;
    max-width: 680px;
    margin: 0 auto;
    border-radius: 12px;
    overflow: hidden;
    page-break-inside: avoid;
  }
  .header {
    background: #1c1917;
    padding: 22px 28px 18px;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .accent { height: 3px; background: #6366f1; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .strengths {
    padding: 14px 28px;
    background: #fafaf9;
    border-bottom: 1px solid #eee;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .body { padding: 4px 28px 20px; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 0 32px; }
  .footer {
    display: flex;
    justify-content: space-between;
    padding: 10px 28px;
    border-top: 1px solid #eee;
    background: #fafafa;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  @media print {
    body { background: white; padding: 0; }
    .page { border-radius: 0; max-width: 100%; page-break-inside: avoid; }
    .header, .strengths, .footer { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
<div class="page">

  <div class="header">
    <p style="font-size:8px;font-weight:600;text-transform:uppercase;letter-spacing:.12em;color:#78716c;margin-bottom:8px;">TinyNet · Taxonomy Profile</p>
    <p style="font-size:12.5px;color:#d6d3d1;line-height:1.65;">${p.summary || ''}</p>
  </div>

  <div class="accent"></div>

  ${p.strengths ? `<div class="strengths">
    <p style="font-size:7.5px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#aaa;margin-bottom:6px;">Strengths</p>
    <p style="font-size:11px;color:#44403c;line-height:1.7;font-weight:500;">${p.strengths}</p>
  </div>` : ''}

  <div class="body">
    <div class="two-col">
      <div>
        ${sectionHead('Function')}
        ${fnHtml}
        ${sectionHead('Knowledge area / discipline', `(${fw})`)}
        ${fieldHtml}
      </div>
      <div>
        ${sectionHead('Industry', '(NAICS)')}
        ${indHtml}
        ${toolsHtml ? sectionHead('Tooling & methods') + `<div style="padding-bottom:8px;">${toolsHtml}</div>` : ''}
        ${credsHtml ? sectionHead('Education & credentials') + credsHtml : ''}
      </div>
    </div>
  </div>

  <div class="footer">
    <span style="font-size:8.5px;color:#ccc;">Candidate-owned · read-only for recruiters</span>
    <span style="font-size:8.5px;font-weight:600;color:#ccc;letter-spacing:.06em;">TINYNET</span>
  </div>

</div>
</body>
</html>`

    const iframe = document.createElement('iframe')
    iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:none;'
    document.body.appendChild(iframe)
    iframe.contentDocument.open()
    iframe.contentDocument.write(html)
    iframe.contentDocument.close()
    iframe.contentWindow.onload = () => {
      iframe.contentWindow.focus()
      iframe.contentWindow.print()
      setTimeout(() => document.body.removeChild(iframe), 3000)
    }
  }
  return (
    <div>
      <div id="recruiter-profile" className="bg-white border border-stone-200 rounded-2xl overflow-hidden">
        <div className="bg-stone-900 px-6 py-5">
          <p className="text-stone-500 text-xs font-medium uppercase tracking-widest mb-2">TinyNet · Taxonomy Profile</p>
          <p className="text-stone-300 text-sm leading-relaxed">{profile.summary}</p>
        </div>

        <div className="border-b border-stone-100">
          <div className="px-5 pt-4 pb-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Function</p>
          </div>
          {(profile.functions || []).map((fn, i) => {
            const name = typeof fn === 'string' ? fn : fn.name
            const years = typeof fn === 'object' ? fn.years : 0
            const evidence = typeof fn === 'object' ? fn.evidence : null
            return (
              <ExpandableRow key={i} label={`${getSeniority(years)} ${name}`} years={years} evidence={evidence} accentClass="bg-indigo-50 text-indigo-800 border-indigo-100" />
            )
          })}
        </div>

        <div className="border-b border-stone-100">
          <div className="px-5 pt-4 pb-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Knowledge Area / Discipline <span className="normal-case tracking-normal font-normal text-stone-300 ml-1">(O*NET)</span></p>
          </div>
          {(profile.fields || []).map((f, i) => (
            <ExpandableRow key={i} label={f.name} years={f.years} evidence={f.evidence} accentClass="bg-stone-100 text-stone-700 border-stone-200" />
          ))}
        </div>

        <div className="border-b border-stone-100">
          <div className="px-5 pt-4 pb-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Industry <span className="normal-case tracking-normal font-normal text-stone-300">(NAICS)</span></p>
          </div>
          {(profile.industries || []).map((ind, i) => (
            <ExpandableRow key={i} label={ind.name} years={ind.years} evidence={ind.evidence} accentClass="bg-teal-50 text-teal-800 border-teal-100" />
          ))}
        </div>

        {profile.strengths && (
          <div className="px-6 py-4 border-b border-stone-100 bg-stone-50">
            <p className="text-xs font-semibold uppercase tracking-widest text-stone-400 mb-2">Strengths</p>
            <p className="text-sm text-stone-600 leading-relaxed">{profile.strengths}</p>
          </div>
        )}

        {(profile.tools || []).length > 0 && (
          <div className="px-6 py-4 border-b border-stone-100">
            <p className="text-xs font-semibold uppercase tracking-widest text-stone-400 mb-3">Tooling &amp; Methods</p>
            <div className="flex flex-wrap gap-1.5">
              {profile.tools.map((t, i) => <span key={i} className="text-xs px-2 py-0.5 bg-stone-50 text-stone-500 rounded border border-stone-200">{t}</span>)}
            </div>
          </div>
        )}

        {(profile.credentials || []).length > 0 && (
          <div className="px-6 py-4 border-b border-stone-100">
            <p className="text-xs font-semibold uppercase tracking-widest text-stone-400 mb-3">Education &amp; Credentials</p>
            <div className="space-y-2">
              {profile.credentials.map((c, i) => (
                <div key={i} className="text-sm">
                  <span className="text-xs font-medium text-stone-400 uppercase tracking-wide mr-2">{c.type}</span>
                  <span className="text-stone-700 font-medium">{c.name}</span>
                  {c.institution && <span className="text-stone-500"> · {c.institution}</span>}
                  {c.year && <span className="text-stone-400"> · {c.year}</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="px-6 py-3 flex items-center justify-between">
          <p className="text-xs text-stone-300">Candidate-owned · read-only for recruiters</p>
          <p className="text-xs text-stone-300">TinyNet</p>
        </div>
      </div>
      <div className="flex gap-3 mt-4">
        <button
          onClick={() => { copyText(); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
          className="text-xs px-3 py-1.5 border border-stone-200 rounded-lg text-stone-500 hover:bg-stone-100 hover:border-stone-300 active:scale-95 transition-all"
        >
          {copied ? 'Copied!' : 'Copy as text'}
        </button>
        <button
          onClick={downloadHTML}
          className="text-xs px-3 py-1.5 border border-stone-200 rounded-lg text-stone-500 hover:bg-stone-100 hover:border-stone-300 active:scale-95 transition-all"
        >
          Download HTML
        </button>
        <button
          onClick={downloadPDF}
          className="text-xs px-3 py-1.5 border border-stone-900 bg-stone-900 rounded-lg text-white hover:bg-stone-700 active:scale-95 transition-all"
        >
          Download PDF
        </button>
      </div>
    </div>
  )
}

// ─── Score buttons ────────────────────────────────────────────────────────────

function ScoreButtons({ value, onChange }) {
  return (
    <div className="flex gap-2">
      {[1, 2, 3].map(n => (
        <button key={n} onClick={() => onChange(n)} className={`flex-1 py-2 text-xs font-medium rounded-lg border transition-colors ${value === n ? n === 1 ? 'bg-red-50 border-red-300 text-red-700' : n === 2 ? 'bg-amber-50 border-amber-300 text-amber-700' : 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-white border-stone-200 text-stone-400 hover:border-stone-300'}`}>
          {n} {SCORE_LABELS[n]}
        </button>
      ))}
    </div>
  )
}

// ─── Eval form ────────────────────────────────────────────────────────────────

function EvalForm({ profile, onSave }) {
  const [role, setRole] = useState(profile?.summary?.slice(0, 60) || '')
  const [scores, setScores] = useState({ fields: 0, years: 0, function: 0, industry: 0 })
  const [fw, setFw] = useState('')
  const [notes, setNotes] = useState('')
  const [saved, setSaved] = useState(false)

  const submit = () => {
    if (!role.trim()) { alert('Add a role label.'); return }
    const unscored = EVAL_DIMS.filter(d => !scores[d.id])
    if (unscored.length) { alert('Score: ' + unscored.map(d => d.label).join(', ')); return }
    if (!fw) { alert('Select a framework rating.'); return }
    onSave({ role: role.trim(), scores: { ...scores, framework: fw }, notes, date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), id: Date.now() })
    setSaved(true)
  }

  if (saved) return (
    <div className="mt-6 bg-emerald-50 border border-emerald-200 rounded-xl px-5 py-4 text-sm text-emerald-800 font-medium">
      Result saved to tally.
    </div>
  )

  return (
    <div className="mt-6 bg-white border border-stone-200 rounded-2xl p-6">
      <h3 className="text-sm font-semibold text-stone-700 mb-4">Score this result</h3>
      <div className="mb-4">
        <label className="text-xs font-medium text-stone-400 uppercase tracking-widest block mb-2">Role label</label>
        <input className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg bg-stone-50 text-stone-800 focus:outline-none focus:border-stone-400" value={role} onChange={e => setRole(e.target.value)} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        {EVAL_DIMS.map(d => (
          <div key={d.id}>
            <label className="text-xs font-medium text-stone-400 uppercase tracking-widest block mb-1">{d.label}</label>
            <p className="text-xs text-stone-400 mb-2">{d.desc}</p>
            <ScoreButtons value={scores[d.id]} onChange={val => setScores(s => ({ ...s, [d.id]: val }))} />
          </div>
        ))}
      </div>
      <div className="mb-4">
        <label className="text-xs font-medium text-stone-400 uppercase tracking-widest block mb-2">Knowledge area accuracy</label>
        <div className="flex gap-2">
          {FW_OPTIONS.map(o => (
            <button key={o.id} onClick={() => setFw(o.id)} className={`flex-1 py-2 text-xs font-medium rounded-lg border transition-colors ${fw === o.id ? o.id === 'onet' ? 'bg-teal-50 border-teal-300 text-teal-700' : o.id === 'soc_minor' ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : o.id === 'equal' ? 'bg-amber-50 border-amber-300 text-amber-700' : 'bg-red-50 border-red-300 text-red-700' : 'bg-white border-stone-200 text-stone-400 hover:border-stone-300'}`}>
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <div className="mb-5">
        <label className="text-xs font-medium text-stone-400 uppercase tracking-widest block mb-2">Notes</label>
        <textarea className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg bg-stone-50 text-stone-800 focus:outline-none focus:border-stone-400 resize-y min-h-16" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Specific issues, things to revisit..." />
      </div>
      <button onClick={submit} className="px-5 py-2 bg-stone-900 text-white text-sm font-medium rounded-lg">Save to tally</button>
    </div>
  )
}

// ─── Tally + Entries tabs ─────────────────────────────────────────────────────

function ScorePill({ n }) {
  const colors = { 1: 'bg-red-50 text-red-700', 2: 'bg-amber-50 text-amber-700', 3: 'bg-emerald-50 text-emerald-700' }
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${colors[n] || 'bg-stone-100 text-stone-500'}`}>{n} {SCORE_LABELS[n]}</span>
}

function FwPill({ fw }) {
  const map = { onet: 'bg-teal-50 text-teal-700', equal: 'bg-amber-50 text-amber-700', neither: 'bg-red-50 text-red-700' }
  const labels = { onet: 'O*NET accurate', equal: 'About right', neither: 'Neither' }
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${map[fw] || 'bg-stone-100 text-stone-500'}`}>{labels[fw] || fw}</span>
}

function TallyTab({ entries, onDelete }) {
  if (!entries.length) return <div className="text-center py-16 text-stone-400 text-sm">No results yet.</div>
  const n = entries.length
  const avg = dim => (entries.reduce((s, e) => s + (e.scores[dim] || 0), 0) / n).toFixed(1)
  const fwCounts = { onet: 0, equal: 0, neither: 0 }
  entries.forEach(e => { if (fwCounts[e.scores.framework] !== undefined) fwCounts[e.scores.framework]++ })

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-white border border-stone-200 rounded-xl p-4">
          <p className="text-xs font-medium uppercase tracking-widest text-stone-400 mb-1">Resumes</p>
          <p className="text-3xl font-semibold text-stone-900">{n}</p>
        </div>
        {EVAL_DIMS.map(d => {
          const a = parseFloat(avg(d.id))
          const color = a >= 2.5 ? 'bg-emerald-500' : a >= 1.8 ? 'bg-amber-400' : 'bg-red-400'
          return (
            <div key={d.id} className="bg-white border border-stone-200 rounded-xl p-4">
              <p className="text-xs font-medium uppercase tracking-widest text-stone-400 mb-1">{d.label}</p>
              <p className="text-2xl font-semibold text-stone-900">{avg(d.id)}<span className="text-sm text-stone-300">/3</span></p>
              <div className="mt-2 h-1 bg-stone-100 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${color}`} style={{ width: `${a / 3 * 100}%` }} />
              </div>
            </div>
          )
        })}
      </div>
      {n >= 2 && (
        <div className="bg-white border border-stone-200 rounded-xl p-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-stone-400 mb-3">Knowledge area framework</p>
          <div className="flex gap-3 flex-wrap">
            {FW_OPTIONS.map(o => (
              <div key={o.id} className="text-sm"><FwPill fw={o.id} /> <span className="text-stone-500 ml-1">{fwCounts[o.id]} result{fwCounts[o.id] !== 1 ? 's' : ''}</span></div>
            ))}
          </div>
        </div>
      )}
      <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-stone-100"><p className="text-sm font-semibold text-stone-700">Results log</p></div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-stone-50 border-b border-stone-100">
                {['Date','Role','Knowledge Area','Years','Function','Industry','Framework',''].map(h => (
                  <th key={h} className="text-left px-4 py-2.5 font-medium text-stone-400 uppercase tracking-widest">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map(e => (
                <>
                  <tr key={e.id} className="border-b border-stone-50 hover:bg-stone-50">
                    <td className="px-4 py-2.5 text-stone-400 whitespace-nowrap">{e.date}</td>
                    <td className="px-4 py-2.5 font-medium text-stone-700 max-w-32 truncate">{e.role}</td>
                    <td className="px-4 py-2.5"><ScorePill n={e.scores.fields} /></td>
                    <td className="px-4 py-2.5"><ScorePill n={e.scores.years} /></td>
                    <td className="px-4 py-2.5"><ScorePill n={e.scores.function} /></td>
                    <td className="px-4 py-2.5"><ScorePill n={e.scores.industry} /></td>
                    <td className="px-4 py-2.5"><FwPill fw={e.scores.framework} /></td>
                    <td className="px-4 py-2.5"><button onClick={() => onDelete(e.id)} className="text-stone-300 hover:text-red-400 text-base">x</button></td>
                  </tr>
                  {e.notes && <tr key={`${e.id}-n`} className="border-b border-stone-50"><td /><td colSpan={7} className="px-4 pb-2.5 text-stone-400 italic">↳ {e.notes}</td></tr>}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function EntriesTab({ entries, onDelete, onClearAll }) {
  const [confirmId, setConfirmId] = useState(null)
  const [confirmClear, setConfirmClear] = useState(false)

  const handleDelete = id => {
    if (confirmId === id) { onDelete(id); setConfirmId(null) }
    else setConfirmId(id)
  }

  if (!entries.length) return <div className="text-center py-16 text-stone-400 text-sm">No entries yet.</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-stone-500">{entries.length} {entries.length !== 1 ? 'entries' : 'entry'}</p>
        {confirmClear
          ? <div className="flex items-center gap-2">
              <span className="text-xs text-red-500">Are you sure?</span>
              <button onClick={() => { onClearAll(); setConfirmClear(false) }} className="text-xs px-3 py-1.5 bg-red-500 text-white rounded-lg">Yes, clear all</button>
              <button onClick={() => setConfirmClear(false)} className="text-xs px-3 py-1.5 border border-stone-200 text-stone-500 rounded-lg">Cancel</button>
            </div>
          : <button onClick={() => setConfirmClear(true)} className="text-xs px-3 py-1.5 border border-red-200 text-red-500 rounded-lg hover:bg-red-50">Clear all data</button>
        }
      </div>
      {entries.map(e => (
        <div key={e.id} className="bg-white border border-stone-200 rounded-xl overflow-hidden">
          <div className="flex items-start justify-between px-5 py-4 border-b border-stone-100">
            <div>
              <p className="text-sm font-semibold text-stone-800">{e.role}</p>
              <p className="text-xs text-stone-400 mt-0.5">{e.date}</p>
            </div>
            {confirmId === e.id
              ? <div className="flex items-center gap-2 ml-4 shrink-0">
                  <span className="text-xs text-red-500">Delete?</span>
                  <button onClick={() => handleDelete(e.id)} className="text-xs px-2 py-1 bg-red-500 text-white rounded-md">Yes</button>
                  <button onClick={() => setConfirmId(null)} className="text-xs px-2 py-1 border border-stone-200 text-stone-500 rounded-md">No</button>
                </div>
              : <button onClick={() => handleDelete(e.id)} className="text-stone-300 hover:text-red-400 text-xl leading-none ml-4 shrink-0">x</button>
            }
          </div>
          <div className="px-5 py-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-3">
              {EVAL_DIMS.map(d => (
                <div key={d.id}>
                  <p className="text-xs text-stone-400 mb-1">{d.label}</p>
                  <ScorePill n={e.scores[d.id]} />
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <p className="text-xs text-stone-400">Framework</p>
              <FwPill fw={e.scores.framework} />
            </div>
            {e.notes && <p className="text-xs text-stone-400 italic mt-3 pt-3 border-t border-stone-100">"{e.notes}"</p>}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Main app ─────────────────────────────────────────────────────────────────

const CORRECT_PASSWORD = 'tinynet2025'

const CLASSIFIER_TABS = ['classify', 'overview', 'edit', 'recruiter']
const TAB_LABELS = { classify: '1. Classify', overview: '2. Overview', edit: '3. Edit', recruiter: '4. Review & score' }
const TOP_TABS = ['classifier', 'tally', 'entries']

export default function TinyNet() {
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem('tn_unlocked') === 'true')
  const [pwInput, setPwInput]   = useState('')
  const [pwError, setPwError]   = useState(false)

  const submitPassword = () => {
    if (pwInput.trim().toLowerCase() === CORRECT_PASSWORD) {
      sessionStorage.setItem('tn_unlocked', 'true')
      setUnlocked(true)
      setPwError(false)
    } else {
      setPwError(true)
      setPwInput('')
    }
  }

  const [topTab, setTopTab]   = useState('classifier')
  const [tab, setTab]         = useState('classify')
  const [enabled, setEnabled] = useState(new Set(['classify']))

  const [resumeText, setResumeText] = useState('')
  const [loading, setLoading]       = useState(false)
  const [loadingMsg, setLoadingMsg] = useState('')
  const [error, setError]           = useState('')

  const [shared, setShared]   = useState(null)
  const [onetResult, setOnet] = useState(null)
  const [socMinorResult, setSocMinor] = useState(null)
  const [profile, setProfile] = useState(null)
  const [entries, setEntries] = useState([])

  useEffect(() => {
    async function load() {
      try {
        const r = await window.storage.get('tinynet_eval_v1')
        if (r) setEntries(JSON.parse(r.value))
      } catch(e) { setEntries([]) }
    }
    load()
  }, [])

  async function persist(next) {
    try { await window.storage.set('tinynet_eval_v1', JSON.stringify(next)) } catch(e) {}
  }

  const enable = (...tabs) => setEnabled(prev => { const s = new Set(prev); tabs.forEach(t => s.add(t)); return s })

  const classify = useCallback(async () => {
    if (!resumeText.trim()) { setError('Paste a resume first.'); return }
    setLoading(true); setError('')
    try {
      const prompt = 'Classify this resume:\n\n' + resumeText
      setLoadingMsg('Extracting shared dimensions...')
      const sharedData = await callAPI(SHARED_SYSTEM, prompt)
      const totalYears = sharedData.total_years || 0
      setLoadingMsg('Classifying knowledge areas — O*NET + SOC in parallel...')
      const [onetData, socMinorData] = await Promise.all([
        callAPI(buildOnetSystem(totalYears), prompt),
        callAPI(buildSocMinorSystem(totalYears), prompt),
      ])
      sharedData.industries   = normalizeYears(sharedData.industries, totalYears)
      sharedData.functions    = normalizeYears(sharedData.functions,  totalYears)
      onetData.fields         = normalizeYears(onetData.fields,       totalYears)
      socMinorData.fields     = normalizeYears(socMinorData.fields,   totalYears)
      setShared(sharedData)
      setOnet(onetData)
      setSocMinor(socMinorData)
      setLoadingMsg('')
      enable('overview'); setTab('overview')
    } catch(e) { setError('Classification failed: ' + e.message) }
    setLoading(false)
  }, [resumeText])

  const applyAndEdit = (fw) => {
    const fields = fw === 'soc_minor' ? socMinorResult.fields : onetResult.fields
    setProfile({ ...shared, fields, _framework: fw === 'soc_minor' ? 'SOC Minor Groups' : 'O*NET' })
    enable('edit'); setTab('edit')
  }

  const goToRecruiter = () => { enable('recruiter'); setTab('recruiter') }

  const saveEntry = async entry => {
    const next = [entry, ...entries]; setEntries(next); await persist(next)
  }
  const deleteEntry = async id => {
    const next = entries.filter(e => e.id !== id); setEntries(next); await persist(next)
  }
  const clearAll = async () => { setEntries([]); await persist([]) }

  if (!unlocked) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center px-4" style={{ fontFamily: "'DM Sans','Inter',sans-serif" }}>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet" />
        <div className="bg-white border border-stone-200 rounded-2xl p-8 w-full max-w-sm">
          <h1 className="text-xl font-semibold text-stone-900 tracking-tight mb-1">TinyNet</h1>
          <p className="text-sm text-stone-400 mb-6">Resume taxonomy classifier · early access</p>
          <input
            type="password"
            className="w-full px-4 py-2.5 text-sm border border-stone-200 rounded-xl bg-stone-50 text-stone-800 focus:outline-none focus:border-stone-400 mb-3"
            placeholder="Enter password"
            value={pwInput}
            onChange={e => { setPwInput(e.target.value); setPwError(false) }}
            onKeyDown={e => e.key === 'Enter' && submitPassword()}
            autoFocus
          />
          {pwError && <p className="text-xs text-red-500 mb-3">Incorrect password — try again</p>}
          <button
            onClick={submitPassword}
            className="w-full py-2.5 bg-stone-900 text-white text-sm font-medium rounded-xl hover:opacity-85"
          >
            Enter
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-stone-50">
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet" />
      <div className="max-w-4xl mx-auto px-4 py-8" style={{ fontFamily: "'DM Sans','Inter',sans-serif" }}>

        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">TinyNet</h1>
          <p className="text-sm text-stone-400 mt-1">Resume taxonomy classifier</p>
        </div>

        <div className="flex border-b border-stone-200 mb-6">
          {TOP_TABS.map(t => (
            <button key={t} onClick={() => setTopTab(t)} className={`text-sm px-5 py-2.5 border-b-2 transition-colors ${topTab === t ? 'border-stone-900 text-stone-900 font-medium' : 'border-transparent text-stone-400 hover:text-stone-600'}`}>
              {t === 'tally' ? 'Tally' + (entries.length ? ' (' + entries.length + ')' : '') : t === 'entries' ? 'Entries' : 'Classifier'}
            </button>
          ))}
        </div>

        {topTab === 'tally'   && <TallyTab entries={entries} onDelete={deleteEntry} />}
        {topTab === 'entries' && <EntriesTab entries={entries} onDelete={deleteEntry} onClearAll={clearAll} />}

        {topTab === 'classifier' && (
          <>
            <div className="flex border-b border-stone-100 mb-6">
              {CLASSIFIER_TABS.map(t => (
                <button key={t} disabled={!enabled.has(t)} onClick={() => setTab(t)} className={`text-xs px-4 py-2 border-b-2 transition-colors ${tab === t ? 'border-stone-700 text-stone-700 font-medium' : enabled.has(t) ? 'border-transparent text-stone-400 hover:text-stone-500' : 'border-transparent text-stone-200 cursor-not-allowed'}`}>
                  {TAB_LABELS[t]}
                </button>
              ))}
            </div>

            {tab === 'classify' && (
              <div>
                <p className="text-sm text-stone-500 mb-4">Paste a resume. Claude will classify using O*NET knowledge areas with evidence justification for every tag.</p>
                <textarea className="w-full min-h-52 px-4 py-3 text-sm font-mono border border-stone-200 rounded-xl bg-white text-stone-800 focus:outline-none focus:border-stone-400 resize-y leading-relaxed" placeholder="Paste resume text here..." value={resumeText} onChange={e => setResumeText(e.target.value)} />
                <div className="flex items-center gap-4 mt-3">
                  <button onClick={classify} disabled={loading} className="px-5 py-2 bg-stone-900 text-white text-sm font-medium rounded-lg disabled:opacity-40">
                    {loading ? 'Classifying...' : 'Classify resume'}
                  </button>
                  {loadingMsg && <span className="text-sm text-stone-400">{loadingMsg}</span>}
                  {error && <span className="text-sm text-red-500">{error}</span>}
                </div>
              </div>
            )}

            {tab === 'overview' && shared && onetResult && socMinorResult && (
              <div>
                {/* Shared dimensions */}
                <div className="bg-white border border-stone-200 rounded-xl p-5 mb-4">
                  <p className="text-xs font-semibold uppercase tracking-widest text-stone-400 mb-4">Shared across all frameworks</p>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
                    <div>
                      <p className="text-xs text-stone-400 mb-1">Seniority</p>
                      <p className="text-sm font-semibold text-stone-800">{getSeniority(shared.total_years)} · {shared.total_years}y total</p>
                    </div>
                    <div className="md:col-span-2">
                      <p className="text-xs text-stone-400 mb-1">Summary</p>
                      <p className="text-sm text-stone-700">{shared.summary}</p>
                    </div>
                    <div>
                      <p className="text-xs text-stone-400 mb-2">Function</p>
                      <div className="flex flex-wrap gap-1">
                        {(shared.functions || []).map((fn, i) => {
                          const name = typeof fn === 'string' ? fn : fn.name
                          const years = typeof fn === 'object' ? fn.years : null
                          return <span key={i} className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full border border-indigo-100">{getSeniority(years)} {name} · {years}y</span>
                        })}
                      </div>
                    </div>
                    <div className="md:col-span-2">
                      <p className="text-xs text-stone-400 mb-2">Industry (NAICS)</p>
                      <div className="flex flex-wrap gap-1">
                        {(shared.industries || []).map((ind, i) => <span key={i} className="text-xs bg-teal-50 text-teal-700 px-2 py-0.5 rounded-full border border-teal-100">{ind.name} {ind.years}y</span>)}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 3-way comparison */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  {[
                    { key: 'onet', label: 'O*NET', sub: 'Knowledge Areas', data: onetResult, badge: 'bg-teal-50 text-teal-700 border-teal-100' },
                    { key: 'soc_minor', label: 'SOC Minor Groups', sub: '2018 Standard Occupational Classification', data: socMinorResult, badge: 'bg-indigo-50 text-indigo-700 border-indigo-100' },
                  ].map(fw => (
                    <div key={fw.key} className="bg-white border border-stone-200 rounded-xl p-5">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${fw.badge}`}>{fw.label}</span>
                          <p className="text-xs text-stone-400 mt-1.5">{fw.sub}</p>
                        </div>
                      </div>
                      <p className="text-xs font-semibold uppercase tracking-widest text-stone-400 mb-2">Knowledge Areas</p>
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {(fw.data?.fields || []).map((f, i) => (
                          <span key={i} className="text-xs px-2.5 py-1 bg-stone-100 text-stone-700 rounded-lg border border-stone-200">{f.name} <span className="text-stone-400">{f.years}y</span></span>
                        ))}
                      </div>
                      <button onClick={() => applyAndEdit(fw.key)} className="w-full mt-2 py-2 text-xs font-medium border border-stone-200 rounded-lg text-stone-600 hover:bg-stone-50">
                        Use {fw.label} →
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === 'edit' && profile && (
              <div className="space-y-6">
                <div className="bg-stone-100 border border-stone-200 rounded-xl px-4 py-3 text-sm text-stone-500">AI draft loaded using <span className="font-semibold text-stone-700">{profile._framework || 'O*NET'}</span>. Edit anything that looks wrong.</div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="md:col-span-2">
                    <label className="text-xs font-semibold uppercase tracking-widest text-stone-400 block mb-2">Summary</label>
                    <input className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg bg-white text-stone-800 focus:outline-none focus:border-stone-400" value={profile.summary || ''} onChange={e => setProfile(p => ({ ...p, summary: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-widest text-stone-400 block mb-2">Total years</label>
                    <input type="number" min="0" max="50" className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg bg-white text-stone-800 focus:outline-none focus:border-stone-400" value={profile.total_years || ''} onChange={e => setProfile(p => ({ ...p, total_years: Number(e.target.value) }))} />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold uppercase tracking-widest text-stone-400 block mb-2">Strengths</label>
                  <textarea className="w-full min-h-16 px-3 py-2 text-sm border border-stone-200 rounded-lg bg-white text-stone-800 focus:outline-none focus:border-stone-400 resize-y" value={profile.strengths || ''} onChange={e => setProfile(p => ({ ...p, strengths: e.target.value }))} placeholder="What genuinely sets this candidate apart..." />
                </div>

                <div>
                  <label className="text-xs font-semibold uppercase tracking-widest text-stone-400 block mb-3">Function <span className="normal-case tracking-normal font-normal text-stone-300">(select all that apply)</span></label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {FUNCTION_LEVELS.map(fn => {
                      const existing = (profile.functions || []).find(f => (typeof f === 'string' ? f : f.name) === fn.label)
                      const checked = !!existing
                      return (
                        <label key={fn.id} className={`flex items-start gap-3 px-4 py-3 rounded-xl border cursor-pointer ${checked ? 'bg-indigo-50 border-indigo-200' : 'bg-white border-stone-200 hover:border-stone-300'}`}>
                          <input type="checkbox" checked={checked} className="mt-0.5 shrink-0" onChange={e => setProfile(p => ({ ...p, functions: e.target.checked ? [...(p.functions || []), { name: fn.label, years: 0, evidence: '' }] : (p.functions || []).filter(f => (typeof f === 'string' ? f : f.name) !== fn.label) }))} />
                          <div className="flex-1">
                            <p className={`text-sm font-medium ${checked ? 'text-indigo-800' : 'text-stone-700'}`}>{fn.label}</p>
                            <p className="text-xs text-stone-400 mt-0.5">{fn.description}</p>
                            {checked && (
                              <div className="flex items-center gap-1.5 mt-2">
                                <input type="number" min="0" max="50" step="0.5" placeholder="yrs" className="w-16 px-2 py-1 text-xs border border-indigo-200 rounded bg-white text-indigo-800 focus:outline-none" value={existing?.years || ''} onClick={e => e.stopPropagation()} onChange={e => setProfile(p => ({ ...p, functions: (p.functions || []).map(f => (typeof f === 'string' ? f : f.name) === fn.label ? { ...f, years: Number(e.target.value) } : f) }))} />
                                <span className="text-xs text-indigo-400">years</span>
                              </div>
                            )}
                          </div>
                        </label>
                      )
                    })}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold uppercase tracking-widest text-stone-400 block mb-2">Knowledge Area / Discipline <span className="normal-case tracking-normal font-normal text-stone-300">(O*NET)</span></label>
                  <DomainEditor items={profile.fields || []} onChange={fields => setProfile(p => ({ ...p, fields }))} placeholder="Knowledge area" />
                </div>

                <div>
                  <label className="text-xs font-semibold uppercase tracking-widest text-stone-400 block mb-2">Industry <span className="normal-case tracking-normal font-normal text-stone-300">(NAICS)</span></label>
                  <DomainEditor items={profile.industries || []} onChange={industries => setProfile(p => ({ ...p, industries }))} placeholder="Industry sector" />
                </div>

                <div>
                  <label className="text-xs font-semibold uppercase tracking-widest text-stone-400 block mb-2">Tools &amp; methods <span className="normal-case tracking-normal font-normal text-stone-300">(comma-separated)</span></label>
                  <input className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg bg-white text-stone-800 focus:outline-none focus:border-stone-400" value={(profile.tools || []).join(', ')} onChange={e => setProfile(p => ({ ...p, tools: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }))} />
                </div>

                <div>
                  <label className="text-xs font-semibold uppercase tracking-widest text-stone-400 block mb-2">Education &amp; credentials</label>
                  <CredentialEditor items={profile.credentials || []} onChange={credentials => setProfile(p => ({ ...p, credentials }))} />
                </div>

                <div className="flex gap-3">
                  <button onClick={goToRecruiter} className="px-5 py-2 bg-stone-900 text-white text-sm font-medium rounded-lg">Save &amp; preview</button>
                  <button onClick={() => setTab('overview')} className="px-4 py-2 text-sm border border-stone-200 rounded-lg text-stone-500 hover:bg-stone-50">Back</button>
                </div>
              </div>
            )}

            {tab === 'recruiter' && profile && (
              <div>
                <div className="bg-stone-100 border border-stone-200 rounded-xl px-4 py-3 mb-5 text-sm text-stone-500">
                  <span className="font-semibold text-stone-700">Recruiter view</span> — click any row to see the evidence. Score below to add to tally.
                </div>
                <RecruiterCard profile={profile} framework={profile._framework || 'O*NET'} />
                <EvalForm profile={profile} onSave={saveEntry} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
