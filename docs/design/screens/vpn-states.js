
class Component extends DCLogic {
  constructor(p){super(p);this.state={st:'disconnected',server:'fra',open:false,confirm:false,set:{auto:false,fc:true}};this.timers=[];}
  componentWillUnmount(){this.clear();}
  clear(){this.timers.forEach(clearTimeout);this.timers=[];}
  go(st){this.clear();this.setState({st,confirm:false});}
  run(){
    this.go('connecting');
    this.timers.push(setTimeout(()=>this.setState({st:'authenticating'}),1200));
    this.timers.push(setTimeout(()=>this.setState({st:'unverified'}),2800));
    this.timers.push(setTimeout(()=>this.setState({st:'protected'}),4400));
  }
  renderVals(){
    const s=this.state, acc=this.props.accent??'#1546E6';
    const A='#E3162B',R='#D90F26',N='#4A5B7A';
    const M={
      disconnected:{t:N,b:'Disconnected',h:'Not protected',s:'Tap the button to protect your browser.',k:'connect',bt:'Connect VPN',c:['na','na','na','na']},
      connecting:{t:A,b:'Connecting',h:'Connecting…',s:'Browsing stays blocked until protection is verified.',k:'cancel',bt:'Cancel',c:['pend','na','na','na']},
      authenticating:{t:A,b:'Authenticating',h:'Sign in with your provider',s:'Finish sign-in in the provider window. Surge never sees your password.',k:'cancel',bt:'Cancel',c:['pend','na','na','na']},
      unverified:{t:A,b:'Not verified yet',h:'Verifying connection',s:'Checking IP, DNS, IPv6 and WebRTC. Not shown as protected yet.',k:'cancel',bt:'Cancel',c:['pend','pend','pend','pend']},
      protected:{t:acc,b:'Protected and verified',h:'Connection protected',s:'Your Surge browser traffic is using your VPN provider.',k:'disconnect',bt:'Disconnect VPN',c:['ok','ok','ok','ok']},
      lost:{t:R,b:'Connection lost',h:'Browsing blocked',s:'Fail closed is on. Requests stay blocked until protection returns.',k:'connect',bt:'Reconnect',c:['fail','na','na','na']},
      authfail:{t:R,b:'Authentication failed',h:'Sign-in failed',s:'Sign in again. Direct browsing stays blocked.',k:'connect',bt:'Sign in again',c:['na','na','na','na']},
      unavailable:{t:R,b:'Provider unavailable',h:'Provider unreachable',s:'Try another server or retry shortly.',k:'connect',bt:'Retry',c:['na','na','na','na']},
      misconfigured:{t:R,b:'Proxy misconfigured',h:'Proxy settings wrong',s:'Firefox proxy settings do not match the provider. Browsing is blocked.',k:'connect',bt:'Repair settings',c:['fail','fail','na','na']},
      verifyfail:{t:R,b:'Verification failed',h:'Protection not confirmed',s:'A check failed. Surge will not claim protection.',k:'connect',bt:'Verify again',c:['fail','pend','pend','pend']}
    };
    const m=M[s.st];
    const names={disconnected:'Off',connecting:'Connecting',authenticating:'Sign-in',unverified:'Verifying',protected:'Protected',lost:'Lost',authfail:'Auth failed',unavailable:'Unavailable',misconfigured:'Misconfigured',verifyfail:'Verify failed'};
    const srv=[['fra','Frankfurt, Germany'],['ams','Amsterdam, Netherlands'],['lon','London, United Kingdom'],['nyc','New York, United States']];
    const cur=srv.find(x=>x[0]===s.server)[1];
    const ct={ok:['Verified',acc,'✓'],pend:['Checking',A,'…'],fail:['Failed',R,'✕'],na:['Idle',N,'–']};
    const cn=['IP','DNS','IPv6','WebRTC'];
    const on=(b)=>b?'1px solid '+acc:'1px solid #D0DAEE';
    const bg=(b)=>b?acc+'22':'#F4F7FC';
    const labels=[['auto','Auto-connect on start'],['fc','Fail closed']];
    const busy=(s.st==='connecting'||s.st==='authenticating'||s.st==='unverified');
    return {
      tone:m.t,badge:m.b,head:m.h,sub:m.s,btnLabel:m.bt,anim:busy?'pulse 1.2s infinite':'none',
      showConfirm:s.confirm,confirmYes:()=>this.go('disconnected'),confirmNo:()=>this.setState({confirm:false}),
      mainAction:()=>{ if(m.k==='connect')this.run(); else if(m.k==='cancel')this.go('disconnected'); else this.setState({confirm:true}); },
      open:s.open,chev:s.open?'▲':'▼',toggleOpen:()=>this.setState({open:!s.open}),
      serverName:cur,
      servers:srv.map(x=>({name:x[1],on:s.server===x[0],dot:s.server===x[0]?acc:'#4A5B7A',dotFill:s.server===x[0]?acc:'transparent',border:on(s.server===x[0]),bg:bg(s.server===x[0]),pick:()=>{this.setState({server:x[0]});if(s.st==='protected')this.run();}})),
      checks:m.c.map((c,i)=>({name:cn[i],text:ct[c][0],color:ct[c][1],glyph:ct[c][2]})),
      toggles:labels.map(l=>({name:l[1],on:s.set[l[0]],track:s.set[l[0]]?acc:'#C3CDE3',knob:s.set[l[0]]?'#fff':'#0B1B3A',align:s.set[l[0]]?'flex-end':'flex-start',glow:s.set[l[0]]?'none':'none',flip:()=>this.setState({set:{...s.set,[l[0]]:!s.set[l[0]]}})})),
      states:Object.keys(M).map(k=>({name:names[k],active:s.st===k,border:on(s.st===k),bg:bg(s.st===k),pick:()=>this.go(k)}))
    };
  }
}
