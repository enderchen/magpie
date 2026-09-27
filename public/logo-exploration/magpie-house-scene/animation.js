/* global gsap, document, window, IntersectionObserver, Image */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const el = Object.fromEntries(['bird-position','bird-scale','bird-facing','bird-body','bird-shadow','tail','head','eye','near-wing','far-wing','foot-near','foot-far','leg-near','leg-far','bag','parcel','html-face','web-face','link-face','conversion','delivered','phase-number','phase-title','phase-copy','toggle','replay','seek','loop','time','loading','motion-note'].map(id => [id,$(id)]));
  const duration = 17;
  const clock = {t:0};
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let wantsPlay = !reduced.matches, onScreen = true, timeline, lastPhase = -1;
  const clamp = (x) => Math.min(1,Math.max(0,x));
  const lerp = (a,b,t) => a+(b-a)*t;
  const smooth = (x) => { const t=clamp(x); return t*t*(3-2*t); };
  const segment = (t,a,b) => clamp((t-a)/(b-a));
  const transform = (id,value) => el[id].setAttribute('transform',value);
  const opacity = (id,v) => el[id].style.opacity=v.toFixed(3);
  const phases = [
    ['01','接过你的创作','把 HTML 文件交给纸鹊。'],
    ['02','变成可以分享的网页','文件生成网页，再得到分享链接。'],
    ['03','带着链接，出发','纸鹊沿楼梯走向楼上的房间。'],
    ['04','送到第一位读者面前','链接送达，读者打开你的网页。']
  ];
  // World-space treads. Feet remain planted while the opposite foot travels.
  const stairs = [[120,825],[135,788],[151,752],[167,716],[183,680],[199,644],[215,608],[231,572],[247,536],[263,500],[279,467],[298,440],[321,416],[346,414]];
  function stairPose(p) {
    const n = Math.min(stairs.length-2,Math.floor(p));
    const u = p-n;
    const a = stairs[n], b=stairs[n+1], c=stairs[Math.max(0,n-1)];
    const moving=[lerp(c[0],b[0],smooth(u)),lerp(c[1],b[1],smooth(u))-Math.sin(Math.PI*u)*18];
    const fixed=a;
    const feet=n%2 ? [fixed,moving] : [moving,fixed];
    return {x:(feet[0][0]+feet[1][0])/2,y:(feet[0][1]+feet[1][1])/2,feet};
  }
  function render(t) {
    let x=890,y=916,s=.84,dir=-1,walk=0,stair=null;
    if(t>=4.6 && t<7.5){const u=segment(t,4.6,7.5);x=lerp(890,120,smooth(u));y=916-91*smooth(u);s=lerp(.84,.62,smooth(u));walk=Math.sin(u*Math.PI*16);}
    else if(t>=7.5 && t<12.6){stair=stairPose(segment(t,7.5,12.6)*(stairs.length-1-.001));x=stair.x;y=stair.y;s=.62;dir=1;}
    else if(t>=12.6){const u=smooth(segment(t,12.6,14));x=lerp(335,451,u);y=414;s=.62;dir=1;walk=t<14?Math.sin(segment(t,12.6,14)*Math.PI*6):0;}
    transform('bird-position',`translate(${x} ${y})`);
    transform('bird-scale',`scale(${s*1.18} ${s})`);
    transform('bird-facing',`scale(${dir} 1) translate(-140 0)`);
    transform('bird-body',`translate(0 ${-Math.abs(walk)*3})`);
    transform('bird-shadow',`translate(${x} ${y+6}) scale(${s} ${s})`);
    opacity('bird-shadow',stair?0:.7);
    transform('tail',`rotate(${walk*3+(stair?25:0)} 110 -90) translate(110 -90) scale(${stair?.75:1} 1) translate(-110 90)`);
    transform('head',`rotate(${t>15?Math.sin(segment(t,15,16)*Math.PI)*5:0} 153 -165)`);
    const blink=(t>1.05&&t<1.22)||(t>15.7&&t<15.88);
    transform('eye',`translate(0 -207) scale(1 ${blink?.13:1}) translate(0 207)`);
    let wingAngle=0;
    if(t<2)wingAngle=-65*Math.sin(Math.PI*segment(t,0,2));
    if(t>=14&&t<15.8)wingAngle=-72*Math.sin(Math.PI*segment(t,14,15.8));
    transform('near-wing',`rotate(${wingAngle+walk*6} 124 -165)`);
    transform('far-wing',`rotate(${stair?-12:walk*-8} 118 -161)`);
    transform('bag',`rotate(${walk*-3} 133 -108)`);
    if(stair){
      const origins=[117,158];
      ['foot-near','foot-far'].forEach((id,i)=>{
        const dx=(stair.feet[i][0]-x)/(s*1.18)+140-origins[i];
        const dy=(stair.feet[i][1]-y)/s;
        transform(id,`translate(${dx} ${dy})`);
        el[i===0?'leg-near':'leg-far'].setAttribute('d',`M${origins[i]} -37L${origins[i]+dx} ${dy-8}`);
      });
    }else{
      el['leg-near'].setAttribute('d',`M117 -37L${117+walk*9} ${-Math.max(0,walk)*11-8}`);
      el['leg-far'].setAttribute('d',`M158 -37L${158-walk*9} ${-Math.max(0,-walk)*11-8}`);
      transform('foot-near',`translate(${walk*9} ${-Math.max(0,walk)*11})`);
      transform('foot-far',`translate(${-walk*9} ${-Math.max(0,-walk)*11})`);
    }
    let px=750,py=718,ps=1,pr=-12,po=1;
    if(t>=.7&&t<1.8){const u=smooth(segment(t,.7,1.8));px=lerp(750,899,u);py=lerp(718,855,u)-Math.sin(Math.PI*u)*18;ps=lerp(1,.62,u);pr=lerp(-12,0,u);}
    else if(t>=1.8&&t<2.2){px=899;py=855;ps=.62;po=1-segment(t,1.8,2.1);}
    else if(t>=2.2&&t<4.6){const u=smooth(segment(t,2.2,2.75));px=lerp(899,945,u);py=lerp(855,672,u);ps=lerp(.62,1.1,u);pr=0;po=segment(t,2.2,2.45)*(1-segment(t,4.1,4.55));}
    else if(t>=4.6&&t<14){po=0;}
    else if(t>=14){const u=smooth(segment(t,14.15,15.35));px=lerp(497,562,u);py=lerp(322,254,u)-Math.sin(u*Math.PI)*32;ps=lerp(.68,.36,u);pr=0;po=segment(t,14,14.2)*(1-segment(t,15.2,15.55));}
    transform('parcel',`translate(${px} ${py}) rotate(${pr}) scale(${ps})`);opacity('parcel',po);
    opacity('html-face',1-segment(t,2.65,2.95));
    opacity('web-face',segment(t,2.85,3.1)*(1-segment(t,3.55,3.8)));
    opacity('link-face',segment(t,3.55,3.85));
    opacity('conversion',segment(t,2.9,3.15)*(1-segment(t,4.1,4.5)));
    opacity('delivered',segment(t,15.3,15.6));
    const phase=t<2.2?0:t<4.6?1:t<14?2:3;
    if(phase!==lastPhase){['phase-number','phase-title','phase-copy'].forEach((id,i)=>{el[id].textContent=phases[phase][i];});lastPhase=phase;}
    el.seek.value=t;el.time.value=`${t.toFixed(1)} / 17.0 秒`;
  }
  function sync(){
    if(!timeline)return;
    const play=wantsPlay&&onScreen&&!document.hidden;
    if(play)timeline.play();else timeline.pause();
    el.toggle.textContent=wantsPlay?'暂停':'播放';
    el.toggle.setAttribute('aria-label',wantsPlay?'暂停动画':'播放动画');
  }
  function start(){
    if(!window.gsap){el.loading.textContent='动画暂时无法加载，请刷新重试。';return;}
    render(0);
    timeline=gsap.to(clock,{t:duration,duration,ease:'none',paused:true,onUpdate:()=>render(clock.t),onComplete:()=>{
      if(el.loop.checked&&!reduced.matches){timeline.restart();sync();}
      else{wantsPlay=false;sync();}
    }});
    el.loading.hidden=true;
    ['toggle','replay','seek'].forEach(id=>{el[id].disabled=false;});
    el.toggle.addEventListener('click',()=>{wantsPlay=!wantsPlay;if(wantsPlay&&clock.t>=duration)timeline.restart();sync();});
    el.replay.addEventListener('click',()=>{timeline.pause(0);wantsPlay=!reduced.matches;render(0);sync();});
    el.seek.addEventListener('input',()=>{wantsPlay=false;timeline.pause(Number(el.seek.value));render(clock.t);sync();});
    el.loop.addEventListener('change',()=>{if(el.loop.checked&&clock.t>=duration&&!reduced.matches){timeline.restart();wantsPlay=true;sync();}});
    reduced.addEventListener('change',()=>{if(reduced.matches){wantsPlay=false;el.loop.checked=false;}updateMotionNote();sync();});
    document.addEventListener('visibilitychange',sync);
    new IntersectionObserver(([entry])=>{onScreen=entry.isIntersecting;sync();},{threshold:.1}).observe($('scene'));
    updateMotionNote();sync();
  }
  function updateMotionNote(){el['motion-note'].textContent=reduced.matches?'已按系统偏好关闭自动播放；可手动播放或拖动查看。':'可暂停或拖动进度逐帧查看。';}
  const img=new Image();img.onload=start;img.onerror=()=>{el.loading.textContent='场景图片加载失败，请刷新重试。';};img.src='house-clean-v1.png';
})();
