'use strict';
module.exports = `(() => {
  window.__deepseekComfortCleanup?.();
  const video=document.getElementById('deepseek-wallpaper-video');
  const hud=document.getElementById('deepseek-hud');
  const motion=matchMedia('(prefers-reduced-motion: reduce)');
  const update=()=>{
    const color=getComputedStyle(document.documentElement).getPropertyValue('color-scheme');
    const dark=document.documentElement.classList.contains('dark') || color.trim()==='dark';
    document.documentElement.dataset.dsAppearance=dark?'dark':'light';
    const allowed=!motion.matches && document.visibilityState==='visible';
    video.dataset.dsMotion=allowed?'on':'off';
    video.playbackRate=.75;
    if(allowed) video.play().catch(()=>{}); else video.pause();
    hud.hidden=innerWidth<1000;
  };
  const observer=new MutationObserver(update);
  observer.observe(document.documentElement,{attributes:true,attributeFilter:['class','style']});
  motion.addEventListener('change',update);document.addEventListener('visibilitychange',update);window.addEventListener('resize',update);
  update();
  window.__deepseekComfortCleanup=()=>{observer.disconnect();motion.removeEventListener('change',update);document.removeEventListener('visibilitychange',update);window.removeEventListener('resize',update);delete document.documentElement.dataset.dsAppearance;delete window.__deepseekComfortCleanup;};
})();`;
