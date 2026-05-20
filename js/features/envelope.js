let envelopeData = { outbox: [], inbox: [], partnerLetters: [], notes: [] }; 
let currentEnvTab = 'outbox';
let currentInboxSubTab = 'reply';
let editingEnvId = null; 
let editingEnvSection = null;
let noteDrawerExpanded = false; // 小纸条抽屉展开状态

// 获取对方昵称的辅助函数
function getPartnerName() {
    return (typeof settings !== 'undefined' && settings.partnerName) || 'Ta';
}

// 获取用户昵称的辅助函数
function getMyName() {
    return (typeof settings !== 'undefined' && settings.myName) || '我';
}

// 随机生成Ta的表态（新概率：特别喜欢12%，喜欢36%，一般4%，惊讶12%，不表态36%）
function generateRandomTaReaction() {
    const rand = Math.random();
    if (rand < 0.12) {
        return 'superLike'; // 特别喜欢 12%
    } else if (rand < 0.48) {
        return 'like'; // 喜欢 36%
    } else if (rand < 0.52) {
        return 'dislike'; // 一般 4%
    } else if (rand < 0.64) {
        return 'surprised'; // 惊讶 12%
    }
    return null; // 不表态 36%
}

// 获取表态的显示文本和样式
function getTaReactionDisplayInfo(reactionType) {
    const reactionMap = {
        'superLike': {
            text: '特别喜欢',
            style: 'background:linear-gradient(135deg,#FFD700,#FFA500);box-shadow:0 2px 8px rgba(255,165,0,0.5);'
        },
        'like': {
            text: '喜欢',
            style: 'background:linear-gradient(135deg,#ff6b81,#ff4757);box-shadow:0 2px 8px rgba(255,71,87,0.4);'
        },
        'dislike': {
            text: '一般',
            style: 'background:rgba(100,100,100,0.85);'
        },
        'surprised': {
            text: '惊讶',
            style: 'background:linear-gradient(135deg,#9C27B0,#7B1FA2);box-shadow:0 2px 8px rgba(156,39,176,0.4);'
        }
    };
    return reactionMap[reactionType] || { text: '', style: '' };
}

// 切换小纸条抽屉展开/折叠
window.toggleNoteDrawer = function() {
    const drawer = document.getElementById('env-note-drawer');
    if (!drawer) return;
    
    noteDrawerExpanded = !noteDrawerExpanded;
    drawer.classList.toggle('expanded', noteDrawerExpanded);
    
    // 保存展开状态
    try {
        localStorage.setItem(getStorageKey('noteDrawerExpanded'), noteDrawerExpanded);
    } catch(e) {}
};

// 加载抽屉展开状态
function loadNoteDrawerState() {
    try {
        const saved = localStorage.getItem(getStorageKey('noteDrawerExpanded'));
        if (saved === 'true') {
            noteDrawerExpanded = true;
            const drawer = document.getElementById('env-note-drawer');
            if (drawer) drawer.classList.add('expanded');
        }
    } catch(e) {}
} 

async function loadEnvelopeData() {
    const saved = await localforage.getItem(getStorageKey('envelopeData'));
    if (saved) {
        envelopeData = saved;
        // 确保notes数组存在
        if (!envelopeData.notes) envelopeData.notes = [];
    }
    const oldPending = await localforage.getItem(getStorageKey('pending_envelope'));
    if (oldPending && envelopeData.outbox.length === 0) {
        envelopeData.outbox.push({
            id: 'legacy_' + Date.now(),
            content: '（历史寄出的信件）',
            sentTime: oldPending.sentTime,
            replyTime: oldPending.replyTime,
            status: 'pending'
        });
        await localforage.removeItem(getStorageKey('pending_envelope'));
        saveEnvelopeData();
    }
    // 加载用户自定义问题库
    await loadNoteQuestions();
    // 加载小纸条列表抽屉折叠状态
    loadNoteListDrawerState();
    // 加载信件抽屉折叠状态
    loadLetterDrawerState();
}

function saveEnvelopeData() {
    localforage.setItem(getStorageKey('envelopeData'), envelopeData);
}

async function checkEnvelopeStatus() {
    await loadEnvelopeData();
    const now = Date.now();
    let changed = false;
    let newReplyLetter = null;
    
    // 检查寄出的信的回复
    envelopeData.outbox.forEach(letter => {
        if (letter.status === 'pending' && now >= letter.replyTime) {
            letter.status = 'replied';
            const replyContent = generateEnvelopeReplyText();
            const replyId = 'reply_' + Date.now() + '_' + Math.random().toString(36).substr(2,4);
            const inboxLetter = {
                id: replyId,
                refId: letter.id,
                originalContent: letter.content,
                content: replyContent,
                receivedTime: Date.now(),
                isNew: true
            };
            envelopeData.inbox.push(inboxLetter);
            newReplyLetter = inboxLetter;
            changed = true;
            playSound('message');
            
            // 对方有一定概率收藏这封信（30%概率）
            if (Math.random() < 0.3) {
                letter.heFavorite = true;
                letter.heFavoriteTime = Date.now();
            }
        }
    });

    // 检查小纸条的回复
    (envelopeData.notes || []).forEach(note => {
        if (note.status === 'pending' && now >= note.replyTime) {
            note.status = 'replied';
            
            if (note.type === 'iAsk') {
                // 我问Ta：检查是否是对话历史中的回复
                const hasConversation = note.conversation && note.conversation.length > 0;
                const lastInConversation = hasConversation ? note.conversation[note.conversation.length - 1] : null;
                
                if (lastInConversation && lastInConversation.type === 'myReply') {
                    // 对话历史中有用户刚发的回复，Ta回应
                    const taResponseContent = generateNoteReplyText();
                    note.conversation.push({
                        type: 'taResponse',
                        content: taResponseContent,
                        time: Date.now()
                    });
                } else if (!note.reply) {
                    // 第一次回复
                    note.reply = generateNoteReplyText();
                }
                note.hasNewReply = true;
            } else if (note.type === 'taAsk') {
                // Ta问我：如果我已经回答了，Ta回应；如果没回答，保持可回答状态
                if (note.myAnswer) {
                    // 初始化对话数组
                    if (!note.conversation) {
                        note.conversation = [];
                    }
                    
                    // 检查是否是对话历史中的回答（后续轮）
                    const lastInConversation = note.conversation.length > 0 ? 
                        note.conversation[note.conversation.length - 1] : null;
                    const isFollowUp = lastInConversation && lastInConversation.type === 'myAnswer';
                    
                    const responseData = generateNoteAnswerResponse(
                        isFollowUp ? lastInConversation.content : note.myAnswer
                    );
                    
                    if (isFollowUp) {
                        // 后续对话：Ta的回应存入对话历史
                        note.conversation.push({
                            type: 'taResponse',
                            content: responseData.response,
                            time: Date.now()
                        });
                    } else {
                        // 第一轮：存到 taResponse
                        note.taResponse = responseData.response;
                        note.taResponseTime = Date.now();
                    }
                    
                    note.hasNewReply = true;
                    
                    // 可能继续问新问题 - 但限制每条小纸条最多追问1次
                    const taQuestionCount = note.conversation ? 
                        note.conversation.filter(item => item.type === 'taQuestion').length : 0;
                    
                    if (responseData.hasQuestion && NOTE_QUESTIONS.length > 0 && taQuestionCount < 1) {
                        // 获取一星期内已经问过的问题
                        const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
                        const recentQuestions = new Set();
                        
                        (envelopeData.notes || []).forEach(n => {
                            if (n.sentTime > oneWeekAgo) {
                                if (n.taQuestion) recentQuestions.add(n.taQuestion);
                                if (n.nextTaQuestion) recentQuestions.add(n.nextTaQuestion);
                                if (n.conversation) {
                                    n.conversation.forEach(item => {
                                        if (item.type === 'taQuestion' && item.content) {
                                            recentQuestions.add(item.content);
                                        }
                                    });
                                }
                            }
                        });
                        
                        // 从问题库中排除一星期内已经问过的
                        const availableQuestions = NOTE_QUESTIONS.filter(q => !recentQuestions.has(q));
                        
                        // 如果有可用的问题，才追问
                        if (availableQuestions.length > 0) {
                            const newQuestion = availableQuestions[Math.floor(Math.random() * availableQuestions.length)];
                            if (isFollowUp || note.taResponse) {
                                // 后续对话：新问题存入对话历史
                                note.conversation.push({
                                    type: 'taQuestion',
                                    content: newQuestion,
                                    time: Date.now()
                                });
                            } else {
                                note.nextTaQuestion = newQuestion;
                            }
                        }
                    }
                } else {
                    // 还没回答，不需要处理，保持可回答状态
                    return;
                }
            }
            
            note.replyReceivedTime = Date.now();
            changed = true;
            playSound('message');
            showNoteReplyPopup(note);
        }
    });
    
    // 检查Ta的信的回复（partnerLetters）
    (envelopeData.partnerLetters || []).forEach(letter => {
        if (letter.taReplyStatus === 'pending' && letter.taReplyTime && now >= letter.taReplyTime) {
            const taReplyContent = generateTaReplyContent(letter.myReply, letter.content);
            
            // 添加Ta的回复到对话历史
            if (!letter.conversationHistory) {
                letter.conversationHistory = [];
            }
            
            // Ta对用户的上一条回复进行表态
            if (letter.conversationHistory.length > 0) {
                // 找到最后一条用户回复
                for (let i = letter.conversationHistory.length - 1; i >= 0; i--) {
                    if (letter.conversationHistory[i].type === 'myReply') {
                        // 随机表态（新概率：特别喜欢12%，喜欢36%，一般4%，惊讶12%，不表态36%）
                        const reaction = generateRandomTaReaction();
                        if (reaction) {
                            // 先清除该信件中所有旧的未读表态标记
                            letter.conversationHistory.forEach(item => {
                                if (item.taReactionUnread) item.taReactionUnread = false;
                            });
                            if (letter.myReplyTaReactionUnread) letter.myReplyTaReactionUnread = false;
                            
                            letter.conversationHistory[i].taReaction = reaction;
                            letter.conversationHistory[i].taReactionUnread = true;
                        }
                        break;
                    }
                }
            } else if (letter.myReply) {
                // 兼容旧数据：对旧格式的myReply表态
                const reaction = generateRandomTaReaction();
                if (reaction) {
                    // 先清除该信件中所有旧的未读表态标记
                    if (letter.conversationHistory) {
                        letter.conversationHistory.forEach(item => {
                            if (item.taReactionUnread) item.taReactionUnread = false;
                        });
                    }
                    if (letter.myReplyTaReactionUnread) letter.myReplyTaReactionUnread = false;
                    
                    letter.myReplyTaReaction = reaction;
                    letter.myReplyTaReactionUnread = true;
                }
            }
            
            letter.conversationHistory.push({
                type: 'taReply',
                content: taReplyContent,
                time: Date.now()
            });
            
            // 兼容旧数据
            letter.taReply = taReplyContent;
            letter.taReplyStatus = 'replied';
            letter.taReplyReceivedTime = Date.now();
            letter.hasNewTaReply = true;
            changed = true;
            playSound('message');
            showTaReplyNotification(letter, 'Ta的信');
        }
    });
    
    // 检查收到的回信的Ta回复（inbox）
    (envelopeData.inbox || []).forEach(letter => {
        if (letter.taReplyStatus === 'pending' && letter.taReplyTime && now >= letter.taReplyTime) {
            const taReplyContent = generateTaReplyContent(letter.myReply, letter.content);
            
            // 添加Ta的回复到对话历史
            if (!letter.conversationHistory) {
                letter.conversationHistory = [];
            }
            
            // Ta对用户的上一条回复进行表态
            if (letter.conversationHistory.length > 0) {
                // 找到最后一条用户回复
                for (let i = letter.conversationHistory.length - 1; i >= 0; i--) {
                    if (letter.conversationHistory[i].type === 'myReply') {
                        // 随机表态（新概率：特别喜欢12%，喜欢36%，一般4%，惊讶12%，不表态36%）
                        const reaction = generateRandomTaReaction();
                        if (reaction) {
                            // 先清除该信件中所有旧的未读表态标记
                            letter.conversationHistory.forEach(item => {
                                if (item.taReactionUnread) item.taReactionUnread = false;
                            });
                            if (letter.myReplyTaReactionUnread) letter.myReplyTaReactionUnread = false;
                            
                            letter.conversationHistory[i].taReaction = reaction;
                            letter.conversationHistory[i].taReactionUnread = true;
                        }
                        break;
                    }
                }
            } else if (letter.myReply) {
                // 兼容旧数据：对旧格式的myReply表态
                const reaction = generateRandomTaReaction();
                if (reaction) {
                    // 先清除该信件中所有旧的未读表态标记
                    if (letter.conversationHistory) {
                        letter.conversationHistory.forEach(item => {
                            if (item.taReactionUnread) item.taReactionUnread = false;
                        });
                    }
                    if (letter.myReplyTaReactionUnread) letter.myReplyTaReactionUnread = false;
                    
                    letter.myReplyTaReaction = reaction;
                    letter.myReplyTaReactionUnread = true;
                }
            }
            
            letter.conversationHistory.push({
                type: 'taReply',
                content: taReplyContent,
                time: Date.now()
            });
            
            // 兼容旧数据
            letter.taReply = taReplyContent;
            letter.taReplyStatus = 'replied';
            letter.taReplyReceivedTime = Date.now();
            letter.hasNewTaReply = true;
            changed = true;
            playSound('message');
            showTaReplyNotification(letter, '回信');
        }
    });
    
    // 随机触发旧信件的Ta回复
    // 1. Ta的信（partnerLetters）- 兼容旧数据
    const oldPartnerLetters = (envelopeData.partnerLetters || []).filter(l => 
        l.myReply && !l.taReply && !l.taReplyStatus
    );
    if (oldPartnerLetters.length > 0 && Math.random() < 0.2) {
        const randomLetter = oldPartnerLetters[Math.floor(Math.random() * oldPartnerLetters.length)];
        const taReplyContent = generateTaReplyContent(randomLetter.myReply, randomLetter.content);
        
        // 添加到对话历史
        if (!randomLetter.conversationHistory) {
            randomLetter.conversationHistory = [];
        }
        
        // Ta对用户的回复进行表态
        const reaction = generateRandomTaReaction();
        if (reaction) {
            randomLetter.myReplyTaReaction = reaction;
            randomLetter.myReplyTaReactionUnread = true;
        }
        
        randomLetter.conversationHistory.push({
            type: 'taReply',
            content: taReplyContent,
            time: Date.now()
        });
        
        randomLetter.taReply = taReplyContent;
        randomLetter.taReplyStatus = 'replied';
        randomLetter.taReplyReceivedTime = Date.now();
        randomLetter.hasNewTaReply = true;
        changed = true;
        playSound('message');
        showTaReplyNotification(randomLetter, 'Ta的信');
    }
    
    // 2. 收到的回信（inbox）- 兼容旧数据
    const oldInboxLetters = (envelopeData.inbox || []).filter(l => 
        l.myReply && !l.taReply && !l.taReplyStatus
    );
    if (oldInboxLetters.length > 0 && Math.random() < 0.2) {
        const randomLetter = oldInboxLetters[Math.floor(Math.random() * oldInboxLetters.length)];
        const taReplyContent = generateTaReplyContent(randomLetter.myReply, randomLetter.content);
        
        // 添加到对话历史
        if (!randomLetter.conversationHistory) {
            randomLetter.conversationHistory = [];
        }
        
        // Ta对用户的回复进行表态
        const reaction = generateRandomTaReaction();
        if (reaction) {
            randomLetter.myReplyTaReaction = reaction;
            randomLetter.myReplyTaReactionUnread = true;
        }
        
        randomLetter.conversationHistory.push({
            type: 'taReply',
            content: taReplyContent,
            time: Date.now()
        });
        
        randomLetter.taReply = taReplyContent;
        randomLetter.taReplyStatus = 'replied';
        randomLetter.taReplyReceivedTime = Date.now();
        randomLetter.hasNewTaReply = true;
        changed = true;
        playSound('message');
        showTaReplyNotification(randomLetter, '回信');
    }
    
    if (changed) {
        saveEnvelopeData();
        if (newReplyLetter) showEnvelopeReplyPopup(newReplyLetter);
    }
    
    // 随机让Ta主动发问题（每天概率触发）
    triggerRandomTaQuestion();
    
    // 随机触发Ta对历史回复表态
    triggerRandomTaReaction();
}

// Ta主动发问题的概率控制 - 持久化到localStorage
function getTaQuestionState() {
    try {
        const saved = localStorage.getItem(getStorageKey('taQuestionState'));
        if (saved) {
            return JSON.parse(saved);
        }
    } catch(e) {}
    return { lastCheck: 0, todayCount: 0, lastDate: '' };
}

function saveTaQuestionState(state) {
    try {
        localStorage.setItem(getStorageKey('taQuestionState'), JSON.stringify(state));
    } catch(e) {}
}

function triggerRandomTaQuestion() {
    const now = Date.now();
    const notes = envelopeData.notes || [];
    
    // 检查是否已有未回答的Ta问题
    const hasUnansweredTaQuestion = notes.some(n => 
        n.type === 'taAsk' && !n.myAnswer
    );
    
    // 如果已有未回答的问题，不再发新问题
    if (hasUnansweredTaQuestion) return;
    
    // 检查最近3天内是否已经有Ta问题
    const threeDaysAgo = now - 3 * 24 * 60 * 60 * 1000;
    const hasRecentTaQuestion = notes.some(n => 
        n.type === 'taAsk' && n.sentTime > threeDaysAgo
    );
    
    // 如果3天内已经有Ta问题，不再发新问题
    if (hasRecentTaQuestion) return;
    
    // 从localStorage读取状态
    const state = getTaQuestionState();
    
    // 检查是否是新的一天，重置计数
    const today = new Date().toDateString();
    if (state.lastDate !== today) {
        state.lastDate = today;
        state.todayCount = 0;
    }
    
    // 每天最多发1个问题
    if (state.todayCount >= 1) return;
    
    // 每4小时最多检查一次
    if (now - state.lastCheck < 4 * 60 * 60 * 1000) return;
    state.lastCheck = now;
    saveTaQuestionState(state);
    
    // 15%概率触发Ta发问题（每4小时检查一次，期望每2-3天发一次）
    if (Math.random() > 0.15) return;
    
    // 确保有问题库
    if (!NOTE_QUESTIONS || NOTE_QUESTIONS.length === 0) return;
    
    // 获取一星期内已经问过的问题（7天 = 7 * 24 * 60 * 60 * 1000 毫秒）
    const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const recentQuestions = new Set();
    
    notes.forEach(n => {
        if (n.sentTime > oneWeekAgo) {
            // 主问题
            if (n.taQuestion) recentQuestions.add(n.taQuestion);
            
            // 追问的问题（nextTaQuestion）
            if (n.nextTaQuestion) recentQuestions.add(n.nextTaQuestion);
            
            // 对话历史中的追问
            if (n.conversation && n.conversation.length > 0) {
                n.conversation.forEach(item => {
                    if (item.type === 'taQuestion' && item.content) {
                        recentQuestions.add(item.content);
                    }
                });
            }
        }
    });
    
    // 从问题库中排除一星期内已经问过的
    const availableQuestions = NOTE_QUESTIONS.filter(q => !recentQuestions.has(q));
    
    // 如果没有可用的问题，就不发新问题
    if (availableQuestions.length === 0) return;
    
    // 创建新的Ta问题
    const randomQuestion = availableQuestions[Math.floor(Math.random() * availableQuestions.length)];
    const newNote = {
        id: 'taq_' + Date.now() + '_' + Math.random().toString(36).substr(2,4),
        type: 'taAsk',
        taQuestion: randomQuestion,
        sentTime: now,
        myAnswer: null,
        taResponse: null,
        conversation: [],
        hasNewReply: true
    };
    
    notes.push(newNote);
    envelopeData.notes = notes;
    
    // 更新并保存计数状态
    const currentState = getTaQuestionState();
    currentState.todayCount++;
    saveTaQuestionState(currentState);
    
    saveEnvelopeData();
    
    // 显示通知
    showTaQuestionNotification(randomQuestion);
    playSound('message');
}

// Ta随机表态的概率控制
let lastTaReactionCheck = 0;

// 随机触发Ta对历史回复表态
function triggerRandomTaReaction() {
    const now = Date.now();
    
    // 每1小时最多检查一次
    if (now - lastTaReactionCheck < 1 * 60 * 60 * 1000) return;
    lastTaReactionCheck = now;
    
    // 15%概率触发表态检查
    if (Math.random() > 0.15) return;
    
    let changed = false;
    
    // 处理收到的回信（inbox）
    (envelopeData.inbox || []).forEach(letter => {
        if (!letter.conversationHistory || letter.conversationHistory.length === 0) return;
        
        // 找出所有未表态的用户回复
        const unrepliedMyReplies = [];
        letter.conversationHistory.forEach((item, index) => {
            if (item.type === 'myReply' && !item.taReaction) {
                unrepliedMyReplies.push(index);
            }
        });
        
        if (unrepliedMyReplies.length === 0) return;
        
        // 随机选择一条进行表态
        const randomIndex = unrepliedMyReplies[Math.floor(Math.random() * unrepliedMyReplies.length)];
        const reaction = generateRandomTaReaction();
        if (reaction) {
            // 先清除该信件中所有旧的未读表态标记
            letter.conversationHistory.forEach(item => {
                if (item.taReactionUnread) item.taReactionUnread = false;
            });
            if (letter.myReplyTaReactionUnread) letter.myReplyTaReactionUnread = false;
            
            letter.conversationHistory[randomIndex].taReaction = reaction;
            letter.conversationHistory[randomIndex].taReactionUnread = true;
            changed = true;
        }
    });
    
    // 处理Ta的信（partnerLetters）
    (envelopeData.partnerLetters || []).forEach(letter => {
        if (!letter.conversationHistory || letter.conversationHistory.length === 0) return;
        
        // 找出所有未表态的用户回复
        const unrepliedMyReplies = [];
        letter.conversationHistory.forEach((item, index) => {
            if (item.type === 'myReply' && !item.taReaction) {
                unrepliedMyReplies.push(index);
            }
        });
        
        if (unrepliedMyReplies.length === 0) return;
        
        // 随机选择一条进行表态
        const randomIndex2 = unrepliedMyReplies[Math.floor(Math.random() * unrepliedMyReplies.length)];
        const reaction2 = generateRandomTaReaction();
        if (reaction2) {
            // 先清除该信件中所有旧的未读表态标记
            letter.conversationHistory.forEach(item => {
                if (item.taReactionUnread) item.taReactionUnread = false;
            });
            if (letter.myReplyTaReactionUnread) letter.myReplyTaReactionUnread = false;
            
            letter.conversationHistory[randomIndex2].taReaction = reaction2;
            letter.conversationHistory[randomIndex2].taReactionUnread = true;
            changed = true;
        }
    });
    
    if (changed) {
        saveEnvelopeData();
        renderInboxLists();
        showTaReactionNotification();
    }
}

// Ta表态通知弹窗
function showTaReactionNotification() {
    const partnerName = getPartnerName();
    const existing = document.getElementById('ta-reaction-popup');
    if (existing) existing.remove();
    
    const popup = document.createElement('div');
    popup.id = 'ta-reaction-popup';
    popup.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:var(--secondary-bg);border:1px solid var(--border-color);border-radius:16px;padding:16px 18px;z-index:8000;max-width:300px;width:85%;box-shadow:0 8px 32px rgba(0,0,0,0.12);animation:slideUpNotif 0.4s cubic-bezier(0.22,1,0.36,1);';
    popup.innerHTML = `
        <style>@keyframes slideUpNotif{from{opacity:0;transform:translateX(-50%) translateY(24px) scale(0.9)}60%{transform:translateX(-50%) translateY(-4px) scale(1.02)}to{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}}</style>
        <div style="display:flex;align-items:center;gap:10px;">
            <div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#ff6b81,#ff4757);display:flex;align-items:center;justify-content:center;">
                <span style="color:#fff;font-size:14px;font-weight:600;">♡</span>
            </div>
            <div>
                <div style="font-size:13px;font-weight:600;color:var(--text-primary);">${partnerName}对你的回信表态了</div>
                <div style="font-size:11px;color:var(--text-secondary);margin-top:2px;opacity:0.8;">去看看${partnerName}觉得怎么样~</div>
            </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:12px;">
            <button onclick="document.getElementById('ta-reaction-popup').remove();" style="flex:1;padding:8px 0;border-radius:10px;border:1px solid var(--border-color);background:var(--primary-bg);color:var(--text-secondary);font-size:13px;cursor:pointer;">稍后</button>
            <button onclick="viewLatestTaReaction();" style="flex:2;padding:8px 0;border-radius:10px;border:none;background:linear-gradient(135deg,#ff6b81,#ff4757);color:#fff;font-size:13px;font-weight:600;cursor:pointer;">去查看</button>
        </div>`;
    document.body.appendChild(popup);
    setTimeout(() => { if (popup.parentNode) popup.remove(); }, 8000);
}

// 查看最新的Ta表态
window.viewLatestTaReaction = function() {
    const popup = document.getElementById('ta-reaction-popup');
    if (popup) popup.remove();
    
    const envelopeModal = document.getElementById('envelope-modal');
    showModal(envelopeModal);
    setTimeout(() => {
        switchEnvTab('inbox');
        // 默认打开第一个有表态的信件
        const inboxLetters = envelopeData.inbox || [];
        const partnerLetters = envelopeData.partnerLetters || [];
        
        // 查找第一个有未读表态的信件
        let foundLetter = null;
        let foundSection = null;
        
        for (const letter of inboxLetters) {
            if (letter.conversationHistory && letter.conversationHistory.some(item => item.taReactionUnread)) {
                foundLetter = letter;
                foundSection = 'inbox';
                break;
            }
        }
        
        if (!foundLetter) {
            for (const letter of partnerLetters) {
                if (letter.conversationHistory && letter.conversationHistory.some(item => item.taReactionUnread)) {
                    foundLetter = letter;
                    foundSection = 'partner';
                    break;
                }
            }
        }
        
        if (foundLetter) {
            if (foundSection === 'inbox') {
                viewEnvLetter('inbox', foundLetter.id);
            } else {
                viewPartnerLetter(foundLetter.id);
            }
        }
    }, 200);
};

// Ta问题通知弹窗
function showTaQuestionNotification(question) {
    const partnerName = getPartnerName();
    const existing = document.getElementById('ta-question-popup');
    if (existing) existing.remove();
    
    const popup = document.createElement('div');
    popup.id = 'ta-question-popup';
    popup.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:var(--secondary-bg);border:1px solid var(--border-color);border-radius:16px;padding:16px 18px;z-index:8000;max-width:300px;width:85%;box-shadow:0 8px 32px rgba(0,0,0,0.12);animation:slideUpNotif 0.4s cubic-bezier(0.22,1,0.36,1);';
    popup.innerHTML = `
        <style>@keyframes slideUpNotif{from{opacity:0;transform:translateX(-50%) translateY(24px) scale(0.9)}60%{transform:translateX(-50%) translateY(-4px) scale(1.02)}to{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}}</style>
        <div style="display:flex;align-items:center;gap:10px;">
            <div style="width:36px;height:36px;border-radius:50%;background:rgba(var(--accent-color-rgb),0.15);display:flex;align-items:center;justify-content:center;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent-color)" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            </div>
            <div>
                <div style="font-size:13px;font-weight:600;color:var(--text-primary);">${partnerName}想问你一个问题</div>
                <div style="font-size:11px;color:var(--text-secondary);margin-top:2px;opacity:0.8;">${question.length > 20 ? question.substring(0, 20) + '…' : question}</div>
            </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:12px;">
            <button onclick="document.getElementById('ta-question-popup').remove();" style="flex:1;padding:8px 0;border-radius:10px;border:1px solid var(--border-color);background:var(--primary-bg);color:var(--text-secondary);font-size:13px;cursor:pointer;">稍后</button>
            <button onclick="viewLatestTaQuestion();" style="flex:2;padding:8px 0;border-radius:10px;border:none;background:var(--accent-color);color:#fff;font-size:13px;font-weight:600;cursor:pointer;">去回答</button>
        </div>`;
    document.body.appendChild(popup);
    setTimeout(() => { if (popup.parentNode) popup.remove(); }, 10000);
}

// 查看最新的Ta问题
window.viewLatestTaQuestion = function() {
    const popup = document.getElementById('ta-question-popup');
    if (popup) popup.remove();
    
    const notes = envelopeData.notes || [];
    const latestTaQuestion = notes.filter(n => n.type === 'taAsk' && !n.myAnswer).pop();
    
    if (latestTaQuestion) {
        const envelopeModal = document.getElementById('envelope-modal');
        showModal(envelopeModal);
        setTimeout(() => {
            switchEnvTab('outbox');
            switchNoteTab('taAsk');
            viewNote(latestTaQuestion.id);
        }, 200);
    }
};

// 小纸条回复弹窗
function showNoteReplyPopup(note) {
    const partnerName = getPartnerName();
    const existing = document.getElementById('note-reply-popup');
    if (existing) existing.remove();
    
    const popup = document.createElement('div');
    popup.id = 'note-reply-popup';
    popup.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:var(--secondary-bg);border:1px solid var(--border-color);border-radius:16px;padding:16px 18px;z-index:8000;max-width:300px;width:85%;box-shadow:0 8px 32px rgba(0,0,0,0.12);animation:slideUpNotif 0.4s cubic-bezier(0.22,1,0.36,1);';
    popup.innerHTML = `
        <style>@keyframes slideUpNotif{from{opacity:0;transform:translateX(-50%) translateY(24px) scale(0.9)}60%{transform:translateX(-50%) translateY(-4px) scale(1.02)}to{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}}</style>
        <div style="display:flex;align-items:center;gap:10px;">
            <div style="width:36px;height:36px;border-radius:50%;background:rgba(var(--accent-color-rgb),0.15);display:flex;align-items:center;justify-content:center;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent-color)" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 7L2 7"/></svg>
            </div>
            <div>
                <div style="font-size:13px;font-weight:600;color:var(--text-primary);">${partnerName}回复了你的小纸条</div>
                <div style="font-size:11px;color:var(--text-secondary);margin-top:2px;opacity:0.8;">去看看${partnerName}说了什么</div>
            </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:12px;">
            <button onclick="document.getElementById('note-reply-popup').remove();" style="flex:1;padding:8px 0;border-radius:10px;border:1px solid var(--border-color);background:var(--primary-bg);color:var(--text-secondary);font-size:13px;cursor:pointer;">稍后</button>
            <button onclick="viewNoteReply('${note.id}');" style="flex:2;padding:8px 0;border-radius:10px;border:none;background:var(--accent-color);color:#fff;font-size:13px;font-weight:600;cursor:pointer;">立即查看</button>
        </div>`;
    document.body.appendChild(popup);
    setTimeout(() => { if (popup.parentNode) popup.remove(); }, 8000);
}

// 查看小纸条回复
window.viewNoteReply = function(noteId) {
    const popup = document.getElementById('note-reply-popup');
    if (popup) popup.remove();
    
    const envelopeModal = document.getElementById('envelope-modal');
    showModal(envelopeModal);
    setTimeout(() => {
        switchEnvTab('outbox');
        viewNote(noteId);
    }, 200);
};

// 生成小纸条回复（更短更随意）+ 带问题
function generateNoteReplyText() {
    const replies = (typeof customReplies !== 'undefined' && customReplies.length > 0) ? customReplies : ['嗯嗯', '好的', '收到~', '知道啦'];
    const emojis = ['💕', '✨', '🌙', '💖', '🥰', '😊', '💝', '⭐', '🌸', '🦋'];
    
    // 小纸条回复更短：1-3句话
    const sentenceCount = Math.floor(Math.random() * 3) + 1;
    let replyContent = "";
    
    for (let i = 0; i < sentenceCount; i++) {
        const randomSentence = replies[Math.floor(Math.random() * replies.length)];
        const punctuation = Math.random() < 0.4 ? "~" : (Math.random() < 0.3 ? "！" : "。");
        replyContent += randomSentence + punctuation;
    }
    
    // 随机添加emoji
    if (Math.random() < 0.6) {
        const emojiCount = Math.floor(Math.random() * 2) + 1;
        for (let i = 0; i < emojiCount; i++) {
            replyContent += " " + emojis[Math.floor(Math.random() * emojis.length)];
        }
    }
    
    return replyContent;
}

// 小纸条默认问题库
const DEFAULT_NOTE_QUESTIONS = [
    "你今天心情怎么样呀？",
    "最近有什么开心的事吗？",
    "有没有想我呀？💕",
    "你最想做什么现在？",
    "给我讲讲你今天的事？",
    "你喜欢什么样的天气？",
    "如果我出现在你面前，你最想做什么？",
    "你觉得什么颜色最适合我？",
    "你最喜欢的歌是什么？",
    "你想去哪里旅行？",
    "你今天吃了什么好吃的？",
    "最近在看什么剧或书？",
    "你最珍视的回忆是什么？",
    "你会为了我做什么？",
    "你觉得我们最有默契的瞬间？",
    "你想和我一起做什么事？",
    "你睡觉前会想什么？",
    "你有什么小愿望吗？",
    "你觉得幸福是什么？",
    "你想对我说什么悄悄话？"
];

// 当前使用的问题库（会被用户自定义覆盖）
let NOTE_QUESTIONS = [...DEFAULT_NOTE_QUESTIONS];

// 加载用户自定义问题库
async function loadNoteQuestions() {
    try {
        const customQuestions = await localforage.getItem(getStorageKey('noteQuestions'));
        if (customQuestions && Array.isArray(customQuestions) && customQuestions.length > 0) {
            NOTE_QUESTIONS = customQuestions;
        }
    } catch (e) {
        console.warn('加载问题库失败:', e);
    }
}

// 保存问题库
async function saveNoteQuestions() {
    try {
        await localforage.setItem(getStorageKey('noteQuestions'), NOTE_QUESTIONS);
    } catch (e) {
        console.warn('保存问题库失败:', e);
    }
}

// 打开问题库管理界面
window.openNoteQuestionsManager = function(event) {
    if (event) event.stopPropagation();
    loadNoteQuestions().then(() => {
        renderNoteQuestionsList();
        showModal(document.getElementById('note-questions-modal'));
    });
};

// 渲染问题列表
window.renderNoteQuestionsList = function() {
    const list = document.getElementById('note-questions-list');
    if (!list) return;
    
    if (NOTE_QUESTIONS.length === 0) {
        list.innerHTML = `
            <div style="text-align:center;padding:24px;color:var(--text-secondary);">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" stroke-width="1.5" style="opacity:0.5;margin-bottom:8px;"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                <div style="font-size:13px;">暂无问题</div>
                <div style="font-size:11px;opacity:0.7;margin-top:4px;">添加一些问题让互动更有趣</div>
            </div>
        `;
        return;
    }
    
    list.innerHTML = NOTE_QUESTIONS.map((q, index) => `
        <div style="display:flex;align-items:center;gap:10px;padding:12px 14px;background:var(--primary-bg);border-radius:var(--radius-xs);margin-bottom:8px;border:1px solid var(--border-color);transition:var(--transition);" onmouseover="this.style.borderColor='rgba(var(--accent-color-rgb),0.3)'" onmouseout="this.style.borderColor='var(--border-color)'">
            <span style="font-size:11px;color:var(--accent-color);font-weight:600;min-width:22px;height:22px;background:rgba(var(--accent-color-rgb),0.1);border-radius:50%;display:flex;align-items:center;justify-content:center;">${index + 1}</span>
            <span style="flex:1;font-size:13px;color:var(--text-primary);line-height:1.5;">${q}</span>
            <button onclick="deleteNoteQuestion(${index})" title="删除" style="width:28px;height:28px;border:none;background:transparent;border-radius:var(--radius-xs);cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:var(--transition);" onmouseover="this.style.background='rgba(244,67,54,0.1)'" onmouseout="this.style.background='transparent'">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
        </div>
    `).join('');
};

// 添加问题
window.addNoteQuestion = function() {
    const input = document.getElementById('new-question-input');
    const question = input ? input.value.trim() : '';
    
    if (!question) {
        showNotification('请输入问题内容', 'warning');
        return;
    }
    
    if (question.length > 50) {
        showNotification('问题太长了，请控制在50字以内', 'warning');
        return;
    }
    
    NOTE_QUESTIONS.push(question);
    saveNoteQuestions();
    renderNoteQuestionsList();
    
    if (input) input.value = '';
    showNotification('问题已添加', 'success');
};

// 删除问题
window.deleteNoteQuestion = function(index) {
    if (index < 0 || index >= NOTE_QUESTIONS.length) return;
    
    NOTE_QUESTIONS.splice(index, 1);
    saveNoteQuestions();
    renderNoteQuestionsList();
    showNotification('问题已删除', 'success');
};

// 恢复默认问题库
window.resetNoteQuestions = function() {
    if (!confirm('确定要恢复默认问题库吗？你的自定义问题将被清除。')) return;
    
    NOTE_QUESTIONS = [...DEFAULT_NOTE_QUESTIONS];
    saveNoteQuestions();
    renderNoteQuestionsList();
    showNotification('已恢复默认问题库', 'success');
};

// 生成小纸条回复对象（包含问题）
function generateNoteReply() {
    const reply = generateNoteReplyText();
    const question = NOTE_QUESTIONS[Math.floor(Math.random() * NOTE_QUESTIONS.length)];
    
    return {
        reply: reply,
        question: question
    };
}

// 生成对用户回答的回应 - 使用主字卡内容
function generateNoteAnswerResponse(answer) {
    // 使用主字卡内容生成回复
    const sourcePool = (typeof customReplies !== 'undefined' && customReplies.length > 0) ? customReplies : ['嗯嗯', '好的', '知道了', '明白啦'];
    
    // 生成2-4句话的回复
    const sentenceCount = Math.floor(Math.random() * 3) + 2;
    let responseContent = "";
    
    for (let i = 0; i < sentenceCount; i++) {
        const randomSentence = sourcePool[Math.floor(Math.random() * sourcePool.length)];
        const punctuation = Math.random() < 0.3 ? "~" : (Math.random() < 0.2 ? "…" : "。");
        responseContent += randomSentence + punctuation;
    }
    
    return {
        response: responseContent,
        hasQuestion: Math.random() < 0.1  // 10%概率继续问（大幅降低）
    };
}

function showEnvelopeReplyPopup(letter) {
    const existing = document.getElementById('envelope-reply-popup');
    if (existing) existing.remove();
    const popup = document.createElement('div');
    popup.id = 'envelope-reply-popup';
    popup.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:var(--secondary-bg);border:1px solid var(--border-color);border-radius:20px;padding:18px 20px;z-index:8000;max-width:320px;width:88%;box-shadow:0 8px 32px rgba(0,0,0,0.18);display:flex;flex-direction:column;gap:12px;animation:slideUpNotif 0.4s cubic-bezier(0.22,1,0.36,1);';
    popup.innerHTML = `
        <style>@keyframes slideUpNotif{from{opacity:0;transform:translateX(-50%) translateY(24px) scale(0.9)}60%{transform:translateX(-50%) translateY(-4px) scale(1.02)}to{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}}</style>
        <div style="display:flex;align-items:center;gap:10px;">
            <span style="font-size:26px;">💌</span>
            <div>
                <div style="font-size:14px;font-weight:700;color:var(--text-primary);">收到了一封回信</div>
                <div style="font-size:11px;color:var(--text-secondary);margin-top:2px;opacity:0.8;">Ta 给你写了回信，快去看看吧~</div>
            </div>
        </div>
        <div style="display:flex;gap:8px;">
            <button onclick="document.getElementById('envelope-reply-popup').remove();" style="flex:1;padding:8px 0;border-radius:12px;border:1px solid var(--border-color);background:var(--primary-bg);color:var(--text-secondary);font-size:13px;cursor:pointer;">稍后查看</button>
            <button onclick="openEnvelopeAndViewReply('${letter.id}');" style="flex:2;padding:8px 0;border-radius:12px;border:none;background:var(--accent-color);color:#fff;font-size:13px;font-weight:600;cursor:pointer;">立即阅读 ✉</button>
        </div>`;
    document.body.appendChild(popup);
    setTimeout(() => { if (popup.parentNode) popup.remove(); }, 8000);
}

const APPEARANCE_PANEL_TITLES = {
    'theme': '主题配色', 'font': '字体设置', 'background': '聊天背景',
    'bubble': '气泡样式', 'avatar': '聊天头像', 'css': '自定义CSS',
    'font-bg': '背景 & 字体', 'bubble-css': '气泡 & CSS'
};
window.showAppearancePanel = function(panel) {
    const panelMap = {
        'font-bg': ['font', 'background'],
        'bubble-css': ['bubble', 'css']
    };
    document.getElementById('appearance-nav-grid').style.display = 'none';
    var unBtn = document.getElementById('update-notice-btn');
    if (unBtn) unBtn.style.display = 'none';
    var galleryBanner = document.getElementById('gallery-banner-entry');
    if (galleryBanner) galleryBanner.style.display = 'none';
    document.getElementById('appearance-panel-container').style.display = 'block';
    document.getElementById('appearance-panel-title').textContent = APPEARANCE_PANEL_TITLES[panel] || panel;
    document.querySelectorAll('.appearance-sub-panel').forEach(p => p.style.display = 'none');
    if (panelMap[panel]) {
        panelMap[panel].forEach(sub => {
            const target = document.getElementById('appearance-panel-' + sub);
            if (target) target.style.display = 'block';
        });
    } else {
        const target = document.getElementById('appearance-panel-' + panel);
        if (target) target.style.display = 'block';
    }
    if (panel === 'bubble' || panel === 'bubble-css') { setTimeout(() => { if (typeof window.updateBubblePreviewFn === 'function') window.updateBubblePreviewFn(); }, 50); }
};
window.hideAppearancePanel = function() {
    document.getElementById('appearance-nav-grid').style.display = 'grid';
    document.getElementById('appearance-panel-container').style.display = 'none';
    document.querySelectorAll('.appearance-sub-panel').forEach(p => p.style.display = 'none');
    var unBtn = document.getElementById('update-notice-btn');
    if (unBtn) unBtn.style.display = 'flex';
    var galleryBanner = document.getElementById('gallery-banner-entry');
    if (galleryBanner) galleryBanner.style.display = 'flex';
};

window.openEnvelopeAndViewReply = function(replyId) {
    const popup = document.getElementById('envelope-reply-popup');
    if (popup) popup.remove();
    const envelopeModal = document.getElementById('envelope-modal');
    showModal(envelopeModal);
    setTimeout(() => {
        switchEnvTab('inbox');
        viewEnvLetter('inbox', replyId);
    }, 200);
};

function generateEnvelopeReplyText() {
    const sourcePool = [...customReplies];
    const sentenceCount = Math.floor(Math.random() * (12 - 8 + 1)) + 8;
    let replyContent = "";
    for (let i = 0; i < sentenceCount; i++) {
        const randomSentence = sourcePool[Math.floor(Math.random() * sourcePool.length)];
        const punctuation = Math.random() < 0.2 ? "！" : (Math.random() < 0.2 ? "..." : "。");
        replyContent += randomSentence + punctuation;
    }
    return replyContent;
}


window.switchEnvTab = function(tab) {
    currentEnvTab = tab;
    document.getElementById('env-tab-outbox').classList.toggle('active', tab === 'outbox');
    document.getElementById('env-tab-inbox').classList.toggle('active', tab === 'inbox');
    document.getElementById('env-outbox-section').style.display = tab === 'outbox' ? 'block' : 'none';
    document.getElementById('env-inbox-section').style.display = tab === 'inbox' ? 'block' : 'none';
    document.getElementById('env-compose-form').style.display = 'none';
    document.getElementById('env-note-compose-form').style.display = 'none';
    document.getElementById('env-main-close-btn').style.display = 'flex';
    if (tab === 'inbox') {
        renderInboxLists();
    } else {
        renderEnvelopeLists();
    }
};

window.switchInboxSubTab = function(subTab) {
    currentInboxSubTab = subTab;
    document.getElementById('env-inbox-reply-btn').classList.toggle('active', subTab === 'reply');
    document.getElementById('env-inbox-letter-btn').classList.toggle('active', subTab === 'letter');
    document.getElementById('env-inbox-he-favorite-btn').classList.toggle('active', subTab === 'heFavorite');
    document.getElementById('env-inbox-reply-list').style.display = subTab === 'reply' ? 'block' : 'none';
    document.getElementById('env-inbox-letter-list').style.display = subTab === 'letter' ? 'block' : 'none';
    document.getElementById('env-inbox-he-favorite-list').style.display = subTab === 'heFavorite' ? 'block' : 'none';
};

function renderEnvelopeLists() {
    renderNotesLists();
    renderLetterLists(); // 渲染信件抽屉
    const pendingCount = envelopeData.outbox.filter(l => l.status === 'pending').length;
    const notePendingCount = (envelopeData.notes || []).filter(n => n.status === 'pending').length;
    const outboxBadge = document.getElementById('env-outbox-badge');
    if (outboxBadge) { 
        const totalCount = pendingCount + notePendingCount;
        outboxBadge.textContent = totalCount; 
        outboxBadge.style.display = totalCount > 0 ? 'inline-block' : 'none'; 
    }
}

function renderInboxLists() {
    renderInboxReplyList();
    renderInboxLetterList();
    renderHeFavoriteList();
    
    // 更新徽章计数
    const replyCount = envelopeData.inbox.filter(l => !l.fromPartner).length;
    const letterCount = (envelopeData.partnerLetters || []).length;
    
    const replyBadge = document.getElementById('env-inbox-reply-count');
    if (replyBadge) {
        replyBadge.textContent = replyCount;
        replyBadge.style.display = replyCount > 0 ? 'inline-block' : 'none';
    }
    
    const letterBadge = document.getElementById('env-inbox-letter-count');
    if (letterBadge) {
        letterBadge.textContent = letterCount;
        letterBadge.style.display = letterCount > 0 ? 'inline-block' : 'none';
    }
    
    // 收藏计数（用户寄出的信中被对方收藏的）
    const heFavoriteCount = (envelopeData.outbox || []).filter(l => l.heFavorite).length;
    const heFavoriteBadge = document.getElementById('env-inbox-he-favorite-count');
    if (heFavoriteBadge) {
        heFavoriteBadge.textContent = heFavoriteCount;
        heFavoriteBadge.style.display = heFavoriteCount > 0 ? 'inline-block' : 'none';
    }
    
    // 原有的总徽章逻辑
    const newReplyCount = envelopeData.inbox.filter(l => l.isNew).length;
    const newLetterCount = (envelopeData.partnerLetters || []).filter(l => l.isNew).length;
    const newTaReplyCount = (envelopeData.partnerLetters || []).filter(l => l.hasNewTaReply).length;
    const inboxTaReplyCount = envelopeData.inbox.filter(l => l.hasNewTaReply).length;
    const totalCount = newReplyCount + newLetterCount + newTaReplyCount + inboxTaReplyCount;
    const inboxBadge = document.getElementById('env-inbox-badge');
    if (inboxBadge) { inboxBadge.textContent = totalCount; inboxBadge.style.display = totalCount > 0 ? 'inline-block' : 'none'; }
}

function renderInboxReplyList() {
    const list = document.getElementById('env-inbox-reply-list');
    if (!list) return;
    
    const replies = envelopeData.inbox.filter(l => !l.fromPartner);
    
    if (replies.length === 0) {
        list.innerHTML = `<div class="env-empty">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 7L2 7"/><polyline points="22 13 12 13"/><path d="M19 16l-5-3-5 3"/></svg>
            <div style="font-size:14px;font-weight:500;margin-top:4px;">还没有收到回信</div>
            <div style="font-size:12px;margin-top:6px;opacity:0.6;">你寄出的信会在这里收到回复~</div>
        </div>`;
        return;
    }
    
    // 按月份分组
    const grouped = {};
    replies.slice().reverse().forEach(letter => {
        const date = new Date(letter.receivedTime);
        const monthKey = `reply-${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        const monthTitle = date.toLocaleDateString('zh-CN', {year: 'numeric', month: 'long'});
        
        if (!grouped[monthKey]) {
            grouped[monthKey] = { title: monthTitle, letters: [] };
        }
        grouped[monthKey].letters.push(letter);
    });
    
    // 渲染
    let html = '';
    Object.keys(grouped).sort().reverse().forEach(monthKey => {
        const group = grouped[monthKey];
        const isCollapsed = inboxReplyMonthCollapsed[monthKey];
        
        html += `
        <div class="env-letter-month-group">
            <div class="env-letter-month-header" onclick="toggleInboxReplyMonth('${monthKey}', event)">
                <div class="env-letter-month-arrow ${isCollapsed ? 'collapsed' : ''}" id="inbox-reply-month-arrow-${monthKey}">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                </div>
                <span class="env-letter-month-title">${group.title}</span>
                <span class="env-letter-month-count">${group.letters.length} 封</span>
            </div>
            <div class="env-letter-month-content ${isCollapsed ? 'collapsed' : ''}" id="inbox-reply-month-content-${monthKey}" style="max-height: ${isCollapsed ? '0' : group.letters.length * 150 + 'px'};">
                ${group.letters.map(letter => renderInboxReplyItem(letter)).join('')}
            </div>
        </div>`;
    });
    
    list.innerHTML = html;
}

// 渲染他的回信单个卡片
function renderInboxReplyItem(letter) {
    const date = new Date(letter.receivedTime).toLocaleDateString('zh-CN', {month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit'});
    const preview = letter.content.length > 50 ? letter.content.substring(0, 50) + '…' : letter.content;
    const isNew = letter.isNew;
    const hasNewReply = letter.hasNewTaReply;
    const hasReply = letter.myReply;
    const conversationCount = (letter.conversationHistory || []).length;
    const origPreview = letter.originalContent ? (letter.originalContent.length > 32 ? letter.originalContent.substring(0, 32) + '…' : letter.originalContent) : '';
    const isFavorite = letter.favorite;
    const partnerName = getPartnerName();
    
    // 检查是否有Ta对用户回复的表态，统计未读数量和最新表态类型
    let hasTaReaction = false;
    let taReactionType = null;
    let latestTaReactionTime = 0; // 最新表态的时间戳
    let unreadTaReactionCount = 0;
    if (letter.conversationHistory && letter.conversationHistory.length > 0) {
        // 遍历所有表态，找到时间最新的那个
        for (let i = 0; i < letter.conversationHistory.length; i++) {
            const item = letter.conversationHistory[i];
            if (item.type === 'myReply' && item.taReaction) {
                hasTaReaction = true;
                // 获取表态时间（用回复时间或当前时间）
                const reactionTime = item.time || letter.receivedTime || 0;
                // 如果这个表态更新，则更新最新表态类型
                if (reactionTime >= latestTaReactionTime) {
                    latestTaReactionTime = reactionTime;
                    taReactionType = item.taReaction;
                }
                // 统计未读数量
                if (item.taReactionUnread) {
                    unreadTaReactionCount++;
                }
            }
        }
    } else if (letter.myReplyTaReaction) {
        hasTaReaction = true;
        taReactionType = letter.myReplyTaReaction;
        if (letter.myReplyTaReactionUnread) {
            unreadTaReactionCount = 1;
        }
    }
    
    // 判断是否可以点击"我要回信"或"继续回信"
    const hasConversation = letter.conversationHistory && letter.conversationHistory.length > 0;
    const lastItem = hasConversation ? letter.conversationHistory[letter.conversationHistory.length - 1] : null;
    const canReply = letter.taReplyStatus !== 'pending' && 
        (!letter.myReply || letter.taReply || (lastItem && lastItem.type === 'taReply'));
    
    const reactionInfo = getTaReactionDisplayInfo(taReactionType);
    const taReactionText = reactionInfo.text;
    const taReactionStyle = reactionInfo.style;
    // 未读表态时添加发光效果
    const taReactionGlow = unreadTaReactionCount > 0 ? 'animation:reactionPulse 1.5s ease-in-out infinite;' : '';
    
    return `
    <style>@keyframes reactionPulse{0%,100%{box-shadow:0 2px 8px rgba(255,71,87,0.4);}50%{box-shadow:0 2px 12px rgba(255,71,87,0.7);}}</style>
    <div class="env-letter-item reply ${isNew ? 'env-letter-new' : ''} ${hasNewReply ? 'has-new-ta-reply' : ''}" onclick="viewEnvLetter('inbox','${letter.id}')" style="position:relative;border-left:3px solid rgba(var(--accent-color-rgb),0.6);${hasNewReply ? 'box-shadow:0 0 12px rgba(255,107,107,0.3);' : ''}">
        ${hasNewReply ? '<div style="position:absolute;top:6px;right:8px;width:10px;height:10px;background:#ff6b6b;border-radius:50%;box-shadow:0 1px 3px rgba(255,107,107,0.5);z-index:1;"></div>' : ''}
        ${unreadTaReactionCount > 0 ? `<div style="position:absolute;top:4px;right:6px;min-width:16px;height:16px;background:linear-gradient(135deg,#ff6b81,#ff4757);border-radius:8px;box-shadow:0 2px 6px rgba(255,71,87,0.6);z-index:2;display:flex;align-items:center;justify-content:center;font-size:9px;color:#fff;font-weight:600;padding:0 4px;">${unreadTaReactionCount}</div>` : ''}
        <div class="env-letter-header" style="padding:3px 12px;">
            <div class="env-letter-header-from">
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px;margin-right:3px;"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 7L2 7"/></svg>
                收到 · ${date}
                ${isNew ? '<span style="background:rgba(255,255,255,0.3);color:#fff;font-size:9px;padding:1px 5px;border-radius:6px;margin-left:6px;">新</span>' : ''}
                ${hasNewReply ? '<span style="background:rgba(255,107,107,0.9);color:#fff;font-size:9px;padding:1px 5px;border-radius:6px;margin-left:4px;">有新回复</span>' : ''}
                ${hasTaReaction ? `<span style="${taReactionStyle}${taReactionGlow}color:#fff;font-size:9px;padding:1px 5px;border-radius:6px;margin-left:4px;">${partnerName}觉得${taReactionText}${unreadTaReactionCount > 1 ? ' +' + (unreadTaReactionCount - 1) : ''}</span>` : ''}
                ${canReply ? '<span style="background:rgba(120,160,130,0.85);color:#fff;font-size:9px;padding:1px 5px;border-radius:6px;margin-left:4px;">待回复</span>' : (hasReply && !hasNewReply ? '<span style="background:rgba(100,149,237,0.4);color:#fff;font-size:9px;padding:1px 5px;border-radius:6px;margin-left:4px;">已回信</span>' : '')}
                ${conversationCount > 0 ? '<span style="background:rgba(156,39,176,0.3);color:#fff;font-size:9px;padding:1px 5px;border-radius:6px;margin-left:4px;">对话 ' + conversationCount + ' 条</span>' : ''}
            </div>
            <span class="env-favorite-icon ${isFavorite ? 'favorited' : ''}" onclick="toggleLetterFavorite('inbox','${letter.id}',event)" style="cursor:pointer;font-size:26px;color:${isFavorite ? '#FFB800' : 'rgba(255,255,255,0.95)'};" title="${isFavorite ? '取消收藏' : '收藏'}">✦</span>
        </div>
        ${origPreview ? `<div style="padding:6px 12px 0;display:flex;align-items:flex-start;gap:6px;"><div style="width:2px;border-radius:2px;background:rgba(var(--accent-color-rgb),0.4);flex-shrink:0;align-self:stretch;min-height:14px;margin-top:1px;"></div><div style="font-size:11px;color:var(--text-secondary);font-style:italic;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:calc(100% - 14px);opacity:0.75;">原信: ${origPreview}</div></div>` : ''}
        <div class="env-letter-body">
            <div class="env-letter-preview">${preview}</div>
        </div>
        <button class="env-letter-delete-btn" onclick="deleteEnvLetter(event,'inbox','${letter.id}')">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
    </div>`;
}

function renderInboxLetterList() {
    const list = document.getElementById('env-inbox-letter-list');
    if (!list) return;
    
    const letters = envelopeData.partnerLetters || [];
    
    if (letters.length === 0) {
        list.innerHTML = `<div class="env-empty">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            <div style="font-size:14px;font-weight:500;margin-top:4px;">还没有收到Ta的信</div>
            <div style="font-size:12px;margin-top:6px;opacity:0.6;">Ta每天会随机写2-4封信给你哦~</div>
        </div>`;
        return;
    }
    
    // 按月份分组
    const grouped = {};
    letters.slice().reverse().forEach(letter => {
        const date = new Date(letter.receivedTime);
        const monthKey = `letter-${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        const monthTitle = date.toLocaleDateString('zh-CN', {year: 'numeric', month: 'long'});
        
        if (!grouped[monthKey]) {
            grouped[monthKey] = { title: monthTitle, letters: [] };
        }
        grouped[monthKey].letters.push(letter);
    });
    
    // 渲染
    let html = '';
    Object.keys(grouped).sort().reverse().forEach(monthKey => {
        const group = grouped[monthKey];
        const isCollapsed = inboxLetterMonthCollapsed[monthKey];
        
        html += `
        <div class="env-letter-month-group">
            <div class="env-letter-month-header" onclick="toggleInboxLetterMonth('${monthKey}', event)">
                <div class="env-letter-month-arrow ${isCollapsed ? 'collapsed' : ''}" id="inbox-letter-month-arrow-${monthKey}">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                </div>
                <span class="env-letter-month-title">${group.title}</span>
                <span class="env-letter-month-count">${group.letters.length} 封</span>
            </div>
            <div class="env-letter-month-content ${isCollapsed ? 'collapsed' : ''}" id="inbox-letter-month-content-${monthKey}" style="max-height: ${isCollapsed ? '0' : group.letters.length * 150 + 'px'};">
                ${group.letters.map(letter => renderInboxLetterItem(letter)).join('')}
            </div>
        </div>`;
    });
    
    list.innerHTML = html;
}

// 渲染他写的信单个卡片
function renderInboxLetterItem(letter) {
    const date = new Date(letter.receivedTime).toLocaleDateString('zh-CN', {month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit'});
    const preview = letter.content.length > 60 ? letter.content.substring(0, 60) + '…' : letter.content;
    const isNew = letter.isNew;
    const hasReply = letter.myReply;
    const hasNewReply = letter.hasNewTaReply;
    const conversationCount = (letter.conversationHistory || []).length;
    const isFavorite = letter.favorite;
    const partnerName = getPartnerName();
    
    // 检查是否有Ta对用户回复的表态，统计未读数量和最新表态类型
    let hasTaReaction = false;
    let taReactionType = null;
    let latestTaReactionTime = 0; // 最新表态的时间戳
    let unreadTaReactionCount = 0;
    if (letter.conversationHistory && letter.conversationHistory.length > 0) {
        // 遍历所有表态，找到时间最新的那个
        for (let i = 0; i < letter.conversationHistory.length; i++) {
            const item = letter.conversationHistory[i];
            if (item.type === 'myReply' && item.taReaction) {
                hasTaReaction = true;
                // 获取表态时间（用回复时间或当前时间）
                const reactionTime = item.time || letter.receivedTime || 0;
                // 如果这个表态更新，则更新最新表态类型
                if (reactionTime >= latestTaReactionTime) {
                    latestTaReactionTime = reactionTime;
                    taReactionType = item.taReaction;
                }
                // 统计未读数量
                if (item.taReactionUnread) {
                    unreadTaReactionCount++;
                }
            }
        }
    } else if (letter.myReplyTaReaction) {
        hasTaReaction = true;
        taReactionType = letter.myReplyTaReaction;
        if (letter.myReplyTaReactionUnread) {
            unreadTaReactionCount = 1;
        }
    }
    
    // 判断是否可以点击"我要回信"或"继续回信"
    const hasConversation = letter.conversationHistory && letter.conversationHistory.length > 0;
    const lastItem = hasConversation ? letter.conversationHistory[letter.conversationHistory.length - 1] : null;
    const canReply = letter.taReplyStatus !== 'pending' && 
        (!letter.myReply || letter.taReply || (lastItem && lastItem.type === 'taReply'));
    
    const reactionInfo = getTaReactionDisplayInfo(taReactionType);
    const taReactionText = reactionInfo.text;
    const taReactionStyle = reactionInfo.style;
    // 未读表态时添加发光效果
    const taReactionGlow = unreadTaReactionCount > 0 ? 'animation:reactionPulse 1.5s ease-in-out infinite;' : '';
    
    return `
    <style>@keyframes reactionPulse{0%,100%{box-shadow:0 2px 8px rgba(255,71,87,0.4);}50%{box-shadow:0 2px 12px rgba(255,71,87,0.7);}}</style>
    <div class="env-letter-item partner ${isNew ? 'env-letter-new' : ''} ${hasNewReply ? 'has-new-ta-reply' : ''}" onclick="viewPartnerLetter('${letter.id}')" style="position:relative;border-left:3px solid rgba(var(--accent-color-rgb),0.6);${hasNewReply ? 'box-shadow:0 0 12px rgba(255,107,107,0.3);' : ''}">
        ${hasNewReply ? '<div style="position:absolute;top:6px;right:8px;width:10px;height:10px;background:#ff6b6b;border-radius:50%;box-shadow:0 1px 3px rgba(255,107,107,0.5);z-index:1;"></div>' : ''}
        ${unreadTaReactionCount > 0 ? `<div style="position:absolute;top:4px;left:6px;min-width:16px;height:16px;background:linear-gradient(135deg,#ff6b81,#ff4757);border-radius:8px;box-shadow:0 2px 6px rgba(255,71,87,0.6);z-index:2;display:flex;align-items:center;justify-content:center;font-size:9px;color:#fff;font-weight:600;padding:0 4px;">${unreadTaReactionCount}</div>` : ''}
        <div class="env-letter-header" style="padding:3px 12px;">
            <div class="env-letter-header-from">
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px;margin-right:3px;"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                ${partnerName}的信 · ${date}
                ${isNew ? '<span style="background:rgba(255,255,255,0.3);color:#fff;font-size:9px;padding:1px 5px;border-radius:6px;margin-left:6px;">新</span>' : ''}
                ${hasNewReply ? '<span style="background:rgba(255,107,107,0.9);color:#fff;font-size:9px;padding:1px 5px;border-radius:6px;margin-left:4px;">有新回复</span>' : ''}
                ${hasTaReaction ? `<span style="${taReactionStyle}${taReactionGlow}color:#fff;font-size:9px;padding:1px 5px;border-radius:6px;margin-left:4px;">${partnerName}觉得${taReactionText}${unreadTaReactionCount > 1 ? ' +' + (unreadTaReactionCount - 1) : ''}</span>` : ''}
                ${canReply ? '<span style="background:rgba(120,160,130,0.85);color:#fff;font-size:9px;padding:1px 5px;border-radius:6px;margin-left:4px;">待回复</span>' : (hasReply && !hasNewReply ? '<span style="background:rgba(100,149,237,0.4);color:#fff;font-size:9px;padding:1px 5px;border-radius:6px;margin-left:4px;">已回信</span>' : '')}
                ${conversationCount > 0 ? '<span style="background:rgba(156,39,176,0.3);color:#fff;font-size:9px;padding:1px 5px;border-radius:6px;margin-left:4px;">对话 ' + conversationCount + ' 条</span>' : ''}
            </div>
            <span class="env-favorite-icon ${isFavorite ? 'favorited' : ''}" onclick="toggleLetterFavorite('partner','${letter.id}',event)" style="cursor:pointer;font-size:26px;color:${isFavorite ? '#FFB800' : 'rgba(255,255,255,0.95)'};" title="${isFavorite ? '取消收藏' : '收藏'}">✦</span>
        </div>
        <div class="env-letter-body">
            <div class="env-letter-preview">${preview}</div>
        </div>
        <button class="env-letter-delete-btn" onclick="deletePartnerLetter(event,'${letter.id}')">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
    </div>`;
}

// 渲染他收藏的信件列表（只读，用户无法修改）
function renderHeFavoriteList() {
    const list = document.getElementById('env-inbox-he-favorite-list');
    if (!list) return;
    
    // 收集他收藏的信件（用户寄出的信中被对方收藏的）
    const heFavoriteLetters = (envelopeData.outbox || [])
        .filter(l => l.heFavorite)
        .map(l => ({
            ...l,
            time: l.heFavoriteTime || l.sentTime
        }));
    
    if (heFavoriteLetters.length === 0) {
        list.innerHTML = `<div class="env-empty">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
            <div style="font-size:14px;font-weight:500;margin-top:4px;">⊹✦这里还没有信件✦⊹</div>
            <div style="font-size:12px;margin-top:6px;opacity:0.6;">一封信，一颗心</div>
        </div>`;
        return;
    }
    
    // 按时间排序
    heFavoriteLetters.sort((a, b) => b.time - a.time);
    
    // 按月份分组
    const grouped = {};
    heFavoriteLetters.forEach(letter => {
        const date = new Date(letter.time);
        const monthKey = `hefav-${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        const monthTitle = date.toLocaleDateString('zh-CN', {year: 'numeric', month: 'long'});
        
        if (!grouped[monthKey]) {
            grouped[monthKey] = { title: monthTitle, letters: [] };
        }
        grouped[monthKey].letters.push(letter);
    });
    
    // 渲染
    let html = '';
    Object.keys(grouped).sort().reverse().forEach(monthKey => {
        const group = grouped[monthKey];
        
        html += `
        <div class="env-letter-month-group">
            <div class="env-letter-month-header" style="cursor:default;">
                <span class="env-letter-month-title">${group.title}</span>
                <span class="env-letter-month-count">${group.letters.length} 封</span>
            </div>
            <div class="env-letter-month-content">
                ${group.letters.map(letter => renderHeFavoriteItem(letter)).join('')}
            </div>
        </div>`;
    });
    
    list.innerHTML = html;
}

// 渲染他收藏的单个信件卡片（只读，不可修改）
function renderHeFavoriteItem(letter) {
    const date = new Date(letter.sentTime).toLocaleDateString('zh-CN', {month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit'});
    const preview = (letter.content || '').length > 50 ? letter.content.substring(0, 50) + '…' : (letter.content || '');
    const partnerName = getPartnerName();
    
    return `
    <div class="env-letter-item he-favorite" onclick="viewEnvLetter('outbox','${letter.id}')" style="position:relative;cursor:pointer;border-left:3px solid rgba(var(--accent-color-rgb),0.6);">
        <div class="env-letter-header" style="padding:3px 12px;">
            <div class="env-letter-header-from">
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px;margin-right:3px;"><path d="M22 2L11 13"/><path d="M22 2L15 22 11 13 2 9l20-7z"/></svg>
                我寄出的 · ${date}
            </div>
            <span style="font-size:18px;color:#FF6B81;text-shadow:0 0 8px rgba(255,107,129,0.5);display:flex;align-items:center;gap:2px;" title="${partnerName}收藏了这封信">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="#FF6B81" stroke="none"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
            </span>
        </div>
        <div class="env-letter-body">
            <div class="env-letter-preview">${preview}</div>
            <div style="font-size:11px;color:var(--text-secondary);opacity:0.7;margin-top:6px;display:flex;align-items:center;gap:4px;">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
                ${partnerName} 收藏了这封信
            </div>
        </div>
    </div>`;
}

function renderOutboxList() {
    const list = document.getElementById('env-outbox-list');
    if (!list) return;
    if (envelopeData.outbox.length === 0) {
        list.innerHTML = `<div class="env-empty">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 7L2 7"/></svg>
            <div style="font-size:14px;font-weight:500;margin-top:4px;">还没有寄出任何信件</div>
            <div style="font-size:12px;margin-top:6px;opacity:0.6;">提笔写下心意，寄送给Ta吧~</div>
        </div>`;
        return;
    }
    list.innerHTML = envelopeData.outbox.slice().reverse().map(letter => {
        const date = new Date(letter.sentTime).toLocaleDateString('zh-CN', {month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit'});
        const isPending = letter.status === 'pending';
        const replyTime = isPending ? new Date(letter.replyTime).toLocaleDateString('zh-CN', {month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit'}) : '';
        const statusIcon = isPending
            ? `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`
            : `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;
        const statusText = isPending ? `${statusIcon} 预计 ${replyTime} 回信` : `${statusIcon} 已收到回信`;
        const preview = letter.content.length > 38 ? letter.content.substring(0, 38) + '…' : letter.content;
        return `
        <div class="env-letter-item" onclick="viewEnvLetter('outbox','${letter.id}')" style="border-left:3px solid rgba(var(--accent-color-rgb),0.6);">
            <div class="env-letter-header" style="padding:3px 12px;">
                <div class="env-letter-header-from">
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px;margin-right:3px;"><path d="M22 2L11 13"/><path d="M22 2L15 22 11 13 2 9l20-7z"/></svg>
                    寄出 · ${date}
                </div>
                <div class="env-stamp">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.8)" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                </div>
            </div>
            <div class="env-letter-body">
                <div class="env-letter-preview">${preview}</div>
                <div class="env-letter-status">${statusText}</div>
            </div>
            <button class="env-letter-delete-btn" onclick="deleteEnvLetter(event,'outbox','${letter.id}')">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
        </div>`;
    }).join('');
}

// 当前小纸条tab
let currentNoteTab = 'iAsk'; // 'iAsk' = 我想问你, 'taAsk' = 他的问题
let noteListDrawerCollapsed = true; // 小纸条列表抽屉折叠状态（默认折叠）
let noteMonthCollapsed = {}; // 小纸条月份折叠状态

// 切换小纸条列表抽屉折叠/展开
window.toggleNoteListDrawer = function(event) {
    // 如果点击的是按钮，不触发折叠
    if (event.target.closest('.env-note-action-btn') || event.target.closest('.env-note-tab-btn')) {
        return;
    }
    
    noteListDrawerCollapsed = !noteListDrawerCollapsed;
    
    const drawerContent = document.getElementById('env-note-drawer-content');
    const drawerArrow = document.getElementById('env-note-drawer-arrow');
    
    if (drawerContent) {
        drawerContent.classList.toggle('collapsed', noteListDrawerCollapsed);
    }
    if (drawerArrow) {
        drawerArrow.classList.toggle('collapsed', noteListDrawerCollapsed);
    }
    
    // 保存折叠状态
    try {
        localStorage.setItem(getStorageKey('noteListDrawerCollapsed'), noteListDrawerCollapsed);
    } catch(e) {}
};

// 切换小纸条月份折叠
window.toggleNoteMonth = function(monthKey, event) {
    if (event) event.stopPropagation();
    
    noteMonthCollapsed[monthKey] = !noteMonthCollapsed[monthKey];
    
    const content = document.getElementById(`note-month-content-${monthKey}`);
    const arrow = document.getElementById(`note-month-arrow-${monthKey}`);
    
    if (content) {
        content.classList.toggle('collapsed', noteMonthCollapsed[monthKey]);
        // 更新 max-height 实现动画效果
        if (noteMonthCollapsed[monthKey]) {
            content.style.maxHeight = '0';
        } else {
            // 计算内容高度
            const noteCount = content.querySelectorAll('.env-note-item').length;
            content.style.maxHeight = Math.max(noteCount * 100, 50) + 'px';
        }
    }
    if (arrow) arrow.classList.toggle('collapsed', noteMonthCollapsed[monthKey]);
};

// 加载小纸条列表抽屉折叠状态
function loadNoteListDrawerState() {
    try {
        const saved = localStorage.getItem(getStorageKey('noteListDrawerCollapsed'));
        if (saved === 'false') {
            noteListDrawerCollapsed = false;
            const drawerContent = document.getElementById('env-note-drawer-content');
            const drawerArrow = document.getElementById('env-note-drawer-arrow');
            if (drawerContent) drawerContent.classList.remove('collapsed');
            if (drawerArrow) drawerArrow.classList.remove('collapsed');
        } else {
            // 默认折叠
            const drawerContent = document.getElementById('env-note-drawer-content');
            const drawerArrow = document.getElementById('env-note-drawer-arrow');
            if (drawerContent) drawerContent.classList.add('collapsed');
            if (drawerArrow) drawerArrow.classList.add('collapsed');
        }
    } catch(e) {
        // 默认折叠
        const drawerContent = document.getElementById('env-note-drawer-content');
        const drawerArrow = document.getElementById('env-note-drawer-arrow');
        if (drawerContent) drawerContent.classList.add('collapsed');
        if (drawerArrow) drawerArrow.classList.add('collapsed');
    }
}

// 切换小纸条tab
window.switchNoteTab = function(eventOrTab, maybeTab) {
    // 兼容两种调用方式: switchNoteTab('iAsk') 或 switchNoteTab(event, 'iAsk')
    let tab, event;
    if (typeof eventOrTab === 'string') {
        tab = eventOrTab;
    } else {
        event = eventOrTab;
        tab = maybeTab;
        // 阻止事件冒泡，不触发折叠
        if (event) event.stopPropagation();
    }
    
    // 如果抽屉已展开，且点击的是当前已激活的tab，则折叠抽屉
    if (!noteListDrawerCollapsed && currentNoteTab === tab) {
        noteListDrawerCollapsed = true;
        const drawerContent = document.getElementById('env-note-drawer-content');
        const drawerArrow = document.getElementById('env-note-drawer-arrow');
        if (drawerContent) drawerContent.classList.add('collapsed');
        if (drawerArrow) drawerArrow.classList.add('collapsed');
        // 保存折叠状态
        try {
            localStorage.setItem(getStorageKey('noteListDrawerCollapsed'), true);
        } catch(e) {}
        return;
    }
    
    currentNoteTab = tab;
    
    // 展开抽屉（如果折叠的话）
    if (noteListDrawerCollapsed) {
        noteListDrawerCollapsed = false;
        const drawerContent = document.getElementById('env-note-drawer-content');
        const drawerArrow = document.getElementById('env-note-drawer-arrow');
        if (drawerContent) drawerContent.classList.remove('collapsed');
        if (drawerArrow) drawerArrow.classList.remove('collapsed');
    }
    
    // 更新tab按钮样式
    const iAskTab = document.getElementById('env-note-tab-iask');
    const taAskTab = document.getElementById('env-note-tab-taask');
    const iAskList = document.getElementById('env-note-iask-list');
    const taAskList = document.getElementById('env-note-taask-list');
    
    if (tab === 'iAsk') {
        if (iAskTab) iAskTab.classList.add('active');
        if (taAskTab) taAskTab.classList.remove('active');
        if (iAskList) iAskList.style.display = 'block';
        if (taAskList) taAskList.style.display = 'none';
    } else {
        if (taAskTab) taAskTab.classList.add('active');
        if (iAskTab) iAskTab.classList.remove('active');
        if (taAskList) taAskList.style.display = 'block';
        if (iAskList) iAskList.style.display = 'none';
    }
};

// 渲染两种类型的小纸条列表
function renderNotesLists() {
    renderNoteListByType('iAsk');
    renderNoteListByType('taAsk');
}

// 按类型渲染小纸条列表
function renderNoteListByType(type) {
    const listId = type === 'iAsk' ? 'env-notes-iask-inner' : 'env-notes-taask-inner';
    const emptyId = type === 'iAsk' ? 'env-note-iask-empty' : 'env-note-taask-empty';
    const countId = type === 'iAsk' ? 'env-note-iask-count' : 'env-note-taask-count';
    
    const list = document.getElementById(listId);
    const emptyState = document.getElementById(emptyId);
    const countEl = document.getElementById(countId);
    
    if (!list) return;
    
    // 筛选对应类型的小纸条
    const allNotes = envelopeData.notes || [];
    const notes = allNotes.filter(n => (n.type || 'iAsk') === type);
    
    // 更新计数
    if (countEl) {
        countEl.textContent = notes.length;
        countEl.style.display = notes.length > 0 ? 'inline-block' : 'none';
    }
    
    // 处理空状态显示
    if (emptyState) {
        emptyState.style.display = notes.length === 0 ? 'block' : 'none';
    }
    
    if (notes.length === 0) {
        list.innerHTML = '';
        return;
    }
    
    // 按月份分组
    const grouped = {};
    notes.slice().reverse().forEach(note => {
        const date = new Date(note.sentTime);
        const monthKey = `note-${type}-${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        const monthTitle = date.toLocaleDateString('zh-CN', {year: 'numeric', month: 'long'});
        
        if (!grouped[monthKey]) {
            grouped[monthKey] = { title: monthTitle, notes: [] };
        }
        grouped[monthKey].notes.push(note);
    });
    
    // 渲染分组
    let html = '';
    Object.keys(grouped).sort().reverse().forEach(monthKey => {
        const group = grouped[monthKey];
        // 默认折叠：如果未设置过则默认为 true（折叠）
        const isCollapsed = noteMonthCollapsed[monthKey] !== false;
        
        html += `
        <div class="env-note-month-group">
            <div class="env-note-month-header" onclick="toggleNoteMonth('${monthKey}', event)">
                <div class="env-letter-month-arrow ${isCollapsed ? 'collapsed' : ''}" id="note-month-arrow-${monthKey}">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                </div>
                <span class="env-letter-month-title">${group.title}</span>
                <span class="env-letter-month-count">${group.notes.length} 张</span>
            </div>
            <div class="env-note-month-content ${isCollapsed ? 'collapsed' : ''}" id="note-month-content-${monthKey}" style="max-height: ${isCollapsed ? '0' : group.notes.length * 100 + 'px'};">
                ${group.notes.map(note => renderNoteItem(note, type)).join('')}
            </div>
        </div>`;
    });
    
    list.innerHTML = html;
}

// 渲染单个小纸条项
function renderNoteItem(note, type) {
    const date = new Date(note.sentTime).toLocaleDateString('zh-CN', {month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit'});
    const isPending = note.status === 'pending';
    const partnerName = getPartnerName();
    
    let preview = '';
    let statusBadges = '';
    let canInput = false; // 是否可以输入回复
    
    if (type === 'iAsk') {
        // 我想问你
        preview = note.myQuestion ? (note.myQuestion.length > 40 ? note.myQuestion.substring(0, 40) + '…' : note.myQuestion) : '';
        
        // 判断输入框是否显示：和viewNote里的逻辑一致
        const hasConversation = note.conversation && note.conversation.length > 0;
        const isWaitingForTa = hasConversation && 
            note.conversation[note.conversation.length - 1].type === 'myReply' && 
            note.status === 'pending';
        
        // 输入框显示 = 有回复或对话，且不在等Ta
        const hasReply = note.reply || hasConversation;
        canInput = hasReply && !isWaitingForTa;
        
    } else {
        // 他的问题
        preview = note.taQuestion ? (note.taQuestion.length > 40 ? note.taQuestion.substring(0, 40) + '…' : note.taQuestion) : '';
        
        // 判断输入框是否显示：和viewNote里的needAnswer逻辑一致
        const hasConversation = note.conversation && note.conversation.length > 0;
        const lastIsTaQuestion = hasConversation && 
            note.conversation[note.conversation.length - 1].type === 'taQuestion';
        
        // needAnswer = 还没回答 或 有新问题 或 对话最后是Ta的问题
        canInput = !note.myAnswer || note.nextTaQuestion || lastIsTaQuestion;
        
        // 显示对话轮数
        if (hasConversation) {
            const rounds = Math.ceil(note.conversation.length / 2);
            statusBadges += `<span class="note-status-badge rounds">${rounds}轮</span>`;
        }
    }
    
    // 根据能否输入显示状态
    const myName = getMyName();
    if (canInput) {
        statusBadges = `<span class="note-status-badge replied">等待${myName}回复</span>` + statusBadges;
    } else {
        statusBadges = `<span class="note-status-badge pending">等待${partnerName}回复</span>` + statusBadges;
    }
    
    return `
    <div class="env-note-item" onclick="viewNote('${note.id}')">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
            <span style="font-size:11px;color:var(--text-secondary);">${date}</span>
            <div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;justify-content:flex-end;">
                ${statusBadges}
            </div>
        </div>
        <div style="font-size:13px;color:var(--text-primary);line-height:1.5;white-space:pre-wrap;word-break:break-word;">${preview}</div>
        <button onclick="deleteNote(event,'${note.id}')" style="position:absolute;top:6px;right:6px;width:20px;height:20px;border:none;background:transparent;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;opacity:0.3;transition:opacity 0.2s;" onmouseover="this.style.opacity='0.7';" onmouseout="this.style.opacity='0.3';">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
    </div>`;
}

// 兼容旧函数名
function renderNotesList() {
    renderNotesLists();
}

// ========== 信件抽屉相关 ==========

let currentLetterTab = 'sent'; // 'sent' = 寄出的信, 'favorite' = 收藏
let letterDrawerCollapsed = false; // 信件抽屉折叠状态
let letterMonthCollapsed = {}; // 寄出的信月份折叠状态
let inboxReplyMonthCollapsed = {}; // 他的回信月份折叠状态
let inboxLetterMonthCollapsed = {}; // 他写的信月份折叠状态

// 切换他的回信月份折叠
window.toggleInboxReplyMonth = function(monthKey, event) {
    if (event) event.stopPropagation();
    
    inboxReplyMonthCollapsed[monthKey] = !inboxReplyMonthCollapsed[monthKey];
    
    const content = document.getElementById(`inbox-reply-month-content-${monthKey}`);
    const arrow = document.getElementById(`inbox-reply-month-arrow-${monthKey}`);
    
    if (content) content.classList.toggle('collapsed', inboxReplyMonthCollapsed[monthKey]);
    if (arrow) arrow.classList.toggle('collapsed', inboxReplyMonthCollapsed[monthKey]);
};

// 切换他写的信月份折叠
window.toggleInboxLetterMonth = function(monthKey, event) {
    if (event) event.stopPropagation();
    
    inboxLetterMonthCollapsed[monthKey] = !inboxLetterMonthCollapsed[monthKey];
    
    const content = document.getElementById(`inbox-letter-month-content-${monthKey}`);
    const arrow = document.getElementById(`inbox-letter-month-arrow-${monthKey}`);
    
    if (content) content.classList.toggle('collapsed', inboxLetterMonthCollapsed[monthKey]);
    if (arrow) arrow.classList.toggle('collapsed', inboxLetterMonthCollapsed[monthKey]);
};

// 切换信件抽屉折叠/展开
window.toggleLetterDrawer = function(event) {
    // 如果点击的是tab按钮，不触发折叠
    if (event.target.closest('.env-letter-tab-btn')) {
        return;
    }
    
    letterDrawerCollapsed = !letterDrawerCollapsed;
    
    const drawerContent = document.getElementById('env-letter-drawer-content');
    const drawerArrow = document.getElementById('env-letter-drawer-arrow');
    
    if (drawerContent) {
        drawerContent.classList.toggle('collapsed', letterDrawerCollapsed);
    }
    if (drawerArrow) {
        drawerArrow.classList.toggle('collapsed', letterDrawerCollapsed);
    }
    
    // 保存折叠状态
    try {
        localStorage.setItem(getStorageKey('letterDrawerCollapsed'), letterDrawerCollapsed);
    } catch(e) {}
};

// 加载信件抽屉折叠状态
function loadLetterDrawerState() {
    try {
        const saved = localStorage.getItem(getStorageKey('letterDrawerCollapsed'));
        if (saved === 'true') {
            letterDrawerCollapsed = true;
            const drawerContent = document.getElementById('env-letter-drawer-content');
            const drawerArrow = document.getElementById('env-letter-drawer-arrow');
            if (drawerContent) drawerContent.classList.add('collapsed');
            if (drawerArrow) drawerArrow.classList.add('collapsed');
        }
    } catch(e) {}
}

// 切换信件Tab
window.switchLetterTab = function(eventOrTab, maybeTab) {
    // 兼容两种调用方式
    let tab, event;
    if (typeof eventOrTab === 'string') {
        tab = eventOrTab;
    } else {
        event = eventOrTab;
        tab = maybeTab;
        if (event) event.stopPropagation();
    }
    
    currentLetterTab = tab;
    
    // 展开抽屉（如果折叠的话）
    if (letterDrawerCollapsed) {
        letterDrawerCollapsed = false;
        const drawerContent = document.getElementById('env-letter-drawer-content');
        const drawerArrow = document.getElementById('env-letter-drawer-arrow');
        if (drawerContent) drawerContent.classList.remove('collapsed');
        if (drawerArrow) drawerArrow.classList.remove('collapsed');
    }
    
    // 更新tab按钮样式
    const sentTab = document.getElementById('env-letter-tab-sent');
    const favoriteTab = document.getElementById('env-letter-tab-favorite');
    const sentList = document.getElementById('env-letter-sent-list');
    const favoriteList = document.getElementById('env-letter-favorite-list');
    
    if (tab === 'sent') {
        if (sentTab) sentTab.classList.add('active');
        if (favoriteTab) favoriteTab.classList.remove('active');
        if (sentList) sentList.style.display = 'block';
        if (favoriteList) favoriteList.style.display = 'none';
    } else {
        if (favoriteTab) favoriteTab.classList.add('active');
        if (sentTab) sentTab.classList.remove('active');
        if (favoriteList) favoriteList.style.display = 'block';
        if (sentList) sentList.style.display = 'none';
    }
};

// 切换月份折叠
window.toggleLetterMonth = function(monthKey, event) {
    if (event) event.stopPropagation();
    
    letterMonthCollapsed[monthKey] = !letterMonthCollapsed[monthKey];
    
    const content = document.getElementById(`letter-month-content-${monthKey}`);
    const arrow = document.getElementById(`letter-month-arrow-${monthKey}`);
    
    if (content) content.classList.toggle('collapsed', letterMonthCollapsed[monthKey]);
    if (arrow) arrow.classList.toggle('collapsed', letterMonthCollapsed[monthKey]);
};

// 切换收藏状态
window.toggleLetterFavorite = function(section, letterId, event) {
    if (event) event.stopPropagation();
    
    let letter = null;
    
    if (section === 'outbox') {
        letter = envelopeData.outbox.find(l => l.id === letterId);
    } else if (section === 'inbox') {
        letter = envelopeData.inbox.find(l => l.id === letterId);
    } else if (section === 'partner') {
        letter = (envelopeData.partnerLetters || []).find(l => l.id === letterId);
    }
    
    if (!letter) return;
    
    // 切换收藏状态
    const wasFavorite = letter.favorite;
    letter.favorite = !letter.favorite;
    
    // 找到当前卡片元素和图标
    const icon = event.target;
    const card = icon ? icon.closest('.env-letter-item') : null;
    
    // 动画持续时间（取最长的一个）
    const animationDuration = 600;
    
    // 触发收藏动画
    if (!wasFavorite && letter.favorite) {
        if (icon) {
            icon.classList.remove('favorited', 'extinguishing');
            icon.style.color = 'rgba(255,255,255,0.95)';
            icon.title = '取消收藏';
            // 触发点燃动画
            requestAnimationFrame(() => {
                icon.classList.add('igniting');
            });
            // 动画结束后切换到呼吸状态
            setTimeout(() => {
                icon.classList.remove('igniting');
                icon.classList.add('favorited');
                icon.style.color = '#FFB800';
            }, animationDuration);
        }
        // 卡片边框发光高亮
        if (card) {
            card.classList.add('favorite-glow');
            setTimeout(() => card.classList.remove('favorite-glow'), 400);
        }
        // 星星爆发粒子效果
        if (icon) createStarBurst(icon);
    } else if (wasFavorite && !letter.favorite) {
        if (icon) {
            // 触发火焰熄灭动画
            icon.classList.remove('favorited', 'igniting');
            icon.classList.add('extinguishing');
            icon.title = '收藏';
            // 动画结束后恢复默认状态
            setTimeout(() => {
                icon.classList.remove('extinguishing');
                icon.style.color = 'rgba(255,255,255,0.95)';
            }, 500);
        }
        // 星星消散粒子效果
        if (icon) createStarFade(icon);
    }
    
    saveEnvelopeData();
    
    // 延迟渲染，让动画先执行完
    setTimeout(() => {
        // 根据不同板块调用对应的渲染函数
        if (section === 'inbox' || section === 'partner') {
            renderInboxLists();
        } else {
            renderLetterLists();
        }
    }, animationDuration + 50);
    
    showNotification(letter.favorite ? '已收藏 ⭐' : '已取消收藏', 'success');
};

// 创建星星爆发粒子效果
function createStarBurst(targetElement) {
    const rect = targetElement.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    
    const colors = ['#FFD700', '#FFA500', '#FF6B6B', '#FFE66D', '#FFFACD'];
    const particleCount = 8;
    
    for (let i = 0; i < particleCount; i++) {
        const particle = document.createElement('div');
        particle.className = 'star-particle burst';
        particle.innerHTML = '✦';
        particle.style.cssText = `
            position: fixed;
            left: ${centerX}px;
            top: ${centerY}px;
            font-size: 14px;
            color: ${colors[i % colors.length]};
            pointer-events: none;
            z-index: 10000;
            text-shadow: 0 0 6px currentColor;
        `;
        
        const angle = (i / particleCount) * Math.PI * 2;
        const distance = 30 + Math.random() * 20;
        const endX = Math.cos(angle) * distance;
        const endY = Math.sin(angle) * distance;
        
        document.body.appendChild(particle);
        
        // 动画
        particle.animate([
            { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
            { transform: `translate(calc(-50% + ${endX}px), calc(-50% + ${endY}px)) scale(0.3)`, opacity: 0 }
        ], {
            duration: 500,
            easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)'
        }).onfinish = () => particle.remove();
    }
}

// 创建星星消散粒子效果
function createStarFade(targetElement) {
    const rect = targetElement.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    
    const particle = document.createElement('div');
    particle.className = 'star-particle fade';
    particle.innerHTML = '✦';
    particle.style.cssText = `
        position: fixed;
        left: ${centerX}px;
        top: ${centerY}px;
        font-size: 18px;
        color: #FFB800;
        pointer-events: none;
        z-index: 10000;
        text-shadow: 0 0 8px rgba(255, 184, 0, 0.6);
        transform: translate(-50%, -50%);
    `;
    
    document.body.appendChild(particle);
    
    // 消散动画：向上飘散并淡出
    particle.animate([
        { transform: 'translate(-50%, -50%) scale(1) rotate(0deg)', opacity: 1 },
        { transform: 'translate(-50%, calc(-50% - 25px)) scale(1.3) rotate(15deg)', opacity: 0.6 },
        { transform: 'translate(-50%, calc(-50% - 50px)) scale(0.5) rotate(30deg)', opacity: 0 }
    ], {
        duration: 600,
        easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)'
    }).onfinish = () => particle.remove();
}

// 渲染信件列表（按月分组）
function renderLetterLists() {
    renderSentLetterList();
    renderFavoriteLetterList();
    updateLetterCounts();
}

// 渲染寄出的信列表（按月分组）
function renderSentLetterList() {
    const inner = document.getElementById('env-letter-sent-inner');
    const empty = document.getElementById('env-letter-sent-empty');
    if (!inner) return;
    
    const letters = envelopeData.outbox || [];
    
    if (letters.length === 0) {
        inner.innerHTML = '';
        if (empty) empty.style.display = 'block';
        return;
    }
    
    if (empty) empty.style.display = 'none';
    
    // 按月份分组
    const grouped = {};
    letters.slice().reverse().forEach(letter => {
        const date = new Date(letter.sentTime);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        const monthTitle = date.toLocaleDateString('zh-CN', {year: 'numeric', month: 'long'});
        
        if (!grouped[monthKey]) {
            grouped[monthKey] = { title: monthTitle, letters: [] };
        }
        grouped[monthKey].letters.push(letter);
    });
    
    // 渲染
    let html = '';
    Object.keys(grouped).sort().reverse().forEach(monthKey => {
        const group = grouped[monthKey];
        const isCollapsed = letterMonthCollapsed[monthKey];
        
        html += `
        <div class="env-letter-month-group">
            <div class="env-letter-month-header" onclick="toggleLetterMonth('${monthKey}', event)">
                <div class="env-letter-month-arrow ${isCollapsed ? 'collapsed' : ''}" id="letter-month-arrow-${monthKey}">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                </div>
                <span class="env-letter-month-title">${group.title}</span>
                <span class="env-letter-month-count">${group.letters.length} 封</span>
            </div>
            <div class="env-letter-month-content ${isCollapsed ? 'collapsed' : ''}" id="letter-month-content-${monthKey}" style="max-height: ${isCollapsed ? '0' : group.letters.length * 150 + 'px'};">
                ${group.letters.map(letter => renderLetterItem(letter, 'outbox')).join('')}
            </div>
        </div>`;
    });
    
    inner.innerHTML = html;
}

// 渲染收藏的信件列表
function renderFavoriteLetterList() {
    const inner = document.getElementById('env-letter-favorite-inner');
    const empty = document.getElementById('env-letter-favorite-empty');
    if (!inner) return;
    
    // 收集所有收藏的信件
    const favoriteLetters = [];
    
    (envelopeData.outbox || []).forEach(l => {
        if (l.favorite) favoriteLetters.push({ ...l, section: 'outbox' });
    });
    (envelopeData.inbox || []).forEach(l => {
        if (l.favorite) favoriteLetters.push({ ...l, section: 'inbox' });
    });
    (envelopeData.partnerLetters || []).forEach(l => {
        if (l.favorite) favoriteLetters.push({ ...l, section: 'partner' });
    });
    
    if (favoriteLetters.length === 0) {
        inner.innerHTML = '';
        if (empty) empty.style.display = 'block';
        return;
    }
    
    if (empty) empty.style.display = 'none';
    
    // 按时间排序
    favoriteLetters.sort((a, b) => (b.sentTime || b.receivedTime) - (a.sentTime || a.receivedTime));
    
    // 按月份分组
    const grouped = {};
    favoriteLetters.forEach(letter => {
        const date = new Date(letter.sentTime || letter.receivedTime);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        const monthTitle = date.toLocaleDateString('zh-CN', {year: 'numeric', month: 'long'});
        
        if (!grouped[monthKey]) {
            grouped[monthKey] = { title: monthTitle, letters: [] };
        }
        grouped[monthKey].letters.push(letter);
    });
    
    // 渲染
    let html = '';
    Object.keys(grouped).sort().reverse().forEach(monthKey => {
        const group = grouped[monthKey];
        
        html += `
        <div class="env-letter-month-group">
            <div class="env-letter-month-title" style="padding: 6px 0; margin-bottom: 8px; border-bottom: 1px solid var(--border-color);">${group.title}</div>
            ${group.letters.map(letter => renderLetterItem(letter, letter.section, true)).join('')}
        </div>`;
    });
    
    inner.innerHTML = html;
}

// 渲染单个信件项
function renderLetterItem(letter, section, isFavoriteView = false) {
    const date = new Date(letter.sentTime || letter.receivedTime).toLocaleDateString('zh-CN', {month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'});
    const preview = (letter.content || '').length > 38 ? letter.content.substring(0, 38) + '…' : (letter.content || '');
    const isPending = letter.status === 'pending';
    const isFavorite = letter.favorite;
    const isHeFavorite = letter.heFavorite;
    const partnerName = getPartnerName();
    
    let statusText = '';
    if (section === 'outbox') {
        const replyTime = isPending ? new Date(letter.replyTime).toLocaleDateString('zh-CN', {month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'}) : '';
        const statusIcon = isPending
            ? `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`
            : `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;
        statusText = isPending ? `${statusIcon} 预计 ${replyTime} 回信` : `${statusIcon} 已收到回信`;
    }
    
    const clickHandler = section === 'partner' ? `viewPartnerLetter('${letter.id}')` : `viewEnvLetter('${section}','${letter.id}')`;
    
    // 对方收藏标记（只读，只显示在寄出的信中）
    let heFavoriteBadge = '';
    if (section === 'outbox' && isHeFavorite) {
        heFavoriteBadge = `<span style="font-size:12px;color:#FF6B81;text-shadow:0 0 6px rgba(255,107,129,0.4);margin-left:6px;" title="${partnerName}收藏了这封信">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="#FF6B81" stroke="none" style="vertical-align:-2px;"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
        </span>`;
    }
    
    return `
    <div class="env-letter-item ${isHeFavorite ? 'he-favorite-mark' : ''}" onclick="${clickHandler}" style="position:relative;border-left:3px solid rgba(var(--accent-color-rgb),0.6);">
        <div class="env-letter-header" style="padding:3px 12px;">
            <div class="env-letter-header-from">
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px;margin-right:3px;"><path d="M22 2L11 13"/><path d="M22 2L15 22 11 13 2 9l20-7z"/></svg>
                ${section === 'outbox' ? '寄出' : (section === 'partner' ? 'Ta的信' : '收到')} · ${date}${heFavoriteBadge}
            </div>
            <span class="env-favorite-icon ${isFavorite ? 'favorited' : ''}" onclick="toggleLetterFavorite('${section}','${letter.id}',event)" style="cursor:pointer;font-size:26px;color:${isFavorite ? '#FFB800' : 'rgba(255,255,255,0.95)'};" title="${isFavorite ? '取消收藏' : '收藏'}">✦</span>
        </div>
        <div class="env-letter-body">
            <div class="env-letter-preview">${preview}</div>
            ${statusText ? `<div class="env-letter-status">${statusText}</div>` : ''}
        </div>
        <button class="env-letter-delete-btn" onclick="deleteEnvLetter(event,'${section}','${letter.id}')">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
    </div>`;
}

// 更新信件计数
function updateLetterCounts() {
    const sentCount = (envelopeData.outbox || []).length;
    const favoriteCount = (envelopeData.outbox || []).filter(l => l.favorite).length +
        (envelopeData.inbox || []).filter(l => l.favorite).length +
        (envelopeData.partnerLetters || []).filter(l => l.favorite).length;
    
    const sentBadge = document.getElementById('env-letter-sent-count');
    const favoriteBadge = document.getElementById('env-letter-favorite-count');
    
    if (sentBadge) {
        sentBadge.textContent = sentCount;
        sentBadge.style.display = sentCount > 0 ? 'inline-block' : 'none';
    }
    if (favoriteBadge) {
        favoriteBadge.textContent = favoriteCount;
        favoriteBadge.style.display = favoriteCount > 0 ? 'inline-block' : 'none';
    }
}

// 格式化时间戳
function formatNoteTime(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = date.toDateString() === yesterday.toDateString();
    
    const timeStr = date.toLocaleTimeString('zh-CN', {hour: '2-digit', minute: '2-digit'});
    
    if (isToday) {
        return `今天 ${timeStr}`;
    } else if (isYesterday) {
        return `昨天 ${timeStr}`;
    } else {
        return date.toLocaleDateString('zh-CN', {month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'});
    }
}

// 查看小纸条
window.viewNote = function(noteId) {
    const notes = envelopeData.notes || [];
    const note = notes.find(n => n.id === noteId);
    if (!note) return;
    
    // 清除新回复标记
    if (note.hasNewReply) {
        note.hasNewReply = false;
        saveEnvelopeData();
        renderNotesList();
    }
    
    // 存储当前查看的小纸条ID（用于回答功能）
    window.currentViewingNoteId = noteId;
    
    const noteType = note.type || 'iAsk';
    const partnerName = getPartnerName();
    
    const modal = document.getElementById('note-view-modal');
    const content = document.getElementById('note-view-content');
    const replySection = document.getElementById('note-view-reply');
    
    // 根据类型显示不同内容
    if (noteType === 'iAsk') {
        // === 我问Ta ===
        if (content) {
            content.innerHTML = `
                <div style="background:var(--primary-bg);border-radius:var(--radius-xs);padding:16px;margin-bottom:16px;border-left:3px solid var(--accent-color);">
                    <div style="font-size:11px;color:var(--text-secondary);margin-bottom:6px;">我问${partnerName}</div>
                    <div style="font-size:14px;color:var(--text-primary);line-height:1.7;white-space:pre-wrap;word-break:break-word;">${note.myQuestion || ''}</div>
                    <div style="font-size:11px;color:var(--text-secondary);opacity:0.6;margin-top:8px;">${new Date(note.sentTime).toLocaleDateString('zh-CN', {month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit'})}</div>
                </div>
            `;
        }
        
        if (replySection) {
            let replyHtml = '';
            
            // 显示Ta的回复
            if (note.reply) {
                const replyTime = formatNoteTime(note.replyReceivedTime);
                replyHtml += `
                    <div style="background:rgba(var(--accent-color-rgb),0.06);border-radius:var(--radius-xs);padding:16px;border-left:3px solid var(--accent-color);margin-bottom:12px;">
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                            <div style="font-size:12px;font-weight:600;color:var(--accent-color);">${partnerName}的回复</div>
                            ${replyTime ? `<div style="font-size:10px;color:var(--text-secondary);opacity:0.7;">${replyTime}</div>` : ''}
                        </div>
                        <div style="font-size:14px;color:var(--text-primary);line-height:1.7;">${note.reply}</div>
                    </div>
                `;
            }
            
            // 显示对话历史
            if (note.conversation && note.conversation.length > 0) {
                note.conversation.forEach(item => {
                    const itemTime = formatNoteTime(item.time);
                    if (item.type === 'myReply') {
                        replyHtml += `
                            <div style="background:var(--primary-bg);border-radius:var(--radius-xs);padding:12px;border-left:3px solid rgba(var(--accent-color-rgb),0.5);margin-bottom:8px;">
                                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                                    <div style="font-size:11px;color:var(--text-secondary);">我的回复</div>
                                    ${itemTime ? `<div style="font-size:10px;color:var(--text-secondary);opacity:0.7;">${itemTime}</div>` : ''}
                                </div>
                                <div style="font-size:13px;color:var(--text-primary);line-height:1.6;">${item.content}</div>
                            </div>
                        `;
                    } else if (item.type === 'taResponse') {
                        replyHtml += `
                            <div style="background:rgba(var(--accent-color-rgb),0.06);border-radius:var(--radius-xs);padding:12px;border-left:3px solid var(--accent-color);margin-bottom:8px;">
                                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                                    <div style="font-size:11px;color:var(--accent-color);">${partnerName}的回应</div>
                                    ${itemTime ? `<div style="font-size:10px;color:var(--text-secondary);opacity:0.7;">${itemTime}</div>` : ''}
                                </div>
                                <div style="font-size:13px;color:var(--text-primary);line-height:1.6;">${item.content}</div>
                            </div>
                        `;
                    }
                });
            }
            
            if (note.reply || (note.conversation && note.conversation.length > 0)) {
                // 已有回复，显示继续对话的选项
                // 检查是否在等待Ta的回复
                const isWaitingForTa = note.conversation && note.conversation.length > 0 && 
                    note.conversation[note.conversation.length - 1].type === 'myReply';
                
                if (isWaitingForTa && note.status === 'pending') {
                    const remainingMs = (note.replyTime || 0) - Date.now();
                    const remainingMin = Math.max(0, Math.ceil(remainingMs / 60000));
                    replyHtml += `
                        <div style="text-align:center;padding:16px;color:var(--text-secondary);">
                            <div style="font-size:13px;">${partnerName}正在写回复...</div>
                            <div style="font-size:11px;opacity:0.7;margin-top:4px;">预计 ${remainingMin} 分钟后收到</div>
                        </div>
                    `;
                } else {
                    // 可以继续对话
                    replyHtml += `
                        <div style="background:var(--primary-bg);border-radius:var(--radius-xs);padding:14px;border:1px solid var(--border-color);">
                            <div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px;">继续和${partnerName}聊天</div>
                            <textarea id="note-continue-input" placeholder="写下你想说的话..." style="width:100%;min-height:60px;border:1px solid var(--border-color);border-radius:var(--radius-xs);padding:10px;font-size:13px;font-family:var(--font-family);color:var(--text-primary);resize:vertical;box-sizing:border-box;line-height:1.5;"></textarea>
                            <div style="display:flex;gap:8px;margin-top:10px;">
                                <button onclick="hideModal(document.getElementById('note-view-modal'))" style="flex:1;padding:10px 0;border-radius:var(--radius-xs);border:1px solid var(--border-color);background:var(--primary-bg);color:var(--text-secondary);font-size:13px;cursor:pointer;">关闭</button>
                                <button onclick="continueNoteConversation()" style="flex:2;padding:10px 0;border-radius:var(--radius-xs);border:none;background:var(--accent-color);color:#fff;font-size:13px;font-weight:600;cursor:pointer;">发送</button>
                            </div>
                        </div>
                    `;
                }
                replySection.innerHTML = replyHtml;
                replySection.style.display = 'block';
            } else if (note.status === 'pending') {
                const remainingMs = (note.replyTime || 0) - Date.now();
                const remainingMin = Math.max(0, Math.ceil(remainingMs / 60000));
                replySection.innerHTML = `
                    <div style="text-align:center;padding:20px;color:var(--text-secondary);">
                        <div style="font-size:13px;">${partnerName}正在写回复...</div>
                        <div style="font-size:11px;opacity:0.7;margin-top:4px;">预计 ${remainingMin} 分钟后收到</div>
                    </div>
                `;
                replySection.style.display = 'block';
            } else {
                replySection.style.display = 'none';
            }
        }
    } else {
        // === Ta问我 ===
        if (content) {
            content.innerHTML = `
                <div style="background:var(--primary-bg);border-radius:var(--radius-xs);padding:16px;margin-bottom:16px;border-left:3px solid var(--accent-color);">
                    <div style="font-size:11px;color:var(--text-secondary);margin-bottom:6px;">${partnerName}问我</div>
                    <div style="font-size:14px;color:var(--text-primary);line-height:1.7;white-space:pre-wrap;word-break:break-word;">${note.taQuestion || ''}</div>
                    <div style="font-size:11px;color:var(--text-secondary);opacity:0.6;margin-top:8px;">${new Date(note.sentTime).toLocaleDateString('zh-CN', {month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit'})}</div>
                </div>
            `;
        }
        
        if (replySection) {
            let replyHtml = '';
            
            // 显示我的回答
            if (note.myAnswer) {
                const answerTime = formatNoteTime(note.myAnswerTime || note.replyReceivedTime);
                replyHtml += `
                    <div style="background:var(--primary-bg);border-radius:var(--radius-xs);padding:14px;border-left:3px solid rgba(var(--accent-color-rgb),0.5);margin-bottom:12px;">
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                            <div style="font-size:11px;color:var(--text-secondary);">我的回答</div>
                            ${answerTime ? `<div style="font-size:10px;color:var(--text-secondary);opacity:0.7;">${answerTime}</div>` : ''}
                        </div>
                        <div style="font-size:13px;color:var(--text-primary);line-height:1.6;">${note.myAnswer}</div>
                    </div>
                `;
            }
            
            // 显示Ta的回应
            if (note.taResponse) {
                const responseTime = formatNoteTime(note.taResponseTime || note.replyReceivedTime);
                replyHtml += `
                    <div style="background:rgba(var(--accent-color-rgb),0.06);border-radius:var(--radius-xs);padding:14px;border-left:3px solid var(--accent-color);margin-bottom:12px;">
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                            <div style="font-size:11px;color:var(--accent-color);">${partnerName}的回应</div>
                            ${responseTime ? `<div style="font-size:10px;color:var(--text-secondary);opacity:0.7;">${responseTime}</div>` : ''}
                        </div>
                        <div style="font-size:13px;color:var(--text-primary);line-height:1.6;">${note.taResponse}</div>
                    </div>
                `;
            }
            
            // 显示对话历史
            if (note.conversation && note.conversation.length > 0) {
                note.conversation.forEach(item => {
                    const itemTime = formatNoteTime(item.time);
                    if (item.type === 'myAnswer') {
                        replyHtml += `
                            <div style="background:var(--primary-bg);border-radius:var(--radius-xs);padding:12px;border-left:3px solid rgba(var(--accent-color-rgb),0.5);margin-bottom:8px;">
                                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                                    <div style="font-size:11px;color:var(--text-secondary);">我的回答</div>
                                    ${itemTime ? `<div style="font-size:10px;color:var(--text-secondary);opacity:0.7;">${itemTime}</div>` : ''}
                                </div>
                                <div style="font-size:13px;color:var(--text-primary);line-height:1.6;">${item.content}</div>
                            </div>
                        `;
                    } else if (item.type === 'taResponse') {
                        replyHtml += `
                            <div style="background:rgba(var(--accent-color-rgb),0.06);border-radius:var(--radius-xs);padding:12px;border-left:3px solid var(--accent-color);margin-bottom:8px;">
                                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                                    <div style="font-size:11px;color:var(--accent-color);">${partnerName}的回应</div>
                                    ${itemTime ? `<div style="font-size:10px;color:var(--text-secondary);opacity:0.7;">${itemTime}</div>` : ''}
                                </div>
                                <div style="font-size:13px;color:var(--text-primary);line-height:1.6;">${item.content}</div>
                            </div>
                        `;
                    } else if (item.type === 'taQuestion') {
                        replyHtml += `
                            <div style="background:var(--primary-bg);border-radius:var(--radius-xs);padding:12px;border-left:3px solid var(--accent-color);margin-bottom:8px;">
                                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                                    <div style="font-size:11px;color:var(--accent-color);">${partnerName}又问你</div>
                                    ${itemTime ? `<div style="font-size:10px;color:var(--text-secondary);opacity:0.7;">${itemTime}</div>` : ''}
                                </div>
                                <div style="font-size:13px;color:var(--text-primary);line-height:1.6;">${item.content}</div>
                            </div>
                        `;
                    }
                });
            }
            
            // 显示Ta继续问的问题（如果有nextTaQuestion且对话历史中没有待回答的问题）
            if (note.nextTaQuestion) {
                replyHtml += `
                    <div style="background:var(--primary-bg);border-radius:var(--radius-xs);padding:12px;border-left:3px solid var(--accent-color);margin-bottom:8px;">
                        <div style="font-size:11px;color:var(--accent-color);margin-bottom:4px;">${partnerName}又问你</div>
                        <div style="font-size:13px;color:var(--text-primary);line-height:1.6;">${note.nextTaQuestion}</div>
                    </div>
                `;
            }
            
            // 判断是否需要回答
            const needAnswer = !note.myAnswer || note.nextTaQuestion || 
                (note.conversation && note.conversation.length > 0 && 
                 note.conversation[note.conversation.length - 1].type === 'taQuestion');
            
            if (needAnswer) {
                const questionText = note.nextTaQuestion || 
                    (note.conversation && note.conversation.length > 0 && 
                     note.conversation[note.conversation.length - 1].type === 'taQuestion' ? 
                     note.conversation[note.conversation.length - 1].content : note.taQuestion);
                
                replyHtml += `
                    <div style="background:var(--primary-bg);border-radius:var(--radius-xs);padding:14px;border:1px solid var(--border-color);">
                        <div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px;">回答${partnerName}的问题</div>
                        <textarea id="note-answer-input" placeholder="写下你的回答..." style="width:100%;min-height:60px;border:1px solid var(--border-color);border-radius:var(--radius-xs);padding:10px;font-size:13px;font-family:var(--font-family);color:var(--text-primary);resize:vertical;box-sizing:border-box;line-height:1.5;"></textarea>
                        <div style="display:flex;gap:8px;margin-top:10px;">
                            <button onclick="hideModal(document.getElementById('note-view-modal'))" style="flex:1;padding:10px 0;border-radius:var(--radius-xs);border:1px solid var(--border-color);background:var(--primary-bg);color:var(--text-secondary);font-size:13px;cursor:pointer;">关闭</button>
                            <button onclick="sendNoteAnswer()" style="flex:2;padding:10px 0;border-radius:var(--radius-xs);border:none;background:var(--accent-color);color:#fff;font-size:13px;font-weight:600;cursor:pointer;">发送回答</button>
                        </div>
                    </div>
                `;
            } else {
                replyHtml += `
                    <div style="text-align:center;padding:12px;color:var(--text-secondary);font-size:12px;opacity:0.7;">
                        ${partnerName}正在酝酿回复，稍等片刻~
                    </div>
                `;
            }
            
            replySection.innerHTML = replyHtml;
            replySection.style.display = 'block';
        }
    }
    
    showModal(modal);
};

// 发送小纸条回答
window.sendNoteAnswer = function() {
    const noteId = window.currentViewingNoteId;
    if (!noteId) return;
    
    const notes = envelopeData.notes || [];
    const note = notes.find(n => n.id === noteId);
    if (!note) return;
    
    const answerInput = document.getElementById('note-answer-input');
    const answer = answerInput ? answerInput.value.trim() : '';
    
    if (!answer) {
        showNotification('请输入你的回答', 'warning');
        return;
    }
    
    // 初始化对话数组
    if (!note.conversation) {
        note.conversation = [];
    }
    
    const noteType = note.type || 'iAsk';
    
    if (noteType === 'taAsk') {
        // Ta问我：保存回答并触发Ta的回应
        if (!note.myAnswer) {
            // 第一次回答
            note.myAnswer = answer;
            note.myAnswerTime = Date.now();
        } else {
            // 后续对话中的回答
            note.conversation.push({
                type: 'myAnswer',
                content: answer,
                time: Date.now()
            });
        }
        
        // 清除待回答的问题标记
        note.nextTaQuestion = null;
        
        // 设置回复时间（等待Ta的回应）- 3-7分钟
        const minMinutes = 3, maxMinutes = 7;
        const randomMinutes = Math.random() * (maxMinutes - minMinutes) + minMinutes;
        note.replyTime = Date.now() + randomMinutes * 60 * 1000;
        note.status = 'pending';
    }
    
    saveEnvelopeData();
    showNotification('回答已发送', 'success');
    hideModal(document.getElementById('note-view-modal'));
};

// 删除小纸条
window.deleteNote = function(event, noteId) {
    event.stopPropagation();
    if (!confirm('确定要删除这张小纸条吗？')) return;
    
    envelopeData.notes = (envelopeData.notes || []).filter(n => n.id !== noteId);
    saveEnvelopeData();
    renderNotesList();
    showNotification('已删除', 'success');
};

// 继续小纸条对话（我问Ta类型）
window.continueNoteConversation = function() {
    const noteId = window.currentViewingNoteId;
    if (!noteId) return;
    
    const notes = envelopeData.notes || [];
    const note = notes.find(n => n.id === noteId);
    if (!note) return;
    
    const inputEl = document.getElementById('note-continue-input');
    const content = inputEl ? inputEl.value.trim() : '';
    
    if (!content) {
        showNotification('请输入你想说的话', 'warning');
        return;
    }
    
    // 初始化对话数组
    if (!note.conversation) {
        note.conversation = [];
    }
    
    // 添加用户的回复到对话历史
    note.conversation.push({
        type: 'myReply',
        content: content,
        time: Date.now()
    });
    
    // 设置回复时间（等待Ta的回应）- 3-7分钟
    const minMinutes = 3, maxMinutes = 7;
    const randomMinutes = Math.random() * (maxMinutes - minMinutes) + minMinutes;
    note.replyTime = Date.now() + randomMinutes * 60 * 1000;
    note.status = 'pending';
    
    saveEnvelopeData();
    showNotification('消息已发送', 'success');
    hideModal(document.getElementById('note-view-modal'));
};

// 打开写小纸条表单
window.openNewNoteForm = function(eventOrType) {
    // 兼容两种调用方式: openNewNoteForm() 或 openNewNoteForm(event)
    let event = null;
    if (eventOrType && typeof eventOrType === 'object' && eventOrType.stopPropagation) {
        event = eventOrType;
        event.stopPropagation();
    }
    
    const envelopeModal = document.getElementById('envelope-modal');
    if (envelopeModal) {
        showModal(envelopeModal);
    }
    
    // 隐藏其他区域
    document.getElementById('env-outbox-section').style.display = 'none';
    document.getElementById('env-inbox-section').style.display = 'none';
    document.getElementById('env-compose-form').style.display = 'none';
    document.getElementById('env-main-close-btn').style.display = 'none';
    
    // 重置标签页状态
    document.getElementById('env-tab-outbox').classList.remove('active');
    document.getElementById('env-tab-inbox').classList.remove('active');
    
    // 清空输入
    const questionInput = document.getElementById('env-note-question');
    if (questionInput) questionInput.value = '';
    
    // 显示小纸条表单
    document.getElementById('env-note-compose-form').style.display = 'block';
};

// 取消写小纸条
window.cancelNoteCompose = function() {
    document.getElementById('env-note-compose-form').style.display = 'none';
    document.getElementById('env-main-close-btn').style.display = 'flex';
    document.getElementById('env-outbox-section').style.display = 'block';
};

// 发送小纸条（只有"我问Ta"类型）
window.sendNote = function() {
    // 小纸条回复时间：3-7分钟
    const minMinutes = 3, maxMinutes = 7;
    const randomMinutes = Math.random() * (maxMinutes - minMinutes) + minMinutes;
    const replyTime = Date.now() + randomMinutes * 60 * 1000;
    
    const questionInput = document.getElementById('env-note-question');
    const question = questionInput ? questionInput.value.trim() : '';
    
    if (!question) {
        showNotification('请输入你想问Ta的问题', 'warning');
        return;
    }
    
    const newNote = {
        id: 'note_' + Date.now() + '_' + Math.random().toString(36).substr(2,4),
        sentTime: Date.now(),
        replyTime: replyTime,
        status: 'pending',
        type: 'iAsk',
        myQuestion: question,
        reply: null
    };
    
    if (!envelopeData.notes) envelopeData.notes = [];
    envelopeData.notes.push(newNote);
    saveEnvelopeData();
    
    cancelNoteCompose();
    switchEnvTab('outbox');
    switchNoteTab('iAsk');
    
    showNotification(`问题已送达，预计 ${Math.floor(randomMinutes)} 分钟后收到回复`, 'success');
};

window.viewEnvLetter = function(section, id) {
    const letters = section === 'outbox' ? envelopeData.outbox : envelopeData.inbox;
    const letter = letters.find(l => l.id === id);
    if (!letter) return;
    
    // 清除新标记和未读表态标记
    let needSave = false;
    if (section === 'inbox' && letter.isNew) {
        letter.isNew = false;
        needSave = true;
    }
    // 清除未读表态标记（打开信件即视为已读）
    if (letter.conversationHistory) {
        letter.conversationHistory.forEach(item => {
            if (item.taReactionUnread) {
                item.taReactionUnread = false;
                needSave = true;
            }
        });
    }
    // 兼容旧数据格式
    if (letter.myReplyTaReactionUnread) {
        letter.myReplyTaReactionUnread = false;
        needSave = true;
    }
    if (needSave) {
        saveEnvelopeData();
        renderEnvelopeLists();
    }
    
    editingEnvId = id;
    editingEnvSection = section;

    document.getElementById('env-view-title').textContent = section === 'outbox' ? '寄出的信' : '收到的回信';

    const dateObj = letter.timestamp ? new Date(letter.timestamp) : new Date();
    const y = dateObj.getFullYear();
    const mo = String(dateObj.getMonth()+1).padStart(2,'0');
    const d = String(dateObj.getDate()).padStart(2,'0');
    const dateStr = `${y}/${mo}/${d}`;
    const weekdays = ['日','一','二','三','四','五','六'];
    const fullDateStr = dateStr + ' 星期' + weekdays[dateObj.getDay()];

    const stampEl = document.getElementById('env-view-stamp-date');
    if (stampEl) stampEl.textContent = `${mo}/${d}`;

    const dateLine = document.getElementById('env-view-date-line');
    if (dateLine) dateLine.textContent = fullDateStr;

    const toLine = document.getElementById('env-view-to-line');
    const greetingLine = document.getElementById('env-view-greeting-line');
    if (section === 'outbox') {
        const partnerName = (typeof settings !== 'undefined' && settings.partnerName) || '亲爱的';
        if (toLine) toLine.textContent = `致 ${partnerName}：`;
        if (greetingLine) greetingLine.textContent = '见字如面，望君安好。';
    } else {
        const myName = (typeof settings !== 'undefined' && settings.myName) || '你';
        if (toLine) toLine.textContent = `致 ${myName}：`;
        if (greetingLine) greetingLine.textContent = '见字如面，一切皆好。';
    }

    const textEl = document.getElementById('env-view-text');
    if (textEl) {
        // 处理表情包标记，将 [sticker:URL] 替换为图片
        let content = letter.content;
        content = content.replace(/\[sticker:([^\]]+)\]/g, '<img src="$1" style="max-width:120px;max-height:120px;border-radius:12px;margin:8px 0;display:block;" alt="表情包">');
        textEl.innerHTML = content;
    }

    const signDateEl = document.getElementById('env-view-sign-date');
    const signNameEl = document.getElementById('env-view-sign-name');
    if (signDateEl) signDateEl.textContent = fullDateStr;
    if (section === 'outbox') {
        const myName = (typeof settings !== 'undefined' && settings.myName) || '你';
        if (signNameEl) signNameEl.textContent = myName;
    } else {
        const partnerName = (typeof settings !== 'undefined' && settings.partnerName) || '对方';
        if (signNameEl) signNameEl.textContent = partnerName;
    }

    document.getElementById('env-edit-input').value = letter.content;
    document.getElementById('env-view-content').style.display = 'block';
    document.getElementById('env-view-edit').style.display = 'none';
    // 收到的回信(inbox)是Ta写的，不允许编辑；只有寄出的信(outbox)可以编辑
    document.getElementById('env-view-edit-btn').style.display = section === 'outbox' ? 'inline-flex' : 'none';
    document.getElementById('env-view-save-btn').style.display = 'none';
    const origCtx = document.getElementById('env-view-original-ctx');
    const origText = document.getElementById('env-view-original-text');
    const origExpand = document.getElementById('env-view-original-expand');
    if (origCtx && origText) {
        if (section === 'inbox' && letter.originalContent) {
            origText.textContent = letter.originalContent;
            origText.style.maxHeight = '80px';
            origCtx.style.display = 'block';
            if (origExpand) {
                origExpand.style.display = letter.originalContent.length > 120 ? 'block' : 'none';
                origExpand.textContent = '展开查看全文';
            }
        } else {
            origCtx.style.display = 'none';
        }
    }
    
    // === 收到的回信(inbox)也支持来回对话（多轮） ===
    const replyBtn = document.getElementById('env-view-reply-btn');
    const myReplySection = document.getElementById('env-view-my-reply-section');
    const myReplyText = document.getElementById('env-view-my-reply-text');
    const taReplySection = document.getElementById('env-view-ta-reply-section');
    const taReplyText = document.getElementById('env-view-ta-reply-text');
    const waitingHint = document.getElementById('env-view-waiting-hint');
    const conversationHistorySection = document.getElementById('env-view-conversation-history');
    
    if (section === 'inbox') {
        // 清除新Ta回复标记
        if (letter.hasNewTaReply) {
            letter.hasNewTaReply = false;
            saveEnvelopeData();
        }
        
        // 判断是否可以继续回信
        const hasConversation = letter.conversationHistory && letter.conversationHistory.length > 0;
        const lastItem = hasConversation ? letter.conversationHistory[letter.conversationHistory.length - 1] : null;
        
        // 显示回信按钮
        if (replyBtn) {
            if (letter.taReplyStatus === 'pending') {
                replyBtn.style.display = 'none'; // 正在等待Ta回复
            } else if (letter.taReply || (lastItem && lastItem.type === 'taReply')) {
                replyBtn.style.display = 'inline-flex'; // 有Ta的回复，可以继续回信
                replyBtn.style.background = '';
                replyBtn.innerHTML = `继续回信`;
            } else if (!letter.myReply) {
                replyBtn.style.display = 'inline-flex'; // 还没回信过
                replyBtn.style.background = '';
                replyBtn.innerHTML = `我要回信`;
            } else {
                replyBtn.style.display = 'none';
            }
        }
        
        // 隐藏旧的单独回信区域，使用对话历史代替
        if (myReplySection) myReplySection.style.display = 'none';
        if (taReplySection) taReplySection.style.display = 'none';
        
        // 隐藏单独的表态区域（因为已在对话历史中）
        const reactionSection = document.getElementById('env-reaction-section');
        if (reactionSection) reactionSection.style.display = 'none';
        
        // 显示对话历史
        if (conversationHistorySection) {
            const history = letter.conversationHistory || [];
            let historyHtml = '';
            
            // 找到最新的表态索引（从后往前找第一个有表态的myReply）
            let latestReactionIndex = -1;
            for (let i = history.length - 1; i >= 0; i--) {
                if (history[i].type === 'myReply' && history[i].taReaction) {
                    latestReactionIndex = i;
                    break;
                }
            }
            
            if (history.length > 0) {
                // 有对话历史，直接渲染所有项
                history.forEach((item, index) => {
                    const reaction = item.reaction || null;
                    const taReaction = item.taReaction || null;
                    const isLatest = index === latestReactionIndex;
                    historyHtml += renderConversationItem(item.type, item.content, item.time, reaction, section, id, index, taReaction, isLatest);
                });
            } else {
                // 兼容旧数据：没有 conversationHistory 但有旧的 myReply/taReply 字段
                if (letter.myReply) {
                    historyHtml += renderConversationItem('myReply', letter.myReply, letter.myReplyTime, null, section, id, 0, letter.myReplyTaReaction || null, letter.myReplyTaReaction ? true : false);
                }
                if (letter.taReply) {
                    historyHtml += renderConversationItem('taReply', letter.taReply, letter.taReplyReceivedTime, letter.taReplyReaction || null, section, id, 1, null, false);
                }
            }
            
            if (historyHtml) {
                conversationHistorySection.innerHTML = historyHtml;
                conversationHistorySection.style.display = 'block';
            } else {
                conversationHistorySection.style.display = 'none';
            }
        }
        
        // 显示等待提示
        if (letter.taReplyStatus === 'pending') {
            if (waitingHint) {
                waitingHint.style.display = 'block';
                const remainingMs = (letter.taReplyTime || 0) - Date.now();
                const remainingMin = Math.max(0, Math.ceil(remainingMs / 60000));
                const partnerName = getPartnerName();
                waitingHint.innerHTML = `<span style="opacity:0.7;">⏳ ${partnerName}正在思考回复中...预计 ${remainingMin} 分钟后收到</span>`;
            }
        } else {
            if (waitingHint) waitingHint.style.display = 'none';
        }
    } else {
        // outbox不显示这些
        if (replyBtn) replyBtn.style.display = 'none';
        if (myReplySection) myReplySection.style.display = 'none';
        if (taReplySection) taReplySection.style.display = 'none';
        if (waitingHint) waitingHint.style.display = 'none';
        if (conversationHistorySection) conversationHistorySection.style.display = 'none';
    }
    
    // 隐藏回信输入区域
    const replySection = document.getElementById('env-reply-section');
    if (replySection) replySection.style.display = 'none';
    
    showModal(document.getElementById('envelope-view-modal'));
};

window.toggleEnvEdit = function() {
    const contentEl = document.getElementById('env-view-content');
    const editEl = document.getElementById('env-view-edit');
    const editBtn = document.getElementById('env-view-edit-btn');
    const saveBtn = document.getElementById('env-view-save-btn');
    const isEditing = editEl.style.display !== 'none';
    if (isEditing) {
        contentEl.style.display = 'block';
        editEl.style.display = 'none';
        editBtn.textContent = '编辑';
        saveBtn.style.display = 'none';
    } else {
        contentEl.style.display = 'none';
        editEl.style.display = 'block';
        editBtn.textContent = '取消';
        saveBtn.style.display = 'inline-flex';
    }
};

window.saveEnvEdit = function() {
    const newContent = document.getElementById('env-edit-input').value.trim();
    if (!newContent) { showNotification('内容不能为空', 'warning'); return; }
    const letters = editingEnvSection === 'outbox' ? envelopeData.outbox : envelopeData.inbox;
    const letter = letters.find(l => l.id === editingEnvId);
    if (letter) {
        letter.content = newContent;
        saveEnvelopeData();
        const textEl = document.getElementById('env-view-text');
        if (textEl) textEl.textContent = newContent;
        showNotification('已保存修改', 'success');
        toggleEnvEdit();
    }
};

window.closeEnvViewModal = function() {
    hideModal(document.getElementById('envelope-view-modal'));
};

window.deleteEnvLetter = function(event, section, id) {
    event.stopPropagation();
    if (!confirm('确定要删除这封信吗？')) return;
    if (section === 'outbox') {
        envelopeData.outbox = envelopeData.outbox.filter(l => l.id !== id);
    } else {
        envelopeData.inbox = envelopeData.inbox.filter(l => l.id !== id);
    }
    saveEnvelopeData();
    renderEnvelopeLists();
    showNotification('已删除', 'success');
};

// 打开信封投递板块（显示整个板块，不直接进入写信）
window.openEnvelopeBoard = function() {
    const envelopeModal = document.getElementById('envelope-modal');
    if (envelopeModal) {
        showModal(envelopeModal);
    }
    // 重置到默认状态：显示寄出的信列表
    document.getElementById('env-compose-form').style.display = 'none';
    document.getElementById('env-note-compose-form').style.display = 'none';
    document.getElementById('env-main-close-btn').style.display = 'flex';
    
    // 切换到寄出的信标签页
    switchEnvTab('outbox');
};

// 打开写信表单（从板块内的"提笔写信"按钮调用）
window.openNewEnvelopeForm = function() {
    // 先打开信件弹窗
    const envelopeModal = document.getElementById('envelope-modal');
    if (envelopeModal) {
        showModal(envelopeModal);
    }
    // 隐藏收件箱和发件箱区域
    document.getElementById('env-outbox-section').style.display = 'none';
    document.getElementById('env-inbox-section').style.display = 'none';
    document.getElementById('env-note-compose-form').style.display = 'none';
    document.getElementById('env-main-close-btn').style.display = 'none';
    // 重置标签页状态
    document.getElementById('env-tab-outbox').classList.remove('active');
    document.getElementById('env-tab-inbox').classList.remove('active');
    // 显示写信表单
    document.getElementById('env-compose-title').textContent = '写一封信';
    document.getElementById('envelope-input').value = '';
    document.getElementById('env-send-to-chat').checked = false;
    document.getElementById('env-compose-form').style.display = 'block';
};

window.cancelEnvelopeCompose = function() {
    document.getElementById('env-compose-form').style.display = 'none';
    document.getElementById('env-main-close-btn').style.display = 'flex';
    if (currentEnvTab === 'outbox') {
        document.getElementById('env-outbox-section').style.display = 'block';
    } else {
        document.getElementById('env-inbox-section').style.display = 'block';
    }
};

function handleSendEnvelope() {
    const text = document.getElementById('envelope-input').value.trim();
    if (!text) { showNotification('信件内容不能为空', 'warning'); return; }

    const sendToChat = document.getElementById('env-send-to-chat').checked;
    if (sendToChat) {
        addMessage({ id: Date.now(), sender: 'user', text: `【寄出的信】\n${text}`, timestamp: new Date(), status: 'sent', type: 'normal' });
    }

    const minHours = 10, maxHours = 24;
    const randomHours = Math.random() * (maxHours - minHours) + minHours;
    const replyTime = Date.now() + randomHours * 60 * 60 * 1000;
    const newId = 'env_' + Date.now() + '_' + Math.random().toString(36).substr(2,4);
    envelopeData.outbox.push({
        id: newId, content: text,
        sentTime: Date.now(), replyTime,
        status: 'pending'
    });
    saveEnvelopeData();

    cancelEnvelopeCompose();
    switchEnvTab('outbox');
    showNotification(`信件已寄出，预计 ${Math.floor(randomHours)} 小时后收到回信 ✉️`, 'success');
}


// ─── 随机写信机制 ───────────────────────────────────────────────────────────
function generatePartnerLetter() {
    // 从回复库中随机选取内容
    const replies = (typeof customReplies !== 'undefined' && customReplies.length > 0) ? customReplies : [];
    const emojis = (typeof CONSTANTS !== 'undefined' && CONSTANTS.REPLY_EMOJIS) ? CONSTANTS.REPLY_EMOJIS : [];
    const stickers = (typeof stickerLibrary !== 'undefined' && stickerLibrary.length > 0) ? stickerLibrary : [];
    
    if (replies.length === 0 && emojis.length === 0 && stickers.length === 0) {
        return null;
    }
    
    // 随机决定段落数（1-3段）
    const paragraphCount = Math.floor(Math.random() * 3) + 1;
    
    // 从主字卡中选取12-36条
    let selectedReplies = [];
    if (replies.length > 0) {
        const minReplies = 12, maxReplies = 36;
        const replyCount = Math.min(replies.length, Math.floor(Math.random() * (maxReplies - minReplies + 1)) + minReplies);
        const shuffled = [...replies].sort(() => Math.random() - 0.5);
        selectedReplies = shuffled.slice(0, replyCount);
    }
    
    // 从Emoji中选取3-7个
    let selectedEmojis = [];
    if (emojis.length > 0) {
        const emojiCount = Math.min(emojis.length, Math.floor(Math.random() * 5) + 3);
        const shuffledEmojis = [...emojis].sort(() => Math.random() - 0.5);
        selectedEmojis = shuffledEmojis.slice(0, emojiCount);
    }
    
    // 从表情库中至多选取1个
    let selectedSticker = null;
    if (stickers.length > 0 && Math.random() < 0.3) {
        selectedSticker = stickers[Math.floor(Math.random() * stickers.length)];
    }
    
    // 构建段落
    const paragraphs = [];
    
    // 将句子分配到各段落
    if (selectedReplies.length > 0) {
        const sentencesPerParagraph = Math.ceil(selectedReplies.length / paragraphCount);
        
        for (let i = 0; i < paragraphCount; i++) {
            const startIdx = i * sentencesPerParagraph;
            const endIdx = Math.min(startIdx + sentencesPerParagraph, selectedReplies.length);
            const paragraphSentences = selectedReplies.slice(startIdx, endIdx);
            
            if (paragraphSentences.length > 0) {
                // 随机决定emoji是否放在这一段
                let paragraphText = paragraphSentences.map(r => {
                    const punctuation = Math.random() < 0.15 ? '！' : (Math.random() < 0.15 ? '...' : '。');
                    return r + punctuation;
                }).join('');
                
                // 随机在这一段添加一些emoji（概率30%）
                if (selectedEmojis.length > 0 && Math.random() < 0.3) {
                    const emojiCount = Math.min(2, selectedEmojis.length);
                    const paragraphEmojis = selectedEmojis.splice(0, emojiCount);
                    paragraphText += ' ' + paragraphEmojis.join(' ');
                }
                
                paragraphs.push(paragraphText);
            }
        }
        
        // 如果还有剩余emoji，添加到最后一段
        if (selectedEmojis.length > 0 && paragraphs.length > 0) {
            paragraphs[paragraphs.length - 1] += ' ' + selectedEmojis.join(' ');
        }
    } else if (selectedEmojis.length > 0) {
        // 如果没有句子只有emoji
        paragraphs.push(selectedEmojis.join(' '));
    }
    
    // 添加表情（如果有）- 保存表情包URL以便后续渲染
    if (selectedSticker && paragraphs.length > 0) {
        paragraphs[paragraphs.length - 1] += '\n[sticker:' + selectedSticker + ']';
    }
    
    return paragraphs.join('\n\n').trim();
}

async function checkAndGeneratePartnerLetters() {
    await loadEnvelopeData();
    
    const now = new Date();
    const today = now.toDateString();
    const lastCheckKey = getStorageKey('lastPartnerLetterCheck');
    const lastCheck = await localforage.getItem(lastCheckKey);
    
    // 获取今天已生成的信件数量
    const todayLetters = (envelopeData.partnerLetters || []).filter(l => {
        const letterDate = new Date(l.receivedTime).toDateString();
        return letterDate === today;
    });
    
    const todayCount = todayLetters.length;
    
    // 检查是否需要生成新信件
    const dailyMin = 2, dailyMax = 4;
    const targetCount = Math.floor(Math.random() * (dailyMax - dailyMin + 1)) + dailyMin;
    
    if (todayCount >= targetCount) {
        return; // 今天已经生成了足够的信件
    }
    
    // 计算下次生成时间
    const lastGenTime = lastCheck ? new Date(lastCheck.lastGenTime) : new Date(0);
    const hoursSinceLastGen = (now - lastGenTime) / (1000 * 60 * 60);
    
    // 每3-6小时生成一封信
    const minInterval = 3, maxInterval = 6;
    const randomInterval = Math.random() * (maxInterval - minInterval) + minInterval;
    
    if (hoursSinceLastGen < randomInterval) {
        return; // 还没到生成时间
    }
    
    // 生成新信件
    const content = generatePartnerLetter();
    if (!content) return;
    
    if (!envelopeData.partnerLetters) envelopeData.partnerLetters = [];
    
    const newLetter = {
        id: 'partner_' + Date.now() + '_' + Math.random().toString(36).substr(2,4),
        content: content,
        receivedTime: Date.now(),
        isNew: true
    };
    
    envelopeData.partnerLetters.push(newLetter);
    saveEnvelopeData();
    
    // 更新最后生成时间
    await localforage.setItem(lastCheckKey, { 
        lastGenTime: now.toISOString(),
        todayDate: today 
    });
    
    // 显示新信件通知
    showPartnerLetterPopup(newLetter);
}

function showPartnerLetterPopup(letter) {
    const existing = document.getElementById('partner-letter-popup');
    if (existing) existing.remove();
    
    const popup = document.createElement('div');
    popup.id = 'partner-letter-popup';
    popup.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:var(--secondary-bg);border:1px solid var(--border-color);border-radius:20px;padding:18px 20px;z-index:8000;max-width:320px;width:88%;box-shadow:0 8px 32px rgba(0,0,0,0.18);display:flex;flex-direction:column;gap:12px;animation:slideUpNotif 0.4s cubic-bezier(0.22,1,0.36,1);';
    popup.innerHTML = `
        <style>@keyframes slideUpNotif{from{opacity:0;transform:translateX(-50%) translateY(24px) scale(0.9)}60%{transform:translateX(-50%) translateY(-4px) scale(1.02)}to{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}}</style>
        <div style="display:flex;align-items:center;gap:10px;">
            <span style="font-size:26px;">💌</span>
            <div>
                <div style="font-size:14px;font-weight:700;color:var(--text-primary);">Ta给你写了一封信</div>
                <div style="font-size:11px;color:var(--text-secondary);margin-top:2px;opacity:0.8;">快去看看吧~</div>
            </div>
        </div>
        <div style="display:flex;gap:8px;">
            <button onclick="document.getElementById('partner-letter-popup').remove();" style="flex:1;padding:8px 0;border-radius:12px;border:1px solid var(--border-color);background:var(--primary-bg);color:var(--text-secondary);font-size:13px;cursor:pointer;">稍后查看</button>
            <button onclick="viewPartnerLetterFromPopup('${letter.id}');" style="flex:2;padding:8px 0;border-radius:12px;border:none;background:var(--accent-color);color:#fff;font-size:13px;font-weight:600;cursor:pointer;">立即阅读 ✉</button>
        </div>`;
    document.body.appendChild(popup);
    setTimeout(() => { if (popup.parentNode) popup.remove(); }, 8000);
}

window.viewPartnerLetterFromPopup = function(id) {
    const popup = document.getElementById('partner-letter-popup');
    if (popup) popup.remove();
    const envelopeModal = document.getElementById('envelope-modal');
    showModal(envelopeModal);
    setTimeout(() => {
        switchEnvTab('inbox');
        switchInboxSubTab('letter');
        viewPartnerLetter(id);
    }, 200);
};

window.viewPartnerLetter = function(id) {
    const letters = envelopeData.partnerLetters || [];
    const letter = letters.find(l => l.id === id);
    if (!letter) return;
    
    // 清除新标记、新回复标记和未读表态标记
    let needSave = false;
    if (letter.isNew) {
        letter.isNew = false;
        needSave = true;
    }
    if (letter.hasNewTaReply) {
        letter.hasNewTaReply = false;
        needSave = true;
    }
    // 清除未读表态标记（打开信件即视为已读）
    if (letter.conversationHistory) {
        letter.conversationHistory.forEach(item => {
            if (item.taReactionUnread) {
                item.taReactionUnread = false;
                needSave = true;
            }
        });
    }
    // 兼容旧数据格式
    if (letter.myReplyTaReactionUnread) {
        letter.myReplyTaReactionUnread = false;
        needSave = true;
    }
    if (needSave) {
        saveEnvelopeData();
        renderInboxLists();
    }
    
    editingEnvId = id;
    editingEnvSection = 'partner';
    
    document.getElementById('env-view-title').textContent = 'Ta的信';
    
    const dateObj = new Date(letter.receivedTime);
    const y = dateObj.getFullYear();
    const mo = String(dateObj.getMonth()+1).padStart(2,'0');
    const d = String(dateObj.getDate()).padStart(2,'0');
    const dateStr = `${y}/${mo}/${d}`;
    const weekdays = ['日','一','二','三','四','五','六'];
    const fullDateStr = dateStr + ' 星期' + weekdays[dateObj.getDay()];
    
    const stampEl = document.getElementById('env-view-stamp-date');
    if (stampEl) stampEl.textContent = `${mo}/${d}`;
    
    const dateLine = document.getElementById('env-view-date-line');
    if (dateLine) dateLine.textContent = fullDateStr;
    
    const toLine = document.getElementById('env-view-to-line');
    const greetingLine = document.getElementById('env-view-greeting-line');
    const myName = (typeof settings !== 'undefined' && settings.myName) || '你';
    if (toLine) toLine.textContent = `致 ${myName}：`;
    if (greetingLine) greetingLine.textContent = '见字如面，一切皆好。';
    
    const textEl = document.getElementById('env-view-text');
    if (textEl) {
        let content = letter.content;
        content = content.replace(/\[sticker:([^\]]+)\]/g, '<img src="$1" style="max-width:120px;max-height:120px;border-radius:12px;margin:8px 0;display:block;" alt="表情包">');
        textEl.innerHTML = content;
    }
    
    const signDateEl = document.getElementById('env-view-sign-date');
    const signNameEl = document.getElementById('env-view-sign-name');
    const partnerName = (typeof settings !== 'undefined' && settings.partnerName) || '对方';
    if (signDateEl) signDateEl.textContent = fullDateStr;
    if (signNameEl) signNameEl.textContent = partnerName;
    
    document.getElementById('env-edit-input').value = letter.content;
    document.getElementById('env-view-content').style.display = 'block';
    document.getElementById('env-view-edit').style.display = 'none';
    // Ta的信不允许编辑，隐藏编辑按钮
    document.getElementById('env-view-edit-btn').style.display = 'none';
    document.getElementById('env-view-save-btn').style.display = 'none';
    
    const origCtx = document.getElementById('env-view-original-ctx');
    if (origCtx) origCtx.style.display = 'none';
    
    // === Ta的信支持来回对话（多轮） ===
    const replyBtn = document.getElementById('env-view-reply-btn');
    const myReplySection = document.getElementById('env-view-my-reply-section');
    const myReplyText = document.getElementById('env-view-my-reply-text');
    const taReplySection = document.getElementById('env-view-ta-reply-section');
    const taReplyText = document.getElementById('env-view-ta-reply-text');
    const waitingHint = document.getElementById('env-view-waiting-hint');
    const conversationHistorySection = document.getElementById('env-view-conversation-history');
    
    // 判断是否可以继续回信：
    // 1. 还没有回信过 -> 可以回信
    // 2. 已经有Ta的回复 -> 可以继续回信
    // 3. 正在等待Ta回复 -> 不能回信
    const hasConversation = letter.conversationHistory && letter.conversationHistory.length > 0;
    const lastItem = hasConversation ? letter.conversationHistory[letter.conversationHistory.length - 1] : null;
    const canReply = !letter.myReply || (lastItem && lastItem.type === 'taReply') || letter.taReply;
    
    // 显示回信按钮（当可以继续回信时）
    if (replyBtn) {
        if (letter.taReplyStatus === 'pending') {
            replyBtn.style.display = 'none'; // 正在等待Ta回复
        } else if (letter.taReply || (lastItem && lastItem.type === 'taReply')) {
            replyBtn.style.display = 'inline-flex'; // 有Ta的回复，可以继续回信
            replyBtn.style.background = '';
            replyBtn.innerHTML = `继续回信`;
        } else if (!letter.myReply) {
            replyBtn.style.display = 'inline-flex'; // 还没回信过
            replyBtn.style.background = '';
            replyBtn.innerHTML = `我要回信`;
        } else {
            replyBtn.style.display = 'none';
        }
    }
    
    // 隐藏旧的单独回信区域，使用对话历史代替
    if (myReplySection) myReplySection.style.display = 'none';
    if (taReplySection) taReplySection.style.display = 'none';
    
    // 隐藏单独的表态区域（因为已在对话历史中）
    const reactionSection = document.getElementById('env-reaction-section');
    if (reactionSection) reactionSection.style.display = 'none';
    
    // 显示对话历史
    if (conversationHistorySection) {
        const history = letter.conversationHistory || [];
        let historyHtml = '';
        
        // 找到最新的表态索引（从后往前找第一个有表态的myReply）
        let latestReactionIndex = -1;
        for (let i = history.length - 1; i >= 0; i--) {
            if (history[i].type === 'myReply' && history[i].taReaction) {
                latestReactionIndex = i;
                break;
            }
        }
        
        if (history.length > 0) {
            // 有对话历史，直接渲染所有项
            history.forEach((item, index) => {
                const reaction = item.reaction || null;
                const taReaction = item.taReaction || null;
                const isLatest = index === latestReactionIndex;
                historyHtml += renderConversationItem(item.type, item.content, item.time, reaction, 'partner', id, index, taReaction, isLatest);
            });
        } else {
            // 兼容旧数据：没有 conversationHistory 但有旧的 myReply/taReply 字段
            if (letter.myReply) {
                historyHtml += renderConversationItem('myReply', letter.myReply, letter.myReplyTime, null, 'partner', id, 0, letter.myReplyTaReaction || null, letter.myReplyTaReaction ? true : false);
            }
            if (letter.taReply) {
                historyHtml += renderConversationItem('taReply', letter.taReply, letter.taReplyReceivedTime, letter.taReplyReaction || null, 'partner', id, 1, null, false);
            }
        }
        
        if (historyHtml) {
            conversationHistorySection.innerHTML = historyHtml;
            conversationHistorySection.style.display = 'block';
        } else {
            conversationHistorySection.style.display = 'none';
        }
    }
    
    // 显示等待提示
    if (letter.taReplyStatus === 'pending') {
        if (waitingHint) {
            waitingHint.style.display = 'block';
            const remainingMs = (letter.taReplyTime || 0) - Date.now();
            const remainingMin = Math.max(0, Math.ceil(remainingMs / 60000));
            const partnerName = getPartnerName();
            waitingHint.innerHTML = `<span style="opacity:0.7;">⏳ ${partnerName}正在思考回复中...预计 ${remainingMin} 分钟后收到</span>`;
        }
    } else {
        if (waitingHint) waitingHint.style.display = 'none';
    }
    
    // 隐藏回信输入区域
    const replySection = document.getElementById('env-reply-section');
    if (replySection) replySection.style.display = 'none';
    
    showModal(document.getElementById('envelope-view-modal'));
};

// 当前查看的信件的表态相关变量
let currentViewingLetterSection = null;
let currentViewingLetterId = null;

// 渲染对话历史项
function renderConversationItem(type, content, time, reaction, letterSection, letterId, itemIndex, taReaction, isLatestReaction = false) {
    const partnerName = (typeof settings !== 'undefined' && settings.partnerName) || '对方';
    const timeStr = time ? new Date(time).toLocaleDateString('zh-CN', {month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit'}) : '';
    
    if (type === 'myReply') {
        // Ta对用户回复的表态 - 只显示结果，用户无法修改
        const hasReaction = taReaction !== null && taReaction !== undefined;
        const reactionDisplay = getTaReactionDisplayInfo(taReaction);
        
        // 根据表态类型设置样式
        let highlightStyle = '';
        let bgStyle = 'background:rgba(100,149,237,0.08);';
        let borderColor = 'rgba(100,149,237,0.2)';
        
        if (hasReaction) {
            if (taReaction === 'superLike') {
                highlightStyle = `box-shadow:0 0 0 2px rgba(255,215,0,0.5),0 2px 8px rgba(255,165,0,0.3);${isLatestReaction ? 'animation:latestReactionGlow 2s ease-in-out infinite;' : ''}`;
                bgStyle = 'background:linear-gradient(135deg,rgba(255,215,0,0.15) 0%,rgba(255,165,0,0.1) 100%);';
                borderColor = 'rgba(255,215,0,0.5)';
            } else if (taReaction === 'like') {
                highlightStyle = `box-shadow:0 0 0 2px rgba(255,105,180,0.5),0 2px 8px rgba(255,105,180,0.3);${isLatestReaction ? 'animation:latestReactionGlow 2s ease-in-out infinite;' : ''}`;
                bgStyle = 'background:linear-gradient(135deg,rgba(255,105,180,0.12) 0%,rgba(100,149,237,0.08) 100%);';
                borderColor = 'rgba(255,105,180,0.4)';
            } else if (taReaction === 'dislike') {
                highlightStyle = 'box-shadow:0 0 0 1px rgba(150,150,150,0.3);';
                bgStyle = 'background:rgba(150,150,150,0.08);';
                borderColor = 'rgba(150,150,150,0.3)';
            } else if (taReaction === 'surprised') {
                highlightStyle = `box-shadow:0 0 0 2px rgba(156,39,176,0.5),0 2px 8px rgba(156,39,176,0.3);${isLatestReaction ? 'animation:latestReactionGlow 2s ease-in-out infinite;' : ''}`;
                bgStyle = 'background:linear-gradient(135deg,rgba(156,39,176,0.12) 0%,rgba(123,31,162,0.08) 100%);';
                borderColor = 'rgba(156,39,176,0.4)';
            }
        }
        
        // 最新表态标签（放在"我的回信"旁边）
        const latestTag = isLatestReaction && hasReaction ? `<span style="font-size:8px;padding:1px 4px;border-radius:3px;background:linear-gradient(135deg,#FFD700,#FFA500);color:#fff;font-weight:600;margin-left:4px;">新</span>` : '';
        
        return `
            <style>@keyframes latestReactionGlow{0%,100%{box-shadow:0 0 0 2px rgba(255,105,180,0.5),0 2px 8px rgba(255,105,180,0.3);}50%{box-shadow:0 0 0 3px rgba(255,105,180,0.7),0 4px 16px rgba(255,105,180,0.5);}}</style>
            <div style="margin:0 16px 12px;${bgStyle}border-radius:12px;border:1px solid ${borderColor};overflow:hidden;${highlightStyle}">
                <div style="background:rgba(100,149,237,0.15);padding:6px 12px;display:flex;align-items:center;justify-content:space-between;">
                    <div style="display:flex;align-items:center;gap:6px;">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 00-4-4H4"/></svg>
                        <span style="font-size:10px;font-weight:600;color:rgba(100,149,237,0.9);">我的回信</span>${latestTag}
                    </div>
                    <div style="display:flex;align-items:center;gap:6px;">
                        ${timeStr ? `<span style="font-size:9px;color:rgba(100,149,237,0.6);">${timeStr}</span>` : ''}
                        ${taReaction ? `<span style="font-size:9px;padding:1px 5px;border-radius:4px;${reactionDisplay.style}color:#fff;">${reactionDisplay.text}</span>` : ''}
                    </div>
                </div>
                <div style="padding:10px 12px;font-size:12px;color:var(--text-primary);line-height:1.6;white-space:pre-wrap;word-break:break-word;">${content}</div>
            </div>`;
    } else {
        let processedContent = content;
        processedContent = processedContent.replace(/\[sticker:([^\]]+)\]/g, '<img src="$1" style="max-width:100px;max-height:100px;border-radius:10px;margin:6px 0;display:block;" alt="表情包">');
        const isLikeActive = reaction === 'like';
        const isDislikeActive = reaction === 'dislike';
        
        // 用户表态时的卡片效果
        const userHighlightStyle = isLikeActive ? 'box-shadow:0 0 0 2px rgba(255,107,107,0.5),0 2px 8px rgba(255,107,107,0.3);' : (isDislikeActive ? 'box-shadow:0 0 0 1px rgba(150,150,150,0.3);' : '');
        const userBgStyle = isLikeActive ? 'background:linear-gradient(135deg,rgba(255,107,107,0.15) 0%,rgba(255,107,107,0.05) 100%);' : (isDislikeActive ? 'background:rgba(150,150,150,0.08);' : 'background:rgba(255,107,107,0.08);');
        
        return `
            <div style="margin:0 16px 12px;${userBgStyle}border-radius:12px;border:1px solid ${isLikeActive ? 'rgba(255,107,107,0.5)' : (isDislikeActive ? 'rgba(150,150,150,0.3)' : 'rgba(255,107,107,0.2)')};overflow:hidden;${userHighlightStyle}">
                <div style="background:rgba(255,107,107,0.15);padding:6px 12px;display:flex;align-items:center;justify-content:space-between;">
                    <div style="display:flex;align-items:center;gap:6px;">
                        <span style="font-size:10px;">💕</span>
                        <span style="font-size:10px;font-weight:600;color:rgba(255,107,107,0.9);">${partnerName}的回复</span>
                    </div>
                    <div style="display:flex;align-items:center;gap:6px;">
                        ${timeStr ? `<span style="font-size:9px;color:rgba(255,107,107,0.6);">${timeStr}</span>` : ''}
                        <button class="env-reaction-mini-btn like-mini ${isLikeActive ? 'active' : ''}" onclick="setConversationReaction('${letterSection}','${letterId}',${itemIndex},'like')" title="喜欢" style="width:28px;height:28px;border:none;background:transparent;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;transition:all 0.2s;${isLikeActive ? 'color:#ff4757;' : 'color:rgba(255,107,107,0.5);'}">♡</button>
                        <button class="env-reaction-mini-btn dislike-mini ${isDislikeActive ? 'active' : ''}" onclick="setConversationReaction('${letterSection}','${letterId}',${itemIndex},'dislike')" title="一般" style="width:28px;height:28px;border:none;background:transparent;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:14px;transition:all 0.2s;${isDislikeActive ? 'color:#666;' : 'color:rgba(255,107,107,0.4);'}">⏛</button>
                    </div>
                </div>
                <div style="padding:10px 12px;font-size:12px;color:var(--text-primary);line-height:1.6;white-space:pre-wrap;word-break:break-word;">${processedContent}</div>
            </div>`;
    }
}

// 设置对话项的表态
window.setConversationReaction = function(section, letterId, itemIndex, reactionType) {
    let letters, letter;
    
    if (section === 'partner') {
        letters = envelopeData.partnerLetters || [];
        letter = letters.find(l => l.id === letterId);
    } else if (section === 'inbox') {
        letters = envelopeData.inbox || [];
        letter = letters.find(l => l.id === letterId);
    } else if (section === 'outbox') {
        letters = envelopeData.outbox || [];
        letter = letters.find(l => l.id === letterId);
    }
    
    if (!letter) return;
    
    // 获取对话历史
    const history = letter.conversationHistory || [];
    
    if (history.length > 0) {
        // 有对话历史，更新对应项
        if (history[itemIndex] && history[itemIndex].type === 'taReply') {
            // 如果点击的是当前已选中的，则取消选中
            if (history[itemIndex].reaction === reactionType) {
                history[itemIndex].reaction = null;
            } else {
                history[itemIndex].reaction = reactionType;
            }
        }
    } else {
        // 兼容旧数据：直接更新 letter.taReplyReaction
        if (letter.taReply) {
            if (letter.taReplyReaction === reactionType) {
                letter.taReplyReaction = null;
            } else {
                letter.taReplyReaction = reactionType;
            }
        }
    }
    
    saveEnvelopeData();
    
    // 重新渲染对话历史
    const conversationHistorySection = document.getElementById('env-view-conversation-history');
    if (conversationHistorySection) {
        let historyHtml = '';
        
        // 找到最新的表态索引（从后往前找第一个有表态的myReply）
        let latestReactionIndex = -1;
        for (let i = history.length - 1; i >= 0; i--) {
            if (history[i].type === 'myReply' && history[i].taReaction) {
                latestReactionIndex = i;
                break;
            }
        }
        
        if (history.length > 0) {
            history.forEach((item, index) => {
                const reaction = item.reaction || null;
                const taReaction = item.taReaction || null;
                const isLatest = index === latestReactionIndex;
                historyHtml += renderConversationItem(item.type, item.content, item.time, reaction, section, letterId, index, taReaction, isLatest);
            });
        } else {
            if (letter.myReply) {
                historyHtml += renderConversationItem('myReply', letter.myReply, letter.myReplyTime, null, section, letterId, 0, letter.myReplyTaReaction || null, letter.myReplyTaReaction ? true : false);
            }
            if (letter.taReply) {
                historyHtml += renderConversationItem('taReply', letter.taReply, letter.taReplyReceivedTime, letter.taReplyReaction || null, section, letterId, 1, null, false);
            }
        }
        
        if (historyHtml) {
            conversationHistorySection.innerHTML = historyHtml;
        }
    }
    
    // 显示提示
    if (reactionType === 'like') {
        showNotification('已标记为喜欢 💕', 'success');
    } else {
        showNotification('已标记', 'success');
    }
};

// 设置单独Ta回复区域的表态（用于兼容旧数据的单独Ta回复显示）
window.setLetterReaction = function(reactionType) {
    if (!editingEnvId || !editingEnvSection) return;
    
    let letters, letter;
    
    if (editingEnvSection === 'partner') {
        letters = envelopeData.partnerLetters || [];
        letter = letters.find(l => l.id === editingEnvId);
    } else if (editingEnvSection === 'inbox') {
        letters = envelopeData.inbox || [];
        letter = letters.find(l => l.id === editingEnvId);
    } else if (editingEnvSection === 'outbox') {
        letters = envelopeData.outbox || [];
        letter = letters.find(l => l.id === editingEnvId);
    }
    
    if (!letter) return;
    
    // 更新表态
    if (letter.taReplyReaction === reactionType) {
        letter.taReplyReaction = null;
    } else {
        letter.taReplyReaction = reactionType;
    }
    
    saveEnvelopeData();
    
    // 更新按钮状态
    const likeBtn = document.getElementById('env-reaction-like');
    const dislikeBtn = document.getElementById('env-reaction-dislike');
    
    if (likeBtn) {
        if (letter.taReplyReaction === 'like') {
            likeBtn.classList.add('active');
            likeBtn.querySelector('svg').setAttribute('fill', '#ff6b6b');
            likeBtn.querySelector('svg').setAttribute('stroke', '#ff6b6b');
        } else {
            likeBtn.classList.remove('active');
            likeBtn.querySelector('svg').setAttribute('fill', 'none');
            likeBtn.querySelector('svg').setAttribute('stroke', 'currentColor');
        }
    }
    
    if (dislikeBtn) {
        if (letter.taReplyReaction === 'dislike') {
            dislikeBtn.classList.add('active');
        } else {
            dislikeBtn.classList.remove('active');
        }
    }
    
    // 显示提示
    if (reactionType === 'like') {
        showNotification('已标记为喜欢 💕', 'success');
    } else {
        showNotification('已标记', 'success');
    }
};

window.deletePartnerLetter = function(event, id) {
    event.stopPropagation();
    if (!confirm('确定要删除这封信吗？')) return;
    envelopeData.partnerLetters = (envelopeData.partnerLetters || []).filter(l => l.id !== id);
    saveEnvelopeData();
    renderInboxLists();
    showNotification('已删除', 'success');
};

function generateTaReplyContent(myReply, originalContent) {
    const replies = (typeof customReplies !== 'undefined' && customReplies.length > 0) ? customReplies : ['好的', '嗯嗯', '收到'];
    const emojis = ['💕', '✨', '💖', '🥰', '😊', '💝'];
    
    const sentenceCount = Math.floor(Math.random() * 4) + 2;
    let replyContent = "";
    
    for (let i = 0; i < sentenceCount; i++) {
        const randomSentence = replies[Math.floor(Math.random() * replies.length)];
        const punctuation = Math.random() < 0.3 ? "~" : (Math.random() < 0.3 ? "！" : "。");
        replyContent += randomSentence + punctuation;
    }
    
    if (Math.random() < 0.5) {
        replyContent += " " + emojis[Math.floor(Math.random() * emojis.length)];
    }
    
    return replyContent;
}

function showTaReplyNotification(letter, type) {
    const existing = document.getElementById('ta-reply-popup');
    if (existing) existing.remove();
    
    const popup = document.createElement('div');
    popup.id = 'ta-reply-popup';
    popup.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:var(--secondary-bg);border:1px solid var(--border-color);border-radius:20px;padding:18px 20px;z-index:8000;max-width:320px;width:88%;box-shadow:0 8px 32px rgba(0,0,0,0.18);display:flex;flex-direction:column;gap:12px;animation:slideUpNotif 0.4s cubic-bezier(0.22,1,0.36,1);';
    popup.innerHTML = `
        <style>@keyframes slideUpNotif{from{opacity:0;transform:translateX(-50%) translateY(24px) scale(0.9)}60%{transform:translateX(-50%) translateY(-4px) scale(1.02)}to{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}}</style>
        <div style="display:flex;align-items:center;gap:10px;">
            <span style="font-size:26px;">💕</span>
            <div>
                <div style="font-size:14px;font-weight:700;color:var(--text-primary);">Ta回复了你的回信</div>
                <div style="font-size:11px;color:var(--text-secondary);margin-top:2px;opacity:0.8;">快去看看Ta说了什么~</div>
            </div>
        </div>
        <div style="display:flex;gap:8px;">
            <button onclick="document.getElementById('ta-reply-popup').remove();" style="flex:1;padding:8px 0;border-radius:12px;border:1px solid var(--border-color);background:var(--primary-bg);color:var(--text-secondary);font-size:13px;cursor:pointer;">稍后查看</button>
            <button onclick="viewTaReplyFromPopup('${letter.id}','${type}');" style="flex:2;padding:8px 0;border-radius:12px;border:none;background:var(--accent-color);color:#fff;font-size:13px;font-weight:600;cursor:pointer;">立即查看 💬</button>
        </div>`;
    document.body.appendChild(popup);
    setTimeout(() => { if (popup.parentNode) popup.remove(); }, 8000);
}

window.viewTaReplyFromPopup = function(letterId, type) {
    const popup = document.getElementById('ta-reply-popup');
    if (popup) popup.remove();
    
    const envelopeModal = document.getElementById('envelope-modal');
    showModal(envelopeModal);
    setTimeout(() => {
        switchEnvTab('inbox');
        if (type === 'Ta的信') {
            switchInboxSubTab('letter');
            viewPartnerLetter(letterId);
        } else {
            switchInboxSubTab('reply');
            viewEnvLetter('inbox', letterId);
        }
    }, 200);
};

window.startReplyToLetter = function() {
    const replySection = document.getElementById('env-reply-section');
    if (replySection) {
        replySection.style.display = 'block';
        document.getElementById('env-reply-input').focus();
    }
};

// 别名，兼容HTML中的调用
window.showReplySection = window.startReplyToLetter;

window.cancelReplyToLetter = function() {
    const replySection = document.getElementById('env-reply-section');
    if (replySection) {
        replySection.style.display = 'none';
        document.getElementById('env-reply-input').value = '';
    }
};

window.sendReplyToLetter = function() {
    const replyText = document.getElementById('env-reply-input').value.trim();
    if (!replyText) {
        showNotification('回信内容不能为空', 'warning');
        return;
    }
    
    if (editingEnvSection === 'partner') {
        const letter = envelopeData.partnerLetters.find(l => l.id === editingEnvId);
        if (letter) {
            // 初始化对话历史数组
            if (!letter.conversationHistory) {
                letter.conversationHistory = [];
            }
            
            // 迁移旧数据：如果之前有 myReply 但不在 conversationHistory 中，先保存
            if (letter.myReply && !letter.conversationHistory.some(item => item.type === 'myReply')) {
                letter.conversationHistory.push({
                    type: 'myReply',
                    content: letter.myReply,
                    time: letter.myReplyTime || Date.now()
                });
            }
            // 迁移旧数据：如果之前有 taReply 但不在 conversationHistory 中，先保存
            if (letter.taReply && !letter.conversationHistory.some(item => item.type === 'taReply')) {
                letter.conversationHistory.push({
                    type: 'taReply',
                    content: letter.taReply,
                    time: letter.taReplyReceivedTime || Date.now()
                });
            }
            
            // 添加我的回信到对话历史
            // Ta的表态会在Ta回复时设置，这里不预设
            letter.conversationHistory.push({
                type: 'myReply',
                content: replyText,
                time: Date.now()
            });
            
            // 更新当前回信字段
            letter.myReply = replyText;
            letter.myReplyTime = Date.now();
            
            // 设置Ta回复的等待时间（3-12小时）
            const minHours = 3, maxHours = 12;
            const randomHours = Math.random() * (maxHours - minHours) + minHours;
            letter.taReplyTime = Date.now() + randomHours * 60 * 60 * 1000;
            letter.taReplyStatus = 'pending';
            saveEnvelopeData();
            showNotification(`回信已发送 ✨ 预计 ${Math.floor(randomHours)} 小时后收到Ta的回复`, 'success');
            viewPartnerLetter(editingEnvId);
        }
    } else if (editingEnvSection === 'inbox') {
        const letter = envelopeData.inbox.find(l => l.id === editingEnvId);
        if (letter) {
            // 初始化对话历史数组
            if (!letter.conversationHistory) {
                letter.conversationHistory = [];
            }
            
            // 迁移旧数据：如果之前有 myReply 但不在 conversationHistory 中，先保存
            if (letter.myReply && !letter.conversationHistory.some(item => item.type === 'myReply')) {
                letter.conversationHistory.push({
                    type: 'myReply',
                    content: letter.myReply,
                    time: letter.myReplyTime || Date.now()
                });
            }
            // 迁移旧数据：如果之前有 taReply 但不在 conversationHistory 中，先保存
            if (letter.taReply && !letter.conversationHistory.some(item => item.type === 'taReply')) {
                letter.conversationHistory.push({
                    type: 'taReply',
                    content: letter.taReply,
                    time: letter.taReplyReceivedTime || Date.now()
                });
            }
            
            // 添加我的回信到对话历史
            // Ta的表态会在Ta回复时设置，这里不预设
            letter.conversationHistory.push({
                type: 'myReply',
                content: replyText,
                time: Date.now()
            });
            
            // 更新当前回信字段
            letter.myReply = replyText;
            letter.myReplyTime = Date.now();
            
            // 设置Ta回复的等待时间（3-12小时）
            const minHours = 3, maxHours = 12;
            const randomHours = Math.random() * (maxHours - minHours) + minHours;
            letter.taReplyTime = Date.now() + randomHours * 60 * 60 * 1000;
            letter.taReplyStatus = 'pending';
            saveEnvelopeData();
            showNotification(`回信已发送 ✨ 预计 ${Math.floor(randomHours)} 小时后收到Ta的回复`, 'success');
            viewEnvLetter('inbox', editingEnvId);
        }
    }
    
    document.getElementById('env-reply-input').value = '';
};

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    loadEnvelopeData();
    setInterval(checkEnvelopeStatus, 30000);
    setInterval(checkAndGeneratePartnerLetters, 60000);
    setTimeout(checkAndGeneratePartnerLetters, 5000);
});
