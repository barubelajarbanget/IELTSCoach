// Adds fresh question sets to data/questions.json using the Gemini API.
// Every multiple-choice set is checked by a second, independent pass before it is saved.
import fs from 'node:fs';
const KEY=process.env.GEMINI_API_KEY,MODEL=process.env.GEMINI_MODEL||'gemini-2.5-flash',CALLS=+(process.env.CALLS||16),DELAY=+(process.env.DELAY||7000),VERIFY=process.env.VERIFY!='0',KEEP=40,FILE='data/questions.json';
if(!KEY){console.log('No GEMINI_API_KEY secret; skipping.');process.exit(0)}
const ST=['A1–A2 (beginner)','B1 (pre-intermediate)','B1+ (intermediate)','B2 (upper-intermediate)','B2+ / C1','C1'];
const TOPICS=['education','environment','technology','health','urban life','work and careers','travel','science','culture','media','business','sport','food','history','housing','energy','language learning','social media','transport','economics'];
const pick=a=>a[Math.floor(Math.random()*a.length)],shuf=a=>[...a].sort(()=>Math.random()-.5),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const M='{"title":"..","text":"..","questions":[{"q":"..","options":["..",".."],"answer":0,"why":"short English explanation"}]}';
const P={
reading:l=>`Write an IELTS-style reading passage (200-350 words) in "text", then 6 questions mixing 4-option multiple choice and True/False/Not Given (options exactly ["True","False","Not Given"]). Level ${l}. Schema: ${M}`,
listening:l=>`Write a natural spoken script (dialogue or monologue, 150-250 words) in "text", then 5 multiple-choice detail questions. Level ${l}. Schema: ${M}`,
vocab:l=>`Create 8 vocabulary questions (word in context, synonyms, collocations) for level ${l}; "text" is a one-line instruction. Schema: ${M}`,
grammar:l=>`Create 8 grammar questions (error choice, tenses, articles, prepositions) for level ${l}; "text" is a one-line instruction. Schema: ${M}`,
writing:l=>`Create one IELTS-style writing task for level ${l}. Schema: {"title":"..","text":"task prompt","words":150}`,
speaking:l=>`Create one IELTS speaking task for level ${l} (Part 1 questions, or a Part 2 cue card for B2+). Schema: {"title":"..","text":"prompt","words":100}`};
const prod=sk=>sk=='writing'||sk=='speaking';
const ok=(sk,d)=>d&&typeof d=='object'&&(prod(sk)?!!d.text:Array.isArray(d.questions)&&d.questions.length>=4&&d.questions.every(q=>q&&typeof q.q=='string'&&Array.isArray(q.options)&&q.options.length>1&&Number.isInteger(q.answer)&&q.answer>=0&&q.answer<q.options.length));
async function gem(prompt){
 for(let t=0;t<2;t++){
  const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':KEY},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{responseMimeType:'application/json'}})});
  if(r.status==429&&t==0){console.log('HTTP 429, waiting');await sleep(DELAY*4);continue}
  if(!r.ok){console.log('HTTP',r.status);return null}
  const j=await r.json();return JSON.parse(String(j.candidates[0].content.parts[0].text).replace(/```json|```/g,'').trim())}
 return null}
// Second pass: the model answers the questions without seeing the key (options shuffled). Disagreements are dropped.
async function verify(sk,d){
 const qs=d.questions.map(q=>{const fixed=q.options.length==3&&q.options[0]=='True'&&q.options[2]=='Not Given',idx=q.options.map((_,i)=>i);return{q,order:fixed?idx:shuf(idx)}});
 const body=qs.map((x,i)=>`Q${i+1}. ${x.q.q}\n`+x.order.map((oi,k)=>`  ${k}) ${x.q.options[oi]}`).join('\n')).join('\n\n');
 const r=await gem(`You are an expert IELTS examiner. Answer every question yourself, independently and carefully.${sk=='reading'||sk=='listening'?'\n\nText:\n'+d.text:''}\n\n${body}\n\nReturn ONLY JSON: {"answers":[n1,n2,...]} where each n is the number shown in front of the option you choose for that question, in order.`);
 if(!r||!Array.isArray(r.answers)||r.answers.length!=qs.length)return null;
 const keep=qs.filter((x,i)=>x.order[r.answers[i]]===x.q.answer).map(x=>x.q),need=Math.max(4,Math.ceil(qs.length*0.6));
 return keep.length>=need?{...d,questions:keep,_kept:`${keep.length}/${qs.length}`}:{_rejected:`${keep.length}/${qs.length}`}}
const bank=JSON.parse(fs.readFileSync(FILE,'utf8'));let added=0,rejected=0;
for(let i=0;i<CALLS;i++){const sk=pick(Object.keys(P)),st=Math.floor(Math.random()*ST.length);
 try{let d=await gem(`You are an expert IELTS examiner. Topic: ${pick(TOPICS)}. Seed ${Math.random()}. Return ONLY valid JSON. ${P[sk](ST[st])}`);
  if(!d||!ok(sk,d)){console.log('invalid or failed',sk,st);await sleep(DELAY);continue}
  if(VERIFY&&!prod(sk)){await sleep(DELAY);d=await verify(sk,d);
   if(!d||d._rejected){console.log('REJECTED by check',sk,st,d?d._rejected:'(check failed)');rejected++;await sleep(DELAY);continue}
   console.log('verified',sk,st,'kept',d._kept);delete d._kept}
  bank[sk]=bank[sk]||{};bank[sk][st]=[...(bank[sk][st]||[]),d].slice(-KEEP);added++;console.log('added',sk,st)}
 catch(e){console.log('error',sk,st,e.message)}
 await sleep(DELAY)}
fs.writeFileSync(FILE,JSON.stringify(bank));console.log('done, added',added,'rejected',rejected);
