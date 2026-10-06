
(function(){
  const MAX = 8; // 8-digit display like the real thing
  const outEls = document.querySelectorAll('.out');
  const miniEls = document.querySelectorAll('.mini');
  const histEl = document.getElementById('history');

  let current = '0';     // string shown
  let stored = null;     // number held
  let op = null;         // pending operator
  let freshEntry = true; // next digit starts a new number
  let lastOp = null, lastArg = null; // for repeated "="
  let errored = false;

  const opSym = {'+':'+','-':'−','*':'×','/':'÷'};

  function fmt(nStr){
    // nStr is a string number; clamp to MAX significant digits
    let n = Number(nStr);
    if(!isFinite(n)) return 'Error';
    if(Math.abs(n) >= 1e8){ return 'Error'; } // overflow like a real 8-digit unit
    // limit total digits to 8
    let s = nStr;
    if(s.indexOf('.')>=0){
      const digits = s.replace('-','').replace('.','').length;
      if(digits>MAX){
        const intDigits = Math.trunc(Math.abs(n)).toString().length;
        const dec = Math.max(0, MAX-intDigits);
        s = n.toFixed(dec);
        s = s.replace(/\.?0+$/,''); // trim trailing zeros
      }
    }
    return s;
  }

  function render(){
    outEls.forEach(el=>el.textContent = current);
    const m = (stored!==null && op) ? (fmt(String(stored))+' '+opSym[op]) : '';
    miniEls.forEach(el=>el.textContent = m);
    // highlight active operator across every skin
    document.querySelectorAll('button.op').forEach(b=>b.classList.remove('active'));
    if(op){ document.querySelectorAll(`button[data-op="${op}"]`).forEach(b=>b.classList.add('active')); }
  }

  function setError(){
    current='Error'; errored=true; stored=null; op=null; freshEntry=true; render();
  }

  function inputDigit(d){
    if(errored) clearAll();
    if(freshEntry){ current = (d==='0')?'0':d; freshEntry=false; }
    else{
      if(current==='0') current = d;
      else{
        const len = current.replace('-','').replace('.','').length;
        if(len>=MAX) return;
        current += d;
      }
    }
    render();
  }

  function inputDot(){
    if(errored) clearAll();
    if(freshEntry){ current='0.'; freshEntry=false; }
    else if(current.indexOf('.')<0) current += '.';
    render();
  }

  function toggleSign(){
    if(errored) return;
    if(current==='0') return;
    current = current.startsWith('-') ? current.slice(1) : '-'+current;
    render();
  }

  function percent(){
    if(errored) return;
    let val = Number(current);
    // percent of the stored operand if mid-operation, else of itself
    if(stored!==null && op){ val = stored * (val/100); }
    else { val = val/100; }
    current = fmt(String(val));
    freshEntry = true;
    render();
  }

  function compute(a,b,o){
    switch(o){
      case '+':return a+b;
      case '-':return a-b;
      case '*':return a*b;
      case '/':return b===0?NaN:a/b;
    }
  }

  function logHistory(expr,result,raw){
    const empty = histEl.querySelector('.empty');
    if(empty) empty.remove();
    const div = document.createElement('div');
    div.className='entry';
    let shown = result;
    if(raw!==undefined && isFinite(raw)){
      div.dataset.raw = String(raw);      // keep full precision so ≈ can re-round later
      shown = entryResult(raw);
    }
    div.innerHTML = expr+' = '+'<span class="res">'+shown+'</span>';
    div.title = 'click to add a note';
    histEl.appendChild(div);
    histEl.scrollTop = histEl.scrollHeight;
  }

  // ---- click a history line to scribble a margin note ----
  function editComment(cmt){
    cmt.focus();
    const range = document.createRange();
    range.selectNodeContents(cmt);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
  function addNoteTo(entry){
    let cmt = entry.querySelector('.cmt');
    if(!cmt){
      cmt = document.createElement('span');
      cmt.className = 'cmt';
      cmt.setAttribute('contenteditable','true'); // attribute, so it survives innerHTML save/restore
      cmt.setAttribute('spellcheck','false');
      entry.appendChild(cmt);
    }
    editComment(cmt);
  }
  histEl.addEventListener('click', e=>{
    if(histEl.classList.contains('selecting')) return; // select-modus vangt kliks af
    if(e.target.classList.contains('cmt')) return; // already editing
    const entry = e.target.closest('.entry');
    if(!entry) return;
    addNoteTo(entry);
  });
  // "n" — jump to the last calculation and start scribbling a note
  function noteLastEntry(){
    const entries = histEl.querySelectorAll('.entry');
    if(!entries.length){ addFreeNote(); return; } // nothing summed yet → loose note
    const last = entries[entries.length-1];
    histEl.scrollTop = histEl.scrollHeight;
    scrollToNotes();
    addNoteTo(last);
  }
  histEl.addEventListener('keydown', e=>{
    const isCmt  = e.target.classList.contains('cmt');
    const isFree = e.target.classList.contains('free');
    const isFx   = e.target.classList.contains('fx');
    if(!isCmt && !isFree && !isFx) return;
    if(e.key==='Escape'){ e.target.blur(); }
    // margin notes are one-liners; free notes may wrap onto new lines
    else if(e.key==='Enter' && isCmt){ e.preventDefault(); e.target.blur(); }
    // a formula line computes on Enter
    else if(e.key==='Enter' && isFx){ e.preventDefault(); runFormula(e.target); }
    e.stopPropagation();
  });
  histEl.addEventListener('blur', e=>{
    const cl = e.target.classList;
    if(cl && (cl.contains('cmt') || cl.contains('free') || cl.contains('fx'))
       && e.target.textContent.trim()===''){
      e.target.remove(); // drop empty notes
      if(!histEl.children.length) wipePad();
    }
  }, true);

  // ---- a note that needs no sum at all ----
  function addFreeNote(){
    const empty = histEl.querySelector('.empty');
    if(empty) empty.remove();
    const note = document.createElement('div');
    note.className = 'free';
    note.setAttribute('contenteditable','true'); // attribute, so it survives innerHTML save/restore
    note.setAttribute('spellcheck','false');
    histEl.appendChild(note);
    histEl.scrollTop = histEl.scrollHeight;
    editComment(note);
    try{ scrollToNotes(); }catch(err){}
  }

  // ---- a formula line: brackets, %, × ÷, comma decimals — Enter computes ----
  function addFormula(){
    const empty = histEl.querySelector('.empty');
    if(empty) empty.remove();
    const line = document.createElement('div');
    line.className = 'fx';
    line.setAttribute('contenteditable','true');
    line.setAttribute('spellcheck','false');
    histEl.appendChild(line);
    histEl.scrollTop = histEl.scrollHeight;
    editComment(line);
    try{ scrollToNotes(); }catch(err){}
  }

  // tiny recursive-descent parser: + − × ÷, brackets, postfix % (= ÷100)
  function evalExpr(str){
    let s = str.replace(/[×x]/gi,'*').replace(/÷/g,'/').replace(/−/g,'-')
               .replace(/,/g,'.');
    let i = 0;
    function skip(){ while(i<s.length && s[i]===' ') i++; }
    function num(){
      skip(); const st=i;
      while(i<s.length && /[0-9.]/.test(s[i])) i++;
      if(st===i) throw 0;
      const v=Number(s.slice(st,i));
      if(!isFinite(v)) throw 0;
      return v;
    }
    function post(v){ skip(); while(s[i]==='%'){ v=v/100; i++; skip(); } return v; }
    function primary(){
      skip();
      if(s[i]==='('){ i++; const v=expr(); skip(); if(s[i]!==')') throw 0; i++; return post(v); }
      if(s[i]==='-'){ i++; return -primary(); }
      if(s[i]==='+'){ i++; return primary(); }
      return post(num());
    }
    function term(){
      let v=primary();
      for(;;){ skip();
        if(s[i]==='*'){ i++; v*=primary(); }
        else if(s[i]==='/'){ i++; const d=primary(); if(d===0) throw 0; v/=d; }
        else return v;
      }
    }
    function expr(){
      let v=term();
      for(;;){ skip();
        if(s[i]==='+'){ i++; v+=term(); }
        else if(s[i]==='-'){ i++; v-=term(); }
        else return v;
      }
    }
    const v=expr(); skip();
    if(i<s.length) throw 0;
    return v;
  }

  function escHtml(t){
    const d=document.createElement('div'); d.textContent=t; return d.innerHTML;
  }

  // ---- rounding preference for ∑ results: '2' decimals (default) | '0' | 'off' ----
  const ROUND_KEY = 'commodore-calc:round';
  let roundMode = '2';
  try{
    const r = localStorage.getItem(ROUND_KEY);
    if(r==='0' || r==='off') roundMode = r;
  }catch(e){}
  function fmtResult(v){
    if(roundMode==='2')  return (Math.round((v + Math.sign(v)*Number.EPSILON)*100)/100).toFixed(2);
    if(roundMode==='0')  return String(Math.round(v));
    return String(Number(v.toPrecision(10)));
  }
  // calculator history lines: 'off' keeps the classic 8-digit look
  function entryResult(v){
    return roundMode==='off' ? fmt(String(v)) : fmtResult(v);
  }

  function runFormula(el, echo){
    if(echo===undefined) echo = true;
    // anything after the first '=' is an old result — recompute from scratch
    const raw = el.textContent.split('=')[0].trim();
    if(raw===''){ el.blur(); return; }
    try{
      const v = evalExpr(raw);
      if(!isFinite(v)) throw 0;
      const res = fmtResult(v);
      el.classList.remove('err');
      el.innerHTML = escHtml(raw)+' = <span class="res">'+escHtml(res)+'</span>';
      el.blur();
      // echo the outcome on the calculator display (8-digit limits apply)
      if(echo && Math.abs(v)<1e8 && window.calcAPI) window.calcAPI.setValue(Number(res));
      if(echo) histEl.scrollTop = histEl.scrollHeight;
    }catch(err){
      el.classList.add('err');
      el.innerHTML = escHtml(raw)+' = <span class="res">?</span>';
    }
  }

  // ---- wipe the pad (two taps, so a stray click costs nothing) ----
  function wipePad(){
    histEl.innerHTML = '<div class="empty">Your sums will appear here…</div>';
  }
  const padSumBtn  = document.getElementById('padSum');
  const padNoteBtn = document.getElementById('padNote');
  const padWipeBtn = document.getElementById('padWipe');
  if(padSumBtn)  padSumBtn.addEventListener('click', addFormula);
  if(padNoteBtn) padNoteBtn.addEventListener('click', addFreeNote);
  // ---- ≈ : cycle rounding (2 decimals → whole → off) and refresh old sums ----
  const padRoundBtn = document.getElementById('padRound');
  const roundLabels = {'2':'≈ 0.00','0':'≈ 0','off':'≈ off'};
  function paintRound(){ if(padRoundBtn) padRoundBtn.textContent = roundLabels[roundMode]; }
  if(padRoundBtn){
    padRoundBtn.addEventListener('click', ()=>{
      roundMode = roundMode==='2' ? '0' : roundMode==='0' ? 'off' : '2';
      try{ localStorage.setItem(ROUND_KEY, roundMode); }catch(e){}
      paintRound();
      // recompute every finished sum so old results follow the new setting
      histEl.querySelectorAll('.fx').forEach(el=>{
        if(el.textContent.indexOf('=')>=0) runFormula(el, false);
      });
      // …and the calculator's own history lines too
      histEl.querySelectorAll('.entry').forEach(el=>{
        const span = el.querySelector('.res'); if(!span) return;
        const raw = Number(el.dataset.raw!==undefined ? el.dataset.raw : span.textContent);
        if(!isFinite(raw)) return;           // skip 'Error' lines
        el.dataset.raw = String(raw);
        span.textContent = entryResult(raw);
      });
    });
    paintRound();
  }
  if(padWipeBtn){
    let armed = null;
    padWipeBtn.addEventListener('click', ()=>{
      if(armed){
        clearTimeout(armed); armed = null;
        padWipeBtn.classList.remove('armed');
        padWipeBtn.textContent = '✕ wipe';
        wipePad();
        return;
      }
      padWipeBtn.classList.add('armed');
      padWipeBtn.textContent = '✕ sure?';
      armed = setTimeout(()=>{
        armed = null;
        padWipeBtn.classList.remove('armed');
        padWipeBtn.textContent = '✕ wipe';
      }, 3000);
    });
  }

  function setOp(nextOp){
    if(errored) return;
    const val = Number(current);
    if(op && !freshEntry){
      // chain: evaluate pending first
      const r = compute(stored, val, op);
      if(!isFinite(r) || Math.abs(r)>=1e8){ setError(); return; }
      stored = Number(fmt(String(r)));
      current = fmt(String(r));
    } else if(stored===null){
      stored = val;
    } else {
      stored = val; // replaced operator without new entry
    }
    op = nextOp;
    freshEntry = true;
    render();
  }

  // ---- Kaprekar's routine easter egg ----
  function kaprekarEligible(str){
    if(str.indexOf('.')>=0 || str.startsWith('-')) return false;
    const n = parseInt(str,10);
    if(isNaN(n) || n<1000 || n>9999) return false;
    return new Set(String(n)).size>1;       // not a repdigit (1111, 2222…)
  }

  function runKaprekar(){
    const n = parseInt(current,10);
    const steps = [];
    let cur = n, guard = 0;
    while(cur!==6174 && guard<12){
      const d = String(cur).padStart(4,'0').split('').map(Number);
      const desc = d.slice().sort((a,b)=>b-a).join('');
      const asc  = d.slice().sort((a,b)=>a-b).join('');
      const diff = parseInt(desc,10) - parseInt(asc,10);
      const diffStr = String(diff).padStart(4,'0');
      steps.push([desc, asc, diffStr]);
      if(diff===0) break;
      cur = diff; guard++;
    }
    writeKaprekarNote(n, steps);
    current = '6174'; stored=null; op=null; freshEntry=true; render();
    scrollToNotes();
  }

  function writeKaprekarNote(n, steps){
    const notes = histEl;
    const empty = notes.querySelector('.empty');
    if(empty) empty.remove();
    const block = document.createElement('div');
    block.className = 'kap';
    let html = '<span class="head">✦ Kaprekar · '+n+'</span>\n';
    if(steps.length===0){
      html += 'already 6174 — the magic constant!';
    } else {
      steps.forEach((s,i)=>{
        const win = s[2]==='6174';
        html += (i+1)+') '+s[0]+' − '+s[1]+' = '
              + (win ? '<span class="win">'+s[2]+'  ✓</span>' : s[2]) + '\n';
      });
      html += '↳ reached 6174 in '+steps.length+(steps.length===1?' step':' steps')+'!';
    }
    block.innerHTML = html;
    notes.appendChild(block);
    notes.scrollTop = notes.scrollHeight;
  }

  // ---- Collatz conjecture easter egg (3n+1) ----
  function collatzEligible(str){
    if(str.indexOf('.')>=0 || str.startsWith('-')) return false;
    const n = parseInt(str,10);
    return !isNaN(n) && n>=2 && n<=999999;
  }

  function runCollatz(){
    const n = parseInt(current,10);
    const seq = [n];
    let cur = n, peak = n, guard = 0;
    while(cur!==1 && guard<2000){
      cur = (cur%2===0) ? cur/2 : 3*cur+1;
      seq.push(cur);
      if(cur>peak) peak = cur;
      guard++;
    }
    writeCollatzNote(n, seq, peak);
    current = '1'; stored=null; op=null; lastOp=null; lastArg=null;
    freshEntry=true; render();
    scrollToNotes();
  }

  function writeCollatzNote(n, seq, peak){
    const notes = histEl;
    const empty = notes.querySelector('.empty');
    if(empty) empty.remove();
    const block = document.createElement('div');
    block.className = 'colla';
    // long trips get their middle folded away so the pad stays readable
    const shown = (seq.length<=14)
      ? seq.join(' → ')
      : seq.slice(0,7).join(' → ') + ' → … → ' + seq.slice(-5).join(' → ');
    let html = '<span class="head">✦ Collatz · '+n+'</span>\n';
    html += shown.replace(/1$/, '<span class="win">1  ✓</span>')+'\n';
    html += '↳ '+(seq.length-1)+' steps · peak '+peak.toLocaleString('en-US')+'\n';
    html += 'even → n÷2 · odd → 3n+1\nalways lands on 1 — still nobody can prove it';
    block.innerHTML = html;
    notes.appendChild(block);
    notes.scrollTop = notes.scrollHeight;
  }

  function scrollToNotes(){
    const stage = document.querySelector('.stage');
    if(window.matchMedia('(max-width:860px)').matches){
      const pad = document.querySelector('.left-pad');
      const target = pad.offsetLeft-(stage.clientWidth-pad.clientWidth)/2;
      stage.scrollTo({left:Math.max(0,target),behavior:'smooth'});
    }
  }

  // ---- Perfect-number easter egg ----
  // returns sorted proper divisors if n is perfect, else null
  function perfectDivisors(str){
    if(str.indexOf('.')>=0 || str.startsWith('-')) return null;
    const n = parseInt(str,10);
    if(isNaN(n) || n<2) return null;
    let sum = 1, divs = [1];
    for(let i=2; i*i<=n; i++){
      if(n%i===0){
        const j = n/i;
        divs.push(i); sum += i;
        if(j!==i){ divs.push(j); sum += j; }
      }
    }
    if(sum===n){ divs.sort((a,b)=>a-b); return divs; }
    return null;
  }

  function runPerfect(divs){
    const n = parseInt(current,10);
    writePerfectNote(n, divs);
    freshEntry = true; render();
    scrollToNotes();
  }

  function writePerfectNote(n, divs){
    const order = {6:'1st',28:'2nd',496:'3rd',8128:'4th',33550336:'5th'};
    const notes = histEl;
    const empty = notes.querySelector('.empty');
    if(empty) empty.remove();
    const block = document.createElement('div');
    block.className = 'perf';
    let html = '<span class="head">✦ Perfect · '+n+'</span>\n';
    html += divs.join(' + ')+' = <span class="win">'+n+'  ✓</span>\n';
    html += n+' equals the sum of its own divisors';
    if(order[n]) html += '\n('+order[n]+' perfect number)';
    block.innerHTML = html;
    notes.appendChild(block);
    notes.scrollTop = notes.scrollHeight;
  }

  function equals(){
    if(errored) return;
    // lone-number easter eggs (perfect numbers take priority over Kaprekar)
    if(!op && lastOp===null){
      const divs = perfectDivisors(current);
      if(divs){ runPerfect(divs); return; }
      if(kaprekarEligible(current)){ runKaprekar(); return; }
      if(collatzEligible(current)){ runCollatz(); return; }
    }
    let a,b,o;
    if(op){
      a = stored; b = Number(current); o = op;
      lastOp = op; lastArg = b;
    } else if(lastOp!==null){
      a = Number(current); b = lastArg; o = lastOp; // repeat last op on =
    } else {
      return;
    }
    const r = compute(a,b,o);
    if(!isFinite(r) || Math.abs(r)>=1e8){ logHistory(fmt(String(a))+' '+opSym[o]+' '+fmt(String(b)), 'Error'); setError(); return; }
    const rStr = fmt(String(r));
    logHistory(fmt(String(a))+' '+opSym[o]+' '+fmt(String(b)), rStr, r);
    current = rStr;
    stored = null;
    op = null;
    freshEntry = true;
    render();
  }

  function clearEntry(){
    if(errored){ clearAll(); return; }
    current='0'; freshEntry=true; render();
  }
  function clearAll(){
    current='0'; stored=null; op=null; freshEntry=true; errored=false;
    lastOp=null; lastArg=null;
    render();
  }

  // "c" — quick clean: fresh sheet of paper AND a reset calculator
  function quickClean(){
    clearAll();
    histEl.innerHTML = '<div class="empty">Your sums will appear here…</div>';
  }

  // click handling
  document.getElementById('deck').addEventListener('click',e=>{
    const b = e.target.closest('button'); if(!b) return;
    if(b.dataset.num!==undefined) inputDigit(b.dataset.num);
    else if(b.dataset.op) setOp(b.dataset.op);
    else switch(b.dataset.act){
      case 'dot':inputDot();break;
      case 'sign':toggleSign();break;
      case 'percent':percent();break;
      case 'clear':clearAll();break;
      case 'clearEntry':clearEntry();break;
      case 'equals':equals();break;
    }
  });

  // keyboard handling
  window.addEventListener('keydown',e=>{
    // don't hijack typing in a margin note on the pad
    const ae = document.activeElement;
    if(ae && (ae.classList.contains('cmt') || ae.classList.contains('free') || ae.classList.contains('fx'))) return;
    const k = e.key;
    if(k>='0'&&k<='9'){ inputDigit(k); e.preventDefault(); }
    else if(k==='.'){ inputDot(); e.preventDefault(); }
    else if(k==='+'||k==='-'||k==='*'||k==='/'){ setOp(k); e.preventDefault(); }
    else if(k==='Enter'||k==='='){ equals(); e.preventDefault(); }
    else if(k==='%'){ percent(); e.preventDefault(); }
    else if(k==='Escape'){ clearAll(); e.preventDefault(); }
    else if(k==='c'||k==='C'){ quickClean(); e.preventDefault(); }
    else if(k==='n'||k==='N'){ noteLastEntry(); e.preventDefault(); }
    else if(k==='m'||k==='M'){ addFreeNote(); e.preventDefault(); }
    else if(k==='s'||k==='S'){ addFormula(); e.preventDefault(); }
    else if(k==='Backspace'){
      if(!freshEntry && !errored){
        current = current.length<=1 || (current.length===2&&current.startsWith('-')) ? '0' : current.slice(0,-1);
        if(current===''||current==='-') current='0';
        render();
      }
      e.preventDefault();
    }
  });

  render();

  // tiny API for the Rekenmodule side rail (memory register)
  window.calcAPI = {
    getValue: () => current,
    setValue: (v) => {
      const n = Number(v); if(!isFinite(n)) return;
      current = fmt(String(n)); freshEntry = true; errored = false; render();
    }
  };

  // On phones the layout is a swipe carousel — start centered on the calculator.
  function centerCalc(){
    const stage=document.querySelector('.stage');
    if(window.matchMedia('(max-width:860px)').matches){
      const calc=document.querySelector('.calc-wrap');
      const target=calc.offsetLeft-(stage.clientWidth-calc.clientWidth)/2;
      stage.scrollLeft=Math.max(0,target);
    }
  }
  window.addEventListener('load',centerCalc);
  window.addEventListener('resize',centerCalc);
  window.addEventListener('orientationchange',()=>setTimeout(centerCalc,250));
  centerCalc();
})();


(function(){
  // ON/OFF slide switch — off means dead dark glass and no input
  const deck = document.querySelector('.deck');
  const switches = [...document.querySelectorAll('.pswitch')];
  function setPower(off){
    deck.classList.toggle('off', off);
    switches.forEach(s=>s.setAttribute('aria-checked', String(!off)));
    try{ localStorage.setItem('commodore-calc:power', off ? '1' : '0'); }catch(e){}
  }
  switches.forEach(s=>s.addEventListener('click', ()=>setPower(!deck.classList.contains('off'))));
  // swallow keyboard input while powered off
  document.addEventListener('keydown', function(e){
    if(deck.classList.contains('off')) e.stopImmediatePropagation();
  }, true);
  try{ if(localStorage.getItem('commodore-calc:power')==='1') setPower(true); }catch(e){}
})();


(function(){
  const deck   = document.getElementById('deck');
  const slides = [...deck.querySelectorAll('.face-slide')];
  const dots   = [...document.querySelectorAll('.skin-tag .dot')];
  const nameEl = document.getElementById('skinName');
  const names  = ['Commodore GL-997R','Lumon MDR Terminal','Nova\u00b770 Atomic','Rekenmodule 6174-28'];
  let idx = 0;
  function go(next){
    next = (next + slides.length) % slides.length;
    if(next === idx) return;
    slides.forEach((s,i)=>{
      s.classList.remove('is-active','is-prev','is-next');
      s.classList.add(i===next ? 'is-active' : (i<next ? 'is-prev' : 'is-next'));
    });
    dots.forEach((d,i)=>d.classList.toggle('on', i===next));
    nameEl.textContent = names[next];
    idx = next;
    try{ localStorage.setItem('commodore-calc:skin', String(next)); }catch(e){}
  }
  dots.forEach((d,i)=>d.addEventListener('click', ()=>go(i)));
  // trackpad / mouse wheel (vertical)
  let wheelLock = false;
  deck.addEventListener('wheel', function(e){
    if(Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    if(Math.abs(e.deltaY) < 6) return;
    e.preventDefault();
    if(wheelLock) return;
    wheelLock = true; setTimeout(()=>wheelLock=false, 520);
    go(idx + (e.deltaY > 0 ? 1 : -1));
  }, {passive:false});
  // touch: vertical swipe swaps skin, horizontal is left to the page carousel
  let sy=0, sx=0, tracking=false;
  deck.addEventListener('touchstart', function(e){
    const t=e.touches[0]; sy=t.clientY; sx=t.clientX; tracking=true;
  }, {passive:true});
  deck.addEventListener('touchend', function(e){
    if(!tracking) return; tracking=false;
    const t=e.changedTouches[0], dy=t.clientY-sy, dx=t.clientX-sx;
    if(Math.abs(dy) > 45 && Math.abs(dy) > Math.abs(dx)){
      go(idx + (dy < 0 ? 1 : -1));
    }
  }, {passive:true});
  // arrow keys
  window.addEventListener('keydown', function(e){
    if(e.key==='ArrowDown'){ go(idx+1); e.preventDefault(); }
    else if(e.key==='ArrowUp'){ go(idx-1); e.preventDefault(); }
  });
  try{ const s=parseInt(localStorage.getItem('commodore-calc:skin'),10); if(s>0 && s<slides.length) go(s); }catch(e){}
})();


(function(){
  // Persist the note pad (sums, margin notes, easter-egg blocks) between visits.
  const KEY='commodore-calc:history';
  const histEl=document.getElementById('history');
  if(!histEl) return;
  try{
    const saved=localStorage.getItem(KEY);
    if(saved && saved.trim()) histEl.innerHTML=saved;
    histEl.querySelectorAll('.picked').forEach(function(b){ b.classList.remove('picked'); });
  }catch(e){}
  let t=null;
  function save(){
    clearTimeout(t);
    t=setTimeout(()=>{ try{ localStorage.setItem(KEY, histEl.innerHTML); }catch(e){} }, 300);
  }
  new MutationObserver(save).observe(histEl,{childList:true,subtree:true,characterData:true});
})();


(function(){
  const face = document.querySelector('.face.reken');
  if(!face || !window.calcAPI) return;
  const memBtn = document.getElementById('rkMem');
  const memLbl = memBtn.querySelector('span');
  const sysBtn = document.getElementById('rkSys');
  const clkBtn = document.getElementById('rkClock');
  const clkLbl = clkBtn.querySelector('span');
  const flash  = document.getElementById('rkTime');

  /* ---- 047 : memory register ---- */
  let mem = null;
  try{
    const s = localStorage.getItem('commodore-calc:mem');
    if(s!==null && s!=='' && isFinite(Number(s))) mem = Number(s);
  }catch(e){}
  function saveMem(){ try{ localStorage.setItem('commodore-calc:mem', mem===null?'':String(mem)); }catch(e){} }
  function paintMem(){
    memBtn.classList.toggle('has-mem', mem!==null);
    memLbl.textContent = mem===null ? '047' : String(mem);
  }
  let clickTimer = null;
  memBtn.addEventListener('click', function(){
    clearTimeout(clickTimer);
    clickTimer = setTimeout(function(){
      if(mem===null){
        const v = Number(window.calcAPI.getValue());
        if(isFinite(v)) mem = v;
      } else {
        window.calcAPI.setValue(mem);
      }
      saveMem(); paintMem();
    }, 260);
  });
  memBtn.addEventListener('dblclick', function(){
    clearTimeout(clickTimer);
    mem = null; saveMem(); paintMem();
  });
  paintMem();

  /* ---- SYS : cycle colourways ---- */
  const themes = ['sunburst','glacier','ember'];
  let th = 0;
  function applyTheme(){
    face.classList.remove('th-glacier','th-ember');
    if(themes[th] !== 'sunburst') face.classList.add('th-' + themes[th]);
    try{ localStorage.setItem('commodore-calc:rktheme', themes[th]); }catch(e){}
  }
  try{
    const i = themes.indexOf(localStorage.getItem('commodore-calc:rktheme'));
    if(i >= 0) th = i;
  }catch(e){}
  applyTheme();
  sysBtn.addEventListener('click', function(){ th = (th+1) % themes.length; applyTheme(); });

  /* ---- 12 : clock ---- */
  function pad(n){ return String(n).padStart(2,'0'); }
  function tick(){
    const d = new Date();
    clkLbl.textContent = pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  tick(); setInterval(tick, 15000);
  let flashTimer = null;
  clkBtn.addEventListener('click', function(){
    const d = new Date();
    flash.textContent = d.toLocaleDateString('nl-NL',{weekday:'short',day:'numeric',month:'short',year:'numeric'})
      + '  ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    flash.classList.add('show');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function(){ flash.classList.remove('show'); }, 2600);
  });
})();


(function(){
  // ---- PRIKBORD: tear or drag blocks off the pad, pin & shuffle post-its ----
  const KEY   = 'commodore-calc:postits';
  const histEl = document.getElementById('history');
  const board  = document.getElementById('board');
  const wall   = document.getElementById('boardNotes');
  if(!histEl || !board || !wall) return;

  const wide = () => window.matchMedia('(min-width:861px)').matches;
  let items = [];
  let zTop = 10;
  try{
    const s = JSON.parse(localStorage.getItem(KEY) || '[]');
    if(Array.isArray(s)) items = s;
  }catch(e){}
  function newId(){ return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
  items.forEach(function(it){ if(!it.id) it.id = newId(); });
  function save(){ try{ localStorage.setItem(KEY, JSON.stringify(items)); }catch(e){} }

  function pad2(n){ return String(n).padStart(2,'0'); }
  function fmtDate(iso){
    const d = new Date(iso);
    return d.toLocaleDateString('nl-NL',{day:'numeric',month:'short',year:'numeric'})
      + ' · ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function download(it){
    const stamp = fmtDate(it.d);
    const blob = new Blob([it.t + '\n\n— green line desk · ' + stamp + '\n'], {type:'text/plain;charset=utf-8'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'postit-' + String(it.d).slice(0,10) + '-' + String(it.d).slice(11,16).replace(':','') + '.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function(){ URL.revokeObjectURL(a.href); }, 500);
  }

  function makeNote(it){
    const div = document.createElement('div');
    div.className = 'postit';
    div.style.transform = 'rotate(' + (it.r || 0) + 'deg)';
    div.style.zIndex = ++zTop;

    const body = document.createElement('div');
    body.textContent = it.t;
    div.appendChild(body);

    const date = document.createElement('span');
    date.className = 'pi-date';
    date.textContent = fmtDate(it.d);
    div.appendChild(date);

    const tools = document.createElement('div');
    tools.className = 'pi-tools';
    const dl = document.createElement('button');
    dl.type = 'button'; dl.textContent = '⬇'; dl.title = 'bewaar als bestandje op je Mac';
    dl.addEventListener('click', function(){ download(it); });
    const del = document.createElement('button');
    del.type = 'button'; del.className = 'pi-del'; del.textContent = '✕'; del.title = 'weggooien';
    let armed = null;
    del.addEventListener('click', function(){
      if(armed){
        clearTimeout(armed);
        const i = items.findIndex(function(o){ return o.id===it.id; });
        if(i>=0){ items.splice(i,1); save(); renderAll(); }
        return;
      }
      del.classList.add('armed'); del.textContent = 'sure?';
      armed = setTimeout(function(){
        armed = null;
        del.classList.remove('armed'); del.textContent = '✕';
      }, 3000);
    });
    tools.appendChild(dl); tools.appendChild(del);
    div.appendChild(tools);

    // pick the note up and slide it across the cork
    div.addEventListener('pointerdown', function(e){
      if(!wall.classList.contains('free')) return;
      if(e.button!==undefined && e.button!==0) return;
      if(e.target.closest('button')) return;
      const start = { x:e.clientX, y:e.clientY,
                      l:parseFloat(div.style.left)||0, t:parseFloat(div.style.top)||0 };
      let moving = false;
      div.style.zIndex = ++zTop;
      function mv(ev){
        const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
        if(!moving && Math.hypot(dx,dy) > 4){
          moving = true;
          div.classList.add('dragging');
          div.style.transform = 'rotate(0deg) scale(1.04)';
        }
        if(moving){
          const maxX = Math.max(0, wall.clientWidth - div.offsetWidth);
          it.x = Math.max(0, Math.min(start.l + dx, maxX));
          it.y = Math.max(0, start.t + dy);
          div.style.left = it.x + 'px';
          div.style.top  = it.y + 'px';
        }
      }
      function up(){
        window.removeEventListener('pointermove', mv);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        if(moving){
          div.classList.remove('dragging');
          div.style.transform = 'rotate(' + (it.r||0) + 'deg)';
          const i = items.findIndex(function(o){ return o.id===it.id; });
          if(i>=0){ items.splice(i,1); items.push(it); }   // on top of the pile
          save();
        }
      }
      window.addEventListener('pointermove', mv);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
      e.preventDefault();
    });

    return div;
  }

  function renderAll(){
    wall.innerHTML = '';
    board.hidden = items.length===0;
    const free = wide();
    wall.classList.toggle('free', free);
    let placed = false;
    items.forEach(function(it, i){
      const el = makeNote(it);
      wall.appendChild(el);
      if(free){
        if(typeof it.x !== 'number'){
          it.x = 12 + ((i*36) % Math.max(40, wall.clientWidth - 230));
          it.y = 8 + ((i*42) % 150);
          placed = true;
        }
        it.x = Math.max(0, Math.min(it.x, Math.max(0, wall.clientWidth - el.offsetWidth - 4)));
        el.style.left = it.x + 'px';
        el.style.top  = it.y + 'px';
      }else{
        el.style.left = ''; el.style.top = '';
      }
    });
    if(placed) save();
  }
  let rsz = null;
  window.addEventListener('resize', function(){ clearTimeout(rsz); rsz = setTimeout(renderAll, 180); });

  // put a little ✂ on every block on the pad (idempotent, survives restores)
  function decorate(){
    histEl.querySelectorAll(':scope > div').forEach(function(b){
      if(b.classList.contains('empty') || b.classList.contains('tearing')) return;
      if(!b.querySelector(':scope > .tear')){
        const t = document.createElement('button');
        t.className = 'tear';
        t.type = 'button';
        t.setAttribute('contenteditable','false');
        t.title = 'scheur los → prikbord';
        b.appendChild(t);
      }
      if(!b.querySelector(':scope > .del')){
        const d = document.createElement('button');
        d.className = 'del';
        d.type = 'button';
        d.setAttribute('contenteditable','false');
        d.title = 'gooi deze regel weg (twee keer tikken)';
        b.appendChild(d);
      }
    });
  }
  decorate();
  new MutationObserver(decorate).observe(histEl, {childList:true});

  // ---- ☑ select-modus: meerdere regels aanvinken en samen weggooien ----
  const padSelectBtn = document.getElementById('padSelect');
  const padDeleteBtn = document.getElementById('padDelete');
  function selCount(){ return histEl.querySelectorAll('.picked').length; }
  function paintSel(){
    const on = histEl.classList.contains('selecting');
    if(padSelectBtn){
      padSelectBtn.classList.toggle('armed', on);
      padSelectBtn.textContent = on ? '☑ klaar' : '☑ select';
    }
    if(padDeleteBtn){
      padDeleteBtn.hidden = !on;
      padDeleteBtn.textContent = '🗑 ' + selCount();
    }
  }
  function exitSelect(){
    histEl.classList.remove('selecting');
    histEl.querySelectorAll('.picked').forEach(function(b){ b.classList.remove('picked'); });
    paintSel();
  }
  if(padSelectBtn){
    padSelectBtn.addEventListener('click', function(){
      if(histEl.classList.contains('selecting')) exitSelect();
      else { histEl.classList.add('selecting'); paintSel(); }
    });
  }
  if(padDeleteBtn){
    padDeleteBtn.addEventListener('click', function(){
      const picked = Array.prototype.slice.call(histEl.querySelectorAll('.picked'));
      if(!picked.length) return;
      picked.forEach(function(b){ b.classList.add('tearing'); });
      setTimeout(function(){
        picked.forEach(function(b){ b.remove(); });
        tidyEmpty();
      }, 340);
      exitSelect();
    });
  }
  window.addEventListener('keydown', function(e){
    if(e.key==='Escape' && histEl.classList.contains('selecting')) exitSelect();
  });
  // tijdens het vinken geen notities bewerken en niet oppakken om te slepen
  histEl.addEventListener('pointerdown', function(e){
    if(!histEl.classList.contains('selecting')) return;
    if(!e.target.closest('.tear,.del,button')) e.preventDefault();
  }, true);

  // flatten a pad block to plain text, pens and all
  function blockText(block){
    const clone = block.cloneNode(true);
    clone.querySelectorAll('.tear,.del').forEach(function(x){ x.remove(); });
    clone.querySelectorAll('.cmt').forEach(function(c){
      c.replaceWith('\n✎ ' + c.textContent);
    });
    let t = (clone.textContent || '').trim();
    if(block.classList.contains('free')) t = '✎ ' + t;
    if(block.classList.contains('fx'))   t = '∑ ' + t;
    return t;
  }
  function tidyEmpty(){
    if(!histEl.querySelector(':scope > div:not(.empty)')){
      histEl.innerHTML = '<div class="empty">Your sums will appear here…</div>';
    }
  }
  function pinItem(text, x, y){
    items.push({ id:newId(), t:text, d:new Date().toISOString(),
                 r:Number((Math.random()*5 - 2.5).toFixed(1)),
                 x:(typeof x==='number' ? x : null), y:(typeof y==='number' ? y : null) });
    save(); renderAll();
  }

  // scissors & bin & select — capture phase, so they never trigger the note editor
  histEl.addEventListener('click', function(e){
    // ☑ select-modus: klikken vinkt een regel aan of uit
    if(histEl.classList.contains('selecting')){
      if(e.target.closest('.tear,.del,button')) return;
      const blk = e.target.closest('#history > div');
      if(blk && !blk.classList.contains('empty')){
        e.preventDefault();
        e.stopPropagation();
        blk.classList.toggle('picked');
        paintSel();
      }
      return;
    }
    // ✕ : gooi één regel weg (twee tikken, net als bij een post-it)
    const d = e.target.closest('.del');
    if(d){
      e.preventDefault();
      e.stopPropagation();
      if(d._arm){
        clearTimeout(d._arm); d._arm = null;
        const blk = d.parentElement;
        blk.classList.add('tearing');
        setTimeout(function(){ blk.remove(); tidyEmpty(); }, 340);
        return;
      }
      d.classList.add('armed');
      d._arm = setTimeout(function(){ d._arm = null; d.classList.remove('armed'); }, 3000);
      return;
    }
    const t = e.target.closest('.tear');
    if(!t) return;
    e.preventDefault();
    e.stopPropagation();
    const block = t.parentElement;
    const text = blockText(block);
    if(!text) return;
    pinItem(text);
    block.classList.add('tearing');
    setTimeout(function(){ block.remove(); tidyEmpty(); }, 340);
  }, true);

  // ---- hold a block to pick it up off the pad: drop on cork or reorder ----
  let hold=null, downPt=null, downBlock=null, pick=null, justPicked=false;
  const marker = document.createElement('div');
  marker.className = 'ins-line';
  marker.style.display = 'none';
  document.body.appendChild(marker);
  function hideMarker(){ marker.style.display='none'; }

  histEl.addEventListener('pointerdown', function(e){
    if(e.button!==undefined && e.button!==0) return;
    const block = e.target.closest('#history > div');
    if(!block || block.classList.contains('empty')) return;
    if(histEl.classList.contains('selecting')) return; // vinkmodus: niet oppakken
    if(e.target.closest('.tear')) return;
    if(e.target.closest('.del')) return;
    const ae = document.activeElement;
    if(ae && block.contains(ae)) return;          // busy writing → leave it
    downBlock = block; downPt = {x:e.clientX, y:e.clientY};
    clearTimeout(hold);
    hold = setTimeout(startPick, 280);
  });

  function startPick(){
    hold = null;
    const block = downBlock;
    const r = block.getBoundingClientRect();
    const g = block.cloneNode(true);
    g.querySelectorAll('.tear,.del').forEach(function(x){ x.remove(); });
    g.removeAttribute('contenteditable');
    g.classList.add('drag-ghost');
    g.style.width = Math.max(120, r.width) + 'px';
    g.style.left = r.left + 'px';
    g.style.top  = r.top + 'px';
    document.body.appendChild(g);
    block.classList.add('lift');
    document.body.classList.add('noselect');
    pick = { block:block, ghost:g,
             dx:downPt.x - r.left, dy:downPt.y - r.top, ref:undefined };
  }

  function insertRef(y){
    const blocks = Array.prototype.filter.call(
      histEl.querySelectorAll(':scope > div'),
      function(b){ return b!==pick.block && !b.classList.contains('empty'); });
    for(let i=0;i<blocks.length;i++){
      const r = blocks[i].getBoundingClientRect();
      if(y < r.top + r.height/2) return blocks[i];
    }
    return null; // end of the sheet
  }

  window.addEventListener('pointermove', function(e){
    if(hold && downPt && Math.hypot(e.clientX-downPt.x, e.clientY-downPt.y) > 6){
      clearTimeout(hold); hold = null;
    }
    if(!pick) return;
    pick.ghost.style.left = (e.clientX - pick.dx) + 'px';
    pick.ghost.style.top  = (e.clientY - pick.dy) + 'px';
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const overBoard = under && under.closest('.board');
    board.classList.toggle('drop-hot', !!overBoard);
    pick.ref = undefined;
    hideMarker();
    if(!overBoard && under && under.closest('#history')){
      const ref = insertRef(e.clientY);
      pick.ref = ref;   // null = append at the end
      const hr = histEl.getBoundingClientRect();
      let top;
      if(ref){ top = ref.getBoundingClientRect().top - 2; }
      else{
        const blocks = histEl.querySelectorAll(':scope > div:not(.empty)');
        const last = blocks[blocks.length-1];
        top = last ? last.getBoundingClientRect().bottom + 2 : hr.top + 4;
      }
      marker.style.display = 'block';
      marker.style.left  = hr.left + 'px';
      marker.style.width = Math.max(0, hr.width - 20) + 'px';
      marker.style.top   = top + 'px';
    }
  });

  function endPick(){
    const p = pick; pick = null;
    p.ghost.remove();
    hideMarker();
    board.classList.remove('drop-hot');
    document.body.classList.remove('noselect');
    return p;
  }

  window.addEventListener('pointerup', function(e){
    clearTimeout(hold); hold = null;
    if(!pick) return;
    const p = endPick();
    justPicked = true;
    setTimeout(function(){ justPicked = false; }, 0);
    const under = document.elementFromPoint(e.clientX, e.clientY);
    if(under && under.closest('.board')){
      const text = blockText(p.block);
      if(text){
        const nr = wall.getBoundingClientRect();
        const x = e.clientX - nr.left + wall.scrollLeft - 90;
        const y = e.clientY - nr.top  + wall.scrollTop  - 14;
        pinItem(text, Math.max(0,x), Math.max(0,y));
        p.block.classList.remove('lift');
        p.block.classList.add('tearing');
        setTimeout(function(){ p.block.remove(); tidyEmpty(); }, 340);
        return;
      }
    }else if(p.ref !== undefined && under && under.closest('#history')){
      if(p.ref) histEl.insertBefore(p.block, p.ref);
      else histEl.appendChild(p.block);
    }
    p.block.classList.remove('lift');
  });
  window.addEventListener('pointercancel', function(){
    clearTimeout(hold); hold = null;
    if(pick){ const p = endPick(); p.block.classList.remove('lift'); }
  });

  // a long hold shouldn't also open the margin-note editor on release
  histEl.addEventListener('click', function(e){
    if(justPicked){ e.stopPropagation(); e.preventDefault(); }
  }, true);

  renderAll();
})();
