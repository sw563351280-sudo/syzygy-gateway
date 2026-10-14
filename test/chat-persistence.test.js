'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createJournal, requestJson } = require('../public/chat-persistence');
const source = fs.readFileSync(path.join(__dirname, '../public/script.js'), 'utf8');
const msg = id => ({ _id: id, role: 'user', versions: [{ content: 'message ' + id }] });
const session = (...messages) => [{ id: 'main', name: '小屋', messages }];
const storage = () => { const values = new Map(); return { getItem: key => values.get(key) || null, setItem: (key,value) => values.set(key,value) }; };

test('restart restores only unconfirmed new messages, ignoring legacy backups', () => {
    const disk = storage();
    disk.setItem('syzygy_urgent_bak', JSON.stringify({ sessions: session(msg('deleted-history')) }));
    const journal = createJournal(disk);
    journal.observe(session(msg('old')));
    journal.capture(session(msg('old'),msg('new')));
    const restarted = createJournal(disk);
    const result = restarted.restore(session(msg('old')));
    assert.equal(result.restored, 1);
    assert.deepEqual(result.sessions[0].messages.map(m=>m._id), ['old','new']);
});

test('server confirmation clears only the snapshot sent, retaining newer messages and edits', () => {
    const disk = storage(), journal = createJournal(disk);
    journal.observe(session(msg('old')));
    const sent = session(msg('old'), msg('a'));
    journal.capture(sent);
    const edited = msg('a'); edited.versions[0].content = 'edited while request pending';
    journal.capture(session(msg('old'),edited,msg('b')));
    journal.acknowledge(sent);
    journal.capture(session(msg('old'),edited,msg('b')));
    assert.equal(createJournal(disk).restore(session(msg('old'))).restored, 2);
    journal.acknowledge(session(msg('old'),edited,msg('b')));
    assert.equal(createJournal(disk).hasPending(), false);
});

test('lost acknowledgement does not duplicate a message already committed by the server', () => {
    const disk = storage(), journal = createJournal(disk);
    journal.observe(session(msg('old')));
    journal.capture(session(msg('old'),msg('new')));
    assert.equal(createJournal(disk).restore(session(msg('old'),msg('new'))).restored, 0);
});

test('loading older pages does not journal old history; local deletion removes pending data', () => {
    const disk = storage(), journal = createJournal(disk);
    journal.observe(session(msg('recent')));
    journal.observe(session(msg('older')));
    journal.capture(session(msg('older'),msg('recent'),msg('new')));
    journal.capture(session(msg('older'),msg('recent')));
    assert.equal(createJournal(disk).hasPending(), false);
});

test('journal exposes only new or modified messages for incremental sync', () => {
    const disk = storage(), journal = createJournal(disk);
    journal.observe(session(msg('old')));
    const edited = msg('old'); edited.versions[0].content = 'edited';
    journal.capture(session(edited, msg('new')));
    const pending = journal.pendingSnapshot();
    assert.deepEqual(pending[0].messages.map(message => message._id), ['old', 'new']);
    journal.acknowledge(pending);
    assert.equal(journal.hasPending(), false);
});

test('incremental save posts only journaled messages and removes duplicate model fields', async () => {
    const disk = storage(), journal = createJournal(disk);
    journal.observe(session(msg('old')));
    const fresh = msg('new');
    Object.assign(fresh.versions[0], { content: 'reply', rawContent: 'reply', thinking: 'thought', reasoning: 'thought' });
    journal.capture(session(msg('old'), fresh));
    let url, posted;
    const context = vm.createContext({
        console: { log() {}, warn() {}, error() {} }, Blob,
        _dataVersion: 7, _preservePendingHistory: false, _loopCount: 0, _loopLocalOnly: 0,
        _hasDirtyFallbackState: () => false, isDirtyFallbackMessage: () => false,
        _chatJournal: journal, resyncAndMerge: async () => ({ serverAdded: 0 }),
        ChatPersistence: { requestJson: async (nextUrl, options) => {
            url = nextUrl; posted = JSON.parse(options.body); return { success: true, _version: 8 };
        } }
    });
    vm.runInContext(source.slice(source.indexOf('function compactMessageForPersistence('), source.indexOf('let _savingNow = false;')), context);
    await context._doSave(true);
    assert.equal(url, '/api/chat-messages');
    assert.deepEqual(posted.sessions[0].messages.map(message => message._id), ['new']);
    assert.equal(posted.sessions[0].messages[0].versions[0].rawContent, undefined);
    assert.equal(posted.sessions[0].messages[0].versions[0].reasoning, undefined);
    assert.equal(posted.chatSessions, undefined);
    assert.equal(journal.hasPending(), false);
});

test('deleted cloud channels are not resurrected, but an unsaved new channel survives restart', () => {
    const disk = storage(), journal = createJournal(disk);
    journal.observe([{id:'removed',messages:[msg('old')]}]);
    journal.capture([{id:'removed',messages:[msg('old'),msg('a')]},{id:'new-channel',name:'new',messages:[msg('b')]}]);
    assert.deepEqual(createJournal(disk).restore([]).sessions.map(s=>s.id), ['new-channel']);
});

test('image quota failure still persists text without changing live image data', () => {
    const disk = storage(), write = disk.setItem;
    disk.setItem = (key,value) => { if(value.includes('image-bytes')) throw new Error('quota'); write(key,value); };
    const journal = createJournal(disk), imageMessage = msg('new');
    imageMessage.versions[0].images = ['image-bytes'];
    journal.observe(session()); journal.capture(session(imageMessage));
    const recovered = createJournal(disk).restore(session()).sessions[0].messages[0];
    assert.equal(recovered.versions[0].content,'message new');
    assert.equal(recovered.versions[0].images,undefined);
    assert.deepEqual(imageMessage.versions[0].images,['image-bytes']);
});

test('timeouts cover both connection and stalled JSON body, and later requests succeed', async t => {
    let signal;
    t.mock.method(globalThis,'fetch',async (_url,options)=>{signal=options.signal; return new Promise(()=>{});});
    await assert.rejects(requestJson('/fixture',{},5), /超时/);
    assert.equal(signal.aborted,true);
    globalThis.fetch = async ()=>({ok:true,json:()=>new Promise(()=>{})});
    await assert.rejects(requestJson('/fixture',{},5), /超时/);
    globalThis.fetch = async ()=>({ok:true,json:async()=>({success:true,_version:2})});
    assert.equal((await requestJson('/fixture',{},100))._version,2);
});

test('real startup merges the new journal even when cloud GET succeeds and queues save', async () => {
    const disk = storage(), journal = createJournal(disk);
    journal.observe(session(msg('old'))); journal.capture(session(msg('old'),msg('new')));
    let saves=0;
    const context=vm.createContext({
        loadCloudConfig:async()=>({_version:8,chatSessions:session(msg('old'))}),
        _chatJournal:createJournal(disk),ContextContinuity:{ensureMessageIds(){}},crypto:globalThis.crypto,
        updateHistoryWindows(){},ensureWorkroomSession(){},normalizeMessageVersionFields(){},
        mergeMessageLists:(_,messages)=>messages,isDirtyFallbackMessage:()=>false,
        renderSuppliers(){},renderChatSidebar(){},renderChatMessages(){},updateWorkroomChrome(){},fetchModels(){},
        saveToCloud:()=>saves++,saveMessageChangesToCloud:()=>saves++,document:{getElementById:()=>null},console,chatSessions:[],setTimeout
    });
    vm.runInContext(source.slice(source.indexOf('async function syncFromCloud()'),source.indexOf('let _saveTimer = null;')), context);
    await context.syncFromCloud();
    assert.equal(context.chatSessions[0].messages.length,2);
    assert.equal(saves,1);
});

test('actual save queue releases its lock after repeated timeout failures and accepts the next save', async () => {
    let fails=true, backups=0;
    const timers=[];
    const context=vm.createContext({
        console:{log(){},warn(){},error(){}},_saveTimer:null,_saveMutationEpoch:0,_saveCommittedEpoch:0,_saveFailCount:0,
        _doSave:async()=>{if(fails) throw new Error('同步请求超时');},
        saveLocalBackup:()=>backups++,_showSaveWarning(){},document:{hidden:false},clearTimeout(){},
        setTimeout:(fn,delay)=>{if(delay<=4000) queueMicrotask(fn);else timers.push(fn);},
    });
    vm.runInContext('function hasUnsavedCloudChanges(){return _saveCommittedEpoch < _saveMutationEpoch;}\n'+source.slice(source.indexOf('let _savingNow = false;'),source.indexOf('// 💥 焕然一新')),context);
    await context.saveToCloud(true);
    assert.equal(vm.runInContext('_savingNow',context),false);
    assert.equal(context._saveCommittedEpoch,0);
    assert.equal(timers.length,1);
    fails=false;
    await context.saveToCloud(true,true);
    assert.equal(context._saveCommittedEpoch,1);
    assert.equal(backups,2);
});

function saveContext(reply) {
    let posted, acknowledgements=0;
    const context=vm.createContext({
        console:{log(){},warn(){},error(){}},Date,Blob,structuredClone,crypto:globalThis.crypto,
        chatSessions:session(...Array.from({length:250},(_,i)=>msg('m'+i))),
        _dataVersion:7,_preservePendingHistory:true,suppliers:[],activeSupIndex:0,activeChatId:'main',
        ContextContinuity:require('../public/context-continuity'),getActiveVersion:m=>m.versions[0],
        _hasDirtyFallbackState:()=>false,cleanupOldImages(){},historyWindowsForPayload:()=>({}),
        _countImgRounds:()=>0,_showSaveWarning(){},mergeSyncEnabled:()=>true,
        resyncAndMerge:async()=>({serverAdded:1}),
        _chatJournal:{acknowledge(){acknowledgements++;},hasPending:()=>false},
        ChatPersistence:{requestJson:async(_url,options)=>{posted=JSON.parse(options.body);return reply;}}
    });
    vm.runInContext(source.slice(source.indexOf('function compactMessageForPersistence('),source.indexOf('let _savingNow = false;')),context);
    return {context,posted:()=>posted,acknowledgements:()=>acknowledgements};
}

test('recovered messages earlier than the latest 200 survive the real save path', async () => {
    const fixture=saveContext({success:true,_version:8});
    await fixture.context._doSave();
    assert.equal(fixture.posted().chatSessions[0].messages.length,250);
    assert.equal(fixture.posted().chatSessions[0].messages[0]._id,'m0');
    assert.equal(fixture.acknowledgements(),1);
});

test('version conflict and malformed success never acknowledge pending local messages', async () => {
    for(const reply of [{_rejected:true,_version:8},{_version:8}]) {
        const fixture=saveContext(reply);
        await assert.rejects(fixture.context._doSave(),/版本冲突|未确认保存/);
        assert.equal(fixture.acknowledgements(),0);
        assert.equal(fixture.context._dataVersion,7);
    }
});
