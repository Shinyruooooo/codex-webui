import { applyComposerSuggestion, createLatestRequestGate, defaultModelState, filterAppModels, groupModelsByProvider, formatFileMention, getComposerAutocomplete, resolveComposerPlaceholder, resolveLoginStatus, selectModelState } from './ui-core.js';
import { agentMessageText, renderAssistantMarkdown, renderItemImages } from './rendering.js';
import { formatProviderModels, parseProviderModels, matchingProviderPreset } from './provider-editor.js';
import { copyTextToClipboard, createMessageActions } from './message-actions.js';
import { calculatePanelWidthLimits, clampPanelWidth, createPanelResizer } from './panel-resize.js';
import { codexIcon, hydrateCodexIcons } from './codex-icons.js';
import { codexInterfaceMark } from './codex-brand.js';
import { createDomI18n, createI18n } from './i18n.js';
import { applyTheme, readStoredTheme, storeTheme } from './theme.js';
import { normalizeTokenUsage, contextUsageValue, formatCompactTokenCount, formatTokenCount, formatElapsed, formatQuotaResetCountdown, formatQuotaWindowLabel, normalizeRateLimits } from './usage.js';
import { CHAT_IMAGE_LIMIT, inlineImageUrl, isChatImageFile, readChatImageFile } from './chat-images.js';
import { buildConversationInput, draftStorageKey, exportFilename, formatThreadExportMarkdown, readThreadDraft, writeThreadDraft } from './session-tools.js';
import { buildApprovalModel, parseUnifiedDiff, permissionRows, summarizeActivity, unifiedDiffFromFileChanges } from './codex-surfaces.js';
import { browserSandboxFor, normalizeBrowserUrl } from './browser-panel.js';
import { THREAD_NOT_FOUND, bridgeErrorCode, createBridgeError, threadInputErrorMessage } from './bridge-errors.js';
import lottie from 'lottie-web/build/player/lottie_light.js';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
globalThis.__renderAssistantMarkdown = renderAssistantMarkdown;
const $ = (s) => document.querySelector(s);
const i18n=globalThis.__codexWebuiI18n||createI18n();
globalThis.__codexWebuiI18n=i18n;
globalThis.__codexWebuiDomI18n=globalThis.__codexWebuiDomI18n||createDomI18n(i18n);
const t=(message,values)=>i18n.t(message,values);
const messageActions=createMessageActions({translate:t,onCopyResult:success=>{const failure=t('Copy failed. Select the text and copy it manually.');if(!success)toast(failure);else if($('#toast')?.textContent===failure){clearTimeout(toast.t);$('#toast').classList.remove('show')}}});
const state = { ws:null, events:null, transport:'connecting', wsFallbackTimer:null, rpcId:1, pending:new Map(), threads:[], threadsLoaded:false, active:null, models:[], selectedModel:'', workspaceContext:null, projectless:false, cwd:'', composerMode:'local', planMode:false, permissionMode:localStorage.getItem('codex-webui-permission-mode')||'default', permissionProfiles:[], permissionVisibility:{autoReview:true,fullAccess:localStorage.getItem('codex-webui-permission-full-access')!=='false'}, goalMode:false, backgroundAgentsVisible:false, cloudStartingState:null, placeholderText:null, composerMentions:[], composerAttachments:[], turnWindow:null, tokenUsage:new Map(), items:new Map(), turns:new Map(), activities:new Map(), activityItems:new Map(), sideTasks:new Map(), dividers:new Map(), changes:new Map(), requestCards:new Map(), motion:new Map(), turnDiffs:new Map(), activeReview:null, account:null, rateLimits:null, login:{signedIn:false,accountType:'unknown',pending:null,loginId:'',busy:false,signedInAt:0}, connected:false, config:{home:'',defaultCwd:'',projectless:false} };
let pendingSubmission=null,conversationEpoch=0,runtimeTick=null,localRun=null,promptComposing=false;
const MAX_CLIENT_UPLOAD_BYTES=25*1024*1024;
const fileBrowserState={cwd:'',dir:'',parent:null,entries:[],preview:null,requestId:0,previewRequestId:0,sidebarTab:'sessions'};
const skillsState={filter:'official',query:'',cwd:'',personalRoot:'',extraRoots:[],errors:[],skills:[],curated:[],selected:null,editing:false,creating:false,requestId:0,inspectRequestId:0};
const skillMutations=new Set();
const threadRuns=new Map();
const unreadCompletedThreads=new Set();
const pendingApprovals=new Map(),interruptingTurns=new Set();
const pendingMarkdownFrames=new WeakMap();
let folderBrowse={path:'~',parent:null,selected:null};
let sidePanelReturnFocus=null,summaryPanelReturnFocus=null,imageViewerReturnFocus=null;
let bottomPanelLastView=null;
let sidebarLayoutMobile=null,sidebarManualState=null;
let pendingFullAccessAction='select';
let settingsMobileLayout=matchMedia('(max-width:480px)').matches;
const createTerminalState=(hostId,panelId)=>({hostId,panelId,term:null,fit:null,ws:null,resizeObserver:null,reconnectTimer:null,connectTimer:null,outputTimer:null,phase:'idle',connectionAttempts:0,receivedBytes:0,connectedAt:null,lastDataAt:null,lastCloseCode:null,lastCloseReason:'',renderError:false});
const terminalStates={bottom:createTerminalState('terminalHost','bottomPanel'),side:createTerminalState('sideTerminalHost','sidePanel')};
const RIGHT_PANEL_WIDTH_KEY='codex-webui-right-panel-width';
let preferredRightPanelWidth=(()=>{try{const value=Number(localStorage.getItem(RIGHT_PANEL_WIDTH_KEY));return Number.isFinite(value)&&value>0?value:null}catch{return null}})();
let appliedRightPanelWidth=340;
const browserState={history:[],index:-1,loadTimer:null,loadRequest:0};
const accountRequestGate=createLatestRequestGate();
const rateLimitRequestGate=createLatestRequestGate();
const workspaceContextRequestGate=createLatestRequestGate();
const permissionProfileRequestGate=createLatestRequestGate();
const terminalDiagnosticsRequestGate=createLatestRequestGate();
const autocompleteState={match:null,items:[],selected:0,requestId:0,message:''};
const ACTIVE_THREAD_STORAGE_KEY='codex-webui-active-thread';
const SIDEBAR_PROJECT_EXPANSION_KEY='codex-webui-sidebar-project-expansion';
const THREAD_SETTINGS_STORAGE_KEY='codex-webui-thread-settings';
const sidebarProjectExpansion=(()=>{try{return JSON.parse(localStorage.getItem(SIDEBAR_PROJECT_EXPANSION_KEY)||'{}')}catch{return{}}})();
const INITIAL_TURN_PAGE_SIZE=1,ACTIVE_THREAD_SYNC_ACTIVE_MS=800,ACTIVE_THREAD_SYNC_IDLE_MS=2400,THREAD_LIST_POLL_MS=3000;
let activeThreadSyncTimer=null,activeThreadSyncGeneration=0,activeThreadSyncInFlight=false,activeThreadSyncSignature='',threadListTimer=null,threadListInFlight=false,threadListSignature='';

const icons = {
  chevron:codexIcon('chevronRight','activity-chevron'),
  terminal:codexIcon('terminal'),
  file:codexIcon('file'),
  search:codexIcon('search'),
  tool:codexIcon('wrench'),
  check:codexIcon('check'),
};
hydrateCodexIcons();
$('#windowCodexMark').innerHTML=codexInterfaceMark('window-codex-mark');
$('#emptyCodexMark').innerHTML=codexInterfaceMark('empty-codex-mark');

const WS_CONNECT_TIMEOUT_MS=5000;
function transportSwitchError(){const error=new Error('Bridge transport changed');error.silentTransportSwitch=true;return error}
function clearWsFallbackTimer(){clearTimeout(state.wsFallbackTimer);state.wsFallbackTimer=null}
function rejectWebSocketPending(){for(const pending of state.pending.values())pending.reject(transportSwitchError());state.pending.clear()}
async function postBridge(path,payload){const response=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),cache:'no-store'}),data=await response.json().catch(()=>({}));if(!response.ok)throw createBridgeError(data.error||'Codex bridge request failed',data.code);return data}
function connectSse(){
  if(state.events)return;
  state.transport='sse';state.connected=false;setStatus('connecting','Connecting to Codex');
  const events=new EventSource('/api/events');state.events=events;
  events.onmessage=event=>{try{handle(JSON.parse(event.data))}catch{}};
  events.onerror=()=>{if(state.events!==events)return;state.connected=false;setStatus('connecting','Connecting to Codex')};
}
function fallbackToSse(ws){
  if(state.transport==='sse'||(ws&&state.ws!==ws))return;
  clearWsFallbackTimer();rejectWebSocketPending();state.connected=false;
  if(ws){ws.onopen=ws.onmessage=ws.onerror=ws.onclose=null;try{ws.close()}catch{}}
  state.ws=null;connectSse();
}
function connect(){
  if(state.transport==='sse'||state.ws)return;
  const proto=location.protocol==='https:'?'wss:':'ws:';
  let ws;
  try{ws=new WebSocket(`${proto}//${location.host}/ws`)}catch{fallbackToSse();return}
  state.transport='ws';state.ws=ws;
  const fallback=()=>fallbackToSse(ws);
  state.wsFallbackTimer=setTimeout(fallback,WS_CONNECT_TIMEOUT_MS);
  ws.onopen=()=>{if(state.ws===ws)setStatus('connecting','Connecting to Codex')};
  ws.onmessage=(event)=>{if(state.ws!==ws)return;try{const message=JSON.parse(event.data);clearWsFallbackTimer();handle(message)}catch{fallback()}};
  ws.onerror=fallback;ws.onclose=fallback;
}
// E2E 测试可以通过 __codexWebuiRpcTimeoutMs 缩短等待，生产默认 45s（必须大于服务端 30s 超时）。
const RPC_TIMEOUT_MS=Number(globalThis.__codexWebuiRpcTimeoutMs)||45000;
// 桥接响应可能因为 app-server 侧超时（例如模型目录刷新失败）或传输丢失而永远不到达；
// 没有超时的话 loadInitial 会永久停在“正在加载模型…”。
function withRpcTimeout(promise,method,onTimeout){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{try{onTimeout?.()}catch{}reject(createBridgeError(`Codex request timed out: ${method}`,'timeout'))},RPC_TIMEOUT_MS);promise.then(value=>{clearTimeout(timer);resolve(value)},error=>{clearTimeout(timer);reject(error)})})}
function rpc(method,params={}){
  const id=state.rpcId++;
  if(state.transport==='sse')return withRpcTimeout(postBridge('/api/rpc',{id,method,params}).then(message=>{if(message.type!=='rpc/result')throw createBridgeError(message.error||'Codex bridge request failed',message.code);return message.result}),method);
  if(state.ws?.readyState===WebSocket.OPEN){try{state.ws.send(JSON.stringify({type:'rpc',id,method,params}));return withRpcTimeout(new Promise((resolve,reject)=>state.pending.set(id,{resolve,reject})),method,()=>state.pending.delete(id))}catch{fallbackToSse(state.ws);return Promise.reject(transportSwitchError())}}
  return Promise.reject(transportSwitchError());
}
function respondToCodex(requestId,result,error){
  if(state.transport==='sse')return postBridge('/api/codex/respond',{requestId,result,error});
  if(state.ws?.readyState===WebSocket.OPEN){try{state.ws.send(JSON.stringify(error?{type:'codex/error',requestId,error}:{type:'codex/response',requestId,result}));return Promise.resolve()}catch{fallbackToSse(state.ws);return Promise.reject(transportSwitchError())}}
  return Promise.reject(transportSwitchError());
}
function handle(message){
  if(message.type==='bridge/status'){
    if(message.status==='connected'){const shouldLoad=!state.connected||!state.threadsLoaded;state.connected=true;setStatus('connected','Codex connected');if(shouldLoad){loadInitial();requestTaskNotifyPermission()}}
    else{state.connected=false;pendingApprovals.clear();for(const card of state.requestCards.values())card.remove();state.requestCards.clear();setStatus('connecting','Connecting to Codex')}
    return;
  }
  if(message.type==='rpc/result'||message.type==='rpc/error'){
    const p=state.pending.get(message.id);if(!p)return;state.pending.delete(message.id);
    message.type==='rpc/result'?p.resolve(message.result):p.reject(createBridgeError(message.error,message.code));return;
  }
  if(message.type==='providers/updated'){
    if(!providerState.mutationBusy){if(state.connected)void refreshModels();if($('#settingsDialog').open)void loadModelProviders()}
    return;
  }
  if(message.type==='codex/notification') onNotification(message.payload.method,message.payload.params||{});
  if(message.type==='codex/request') onServerRequest(message.payload);
}
function setStatus(kind,text){
  $('#statusDot').className='status-dot'+(kind==='connected'?' connected':kind==='error'?' error':'');
  $('#statusText').textContent=t(text||kind);
  renderRuntimeBar();
}
const INITIAL_LOAD_RETRY_DELAYS=[1000,3000,8000,20000,30000];
const INITIAL_LOAD_SLOW_RETRY_MS=60000;
let initialLoadTimer=null,initialLoadFailures=0;
// 初始加载是必需状态：快速重试几次后改为每分钟一次的慢重试，不再有“重试用尽后永久卡住”。
function initialLoadIncomplete(){return !state.threadsLoaded||!state.models.length}
function scheduleInitialLoadRetry(){
  clearTimeout(initialLoadTimer);
  if(document.visibilityState==='hidden')return;
  const delay=initialLoadFailures<=INITIAL_LOAD_RETRY_DELAYS.length?INITIAL_LOAD_RETRY_DELAYS[Math.max(0,initialLoadFailures-1)]:INITIAL_LOAD_SLOW_RETRY_MS;
  initialLoadTimer=setTimeout(()=>{if(state.connected)loadInitial()},delay);
}
// 模型目录、会话列表和权限档位互相独立：任何一项失败都不应该把其它两项一起拖死，
// 而且失败后要能自行重试，不要求用户手动刷新页面。
async function loadInitial(refreshAccount=false){
  loadAccount(refreshAccount);
  void loadLoginStatus();
  void loadSkillsCatalog();
  const [models,threads,profiles,rateLimits]=await Promise.allSettled([
    rpc('model/list',{limit:50}),
    rpc('thread/list',{limit:50,sortKey:'recency_at',sortDirection:'desc'}),
    rpc('permissionProfile/list',{cwd:permissionProfileCwd(),limit:100}),
    rpc('account/rateLimits/read'),
  ]);
  let failure=null,transportSwitched=false;
  for(const result of [models,threads,profiles])if(result.status==='rejected'&&result.reason?.silentTransportSwitch)transportSwitched=true;
  if(models.status==='fulfilled'){state.models=filterAppModels(models.value?.data||[]);renderModels()}else failure=failure||models.reason;
  if(threads.status==='fulfilled'){applyThreadSummaries(threads.value?.data||[]);state.threadsLoaded=true;scheduleThreadListRefresh()}else failure=failure||threads.reason;
  if(profiles.status==='fulfilled')setPermissionProfiles(profiles.value?.data||[]);
  if(rateLimits.status==='fulfilled')applyRateLimits(rateLimits.value);
  if(failure&&!transportSwitched){
    initialLoadFailures+=1;
    if(initialLoadFailures<=2)toast(t('Retrying Codex connection…'));
    scheduleInitialLoadRetry();
    return;
  }
  if(transportSwitched)return;
  clearTimeout(initialLoadTimer);initialLoadFailures=0;state.models=state.models||[];
  const rememberedThread=localStorage.getItem(ACTIVE_THREAD_STORAGE_KEY);
  if(!state.active&&rememberedThread){try{await openThread(rememberedThread)}catch(error){if(!error?.silentTransportSwitch)toast(t(threadInputErrorMessage(error)),5200)}}
}
async function loadAccount(refresh=false){
  const requestId=accountRequestGate.next();
  try{const response=await fetch(`/api/account${refresh?'?refresh=1':''}`,{cache:'no-store'}),account=await response.json();if(!response.ok)throw new Error(account.error||'Cannot load account');if(!accountRequestGate.isCurrent(requestId))return;state.account=account;renderAccount(account)}catch{if(accountRequestGate.isCurrent(requestId))renderAccount({displayName:null,avatarUrl:null,planType:null,initials:'?'})}
}
function renderAccount(account){
  state.account=account;
  const displayName=account?.displayName?.trim()||t('Settings'),initials=account?.initials?.trim()||'?',type=account?.type||'unknown',plan=account?.planType?`${account.planType.charAt(0).toUpperCase()}${account.planType.slice(1)} plan`:type==='apiKey'?t('API key mode'):type==='amazonBedrock'?'Amazon Bedrock':'';
  const profileMenuAvailable=type==='chatgpt';
  $('#accountName').textContent=displayName;$('#accountMenuName').textContent=displayName;$('#settingsAccountName').textContent=displayName;$('#accountFooterMeta').textContent='';$('#accountMenuSubtitle').textContent=plan;$('#settingsAccountMeta').textContent=plan||t('Codex account');
  $('#accountButton').setAttribute('aria-label',profileMenuAvailable?'Open profile menu':'Open settings');
  const avatarUrl=profileMenuAvailable&&typeof account?.avatarUrl==='string'&&account.avatarUrl.startsWith('/api/account/avatar')?account.avatarUrl:'',profileAvatars=[$('#accountMenuAvatar'),$('#settingsAccountAvatar')],footerAvatar=$('#accountAvatar'),profileAvatarClass=avatar=>`account-avatar${avatar.id==='accountMenuAvatar'?' account-menu-avatar':''}`;for(const avatar of profileAvatars){avatar.dataset.imageUrl=avatarUrl;avatar.className=`${profileAvatarClass(avatar)} account-initials`;avatar.textContent=initials}
  if(profileMenuAvailable){footerAvatar.dataset.imageUrl=avatarUrl;footerAvatar.className='account-avatar account-initials';footerAvatar.textContent=initials;profileAvatars.unshift(footerAvatar)}else{footerAvatar.dataset.imageUrl='';footerAvatar.className='account-avatar account-settings-icon';footerAvatar.innerHTML=codexIcon('wrench')}
  if(avatarUrl){const image=new Image;image.alt='';image.src=`${avatarUrl}?v=${Date.now()}`;image.onload=()=>{for(const avatar of profileAvatars){if(avatar.dataset.imageUrl!==avatarUrl)continue;avatar.className=profileAvatarClass(avatar);avatar.replaceChildren(image.cloneNode())}};image.onerror=()=>{for(const avatar of profileAvatars){if(avatar.dataset.imageUrl!==avatarUrl)continue;avatar.className=`${profileAvatarClass(avatar)} account-initials`;avatar.textContent=initials}}}
  if(!profileMenuAvailable)toggleAccountMenu(false);
  const apiMode=!profileMenuAvailable;$('#accountProfile').hidden=apiMode;$('#accountUsage').hidden=apiMode;$('#accountLogout').hidden=apiMode;
  const accountSettingsPage=$('[data-settings-page="profile"]');if(accountSettingsPage){accountSettingsPage.dataset.settingsAvailable='true';filterSettingsNavigation($('#settingsSearch')?.value||'')}
  syncAccountQuotaMeta();
  syncPermissionSettings();syncPermissionControl();
}
async function loadLoginStatus(){
  try{
    const response=await fetch('/api/login/status',{cache:'no-store'}),payload=await response.json();
    if(!response.ok)throw new Error(payload.error||'Cannot load sign-in status');
    state.login.signedIn=!!payload.signedIn;
    state.login.accountType=payload.accountType||'unknown';
    state.login.pending=payload.pending||null;
    if(state.login.pending?.loginId)state.login.loginId=state.login.pending.loginId;
    renderLoginState();
    if(state.login.pending)openLoginDialog();else closeLoginDialog();
  }catch{}
}
let loginPollTimer=null;
function startLoginPolling(){stopLoginPolling();loginPollTimer=setInterval(()=>void pollLoginStatus(),2000);void pollLoginStatus()}
function stopLoginPolling(){if(loginPollTimer){clearInterval(loginPollTimer);loginPollTimer=null}}
// The completion notification can be missed when the browser tab is suspended
// or the bridge connection drops, so the open sign-in is polled as well.
async function pollLoginStatus(){
  if(!state.login.busy&&!state.login.pending&&!state.login.loginId)return;
  try{
    const response=await fetch('/api/login/status',{cache:'no-store'}),payload=await response.json();
    if(!response.ok)return;
    const resolved=resolveLoginStatus(state.login,payload);
    state.login.signedIn=resolved.signedIn;
    state.login.accountType=resolved.accountType;
    state.login.pending=resolved.pending;
    if(resolved.pending?.loginId)state.login.loginId=resolved.pending.loginId;
    if(resolved.outcome==='signed-in'){
      state.login.loginId='';
      state.login.signedInAt=Date.now();
      closeLoginDialog();
      renderLoginState();
      toast(t('Signed in to ChatGPT'));
      void loadAccount(true);
      return;
    }
    if(resolved.outcome==='not-completed'){
      state.login.loginId='';
      closeLoginDialog();
      renderLoginState();
      toast(t('Sign-in was not completed'));
      return;
    }
    renderLoginState();
  }catch{}
}
function renderLoginState(){
  const signedOutRow=$('#settingsAccountSignedOut');
  if(signedOutRow)signedOutRow.hidden=state.login.signedIn;
  const loginButton=$('#settingsAccountLogin');
  if(loginButton)loginButton.disabled=state.login.busy||!!state.login.pending;
  const dialog=$('#loginDialog');
  if(!dialog)return;
  const pending=state.login.pending,code=$('#loginUserCode'),link=$('#loginVerificationLink'),status=$('#loginStatus'),intro=$('#loginIntro');
  if(code)code.textContent=pending?.userCode||'';
  if(link){const url=pending?.verificationUrl||'';link.href=url;link.hidden=!url}
  if(intro)intro.hidden=!pending&&!state.login.busy;
  if(status)status.textContent=state.login.busy?t('Starting sign-in…'):'';
}
async function startChatgptLogin(){
  if(state.login.busy||state.login.pending)return;
  state.login.busy=true;renderLoginState();
  try{
    const result=await rpc('account/login/start',{type:'chatgptDeviceCode'});
    state.login.loginId=result?.loginId||'';
    state.login.pending={userCode:result?.userCode||'',verificationUrl:result?.verificationUrl||''};
    openLoginDialog();
  }catch(error){toast(t('Sign-in could not start: {message}',{message:error.message||String(error)}))}
  finally{state.login.busy=false;renderLoginState()}
}
async function cancelChatgptLogin(){
  const loginId=state.login.loginId;
  state.login.loginId='';state.login.pending=null;
  closeLoginDialog();renderLoginState();
  if(loginId){try{await rpc('account/login/cancel',{loginId})}catch{}}
}
function openLoginDialog(){const dialog=$('#loginDialog');if(!dialog)return;renderLoginState();if(!dialog.open)dialog.showModal();startLoginPolling()}
function closeLoginDialog(){stopLoginPolling();const dialog=$('#loginDialog');if(dialog?.open)dialog.close()}
function toggleAccountMenu(force){const menu=$('#accountMenu'),open=force??menu.hidden;menu.hidden=!open;$('#accountButton').setAttribute('aria-expanded',String(open))}
async function loadRateLimits(){
  if(!state.connected)return;
  const requestId=rateLimitRequestGate.next();
  try{
    const result=await rpc('account/rateLimits/read');
    if(rateLimitRequestGate.isCurrent(requestId))applyRateLimits(result);
  }catch{}
}
function quotaWindowSummaryLabel(window){
  if(!window)return null;
  const label=t(formatQuotaWindowLabel(window.windowDurationMins));
  return `${label}: ${window.remainingPercent}%`;
}
function renderRateLimitsSection(){
  const limits=state.rateLimits;if(!limits?.primary&&!limits?.secondary)return '';
  const renderWindow=(window,fallbackLabel)=>{
    if(!window)return '';
    const label=t(formatQuotaWindowLabel(window.windowDurationMins)||fallbackLabel),reset=formatQuotaResetCountdown(window.resetsAt),tone=window.remainingPercent<=0?' exhausted':window.remainingPercent<=15?' low':'';
    const detail=`${window.remainingPercent}% ${t('left')} (${window.usedPercent}% ${t('used')}${reset?` · ${t('resets in')} ${reset}`:''})`;
    return `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(detail)}</dd><div class="quota-meter" style="grid-column:1/-1"><div class="quota-meter-fill${tone}" style="width:${window.remainingPercent}%"></div></div>`;
  };
  const creditRow=Number.isInteger(limits.resetCreditsCount)&&limits.resetCreditsCount>0?`<dt>${escapeHtml(t('Reset credits'))}</dt><dd>${limits.resetCreditsCount}</dd>`:'';
  return `<section data-quota-section><strong>${escapeHtml(t('Remaining quota'))}</strong><dl>${renderWindow(limits.primary,'5h')}${renderWindow(limits.secondary,'Weekly')}${creditRow}</dl></section>`;
}
function syncAccountQuotaMeta(){
  const limits=state.rateLimits,parts=[quotaWindowSummaryLabel(limits?.primary),quotaWindowSummaryLabel(limits?.secondary)].filter(Boolean);
  const title=$('#settingsQuotaTitle'),rows=$('#settingsQuotaRows');
  if(title&&rows){
    title.hidden=!parts.length;
    rows.innerHTML=parts.length?renderRateLimitsSection():'';
  }
}
function applyRateLimits(payload){
  state.rateLimits=normalizeRateLimits(payload,state.rateLimits);
  syncAccountQuotaMeta();
  renderRuntimeBar();
}
const settingsPageAliases={general:'general-settings',account:'profile',keyboard:'keyboard-shortcuts'};
const settingsPages={
  'general-settings':{title:'General'},appearance:{title:'Appearance'},agent:{title:'Configuration'},providers:{title:'Model providers'},profile:{title:'Profile'},'keyboard-shortcuts':{title:'Keyboard shortcuts'},
};
function normalizeSettingsPage(page='general-settings'){const candidate=settingsPageAliases[page]||page;return settingsPages[candidate]?candidate:'general-settings'}
function settingsRoutePage(pathname=location.pathname){const match=pathname.match(/^\/settings(?:\/([^/]+))?\/?$/);return match?normalizeSettingsPage(match[1]||'general-settings'):null}
function settingsPlaceholderRows(page){if(page==='agent')return[['Model',modelDisplay(selectedModel())],['Reasoning effort',reasoningLabel($('#effortSelect').value)],['Approval',selectedPermission().label],['Web search','Automatic']];return settingsPages[page]?.rows||[]}
function renderSettingsPlaceholder(page){const definition=settingsPages[page],title=$('#settingsPlaceholderTitle'),description=$('#settingsPlaceholderDescription'),rows=$('#settingsPlaceholderRows');title.textContent=t(definition.title);description.hidden=true;description.textContent='';rows.replaceChildren();for(const [label,value] of settingsPlaceholderRows(page)){const row=document.createElement('div');row.className='settings-row settings-readonly-row';const copy=document.createElement('span'),strong=document.createElement('strong'),status=document.createElement('span');strong.textContent=t(label);copy.append(strong);status.textContent=t(value);row.append(copy,status);rows.append(row)}}
function setSettingsPage(page='general-settings',{updateRoute=true}={}){const selected=normalizeSettingsPage(page),contentPage=['general-settings','appearance','providers','profile','keyboard-shortcuts'].includes(selected)?selected:'placeholder';for(const button of document.querySelectorAll('[data-settings-page]'))button.classList.toggle('active',button.dataset.settingsPage===selected);for(const content of document.querySelectorAll('[data-settings-content]'))content.hidden=content.dataset.settingsContent!==contentPage;if(contentPage==='providers')void loadModelProviders();if(contentPage==='placeholder')renderSettingsPlaceholder(selected);$('#settingsPageTitle').textContent=t(settingsPages[selected].title);$('#settingsContent')?.scrollTo({top:0});if(updateRoute&&settingsRoutePage())history.replaceState({...history.state,codexWebuiSettings:true},'',`/settings/${selected}`)}
function filterSettingsNavigation(query=''){const normalized=query.trim().toLocaleLowerCase(),clear=$('#clearSettingsSearch');let visible=0;if(clear)clear.hidden=!normalized;for(const group of document.querySelectorAll('[data-settings-group]')){let groupVisible=0;for(const button of group.querySelectorAll('[data-settings-page]')){const available=button.dataset.settingsAvailable!=='false',matches=!normalized||button.textContent.toLocaleLowerCase().includes(normalized);button.hidden=!available||!matches;if(!button.hidden){groupVisible++;visible++}}group.hidden=groupVisible===0}$('#settingsNavEmpty').hidden=visible!==0}
function clearSettingsSearch(){const input=$('#settingsSearch');input.value='';filterSettingsNavigation();input.focus()}
function showSettingsMobileNavigation(){const dialog=$('#settingsDialog');dialog.dataset.mobilePage='false';requestAnimationFrame(()=>$('#settingsSearch').focus())}
function syncSettingsResponsiveLayout(){const mobile=matchMedia('(max-width:480px)').matches;if(mobile===settingsMobileLayout)return;settingsMobileLayout=mobile;const dialog=$('#settingsDialog');if(dialog.open)dialog.dataset.mobilePage=String(mobile)}
function hideSettings(){const dialog=$('#settingsDialog');if(dialog.open)dialog.close();document.body.classList.remove('settings-open')}
function closeSettings(){if(settingsRoutePage()){if(typeof history.state?.codexSettingsReturnPath==='string'){history.back();return}history.replaceState({},'',state.cwd?`/?cwd=${encodeURIComponent(state.cwd)}`:'/');hideSettings();return}hideSettings()}
$('#closeSettingsNav').onclick=closeSettings;$('#settingsMobileBack').onclick=showSettingsMobileNavigation;for(const button of document.querySelectorAll('.settings-page .settings-mobile-back'))button.onclick=showSettingsMobileNavigation;$('#settingsSearch').oninput=event=>filterSettingsNavigation(event.currentTarget.value);$('#clearSettingsSearch').onclick=clearSettingsSearch;$('#settingsSearch').onkeydown=event=>{if(event.key==='Escape'&&event.currentTarget.value){event.preventDefault();clearSettingsSearch()}};addEventListener('resize',syncSettingsResponsiveLayout);addEventListener('popstate',()=>{const page=settingsRoutePage();if(page){showSettings(page,{updateRoute:false});return}hideSettings()});
function showSettings(page='general-settings',{updateRoute=true}={}){toggleAccountMenu(false);syncPermissionSettings();$('#settingsPermissionValue').textContent=t(selectedPermission().label);$('#settingsProjectValue').textContent=state.projectless?t('No project'):shortPath(state.active?.cwd||state.cwd||'');$('#settingsSearch').value='';filterSettingsNavigation();setSettingsPage(page,{updateRoute});const dialog=$('#settingsDialog'),mobile=matchMedia('(max-width:480px)').matches;settingsMobileLayout=mobile;dialog.dataset.mobilePage=String(mobile);if(!dialog.open)dialog.show();document.body.classList.add('settings-open');requestAnimationFrame(()=>{const target=mobile?$('#settingsSearch'):document.querySelector('.settings-nav-back');target?.focus()})}
function openSettings(page='general-settings'){const selected=normalizeSettingsPage(page),current=settingsRoutePage();if(!current){history.pushState({codexWebuiSettings:true,codexSettingsReturnPath:location.pathname+location.search+location.hash},'',`/settings/${selected}`)}else if(current!==selected){history.replaceState({...history.state,codexWebuiSettings:true},'',`/settings/${selected}`)}showSettings(selected,{updateRoute:false})}
const providerState={providers:[],presets:[],editing:null,presetId:'custom',models:[],mutationBusy:false,refreshInfo:new Map(),revision:null,editorRevision:null};
function setProviderMutationBusy(busy){
  providerState.mutationBusy=busy;$('#providerForm').setAttribute('aria-busy',String(busy));
  for(const control of document.querySelectorAll('#providerRows button,#providerRows input,#providerPresetCards button,#providerPresetCards input,#providerAddButton,#providerSaveButton,#providerCancelButton'))control.disabled=busy||control.dataset.unconfigured==='true';
  $('#providerRefreshAllButton').disabled=busy||!providerState.providers.length;
}
async function refreshModels(){try{const result=await rpc('model/list',{limit:50});state.models=filterAppModels(result?.data||[]);renderModels()}catch(error){if(!error?.silentTransportSwitch)toast(error.message)}}
async function waitForCodexBridge(timeout=20000){const started=Date.now();let sawDisconnect=false;for(;;){try{const response=await fetch('/api/health',{cache:'no-store'}),body=await response.json();if(!body.codex)sawDisconnect=true;if(body.codex&&(sawDisconnect||Date.now()-started>1500))return}catch{}if(Date.now()-started>timeout)throw new Error(t('Codex bridge did not reconnect'));await new Promise(resolve=>setTimeout(resolve,250))}}
async function loadModelProviders(){
  try{
    const response=await fetch('/api/providers',{cache:'no-store'}),payload=await response.json();
    if(!response.ok)throw new Error(payload.error||t('Cannot load providers'));
    providerState.providers=payload.providers||[];providerState.presets=payload.presets||[];providerState.revision=payload.revision;renderProviderRows();
  }catch(error){toast(error.message)}
}
function providerEnabledCount(provider){return provider.enabled===false?0:provider.models.filter(model=>model.enabled!==false).length}
function providerToggleControl({checked,disabled=false,label,onchange,modelId,providerId}){
  const wrapper=document.createElement('label');wrapper.className='provider-toggle';
  const input=document.createElement('input');input.type='checkbox';input.checked=checked;input.setAttribute('role','switch');input.setAttribute('aria-label',label);input.dataset.providerId=providerId;
  if(modelId)input.dataset.modelId=modelId;input.dataset.unconfigured=String(disabled);input.disabled=disabled||providerState.mutationBusy;input.onchange=()=>onchange(input.checked);
  const track=document.createElement('span');track.className='settings-switch';track.setAttribute('aria-hidden','true');
  wrapper.append(input,track);return wrapper;
}
function renderProviderCards(){
  const grid=$('#providerPresetCards');grid.replaceChildren();
  for(const preset of [...providerState.presets,{id:'custom',label:'Custom endpoint'}]){
    const provider=preset.provider?providerState.providers.find(item=>item.id===preset.provider.id&&item.baseUrl===preset.provider.baseUrl):null;
    const count=provider?providerEnabledCount(provider):0,all=Boolean(provider&&count===provider.models.length);
    const card=document.createElement('article');card.className='provider-preset-card';card.dataset.presetId=preset.id;card.dataset.configured=String(Boolean(provider));
    const button=document.createElement('button');button.type='button';button.className='provider-card-main';button.disabled=providerState.mutationBusy;button.onclick=()=>openProviderEditor(provider||null,preset.id);
    const icon=document.createElement('span');icon.className='provider-card-icon';icon.setAttribute('aria-hidden','true');icon.textContent=({'zai-cn':'GLM',zai:'Z',deepseek:'DS',minimax:'MM',custom:'+'})[preset.id]||'AI';
    const copy=document.createElement('span');copy.className='provider-card-copy';const name=document.createElement('strong');name.textContent=t(preset.label);
    const status=document.createElement('small');status.textContent=preset.id==='custom'?t('Configure a Responses endpoint'):provider?`${t('Configured')} · ${count}/${provider.models.length} ${t('Models enabled')}`:t('Not configured');
    copy.append(name,status);button.append(icon,copy);card.append(button);
    if(preset.provider){const controls=document.createElement('div');controls.className='provider-card-controls';const label=document.createElement('span');label.textContent=t(all?'Enabled':count?'Partially enabled':'Disabled');controls.append(label,providerToggleControl({checked:all,disabled:!provider,label:`${t('Enable all models')}: ${t(preset.label)}`,providerId:provider?.id||preset.provider.id,onchange:enabled=>mutateProviderCatalog({action:'toggle',id:provider.id,enabled},'Model selection updated')}));card.append(controls)}
    grid.append(card);
  }
}
function renderProviderRows(){
  renderProviderCards();$('#providerRefreshAllButton').disabled=providerState.mutationBusy||!providerState.providers.length;
  const rows=$('#providerRows');if(!rows)return;
  const open=new Set([...rows.querySelectorAll('details[open]')].map(node=>node.dataset.providerId));rows.replaceChildren();
  if(!providerState.providers.length){const empty=document.createElement('div');empty.className='settings-row settings-readonly-row';empty.innerHTML=`<span><strong>${t('No custom providers')}</strong><small>${t('Add a Responses-compatible endpoint to use third-party models')}</small></span>`;rows.append(empty);return}
  for(const provider of providerState.providers){
    const group=document.createElement('section');group.className='provider-group';group.dataset.providerId=provider.id;
    const row=document.createElement('div');row.className='settings-row settings-readonly-row';
    const copy=document.createElement('span');copy.className='provider-meta';const count=providerEnabledCount(provider);
    const strong=document.createElement('strong');strong.textContent=provider.name;
    const url=document.createElement('small');url.textContent=`${provider.baseUrl} · ${count}/${provider.models.length} ${t('Models enabled')}${provider.hasApiKey?'':' · '+t('API key missing')}`;copy.append(strong,url);
    const actions=document.createElement('span');actions.className='provider-actions';
    for(const [label,action] of [['Edit',()=>openProviderEditor(provider)],['Delete',()=>deleteProvider(provider.id)],['Refresh models',()=>mutateProviderCatalog({action:'refresh',id:provider.id})]]){
      const button=document.createElement('button');button.type='button';button.className='files-action-button';button.textContent=t(label);button.disabled=providerState.mutationBusy;button.onclick=action;if(label==='Refresh models')button.dataset.refreshProvider=provider.id;actions.append(button);
    }
    actions.append(providerToggleControl({checked:count===provider.models.length,label:`${t('Enable all models')}: ${provider.name}`,providerId:provider.id,onchange:enabled=>mutateProviderCatalog({action:'toggle',id:provider.id,enabled},'Model selection updated')}));row.append(copy,actions);group.append(row);
    const models=document.createElement('details');models.className='provider-models';models.dataset.providerId=provider.id;models.open=open.has(provider.id);const summary=document.createElement('summary');summary.textContent=`${t('Models')} · ${count}/${provider.models.length} ${t('Enabled').toLowerCase()}`;models.append(summary);
    for(const model of provider.models){const modelRow=document.createElement('div');modelRow.className='provider-model-row';const label=document.createElement('span');label.className='provider-model-copy';const name=document.createElement('span');name.textContent=model.displayName||model.id;const id=document.createElement('small');id.textContent=model.id;label.append(name,id);modelRow.append(label,providerToggleControl({checked:provider.enabled!==false&&model.enabled!==false,label:`${t('Enable model')}: ${model.id}`,providerId:provider.id,modelId:model.id,onchange:enabled=>mutateProviderCatalog({action:'model-toggle',id:provider.id,modelId:model.id,enabled},'Model selection updated')}));models.append(modelRow)}
    group.append(models);const info=providerState.refreshInfo.get(provider.id);if(info){const note=document.createElement('p');note.className='provider-refresh-info';note.textContent=info;group.append(note)}rows.append(group);
  }
}
function populateProviderFields(provider,preset){
  providerState.models=provider?.models||[];
  $('#providerIdInput').value=provider?.id||'';
  $('#providerIdInput').disabled=Boolean(providerState.editing);
  $('#providerNameInput').value=provider?.name||'';
  $('#providerBaseUrlInput').value=provider?.baseUrl||'';
  $('#providerModelsInput').value=formatProviderModels(providerState.models);
  const existing=providerState.providers.find(item=>item.id===provider?.id&&item.baseUrl===provider?.baseUrl);
  const keyInput=$('#providerApiKeyInput');keyInput.value='';keyInput.placeholder=existing?.hasApiKey?t('Unchanged'):'sk-…';
  $('#providerPresetHint').textContent=t(preset?.description||'Configure your own Responses-compatible endpoint below.');
  const docs=$('#providerPresetDocs');docs.hidden=!preset;if(preset)docs.href=preset.docsUrl;else docs.removeAttribute('href');
  $('#providerAdvancedDetails').open=!preset;
}
function openProviderEditor(provider=null,presetId=null){
  if(providerState.mutationBusy)return;
  providerState.editing=provider?.id||null;providerState.editorRevision=providerState.revision;
  const preset=presetId?providerState.presets.find(item=>item.id===presetId):provider?matchingProviderPreset(providerState.presets,provider):providerState.presets[0];
  providerState.presetId=preset?.id||'custom';
  $('#providerEditorTitle').textContent=preset?.label||provider?.name||'Provider details';
  populateProviderFields(provider||preset?.provider,preset);
  $('#providerForm').hidden=false;$('#providerSaveButton').disabled=false;
  (preset?$('#providerApiKeyInput'):$('#providerIdInput')).focus();
}
function closeProviderEditor(force=false){if(providerState.mutationBusy&&!force)return;$('#providerForm').hidden=true;$('#providerApiKeyInput').value='';$('#providerEditorTitle').textContent='Provider details';providerState.editing=null;providerState.presetId='custom'}
async function saveProviderEditor(submitEvent){
  submitEvent.preventDefault();
  if(providerState.mutationBusy)return;
  setProviderMutationBusy(true);
  try{
    const models=parseProviderModels($('#providerModelsInput').value,providerState.models);
    const response=await fetch('/api/providers',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'save',expectedRevision:providerState.editorRevision,presetId:providerState.presetId,provider:{id:$('#providerIdInput').value.trim(),name:$('#providerNameInput').value.trim(),baseUrl:$('#providerBaseUrlInput').value.trim(),apiKey:$('#providerApiKeyInput').value,models}})});
    const payload=await response.json();
    if(!response.ok)throw new Error(payload.error||t('Cannot save provider'));
    providerState.providers=payload.providers||[];providerState.revision=payload.revision;renderProviderRows();closeProviderEditor(true);
    if(payload.restarted){toast(t('Provider saved · restarting Codex bridge…'));await waitForCodexBridge()}else toast(t('Provider saved'));
    await refreshModels();
  }catch(error){toast(t(error.message))}finally{setProviderMutationBusy(false)}
}
async function deleteProvider(id){
  if(providerState.mutationBusy||!confirm(t('Delete provider?')))return;
  setProviderMutationBusy(true);
  try{
    const response=await fetch('/api/providers',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'delete',id})});
    const payload=await response.json();
    if(!response.ok)throw new Error(payload.error||t('Cannot delete provider'));
    providerState.providers=payload.providers||[];providerState.revision=payload.revision;renderProviderRows();
    if(payload.restarted){toast(t('Provider deleted · restarting Codex bridge…'));await waitForCodexBridge();await refreshModels()}
  }catch(error){toast(error.message)}finally{setProviderMutationBusy(false)}
}
async function sendProviderCatalogAction(payload){
  const response=await fetch('/api/providers',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}),result=await response.json();
  if(!response.ok)throw new Error(result.error||'Cannot update model catalog');
  providerState.providers=result.providers||[];providerState.revision=result.revision;
  if(result.refresh){const info=result.refresh;providerState.refreshInfo.set(payload.id,`${t(info.source==='remote'?'Provider catalog refreshed':'Built-in catalog refreshed')} · ${info.added} ${t('New models (disabled by default)')}${info.warning?' · '+t(info.warning):''}`)}
  renderProviderRows();if(result.restarted)await waitForCodexBridge();await refreshModels();return result;
}
async function mutateProviderCatalog(payload,message=null){
  if(providerState.mutationBusy)return;setProviderMutationBusy(true);
  try{await sendProviderCatalogAction(payload);toast(t(message||'Model catalog refreshed'))}catch(error){toast(t(error.message));renderProviderRows()}finally{setProviderMutationBusy(false)}
}
async function refreshAllProviderModels(){
  if(providerState.mutationBusy||!providerState.providers.length)return;setProviderMutationBusy(true);
  let completed=0;const ids=providerState.providers.map(provider=>provider.id);
  try{for(const id of ids){try{await sendProviderCatalogAction({action:'refresh',id});completed++}catch(error){providerState.refreshInfo.set(id,t(error.message));renderProviderRows()}}toast(`${t('Model catalogs refreshed')}: ${completed}/${ids.length}`)}finally{setProviderMutationBusy(false)}
}
const reasoningLabels={none:'None',minimal:'Minimal',low:'Low',medium:'Medium',high:'High',xhigh:'Extra High',max:'Max',ultra:'Ultra'};
function reasoningLabel(value){return t(reasoningLabels[value]||String(value||'Medium'))}
function modelDisplay(model,stripPrefix=false){const value=String(model?.displayName||model?.model||state.selectedModel||'Select model').trim();if(!stripPrefix)return value;return value.replace(/^GPT-/i,'').trim()||value}
function selectedModel(){return state.models.find(x=>x.model===state.selectedModel)}
function threadSettingsMap(){try{const value=JSON.parse(localStorage.getItem(THREAD_SETTINGS_STORAGE_KEY)||'{}');return value&&typeof value==='object'?value:{}}catch{return{}}}
function threadSettings(threadId=state.active?.id){return threadId?threadSettingsMap()[threadId]||{}:{}}
function saveThreadSettings(threadId,patch){if(!threadId)return;const map=threadSettingsMap();map[threadId]={...(map[threadId]||{}),...patch};localStorage.setItem(THREAD_SETTINGS_STORAGE_KEY,JSON.stringify(map))}
function saveActiveThreadSettings(){if(!state.active?.id)return;const settings=threadSettings(state.active.id),effort=$('#effortSelect')?.value;saveThreadSettings(state.active.id,{model:state.selectedModel,permissionMode:state.permissionMode,efforts:{...(settings.efforts||{}),...(effort?{[state.selectedModel]:effort}:{})}})}
function applyThreadSettings(thread){const settings=threadSettings(thread?.id),defaultModel=localStorage.getItem('codex-webui-model'),threadModel=typeof thread?.model==='string'?thread.model:null;state.selectedModel=settings.model||threadModel||defaultModel||state.models[0]?.model||'';if(!state.models.some(model=>model.model===state.selectedModel))state.selectedModel=defaultModel||state.models[0]?.model||'';updateEfforts(settings.efforts?.[state.selectedModel]);state.permissionMode=settings.permissionMode||localStorage.getItem('codex-webui-permission-mode')||'default';syncModelLabel();syncPermissionControl()}
function renderModels(){
  const activeSelection=state.active?.id&&state.selectedModel,previousEffort=$('#effortSelect').value;
  if(activeSelection&&!state.models.some(model=>model.model===activeSelection)){
    toast(t('The model for this chat is no longer configured. Restore its provider or start a new chat.'));syncModelLabel();renderModelMenuMain();return;
  }
  const saved=localStorage.getItem('codex-webui-model'),selection=selectModelState(state.models,activeSelection||saved);state.selectedModel=selection.model;
  updateEfforts(activeSelection?previousEffort:selection.effort);syncModelLabel();renderModelMenuMain();
}
function defaultModelId(){return localStorage.getItem('codex-webui-model')||''}
function setDefaultModel(model){if(!model||!state.models.some(entry=>entry.model===model))return;localStorage.setItem('codex-webui-model',model);chooseModel(model);toast(t('Default model for new chats: {model}',{model:modelDisplay(selectedModel())}))}
function chooseModel(model,keepOpen=false){const previous=$('#effortSelect').value;state.selectedModel=model;if(state.active?.id){const settings=threadSettings(state.active.id);updateEfforts(settings.efforts?.[model]);saveActiveThreadSettings()}else{localStorage.setItem('codex-webui-model',model);updateEfforts(previous)}syncModelLabel();if(keepOpen)renderModelMenuMain();else closeModelMenu();toast(`Model: ${modelDisplay(selectedModel())}`)}
function syncModelLabel(){const model=selectedModel();$('#modelLabel').textContent=modelDisplay(model,true);$('#effortLabel').textContent=reasoningLabel($('#effortSelect').value)}
function updateEfforts(preferred){
  const model=selectedModel(),effort=$('#effortSelect');effort.innerHTML='';
  const supported=model?.supportedReasoningEfforts||[{reasoningEffort:'medium'}],values=supported.map(item=>item.reasoningEffort).filter(Boolean),saved=localStorage.getItem(`codex-webui-effort:${state.selectedModel}`),selected=[...(state.active?.id?[preferred,saved]:[saved,preferred]),model?.defaultReasoningEffort,values[0],'medium'].find(value=>values.includes(value))||'medium';
  for(const value of values.length?values:['medium']){const option=document.createElement('option');option.value=value;option.textContent=value;option.selected=value===selected;effort.append(option)}
  $('#effortLabel').textContent=reasoningLabel(effort.value);
}
const RUNNING_PHASES=new Set(['preparing','sending','waiting','thinking','running','working','editing','responding','approval','stopping']);
const RUN_LABELS={idle:'Ready',preparing:'Preparing session…',sending:'Sending to Codex…',waiting:'Waiting for Codex…',thinking:'Thinking',running:'Running command',working:'Working',editing:'Editing files',responding:'Responding',approval:'Waiting for approval',stopping:'Stopping…',completed:'Completed',stopped:'Stopped',failed:'Failed'};
function setRunPhase(threadId,phase,details={}){
  if(!threadId)return;
  const previous=threadRuns.get(threadId),newTurn=(details.turnId&&previous?.turnId&&details.turnId!==previous.turnId)||(previous&&!RUNNING_PHASES.has(previous.phase)&&RUNNING_PHASES.has(phase));
  const run=newTurn?{}:{...previous};
  if(RUNNING_PHASES.has(phase)){delete run.endedAt;if(!details.error)delete run.error;unreadCompletedThreads.delete(threadId)}
  if(!run.startedAt&&RUNNING_PHASES.has(phase))run.startedAt=Date.now();
  Object.assign(run,details,{phase});
  if(details.event)run.lastEventAt=Date.now();
  if(!RUNNING_PHASES.has(phase)&&run.startedAt)run.endedAt=Date.now();
  if(phase==='completed'&&(details.unread||(details.event&&threadId!==state.active?.id)))unreadCompletedThreads.add(threadId);
  threadRuns.set(threadId,run);
  if(threadId===state.active?.id)renderRuntimeBar();
  if(previous?.phase!==phase)renderThreads();
}
function runtimeStatusIconMarkup(phase,busy,connected){
  if(!connected||busy)return codexIcon('loaderCircle');
  if(phase==='approval')return codexIcon('shield');
  if(phase==='failed')return codexIcon('triangleAlert');
  if(phase==='completed')return codexIcon('check');
  return '<span class="runtime-status-dot"></span>';
}
function itemRunPhase(item){if(item?.type==='reasoning')return'thinking';if(item?.type==='agentMessage')return'responding';if(item?.type==='fileChange')return'editing';if(item?.type==='commandExecution')return'running';return item?.type==='userMessage'?'waiting':'working'}
function renderRuntimeBar(){
  const footer=$('#runtimeFooter');if(!footer)return;
  const pending=pendingSubmission&&pendingSubmission.epoch===conversationEpoch&&(state.active?.id||null)===pendingSubmission.selectionId?pendingSubmission:null;
  const observed=threadRuns.get(state.active?.id)||(localRun?.epoch===conversationEpoch?localRun:null);
  const run=pending&&(!observed?.lastEventAt||['preparing','sending'].includes(observed.phase))?pending:observed;
  const busy=!!run&&RUNNING_PHASES.has(run.phase),phase=run?.phase||'idle';
  footer.dataset.phase=phase;footer.dataset.busy=String(busy);
  const statusText=t(!state.connected?'Connecting to Codex':RUN_LABELS[phase]||'Ready');
  $('#runtimeStatus').textContent=statusText;
  const pill=$('#runtimeStatusPill'),icon=$('#runtimeStatusIcon');
  if(pill)pill.title=statusText;
  if(icon)icon.innerHTML=runtimeStatusIconMarkup(phase,busy,state.connected);
  const elapsed=$('#runtimeElapsed'),duration=!busy&&Number.isFinite(run?.durationMs)?run.durationMs:run?.startedAt?(run.endedAt||Date.now())-run.startedAt:null;
  elapsed.hidden=duration===null;if(duration!==null)elapsed.textContent=formatElapsed(duration);
  const hint=$('#runtimeHint'),quiet=busy&&phase!=='approval'&&Date.now()-(run.lastEventAt||run.startedAt)>15000;
  hint.hidden=!quiet&&!run?.error;
  hint.textContent=run?.error||t('Still waiting for a Codex event…');
  const usage=normalizeTokenUsage(state.tokenUsage.get(state.active?.id)),context=contextUsageValue(usage);
  const summaryParts=[];
  const inOut=[usage.total.inputTokens!==null?`↑${formatCompactTokenCount(usage.total.inputTokens)}`:null,usage.total.outputTokens!==null?`↓${formatCompactTokenCount(usage.total.outputTokens)}`:null].filter(Boolean).join(' ');
  if(inOut)summaryParts.push(inOut);
  else if(usage.total.totalTokens!==null)summaryParts.push(formatCompactTokenCount(usage.total.totalTokens));
  if(context)summaryParts.push(`${Math.round(context.percent)}%`);
  const quotaParts=[quotaWindowSummaryLabel(state.rateLimits?.primary),quotaWindowSummaryLabel(state.rateLimits?.secondary)].filter(Boolean);
  if(quotaParts.length)summaryParts.push(quotaParts.join(' · '));
  $('#runtimeTokenSummary').textContent=summaryParts.length?summaryParts.join(' · '):'—';
  const section=(title,data)=>`<section><strong>${escapeHtml(t(title))}</strong><dl>${[['Input tokens',data.inputTokens],['Cached input tokens',data.cachedInputTokens],['Output tokens',data.outputTokens],['Reasoning output tokens',data.reasoningOutputTokens],['Total tokens',data.totalTokens]].map(([label,value])=>`<dt>${escapeHtml(t(label))}</dt><dd>${formatTokenCount(value)}</dd>`).join('')}</dl></section>`;
  $('#runtimeUsageDetails').innerHTML=renderRateLimitsSection()+section('Session usage',usage.total)+section('Last reported usage',usage.last)+`<small>${escapeHtml(t('Cache is included in input; reasoning is included in output.'))}</small><small>${escapeHtml(t('Usage updates when Codex reports it; no estimate is shown.'))}</small>`;
  if(busy&&!runtimeTick)runtimeTick=setInterval(renderRuntimeBar,1000);
  else if(!busy&&runtimeTick){clearInterval(runtimeTick);runtimeTick=null}
}
function renderContextUsage(){renderRuntimeBar()}
function menuTitle(text,back=false){return `<div class="model-menu-title-row">${back?`<button type="button" class="model-menu-back" id="modelMenuBack" aria-label="Back">${codexIcon('chevronLeft')}</button>`:''}<div class="model-menu-title">${escapeHtml(text)}</div></div>`}
function renderModelMenuMain(){const menu=$('#modelMenu'),model=selectedModel(),effort=$('#effortSelect');menu.innerHTML=`<div class="model-menu-view model-menu-view-main">${menuTitle('Reasoning')}<div class="model-menu-list" data-model-menu-efforts></div><div class="model-menu-separator"></div><button type="button" class="model-submenu-button" id="modelSubmenuButton"><span>Model</span><span class="model-submenu-value">${escapeHtml(modelDisplay(model))}</span>${codexIcon('chevronRight')}</button></div>`;const list=menu.querySelector('[data-model-menu-efforts]');for(const option of effort.options){const button=document.createElement('button');button.type='button';button.className='model-effort-row';button.dataset.value=option.value;button.setAttribute('aria-checked',String(option.selected));button.innerHTML=`<span>${escapeHtml(reasoningLabel(option.value))}</span><span class="model-check">${option.selected?codexIcon('check'):''}</span>`;button.onclick=()=>chooseEffort(option.value);list.append(button)}menu.querySelector('#modelSubmenuButton').onclick=renderModelSubmenu}
function renderModelSubmenu(){const menu=$('#modelMenu');menu.innerHTML=`<div class="model-menu-view model-menu-view-models">${menuTitle('Model',true)}<div class="model-menu-list model-list"></div></div>`;menu.querySelector('#modelMenuBack').onclick=renderModelMenuMain;const list=menu.querySelector('.model-list'),defaultState=defaultModelState(state.models,defaultModelId());const groups=groupModelsByProvider(state.models);for(const[groupIndex,group]of groups.entries()){const groupBox=document.createElement('div');groupBox.className='model-group';if(groups.length>1){const header=document.createElement('div');header.className='model-group-header';header.textContent=group.key;groupBox.append(header)}for(const model of group.models){const button=document.createElement('button');button.type='button';button.className='model-option';button.role='menuitemradio';button.dataset.model=model.model;button.setAttribute('aria-checked',String(model.model===state.selectedModel));button.innerHTML=`<span class="model-option-copy"><strong>${escapeHtml(modelDisplay(model))}</strong>${model.description?`<small>${escapeHtml(model.description)}</small>`:''}</span><span class="model-check">${model.model===state.selectedModel?codexIcon('check'):''}</span>`;button.onclick=()=>chooseModel(model.model);const isDefault=defaultState.available&&model.model===defaultState.stored;const star=document.createElement('button');star.type='button';star.className='model-default-star';star.dataset.defaultModel=model.model;star.setAttribute('aria-pressed',String(isDefault));star.title=isDefault?t('Default model for new chats'):t('Use and save as default for new chats');star.setAttribute('aria-label',star.title);star.innerHTML=codexIcon(isDefault?'starFilled':'star');star.onclick=event=>{event.preventDefault();event.stopPropagation();setDefaultModel(model.model)};const row=document.createElement('div');row.className='model-option-row';row.append(button,star);groupBox.append(row)}list.append(groupBox)}}
function chooseEffort(value){const effort=$('#effortSelect');if(![...effort.options].some(option=>option.value===value))return;effort.value=value;$('#effortLabel').textContent=reasoningLabel(value);if(state.active?.id)saveActiveThreadSettings();else localStorage.setItem(`codex-webui-effort:${state.selectedModel}`,value);closeModelMenu();toast(`Reasoning: ${reasoningLabel(value)}`)}
function openModelMenu(view='main'){if(view==='models')renderModelSubmenu();else renderModelMenuMain();$('#modelMenu').hidden=false;$('#modelButton').setAttribute('aria-expanded','true')}
function toggleModelMenu(){const menu=$('#modelMenu');if(menu.hidden)openModelMenu();else closeModelMenu()}
function closeModelMenu(){const menu=$('#modelMenu');menu.hidden=true;$('#modelButton').setAttribute('aria-expanded','false')}
const permissionModes={
  default:{kind:'legacy',label:'Ask for approval',description:'Always ask for permission before editing external files or using the internet',icon:'shield',approvalPolicy:'on-request',approvalsReviewer:'user',sandbox:'workspace-write'},
  'guardian-approvals':{kind:'legacy',label:'Approve for me',description:'Only ask for actions detected as potentially unsafe',icon:'shield',approvalPolicy:'on-request',approvalsReviewer:'auto_review',sandbox:'workspace-write'},
  'full-access':{kind:'legacy',label:'Full access',description:'Unrestricted access to the internet and any file on your computer',icon:'terminal',approvalPolicy:'never',approvalsReviewer:'user',sandbox:'danger-full-access'},
};
const PERMISSION_PROFILE_PREFIX='profile:';
const RESERVED_PERMISSION_PROFILE_IDS=new Set(['default','guardian-approvals','full-access','custom']);
function permissionProfileCwd(){if(state.projectless)return null;const path=state.active?.cwd||state.cwd||state.config.defaultCwd||null;return typeof path==='string'&&path.startsWith('~')?state.config.home+path.slice(1):path}
function permissionProfileId(mode=state.permissionMode){return String(mode||'').startsWith(PERMISSION_PROFILE_PREFIX)?String(mode).slice(PERMISSION_PROFILE_PREFIX.length):null}
function autoReviewSupported(){return state.account?.type==='chatgpt'}
function permissionModeDefinition(mode=state.permissionMode){if(permissionModes[mode])return{mode,...permissionModes[mode]};const profileId=permissionProfileId(mode),profile=profileId&&state.permissionProfiles.find(item=>item.id===profileId);return profile?{kind:'profile',mode,profileId,label:profile.id,description:profile.description||'Custom permission profile',icon:'file',allowed:profile.allowed!==false}:null}
function permissionModeAvailable(mode=state.permissionMode){const selected=permissionModeDefinition(mode);if(!selected||selected.allowed===false)return false;if(mode==='guardian-approvals')return autoReviewSupported();if(mode==='full-access')return state.permissionVisibility.fullAccess;return true}
function normalizePermissionMode(){if(permissionModeAvailable())return;state.permissionMode='default';localStorage.setItem('codex-webui-permission-mode','default')}
function selectedPermission(){normalizePermissionMode();return permissionModeDefinition()||{mode:'default',...permissionModes.default}}
function setPermissionProfiles(profiles=[]){const seen=new Set;state.permissionProfiles=(Array.isArray(profiles)?profiles:[]).flatMap(profile=>{if(!profile||typeof profile.id!=='string')return[];const id=profile.id.trim(),key=id.toLocaleLowerCase();if(!id||id.startsWith(':')||RESERVED_PERMISSION_PROFILE_IDS.has(key)||seen.has(key))return[];seen.add(key);return[{id,description:typeof profile.description==='string'?profile.description:'',allowed:profile.allowed!==false}]});normalizePermissionMode();syncPermissionControl()}
async function loadPermissionProfiles(){if(!state.connected)return;const requestId=permissionProfileRequestGate.next();try{const result=await rpc('permissionProfile/list',{cwd:permissionProfileCwd(),limit:100});if(permissionProfileRequestGate.isCurrent(requestId))setPermissionProfiles(result.data||[])}catch{if(permissionProfileRequestGate.isCurrent(requestId))setPermissionProfiles([])}}
function permissionThreadPolicy(){const selected=selectedPermission();if(selected.kind==='profile')return{permissions:selected.profileId};return{approvalPolicy:selected.approvalPolicy,approvalsReviewer:selected.approvalsReviewer,sandbox:selected.sandbox}}
function permissionTurnPolicy(cwd){const selected=selectedPermission();if(selected.kind==='profile')return{permissions:selected.profileId,approvalPolicy:null,approvalsReviewer:null};const sandboxPolicy=selected.sandbox==='danger-full-access'?{type:'dangerFullAccess'}:{type:'workspaceWrite',writableRoots:cwd?[cwd]:[],networkAccess:false,excludeTmpdirEnvVar:false,excludeSlashTmp:false};return{permissions:null,approvalPolicy:selected.approvalPolicy,approvalsReviewer:selected.approvalsReviewer,sandboxPolicy}}
function renderPermissionMenu(){const list=$('#permissionOptions');if(!list)return;list.innerHTML='';const modes=['default'];if(autoReviewSupported())modes.push('guardian-approvals');if(state.permissionVisibility.fullAccess)modes.push('full-access');for(const profile of state.permissionProfiles)modes.push(`${PERMISSION_PROFILE_PREFIX}${profile.id}`);for(const mode of modes){const option=permissionModeDefinition(mode);if(!option)continue;const checked=mode===state.permissionMode,button=document.createElement('button');button.type='button';button.className='permission-option';button.dataset.permissionMode=mode;button.role='menuitemradio';button.disabled=option.allowed===false;button.setAttribute('aria-checked',String(checked));const description=option.allowed===false?'Not allowed by managed settings':option.description;button.innerHTML=`<span class="permission-option-icon">${codexIcon(option.icon)}</span><span class="permission-option-copy"><strong>${escapeHtml(option.optionLabel||option.label)}</strong><small>${escapeHtml(description)}</small></span><span class="permission-option-check">${checked?codexIcon('check'):''}</span>`;button.onclick=()=>choosePermissionMode(mode);list.append(button)}}
function syncPermissionSettings(){const autoRow=$('#settingsAutoReviewRow'),autoToggle=$('#settingsAutoReviewToggle'),fullToggle=$('#settingsFullAccessToggle');if(autoRow)autoRow.hidden=true;if(autoToggle)autoToggle.checked=autoReviewSupported();if(fullToggle)fullToggle.checked=state.permissionVisibility.fullAccess;syncTaskNotifySettings()}
const TASK_NOTIFY_STORAGE_KEY='codex-webui-task-notify';
function taskNotifyEnabled(){return localStorage.getItem(TASK_NOTIFY_STORAGE_KEY)!=='false'}
// iPad Safari / non-localhost HTTP may omit Notification entirely. Notifications are
// optional: their absence must not abort startup before controls and the bridge bind.
function taskNotificationsSupported(){return window.isSecureContext!==false&&typeof window.Notification==='function'}
function syncTaskNotifySettings(){
  const toggle=$('#settingsTaskNotifyToggle'),row=$('#settingsTaskNotifyRow'),desc=$('#settingsTaskNotifyDescription');if(!toggle)return;
  const supported=taskNotificationsSupported();
  toggle.disabled=false;
  toggle.dataset.unsupported=String(!supported);
  row?.classList.toggle('is-disabled',!supported);
  toggle.checked=supported&&taskNotifyEnabled()&&window.Notification.permission!=='denied';
  const unsupportedMsg=t('Browser notifications are unavailable in this browser or connection (requires HTTPS or localhost)');
  toggle.title=supported?'':unsupportedMsg;
  if(row)row.title=supported?'':unsupportedMsg;
  if(desc)desc.textContent=supported?t('Show a browser notification when a task completes'):unsupportedMsg;
}
async function setTaskNotifyEnabled(enabled){
  if(!taskNotificationsSupported()){syncTaskNotifySettings();toast(t('Browser notifications are unavailable in this browser or connection (requires HTTPS or localhost)'),3600);return}
  const on=Boolean(enabled);localStorage.setItem(TASK_NOTIFY_STORAGE_KEY,String(on));
  if(on&&window.Notification.permission==='default'){try{await window.Notification.requestPermission()}catch{}}
  syncTaskNotifySettings();
  if(on&&window.Notification.permission==='denied')toast(t('Browser notifications are blocked'));
  else toast(t(on?'Task notifications enabled':'Task notifications disabled'));
}
function maybeNotifyTaskCompleted(p){if(!taskNotificationsSupported()||!taskNotifyEnabled()||window.Notification.permission!=='granted')return;if(document.hasFocus()&&!document.hidden)return;const thread=state.threads.find(x=>x.id===p.threadId),title=thread?.name||t('Task completed');try{new window.Notification(t('Task completed'),{body:title,tag:`codex-turn-${p.turn?.id||Date.now()}`})}catch{}}
async function requestTaskNotifyPermission(){
  if(!taskNotificationsSupported()||!taskNotifyEnabled()||window.Notification.permission!=='default')return;
  try{await window.Notification.requestPermission()}catch{ /* Safari can reject even when the API exists. */ }
}
function syncPermissionControl(){normalizePermissionMode();const selected=selectedPermission();$('#modeButton .control-label').textContent=t(state.planMode?'Plan mode':selected.label);$('#modeButton').classList.toggle('active',state.planMode||state.permissionMode!=='default');if($('#settingsPermissionValue'))$('#settingsPermissionValue').textContent=t(selected.label);syncPermissionSettings();renderPermissionMenu()}
function setPermissionMode(mode){if(!permissionModeAvailable(mode))return;const selected=permissionModeDefinition(mode);state.permissionMode=mode;if(state.active?.id)saveActiveThreadSettings();else localStorage.setItem('codex-webui-permission-mode',mode);syncPermissionControl();closePermissionMenu();toast(selected.label)}
function setPermissionVisibility(kind,enabled){state.permissionVisibility[kind]=Boolean(enabled);localStorage.setItem(kind==='autoReview'?'codex-webui-permission-auto-review':'codex-webui-permission-full-access',String(Boolean(enabled)));normalizePermissionMode();syncPermissionControl()}
function openPermissionMenu(){closeModelMenu();syncPermissionControl();$('#permissionMenu').hidden=false;$('#modeButton').setAttribute('aria-expanded','true')}
function closePermissionMenu(){const menu=$('#permissionMenu');menu.hidden=true;$('#modeButton').setAttribute('aria-expanded','false')}
function togglePermissionMenu(){if($('#permissionMenu').hidden)openPermissionMenu();else closePermissionMenu()}
function choosePermissionMode(mode){closePermissionMenu();if(mode==='full-access'&&state.permissionMode!=='full-access'){pendingFullAccessAction='select';const dialog=$('#fullAccessDialog');if(!dialog.open)dialog.showModal();return}setPermissionMode(mode)}
async function loadFolders(path=folderBrowse.path){const list=$('#folderList');list.innerHTML='<div class="list-state">Loading folders…</div>';try{const response=await fetch(`/api/folders?path=${encodeURIComponent(path)}`),data=await response.json();if(!response.ok)throw new Error(data.error||'Cannot browse folder');folderBrowse={path:data.path,parent:data.parent,selected:data.path};$('#folderPathInput').value=data.path;$('#folderSelection').textContent=data.path;$('#folderConfirm').disabled=false;$('#folderUp').disabled=!data.parent;list.innerHTML='';for(const folder of data.folders){const b=document.createElement('button');b.type='button';b.className='folder-item';b.innerHTML=`${icons.file}<span>${escapeHtml(folder.name)}</span>`;b.ondblclick=()=>loadFolders(folder.path);b.onclick=()=>{folderBrowse.selected=folder.path;$('#folderSelection').textContent=folder.path;$('#folderConfirm').disabled=false;list.querySelectorAll('.folder-item').forEach(x=>x.classList.remove('selected'));b.classList.add('selected')};list.append(b)}if(!data.folders.length)list.innerHTML='<div class="list-state">No subfolders</div>'}catch(e){list.innerHTML=`<div class="list-state">${escapeHtml(e.message)}</div>`}}
function openFolderPicker(){const dialog=$('#folderDialog');folderBrowse.selected=null;dialog.showModal();loadFolders(state.cwd||state.config.defaultCwd||'~/projects');$('#projectlessOption').classList.toggle('selected',state.projectless)}
async function syncWorkspaceContext(path){const requestId=workspaceContextRequestGate.next();try{const response=await fetch(`/api/workspace/context?cwd=${encodeURIComponent(path)}`,{cache:'no-store'}),context=await response.json();if(!response.ok)throw new Error(context.error||'Workspace context unavailable');if(!workspaceContextRequestGate.isCurrent(requestId)||state.projectless)return;state.workspaceContext=context;if(!state.active)showEmpty()}catch{if(workspaceContextRequestGate.isCurrent(requestId)&&!state.projectless){state.workspaceContext={cwd:path,project:path.split('/').filter(Boolean).at(-1)||path,environment:'Local',branch:'No branch'};if(!state.active)showEmpty()}}}
function refreshComposerPlaceholder(){const followUpType=state.active?(state.active.source==='cloud'?'cloud':'local'):undefined;$('#prompt').placeholder=resolveComposerPlaceholder({followUpType,composerMode:state.composerMode,cloudStartingState:state.cloudStartingState,isBackgroundSubagentsPanelVisible:state.backgroundAgentsVisible,isGoalModeActive:state.goalMode,isPlanModeActive:state.planMode,placeholderText:state.placeholderText,isHome:!state.active})}
function syncCwdUrl(){if(location.pathname!=='/')return;try{const url=new URL(location.href);if(state.cwd)url.searchParams.set('cwd',state.cwd);else url.searchParams.delete('cwd');history.replaceState(history.state,'',url.pathname+url.search+url.hash)}catch{}}
function syncNewTaskLabel(){const button=$('#newTask');if(!button)return;const path=state.projectless?'':shortPath(state.cwd||'');button.title=path?t('New session in {path}',{path}):t('Choose project')}
async function requestedCwdFromUrl(){try{const raw=new URLSearchParams(location.search).get('cwd');if(!raw||location.pathname!=='/')return'';const response=await fetch(`/api/cwd/validate?path=${encodeURIComponent(raw)}`,{cache:'no-store'}),data=await response.json().catch(()=>({}));return response.ok&&data?.ok?String(data.path||''):''}catch{return''}}
function setWorkspace(path){const name=path.split('/').filter(Boolean).at(-1)||path,resolved=path.replace(/^~/,state.config.home);workspaceContextRequestGate.next();state.projectless=false;state.cwd=resolved;state.workspaceContext={cwd:resolved,project:name,environment:'Local',branch:null};$('#projectPath').textContent=shortPath(path);$('#projectName').textContent=name;localStorage.setItem('codex-webui-project',path);syncCwdUrl();syncNewTaskLabel();if(!state.active)showEmpty();if(!$('#summaryPanel').hidden)syncSummaryPanel();if(fileBrowserState.cwd&&fileBrowserState.cwd!==resolved)closeFilePreview();if(fileBrowserState.sidebarTab==='files')void loadWorkspaceFiles('');syncWorkspaceContext(resolved);if(state.connected)loadPermissionProfiles()}
function setProjectless(){workspaceContextRequestGate.next();state.projectless=true;state.cwd=state.config.home||'~';state.workspaceContext=null;$('#projectPath').textContent='~';$('#projectName').textContent=t('Tasks');localStorage.setItem('codex-webui-project','~');syncCwdUrl();syncNewTaskLabel();if(!state.active){$('#threadPath').textContent='';showEmpty()}if(!$('#summaryPanel').hidden)syncSummaryPanel();closeFilePreview();if(fileBrowserState.sidebarTab==='files')renderWorkspaceFiles();if(state.connected)loadPermissionProfiles()}
function setSidebarView(tab='sessions'){
  const resolved=tab==='files'?'files':tab==='skills'?'skills':'sessions';
  fileBrowserState.sidebarTab=resolved;
  $('#sidebarSessionsSection').hidden=resolved!=='sessions';
  $('#sidebarFilesSection').hidden=resolved!=='files';
  $('#sidebarSkillsSection').hidden=resolved!=='skills';
  for(const button of document.querySelectorAll('[data-sidebar-tab]')){
    const selected=button.dataset.sidebarTab===resolved;
    button.classList.toggle('active',selected);
    button.setAttribute('aria-selected',String(selected));
  }
  if(resolved==='files')void loadWorkspaceFiles(fileBrowserState.cwd===currentComposerCwd()?fileBrowserState.dir:'');
  if(resolved==='skills')void loadSkillsCatalog();
}
function currentDraftCwd(){return state.projectless?'~':(state.active?.cwd||state.cwd||state.config.defaultCwd||'~')}
const inlineDraftImages=new Map(),userPayloads=new WeakMap(),userItems=new WeakMap(),turnPayloads=new Map(),turnStatusById=new Map();
function composerDraftKey(){return draftStorageKey(state.active?.id||null,currentDraftCwd())}
function saveActiveDraft(){inlineDraftImages.set(composerDraftKey(),state.composerAttachments.filter(item=>typeof item?.data==='string'));writeThreadDraft(state.active?.id||null,currentDraftCwd(),{text:$('#prompt')?.value||'',mentions:state.composerMentions,attachments:state.composerAttachments})}
function restoreActiveDraft(){const draft=readThreadDraft(state.active?.id||null,currentDraftCwd()),saved=new Map((inlineDraftImages.get(composerDraftKey())||[]).map(item=>[item.id,item]));$('#prompt').value=draft.text||'';state.composerMentions=Array.isArray(draft.mentions)?draft.mentions:[];state.composerAttachments=(Array.isArray(draft.attachments)?draft.attachments:[]).flatMap(item=>item?.inlineOmitted?(saved.get(item.id)?[saved.get(item.id)]:[]):[item]);renderContextTray();resizePrompt()}
function syncThreadActionsMenu(){const wrap=$('#threadActionsWrap');if(wrap)wrap.hidden=!state.active}
function closeThreadActionsMenu(){const menu=$('#threadActionsMenu'),button=$('#threadActionsButton');if(menu)menu.hidden=true;if(button)button.setAttribute('aria-expanded','false')}
function toggleThreadActionsMenu(force){const menu=$('#threadActionsMenu'),button=$('#threadActionsButton');if(!menu||!button||!state.active)return;const open=force??menu.hidden;menu.hidden=!open;button.setAttribute('aria-expanded',String(open))}
async function renameActiveThread(nextName){
  const targetId=state.active?.id;if(!targetId)return false;
  const current=titleOf(state.active),raw=typeof nextName==='string'?nextName:prompt(t('Rename conversation'),current);
  if(raw===null)return false;
  const name=String(raw).trim();if(!name)return false;
  try{
    await rpc('thread/name/set',{threadId:targetId,name});
    if(state.active?.id===targetId)state.active.name=name;
    const item=state.threads.find(thread=>thread.id===targetId);if(item)item.name=name;
    if(state.active?.id===targetId)renderHeader();
    renderThreads();toast(t('Conversation renamed'));return true;
  }catch(error){toast(t(error.message||'Could not rename conversation'));return false}
}
function downloadExportBlob(filename,content,type){
  const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function exportActiveThread(format='md'){
  if(!state.active)return null;
  const title=titleOf(state.active),usage=state.tokenUsage.get(state.active.id)||null;
  if(format==='json'){
    const filename=exportFilename(title,'json'),content=JSON.stringify({thread:state.active,tokenUsage:usage},null,2)+'\n';
    downloadExportBlob(filename,content,'application/json;charset=utf-8');toast(t('Exported JSON'));return{filename,content};
  }
  const filename=exportFilename(title,'md'),content=formatThreadExportMarkdown(state.active,{title,tokenUsage:usage});
  downloadExportBlob(filename,content,'text/markdown;charset=utf-8');toast(t('Exported Markdown'));return{filename,content};
}
async function compactActiveThread(){
  if(!state.active?.id){toast(t('No active task'));return false}
  try{await rpc('thread/compact/start',{threadId:state.active.id});toast(t('Context compaction started'));return true}
  catch(error){toast(t(error.message||'Could not compact context'));return false}
}
function formatFileSize(size){if(!Number.isFinite(size)||size<0)return'';if(size<1024)return`${size} B`;if(size<1048576)return`${(size/1024).toFixed(1)} KB`;return`${(size/1048576).toFixed(1)} MB`}
function mentionWorkspaceFile(path,kind='file'){
  if(!path)return;
  const normalized=String(path).replace(/^\/+|\/+$/g,'');if(!normalized)return;
  const parts=normalized.split('/').filter(Boolean),title=parts.at(-1)||normalized,id=`${kind}:${normalized}`;
  if(!state.composerMentions.some(item=>item.id===id))state.composerMentions.push({id,source:kind,type:kind,path:normalized,title,icon:kind==='folder'?'folderOpen':'file'});
  const input=$('#prompt'),formatted=formatFileMention(normalized,{isDirectory:kind==='folder'});
  const token=formatted.text.trim();
  if(!input.value.includes(token)){
    const prefix=input.value&&!/\s$/.test(input.value)?`${input.value} `:input.value;
    const next=`${prefix}${formatted.text}`;
    input.value=next;
    const cursor=prefix.length+formatted.cursorOffset;
    input.setSelectionRange(cursor,cursor);
  }
  renderContextTray();resizePrompt();saveActiveDraft();input.focus();
  if(kind==='folder')updateComposerAutocomplete();
}
function closeFilePreview(){
  fileBrowserState.previewRequestId++;fileBrowserState.preview=null;
  $('#filesPreviewName').textContent=t('No file selected');
  const tab=$('#utilityTab');
  if(tab?.dataset.sidePanelTab==='files')tab.textContent=t('File preview');
  $('#filesMentionButton').hidden=true;$('#filesDownloadLink').hidden=true;$('#filesClosePreviewButton').hidden=true;
  $('#filesPreviewBody').innerHTML=`<div class="panel-empty">${escapeHtml(t('Select a file from the left sidebar to preview it here.'))}</div>`;
  renderWorkspaceFiles();
}
function renderWorkspaceFiles(){
  const list=$('#filesTreeList'),cwd=currentComposerCwd();if(!list)return;
  $('#filesCurrentPath').textContent=cwd?(fileBrowserState.dir||'.'):t('No project');
  $('#filesUpButton').disabled=!cwd||fileBrowserState.parent===null;
  $('#filesRefreshButton').disabled=!cwd;$('#filesUploadButton').disabled=!cwd;
  list.innerHTML='';
  if(!cwd){list.innerHTML=`<div class="panel-empty">${escapeHtml(t('Select a project folder to browse files.'))}</div>`;return}
  if(!fileBrowserState.entries.length){list.innerHTML=`<div class="panel-empty">${escapeHtml(t('This folder is empty.'))}</div>`;return}
  for(const entry of fileBrowserState.entries){
    const row=document.createElement('div');
    row.className='files-entry'+(fileBrowserState.preview?.relativePath===entry.path?' active':'');
    row.dataset.fileEntryPath=entry.path;row.dataset.fileEntryKind=entry.kind;
    row.setAttribute('role','button');row.tabIndex=0;
    const activate=()=>{if(entry.kind==='folder'){void loadWorkspaceFiles(entry.path);return}void previewWorkspaceFile(entry.path)};
    row.innerHTML=`${codexIcon(entry.kind==='folder'?'folderOpen':'file')}<span class="files-entry-name">${escapeHtml(entry.name)}</span><span class="files-entry-meta">${entry.kind==='file'?escapeHtml(formatFileSize(entry.size)):''}</span><button type="button" class="files-entry-mention" title="${escapeHtml(t('Mention in prompt'))}" aria-label="${escapeHtml(t('Mention in prompt'))} ${escapeHtml(entry.name)}">@</button>`;
    const mentionBtn=row.querySelector('.files-entry-mention');
    mentionBtn.onclick=event=>{event.stopPropagation();mentionWorkspaceFile(entry.path,entry.kind)};
    mentionBtn.onkeydown=event=>event.stopPropagation();
    row.onclick=event=>{if(event.target.closest('.files-entry-mention'))return;activate()};
    row.onkeydown=event=>{if(event.target.closest('.files-entry-mention'))return;if(event.key==='Enter'||event.key===' '){event.preventDefault();activate()}};
    list.append(row);
  }
}
async function loadWorkspaceFiles(relativeDir=fileBrowserState.dir||''){
  const cwd=currentComposerCwd(),requestId=++fileBrowserState.requestId;
  fileBrowserState.cwd=cwd;fileBrowserState.dir=relativeDir||'';
  if(!cwd){fileBrowserState.parent=null;fileBrowserState.entries=[];renderWorkspaceFiles();return}
  try{
    const response=await fetch(`/api/files/tree?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(fileBrowserState.dir)}&hidden=1`,{cache:'no-store'}),data=await response.json();
    if(!response.ok)throw new Error(data.error||'Could not list files');
    if(requestId!==fileBrowserState.requestId)return;
    fileBrowserState.dir=data.path||'';fileBrowserState.parent=data.parent??null;fileBrowserState.entries=data.entries||[];
    renderWorkspaceFiles();
  }catch(error){if(requestId===fileBrowserState.requestId)$('#filesTreeList').innerHTML=`<div class="panel-empty">${escapeHtml(error.message)}</div>`}
}
async function previewWorkspaceFile(targetPath){
  const cwd=currentComposerCwd()||state.config.defaultCwd||'.',previewId=++fileBrowserState.previewRequestId,previewEpoch=conversationEpoch,previewThreadId=state.active?.id||null;
  try{
    const response=await fetch(`/api/files/preview?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(targetPath)}`,{cache:'no-store'}),preview=await response.json();
    if(!response.ok)throw new Error(preview.error||'File unavailable');
    if(previewId!==fileBrowserState.previewRequestId||previewEpoch!==conversationEpoch||(state.active?.id||null)!==previewThreadId||(currentComposerCwd()||state.config.defaultCwd||'.')!==cwd)return;
    fileBrowserState.preview=preview;
    const tab=$('#utilityTab'),body=$('#filesPreviewBody'),download=$('#filesDownloadLink'),mentionPath=preview.relativePath||preview.path;
    tab.textContent=preview.filename||t('File preview');tab.dataset.sidePanelTab='files';tab.hidden=false;
    setSidePanelOpen(true,false);setSidePanelView('files',preview.filename||t('File preview'));
    $('#filesPreviewName').textContent=preview.relativePath||preview.filename||'File';
    download.href=`/api/files/download?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(preview.path)}`;
    download.download=preview.filename||'download';
    download.hidden=false;$('#filesMentionButton').hidden=false;$('#filesClosePreviewButton').hidden=false;
    $('#filesMentionButton').onclick=()=>mentionWorkspaceFile(mentionPath,'file');
    if(preview.kind==='image'){
      const src=`/api/images/local?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(preview.path)}`;
      body.innerHTML=`<button type="button" class="message-image-button" data-image-src="${escapeHtml(src)}" data-image-title="${escapeHtml(preview.filename)}" data-image-path="${escapeHtml(preview.relativePath||preview.path)}"><img class="message-image" src="${escapeHtml(src)}" alt="${escapeHtml(preview.filename)}"></button>`;
    }else if(preview.kind==='markdown'){
      body.innerHTML=`<div class="message-text">${renderAssistantMarkdown(preview.content||'',{cwd})}</div>`;
    }else if(preview.kind==='binary'){
      body.innerHTML=`<div class="files-preview-note">${escapeHtml(t('Binary file preview is not shown. Use Download to inspect it locally.'))}</div>`;
    }else{
      const pre=document.createElement('pre');pre.textContent=preview.content||'';body.replaceChildren(pre);
    }
    if(preview.truncated){const note=document.createElement('div');note.className='files-preview-note';note.textContent=t('Showing the first 256 KB.');body.append(note)}
    renderWorkspaceFiles();
  }catch(error){toast(t(error.message||'File unavailable'))}
}
function openFilesPanel(initialPath=''){
  if(!mobileSidebarEnabled())setSidebarOpen(true);
  setSidebarView('files');
  const tab=$('#utilityTab');tab.textContent=fileBrowserState.preview?.filename||t('File preview');tab.dataset.sidePanelTab='files';tab.hidden=false;
  setSidePanelOpen(true,false);setSidePanelView('files',tab.textContent);
  if(initialPath)void previewWorkspaceFile(initialPath);
}
function skillDisplayTitle(skill){return skill?.interface?.displayName||skill?.displayName||skill?.name||'Skill'}
function skillShortDescription(skill){return skill?.interface?.shortDescription||skill?.shortDescription||skill?.description||''}
function attachSkillToComposer(skill){
  if(!skill?.name||!skill?.path||skill.enabled===false)return;
  const id=`skill:${skill.path}`;
  if(!state.composerMentions.some(item=>item.id===id)){
    state.composerMentions.push({
      id,
      source:'skill',
      type:'skill',
      name:skill.name,
      path:skill.path,
      title:`/${skill.name}`,
      icon:'sparkles',
    });
  }
  renderContextTray();resizePrompt();saveActiveDraft();
  if(overlayPanelsEnabled()&&!$('#sidePanel').hidden)setSidePanelOpen(false);
  $('#prompt')?.focus();requestAnimationFrame(()=>$('#prompt')?.focus());
  toast(`${t('Skills')}: /${skill.name}`);
}
function setSkillsFilter(filter='official'){
  skillsState.filter=filter==='personal'?'personal':'official';
  for(const btn of document.querySelectorAll('[data-skills-filter]')){
    const active=btn.dataset.skillsFilter===skillsState.filter;
    btn.classList.toggle('active',active);
    btn.setAttribute('aria-selected',String(active));
  }
  renderSkillsList();
}
function renderSkillsList(){
  const list=$('#skillsList');if(!list)return;
  const q=(skillsState.query||'').trim().toLowerCase();
  const matchSkill=item=>!q||[item.name,skillDisplayTitle(item),skillShortDescription(item),item.description,item.path].some(v=>String(v||'').toLowerCase().includes(q));
  const officialSystem=skillsState.skills.filter(s=>s.category==='official');
  const officialCurated=skillsState.curated.filter(c=>!c.installed);
  const personalAll=skillsState.skills.filter(s=>s.category==='personal');
  const officialCount=officialSystem.length+officialCurated.length,personalCount=personalAll.length;
  const offCountEl=$('#skillsOfficialCount'),perCountEl=$('#skillsPersonalCount');
  if(offCountEl)offCountEl.textContent=String(officialCount);
  if(perCountEl)perCountEl.textContent=String(personalCount);
  list.innerHTML='';
  const buildSkillCard=(skill,{curated=false}={})=>{
    const card=document.createElement('div');
    const selectedKey=skillsState.selected?.path||skillsState.selected?.id;
    const itemKey=skill.path||skill.id||skill.name;
    card.className='skills-card'+(selectedKey&&selectedKey===itemKey?' active':'')+(skill.enabled===false?' is-disabled':'');
    card.dataset.skillName=skill.name;
    if(skill.path)card.dataset.skillPath=skill.path;
    card.dataset.skillCategory=curated?'curated':(skill.category||'personal');
    card.tabIndex=0;
    const badgeLabel=curated?t('Curated'):skill.category==='official'?t('Official'):skill.sourceKind==='project'?t('Project'):skill.editable?t('Personal'):t('External');
    const badgeClass=curated?'is-curated':skill.category==='official'?'is-official':'is-personal';
    const desc=skillShortDescription(skill);
    const parentFolder=skill.path?skill.path.split('/').slice(-3,-1).join('/'):(skill.repoPath||'');
    card.innerHTML=`<div class="skills-card-head"><strong class="skills-card-title">${escapeHtml(skillDisplayTitle(skill))}</strong><span class="skill-scope-badge ${badgeClass}">${escapeHtml(badgeLabel)}</span></div>${desc?`<div class="skills-card-desc">${escapeHtml(desc)}</div>`:''}<div class="skills-card-foot"><span class="skills-card-id" title="${escapeHtml(skill.path||skill.repoPath||skill.name)}">${escapeHtml(skill.name)}${parentFolder&&skill.sourceKind==='external'?` · ${escapeHtml(parentFolder)}`:''}</span><div class="skills-card-actions"></div></div>`;
    const actions=card.querySelector('.skills-card-actions');
    if(curated){
      const installBtn=document.createElement('button');
      installBtn.type='button';installBtn.className='skills-mini-btn primary';
      installBtn.textContent=t('Install');
      installBtn.disabled=!skill.availableLocal||skillMutations.has(skill.id);
      installBtn.onclick=event=>{event.stopPropagation();void installCuratedSkill(skill)};
      actions.append(installBtn);
    }else{
      const toggle=document.createElement('button');
      toggle.type='button';toggle.className='skills-switch';toggle.role='switch';
      toggle.disabled=skillMutations.has(skill.path);
      toggle.setAttribute('aria-checked',String(skill.enabled!==false));
      toggle.title=skill.enabled!==false?t('Skill enabled'):t('Skill disabled');
      toggle.setAttribute('aria-label',`${skillDisplayTitle(skill)} ${skill.enabled!==false?'enabled':'disabled'}`);
      toggle.onclick=event=>{event.stopPropagation();void toggleSkillEnabled(skill,skill.enabled===false)};
      actions.append(toggle);
    }
    card.onclick=()=>void inspectSkillItem(skill,{curated});
    card.onkeydown=event=>{if(event.target===card&&(event.key==='Enter'||event.key===' ')){event.preventDefault();void inspectSkillItem(skill,{curated})}};
    return card;
  };
  if(skillsState.filter==='official'){
    const sysFiltered=officialSystem.filter(matchSkill),curFiltered=officialCurated.filter(matchSkill);
    if(sysFiltered.length){
      const head=document.createElement('div');head.className='skills-group-heading';head.innerHTML=`<span>${escapeHtml(t('Installed official skills'))}</span><span>${sysFiltered.length}</span>`;
      list.append(head);for(const item of sysFiltered)list.append(buildSkillCard(item));
    }
    if(curFiltered.length){
      const head=document.createElement('div');head.className='skills-group-heading';head.innerHTML=`<span>${escapeHtml(t('Official curated catalog'))}</span><span>${curFiltered.length}</span>`;
      list.append(head);
      const notice=document.createElement('small');notice.className='skills-notice';notice.textContent=t('Local OpenAI cache, not signature-verified. Review instructions and scripts before use.');list.append(notice);
      for(const item of curFiltered)list.append(buildSkillCard(item,{curated:true}));
    }
  }else{
    const ownFiltered=personalAll.filter(s=>s.editable&&matchSkill(s));
    const extFiltered=personalAll.filter(s=>!s.editable&&matchSkill(s));
    if(ownFiltered.length){
      const head=document.createElement('div');head.className='skills-group-heading';head.innerHTML=`<span>${escapeHtml(t('Personal skills'))}</span><span>${ownFiltered.length}</span>`;
      list.append(head);for(const item of ownFiltered)list.append(buildSkillCard(item));
    }
    if(extFiltered.length){
      const head=document.createElement('div');head.className='skills-group-heading';head.innerHTML=`<span>${escapeHtml(t('Project & external skills'))}</span><span>${extFiltered.length}</span>`;
      list.append(head);for(const item of extFiltered)list.append(buildSkillCard(item));
    }
  }
  if(!list.children.length){
    list.innerHTML=`<div class="panel-empty">${escapeHtml(t('No matching skills'))}</div>`;
  }
}
async function loadSkillsCatalog(forceReload=false){
  const cwd=currentComposerCwd()||state.config.defaultCwd||'.',requestId=++skillsState.requestId;
  if(skillsState.cwd!==cwd){skillsState.skills=[];skillsState.curated=[]}
  try{
    const response=await fetch(`/api/skills/catalog?cwd=${encodeURIComponent(cwd)}${forceReload?'&refresh=1':''}`,{cache:'no-store'}),data=await response.json();
    if(!response.ok)throw new Error(data.error||'Could not load skills');
    if(requestId!==skillsState.requestId||cwd!==(currentComposerCwd()||state.config.defaultCwd||'.'))return;
    skillsState.cwd=cwd;skillsState.personalRoot=data.personalRoot||'';skillsState.extraRoots=data.extraRoots||[];
    skillsState.errors=Array.isArray(data.errors)?data.errors:[];
    skillsState.skills=Array.isArray(data.skills)?data.skills:[];
    skillsState.curated=Array.isArray(data.curated)?data.curated:[];
    if(skillsState.selected?.path&&!skillsState.selected.curated){
      const current=skillsState.skills.find(s=>s.path===skillsState.selected.path);
      skillsState.selected=current?{...skillsState.selected,...current}:{...skillsState.selected,enabled:false};
      $('#skillInspectorUseButton').disabled=!current||current.enabled===false;
    }
    renderSkillsList();
    if(skillsState.errors.length){const note=document.createElement('div');note.className='skills-notice';note.textContent=skillsState.errors.map(e=>e.message||e.error||String(e)).join('\n');$('#skillsList').prepend(note)}
  }catch(error){
    if(requestId===skillsState.requestId){skillsState.cwd='';skillsState.skills=[];skillsState.curated=[];$('#skillsList').innerHTML=`<div class="panel-empty">${escapeHtml(error.message||'Could not load skills')}</div>`}
  }
}
async function toggleSkillEnabled(skill,enabled){
  if(!skill?.path||skillMutations.has(skill.path))return;
  skillMutations.add(skill.path);renderSkillsList();
  try{
    const res=await rpc('skills/config/write',{path:skill.path,cwd:currentComposerCwd()||state.config.defaultCwd,enabled:Boolean(enabled)});
    skill.enabled=res.effectiveEnabled;
    if(skillsState.selected?.path===skill.path){skillsState.selected.enabled=skill.enabled;$('#skillInspectorUseButton').disabled=!skill.enabled}
    toast(t(skill.enabled?'Skill enabled':'Skill disabled'));
    await loadSkillsCatalog(true);
  }catch(error){toast(t(error.message||'Could not update skill'))}
  finally{skillMutations.delete(skill.path);renderSkillsList()}
}
async function installCuratedSkill(curatedSkill){
  if(!curatedSkill?.id||skillMutations.has(curatedSkill.id))return;
  if(!confirm(t('Install this skill? Review its instructions and scripts before use.')))return;
  skillMutations.add(curatedSkill.id);renderSkillsList();
  try{
    const response=await fetch('/api/skills/install',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:curatedSkill.id})}),data=await response.json();
    if(!response.ok)throw new Error(data.error||'Install failed');
    toast(t('Skill installed'));
    await loadSkillsCatalog(true);
    setSkillsFilter('official');
    const installed=skillsState.skills.find(s=>s.path===data.path);
    if(installed)void inspectSkillItem(installed);
  }catch(error){toast(t(error.message||'Install failed'))}
  finally{skillMutations.delete(curatedSkill.id);renderSkillsList()}
}
function confirmDiscardSkillEdits(){
  if(!skillsState.editing)return true;
  return confirm(t('Discard unsaved skill changes?'));
}
async function inspectSkillItem(skill,{curated=false}={}){
  if(!confirmDiscardSkillEdits())return;
  const inspectId=++skillsState.inspectRequestId;
  const targetPath=skill?.path||skill?.sourcePath;
  skillsState.selected={...skill,curated};skillsState.editing=false;skillsState.creating=false;
  renderSkillsList();
  const tab=$('#utilityTab');
  tab.textContent=skillDisplayTitle(skill);tab.dataset.sidePanelTab='skills';tab.hidden=false;
  setSidePanelOpen(true,false);setSidePanelView('skills',skillDisplayTitle(skill));
  $('#skillInspectorTitle').textContent=skillDisplayTitle(skill);
  const badge=$('#skillInspectorBadge');
  badge.textContent=curated?t('Curated'):skill.category==='official'?t('Official'):skill.editable?t('Personal'):t('External');
  badge.className=`skill-scope-badge ${curated?'is-curated':skill.category==='official'?'is-official':'is-personal'}`;
  $('#skillInspectorPath').textContent=targetPath?shortPath(targetPath):(skill.repoPath||'');
  $('#skillEditorWrap').hidden=true;$('#skillCreateFields').hidden=true;$('#skillInspectorBody').hidden=false;
  $('#skillInspectorUseButton').hidden=curated||!targetPath;
  $('#skillInspectorUseButton').disabled=skill.enabled===false;
  $('#skillInspectorInstallButton').hidden=!curated||!skill.availableLocal;
  $('#skillInspectorEditButton').hidden=curated||!skill.editable;
  $('#skillInspectorSaveButton').hidden=true;
  $('#skillInspectorDeleteButton').hidden=curated||!skill.editable;
  $('#skillInspectorUseButton').onclick=()=>{const current=skillsState.skills.find(s=>s.path===targetPath);if(current)attachSkillToComposer(current)};
  $('#skillInspectorInstallButton').onclick=()=>void installCuratedSkill(skill);
  $('#skillInspectorDeleteButton').onclick=()=>void deleteSelectedPersonalSkill();
  if(!targetPath){
    $('#skillInspectorBody').innerHTML=`<div class="message-text"><p>${escapeHtml(skill.description||skill.shortDescription||'')}</p></div>`;
    return;
  }
  $('#skillInspectorBody').textContent=t('Loading skills…');
  $('#skillInspectorEditButton').hidden=true;$('#skillInspectorDeleteButton').hidden=true;
  try{
    const response=await fetch(`/api/skills/file?path=${encodeURIComponent(targetPath)}&cwd=${encodeURIComponent(currentComposerCwd()||state.config.defaultCwd)}`,{cache:'no-store'}),file=await response.json();
    if(!response.ok)throw new Error(file.error||'Could not read SKILL.md');
    if(inspectId!==skillsState.inspectRequestId)return;
    skillsState.selected={...skill,curated,path:file.path,fileName:file.name,editable:Boolean(file.editable),content:file.content};
    $('#skillInspectorEditButton').hidden=curated||!file.editable;
    $('#skillInspectorDeleteButton').hidden=curated||!file.editable;
    $('#skillInspectorBody').innerHTML=`<div class="message-text">${renderAssistantMarkdown((file.content||'').replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/,''),{cwd:currentComposerCwd()||state.config.defaultCwd})}</div>`;
    $('#skillInspectorEditButton').onclick=()=>startEditingSelectedSkill();
  }catch(error){
    if(inspectId===skillsState.inspectRequestId)$('#skillInspectorBody').innerHTML=`<div class="panel-empty">${escapeHtml(error.message)}</div>`;
  }
}
function startEditingSelectedSkill(){
  const selected=skillsState.selected;if(!selected?.editable)return;
  skillsState.editing=true;skillsState.creating=false;
  $('#skillInspectorBody').hidden=true;
  $('#skillEditorWrap').hidden=false;$('#skillCreateFields').hidden=true;
  $('#skillEditorTextarea').value=selected.content||'';
  $('#skillInspectorEditButton').hidden=true;
  $('#skillInspectorSaveButton').hidden=false;
  $('#skillInspectorSaveButton').onclick=()=>void saveSkillFromEditor();
  $('#skillEditorTextarea').focus();
}
function openNewPersonalSkillEditor(){
  if(!confirmDiscardSkillEdits())return;
  skillsState.inspectRequestId++;
  skillsState.creating=true;skillsState.editing=true;skillsState.selected=null;
  renderSkillsList();
  const tab=$('#utilityTab');
  tab.textContent=t('New personal skill');tab.dataset.sidePanelTab='skills';tab.hidden=false;
  setSidePanelOpen(true,false);setSidePanelView('skills',t('New personal skill'));
  $('#skillInspectorTitle').textContent=t('New personal skill');
  const badge=$('#skillInspectorBadge');badge.textContent=t('Personal');badge.className='skill-scope-badge is-personal';
  $('#skillInspectorPath').textContent=`${skillsState.personalRoot||'~/.codex/skills'}/<skill-id>/SKILL.md`;
  $('#skillInspectorBody').hidden=true;
  $('#skillEditorWrap').hidden=false;$('#skillCreateFields').hidden=false;
  $('#skillCreateNameInput').value='';$('#skillCreateDescInput').value='';
  $('#skillEditorTextarea').value='---\nname: my-custom-skill\ndescription: "Describe when Codex should use this skill."\n---\n\n# My Custom Skill\n\n## Instructions\n- Step 1: Inspect the inputs.\n- Step 2: Run the workflow and verify outputs.\n';
  const syncTemplate=()=>{
    const id=$('#skillCreateNameInput').value.trim()||'my-custom-skill';
    const desc=$('#skillCreateDescInput').value.trim()||'Describe when Codex should use this skill.';
    $('#skillEditorTextarea').value=$('#skillEditorTextarea').value.replace(/^(---\n[\s\S]*?\n?)name:[^\n]*/,(m,prefix)=>`${prefix}name: ${JSON.stringify(id)}`).replace(/^(---\n[\s\S]*?\n)description:[^\n]*/,(m,prefix)=>`${prefix}description: ${JSON.stringify(desc)}`);
  };
  $('#skillCreateNameInput').oninput=syncTemplate;
  $('#skillCreateDescInput').oninput=syncTemplate;
  $('#skillInspectorUseButton').hidden=true;$('#skillInspectorInstallButton').hidden=true;
  $('#skillInspectorEditButton').hidden=true;$('#skillInspectorDeleteButton').hidden=true;
  $('#skillInspectorSaveButton').hidden=false;
  $('#skillInspectorSaveButton').onclick=()=>void saveSkillFromEditor();
  $('#skillCreateNameInput').focus();
}
async function saveSkillFromEditor(){
  const creating=skillsState.creating;
  if(skillMutations.has('editor'))return;
  const name=creating?$('#skillCreateNameInput').value.trim():(skillsState.selected?.fileName||skillsState.selected?.name);
  const description=creating?$('#skillCreateDescInput').value.trim():'';
  const content=$('#skillEditorTextarea').value;
  skillMutations.add('editor');$('#skillInspectorSaveButton').disabled=true;
  try{
    const response=await fetch('/api/skills/personal',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,description,content,overwrite:!creating})}),saved=await response.json();
    if(!response.ok)throw new Error(saved.error||'Could not save skill');
    toast(t('Skill saved'));skillsState.editing=false;skillsState.creating=false;
    await loadSkillsCatalog(true);
    const target=skillsState.skills.find(s=>s.path===saved.path);
    setSkillsFilter(target?.category||'personal');
    if(!target){toast(t('Saved on disk, but Codex did not load this skill. Refresh to see parser errors.'),5000);return}
    await inspectSkillItem(target);
  }catch(error){toast(t(error.message||'Could not save skill'))}
  finally{skillMutations.delete('editor');$('#skillInspectorSaveButton').disabled=false}
}
async function deleteSelectedPersonalSkill(){
  const selected=skillsState.selected;if(!selected?.editable)return;
  if(skillMutations.has(selected.path)||!confirm(t('Delete personal skill “{name}” and its files?',{name:selected.name})))return;
  skillMutations.add(selected.path);
  try{
    const response=await fetch('/api/skills/personal',{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({name:selected.name,path:selected.path})}),data=await response.json();
    if(!response.ok)throw new Error(data.error||'Could not delete skill');
    toast(t('Skill deleted'));
    skillsState.selected=null;skillsState.editing=false;skillsState.creating=false;skillsState.inspectRequestId++;
    state.composerMentions=state.composerMentions.filter(item=>item.path!==selected.path);renderContextTray();saveActiveDraft();
    $('#skillInspectorTitle').textContent=t('Skills');$('#skillInspectorPath').textContent='';
    $('#skillInspectorBody').hidden=false;$('#skillEditorWrap').hidden=true;
    $('#skillInspectorBody').innerHTML=`<div class="panel-empty">${escapeHtml(t('Select a skill from the left sidebar to view or edit its instructions.'))}</div>`;
    $('#skillInspectorUseButton').hidden=true;$('#skillInspectorEditButton').hidden=true;$('#skillInspectorSaveButton').hidden=true;$('#skillInspectorDeleteButton').hidden=true;
    await loadSkillsCatalog(true);
  }catch(error){toast(t(error.message||'Could not delete skill'))}
  finally{skillMutations.delete(selected.path)}
}
async function uploadFilesToWorkspace(fileList){
  const files=[...(fileList||[])];if(!files.length)return[];
  let cwd=currentComposerCwd();
  if(!cwd){
    if(state.projectless){toast(t('Select a project folder to upload files.'));return[]}
    cwd=state.cwd||state.config.defaultCwd||state.config.home;
    if(!cwd){openFolderPicker();return[]}
    setWorkspace(cwd);
  }
  const targetEpoch=conversationEpoch,targetThreadId=state.active?.id||null,uploaded=[];
  for(const file of files){
    try{
      if(Number.isFinite(file.size)&&file.size>MAX_CLIENT_UPLOAD_BYTES)throw new Error('Upload is too large');
      const directory=fileBrowserState.sidebarTab==='files'?fileBrowserState.dir:'';
      const name=file.name&&file.name.trim()?file.name:`paste-${Date.now()}.png`;
      const buffer=await file.arrayBuffer();
      const response=await fetch(`/api/files/upload?cwd=${encodeURIComponent(cwd)}&dir=${encodeURIComponent(directory)}&filename=${encodeURIComponent(name)}`,{method:'POST',headers:{'content-type':'application/octet-stream'},body:buffer});
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data.error||'Upload failed');
      if(conversationEpoch!==targetEpoch||(state.active?.id||null)!==targetThreadId)continue;
      const item={id:`attachment:${data.path}`,path:data.path,fullPath:data.path,relativePath:data.relativePath,filename:data.filename,size:data.size,isImage:Boolean(data.isImage)};
      if(!state.composerAttachments.some(existing=>existing.path===item.path))state.composerAttachments.push(item);
      uploaded.push(item);
    }catch(error){toast(t(error.message||'Upload failed'),4200)}
  }
  if(uploaded.length&&conversationEpoch===targetEpoch&&(state.active?.id||null)===targetThreadId){
    renderContextTray();syncComposerSubmitState();saveActiveDraft();
    if(fileBrowserState.sidebarTab==='files')await loadWorkspaceFiles(fileBrowserState.dir);
    toast(uploaded.length===1?t('Attached {name}',{name:uploaded[0].filename}):t('Attached {count} files',{count:uploaded.length}));
  }
  return uploaded;
}
async function attachChatImages(fileList){
  const files=[...(fileList||[])].filter(isChatImageFile);if(!files.length)return[];
  const existing=state.composerAttachments.filter(item=>item?.isImage||item?.kind==='image').length,room=CHAT_IMAGE_LIMIT-existing;
  if(room<=0){toast(t('You can attach up to {count} images',{count:CHAT_IMAGE_LIMIT}));return[]}
  const accepted=files.slice(0,room),targetEpoch=conversationEpoch,targetThreadId=state.active?.id||null,attached=[];
  if(accepted.length<files.length)toast(t('You can attach up to {count} images',{count:CHAT_IMAGE_LIMIT}));
  for(const file of accepted){
    try{
      const image=await readChatImageFile(file);
      if(conversationEpoch!==targetEpoch||(state.active?.id||null)!==targetThreadId)continue;
      const item={id:`inline-image:${crypto.randomUUID?.()||Date.now()}-${attached.length}`,...image};
      state.composerAttachments.push(item);attached.push(item);
    }catch(error){toast(t(error.message||'Upload failed'),4200)}
  }
  if(attached.length&&conversationEpoch===targetEpoch&&(state.active?.id||null)===targetThreadId){renderContextTray();syncComposerSubmitState();saveActiveDraft()}
  return attached;
}
async function uploadComposerFiles(fileList){
  const files=[...(fileList||[])];if(!files.length)return[];
  const images=files.filter(isChatImageFile),others=files.filter(file=>!isChatImageFile(file));
  const attached=await attachChatImages(images);
  const uploaded=others.length?await uploadFilesToWorkspace(others):[];
  return [...attached,...(uploaded||[])];
}
function resetReviewState(){state.turnDiffs.clear();state.activeReview=null}
function clearConversationRuntime(){for(const animation of state.motion.values())animation?.destroy?.();state.items.clear();state.turns.clear();state.activities.clear();state.activityItems.clear();state.requestCards.clear();state.sideTasks.clear();state.dividers.clear();state.motion.clear();renderSideTasks()}
function rememberActiveThread(id){if(id)localStorage.setItem(ACTIVE_THREAD_STORAGE_KEY,String(id));else localStorage.removeItem(ACTIVE_THREAD_STORAGE_KEY)}
function startNewTask({saveDraft=true,resetDraft=false}={}){if(resetDraft){writeThreadDraft(null,currentDraftCwd(),{text:'',mentions:[],attachments:[]})}else if(saveDraft)saveActiveDraft();saveActiveThreadSettings();closeThreadActionsMenu();conversationEpoch++;resetActiveThreadSync();setActiveTurnId('');rememberActiveThread(null);state.active=null;state.composerMentions=[];state.composerAttachments=[];state.turnWindow=null;clearConversationRuntime();state.changes.clear();resetReviewState();closeComposerAutocomplete();$('#threadTitle').textContent=t('New task');$('#threadPath').textContent=state.projectless?'':shortPath(state.cwd||'');$('#prompt').value='';setPlanMode(false);syncThreadActionsMenu();restoreActiveDraft();renderModels();state.permissionMode=localStorage.getItem('codex-webui-permission-mode')||'default';syncPermissionControl();renderContextUsage();if(!$('#summaryPanel').hidden)syncSummaryPanel();showEmpty();renderThreads();$('#prompt').focus()}
function announceCwdChange(path){toast(state.active?t('New tasks will use {path}',{path}):t('Working directory changed to {path}',{path}))}
function useSelectedFolder(){if(!folderBrowse.selected)return;saveActiveDraft();const picked=folderBrowse.selected;setWorkspace(picked);$('#folderDialog').close();announceCwdChange(shortPath(picked))}
function useProjectless(){saveActiveDraft();setProjectless();$('#folderDialog').close();announceCwdChange('~')}
function titleOf(t){return (t.name||t.preview||'Untitled task').replace(/\s+/g,' ').trim().slice(0,110)}
function shortPath(path=''){const home=state.config.home;return home&&path.startsWith(home)?'~'+path.slice(home.length):path}
function sidebarProjectKey(thread={}){return thread.projectless||!thread.cwd?'__tasks__':String(thread.cwd).replace(/\/+$/,'')}
function sidebarProjectName(key){if(key==='__tasks__')return'Tasks';if(key===state.config.home)return'Home';return key.split('/').filter(Boolean).at(-1)||key}
function currentSidebarProjectKey(){if(state.projectless)return'__tasks__';return String(state.active?.cwd||state.cwd||'').replace(/\/+$/,'')}
function saveSidebarProjectExpansion(){localStorage.setItem(SIDEBAR_PROJECT_EXPANSION_KEY,JSON.stringify(sidebarProjectExpansion))}
async function deleteThread(thread){
  if(!thread?.id)return;
  const title=titleOf(thread);
  if(!confirm(t('Delete “{title}”? This permanently deletes the thread and its descendants.',{title})))return;
  try{
    await rpc('thread/delete',{threadId:thread.id});
    const wasActive=state.active?.id===thread.id;
    state.threads=state.threads.filter(item=>item.id!==thread.id);
    await refreshThreadList();
    if(wasActive)startNewTask();else renderThreads();
    toast(t('Thread deleted'));
  }catch(error){console.error('Could not delete thread',error);toast(t('Could not delete thread'))}
}
function threadVisualStatus(thread){
  const id=thread?.id;if(!id)return'idle';
  if([...pendingApprovals.values()].some(req=>req.params?.threadId===id))return'approval';
  const run=threadRuns.get(id);
  if(run&&RUNNING_PHASES.has(run.phase))return run.phase==='approval'?'approval':'running';
  if(thread.status?.type==='active'||thread.liveActive)return'running';
  if(unreadCompletedThreads.has(id))return'completed';
  return'idle';
}
const sidebarProjectOrder=[];
function renderThreads(){
  const list=$('#threadList'),prevScrollTop=list.scrollTop,q=$('#threadSearch').value.trim().toLowerCase(),groups=new Map;list.innerHTML='';
  for(const thread of state.threads){if(q&&!titleOf(thread).toLowerCase().includes(q)&&!thread.cwd?.toLowerCase().includes(q))continue;const key=sidebarProjectKey(thread),group=groups.get(key)||{key,threads:[],recency:0};group.threads.push(thread);group.recency=Math.max(group.recency,Number(thread.recencyAt||thread.updatedAt)||0);groups.set(key,group)}
  for(const group of [...groups.values()].sort((a,b)=>b.recency-a.recency))if(!sidebarProjectOrder.includes(group.key))sidebarProjectOrder.push(group.key);
  const ordered=[...groups.values()].sort((a,b)=>sidebarProjectOrder.indexOf(a.key)-sidebarProjectOrder.indexOf(b.key));
  for(const group of ordered){
    if(!Object.hasOwn(sidebarProjectExpansion,group.key))sidebarProjectExpansion[group.key]=true;
    const expanded=Boolean(q)||Boolean(sidebarProjectExpansion[group.key]),section=document.createElement('section');
    section.className='sidebar-project-group';section.dataset.project=group.key;
    const states=group.threads.map(threadVisualStatus),groupDot=states.includes('running')?'is-running':states.includes('approval')?'is-approval':states.includes('completed')?'is-completed':'';
    const heading=document.createElement('button');heading.type='button';heading.className='sidebar-project-row';heading.setAttribute('aria-expanded',String(expanded));heading.title=group.key==='__tasks__'?t('Tasks'):shortPath(group.key);
    heading.innerHTML=`${codexIcon(group.key==='__tasks__'?'messageSquare':'folderOpen')}<span>${escapeHtml(sidebarProjectName(group.key))}</span>${!expanded&&groupDot?`<span class="sidebar-project-dot ${groupDot}" aria-hidden="true"></span>`:''}${codexIcon('chevronRight','sidebar-project-chevron')}`;
    section.append(heading);
    const threads=document.createElement('div');threads.className='sidebar-project-threads'+(expanded?' expanded':'');threads.setAttribute('aria-hidden',String(!expanded));threads.style.setProperty('--sidebar-thread-count',String(group.threads.length));
    heading.onclick=()=>{const next=heading.getAttribute('aria-expanded')!=='true';sidebarProjectExpansion[group.key]=next;saveSidebarProjectExpansion();renderThreads()};
    for(const thread of group.threads){
      const status=threadVisualStatus(thread);
      const row=document.createElement('div');row.className='thread-item'+(state.active?.id===thread.id?' active':'')+(status!=='idle'?` is-${status}`:'');row.dataset.id=thread.id;row.dataset.threadStatus=status;row.title=[titleOf(thread),shortPath(thread.cwd)].filter(Boolean).join(' — ');row.setAttribute('role','button');row.tabIndex=0;
      const name=document.createElement('span');name.className='thread-name';name.textContent=titleOf(thread);
      const meta=document.createElement('span');meta.className='thread-meta'+(status!=='idle'?' is-status':'');
      if(status==='running'){
        meta.innerHTML=`<span class="thread-status-spinner" role="img" aria-label="${escapeHtml(t('Running'))}" title="${escapeHtml(t('Running'))}">${codexIcon('loaderCircle')}</span>`;
      }else if(status==='approval'){
        meta.innerHTML=`<span class="thread-status-dot is-approval" role="img" aria-label="${escapeHtml(t('Waiting for approval'))}" title="${escapeHtml(t('Waiting for approval'))}"></span>`;
      }else if(status==='completed'){
        meta.innerHTML=`<span class="thread-status-dot is-completed" role="img" aria-label="${escapeHtml(t('Completed'))}" title="${escapeHtml(t('Completed'))}"></span>`;
      }else{
        const time=document.createElement('time');time.textContent=formatAge(thread.recencyAt||thread.updatedAt);meta.append(time);
      }
      const remove=document.createElement('button');remove.type='button';remove.className='thread-delete';remove.title=t('Delete thread');remove.setAttribute('aria-label',t('Delete thread “{title}”',{title:titleOf(thread)}));remove.innerHTML=codexIcon('trash');remove.onkeydown=event=>event.stopPropagation();remove.onclick=event=>{event.stopPropagation();deleteThread(thread)};
      row.append(name,meta,remove);
      const open=()=>{unreadCompletedThreads.delete(thread.id);openThread(thread.id)};
      row.onclick=event=>{if(event.target.closest('.thread-delete'))return;open()};
      row.onkeydown=event=>{if(event.target.closest('.thread-delete'))return;if(event.key==='Enter'||event.key===' '){event.preventDefault();open()}};
      threads.append(row);
    }
    section.append(threads);list.append(section);
  }
  if(!list.children.length)list.innerHTML='<div class="list-state">No matching tasks</div>';
  list.scrollTop=prevScrollTop;
}
async function openThread(id,fallbackSummary=null){
  unreadCompletedThreads.delete(id);
  saveActiveDraft();saveActiveThreadSettings();closeThreadActionsMenu();
  const selectionEpoch=++conversationEpoch;
  const listedSummary=state.threads.find(x=>x.id===id),summary=listedSummary||fallbackSummary,deferTransition=Boolean(fallbackSummary&&!listedSummary);
  if(!deferTransition){resetActiveThreadSync();setActiveTurnId('');rememberActiveThread(id);if(summary){state.active=summary;state.composerMentions=[];state.composerAttachments=[];state.turnWindow=null;clearConversationRuntime();state.changes.clear();resetReviewState();closeComposerAutocomplete();restoreActiveDraft();renderContextUsage();renderHeader();renderThreads();$('#conversation').innerHTML='<div class="list-state conversation-loading">Loading conversation…</div>'}}
  try{const result=await rpc('thread/read',{threadId:id,includeTurns:false}),thread={...(summary||{}),...result.thread};if(selectionEpoch!==conversationEpoch)return false;await loadThreadTurns(thread);if(selectionEpoch!==conversationEpoch)return false;resetActiveThreadSync();setActiveTurnId('');state.active=thread;applyThreadSettings(thread);rememberActiveThread(thread.id);state.composerMentions=[];state.composerAttachments=[];state.turnWindow=null;clearConversationRuntime();state.changes.clear();resetReviewState();closeComposerAutocomplete();restoreActiveDraft();renderContextUsage();renderHeader();renderThreads();renderThread(thread);if(thread.turns?.length)syncTurnRuntime(thread.turns.at(-1));restorePendingApprovals();scrollOpenedThreadToBottom();scheduleActiveThreadSync(0);return true}
  catch(e){if(selectionEpoch!==conversationEpoch)return false;if(deferTransition){toast(e?.message||'Could not load side task');return false}if(!summary||state.active?.id!==id)return false;$('#conversation').innerHTML='<div class="list-state conversation-loading">Could not load history. Send a message to start fresh.</div>';return false}}

function renderHeader(){renderRuntimeBar();syncThreadActionsMenu();const t=state.active;if(!t)return;$('#threadTitle').textContent=titleOf(t);$('#threadPath').textContent=t.projectless?'':shortPath(t.cwd||'');refreshComposerPlaceholder();$('#threadSource').textContent=t.source||'local'}
async function loadThreadTurns(thread,cursor=null){const params={threadId:thread.id,limit:INITIAL_TURN_PAGE_SIZE,sortDirection:'desc',itemsView:'full'};if(cursor)params.cursor=cursor;try{const result=await rpc('thread/turns/list',params),page=Array.isArray(result.data)?result.data.slice().reverse():[];thread.turns=cursor?[...page,...(thread.turns||[])]:page;thread.olderTurnsCursor=result.nextCursor||null;return result}catch(error){if(cursor)throw error;const result=await rpc('thread/read',{threadId:thread.id,includeTurns:true}),page=Array.isArray(result.thread?.turns)?result.thread.turns:[];thread.turns=page;thread.olderTurnsCursor=null;return result}}
async function loadOlderTurns(thread){if(!thread?.olderTurnsCursor||thread.olderTurnsLoading)return;thread.olderTurnsLoading=true;try{const previousHeight=$('#conversation').scrollHeight,previousTop=$('#conversation').scrollTop;await loadThreadTurns(thread,thread.olderTurnsCursor);renderThread(thread,{preserveScroll:true,previousHeight,previousTop})}catch(error){toast(error.message||'Could not load earlier messages')}finally{thread.olderTurnsLoading=false}}
function renderThread(thread,{preserveScroll=false,previousHeight=0,previousTop=0}={}){const root=$('#conversation');clearConversationRuntime();root.innerHTML='';for(const turn of thread.turns||[])renderTurn(turn,root);restorePendingApprovals();if(!root.children.length)showEmpty();else if(preserveScroll)requestAnimationFrame(()=>{root.scrollTop=previousTop+(root.scrollHeight-previousHeight)});else scrollBottom()}
function showEmpty(){if(pendingSubmission?.epoch===conversationEpoch&&$('#conversation [data-optimistic-user="true"]'))return;const root=$('#conversation'),project=state.projectless?null:(state.workspaceContext?.project||$('#projectName').textContent?.trim()),cwd=shortPath(state.cwd||'');root.innerHTML=`<div class="empty-state" id="emptyState">${codexInterfaceMark('empty-codex-mark')}<h1>${project?`What can I help with in ${escapeHtml(project)}?`:'What can I help?'}</h1>${cwd?`<div class="empty-cwd"><span>${escapeHtml(t('Working in {path}',{path:cwd}))}</span><button type="button" id="emptyChangeDirectory">${escapeHtml(t('Change'))}</button></div>`:''}</div>`;const change=root.querySelector('#emptyChangeDirectory');if(change)change.onclick=()=>openFolderPicker()}
function ensureTurnTimeline(turnId,root=$('#conversation')){let turn=state.turns.get(turnId);if(turn?.isConnected)return turn;turn=document.createElement('article');turn.className='turn assistant-turn native-turn-timeline';turn.dataset.turnId=turnId;turn.innerHTML='<div class="assistant-body"><div class="turn-event-stream"></div></div><div class="worked-for-divider" data-worked-for-divider hidden><span>Worked</span><div></div></div><div class="turn-final-slot"></div>';root.append(turn);state.turns.set(turnId,turn);state.dividers.set(turnId,turn.querySelector('[data-worked-for-divider]'));return turn}
function formatWorkedDuration(durationMs){if(!Number.isFinite(durationMs)||durationMs<1000)return null;const seconds=Math.max(1,Math.round(durationMs/1000));if(seconds<60)return`${seconds}s`;const minutes=Math.floor(seconds/60),rest=seconds%60;return rest?`${minutes}m ${rest}s`:`${minutes}m`}
function turnDurationMs(turn={}){if(Number.isFinite(turn.durationMs))return turn.durationMs;if(Number.isFinite(turn.startedAt)&&Number.isFinite(turn.completedAt))return Math.max(0,(turn.completedAt-turn.startedAt)*1000);if(Number.isFinite(turn.startedAtMs)&&Number.isFinite(turn.completedAtMs))return Math.max(0,turn.completedAtMs-turn.startedAtMs);return undefined}
function syncWorkedForDivider(turnId,durationMs){const turn=state.turns.get(turnId),divider=state.dividers.get(turnId);if(!turn||!divider)return;if(Number.isFinite(durationMs))turn.dataset.durationMs=String(durationMs);const hasActivity=Boolean(turn.querySelector('[data-agent-activity-group]')),hasFinal=Boolean(turn.querySelector('[data-local-conversation-final-assistant]'));divider.hidden=!(hasActivity&&hasFinal);const duration=formatWorkedDuration(Number(turn.dataset.durationMs));divider.querySelector('span').textContent=duration?`Worked for ${duration}`:'Worked'}
function renderTurn(turn,root=$('#conversation')){rememberTurnStatus(turn);for(const item of turn.items||[])upsertItem(item,turn.id,root,false);syncWorkedForDivider(turn.id,turnDurationMs(turn))}
function textFromInput(content=[]){return content.filter(x=>x.type==='text').map(x=>x.text).join('\n')}
function userContentFromInput(displayText,attachments=[]){const content=[];if(displayText)content.push({type:'text',text:displayText});for(const attachment of attachments){const url=inlineImageUrl(attachment);if(url)content.push({type:'image',url,alt:attachment.filename||'Image'});else if((attachment?.isImage||attachment?.kind==='image')&&(attachment.fullPath||attachment.path))content.push({type:'localImage',path:attachment.fullPath||attachment.path,alt:attachment.filename||'Image'})}return content.length?content:[{type:'text',text:displayText||''}]}
function contentHasImage(item){return (item?.content||[]).some(part=>part&&/image/i.test(String(part.type||'')))}
function payloadForElement(el){return userPayloads.get(el)||turnPayloads.get(`${state.active?.id||''}:${el?.dataset.turnId||''}`)||null}
function renderUserMessage(el,item){const body=el.querySelector('.user-message'),text=textFromInput(item.content);body.textContent=text;const payload=payloadForElement(el),source=contentHasImage(item)||!payload?item:{...item,content:[...(item.content||[]),...userContentFromInput('',payload.attachments).filter(part=>part.type!=='text')]};el.querySelector(':scope > .message-image-grid')?.remove();const images=renderItemImages(source,{cwd:imageCwd(item),className:'message-image-grid user-message-images',excludeText:text});if(images)body.insertAdjacentHTML('afterend',images);messageActions.updateMessageCopy(el,()=>body.textContent);syncUserRetry(el)}
function rememberTurnStatus(turn){if(!turn?.id)return;const error=typeof turn.error==='string'?turn.error:turn.error?.message||'';turnStatusById.set(turn.id,{status:turn.status||'',error});for(const el of document.querySelectorAll(`.user-turn[data-turn-id="${CSS.escape(String(turn.id))}"]`))syncUserRetry(el)}
function syncUserRetry(el){if(!el)return;const turnId=el.dataset.turnId||'',status=turnStatusById.get(turnId),failed=(el.dataset.sendFailed==='true'||status?.status==='failed')&&el.dataset.retried!=='true',error=el.dataset.sendError||status?.error||'';messageActions.updateMessageRetry(el,{visible:failed,error:failed?t(error||'This message failed'):'',disabled:Boolean(pendingSubmission||activeTurnId()),onRetry:()=>{void retryUserMessage(el)}})}
function refreshUserRetries(){for(const el of document.querySelectorAll('.user-turn'))syncUserRetry(el)}
function payloadFromUserItem(item){const content=Array.isArray(item?.content)?item.content:[],text=textFromInput(content),attachments=[],mentions=[];for(const part of content){if(!part||typeof part!=='object')continue;if(part.type==='mention'||part.type==='skill')mentions.push(part);if(!/image/i.test(String(part.type||'')))continue;const url=typeof part.url==='string'?part.url:typeof part.image_url==='string'?part.image_url:part.image_url?.url;if(typeof url==='string'&&url.startsWith('data:image/')){const match=url.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i);if(match)attachments.push({id:`image:${attachments.length}`,kind:'image',isImage:true,mimeType:match[1].toLowerCase(),data:match[2].replace(/\s/g,''),previewUrl:url,filename:part.alt||'image'})}else if(typeof part.path==='string'&&part.path)attachments.push({id:`image:${part.path}`,kind:'image',isImage:true,path:part.path,fullPath:part.path,filename:part.alt||part.path.split('/').pop()})}if(!text&&!attachments.length&&!mentions.length)return null;return {text,mentions,attachments,inputItems:buildConversationInput({text,mentions,attachments}),displayText:text}}
async function retryUserMessage(el){if(!el||pendingSubmission)return;const running=activeTurnId();if(running&&el.dataset.turnId!==running){toast(t('Wait for the current response to finish.'));return}const payload=payloadForElement(el)||payloadFromUserItem(userItems.get(el));if(!payload){toast(t('Cannot retry this message'));return}if(el.dataset.sendFailed==='true'){el.remove();for(const [id,node] of state.items)if(node===el)state.items.delete(id)}else{el.dataset.retried='true';syncUserRetry(el)}await deliverConversationInput({...payload,steerTurnId:running&&el.dataset.turnId===running?running:'',clearComposer:false})}
function claimOptimisticUser(item,root){if(String(item.id).startsWith('local-'))return null;const text=textFromInput(item.content),candidates=[...root.querySelectorAll('.user-turn[data-optimistic-user="true"]')];const el=candidates.find(node=>node.querySelector('.user-message')?.textContent===text);if(!el)return null;for(const[id,node]of state.items)if(node===el)state.items.delete(id);delete el.dataset.optimisticUser;state.items.set(item.id,el);return el}
function agentMessageIdFamily(id){const value=String(id||'');return /^item[-_]/.test(value)?'app':/^(?:msg_|host-message-)/.test(value)?'rollout':''}
function claimEquivalentAgentMessage(item,turnId){const family=agentMessageIdFamily(item.id);if(!family)return null;const text=agentMessageText(item,''),commentary=item.phase==='commentary';for(const[id,node]of state.items){if(agentMessageIdFamily(id)===family||node.closest('[data-turn-id]')?.dataset.turnId!==turnId)continue;const body=node.querySelector('.message-text'),existingCommentary=node.dataset.localConversationCommentary!==undefined;if(existingCommentary===commentary&&body?.dataset.raw===text){state.items.set(item.id,node);return node}}return null}
function placeAgentMessage(el,item,timeline){const commentary=item.phase==='commentary',slot=timeline.querySelector(commentary?'.turn-event-stream':'.turn-final-slot');el.className=commentary?'assistant-response assistant-commentary':'assistant-response';if(commentary){delete el.dataset.localConversationFinalAssistant;el.dataset.localConversationCommentary=''}else{delete el.dataset.localConversationCommentary;el.dataset.localConversationFinalAssistant=''}if(el.parentElement!==slot)slot.append(el)}
function imageCwd(item={}){return item.cwd||state.active?.cwd||state.config.defaultCwd||'.'}
function sideTaskStatus(item,threadId){const agent=item.agentsStates?.[threadId];if(agent?.status)return agent.status;if(item.type==='subAgentActivity')return item.kind==='interrupted'?'interrupted':'running';return item.status==='failed'?'errored':item.status==='completed'?'completed':'running'}
function updateSideTasks(item){if(item.type==='collabAgentToolCall'){for(const threadId of item.receiverThreadIds||[]){const previous=state.sideTasks.get(threadId)||{};state.sideTasks.set(threadId,{...previous,threadId,prompt:item.prompt||previous.prompt||'',model:item.model||previous.model||'',reasoningEffort:item.reasoningEffort||previous.reasoningEffort||'',status:sideTaskStatus(item,threadId),message:item.agentsStates?.[threadId]?.message||previous.message||''})}}else if(item.type==='subAgentActivity'){const previous=state.sideTasks.get(item.agentThreadId)||{};state.sideTasks.set(item.agentThreadId,{...previous,threadId:item.agentThreadId,agentPath:item.agentPath||previous.agentPath||'',status:sideTaskStatus(item,item.agentThreadId)})}renderSideTasks()}
function renderSideTasks(){const list=$('#sideTaskList');if(!list)return;list.innerHTML='';for(const task of state.sideTasks.values()){const button=document.createElement('button');button.type='button';button.className='side-task-card';button.dataset.threadId=task.threadId;button.innerHTML=`${codexIcon('messageSquare')}<span class="side-task-copy"><strong>${escapeHtml(task.agentPath||task.model||'Side task')}</strong><small>${escapeHtml(task.message||task.prompt||task.threadId)}</small></span><span class="side-task-status ${escapeHtml(task.status||'running')}">${escapeHtml(task.status||'running')}</span>`;button.onclick=async()=>{button.disabled=true;button.setAttribute('aria-busy','true');await openThread(task.threadId,{id:task.threadId,name:task.agentPath||task.model||'Side task',preview:task.prompt||task.message||'',cwd:state.active?.cwd||state.config.defaultCwd,source:'local',sideTask:true});if(button.isConnected){button.disabled=false;button.removeAttribute('aria-busy')}};list.append(button)}if(!state.sideTasks.size)list.innerHTML='<div class="side-task-empty">Side tasks started by this chat will appear here.</div>';const summary=$('#summarySideTasks');if(summary)summary.textContent=state.sideTasks.size?`${state.sideTasks.size} side task${state.sideTasks.size===1?'':'s'}`:'No side tasks'}
function upsertItem(item,turnId,root=$('#conversation'),live=true){
  const follow=live&&root.scrollHeight-root.scrollTop-root.clientHeight<80;
  root.querySelector('#emptyState')?.remove();
  let el=state.items.get(item.id);if(!el&&item.type==='userMessage')el=claimOptimisticUser(item,root);if(!el&&item.type==='agentMessage')el=claimEquivalentAgentMessage(item,turnId);if(!el){
    if(item.type==='userMessage'){el=document.createElement('article');el.className='turn user-turn';if(String(item.id).startsWith('local-'))el.dataset.optimisticUser='true';el.innerHTML='<div class="user-message"></div>';const timeline=state.turns.get(turnId);timeline?.isConnected?root.insertBefore(el,timeline):root.append(el)}
    else if(item.type==='agentMessage'){const timeline=ensureTurnTimeline(turnId,root);el=document.createElement('div');el.innerHTML='<div class="message-text"></div>';placeAgentMessage(el,item,timeline)}
    else if(item.type==='imageGeneration'){const timeline=ensureTurnTimeline(turnId,root);el=document.createElement('div');el.className='assistant-generated-image';timeline.querySelector('.turn-event-stream').append(el)}
    else if(['commandExecution','fileChange','mcpToolCall','dynamicToolCall','collabAgentToolCall','subAgentActivity','webSearch','reasoning','plan','imageView'].includes(item.type)){const id=activityItemId(item);el=ensureActivity(turnId,root,id,item.type==='imageView'||item.type==='reasoning');addActivity(item,el,id)}
    else return;
    if(item.type==='userMessage'||item.type==='agentMessage'||item.type==='imageGeneration')state.items.set(item.id,el);
  }
  if(item.type==='userMessage'){if(turnId&&turnId!=='optimistic'){el.dataset.turnId=String(turnId);const payload=userPayloads.get(el);if(payload&&state.active?.id)turnPayloads.set(`${state.active.id}:${turnId}`,payload)}userItems.set(el,item);renderUserMessage(el,item)}
  if(item.type==='agentMessage'){const timeline=ensureTurnTimeline(turnId,root),body=el.querySelector('.message-text'),text=agentMessageText(item,body.dataset.raw??''),cwd=imageCwd(item);placeAgentMessage(el,item,timeline);if(pendingMarkdownFrames.has(body)){cancelAnimationFrame(pendingMarkdownFrames.get(body));pendingMarkdownFrames.delete(body)}body.dataset.raw=text;body.innerHTML=renderAssistantMarkdown(text,{cwd})+renderItemImages(item,{cwd,className:'message-image-grid structured-message-images',excludeText:text});messageActions.enhanceCodeBlocks(body);messageActions.updateMessageCopy(el,()=>agentMessageText({text:body.dataset.raw||''}));syncWorkedForDivider(turnId)}
  if(item.type==='imageGeneration'){const html=renderItemImages(item,{cwd:imageCwd(item),className:'generated-image-grid'});el.innerHTML=html||`<div class="generated-image-pending ${item.status==='inProgress'?'loading-shimmer':''}">${item.status==='failed'?'Image generation failed':'Generating image'}</div>`}
  if(item.type==='fileChange'){for(const ch of item.changes||[]){const path=ch.path||ch.filePath||'Changed file';state.changes.set(path,ch)}}
  if(item.type==='collabAgentToolCall'||item.type==='subAgentActivity')updateSideTasks(item)
  if(follow)scrollBottom();
}
function activityGroupExpansionKey(activity){const threadId=state.active?.id,turnId=activity.closest('[data-turn-id]')?.dataset.turnId,anchor=activity.dataset.activityGroupAnchor;return threadId&&turnId&&anchor?`codex-webui-activity-group:${threadId}:${turnId}:${anchor}`:null}
function savedActivityGroupExpansion(activity){const key=activityGroupExpansionKey(activity),saved=key&&localStorage.getItem(key);return saved==='open'?true:saved==='closed'?false:null}
function setActivityGroupOpen(activity,open,persist=false){const button=activity.querySelector('.activity-summary'),items=activity.querySelector('.activity-items');button.classList.toggle('open',open);items.classList.toggle('open',open);if(persist&&!activity.classList.contains('single')){const key=activityGroupExpansionKey(activity);if(key)localStorage.setItem(key,open?'open':'closed')}}
function ensureActivity(turnId,root,itemId,standalone=false){const turn=ensureTurnTimeline(turnId,root),stream=turn.querySelector('.turn-event-stream'),existing=itemId?turn.querySelector(`[data-item-id="${CSS.escape(String(itemId))}"]`)?.closest('[data-agent-activity-group]'):null;if(existing)return existing;let activity=standalone?null:state.activities.get(turnId);if(!activity?.isConnected||activity.parentElement!==stream||stream.lastElementChild!==activity||activity.dataset.standalone==='true'){activity=document.createElement('div');activity.className='activity-group active';activity.dataset.agentActivityGroup='';activity.dataset.activityGroupAnchor=String(itemId||'activity');if(standalone)activity.dataset.standalone='true';activity.innerHTML=`<button class="activity-summary open"><span class="activity-summary-icon" aria-hidden="true"></span><span class="activity-summary-copy loading-shimmer">Working</span>${icons.chevron}</button><div class="activity-items open"></div>`;activity.querySelector('.activity-summary').onclick=()=>setActivityGroupOpen(activity,!activity.querySelector('.activity-summary').classList.contains('open'),true);stream.append(activity);state.activities.set(turnId,activity)}if(!state.activityItems.has(turnId))state.activityItems.set(turnId,new Map);return activity}
function joinActivityText(value){if(typeof value==='string')return value;if(Array.isArray(value))return value.filter(part=>typeof part==='string').join('\n');return''}
function activityOutput(item){if(item.type==='reasoning')return joinActivityText(item.summary)||joinActivityText(item.content);const output=item.aggregatedOutput??item.output?.aggregatedOutput??item.output;if(typeof output==='string')return output;if(Array.isArray(output))return output.join('\n');return joinActivityText(item.content)||(item.result?JSON.stringify(item.result,null,2):'')}
function commandText(item){return item.command||(item.commandActions||[]).map(action=>action?.command).filter(Boolean).join('\n')||''}
function commandExitCode(item){return item.exitCode??item.output?.exitCode}
function commandFooter(item,data){if(data.active)return{label:'',icon:''};if(item.executionStatus==='interrupted'||item.status==='interrupted'||item.status==='cancelled')return{label:'Stopped',icon:''};const exitCode=commandExitCode(item);if(data.tone==='error')return{label:exitCode==null?'Failed':`Exit code ${exitCode}`,icon:''};return{label:'Success',icon:icons.check}}
function renderCommandShell(out,item,data){if(out.dataset.outputKind!=='command'){out.dataset.outputKind='command';out.className='activity-output command-shell-wrap';out.innerHTML='<div class="command-shell"><div class="command-shell-body"><div class="command-shell-command"><span aria-hidden="true">$</span><code></code></div><div class="command-shell-output"><pre></pre></div></div><div class="command-shell-footer"></div></div>'}const output=activityOutput(item),pre=out.querySelector('.command-shell-output pre'),footer=commandFooter(item,data);out.querySelector('.command-shell-command code').textContent=commandText(item);pre.textContent=output||(data.active?'':'No output');pre.classList.toggle('empty',!output);out.querySelector('.command-shell-footer').innerHTML=`${footer.icon}<span>${footer.label}</span>`}
function inlineFileChangeDiff(change){const raw=unifiedDiffFromFileChanges([change]),review=parseUnifiedDiff(raw);if(!review.hasChanges){const diff=change.diff||change.unified_diff||'';return diff?`<pre>${escapeHtml(diff)}</pre>`:''}return `<div class="file-change-inline-diff">${review.files.flatMap(file=>file.hunks.map(hunk=>`<div class="file-change-inline-hunk"><div class="review-hunk-head">${escapeHtml(hunk.header)}</div><div class="review-lines">${hunk.lines.map(reviewLineHtml).join('')}</div></div>`)).join('')}</div>`}
function renderFileChangeOutput(out,item,data){out.dataset.outputKind='file-change';out.className='activity-output file-change-output';const changes=item.changes||[],legacy=activityOutput(item);if(!changes.length){out.innerHTML=`<div class="file-change-progress ${data.active?'loading-shimmer':''}">${escapeHtml(legacy||(data.active?'Waiting for patch details…':'No patch details'))}</div>`;return}out.innerHTML=changes.map(change=>{const path=change.path||change.filePath||'Changed file',kind=typeof change.kind==='string'?change.kind:change.kind?.type||'update';return `<section class="file-change-output-item"><div class="file-change-output-head">${codexIcon('fileDiff')}<span>${escapeHtml(shortPath(path))}</span><small>${escapeHtml(kind)}</small></div>${inlineFileChangeDiff(change)}</section>`}).join('')}
function isExplorationActivity(item,data=summarizeActivity(item)){return item.type==='commandExecution'&&['read','search','list'].includes(data.category)}
function renderActivityOutput(out,item,data){if(item.type==='imageView'){out.dataset.outputKind='image';out.className='activity-output activity-image-output';out.innerHTML=renderItemImages(item,{cwd:imageCwd(item),className:'activity-image-grid'})||'<div class="message-image-unavailable" data-i18n-ui>Image unavailable</div>';return}if(item.type==='commandExecution'&&data.category==='command'){renderCommandShell(out,item,data);return}if(item.type==='fileChange'){renderFileChangeOutput(out,item,data);return}if(item.type==='reasoning'){const text=activityOutput(item);out.dataset.outputKind='reasoning';out.className='activity-output reasoning-output message-text';out.innerHTML=text?renderAssistantMarkdown(text,{cwd:imageCwd(item)}):'';return}out.dataset.outputKind='plain';out.className='activity-output';out.textContent=isExplorationActivity(item,data)?'':activityOutput(item)||''}
function activityItemExpansionKey(row){const threadId=state.active?.id,turnId=row.closest('[data-turn-id]')?.dataset.turnId,itemId=row.dataset.itemId;return threadId&&turnId&&itemId?`codex-webui-activity-item:${threadId}:${turnId}:${itemId}`:null}
function savedActivityItemExpansion(row){const key=activityItemExpansionKey(row),saved=key&&localStorage.getItem(key);return saved==='open'?true:saved==='closed'?false:null}
function setActivityExpanded(row,expanded,persist=false){row.classList.toggle('expanded',expanded);row.setAttribute('aria-expanded',String(expanded));if(persist){const key=activityItemExpansionKey(row);if(key)localStorage.setItem(key,expanded?'open':'closed')}}
function motionIcon(name){return `<span class="activity-motion" data-animation="${name}"></span>`}
async function mountMotion(row,name){const holder=row.querySelector('.activity-motion');if(!holder)return;state.motion.get(row)?.destroy();try{const animationData=await fetch(`/assets/codex-motion/${name}.json`).then(r=>r.json());if(!holder.isConnected)return;const animation=lottie.loadAnimation({container:holder,renderer:'svg',loop:true,autoplay:true,animationData,rendererSettings:{preserveAspectRatio:'xMidYMid meet'}});state.motion.set(row,animation)}catch{holder.innerHTML=codexIcon('loaderCircle','motion-fallback')}}
function activityIconName(item,data=summarizeActivity(item)){if(item.type==='reasoning')return null;if(data.tone==='error')return'triangleAlert';if(item.type==='fileChange')return'fileDiff';if(data.category==='image')return'image';if(data.category==='read')return'file';if(data.category==='search'||item.type==='webSearch')return'search';if(data.category==='list')return'list';if(data.category==='command')return'terminal';return'wrench'}
function stopMotion(row,tone){const animation=state.motion.get(row);animation?.destroy();state.motion.delete(row);const holder=row.querySelector('.activity-motion'),turnId=row.closest('[data-turn-id]')?.dataset.turnId,item=state.activityItems.get(turnId)?.get(row.dataset.itemId),data=item?summarizeActivity(item):{tone};if(!holder)return;const icon=activityIconName(item||{},data);holder.innerHTML=icon?codexIcon(icon):''}
function activityItemId(item){return String(item.id||item.callId||item.requestId||`${item.type}-${Date.now()}`)}
function joinActivityParts(parts){return parts.length<2?parts[0]||'Worked':`${parts.slice(0,-1).join(', ')} and ${parts.at(-1)}`}
function completedActivitySummary(items){const summaries=items.map(item=>({item,data:summarizeActivity(item)})),commands=summaries.filter(({item,data})=>item.type==='commandExecution'&&data.category==='command').length,explored=summaries.some(({data})=>['read','search','list'].includes(data.category)&&data.tone!=='error'),edits=summaries.filter(({item,data})=>item.type==='fileChange'&&data.tone!=='error').reduce((count,{item})=>count+Math.max(1,item.changes?.length||0),0),web=summaries.some(({item,data})=>item.type==='webSearch'&&data.tone!=='error'),images=summaries.some(({data})=>data.category==='image'&&data.tone!=='error'),failed=summaries.some(({data})=>data.tone==='error'),parts=[],add=(leading,following)=>parts.push(parts.length?following:leading);if(edits)add(edits===1?'Edited a file':'Edited files',edits===1?'edited a file':'edited files');if(explored)add('Read files','read files');if(commands)add(commands===1?'Ran a command':'Ran commands',commands===1?'ran a command':'ran commands');if(web)add('Searched the web','searched the web');if(images)add('Viewed images','viewed images');if(!parts.length&&failed)return'Activity failed';return joinActivityParts(parts)}
function completedActivityPrimaryItem(items){const summaries=items.map(item=>({item,data:summarizeActivity(item)})),find=predicate=>summaries.find(predicate)?.item;return find(({item,data})=>item.type==='fileChange'&&data.tone!=='error')||find(({data})=>['read','search','list'].includes(data.category)&&data.tone!=='error')||find(({data})=>data.category==='command'&&data.tone!=='error')||find(({item,data})=>item.type==='webSearch'&&data.tone!=='error')||find(({data})=>data.category==='image'&&data.tone!=='error')||items.find(item=>summarizeActivity(item).tone==='error')||items[0]}
function setActivitySummaryIcon(activity,item){const holder=activity.querySelector('.activity-summary-icon'),icon=item&&activityIconName(item);if(holder){holder.hidden=!icon;holder.innerHTML=icon?codexIcon(icon):''}}
function commandRowSummary(item,data,expanded){if(data.active)return data.label;const interrupted=item.executionStatus==='interrupted'||item.status==='interrupted'||item.status==='cancelled',command=commandText(item);if(expanded)return interrupted?'Stopped command':'Ran command';return`${interrupted?'Stopped':'Ran'}${command?` ${command}`:' command'}`}
function updateCommandRowSummary(row,item,data,expanded=row.classList.contains('expanded')){const summary=row.querySelector('.activity-name');if(summary)summary.textContent=commandRowSummary(item,data,expanded)}
function updateActivitySummary(activity){const turn=activity.closest('[data-turn-id]'),turnId=turn?.dataset.turnId,allItems=state.activityItems.get(turnId),rows=[...activity.querySelectorAll('.activity-item')],items=rows.map(row=>allItems?.get(row.dataset.itemId)).filter(Boolean),summary=activity.querySelector('.activity-summary-copy');if(!turn||!summary)return;activity.classList.toggle('single',items.length===1);const activeItem=items.findLast?.(item=>summarizeActivity(item).active)||[...items].reverse().find(item=>summarizeActivity(item).active),savedOpen=savedActivityGroupExpansion(activity);if(activeItem){const data=summarizeActivity(activeItem);setActivitySummaryIcon(activity,activeItem);summary.textContent=data.label;summary.classList.add('loading-shimmer');activity.classList.add('active');setActivityGroupOpen(activity,items.length===1||(savedOpen??true))}else{setActivitySummaryIcon(activity,completedActivityPrimaryItem(items));summary.textContent=completedActivitySummary(items);summary.classList.remove('loading-shimmer');activity.classList.remove('active');setActivityGroupOpen(activity,items.length===1||(savedOpen??false))}syncWorkedForDivider(turnId)}
function addActivity(item,activity,id=activityItemId(item)){const data=summarizeActivity(item),turn=activity.closest('[data-turn-id]'),turnId=turn.dataset.turnId,items=state.activityItems.get(turnId)||new Map,box=activity.querySelector('.activity-items');items.set(id,item);state.activityItems.set(turnId,items);let row=box.querySelector(`[data-item-id="${CSS.escape(id)}"]`);if(!row){row=document.createElement('div');row.className='activity-item entering';row.dataset.itemId=id;box.append(row);const out=document.createElement('div');out.className='activity-output';box.append(out)}const imageView=item.type==='imageView',reasoning=item.type==='reasoning',command=item.type==='commandExecution'&&data.category==='command',fileChange=item.type==='fileChange',wasActive=row.dataset.activityWasActive==='true',savedExpanded=savedActivityItemExpansion(row),existingExpanded=row.dataset.expansionInitialized?row.classList.contains('expanded'):imageView,expanded=reasoning?(data.active?true:wasActive?false:(savedExpanded??existingExpanded)):(savedExpanded??existingExpanded);row.dataset.expansionInitialized='true';row.dataset.activityWasActive=String(data.active);row.className=`activity-item ${command?'command-activity ':''}${reasoning?'reasoning-activity ':''}${imageView?'image-activity ':''}${fileChange?'file-change-activity ':''}${data.active?'active':'settled'} ${data.tone}`;if(command){state.motion.get(row)?.destroy();state.motion.delete(row);row.innerHTML=`<span class="activity-command-icon">${icons.terminal}</span><div class="activity-copy"><div class="activity-name ${data.active?'loading-shimmer':''}">${escapeHtml(commandRowSummary(item,data,expanded))}</div></div><span class="activity-command-chevron">${icons.chevron}</span>`}else if(reasoning){state.motion.get(row)?.destroy();state.motion.delete(row);row.innerHTML=`<div class="activity-copy"><div class="activity-name ${data.active?'loading-shimmer':''}">${escapeHtml(data.label)}</div></div><span class="activity-reasoning-chevron">${icons.chevron}</span>`}else{const detail=shortPath(data.detail||'');row.innerHTML=`${motionIcon(data.animation)}<div class="activity-copy"><div class="activity-name ${data.active?'loading-shimmer':''}"><span class="activity-label">${escapeHtml(data.label)}</span>${detail?` <span class="activity-detail">${escapeHtml(detail)}</span>`:''}</div></div><span class="activity-result">${fileChange?icons.chevron:''}</span>`}const out=row.nextElementSibling;renderActivityOutput(out,item,data);const reasoningOutput=reasoning&&!!activityOutput(item),expandable=imageView||command||fileChange||(reasoning&&!data.active&&reasoningOutput)||(!reasoning&&!isExplorationActivity(item,data)&&!!activityOutput(item));if(reasoning&&data.active&&reasoningOutput){row.removeAttribute('role');row.removeAttribute('aria-expanded');row.tabIndex=-1;row.classList.add('expanded')}else if(expandable){row.setAttribute('role','button');row.tabIndex=0;setActivityExpanded(row,expanded)}else{row.removeAttribute('role');row.removeAttribute('aria-expanded');row.tabIndex=-1;row.classList.remove('expanded')}row.onclick=expandable?()=>{const next=!row.classList.contains('expanded');setActivityExpanded(row,next,true);if(command)updateCommandRowSummary(row,item,data,next)}:null;row.onkeydown=expandable?event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();row.click()}}:null;if(!command&&!reasoning){if(data.active)mountMotion(row,data.animation);else stopMotion(row,data.tone)}updateActivitySummary(activity)}
function diffForTurn(turnId){return state.turnDiffs.get(turnId)||null}
function recordTurnReview(turnId,raw,source='fileChange'){if(!turnId||!raw)return null;const existing=state.turnDiffs.get(turnId);if(source!=='native'&&existing?.source==='native')return existing;const review=parseUnifiedDiff(raw);if(!review.hasChanges)return null;review.turnId=turnId;review.raw=raw;review.source=source;state.turnDiffs.set(turnId,review);state.activeReview=review;return review}
function syncTurnReviewFromItems(turnId){const items=state.activityItems.get(turnId),changes=items?[...items.values()].flatMap(item=>item?.type==='fileChange'&&Array.isArray(item.changes)?item.changes:[]):[],raw=unifiedDiffFromFileChanges(changes);if(raw)recordTurnReview(turnId,raw)}
function reviewLineHtml(line){if(!line)return '<div class="review-line empty"><span class="review-sign"></span><code></code></div>';return `<div class="review-line ${line.type}"><span class="review-sign">${line.type==='add'?'+':line.type==='delete'?'−':' '}</span><code>${escapeHtml(line.text)}</code></div>`}
function applyTerminalInteraction(p){const itemId=String(p.itemId),current=state.activityItems.get(p.turnId)?.get(itemId);if(current?.type!=='commandExecution')return;let buffer=current.terminalInputBuffer||'',commands=[];for(const char of String(p.stdin||'')){if(char==='\r'||char==='\n'){const command=buffer.trim();if(command)commands.push(command);buffer='';continue}if(char==='\u0003'){buffer='';continue}if(char==='\b'||char==='\u007f'){buffer=buffer.slice(0,-1);continue}buffer+=char}const actions=[...(current.commandActions||[]),...commands.map(command=>({type:'unknown',command}))];upsertItem({...current,status:'inProgress',terminalInputBuffer:buffer,commandActions:actions},p.turnId)}

function onNotification(method,p){
  if(method==='skills/changed'){void loadSkillsCatalog(true);return}
  if(method==='turn/completed')dismissPendingApprovals(p.threadId||state.active?.id,p.turn?.id);
  if(method==='item/completed')dismissPendingApprovals(p.threadId||state.active?.id,p.turnId,p.item?.id);
  if(method==='thread/tokenUsage/updated'){
    const threadId=p.threadId||state.active?.id;
    if(threadId&&p.tokenUsage)state.tokenUsage.set(threadId,normalizeTokenUsage(p.tokenUsage));
    if(threadId===state.active?.id)renderContextUsage();
    return;
  }
  // app-server broadcasts all threads to every tab/device; track sidebar status for background threads,
  // but only render conversation items for the currently selected thread.
  if(p.threadId&&p.threadId!==state.active?.id&&(method.startsWith('item/')||method.startsWith('turn/')||method==='error')){
    if(method==='turn/started')setRunPhase(p.threadId,'waiting',{turnId:p.turn?.id,event:true});
    else if(method.startsWith('item/')){
      const bgRun=threadRuns.get(p.threadId),bgThread=state.threads.find(x=>x.id===p.threadId);
      if(RUNNING_PHASES.has(bgRun?.phase)||bgThread?.status?.type==='active'||bgThread?.liveActive||method==='item/started'){
        const phase=method==='item/completed'?'waiting':p.item?itemRunPhase(p.item):method.startsWith('item/reasoning/')?'thinking':method.startsWith('item/agentMessage/')?'responding':method.startsWith('item/fileChange/')?'editing':'running';
        setRunPhase(p.threadId,phase,{turnId:p.turnId||p.turn?.id,event:true});
      }
    }
    else if(method==='turn/completed'){
      rememberTurnStatus(p.turn);
      const phase=p.turn?.status==='failed'?'failed':p.turn?.status==='interrupted'?'stopped':'completed';
      setRunPhase(p.threadId,phase,{turnId:p.turn?.id,event:true,unread:phase==='completed',durationMs:turnDurationMs(p.turn)});
      maybeNotifyTaskCompleted(p);void loadRateLimits();
    }
    else if(method==='error'&&p.willRetry===false){
      if(p.turnId)turnStatusById.set(p.turnId,{status:'failed',error:p.error?.message||p.message||'Codex error'});
      setRunPhase(p.threadId,'failed',{turnId:p.turnId,error:p.error?.message||p.message||'Codex error',event:true});
    }
    if(method==='turn/completed'||method==='turn/started')refreshThreadsSoon();
    return;
  }
  const eventTurn=p.turnId||p.turn?.id,currentTurn=!activeTurnId()||!eventTurn||eventTurn===activeTurnId();
  const observedRun=threadRuns.get(state.active?.id),knownRunning=!!activeTurnId()||RUNNING_PHASES.has(observedRun?.phase)||(pendingSubmission?.threadId===state.active?.id&&!!pendingSubmission);
  // History hydration can emit item/completed after a terminal snapshot; it must
  // not resurrect an already-finished run as "waiting" or "running".
  if(method.startsWith('item/')&&currentTurn&&knownRunning){
    const phase=method==='item/completed'?'waiting':p.item?itemRunPhase(p.item):method.startsWith('item/reasoning/')?'thinking':method.startsWith('item/agentMessage/')?'responding':method.startsWith('item/fileChange/')?'editing':'running';
    setRunPhase(state.active?.id,phase,{turnId:eventTurn,event:true});
  }
  if(method==='account/updated'){loadAccount(true);void loadRateLimits();void loadLoginStatus()}
  else if(method==='account/login/completed'){
    state.login.loginId='';state.login.pending=null;closeLoginDialog();renderLoginState();
    if(p.success){if(Date.now()-state.login.signedInAt>5000)toast(t('Signed in to ChatGPT'));state.login.signedInAt=Date.now();void loadAccount(true);void loadLoginStatus()}
    else toast(t('Sign-in failed: {message}',{message:p.error||'Unknown error'}));
    return;
  }
  else if(method==='account/rateLimits/updated')applyRateLimits(p.rateLimits||p);
  else if(method==='thread/started'){state.threads.unshift(p.thread);renderThreads()}
  else if(method==='thread/name/updated'){const t=state.threads.find(x=>x.id===p.threadId);if(t)t.name=p.name;renderThreads();renderHeader()}
  else if(method==='turn/started'){setActiveTurnId(p.turn?.id||'');setRunPhase(state.active?.id,'waiting',{turnId:p.turn?.id,event:true});scheduleActiveThreadSync(0)}
  else if(method==='item/started')upsertItem({...p.item,status:'inProgress'},p.turnId);
  else if(method==='item/completed'){const status=['failed','declined','interrupted','cancelled','canceled'].includes(p.item?.status)?p.item.status:'completed';upsertItem({...p.item,status},p.turnId)}
  else if(method==='item/agentMessage/delta')renderAgentDelta(p);
  else if(method==='item/reasoning/summaryPartAdded')upsertReasoningDelta(p,null);
  else if(method==='item/reasoning/summaryTextDelta')upsertReasoningDelta(p,'summary');
  else if(method==='item/reasoning/textDelta')upsertReasoningDelta(p,'content');
  else if(method==='item/commandExecution/outputDelta'){const turn=state.turns.get(p.turnId),row=turn?.querySelector(`[data-item-id="${CSS.escape(p.itemId)}"]`),item=state.activityItems.get(p.turnId)?.get(String(p.itemId));if(item)item.aggregatedOutput=(item.aggregatedOutput||'')+(p.delta||'');if(row){const target=row.nextElementSibling.querySelector('.command-shell-output pre')||row.nextElementSibling;target.textContent=(target.classList.contains('empty')?'':target.textContent||'')+(p.delta||'');target.classList.remove('empty')}}
  else if(method==='item/commandExecution/terminalInteraction')applyTerminalInteraction(p)
  else if(method==='item/fileChange/outputDelta'){const itemId=String(p.itemId),current=state.activityItems.get(p.turnId)?.get(itemId),item=current?.type==='fileChange'?{...current,status:'inProgress'}:{id:itemId,type:'fileChange',status:'inProgress',changes:[]};item.aggregatedOutput=(item.aggregatedOutput||'')+(p.delta||'');upsertItem(item,p.turnId)}
  else if(method==='item/fileChange/patchUpdated'){const itemId=String(p.itemId),current=state.activityItems.get(p.turnId)?.get(itemId),item=current?.type==='fileChange'?{...current,status:'inProgress',changes:p.changes||[]}:{id:itemId,type:'fileChange',status:'inProgress',changes:p.changes||[]};upsertItem(item,p.turnId)}
  else if(method==='turn/completed'){
    rememberTurnStatus(p.turn);
    if(currentTurn){setActiveTurnId('');setRunPhase(state.active?.id,p.turn?.status==='failed'?'failed':p.turn?.status==='interrupted'?'stopped':'completed',{turnId:p.turn?.id,event:true,durationMs:turnDurationMs(p.turn),...p.turn?.error?.message?{error:p.turn.error.message}:{}})}
    if(p.turn?.items)for(const i of p.turn.items)upsertItem(i,p.turn.id);
    if(p.turn?.id)syncWorkedForDivider(p.turn.id,turnDurationMs(p.turn));
    maybeNotifyTaskCompleted(p);scheduleActiveThreadSync(0);refreshThreadsSoon();void loadRateLimits();
  }
  else if(method==='thread/status/changed'){
    const targetThread=state.threads.find(x=>x.id===p.threadId);
    if(targetThread)targetThread.status=p.status;
    if(p.threadId===state.active?.id){state.active.status=p.status;scheduleActiveThreadSync(0)}
    renderThreads();refreshThreadsSoon();
  }
  else if(method==='error'){const error=p.error?.message||p.message||'Codex error';if(p.willRetry===false&&p.turnId){turnStatusById.set(p.turnId,{status:'failed',error});refreshUserRetries()}setRunPhase(state.active?.id,p.willRetry===false?'failed':'waiting',{turnId:p.turnId,error,event:true});if(p.willRetry===false)setActiveTurnId('');toast(error)}
}
function renderAgentDelta(p){
  const root=$('#conversation'),follow=root.scrollHeight-root.scrollTop-root.clientHeight<80;
  let el=state.items.get(p.itemId);if(!el){upsertItem({id:p.itemId,type:'agentMessage',text:''},p.turnId);el=state.items.get(p.itemId)}
  const body=el.querySelector('.message-text');body.dataset.raw=(body.dataset.raw||'')+(p.delta||'');
  if(pendingMarkdownFrames.has(body))return;
  pendingMarkdownFrames.set(body,requestAnimationFrame(()=>{pendingMarkdownFrames.delete(body);if(!body.isConnected)return;body.innerHTML=renderAssistantMarkdown(body.dataset.raw,{cwd:imageCwd()});messageActions.enhanceCodeBlocks(body);messageActions.updateMessageCopy(el,()=>agentMessageText({text:body.dataset.raw||''}));if(follow)scrollBottom()}));
}
function upsertReasoningDelta(p,field){const itemId=String(p.itemId),items=state.activityItems.get(p.turnId),current=items?.get(itemId),item=current?.type==='reasoning'?{...current,status:'inProgress'}:{id:itemId,type:'reasoning',status:'inProgress',summary:[],content:[]};if(field){const index=field==='summary'?(p.summaryIndex??0):(p.contentIndex??0),parts=Array.isArray(item[field])?[...item[field]]:[];while(parts.length<=index)parts.push('');parts[index]=(parts[index]||'')+(p.delta||'');item[field]=parts}upsertItem(item,p.turnId)}
function setApprovalWaiting(group,itemId,waiting){if(!group)return;const row=itemId?group.querySelector(`[data-item-id="${CSS.escape(itemId)}"]`):null,summary=group.querySelector('.activity-summary-copy');group.classList.toggle('waiting-approval',waiting);if(waiting){summary.textContent='Waiting for approval';summary.classList.remove('loading-shimmer');if(row){row.querySelector('.activity-name')?.classList.remove('loading-shimmer');state.motion.get(row)?.pause()}}else{if(row){row.querySelector('.activity-name')?.classList.add('loading-shimmer');state.motion.get(row)?.play()}updateActivitySummary(group)}}
function approvalIcon(kind){return kind==='network'?codexIcon('globe'):kind==='patch'?codexIcon('fileDiff'):kind==='permission'?codexIcon('shield'):codexIcon('terminal')}
function approvalBody(model,p){if(model.kind==='exec'||model.kind==='network')return `<div class="approval-command"><code>${escapeHtml(p.command||model.title)}</code></div>`;if(model.kind==='patch')return '';return permissionRows(p.permissions).map(row=>`<div class="permission-row"><span>${escapeHtml(row.label)}</span><code>${escapeHtml(shortPath(row.value))}</code></div>`).join('')}
function restorePendingApprovals(){for(const req of pendingApprovals.values())if(req.params?.threadId===state.active?.id)onServerRequest(req)}
function dismissPendingApprovals(threadId,turnId,itemId){for(const [id,req]of pendingApprovals){const p=req.params||{};if(p.threadId===threadId&&p.turnId===turnId&&(!itemId||p.itemId===itemId)){pendingApprovals.delete(id);state.requestCards.get(id)?.remove();state.requestCards.delete(id)}}}
async function onServerRequest(req){const p=req.params||{};if(['item/commandExecution/requestApproval','item/fileChange/requestApproval','item/permissions/requestApproval'].includes(req.method)){pendingApprovals.set(req.id,req);if(p.threadId&&p.threadId!==state.active?.id){setRunPhase(p.threadId,'approval',{turnId:p.turnId,event:true});renderThreads();return}if(state.requestCards.get(req.id)?.isConnected)return}if(!['item/commandExecution/requestApproval','item/fileChange/requestApproval','item/permissions/requestApproval'].includes(req.method)){void respondToCodex(req.id,null,{code:-32601,message:'Unsupported request'}).catch(error=>{if(!error?.silentTransportSwitch)toast(error.message)});return}const group=ensureActivity(p.turnId||'approval',$('#conversation'),p.itemId),model=buildApprovalModel(req),card=document.createElement('section');card.className='approval-card';card.dataset.codexApprovalSurface='';card.innerHTML=`<div class="approval-content"><div class="approval-identity">${approvalIcon(model.kind)}<span>${escapeHtml(model.identity)}</span></div><div class="approval-title">${escapeHtml(model.title)}</div>${model.subtitle?`<div class="approval-subtitle">${escapeHtml(shortPath(model.subtitle))}</div>`:''}${model.reason?`<div class="approval-reason"><span>Reason</span><p>${escapeHtml(model.reason)}</p></div>`:''}</div><div class="approval-body">${approvalBody(model,p)}</div><form class="approval-actions">${model.leading?`<button type="button" class="approval-leading">${escapeHtml(model.leading.label)}</button>`:''}<div class="approval-actions-main"><button type="button" class="approval-deny">${escapeHtml(model.deny.label)}</button>${model.scoped?`<div class="approval-split"><button type="submit" class="approval-primary" autofocus>${escapeHtml(model.primary.label)}</button><button type="button" class="approval-menu-toggle" aria-label="Approval options" aria-expanded="false">${codexIcon('chevronDown')}</button><div class="approval-menu" hidden><button type="button" class="approval-scoped">${escapeHtml(model.scoped.label)}</button></div></div>`:`<button type="submit" class="approval-primary" autofocus>${escapeHtml(model.primary.label)}</button>`}</div></form>`;group.after(card);state.requestCards.set(req.id,card);setApprovalWaiting(group,p.itemId,true);setRunPhase(state.active?.id,'approval',{turnId:p.turnId,event:true});const answer=async(decision)=>{const threadId=p.threadId||state.active?.id;setRunPhase(threadId,'waiting',{turnId:p.turnId,event:true});setApprovalWaiting(group,p.itemId,decision!==model.deny.decision);card.querySelectorAll('button').forEach(b=>b.disabled=true);try{await respondToCodex(req.id,model.kind==='permission'?decision:{decision});pendingApprovals.delete(req.id);card.remove();state.requestCards.delete(req.id)}catch(error){card.querySelectorAll('button').forEach(b=>b.disabled=false);setRunPhase(threadId,'approval',{turnId:p.turnId,error:error.message});if(!error?.silentTransportSwitch)toast(error.message)}};card.querySelector('form').onsubmit=e=>{e.preventDefault();answer(model.primary.decision)};card.querySelector('.approval-deny').onclick=()=>answer(model.deny.decision);card.querySelector('.approval-scoped')?.addEventListener('click',()=>answer(model.scoped.decision));card.querySelector('.approval-leading')?.addEventListener('click',()=>answer(model.leading.decision));const menuToggle=card.querySelector('.approval-menu-toggle'),menu=card.querySelector('.approval-menu');menuToggle?.addEventListener('click',()=>{const open=menu.hidden;menu.hidden=!open;menuToggle.setAttribute('aria-expanded',String(open))});scrollBottom()}
const slashCommandCatalog=[
  {id:'model',title:'Model',description:'Choose model and reasoning effort',icon:'wrench'},
  {id:'plan',title:'Plan mode',description:'Turn plan mode on',icon:'list'},
  {id:'project',title:'Project',description:'Choose project for new tasks',icon:'folderOpen'},
  {id:'reasoning',title:'Reasoning',description:'Choose reasoning effort',icon:'wrench'},
  {id:'init',title:'Init',description:'Create an AGENTS.md file with instructions for Codex',icon:'file'},
  {id:'mcp',title:'MCP',description:'Show MCP server status',icon:'wrench'},
  {id:'compact',title:'Compact',description:"Compact this task's context",icon:'list',requiresThread:true},
  {id:'status',title:'Status',description:'Show task id, context usage, and rate limits',icon:'info',requiresThread:true},
];
function closeComposerAutocomplete(){const menu=$('#composerAutocomplete');autocompleteState.requestId++;menu.hidden=true;menu.replaceChildren();delete menu.dataset.type;autocompleteState.match=null;autocompleteState.items=[];autocompleteState.selected=0;autocompleteState.message=''}
function renderComposerAutocomplete(){
  const menu=$('#composerAutocomplete'),items=autocompleteState.items,isMention=autocompleteState.match?.type==='mention';
  menu.innerHTML='';menu.dataset.type=autocompleteState.match?.type||'';
  menu.setAttribute('aria-label',autocompleteState.match?.type==='slash'?'Slash command menu':'Mention menu');
  if(isMention&&items.length){
    const header=document.createElement('div');header.className='autocomplete-header';
    header.innerHTML=`<span>${escapeHtml(items.length===1?t('1 match'):t('{count} matches',{count:items.length}))}</span><kbd>Tab / Enter</kbd>`;
    menu.append(header);
  }
  if(!items.length){
    const empty=document.createElement('div');empty.className='autocomplete-empty';
    empty.textContent=autocompleteState.message||(isMention?'Type to search for files':'No commands');
    menu.append(empty);
  }else for(const[index,item]of items.entries()){
    const button=document.createElement('button');button.type='button';
    button.className='autocomplete-item'+(index===autocompleteState.selected?' selected':'');
    button.dataset.autocompleteId=item.id;button.role='option';button.setAttribute('aria-selected',String(index===autocompleteState.selected));
    const isFileItem=item.source==='file'||item.source==='folder';
    const prefix=isFileItem&&item.prefix?`<span class="autocomplete-path-prefix">${escapeHtml(item.prefix)}</span>`:'';
    const suffix=item.source==='folder'?'<span class="autocomplete-path-prefix">/</span>':'';
    button.innerHTML=`${codexIcon(item.icon||'file')}<span class="autocomplete-copy"><strong class="autocomplete-title">${prefix}${escapeHtml(item.title)}${suffix}</strong><small class="autocomplete-description">${escapeHtml(item.description)}</small></span>`;
    button.onpointerdown=event=>event.preventDefault();button.onclick=()=>selectComposerAutocomplete(index);menu.append(button);
  }
  menu.hidden=false;
  menu.querySelector('.autocomplete-item.selected')?.scrollIntoView?.({block:'nearest'});
}
function currentComposerCwd(){if(state.projectless&&!state.active)return'';const path=state.active?.cwd||state.cwd||state.config.defaultCwd;return path.startsWith('~')?state.config.home+path.slice(1):path}
async function searchMentionSuggestions(match){
  const query=match.query.trim(),requestId=++autocompleteState.requestId,cwd=currentComposerCwd();
  const tasks=query?state.threads.filter(thread=>titleOf(thread).toLowerCase().includes(query.toLowerCase())).slice(0,5).map(thread=>({id:`task:${thread.id}`,source:'task',threadId:thread.id,title:titleOf(thread),description:`Task · ${shortPath(thread.cwd)}`,icon:'messageSquare'})):[];
  if(!cwd){
    autocompleteState.items=[{id:'choose-project',source:'action',title:'Choose project',description:'Select a project to mention files',icon:'folderOpen'},...tasks];
    autocompleteState.selected=0;autocompleteState.message=state.projectless&&!state.active?'Choose a project to mention files':'Type to search for files';
    renderComposerAutocomplete();return;
  }
  if(!query){
    autocompleteState.items=[];
    autocompleteState.message='Type to search for files';
    renderComposerAutocomplete();
  }
  try{
    const response=await fetch(`/api/files/search?cwd=${encodeURIComponent(cwd)}&query=${encodeURIComponent(query)}`,{cache:'no-store'}),data=await response.json();
    if(!response.ok)throw new Error(data.error||'File search unavailable');
    if(requestId!==autocompleteState.requestId||autocompleteState.match?.type!=='mention'||autocompleteState.match.query!==match.query)return;
    const files=(data.items||[]).map(item=>{
      const parts=item.path.split('/'),name=parts.at(-1)||item.path,prefix=parts.length>1?`${parts.slice(0,-1).join('/')}/`:'';
      return{id:`${item.kind}:${item.path}`,source:item.kind,type:item.kind,path:item.path,title:name,prefix,description:parts.length>1?parts.slice(0,-1).join('/'):(item.kind==='folder'?'Folder':'File'),icon:item.kind==='folder'?'folderOpen':'file'};
    });
    autocompleteState.items=[...files,...tasks];autocompleteState.selected=0;
    autocompleteState.message=autocompleteState.items.length?'':(query?'No files or tasks found':'Type to search for files');
    renderComposerAutocomplete();
  }catch(error){
    if(requestId!==autocompleteState.requestId)return;
    autocompleteState.items=tasks;autocompleteState.message=tasks.length?'':error.message;
    renderComposerAutocomplete();
  }
}
function updateComposerAutocomplete(){
  const input=$('#prompt'),cursor=input.selectionStart??input.value.length,match=getComposerAutocomplete(input.value,cursor);
  if(!match){closeComposerAutocomplete();return}
  autocompleteState.match=match;autocompleteState.selected=0;
  if(match.type==='slash'||match.type==='skill'){
    if(skillsState.cwd!==(currentComposerCwd()||state.config.defaultCwd||'.'))void loadSkillsCatalog().then(()=>{if(autocompleteState.match===match&&skillsState.cwd)updateComposerAutocomplete()});
    autocompleteState.requestId++;
    const query=match.query.trim().toLowerCase();
    const commands=match.type==='skill'?[]:slashCommandCatalog.filter(item=>(!item.requiresThread||state.active)&&(item.id.includes(query)||item.title.toLowerCase().includes(query)));
    const skillItems=query||match.type==='skill'?skillsState.skills.filter(s=>s.enabled!==false&&(s.name.toLowerCase().includes(query)||skillDisplayTitle(s).toLowerCase().includes(query))).slice(0,8).map(s=>({
      id:`skill:${s.path}`,
      source:'skill',
      type:'skill',
      name:s.name,
      path:s.path,
      title:`/${s.name}`,
      description:`${t(s.category==='official'?'Official':'Personal')} Skill · ${skillShortDescription(s)||s.name}`,
      icon:'sparkles',
    })):[];
    autocompleteState.items=[...commands,...skillItems];
    autocompleteState.message='';
    renderComposerAutocomplete();
    return;
  }
  searchMentionSuggestions(match);
}
function moveComposerAutocomplete(delta){if(!autocompleteState.items.length)return;autocompleteState.selected=(autocompleteState.selected+delta+autocompleteState.items.length)%autocompleteState.items.length;renderComposerAutocomplete()}
function setPlanMode(active){state.planMode=Boolean(active);refreshComposerPlaceholder();syncPermissionControl()}
function applyAutocompleteToken(match,replacement){const input=$('#prompt'),result=applyComposerSuggestion(input.value,match,replacement);input.value=result.text;input.setSelectionRange(result.cursor,result.cursor);resizePrompt()}
function renderContextTray(){
  const tray=$('#composerContextTray');tray.replaceChildren();
  const removeChip=(listName,id)=>()=>{state[listName]=state[listName].filter(item=>item.id!==id);renderContextTray();syncComposerSubmitState();saveActiveDraft()};
  for(const mention of state.composerMentions){const chip=document.createElement('div');chip.className='composer-context-chip';chip.dataset.contextId=mention.id;chip.innerHTML=`${codexIcon(mention.icon||'file')}<span></span><button type="button">${codexIcon('x')}</button>`;chip.querySelector('span').textContent=mention.title||'';chip.querySelector('button').setAttribute('aria-label',`Remove ${mention.title||'context'}`);chip.querySelector('button').onclick=removeChip('composerMentions',mention.id);tray.append(chip)}
  for(const attachment of state.composerAttachments){const chip=document.createElement('div'),preview=inlineImageUrl(attachment),name=attachment.relativePath||attachment.filename||'Image';chip.className=`composer-context-chip${preview?' composer-image-chip':''}`;chip.dataset.contextId=attachment.id;if(attachment.relativePath)chip.dataset.attachmentPath=attachment.relativePath;if(preview){const image=document.createElement('img');image.src=preview;image.alt=attachment.filename||'Image';chip.append(image)}else chip.insertAdjacentHTML('beforeend',codexIcon(attachment.isImage?'image':'paperclip'));const label=document.createElement('span');label.textContent=name;const remove=document.createElement('button');remove.type='button';remove.innerHTML=codexIcon('x');remove.setAttribute('aria-label',`Remove ${attachment.filename||'attachment'}`);remove.onclick=removeChip('composerAttachments',attachment.id);chip.append(label,remove);tray.append(chip)}
  tray.hidden=!state.composerMentions.length&&!state.composerAttachments.length;
}
function selectComposerAutocomplete(index=autocompleteState.selected){const item=autocompleteState.items[index],match=autocompleteState.match;if(!item||!match)return;const id=item.id;if(item.source==='action'&&id==='choose-project'){closeComposerAutocomplete();openFolderPicker()}else if(item.source==='skill'){applyAutocompleteToken(match,'');closeComposerAutocomplete();attachSkillToComposer({name:item.name,path:item.path})}else if(item.source==='file'||item.source==='folder'){const isDirectory=item.source==='folder';applyAutocompleteToken(match,formatFileMention(item.path,{isDirectory,quoted:match.quoted}));if(!state.composerMentions.some(mention=>mention.id===item.id))state.composerMentions.push({...item,type:item.source});renderContextTray();saveActiveDraft();if(isDirectory)updateComposerAutocomplete();else closeComposerAutocomplete()}else if(item.source==='task'){applyAutocompleteToken(match,`@${item.title}`);if(!state.composerMentions.some(mention=>mention.id===item.id))state.composerMentions.push({...item});renderContextTray();saveActiveDraft();closeComposerAutocomplete()}else{if(id==='init')applyAutocompleteToken(match,'/init');closeComposerAutocomplete();if(id==='plan'){setPlanMode(!state.planMode);$('#prompt').value='';resizePrompt()}else if(id==='model'){ $('#prompt').value='';resizePrompt();openModelMenu()}else if(id==='reasoning'){ $('#prompt').value='';resizePrompt();openModelMenu()}else if(id==='project'){ $('#prompt').value='';resizePrompt();openFolderPicker()}else if(id==='mcp'){ $('#prompt').value='';resizePrompt();toast('MCP status requires the native desktop status surface.')}else if(id==='compact'){ $('#prompt').value='';resizePrompt();saveActiveDraft();void compactActiveThread()}else if(id==='status'){ $('#prompt').value='';resizePrompt();const quota=[quotaWindowSummaryLabel(state.rateLimits?.primary),quotaWindowSummaryLabel(state.rateLimits?.secondary)].filter(Boolean).join(' · ');toast([state.active?.id?`Task ${state.active.id}`:'No active task',quota].filter(Boolean).join(' · '))}}requestAnimationFrame(()=>$('#prompt').focus())}
function handlePromptInput(){resizePrompt();saveActiveDraft();updateComposerAutocomplete()}
function handlePromptKeydown(event){if(event.isComposing||promptComposing||event.keyCode===229)return;const open=!$('#composerAutocomplete').hidden;if(open){if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();moveComposerAutocomplete(event.key==='ArrowDown'?1:-1);return}if((event.key==='Enter'&&!event.shiftKey)||event.key==='Tab'){event.preventDefault();selectComposerAutocomplete();return}if(event.key==='Escape'){event.preventDefault();closeComposerAutocomplete();return}}if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();$('#composer').requestSubmit()}}
async function resumeActiveThread(thread=state.active){if(!thread)return null;const resumed=await rpc('thread/resume',{threadId:thread.id});if(state.active?.id===thread.id){state.active={...state.active,...resumed.thread};renderHeader()}return resumed}
function conversationDisplayText(text,mentions,attachments,inputItems){
  const fileLabels=attachments.filter(item=>!(item?.isImage||item?.kind==='image')).map(item=>`@${item.relativePath||item.filename}`);
  return textFromInput(inputItems)||text||[...mentions.filter(m=>m.type==='skill').map(m=>`/${m.name}`),...fileLabels].filter(Boolean).join(' ');
}
async function deliverConversationInput({text='',mentions=[],attachments=[],inputItems=null,displayText='',steerTurnId='',clearComposer=false}={}){
  mentions=[...mentions];attachments=[...attachments];
  inputItems=inputItems||buildConversationInput({text,mentions,attachments});
  displayText=displayText||conversationDisplayText(text,mentions,attachments,inputItems);
  const payload={text,mentions,attachments,inputItems,displayText};
  const turnId=steerTurnId||'';
  if(pendingSubmission)return;
  if(!turnId&&state.active?.id&&!selectedModel()){toast(t('The model for this chat is no longer configured. Restore its provider or start a new chat.'));return}
  const epoch=conversationEpoch,model=state.selectedModel,effort=$('#effortSelect').value;
  let target=state.active,optimisticId=null,acceptedTurn=turnId||null,responseTurn=null;
  const cwd=target?.cwd||state.cwd||state.config.defaultCwd||state.config.home,projectless=state.projectless,draftKeyId=target?.id||null,draftCwd=currentDraftCwd();
  const threadPolicy=permissionThreadPolicy(),turnPolicy=permissionTurnPolicy(cwd);
  const operation={epoch,selectionId:target?.id||null,threadId:target?.id||null,phase:'preparing',startedAt:Date.now()};
  pendingSubmission=operation;localRun=null;refreshUserRetries();
  const current=()=>conversationEpoch===epoch&&(state.active?.id||null)===operation.selectionId;
  const restoreInput=()=>{
    if(!clearComposer)return;
    if(!current()){
      const key=draftStorageKey(target?.id||draftKeyId,draftCwd),existing=readThreadDraft(target?.id||draftKeyId,draftCwd),restored=[...attachments,...(existing.attachments||[])];
      inlineDraftImages.set(key,restored.filter(item=>typeof item?.data==='string'));
      writeThreadDraft(target?.id||draftKeyId,draftCwd,{text:existing.text?`${text}\n\n${existing.text}`:text,mentions:[...mentions,...(existing.mentions||[])],attachments:restored});
      return;
    }
    const input=$('#prompt');
    input.value=input.value?`${text}\n\n${input.value}`:text;state.composerMentions=[...mentions,...state.composerMentions];state.composerAttachments=[...attachments,...state.composerAttachments];renderContextTray();resizePrompt();saveActiveDraft();
  };
  const showBubble=Boolean(displayText||attachments.some(item=>item?.isImage||item?.kind==='image'||inlineImageUrl(item)));
  if(clearComposer){$('#prompt').value='';state.composerMentions=[];state.composerAttachments=[];inlineDraftImages.delete(draftStorageKey(draftKeyId,draftCwd));writeThreadDraft(draftKeyId,draftCwd,{text:'',mentions:[],attachments:[]});renderContextTray()}
  if(showBubble){optimisticId=`local-${Date.now()}`;$('#conversation').querySelectorAll('.conversation-loading').forEach(node=>node.remove());upsertItem({id:optimisticId,type:'userMessage',content:userContentFromInput(displayText,attachments)},turnId||'optimistic');const el=state.items.get(optimisticId);if(el){userPayloads.set(el,payload);if(turnId)el.dataset.turnId=turnId}scrollBottom()}
  if(target&&!turnId)setRunPhase(target.id,'preparing',{startedAt:operation.startedAt});
  resizePrompt();renderRuntimeBar();
  try{
    if(!target){
      const created=await rpc('thread/start',{cwd,model,...threadPolicy,sessionStartSource:'startup'});
      target={...created.thread,projectless};operation.threadId=target.id;
      if(current()){
        const typedWhileStarting=readThreadDraft(null,draftCwd);
        if(typedWhileStarting.text||typedWhileStarting.mentions?.length||typedWhileStarting.attachments?.length){
          writeThreadDraft(target.id,draftCwd,typedWhileStarting);
          writeThreadDraft(null,draftCwd,{text:'',mentions:[],attachments:[]});
        }
      }
      state.threads=state.threads.filter(thread=>thread.id!==target.id);state.threads.unshift(target);
      if(current()){state.active=target;operation.selectionId=target.id;rememberActiveThread(target.id);renderHeader();renderThreads();renderContextUsage()}
    }else if(target.canAcceptDirectInput!==true){
      const resumed=await resumeActiveThread(target);target={...target,...resumed?.thread};
    }
    operation.phase='sending';renderRuntimeBar();
    if(!turnId)setRunPhase(target.id,'sending',{startedAt:operation.startedAt});
    const params={threadId:target.id,input:inputItems.length?inputItems:[{type:'text',text:displayText||text}]};
    let result;
    if(turnId){
      try{result=await rpc('turn/steer',{...params,expectedTurnId:turnId})}
      catch(error){if(bridgeErrorCode(error)!==THREAD_NOT_FOUND)throw error;await resumeActiveThread(target);result=await rpc('turn/steer',{...params,expectedTurnId:turnId})}
    }else{
      result=await rpc('turn/start',{...params,model,effort,cwd:target.cwd||cwd,...turnPolicy});
    }
    acceptedTurn=result?.turn?.id||result?.turnId||turnId;responseTurn=result?.turn;
    const run=threadRuns.get(target.id);
    if(!run||['preparing','sending'].includes(run.phase))setRunPhase(target.id,'waiting',{turnId:acceptedTurn,startedAt:operation.startedAt,event:true});
    if(current()&&acceptedTurn&&!['completed','failed','stopped'].includes(run?.phase)&&(!result?.turn?.status||result.turn.status==='inProgress'))setActiveTurnId(acceptedTurn);
    if(optimisticId){const el=state.items.get(optimisticId);if(el){delete el.dataset.sendFailed;delete el.dataset.sendError;if(acceptedTurn){el.dataset.turnId=String(acceptedTurn);if(target?.id)turnPayloads.set(`${target.id}:${acceptedTurn}`,payload)}userPayloads.set(el,payload);syncUserRetry(el)}}
    if(current())scheduleActiveThreadSync(0);
  }catch(error){
    const raw=threadInputErrorMessage(error),message=t(raw);
    const el=current()&&optimisticId?state.items.get(optimisticId):null;
    if(el?.isConnected){el.dataset.sendFailed='true';el.dataset.sendError=raw;userPayloads.set(el,payload);syncUserRetry(el)}
    else if(clearComposer&&(text||attachments.length||mentions.length))restoreInput();
    if(target){
      if(turnId)setRunPhase(target.id,'waiting',{turnId,error:message});
      else setRunPhase(target.id,'failed',{startedAt:operation.startedAt,error:message});
    }else localRun={...operation,phase:'failed',endedAt:Date.now(),error:message};
    if(!error?.silentTransportSwitch)toast(message,5200);
  }finally{
    if(pendingSubmission===operation)pendingSubmission=null;
    if(current()&&target){
      const snapshot=state.active?.turns?.find(turn=>turn.id===acceptedTurn);
      if(snapshot)syncTurnRuntime(snapshot);
      else if(responseTurn&&responseTurn.status!=='inProgress')syncTurnRuntime(responseTurn);
      activeThreadSyncSignature='';scheduleActiveThreadSync(0);
    }
    syncComposerSubmitState();renderRuntimeBar();refreshUserRetries();
  }
}
async function submitPrompt(event){
  event.preventDefault();
  const text=$('#prompt').value.trim(),turnId=activeTurnId(),hasAttachments=state.composerAttachments.length>0||state.composerMentions.some(m=>m.type==='skill');
  if(turnId&&!text&&!hasAttachments){await interruptActiveTurn();return}
  if(pendingSubmission)return;
  closeComposerAutocomplete();closePermissionMenu();
  if(!text&&!hasAttachments&&!turnId)return;
  const mentions=state.composerMentions.slice(),attachments=state.composerAttachments.slice();
  const inputItems=buildConversationInput({text,mentions,attachments});
  await deliverConversationInput({text,mentions,attachments,inputItems,displayText:conversationDisplayText(text,mentions,attachments,inputItems),steerTurnId:turnId,clearComposer:true});
}
function threadSummarySignature(threads){return JSON.stringify(threads.map(thread=>[thread.id,thread.updatedAt,thread.recencyAt,thread.status,thread.liveActive,thread.liveLastTurnId,thread.liveLastTurnStatus]))}
function applyThreadSummaries(threads){
  const hadPrevious=state.threadsLoaded,previousById=new Map(state.threads.map(thread=>[thread.id,thread])),previousOrder=state.threads.map(thread=>thread.id);
  const nextSignature=threadSummarySignature(threads),changed=nextSignature!==threadListSignature;
  threadListSignature=nextSignature;
  if(hadPrevious){
    const incomingById=new Map(threads.map(thread=>[thread.id,thread]));
    const newThreads=threads.filter(thread=>!previousById.has(thread.id));
    const keptThreads=previousOrder.map(id=>incomingById.get(id)).filter(Boolean);
    state.threads=[...newThreads,...keptThreads];
  }else{
    state.threads=threads;
  }
  for(const thread of state.threads){
    const prev=previousById.get(thread.id),run=threadRuns.get(thread.id),wasRunning=Boolean(prev?.status?.type==='active'||prev?.liveActive||RUNNING_PHASES.has(run?.phase)),nowRunning=Boolean(thread.status?.type==='active'||thread.liveActive);
    if(!nowRunning&&RUNNING_PHASES.has(run?.phase)&&pendingSubmission?.threadId!==thread.id&&![...pendingApprovals.values()].some(req=>req.params?.threadId===thread.id)){
      const terminalPhase=thread.liveLastTurnStatus==='failed'?'failed':thread.liveLastTurnStatus==='interrupted'?'stopped':'completed';
      setRunPhase(thread.id,terminalPhase,{turnId:thread.liveLastTurnId||run?.turnId,unread:terminalPhase==='completed'&&thread.id!==state.active?.id});
    }else if(hadPrevious&&wasRunning&&!nowRunning&&thread.id!==state.active?.id&&thread.liveLastTurnStatus==='completed'){
      unreadCompletedThreads.add(thread.id);
    }
  }
  const summary=state.active&&state.threads.find(thread=>thread.id===state.active.id);
  if(summary){const turns=state.active.turns;state.active={...state.active,...summary,turns};if(summary.status?.type==='active'||summary.liveActive)scheduleActiveThreadSync(0)}
  if(changed)renderThreads();
}
function scheduleThreadListRefresh(delay=THREAD_LIST_POLL_MS){clearTimeout(threadListTimer);threadListTimer=setTimeout(refreshThreadList,document.visibilityState==='hidden'?Math.max(delay,8000):delay)}
async function refreshThreadList(){if(threadListInFlight){scheduleThreadListRefresh(1000);return}threadListInFlight=true;try{const result=await rpc('thread/list',{limit:50,sortKey:'recency_at',sortDirection:'desc'});applyThreadSummaries(result.data||[])}catch{}finally{threadListInFlight=false;scheduleThreadListRefresh()}}
function refreshThreadsSoon(){scheduleThreadListRefresh(600)}
function resetActiveThreadSync(){activeThreadSyncGeneration++;clearTimeout(activeThreadSyncTimer);activeThreadSyncTimer=null;activeThreadSyncSignature=''}
function scheduleActiveThreadSync(delay=ACTIVE_THREAD_SYNC_IDLE_MS){clearTimeout(activeThreadSyncTimer);if(!state.active)return;activeThreadSyncTimer=setTimeout(syncActiveThread,document.visibilityState==='hidden'?Math.max(delay,6000):delay)}
async function latestThreadTurn(threadId){try{const live=await rpc('host/thread/live',{threadId});if(live?.tokenUsage){state.tokenUsage.set(threadId,normalizeTokenUsage(live.tokenUsage));if(state.active?.id===threadId)renderContextUsage()}if(live?.active&&live.turn)return live.turn}catch{}try{const result=await rpc('thread/turns/list',{threadId,limit:1,sortDirection:'desc',itemsView:'full'});return result.data?.[0]||null}catch{const result=await rpc('thread/read',{threadId,includeTurns:true});return result.thread?.turns?.at(-1)||null}}
function activeTurnId(){return $('#sendButton')?.dataset.turnId||''}
async function interruptActiveTurn(){
  const threadId=state.active?.id,turnId=activeTurnId();if(!threadId||!turnId)return;
  const key=`${threadId}:${turnId}`;if(interruptingTurns.has(key))return;
  interruptingTurns.add(key);setRunPhase(threadId,'stopping',{turnId});syncComposerSubmitState();
  try{await rpc('turn/interrupt',{threadId,turnId})}
  catch(error){setRunPhase(threadId,'waiting',{turnId,error:t(threadInputErrorMessage(error))});if(!error?.silentTransportSwitch)toast(t(threadInputErrorMessage(error)),5200)}
  finally{interruptingTurns.delete(key);syncComposerSubmitState();if(state.active?.id===threadId)scheduleActiveThreadSync(0)}
}
function syncComposerSubmitState(){const button=$('#sendButton');if(!button)return;const hasInput=Boolean($('#prompt').value.trim()||state.composerAttachments.length||state.composerMentions.some(m=>m.type==='skill')),stopping=activeTurnId()&&!hasInput,interrupting=interruptingTurns.has(`${state.active?.id}:${activeTurnId()}`);button.disabled=stopping?interrupting:!!pendingSubmission;$('#composer').setAttribute('aria-busy',String(!!pendingSubmission||interrupting));const mode=activeTurnId()?(hasInput?'steer':'stop'):'send',label=mode==='stop'?'Stop':mode==='steer'?'Steer':'Send message';button.dataset.submitMode=mode;button.classList.toggle('stop',mode==='stop');button.classList.toggle('steer',mode==='steer');button.innerHTML=codexIcon(mode==='stop'?'square':'arrowUp');button.title=t(label);button.setAttribute('aria-label',t(label))}
function setActiveTurnId(turnId=''){const button=$('#sendButton');if(!button)return;button.dataset.turnId=turnId||'';syncComposerSubmitState();renderRuntimeBar();refreshUserRetries()}
function syncTurnRuntime(turn){
  rememberTurnStatus(turn);
  const threadId=state.active?.id;if(!threadId||!turn)return;
  const active=turn.status==='inProgress',previous=threadRuns.get(threadId);
  if(active){
    setActiveTurnId(turn.id);
    const item=[...(turn.items||[])].reverse().find(item=>item.status==='inProgress');
    const awaitingApproval=[...pendingApprovals.values()].some(req=>req.params?.threadId===threadId&&req.params?.turnId===turn.id);
    const phase=awaitingApproval?'approval':item?itemRunPhase(item):previous?.turnId===turn.id&&RUNNING_PHASES.has(previous.phase)?previous.phase:'waiting';
    const startedAt=Number.isFinite(turn.startedAt)?turn.startedAt*1000:undefined;
    setRunPhase(threadId,phase,{turnId:turn.id,...startedAt?{startedAt}: {}});
  }else if(['completed','failed','interrupted'].includes(turn.status)){
    if(pendingSubmission?.threadId===threadId)return;
    if(activeTurnId()===turn.id)setActiveTurnId('');
    if(!previous||previous.turnId===turn.id)setRunPhase(threadId,turn.status==='completed'?'completed':turn.status==='interrupted'?'stopped':'failed',{turnId:turn.id,durationMs:turnDurationMs(turn)});
  }
}
function syncTurnSnapshot(turn,threadId=state.active?.id){if(!turn||!threadId||threadId!==state.active?.id)return false;const root=$('#conversation'),nearBottom=root.scrollHeight-root.scrollTop-root.clientHeight<80,turns=state.active.turns||[],index=turns.findIndex(existing=>existing.id===turn.id);if(index<0)turns.push(turn);else turns[index]=turn;state.active.turns=turns;root.querySelectorAll('.conversation-loading').forEach(node=>node.remove());renderTurn(turn,root);syncTurnRuntime(turn);if(nearBottom)scrollBottom();return true}
async function syncActiveThread(){if(activeThreadSyncInFlight||!state.active){scheduleActiveThreadSync();return}const generation=activeThreadSyncGeneration,threadId=state.active.id;activeThreadSyncInFlight=true;let nextDelay=ACTIVE_THREAD_SYNC_IDLE_MS;try{const turn=await latestThreadTurn(threadId);if(generation!==activeThreadSyncGeneration||threadId!==state.active?.id)return;if(turn){const signature=JSON.stringify(turn);nextDelay=turn.status==='inProgress'?ACTIVE_THREAD_SYNC_ACTIVE_MS:ACTIVE_THREAD_SYNC_IDLE_MS;if(signature!==activeThreadSyncSignature){activeThreadSyncSignature=signature;syncTurnSnapshot(turn,threadId)}}}catch{}finally{activeThreadSyncInFlight=false;if(generation===activeThreadSyncGeneration&&threadId===state.active?.id)scheduleActiveThreadSync(nextDelay)}}
function resizePrompt(){const e=$('#prompt');e.style.height='auto';e.style.height=Math.min(190,e.scrollHeight)+'px';syncComposerSubmitState()}
function scrollBottom(){requestAnimationFrame(()=>{$('#conversation').scrollTop=$('#conversation').scrollHeight})}
function scrollOpenedThreadToBottom(){const root=$('#conversation'),apply=()=>{root.scrollTop=root.scrollHeight};requestAnimationFrame(()=>{apply();requestAnimationFrame(apply)})}
function formatAge(ts){const s=Math.max(0,Date.now()/1000-ts);if(s<60)return'now';if(s<3600)return Math.floor(s/60)+'m';if(s<86400)return Math.floor(s/3600)+'h';return new Date(ts*1000).toLocaleDateString(undefined,{month:'short',day:'numeric'})}
function escapeHtml(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function toast(text,duration=2200){const e=$('#toast');e.textContent=text;e.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>e.classList.remove('show'),duration)}
function syncSummaryPanel(){const workspace=state.projectless?'No project':($('#projectName').textContent||'Local workspace');$('#summaryWorkspace').textContent=workspace;$('#summaryBranch').textContent=state.projectless?'':state.active?.source==='remote'?'Remote workspace':'Local workspace'}
function overlayPanelsEnabled(){return matchMedia('(max-width:1200px)').matches}
function rightPanelWidthLimits(){
  const overlay=overlayPanelsEnabled(),sidebar=$('#sidebar');
  // Read the CSS target, not the in-flight 0px -> 275px opening animation.
  const targetSidebarWidth=sidebar?parseFloat(getComputedStyle(sidebar).getPropertyValue('--sidebar-w')):0;
  const sidebarWidth=overlay||document.body.classList.contains('sidebar-hidden')?0:Number.isFinite(targetSidebarWidth)?targetSidebarWidth:sidebar?.getBoundingClientRect().width||0;
  return calculatePanelWidthLimits({viewportWidth:innerWidth,sidebarWidth,overlay});
}
function applyRightPanelWidth(value){
  const limits=rightPanelWidthLimits(),width=Math.round(clampPanelWidth(value,limits));appliedRightPanelWidth=width;
  document.documentElement.style.setProperty('--right-panel-width',`${width}px`);
  for(const handle of document.querySelectorAll('.right-panel-resize-handle')){handle.setAttribute('aria-valuemin',String(limits.min));handle.setAttribute('aria-valuemax',String(limits.max));handle.setAttribute('aria-valuenow',String(width));handle.setAttribute('aria-valuetext',`${width}px`)}
}
function syncRightPanelWidth(){
  const skills=document.body.classList.contains('side-panel-open')&&document.body.classList.contains('skills-panel-open');
  const fallback=overlayPanelsEnabled()?560:skills?Math.min(innerWidth*.42,560):340;
  applyRightPanelWidth(preferredRightPanelWidth??fallback);
}
function setOverlayBackgroundInert(inert){for(const selector of ['.topbar','.sidebar','.conversation-shell','.bottom-panel']){const node=$(selector);if(node)node.inert=inert}}
function focusPanel(panel,closeButton){if(!overlayPanelsEnabled())return;setOverlayBackgroundInert(true);panel.setAttribute('aria-modal','true');requestAnimationFrame(()=>closeButton.focus())}
function restorePanelFocus(panel,target){panel.setAttribute('aria-modal','false');if(!document.body.classList.contains('side-panel-open')&&!document.body.classList.contains('summary-panel-open'))setOverlayBackgroundInert(false);if(overlayPanelsEnabled()&&target?.isConnected)requestAnimationFrame(()=>target.focus())}
function syncOverlayPanelMode(){const overlay=overlayPanelsEnabled(),sideOpen=document.body.classList.contains('side-panel-open'),summaryOpen=document.body.classList.contains('summary-panel-open');setOverlayBackgroundInert(overlay&&(sideOpen||summaryOpen));$('#sidePanel').setAttribute('aria-modal',String(overlay&&sideOpen));$('#summaryPanel').setAttribute('aria-modal',String(overlay&&summaryOpen));if(overlay){const panel=summaryOpen?$('#summaryPanel'):sideOpen?$('#sidePanel'):null,close=summaryOpen?$('#closeSummaryPanel'):sideOpen?$('#closeSidePanel'):null;if(panel&&close&&!panel.contains(document.activeElement))requestAnimationFrame(()=>close.focus())}}
function setSidebarOpen(open,{manual=false}={}){
  const sidebar=$('#sidebar'),mobile=mobileSidebarEnabled(),visible=Boolean(open);
  if(manual)sidebarManualState=visible;
  document.body.classList.toggle('sidebar-hidden',!mobile&&!visible);
  sidebar.classList.toggle('mobile-open',mobile&&visible);
  $('#toggleSidebar').setAttribute('aria-expanded',String(visible));
  $('#toggleSidebar').setAttribute('aria-pressed',String(visible));
  syncRightPanelWidth();
  for(const terminalState of Object.values(terminalStates))requestAnimationFrame(()=>fitTerminal(terminalState));
}
function syncSidebarLayout(){
  const mobile=mobileSidebarEnabled();
  if(mobile===sidebarLayoutMobile)return;
  sidebarLayoutMobile=mobile;
  setSidebarOpen(sidebarManualState!==null?sidebarManualState:!mobile);
}
function setBrowserStatus(text,tone='ready'){const status=$('#browserStatus');status.dataset.tone=tone;$('#browserStatusText').textContent=text}
function updateBrowserControls(){const current=browserState.history[browserState.index]||'';$('#browserBack').disabled=browserState.index<=0;$('#browserForward').disabled=browserState.index<0||browserState.index>=browserState.history.length-1;$('#browserRefresh').disabled=!current;for(const link of [$('#browserOpenExternal'),$('#browserNoticeExternal')]){link.hidden=!current;if(current)link.href=current}}
function showBrowserNotice(title,description){$('#browserNoticeTitle').textContent=title;$('#browserNoticeDescription').textContent=description;$('#browserNotice').hidden=false;$('#browserLoading').hidden=true;$('#browserFrameShell').setAttribute('aria-busy','false');setBrowserStatus(title,'error')}
function finishBrowserLoad(requestId){if(requestId!==browserState.loadRequest)return;clearTimeout(browserState.loadTimer);$('#browserLoading').hidden=true;$('#browserNotice').hidden=true;$('#browserFrameShell').setAttribute('aria-busy','false');setBrowserStatus('Loaded. If the page is blank, the site may block embedding.','loaded')}
function navigateBrowser(value,{push=true}={}){const result=normalizeBrowserUrl(value);if(result.error){showBrowserNotice('Invalid address',result.error);$('#browserUrl').setAttribute('aria-invalid','true');return false}const url=result.url;$('#browserUrl').removeAttribute('aria-invalid');$('#browserUrl').value=url;if(push&&browserState.history[browserState.index]!==url){browserState.history=browserState.history.slice(0,browserState.index+1);browserState.history.push(url);browserState.index=browserState.history.length-1}const requestId=++browserState.loadRequest,frame=$('#browserFrame');clearTimeout(browserState.loadTimer);$('#browserEmpty').hidden=true;$('#browserNotice').hidden=true;$('#browserLoading').hidden=false;frame.hidden=false;frame.setAttribute('sandbox',browserSandboxFor(url,location.href));$('#browserFrameShell').setAttribute('aria-busy','true');setBrowserStatus('Loading page...','loading');updateBrowserControls();frame.onload=()=>finishBrowserLoad(requestId);frame.onerror=()=>requestId===browserState.loadRequest&&showBrowserNotice('Page could not be loaded','The site did not complete the embedded request. Open it externally to continue.');frame.src=url;browserState.loadTimer=setTimeout(()=>{if(requestId===browserState.loadRequest)showBrowserNotice('Page may have blocked embedding','This site did not finish loading in the panel. It may block embedded browsers; you can open it externally instead.')},10000);return true}
function moveBrowserHistory(delta){const next=browserState.index+delta;if(next<0||next>=browserState.history.length)return;browserState.index=next;navigateBrowser(browserState.history[next],{push:false});updateBrowserControls()}
function openBrowserPanel(){const tab=$('#utilityTab');tab.textContent='Browser';tab.dataset.sidePanelTab='browser';tab.hidden=false;setSidePanelOpen(true,false);setSidePanelView('browser','Browser');updateBrowserControls();if(browserState.index<0&&!overlayPanelsEnabled())requestAnimationFrame(()=>$('#browserUrl').focus())}
function defaultSidePanelTarget(){
  const utilityKind=$('#utilityTab')?.dataset.sidePanelTab;
  if(!$('#utilityTab')?.hidden&&utilityKind&&utilityKind!=='utility')return[utilityKind,$('#utilityTab').textContent];
  if(fileBrowserState.preview)return['files',fileBrowserState.preview.filename||t('File preview')];
  return['files',t('File preview')];
}
function setSidePanelView(view,title){document.body.classList.toggle('skills-panel-open',view==='skills');const launcher=view==='launcher',files=view==='files',skills=view==='skills',utility=view==='utility',browser=view==='browser',terminal=view==='terminal',sideTask=view==='side-task';$('#sideTerminalControls').hidden=!terminal;$('#sidePanelLauncher').hidden=!launcher;$('#filesPanel').hidden=!files;if($('#skillsPanel'))$('#skillsPanel').hidden=!skills;$('#browserPanel').hidden=!browser;$('#sideTerminalPanel').hidden=!terminal;$('#sideTaskPanel').hidden=!sideTask;$('#utilityPanelContent').hidden=!utility;if(files){const tab=$('#utilityTab');tab.textContent=fileBrowserState.preview?.filename||title||t('File preview');tab.dataset.sidePanelTab='files';tab.hidden=false}if(skills){const tab=$('#utilityTab');tab.textContent=title||skillDisplayTitle(skillsState.selected)||t('Skills');tab.dataset.sidePanelTab='skills';tab.hidden=false}for(const tab of document.querySelectorAll('.side-panel-tab')){const selected=tab.dataset.sidePanelTab===view;tab.classList.toggle('active',selected);tab.setAttribute('aria-selected',String(selected))}$('#newTab').hidden=!launcher;if(files||skills||utility||browser||terminal||sideTask)$('#utilityTab').hidden=false;$('#sidePanelTitle').textContent=title||(launcher?'New tab':$('#utilityTab').textContent);syncRightPanelWidth();if(terminal)requestAnimationFrame(()=>{initializeTerminal(terminalStates.side);fitTerminal(terminalStates.side);terminalStates.side.term?.focus()});if(sideTask)renderSideTasks();if(!terminal&&overlayPanelsEnabled()&&document.body.classList.contains('side-panel-open'))requestAnimationFrame(()=>$('#closeSidePanel').focus())}
function openUtilityPanel(kind){if(kind==='browser'){openBrowserPanel();return}if(kind==='files'){openFilesPanel();return}const tab=$('#utilityTab');if(kind==='terminal'){tab.textContent='Terminal';tab.dataset.sidePanelTab='terminal';setSidePanelOpen(true,false);setSidePanelView('terminal','Terminal');return}if(kind==='side-task'){tab.textContent='Side tasks';tab.dataset.sidePanelTab='side-task';setSidePanelOpen(true,false);setSidePanelView('side-task','Side tasks');return}const labels={files:['Files','folderOpen','Choose or switch the local project folder available to this WebUI.']},entry=labels[kind];if(!entry)return;const[title,icon,description]=entry;tab.textContent=title;tab.dataset.sidePanelTab='utility';$('#utilityPanelTitle').textContent=title;$('#utilityPanelDescription').textContent=description;$('#utilityPanelIcon').innerHTML=codexIcon(icon);const action=$('#utilityPanelAction');action.hidden=false;action.textContent='Choose project folder';action.onclick=openFolderPicker;setSidePanelOpen(true,false);setSidePanelView('utility',title)}
function setSidePanelOpen(open,reset=true){const panel=$('#sidePanel'),trigger=$('#toggleSidePanel'),wasOpen=!panel.hidden;if(open){setSummaryPanelOpen(false);if(!wasOpen){sidePanelReturnFocus=document.activeElement instanceof HTMLElement?document.activeElement:trigger;panel.hidden=false;document.body.classList.add('side-panel-open');trigger.setAttribute('aria-pressed','true');trigger.setAttribute('aria-expanded','true')}if(reset){const[targetView,targetTitle]=defaultSidePanelTarget();setSidePanelView(targetView,targetTitle)}if(!wasOpen)focusPanel(panel,$('#closeSidePanel'))}else{panel.hidden=true;document.body.classList.remove('side-panel-open','review-split-open');trigger.setAttribute('aria-pressed','false');trigger.setAttribute('aria-expanded','false');restorePanelFocus(panel,sidePanelReturnFocus);sidePanelReturnFocus=null}syncRightPanelWidth()}
function setSummaryPanelOpen(open){const panel=$('#summaryPanel'),trigger=$('#toggleSummaryPanel');if(open){setSidePanelOpen(false,false);summaryPanelReturnFocus=document.activeElement instanceof HTMLElement?document.activeElement:trigger;panel.hidden=false;document.body.classList.add('summary-panel-open');trigger.setAttribute('aria-pressed','true');trigger.setAttribute('aria-expanded','true');syncSummaryPanel();focusPanel(panel,$('#closeSummaryPanel'))}else{panel.hidden=true;document.body.classList.remove('summary-panel-open');trigger.setAttribute('aria-pressed','false');trigger.setAttribute('aria-expanded','false');restorePanelFocus(panel,summaryPanelReturnFocus);summaryPanelReturnFocus=null}syncRightPanelWidth()}
function closeImageViewer(){const dialog=$('#imageViewer');if(dialog.open)dialog.close()}
function openImageViewer(source,title='Image',path=''){const dialog=$('#imageViewer'),image=$('#imageViewerImage');imageViewerReturnFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;$('#imageViewerTitle').textContent=title||'Image';$('#imageViewerPath').textContent=path||title||'';$('#imageViewerError').hidden=true;image.hidden=false;image.alt=title||'';image.src=source;$('#imageViewerOriginal').href=source;if(!dialog.open)dialog.showModal();requestAnimationFrame(()=>$('#closeImageViewer').focus())}
function currentTerminalCwd(){const path=state.active?.cwd||state.cwd||state.config.defaultCwd||'.';return path.startsWith('~')?state.config.home+path.slice(1):path}
function terminalIsVisible(terminalState){const host=$(`#${terminalState.hostId}`),panel=$(`#${terminalState.panelId}`);return host&&!host.hidden&&panel&&!panel.hidden}
function fitTerminal(terminalState){const host=$(`#${terminalState.hostId}`);if(!terminalState.fit||!terminalIsVisible(terminalState)||host.clientWidth<1||host.clientHeight<1)return;try{terminalState.fit.fit()}catch{}}
function sendTerminalResize(terminalState){const ws=terminalState.ws,term=terminalState.term;if(ws?.readyState===WebSocket.OPEN&&term)ws.send(JSON.stringify({type:'resize',cols:term.cols,rows:term.rows}))}
function renderTerminalConnection(terminalState){
  if(terminalState!==terminalStates.side)return;
  const phase=terminalState.renderError?'error':terminalState.phase;
  const labels={idle:'Terminal not connected',connecting:'Connecting terminal…',connected:'Terminal connected','waiting-output':'Connected; waiting for shell output',closed:'Terminal disconnected',error:'Terminal connection or display error'};
  const label=$('#sideTerminalStatus');label.dataset.state=phase;label.textContent=t(labels[phase]||labels.idle);label.title=label.textContent+(['closed','error'].includes(phase)&&terminalState.lastCloseCode?` (${terminalState.lastCloseCode})`:'');
}
function connectTerminal(terminalState){
  if(terminalState.ws&&[WebSocket.OPEN,WebSocket.CONNECTING].includes(terminalState.ws.readyState))return;
  clearTimeout(terminalState.reconnectTimer);clearTimeout(terminalState.connectTimer);clearTimeout(terminalState.outputTimer);
  const proto=location.protocol==='https:'?'wss:':'ws:',host=$(`#${terminalState.hostId}`);let ws;
  terminalState.phase='connecting';terminalState.connectionAttempts++;terminalState.receivedBytes=0;terminalState.connectedAt=null;terminalState.lastDataAt=null;terminalState.renderError=false;host.dataset.connected='false';renderTerminalConnection(terminalState);
  try{ws=new WebSocket(`${proto}//${location.host}/terminal?cwd=${encodeURIComponent(currentTerminalCwd())}`)}catch{terminalState.phase='error';renderTerminalConnection(terminalState);return}
  terminalState.ws=ws;ws.binaryType='arraybuffer';
  terminalState.connectTimer=setTimeout(()=>{if(terminalState.ws===ws&&ws.readyState===WebSocket.CONNECTING){terminalState.phase='error';renderTerminalConnection(terminalState);ws.close()}},5000);
  ws.onopen=()=>{
    if(terminalState.ws!==ws)return;clearTimeout(terminalState.connectTimer);host.dataset.connected='true';terminalState.connectedAt=Date.now();terminalState.phase='connected';renderTerminalConnection(terminalState);
    terminalState.outputTimer=setTimeout(()=>{if(terminalState.ws===ws&&ws.readyState===WebSocket.OPEN&&!terminalState.receivedBytes){terminalState.phase='waiting-output';renderTerminalConnection(terminalState)}},3500);
    requestAnimationFrame(()=>{if(terminalState.ws!==ws)return;fitTerminal(terminalState);sendTerminalResize(terminalState);terminalState.term?.focus()});
  };
  ws.onmessage=async event=>{
    const data=event.data instanceof Blob?new Uint8Array(await event.data.arrayBuffer()):event.data instanceof ArrayBuffer?new Uint8Array(event.data):String(event.data);
    if(terminalState.ws!==ws)return;
    terminalState.lastDataAt=Date.now();terminalState.receivedBytes+=typeof data==='string'?new TextEncoder().encode(data).length:data.byteLength;clearTimeout(terminalState.outputTimer);terminalState.phase='connected';
    try{terminalState.term?.write(data)}catch{terminalState.renderError=true}
    renderTerminalConnection(terminalState);
  };
  ws.onerror=()=>{if(terminalState.ws!==ws)return;terminalState.phase='error';renderTerminalConnection(terminalState);ws.close()};
  ws.onclose=event=>{
    if(terminalState.ws!==ws)return;
    clearTimeout(terminalState.connectTimer);clearTimeout(terminalState.outputTimer);host.dataset.connected='false';terminalState.ws=null;terminalState.phase='closed';terminalState.lastCloseCode=event.code;terminalState.lastCloseReason=String(event.reason||'').slice(0,120);renderTerminalConnection(terminalState);
    if(terminalIsVisible(terminalState))terminalState.reconnectTimer=setTimeout(()=>connectTerminal(terminalState),1000);
  };
}
function reconnectSideTerminal(){
  const terminalState=terminalStates.side;
  if(!terminalState.term||!confirm(t('Reconnect this terminal? This ends the current terminal session and attached programs, but does not restart the WebUI Codex service.')))return;
  clearTimeout(terminalState.reconnectTimer);clearTimeout(terminalState.connectTimer);clearTimeout(terminalState.outputTimer);
  const old=terminalState.ws;terminalState.ws=null;if(old)old.close();
  terminalState.term.reset();connectTerminal(terminalState);
}
async function showTerminalDiagnostics(){
  const generation=terminalDiagnosticsRequestGate.next(),terminalState=terminalStates.side,host=$('#sideTerminalHost'),term=terminalState.term;
  const sampledRows=Math.min(term?.buffer.active.length||0,200);let rowsWithText=0;
  for(let i=0;i<sampledRows;i++){const row=term.buffer.active.length-sampledRows+i;if(term.buffer.active.getLine(row)?.translateToString(true).trim())rowsWithText++}
  const data={host:location.host,phase:terminalState.phase,webSocketState:terminalState.ws?.readyState??null,connectionAttempts:terminalState.connectionAttempts,receivedBytes:terminalState.receivedBytes,connectionAgeSeconds:terminalState.connectedAt===null?null:Math.round((Date.now()-terminalState.connectedAt)/1000),secondsSinceData:terminalState.lastDataAt===null?null:Math.round((Date.now()-terminalState.lastDataAt)/1000),lastCloseCode:terminalState.lastCloseCode,lastCloseReason:terminalState.lastCloseReason,renderError:terminalState.renderError,appTheme:document.documentElement.dataset.theme,terminalForeground:term?.options.theme?.foreground,terminalBackground:term?.options.theme?.background,cols:term?.cols,rows:term?.rows,sampledRows,rowsWithText,hostWidth:host.clientWidth,hostHeight:host.clientHeight,xtermStylesLoaded:[...document.styleSheets].some(sheet=>sheet.href?.endsWith('/vendor/xterm/xterm.css')),visible:document.visibilityState,focused:host.contains(document.activeElement),httpAuthenticated:'checking'};
  const text=$('#terminalDiagnosticsText'),dialog=$('#terminalDiagnosticsDialog');text.textContent=JSON.stringify(data,null,2);if(!dialog.open)dialog.showModal();
  try{const response=await fetch('/api/auth/status',{cache:'no-store',signal:AbortSignal.timeout(3000)});data.httpAuthenticated=response.ok?Boolean((await response.json()).authenticated):'unavailable'}catch{data.httpAuthenticated='unavailable'}
  if(dialog.open&&terminalDiagnosticsRequestGate.isCurrent(generation))text.textContent=JSON.stringify(data,null,2);
}
function copyTerminalDiagnostics(){
  const input=document.createElement('textarea');input.value=$('#terminalDiagnosticsText').textContent;input.readOnly=true;input.style.cssText='position:fixed;left:0;top:0;width:1px;height:1px;opacity:0';$('#terminalDiagnosticsDialog').append(input);input.select();input.setSelectionRange(0,input.value.length);
  let copied=false;try{copied=document.execCommand('copy')}catch{}finally{input.remove();$('#copyTerminalDiagnostics').focus()}
  toast(t(copied?'Diagnostics copied':'Select and copy the diagnostics below'));
}
function initializeTerminal(terminalState){if(terminalState.term){connectTerminal(terminalState);requestAnimationFrame(()=>fitTerminal(terminalState));return}const dark=matchMedia('(prefers-color-scheme:dark)').matches,host=$(`#${terminalState.hostId}`),term=new Terminal({cursorBlink:true,cursorStyle:'block',fontFamily:'ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, monospace',fontSize:12,lineHeight:1.2,scrollback:5000,theme:dark?{background:'#181818',foreground:'#f2f2f2',cursor:'#f2f2f2',selectionBackground:'#3b4a5a'}:{background:'#ffffff',foreground:'#0d0d0d',cursor:'#0d0d0d',selectionBackground:'#c8dcf4'}}),fit=new FitAddon;term.loadAddon(fit);term.open(host);terminalState.term=term;terminalState.fit=fit;term.onData(data=>{const ws=terminalState.ws;if(ws?.readyState===WebSocket.OPEN)ws.send(new TextEncoder().encode(data))});term.onResize(()=>sendTerminalResize(terminalState));terminalState.resizeObserver=new ResizeObserver(()=>requestAnimationFrame(()=>fitTerminal(terminalState)));terminalState.resizeObserver.observe(host);connectTerminal(terminalState);globalThis.__codexTerminals=terminalStates;if(terminalState===terminalStates.bottom)globalThis.__codexTerminal={term,fit,state:terminalState}}
function setBottomPanelView(kind='launcher'){if(kind==='files'){openFilesPanel();return}const launcher=kind==='launcher',terminal=kind==='terminal',labels={browser:['Browser','globe','Open Browser from the right panel to keep it beside the chat.'],files:['Files','folderOpen','Choose or switch the local project folder available to this WebUI.']};$('#bottomPanelLauncher').hidden=!launcher;$('#terminalHost').hidden=!terminal;$('#bottomPanelUtility').hidden=launcher||terminal;$('#bottomPanelTab').textContent=launcher?'New tab':terminal?'Terminal':labels[kind]?.[0]||'New tab';if(launcher)return;bottomPanelLastView=kind;if(terminal){initializeTerminal(terminalStates.bottom);requestAnimationFrame(()=>{fitTerminal(terminalStates.bottom);terminalStates.bottom.term?.focus()});return}const[title,icon,description]=labels[kind];$('#bottomPanelIcon').innerHTML=codexIcon(icon);$('#bottomPanelUtilityTitle').textContent=title;$('#bottomPanelDescription').textContent=description;const action=$('#bottomPanelAction');action.hidden=kind!=='files';action.textContent='Choose project folder';action.onclick=kind==='files'?openFolderPicker:null}
function setBottomPanelOpen(open){const panel=$('#bottomPanel');panel.hidden=!open;document.body.classList.toggle('bottom-panel-open',open);$('#toggleBottomPanel').setAttribute('aria-pressed',String(open));$('#toggleBottomPanel').setAttribute('aria-expanded',String(open));if(open)setBottomPanelView(bottomPanelLastView||'launcher')}
function setSidebarSearchOpen(open){const panel=$('#sidebarSearchPanel'),input=$('#threadSearch');panel.hidden=!open;$('#sidebarSearchButton').setAttribute('aria-expanded',String(open));if(open){requestAnimationFrame(()=>input.focus());return}if(input.value){input.value='';renderThreads()}}
function setSidebarHelpOpen(open){$('#sidebarHelpMenu').hidden=!open;$('#sidebarHelpButton').setAttribute('aria-expanded',String(open))}

$('#newTab').onclick=()=>setSidePanelView('launcher','New tab');$('#utilityTab').onclick=()=>setSidePanelView($('#utilityTab').dataset.sidePanelTab,$('#utilityTab').textContent);$('#openSidePanelTab').onclick=()=>setSidePanelView('launcher','New tab');$('#browserAddressForm').onsubmit=event=>{event.preventDefault();navigateBrowser($('#browserUrl').value)};$('#browserBack').onclick=()=>moveBrowserHistory(-1);$('#browserForward').onclick=()=>moveBrowserHistory(1);$('#browserRefresh').onclick=()=>browserState.index>=0&&navigateBrowser(browserState.history[browserState.index],{push:false});$('#bottomPanelTab').onclick=()=>setBottomPanelView();for(const action of document.querySelectorAll('[data-bottom-panel-action]'))action.onclick=()=>setBottomPanelView(action.dataset.bottomPanelAction);$('#composer').addEventListener('submit',submitPrompt);$('#prompt').addEventListener('input',handlePromptInput);$('#prompt').addEventListener('click',updateComposerAutocomplete);$('#prompt').addEventListener('keyup',event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key))updateComposerAutocomplete()});$('#prompt').addEventListener('keydown',handlePromptKeydown);$('#threadSearch').addEventListener('input',renderThreads);$('#modelButton').addEventListener('click',toggleModelMenu);$('#modeButton').onclick=togglePermissionMenu;$('#confirmFullAccess').onclick=()=>{const action=pendingFullAccessAction;$('#fullAccessDialog').close();if(action==='enable')setPermissionVisibility('fullAccess',true);else setPermissionMode('full-access');pendingFullAccessAction='select'};$('#fullAccessDialog').addEventListener('close',()=>{pendingFullAccessAction='select';syncPermissionSettings()});let composerFileTarget='composer';document.querySelector('[data-composer-control="add"]').onclick=()=>{composerFileTarget='composer';$('#composerFileInput').click()};$('#composerFileInput').onchange=async event=>{const input=event.currentTarget,files=input.files,target=composerFileTarget;composerFileTarget='composer';input.value='';if(target==='workspace')await uploadFilesToWorkspace(files);else await uploadComposerFiles(files)};$('#prompt').addEventListener('compositionstart',()=>{promptComposing=true});$('#prompt').addEventListener('compositionend',()=>{promptComposing=false});$('#prompt').addEventListener('paste',event=>{const files=[...(event.clipboardData?.files||[])];if(files.length){event.preventDefault();void uploadComposerFiles(files)}});$('#composer').addEventListener('dragover',event=>{if(event.dataTransfer?.types?.includes('Files'))event.preventDefault()});$('#composer').addEventListener('drop',event=>{const files=[...(event.dataTransfer?.files||[])];if(files.length){event.preventDefault();void uploadComposerFiles(files)}});$('#filesUpButton').onclick=()=>fileBrowserState.parent!==null&&loadWorkspaceFiles(fileBrowserState.parent);$('#filesRefreshButton').onclick=()=>loadWorkspaceFiles(fileBrowserState.dir);$('#filesUploadButton').onclick=()=>{composerFileTarget='workspace';$('#composerFileInput').click()};$('#filesChooseProjectButton').onclick=openFolderPicker;$('#filesTerminalButton').onclick=()=>{openUtilityPanel('terminal')};$('#sidebarTerminalButton').onclick=()=>{openUtilityPanel('terminal')};$('#filesClosePreviewButton').onclick=closeFilePreview;$('#filesOpenSidebarButton').onclick=()=>{if(overlayPanelsEnabled())setSidePanelOpen(false,false);setSidebarOpen(true);setSidebarView('files')};$('#sidebarTabSessions').onclick=()=>setSidebarView('sessions');$('#sidebarTabFiles').onclick=()=>setSidebarView('files');$('#sidebarTabSkills').onclick=()=>setSidebarView('skills');$('#skillsFilterOfficial').onclick=()=>setSkillsFilter('official');$('#skillsFilterPersonal').onclick=()=>setSkillsFilter('personal');$('#skillsNewButton').onclick=()=>openNewPersonalSkillEditor();$('#skillsRefreshButton').onclick=()=>void loadSkillsCatalog(true);$('#skillsSearchInput').oninput=event=>{skillsState.query=event.currentTarget.value||'';renderSkillsList()};$('#threadActionsButton').onclick=event=>{event.stopPropagation();toggleThreadActionsMenu()};$('#threadRenameAction').onclick=()=>{closeThreadActionsMenu();void renameActiveThread()};$('#threadExportMarkdownAction').onclick=()=>{closeThreadActionsMenu();exportActiveThread('md')};$('#threadExportJsonAction').onclick=()=>{closeThreadActionsMenu();exportActiveThread('json')};$('#threadCompactAction').onclick=()=>{closeThreadActionsMenu();void compactActiveThread()};$('#threadDeleteAction').onclick=()=>{closeThreadActionsMenu();if(state.active)void deleteThread(state.active)};document.querySelector('[data-composer-control="dictation"]').onclick=()=>toast('Dictation requires the native desktop audio bridge.');$('#newTask').onclick=()=>startNewTask({resetDraft:!state.active});$('#projectButton').onclick=openFolderPicker;$('#projectlessOption').onclick=useProjectless;$('#accountButton').onclick=e=>{e.stopPropagation();if(state.account?.type==='chatgpt')toggleAccountMenu();else openSettings('general')};$('#folderGo').onclick=()=>loadFolders($('#folderPathInput').value);$('#folderPathInput').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();loadFolders(e.currentTarget.value)}};$('#folderUp').onclick=()=>folderBrowse.parent&&loadFolders(folderBrowse.parent);$('#folderConfirm').onclick=useSelectedFolder;$('#toggleSummaryPanel').onclick=()=>setSummaryPanelOpen($('#summaryPanel').hidden);$('#closeImageViewer').onclick=closeImageViewer;$('#imageViewerImage').onload=()=>{$('#imageViewerImage').hidden=false;$('#imageViewerError').hidden=true};$('#imageViewerImage').onerror=()=>{$('#imageViewerImage').hidden=true;$('#imageViewerError').hidden=false};$('#imageViewer').addEventListener('click',event=>{if(event.target===event.currentTarget)closeImageViewer()});$('#imageViewer').addEventListener('close',()=>{const image=$('#imageViewerImage');image.removeAttribute('src');if(imageViewerReturnFocus?.isConnected)imageViewerReturnFocus.focus();imageViewerReturnFocus=null});function mobileSidebarEnabled(){return innerWidth<720}
$('#sidebarSearchButton').onclick=event=>{event.stopPropagation();setSidebarSearchOpen($('#sidebarSearchPanel').hidden)};$('#sidebarSearchClose').onclick=()=>setSidebarSearchOpen(false);$('#sidebarHelpButton').onclick=event=>{event.stopPropagation();setSidebarHelpOpen($('#sidebarHelpMenu').hidden)};$('#sidebarHelpSettings').onclick=()=>{setSidebarHelpOpen(false);openSettings('general-settings')};$('#sidebarHelpShortcuts').onclick=()=>{setSidebarHelpOpen(false);openSettings('keyboard-shortcuts')};$('#accountSettings').onclick=()=>openSettings('general-settings');$('#accountProfile').onclick=()=>openSettings('profile');$('#accountUsage').onclick=()=>openSettings('profile');$('#accountShortcuts').onclick=()=>openSettings('keyboard-shortcuts');for(const button of document.querySelectorAll('[data-settings-page]'))button.onclick=()=>setSettingsPage(button.dataset.settingsPage);$('#settingsAutoReviewToggle').onchange=event=>setPermissionVisibility('autoReview',event.currentTarget.checked);$('#settingsTaskNotifyToggle').onchange=event=>setTaskNotifyEnabled(event.currentTarget.checked);$('#settingsFullAccessToggle').onchange=event=>{if(!event.currentTarget.checked){setPermissionVisibility('fullAccess',false);return}event.currentTarget.checked=false;pendingFullAccessAction='enable';const dialog=$('#fullAccessDialog');if(!dialog.open)dialog.showModal()};$('#accountLogout').onclick=async()=>{if(!confirm('Log out?'))return;try{await rpc('account/logout');toggleAccountMenu(false);await loadAccount(true);void loadLoginStatus()}catch(error){toast(error.message)}};$('#settingsAccountLogin').onclick=()=>void startChatgptLogin();$('#loginCopyCode').onclick=async()=>{const code=state.login.pending?.userCode||'';if(!code)return;const button=$('#loginCopyCode');if(!await copyTextToClipboard(code)){toast(t('Copy failed. Select the text and copy it manually.'));return}button.textContent=t('Code copied');toast(t('Code copied'));setTimeout(()=>{button.textContent=t('Copy code')},1600)};$('#loginCancel').onclick=()=>void cancelChatgptLogin();$('#loginClose').onclick=()=>void cancelChatgptLogin();$('#loginDialog').addEventListener('cancel',event=>{event.preventDefault();void cancelChatgptLogin()});$('#settingsDialog').addEventListener('cancel',event=>{event.preventDefault();closeSettings()});$('#providerAddButton').onclick=()=>openProviderEditor();$('#providerForm').onsubmit=saveProviderEditor;$('#providerCancelButton').onclick=()=>closeProviderEditor();$('#providerRefreshAllButton').onclick=refreshAllProviderModels;
$('#settingsSkillsButton').onclick=()=>{closeSettings();setSidebarOpen(true);setSidebarView('skills')};
$('#sideTerminalReconnect').onclick=reconnectSideTerminal;$('#sideTerminalDiagnostics').onclick=showTerminalDiagnostics;$('#copyTerminalDiagnostics').onclick=copyTerminalDiagnostics;
$('#conversation').addEventListener('scroll',()=>{const root=$('#conversation'),thread=state.active;if(root.scrollTop<=80&&thread?.olderTurnsCursor&&!thread.olderTurnsLoading)void loadOlderTurns(thread)},{passive:true});
$('#languageSelect').value=i18n.preference;
$('#languageSelect').onchange=event=>i18n.setPreference(event.currentTarget.value);
const systemThemeQuery=matchMedia('(prefers-color-scheme: dark)');
let themePreference=readStoredTheme();
function syncTheme(){applyTheme(themePreference,{prefersDark:systemThemeQuery.matches});const select=$('#themeSelect');if(select)select.value=themePreference}
function setThemePreference(value){themePreference=storeTheme(value);syncTheme();return themePreference}
systemThemeQuery.addEventListener?.('change',()=>{if(themePreference==='system')syncTheme()});
$('#themeSelect').onchange=event=>setThemePreference(event.currentTarget.value);
syncTheme();
function refreshLocalizedRuntime(){
  $('#languageSelect').value=i18n.preference;
  if(!state.active)$('#threadTitle').textContent=t('New task');
  if(!folderBrowse.selected)$('#folderSelection').textContent=t('No folder selected');
  if(state.account)renderAccount(state.account);else for(const id of ['accountName','accountMenuName','settingsAccountName'])$(`#${id}`).textContent=t('Settings');
  syncPermissionControl();syncModelLabel();refreshComposerPlaceholder();syncAccountQuotaMeta();renderContextUsage();
  syncComposerSubmitState();renderSkillsList();renderTerminalConnection(terminalStates.side);messageActions.refreshLabels(document);refreshUserRetries();
  if(!$('#modelMenu').hidden)renderModelMenuMain();
  if($('#settingsDialog').open){const current=document.querySelector('[data-settings-page].active')?.dataset.settingsPage||settingsRoutePage()||'general-settings';setSettingsPage(current,{updateRoute:false});filterSettingsNavigation($('#settingsSearch').value)}
}
i18n.subscribe(refreshLocalizedRuntime);
refreshLocalizedRuntime();
$('#toggleSidePanel').onclick=()=>setSidePanelOpen($('#sidePanel').hidden);$('#toggleBottomPanel').onclick=()=>setBottomPanelOpen($('#bottomPanel').hidden);$('#closeBottomPanel').onclick=()=>setBottomPanelOpen(false);$('#toggleSidebar').onclick=()=>setSidebarOpen(mobileSidebarEnabled()?!$('#sidebar').classList.contains('mobile-open'):document.body.classList.contains('sidebar-hidden'),{manual:true});$('#closeSidePanel').onclick=()=>setSidePanelOpen(false);$('#closeSummaryPanel').onclick=()=>setSummaryPanelOpen(false);document.addEventListener('click',e=>{const runtimeUsage=$('#runtimeUsage');if(!runtimeUsage?.open)return;runtimeUsage.open=false;const target=e.target instanceof Element?e.target:null;if(target?.closest('#runtimeUsage > summary'))e.preventDefault()},true);document.addEventListener('click',e=>{const target=e.target instanceof Element?e.target:null,image=target?.closest('[data-image-src]');if(image){e.preventDefault();openImageViewer(image.dataset.imageSrc,image.dataset.imageTitle||image.querySelector('img')?.alt||'Image',image.dataset.imagePath||'');return}if(target?.closest('a[data-file-download]'))return;const citation=target?.closest('a[data-file-reference]');if(!citation)return;e.preventDefault();const path=citation.dataset.fileReference,event=new CustomEvent('codex-webui:file-reference',{cancelable:true,detail:{path,lineStart:Number(citation.dataset.fileLineStart)||null,lineEnd:Number(citation.dataset.fileLineEnd)||null}});dispatchEvent(event);if(!event.defaultPrevented&&path&&!$('#sidePanel').hidden)void previewWorkspaceFile(path)});document.addEventListener('click',e=>{const path=e.composedPath();if(!path.includes($('#modelPicker')))closeModelMenu();if(!path.includes($('#permissionPicker')))closePermissionMenu();if(!path.includes($('#accountMenu'))&&!path.includes($('#accountButton')))toggleAccountMenu(false);if(!path.includes($('#threadActionsWrap')))closeThreadActionsMenu();if(!path.includes($('#sidebarSearchPanel'))&&!path.includes($('#sidebarSearchButton')))setSidebarSearchOpen(false);if(!path.includes($('#sidebarHelpMenu'))&&!path.includes($('#sidebarHelpButton')))setSidebarHelpOpen(false)});document.addEventListener('visibilitychange',()=>{if(document.visibilityState!=='visible')return;if(initialLoadIncomplete())loadInitial();scheduleThreadListRefresh(0);scheduleActiveThreadSync(0)});addEventListener('keydown',e=>{if(e.target instanceof Element&&e.target.closest('.terminal-host'))return;if(e.key==='Escape'){if($('#terminalDiagnosticsDialog').open){e.preventDefault();$('#terminalDiagnosticsDialog').close();return}if($('#imageViewer').open){e.preventDefault();closeImageViewer();return}if($('#folderDialog').open||$('#fullAccessDialog').open)return;if(e.defaultPrevented)return;if(!$('#sidebarSearchPanel').hidden){e.preventDefault();setSidebarSearchOpen(false);return}if(!$('#sidebarHelpMenu').hidden){e.preventDefault();setSidebarHelpOpen(false);return}if($('#settingsDialog').open){e.preventDefault();closeSettings();return}closeModelMenu();closePermissionMenu();toggleAccountMenu(false);closeThreadActionsMenu();if(document.body.classList.contains('side-panel-open'))setSidePanelOpen(false);else if(document.body.classList.contains('summary-panel-open'))setSummaryPanelOpen(false)}if((e.metaKey||e.ctrlKey)&&e.key==='k'){e.preventDefault();startNewTask()}if((e.metaKey||e.ctrlKey)&&e.key==='b'){e.preventDefault();$('#toggleSidebar').click()}if((e.metaKey||e.ctrlKey)&&e.key==='j'){e.preventDefault();openUtilityPanel('terminal')}});addEventListener('resize',()=>{syncOverlayPanelMode();syncSidebarLayout();syncRightPanelWidth();for(const terminalState of Object.values(terminalStates))requestAnimationFrame(()=>fitTerminal(terminalState))});
globalThis.__codexWebuiDebug={notify:onNotification,request:onServerRequest,state,browserState,fileBrowserState,skillsState,navigateBrowser,setSidebarView,openFilesPanel,openUtilityPanel,loadWorkspaceFiles,previewWorkspaceFile,uploadFilesToWorkspace,mentionWorkspaceFile,loadSkillsCatalog,setSkillsFilter,inspectSkillItem,openNewPersonalSkillEditor,saveSkillFromEditor,attachSkillToComposer,applyRateLimits,loadRateLimits,renameActiveThread,exportActiveThread,compactActiveThread,renderAccount,renderHeader,refreshComposerPlaceholder,setProjectless,openImageViewer,openThread,loadInitial,startNewTask,setSidebarOpen,openSettings,closeSettings,settingsRoutePage,selectedPermission,permissionThreadPolicy,permissionTurnPolicy,setPermissionMode,setPermissionProfiles,setPermissionVisibility,renderPermissionMenu,filterAppModels,renderModels,syncTurnSnapshot,scrollOpenedThreadToBottom,setThemePreference,getThemePreference:()=>themePreference};
for(const handle of document.querySelectorAll('.right-panel-resize-handle'))createPanelResizer({
  handle,getWidth:()=>appliedRightPanelWidth,getLimits:rightPanelWidthLimits,onResize:applyRightPanelWidth,
  onCommit:width=>{preferredRightPanelWidth=Math.round(width);try{localStorage.setItem(RIGHT_PANEL_WIDTH_KEY,String(preferredRightPanelWidth))}catch{}syncRightPanelWidth()},
  onDragEnd:({previousFocusedElement})=>{if(previousFocusedElement?.isConnected&&previousFocusedElement.closest?.('.terminal-host'))previousFocusedElement.focus()},
});
async function boot(){const savedProject=localStorage.getItem('codex-webui-project');syncSidebarLayout();syncPermissionControl();try{state.config=await fetch('/api/config').then(r=>r.json())}catch{}const requested=await requestedCwdFromUrl();if(requested)setWorkspace(requested);else if(state.config.projectless||savedProject==='~')setProjectless();else setWorkspace(savedProject||state.config.defaultCwd||'.');restoreActiveDraft();refreshComposerPlaceholder();const initialSettingsPage=settingsRoutePage();if(initialSettingsPage)showSettings(initialSettingsPage,{updateRoute:false});connect()}
boot();
