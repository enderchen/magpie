const names={a:'A · 折页成帆',b:'B · 页面之 P',c:'C · 一纸轻舟'};
document.querySelectorAll('[data-mark]').forEach(button=>button.addEventListener('click',()=>{
 const key=button.dataset.mark;
 document.querySelector('#nav-mark').src=`assets/${key}.png`;
 document.querySelector('#nav-mark').dataset.wide=String(key==='c');
 document.querySelectorAll('[data-mark]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));
 document.querySelector('#status').textContent=`当前导航预览：${names[key]}`;
}));
