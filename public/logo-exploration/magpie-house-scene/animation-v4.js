/* global gsap, document, window, IntersectionObserver, Image */
(() => {
  'use strict';
  const $=id=>document.getElementById(id), duration=50, clock={t:0};
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
  const clamp=x=>Math.max(0,Math.min(1,x)), seg=(t,a,b)=>clamp((t-a)/(b-a));
  const ease=gsap.parseEase('power2.inOut'), mix=(a,b,u)=>a+(b-a)*u;
  const tr=(id,v)=>$(id).setAttribute('transform',v), op=(id,v)=>{$(id).style.opacity=clamp(v);};
  let timeline, wantsPlay=!reduced.matches, onScreen=true;
  const treads=[[80,827],[93,790],[108,755],[120,722],[134,689],[148,657],[161,624],[175,592],[190,559],[203,529],[218,500],[233,470],[253,450],[285,433]];
  // One foot supports the body while the other clears the next tread; then the trailing foot follows.
  function stairs(u,reverse){
    const steps=reverse?[...treads].reverse():treads,p=clamp(u)*(steps.length-1),i=Math.min(steps.length-2,Math.floor(p)),v=p-i,a=steps[i],b=steps[i+1];
    const feet=[0,1].map(j=>{const lead=(i%2===j),f=clamp(lead?v*2:(v-.5)*2),q=ease(f);return [mix(a[0],b[0],q)+(j?12:-12),mix(a[1],b[1],q)-Math.sin(Math.PI*f)*14];});
    return {x:(feet[0][0]+feet[1][0])/2,y:(feet[0][1]+feet[1][1])/2,motion:Math.sin(Math.PI*v),feet};
  }
  function wing(target){const s={x:124,y:-165},dx=target.x-s.x,dy=target.y-s.y,d=Math.hypot(dx,dy),nx=-dy/d,ny=dx/d,m={x:(s.x+target.x)/2,y:(s.y+target.y)/2},v=(p,w)=>`${p.x+nx*w} ${p.y+ny*w}`; $('wing-shape').setAttribute('d',`M${v(s,16)}Q${v(m,23)} ${v(target,8)}Q${target.x+dx/d*11} ${target.y+dy/d*11} ${v(target,-8)}Q${v(m,-14)} ${v(s,-16)}Z`);$('wing-inset').setAttribute('d',`M${v(s,4)}Q${v(m,12)} ${v(target,2)}Q${v(m,2)} ${v(s,-3)}Z`);}
  function render(t){
    let x=715,y=875,dir=-1,walk=0,hop=0,inStairs=false,stairFeet=null;
    const s=.65;
    const travel=(a,b,from,to)=>{const u=seg(t,a,b);x=mix(from[0],to[0],u);y=mix(from[1],to[1],u);walk=Math.sin(u*Math.PI*Math.max(2,Math.round(Math.abs(to[0]-from[0])/24/2)*2));dir=to[0]>from[0]?1:-1;};
    if(t>=4&&t<8)travel(4,8,[715,875],treads[0]);
    else if(t>=8&&t<15){const p=stairs(seg(t,8,15),false);x=p.x;y=p.y;hop=p.motion;stairFeet=p.feet;dir=1;inStairs=true;}
    else if(t>=15&&t<17)travel(15,17,treads[13],[460,433]);
    else if(t>=17&&t<19){x=460;y=433;dir=1;}
    else if(t>=19&&t<22)travel(19,22,[460,433],[800,433]);
    else if(t>=22&&t<24){x=800;y=433;dir=1;}
    else if(t>=24&&t<27)travel(24,27,[800,433],[1140,433]);
    else if(t>=27&&t<29){x=1140;y=433;dir=1;}
    else if(t>=29&&t<34)travel(29,34,[1140,433],treads[13]);
    else if(t>=34&&t<40){const p=stairs(seg(t,34,40),true);x=p.x;y=p.y;hop=p.motion;stairFeet=p.feet;dir=-1;inStairs=true;}
    else if(t>=40&&t<44)travel(40,44,treads[0],[715,875]);
    // Return to the exact opening position before turning and accepting the next file.
    if(t>=44&&t<44.6)dir=Math.cos(Math.PI*ease(seg(t,44,44.6)));
    tr('bird-position',`translate(${x} ${y})`);tr('bird-scale',`scale(${s})`);tr('bird-facing',`scale(${dir} 1) translate(-140 0)`);tr('bird-body',`translate(0 ${-Math.abs(walk)*2})`);
    tr('bird-shadow',`translate(${x} ${y+5}) scale(${s})`);op('bird-shadow',inStairs?0:.65);
    tr('tail',`rotate(${70*(seg(t,7.4,8)*(1-seg(t,15,15.5))+seg(t,33.4,34)*(1-seg(t,40,40.5)))+walk*2} 110 -90)`);tr('head',`rotate(${t>=44&&t<45?Math.sin((t-44)*Math.PI)*4:0} 153 -165)`);
    tr('eye',`translate(0 -207) scale(1 ${t>3.4&&t<3.55?.15:1}) translate(0 207)`);tr('bag',`rotate(${-walk*2} 133 -108)`);tr('far-wing',`rotate(${-walk*5-hop*8} 118 -161)`);
    ['near','far'].forEach((name,i)=>{
      const origin=i?158:117,w=walk*(i?-1:1);
      const dx=stairFeet?(stairFeet[i][0]-x)/(s*dir)+140-origin:w*12;
      const dy=stairFeet?(stairFeet[i][1]-y)/s:-Math.max(0,w)*11;
      tr(`foot-${name}`,`translate(${dx} ${dy})`);
      $(`leg-${name}`).setAttribute('d',`M${origin} -37Q${origin+dx*.65+5} ${-22+dy*.35} ${origin+dx} ${dy-8}`);
    });
    [50/60,50/30,50/22].forEach((period,i)=>{const phase=(t/period+i*.31)%1;const work=phase<.48?0:1;op(`worker-${i}`,work);});
    tr('conversion',`translate(${x+105} ${y-240})`);
    const waiting=seg(t,1.5,1.7)*(1-seg(t,48,48.3));op('customer-waiting',waiting);op('customer-offering',1-waiting);
    $('scene').dataset.customerState=t<1.7?'offering':t<44?'waiting':t<48?'returned':'offering-next';
    $('scene').dataset.route=inStairs?'stairs':y<500?'upstairs':'downstairs';
    let target={x:135,y:-123},px=651,py=688,ps=.58,po=0;
    const worldToLocal=(gx,gy)=>({x:140+(gx-x)/(s*dir),y:(gy-y)/s});
    if(t<2.5){const q=ease(seg(t,.3,1.2)),contact=worldToLocal(670,714);target={x:mix(135,contact.x,q),y:mix(-123,contact.y,q)};if(t>=1.5){const u=ease(seg(t,1.5,2.5));px=mix(651,720,u);py=mix(688,829,u);ps=mix(.58,.28,u);po=seg(t,1.5,1.7)*(1-seg(t,2.3,2.5));target=worldToLocal(px+13*ps/.42,py+19*ps/.42);}}
    const delivery=t>=17&&t<19?0:t>=22&&t<24?1:t>=27&&t<29?2:-1;
    if(delivery>=0){const start=[17,22,27][delivery],u=seg(t,start,start+1);target={x:mix(135,205,Math.sin(u*Math.PI/2)),y:mix(-123,-153,Math.sin(u*Math.PI/2))};px=x+(target.x-140)*s+13;py=y+target.y*s;ps=.38;po=seg(t,start,start+.25)*(1-seg(t,start+1.3,start+1.6));const flight=ease(seg(t,start+.7,start+1.3));px=mix(px,[555,853,1240][delivery],flight);py=mix(py,235,flight);ps=mix(.38,.27,flight);}
    wing(target);tr('parcel',`translate(${px} ${py}) scale(${ps})`);op('parcel',po);
    tr('grip',`translate(${px+13*ps/.42} ${py+19*ps/.42})`);op('grip',t>=1.2&&t<2.4?1:0);
    op('html-face',t<3?1:0);op('web-face',0);op('link-face',t>=3?1:0);
    op('conversion',seg(t,2.5,2.8)*(1-seg(t,3.7,4)));op('delivered',0);
    // Foreground railing must not hide the bird while it is still outside the upper landing.
    op('foreground',inStairs?0:1);
    [18.2,23.2,28.2].forEach((start,i)=>op(`receipt-${i}`,seg(t,start,start+.25)*(1-seg(t,44.5,45))));
    const phase=t<1.7?['01','接过你的创作','喜鹊接稳文件，送件人松手。']:t<4?['02','生成网页与链接','送件人收手，开始等待。']:t<17?['03','沿楼梯上楼','逐级落脚，前往楼上房间。']:t<29?['04','把网页分享给三位读者','电脑、平板、手机，分别收到同一个链接。']:t<44?['05','沿原路返回','送件人保持等待，不提前递出下一份。']:t<44.6?['06','回到寄件人面前','喜鹊走完回程，转身面对寄件人。']:t<48?['06','停稳，准备再接一封','寄件人等喜鹊站稳，再拿出下一份文件。']:['01','接过你的创作','喜鹊接稳文件，送件人松手。'];
    ['phase-number','phase-title','phase-copy'].forEach((id,i)=>{$(id).textContent=phase[i];});$('seek').value=t;$('time').value=`${t.toFixed(1)} / ${duration}.0 秒`;
  }
  function sync(){if(!timeline)return; if(wantsPlay&&onScreen&&!document.hidden)timeline.play();else timeline.pause();$('toggle').textContent=wantsPlay?'暂停':'播放';}
  function start(){timeline=gsap.to(clock,{t:duration,duration,ease:'none',paused:true,onUpdate:()=>render(clock.t),onComplete:()=>{if($('loop').checked&&!reduced.matches)timeline.restart();else wantsPlay=false;sync();}});render(0);$('loading').hidden=true;['toggle','replay','seek'].forEach(id=>{$(id).disabled=false;});$('toggle').onclick=()=>{wantsPlay=!wantsPlay;if(wantsPlay&&clock.t>=duration)timeline.restart();sync();};$('replay').onclick=()=>{timeline.pause(0);render(0);wantsPlay=!reduced.matches;sync();};$('seek').oninput=()=>{wantsPlay=false;timeline.pause(Number($('seek').value));render(clock.t);sync();};$('loop').onchange=()=>{if($('loop').checked&&clock.t>=duration&&!reduced.matches){timeline.restart();wantsPlay=true;sync();}};document.addEventListener('visibilitychange',sync);new IntersectionObserver(([e])=>{onScreen=e.isIntersecting;sync();},{threshold:.1}).observe($('scene'));reduced.addEventListener('change',()=>{if(reduced.matches){wantsPlay=false;$('loop').checked=false;}sync();});if(reduced.matches){$('loop').checked=false;$('motion-note').textContent='已关闭自动播放；可手动播放或拖动查看。';}sync();}
  Promise.all(['house-clean-v3.png','customer-cartoon-ender-v2.png','residents-work-v1.png'].map(src=>new Promise((resolve,reject)=>{const img=new Image();img.onload=resolve;img.onerror=reject;img.src=new URL(src,document.currentScript.src).href;}))).then(start).catch(()=>{$('loading').textContent='素材加载失败，请刷新重试。';});
})();
