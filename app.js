/* JMOBETS free-play web client. No secrets or local password storage. */
(() => {
  'use strict';
  const cfg = window.JMOBETS_CONFIG || {};
  const ready = /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(cfg.supabaseUrl || '') && /^sb_publishable_|^eyJ/.test(cfg.supabasePublishableKey || '') && !!window.supabase;
  const db = ready ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey, {
    auth: {persistSession:true, autoRefreshToken:true, detectSessionInUrl:false, storageKey:'jmobets-session'}
  }) : null;
  const byId = id => document.getElementById(id);
  const safe = str => String(str == null ? '' : str).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const fmt = n => Number(n || 0).toLocaleString(undefined,{maximumFractionDigits:2});
  const fixture = [
    {id:'n1',sport:'NFL',away:'Buffalo Bills',home:'Kansas City Chiefs',options:[{label:'Bills',odds:1.94},{label:'Chiefs',odds:1.89}]},
    {id:'n2',sport:'NFL',away:'Baltimore Ravens',home:'Cincinnati Bengals',options:[{label:'Ravens',odds:1.76},{label:'Bengals',odds:2.15}]},
    {id:'b1',sport:'NBA',away:'New York Knicks',home:'Boston Celtics',options:[{label:'Knicks',odds:2.25},{label:'Celtics',odds:1.70}]},
    {id:'b2',sport:'NBA',away:'Los Angeles Lakers',home:'Golden State Warriors',options:[{label:'Lakers',odds:1.92},{label:'Warriors',odds:1.93}]},
    {id:'e1',sport:'EPL',away:'Arsenal',home:'Chelsea',options:[{label:'Arsenal',odds:2.05},{label:'Draw',odds:3.40},{label:'Chelsea',odds:3.65}]},
    {id:'e2',sport:'EPL',away:'Liverpool',home:'Manchester City',options:[{label:'Liverpool',odds:2.65},{label:'Draw',odds:3.50},{label:'Man City',odds:2.48}]}
  ];
  let markets=fixture, profile=null, session=null, picks=[], filter='ALL', selected=null, page='home', loading=false, authMode='login', adminProfiles=[];
  const serverMessage = 'Accounts require the connected Supabase project. Setup is not complete yet.';
  function status(msg,type='info') {const e=byId('authNotice'); if(e){e.textContent=msg;e.dataset.type=type;}}
  function toast(msg){const el=byId('toast');el.textContent=msg;el.style.display='block';clearTimeout(toast.t);toast.t=setTimeout(()=>el.style.display='none',3300);}
  function setPage(p){
    if(p==='admin' && profile?.role!=='admin') return;
    page=p;
    document.querySelectorAll('.page').forEach(e=>e.classList.toggle('active',e.id==='page-'+p));
    document.querySelectorAll('[data-page]').forEach(e=>e.classList.toggle('active',e.dataset.page===p));
    window.scrollTo({top:0,behavior:'smooth'});
    render();
    if(p==='admin') loadAdmin();
  }
  function label(g){return g.sport==='EPL'?'⚽ PREMIER LEAGUE':g.sport==='NBA'?'🏀 NBA':'🏈 NFL'}
  function marketHtml(g){
    const options=Array.isArray(g.options)?g.options:[];
    return '<div class="event"><div class="eventhead"><strong class="lime">'+label(g)+'</strong><span>ILLUSTRATIVE MATCHUP</span></div><div class="teams">'+safe(g.away)+' vs '+safe(g.home)+'</div><div class="odds">'+options.map((o,i)=>{
      const sel=selected?.id===g.id&&selected?.idx===i;
      return '<button class="odd '+(sel?'selected':'')+'" data-market="'+safe(g.id)+'" data-idx="'+i+'"><span>'+safe(o.label)+'</span><strong>'+Number(o.odds).toFixed(2)+'</strong></button>';
    }).join('')+'</div></div>';
  }
  function render(){
    const balance=profile?fmt(profile.balance):'—';
    byId('balanceTop').textContent=balance;
    byId('statBalance').textContent=balance;
    byId('walletBalance').textContent=balance+' JMOT';
    byId('statPicks').textContent=picks.length;
    byId('statOpen').textContent=picks.filter(p=>p.status==='pending').length;
    byId('pickCount').textContent=picks.length+' PICKS';
    byId('accountTop').textContent=profile?'@'+profile.username: 'Log in / Sign up';
    byId('adminNav').hidden=profile?.role!=='admin';
    byId('signOut').hidden=!profile;
    byId('accountGreeting').textContent=profile?'Signed in as @'+profile.username:'Create an account or sign in';
    byId('authPanel').hidden=!!profile;
    byId('accountActive').hidden=!profile;
    if(profile) byId('accountActive').textContent='Welcome back, @'+profile.username+'. Your JMOT balance and picks are saved to your account.';
    document.querySelectorAll('[data-authmode]').forEach(b=>b.classList.toggle('active',b.dataset.authmode===authMode));
    byId('authSubmit').textContent=authMode==='login'?'Log in':'Create account';
    byId('password').setAttribute('autocomplete',authMode==='login'?'current-password':'new-password');
    byId('passwordHint').textContent=authMode==='register'?'At least 12 characters. Save your password; username-only recovery is not yet available.':'Your session is remembered on this device.';
    if(!ready){status(serverMessage);byId('authSubmit').disabled=true;}
    const visible=markets.filter(g=>filter==='ALL'||g.sport===filter);
    byId('events').innerHTML=visible.map(marketHtml).join('')||'<p class="empty">No example markets available.</p>';
    byId('featured').innerHTML=markets.slice(0,3).map(marketHtml).join('');
    document.querySelectorAll('.odd').forEach(b=>b.onclick=()=>{selected={id:b.dataset.market,idx:Number(b.dataset.idx)};setPage('sports');});
    document.querySelectorAll('[data-filter]').forEach(b=>b.classList.toggle('active',b.dataset.filter===filter));
    const g=markets.find(m=>m.id===selected?.id);const o=g?.options?.[selected?.idx];
    byId('slip').innerHTML=o?'<div class="small muted">'+safe(g.away)+' vs '+safe(g.home)+'</div><div class="row" style="margin:12px 0"><strong>'+safe(o.label)+'</strong><strong class="lime">'+Number(o.odds).toFixed(2)+'</strong></div><label class="small muted" for="stake">Stake (JMOT)</label><input id="stake" type="number" min="1" max="1000" step="1" value="50"><div class="row small"><span>Illustrative return</span><strong class="lime" id="potential">—</strong></div><button class="btn" id="place" style="width:100%;margin-top:18px">PLACE FREE-PLAY PICK</button><p class="small muted">Example markets only. Picks remain pending.</p>':'<p class="empty">Choose an outcome to add a pick.</p>';
    if(o){
      const stake=byId('stake'),place=byId('place'),potential=byId('potential');
      const calc=()=>{const x=Number(stake.value);potential.textContent=Number.isFinite(x)&&x>0?fmt(x*Number(o.odds))+' JMOT':'—';place.disabled=loading||!Number.isInteger(x)||x<1||x>1000||(profile&&x>profile.balance);};stake.oninput=calc;calc();
      place.onclick=async()=>{
        if(!profile){setPage('account');toast('Please sign in before placing a free-play pick.');return;}
        const amount=Number(stake.value);if(!Number.isInteger(amount)||amount<1||amount>1000||amount>profile.balance)return;
        loading=true;place.disabled=true;
        try {const {error}=await db.rpc('place_demo_pick',{p_market_id:g.id,p_selection:o.label,p_stake:amount});if(error)throw error;selected=null;await refresh();toast('Your JMOT pick was saved!');}
        catch(e){toast('Pick not placed: '+(e.message||'please retry'));}finally{loading=false;render();}
      };
    }
    const ownHistory=picks.map(p=>{const match=markets.find(x=>x.id===p.market_id);return '<div class="historyitem"><div class="row"><strong>'+safe(p.selection)+'</strong><span class="pill">'+safe(p.status.toUpperCase())+'</span></div><div class="small muted" style="margin:8px 0">'+safe(match?match.away+' vs '+match.home:p.market_id)+'</div><div class="row small"><span>'+fmt(p.stake)+' JMOT @ '+Number(p.decimal_odds).toFixed(2)+'</span><span class="muted">'+new Date(p.created_at).toLocaleDateString()+'</span></div></div>';});
    byId('history').innerHTML=profile?(ownHistory.join('')||'<p class="empty">No picks yet. Make a free-play pick in the Sportsbook.</p>'):'<p class="empty">Log in to see the picks saved to your account.</p><button class="btn" data-go="account">Log in</button>';
    byId('walletCopy').textContent=profile?'Your balance and pending picks are saved securely to your account, so they appear next time you log in on any device.':'Log in or create an account to receive 1,000 JMOT. Balances and picks are saved to your account.';
    document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>setPage(b.dataset.go));
  }
  async function refresh(){
    if(!db)return;
    const {data:auth,error:authError}=await db.auth.getUser();
    if(authError||!auth?.user){session=null;profile=null;picks=[];render();return;}
    const {data:p,error:e}=await db.from('profiles').select('id,username,role,account_status,balance').eq('id',auth.user.id).single();
    if(e||!p){profile=null;picks=[];status('Account not ready. Please retry.');render();return;}
    if(p.account_status!=='active'){
      await db.auth.signOut();profile=null;picks=[];setPage('account');
      status(p.account_status==='banned'?'This account is banned.':'This account is suspended.','error');return;
    }
    profile=p;const {data:rows}=await db.from('demo_picks').select('id,market_id,selection,decimal_odds,stake,status,created_at').eq('user_id',p.id).order('created_at',{ascending:false}).limit(100);
    picks=rows||[];render();
  }
  async function loadMarkets(){
    if(!db)return;const {data,error}=await db.from('demo_markets').select('id,sport,away,home,options,is_open').eq('is_open',true).order('id');
    if(!error&&data&&data.length)markets=data;render();
  }
  async function handleAuth(e){
    e.preventDefault();if(!db)return;
    const username=byId('username').value.trim().toLowerCase(),password=byId('password').value;
    if(!/^[a-z0-9_]{3,20}$/.test(username)){status('Username must be 3–20 letters, numbers or underscores.','error');return;}
    if(password.length<12){status('Password must be at least 12 characters.','error');return;}
    const btn=byId('authSubmit');btn.disabled=true;status(authMode==='register'?'Creating account…':'Signing in…');
    try{
      if(authMode==='register'){
        const response=await fetch(cfg.supabaseUrl+'/functions/v1/jmo-register',{method:'POST',
          headers:{'content-type':'application/json','apikey':cfg.supabasePublishableKey},
          body:JSON.stringify({username,password})});
        const result=await response.json().catch(()=>({}));
        if(!response.ok)throw Error(result.error||'Unable to register');
      }
      const {error}=await db.auth.signInWithPassword({email:username+'@accounts.jmobets.invalid',password});
      if(error)throw error;
      byId('password').value='';await refresh();setPage('home');toast(authMode==='register'?'Account created successfully!':'Welcome back!');
    }catch(err){status(err.message||'Try again.','error');}finally{btn.disabled=false;}
  }
  async function loadAdmin(){
    if(!db||profile?.role!=='admin')return;
    const el=byId('adminUsers');el.textContent='Loading accounts…';
    const {data,error}=await db.from('profiles').select('id,username,role,account_status,balance,created_at').order('created_at',{ascending:false}).limit(200);
    if(error){el.textContent='Unable to load users: '+error.message;return;}
    adminProfiles=data||[];
    const {data:allPicks}=await db.from('demo_picks').select('user_id,status,stake').limit(5000);
    const count={};for(const p of allPicks||[])count[p.user_id]=(count[p.user_id]||0)+1;
    drawAdmin(count);
  }
  function drawAdmin(count){
    const query=byId('adminSearch').value.trim().toLowerCase(),el=byId('adminUsers');
    if(profile?.role!=='admin'){el.textContent='Access denied';return;}
    const rows=adminProfiles.filter(x=>x.username.includes(query));
    el.innerHTML=rows.map(u=>'<div class="historyitem"><div class="row"><strong>@'+safe(u.username)+'</strong><span class="pill">'+safe(u.role.toUpperCase())+'</span></div><div class="row small muted" style="margin:10px 0"><span>Status: '+safe(u.account_status)+'</span><span>Balance: '+fmt(u.balance)+' JMOT</span><span>Picks: '+(count[u.id]||0)+'</span></div><div class="actions">'+(u.role==='admin'?'<span class="muted small">Protected admin account</span>':'<button class="btn secondary small" data-view="'+safe(u.id)+'">View picks</button><button class="btn secondary small" data-target="'+safe(u.id)+'" data-status="active">Activate</button><button class="btn secondary small" data-target="'+safe(u.id)+'" data-status="suspended">Suspend</button><button class="btn secondary small" data-target="'+safe(u.id)+'" data-status="banned">Ban</button>')+'</div></div>').join('')||'<p class="empty">No matching accounts.</p>';
    el.querySelectorAll('[data-view]').forEach(btn=>btn.onclick=async()=>{
      const u=adminProfiles.find(x=>x.id===btn.dataset.view);if(!u)return;
      const {data:rows,error}=await db.from('demo_picks').select('selection,market_id,decimal_odds,stake,status,created_at')
        .eq('user_id',u.id).order('created_at',{ascending:false}).limit(100);
      if(error){toast('Unable to load picks');return;}
      const panel=byId('adminPickDetails');
      panel.hidden=false;
      panel.innerHTML='<h3>Recent picks for @'+safe(u.username)+'</h3>'+
        ((rows||[]).map(p=>'<div class="historyitem"><strong>'+safe(p.selection)+'</strong> · '+safe(p.market_id)+
          ' · '+fmt(p.stake)+' JMOT @ '+Number(p.decimal_odds).toFixed(2)+' · '+safe(p.status)+
          ' · '+new Date(p.created_at).toLocaleString()+'</div>').join('')||'<p class="empty">No picks.</p>');
    });
    el.querySelectorAll('[data-target]').forEach(btn=>btn.onclick=async()=>{
      const u=adminProfiles.find(x=>x.id===btn.dataset.target);if(!u||u.role==='admin')return;
      if(!confirm('Change @'+u.username+' status to '+btn.dataset.status+'?'))return;
      btn.disabled=true;
      const {error}=await db.rpc('admin_set_account_status',{p_user_id:u.id,p_status:btn.dataset.status});
      if(error){toast('Moderation failed: '+error.message);btn.disabled=false;return;}
      toast('@'+u.username+' is now '+btn.dataset.status);await loadAdmin();
    });
  }
  document.querySelectorAll('[data-page],[data-go]').forEach(b=>b.onclick=()=>setPage(b.dataset.page||b.dataset.go));
  document.querySelectorAll('[data-sport]').forEach(b=>b.onclick=()=>{filter=b.dataset.sport;setPage('sports');});
  document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;render();});
  document.querySelectorAll('[data-authmode]').forEach(b=>b.onclick=()=>{authMode=b.dataset.authmode;status(!ready?serverMessage:'');render();});
  byId('accountTop').onclick=()=>setPage('account');
  byId('authForm').onsubmit=handleAuth;
  byId('adminSearch').oninput=()=>loadAdmin(); // Fetch fresh data for searches, avoid stale account lists.
  byId('signOut').onclick=async()=>{if(db)await db.auth.signOut();profile=null;picks=[];setPage('home');toast('Logged out.');};
  if(!ready){status(serverMessage);render();return;}
  db.auth.onAuthStateChange((_event,_session)=>{session=_session;setTimeout(()=>refresh(),0);});
  db.auth.getSession().then(({data})=>{session=data.session;return Promise.all([refresh(),loadMarkets()]);})
    .catch(()=>status('Could not connect to accounts. Please retry later.','error'));
})();
