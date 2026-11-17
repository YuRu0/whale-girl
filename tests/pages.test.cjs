const {test}=require('node:test');const assert=require('node:assert/strict');
const {isMainPage}=require('../app/codex/cdp.cjs');
const target=url=>({type:'page',webSocketDebuggerUrl:'ws://127.0.0.1/page',url});
test('only the app main surface receives the theme',()=>{
  assert.equal(isMainPage(target('app://-/index.html')),true);
  assert.equal(isMainPage(target('app://-/index.html?initialRoute=%2Fthread%2F123')),true);
  for(const url of ['app://-/index.html?initialRoute=%2Favatar-overlay','app://-/detached-window.html','https://chatgpt.com','about:blank'])assert.equal(isMainPage(target(url)),false,url);
  assert.equal(isMainPage({...target('app://-/index.html'),type:'webview'}),false);
});
