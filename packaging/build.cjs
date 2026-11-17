'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..'),stage=path.join(__dirname,'WhaleGirl');
const at=process.argv.indexOf('--runtime');
if(at<0||!process.argv[at+1])throw Error('Usage: npm run build -- --runtime <Electron 43.3.0 unpacked directory>');
const runtime=path.resolve(process.argv[at+1]);
if(fs.readFileSync(path.join(runtime,'version'),'utf8').trim()!=='43.3.0')throw Error('Electron 43.3.0 required');
if(runtime===stage||stage.startsWith(runtime+path.sep))throw Error('Runtime must be outside staging');
if(fs.existsSync(stage))throw Error('Staging already exists; use a fresh checkout or rename packaging/WhaleGirl first');
fs.mkdirSync(stage,{recursive:true});
for(const f of fs.readdirSync(runtime)){if(['resources','data'].includes(f)||/^uninstall/i.test(f)||f.endsWith('.txt'))continue;fs.cpSync(path.join(runtime,f),path.join(stage,f),{recursive:true});}
const electron=path.join(stage,'electron.exe'),appExe=path.join(stage,'鲸鱼娘.exe');
if(fs.existsSync(electron))fs.renameSync(electron,appExe);
if(!fs.existsSync(appExe))throw Error('Runtime executable missing');
fs.mkdirSync(path.join(stage,'resources'),{recursive:true});
fs.cpSync(path.join(root,'app'),path.join(stage,'resources/app'),{recursive:true,filter:src=>!/(?:^|[\\/])(?:data|_backup_v1|node_modules)(?:[\\/]|$)|\.backup$|\.codex-whale-backup$/.test(src)});
const manifest={};
function walk(dir){for(const d of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,d.name);if(d.isDirectory())walk(f);else manifest[path.relative(stage,f).replaceAll('\\','/')]=require('node:crypto').createHash('sha256').update(fs.readFileSync(f)).digest('hex');}}
walk(path.join(stage,'resources/app'));
fs.writeFileSync(path.join(__dirname,'source-manifest.json'),JSON.stringify(manifest,null,2));
const builder=process.env.WHALE_BUILDER_CLI||require.resolve('electron-builder/cli.js');
const result=cp.spawnSync(process.execPath,[builder,'--win','--x64','--prepackaged',stage,'--publish','never'],{cwd:__dirname,stdio:'inherit'});
process.exitCode=result.status||0;
