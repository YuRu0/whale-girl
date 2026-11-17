'use strict';
function isMainPage(target) {
  if (target.type !== 'page' || !target.webSocketDebuggerUrl) return false;
  try { const u=new URL(target.url); return u.protocol==='app:' && u.hostname==='-' && u.pathname==='/index.html' && !/avatar-overlay|detached-window/.test(u.searchParams.get('initialRoute') || ''); } catch { return false; }
}
function evaluate(url,expression,timeoutMs=5000){
  return new Promise((resolve,reject)=>{
    const socket=new WebSocket(url);let done=false;
    const finish=(err,value)=>{if(done)return;done=true;clearTimeout(timer);socket.close();err?reject(err):resolve(value)};
    const timer=setTimeout(()=>finish(Error('CDP 请求超时')),timeoutMs);
    socket.onerror=()=>finish(Error('CDP 连接失败'));
    socket.onclose=()=>finish(Error('CDP 连接关闭'));
    socket.onopen=()=>socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}}));
    socket.onmessage=e=>{try{const m=JSON.parse(e.data);if(m.id!==1)return;const err=m.error||m.result?.exceptionDetails;if(err)finish(Error(err.message||err.exception?.description||err.text));else finish(null,m.result?.result?.value)}catch(err){finish(err)}};
  });
}
module.exports={isMainPage,evaluate};
