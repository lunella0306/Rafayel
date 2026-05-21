(function () {
    'use strict';

    // Storage keys
    const KEY_ENABLED = 'scheduleFeatureEnabled';
    const KEY_SCHEDULES = 'schedulesData';
    const KEY_PANEL_POS = 'schedulePanelPos';

    // State
    const S = {
        enabled: localStorage.getItem(KEY_ENABLED) !== 'false',
        schedules: JSON.parse(localStorage.getItem(KEY_SCHEDULES) || '[]'),
        panelOpen: false,
        pos: JSON.parse(localStorage.getItem(KEY_PANEL_POS) || 'null'),
        dragOff: null,
        editingId: null,
        eventsBound: false, // 防止重复绑定事件
    };

    // Utility functions
    const generateId = () => 'sch_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

    // Format date for display
    function formatDate(timestamp) {
        const d = new Date(timestamp);
        const now = new Date();
        const isToday = d.toDateString() === now.toDateString();
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const isTomorrow = d.toDateString() === tomorrow.toDateString();
        
        const timeStr = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        
        if (isToday) return `今天 ${timeStr}`;
        if (isTomorrow) return `明天 ${timeStr}`;
        return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }) + ' ' + timeStr;
    }

    // Save schedules to localStorage
    function saveSchedules() {
        localStorage.setItem(KEY_SCHEDULES, JSON.stringify(S.schedules));
    }

    // CRUD Operations
    function addSchedule(schedule) {
        const newSchedule = {
            id: generateId(),
            title: schedule.title || '新日程',
            description: schedule.description || '',
            datetime: schedule.datetime || Date.now(),
            reminder: schedule.reminder || false,
            completed: false,
            createdAt: Date.now()
        };
        S.schedules.push(newSchedule);
        saveSchedules();
        renderScheduleList();
        return newSchedule;
    }

    function updateSchedule(id, updates) {
        const index = S.schedules.findIndex(s => s.id === id);
        if (index !== -1) {
            S.schedules[index] = { ...S.schedules[index], ...updates, updatedAt: Date.now() };
            saveSchedules();
            renderScheduleList();
            return S.schedules[index];
        }
        return null;
    }

    function deleteSchedule(id) {
        const index = S.schedules.findIndex(s => s.id === id);
        if (index !== -1) {
            S.schedules.splice(index, 1);
            saveSchedules();
            renderScheduleList();
            return true;
        }
        return false;
    }

    function getSchedule(id) {
        return S.schedules.find(s => s.id === id);
    }

    function getAllSchedules() {
        return [...S.schedules].sort((a, b) => a.datetime - b.datetime);
    }

    // Inject CSS styles
    function injectCSS() {
        if (document.getElementById('schedule-feature-style')) return;
        const style = document.createElement('style');
        style.id = 'schedule-feature-style';
        style.textContent = `
/* 日程面板 - 可打开/关闭的窗口样式 */
#schedule-panel {
    position: fixed;
    z-index: 99950;
    display: none;
    flex-direction: column;
    width: 340px;
    max-height: 520px;
    background: var(--primary-bg, #fff);
    border-radius: 20px;
    box-shadow: 0 25px 80px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.1);
    overflow: hidden;
    user-select: none;
}
#schedule-panel.visible {
    display: flex;
    animation: schedulePanelIn 0.35s cubic-bezier(0.22, 1, 0.36, 1);
}
@keyframes schedulePanelIn {
    from { opacity: 0; transform: scale(0.9) translateY(10px); }
    to { opacity: 1; transform: scale(1) translateY(0); }
}

/* Modal overlay for add/edit form */
#schedule-modal-overlay {
    position: fixed;
    inset: 0;
    z-index: 99960;
    display: none;
    align-items: center;
    justify-content: center;
    background: rgba(0,0,0,0.5);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
}
#schedule-modal-overlay.visible {
    display: flex;
    animation: scheduleFadeIn 0.3s ease;
}
@keyframes scheduleFadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
}

#schedule-modal {
    width: 92%;
    max-width: 380px;
    background: var(--primary-bg, #fff);
    border-radius: 18px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.4);
    overflow: hidden;
    animation: scheduleSlideIn 0.35s cubic-bezier(0.4, 0, 0.2, 1);
}
@keyframes scheduleSlideIn {
    from { opacity: 0; transform: translateY(20px) scale(0.95); }
    to { opacity: 1; transform: translateY(0) scale(1); }
}

#schedule-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 18px;
    border-bottom: 1px solid var(--border-color, #eee);
    background: linear-gradient(135deg, rgba(var(--accent-color-rgb, 224,105,138), 0.08), rgba(var(--accent-color-rgb, 224,105,138), 0.02));
    cursor: grab;
    flex-shrink: 0;
}
#schedule-header:active {
    cursor: grabbing;
}
#schedule-title {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 18px;
    font-weight: 700;
    color: var(--text-primary, #222);
}
#schedule-title i {
    color: var(--accent-color, #e0698a);
    font-size: 20px;
}
#schedule-close-btn {
    width: 32px;
    height: 32px;
    border: none;
    background: var(--secondary-bg, #f5f5f5);
    border-radius: 50%;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-secondary, #666);
    font-size: 14px;
    transition: all 0.25s;
}
#schedule-close-btn:hover {
    background: var(--accent-color, #e0698a);
    color: #fff;
    transform: rotate(90deg);
}
#schedule-body {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    min-height: 100px;
}
#schedule-empty {
    text-align: center;
    padding: 40px 20px;
    color: var(--text-secondary, #666);
}
#schedule-empty i {
    font-size: 48px;
    color: var(--accent-color, #e0698a);
    opacity: 0.4;
    margin-bottom: 14px;
    display: block;
}
#schedule-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
}
.schedule-item {
    display: flex;
    align-items: center;
    gap: 12px;
    background: var(--secondary-bg, #fafafa);
    border-radius: 12px;
    padding: 14px 16px;
    border-left: 4px solid var(--accent-color, #e0698a);
    box-shadow: 0 2px 8px rgba(0,0,0,0.05);
    transition: all 0.2s ease;
}
.schedule-item:hover {
    transform: translateX(4px);
    box-shadow: 0 4px 12px rgba(0,0,0,0.08);
}
.schedule-item.completed {
    opacity: 0.6;
}
.schedule-item.completed .schedule-item-title {
    text-decoration: line-through;
}
.schedule-item-checkbox {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: 2px solid var(--accent-color, #e0698a);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
    transition: all 0.2s;
    background: var(--primary-bg, #fff);
}
.schedule-item-checkbox:hover {
    background: rgba(var(--accent-color-rgb, 224,105,138), 0.1);
}
.schedule-item-checkbox.checked {
    background: var(--accent-color, #e0698a);
    color: #fff;
}
.schedule-item-checkbox i {
    font-size: 12px;
}
.schedule-item-content {
    flex: 1;
    min-width: 0;
    cursor: pointer;
}
.schedule-item-title {
    font-weight: 600;
    font-size: 15px;
    color: var(--text-primary, #222);
    line-height: 1.3;
    margin-bottom: 4px;
}
.schedule-item-time {
    font-size: 13px;
    font-weight: 500;
    color: var(--accent-color, #e0698a);
    display: flex;
    align-items: center;
    gap: 5px;
}
.schedule-item-time i {
    font-size: 11px;
}
.schedule-item-actions {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
}
.schedule-action-btn {
    width: 30px;
    height: 30px;
    border: none;
    background: var(--primary-bg, #fff);
    border-radius: 8px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-secondary, #666);
    font-size: 12px;
    transition: all 0.2s;
    box-shadow: 0 1px 4px rgba(0,0,0,0.05);
}
.schedule-action-btn:hover {
    background: var(--accent-color, #e0698a);
    color: #fff;
    transform: scale(1.1);
}
.schedule-action-btn.delete:hover {
    background: #ff5252;
}
#schedule-footer {
    padding: 14px 16px;
    border-top: 1px solid var(--border-color, #eee);
    background: var(--secondary-bg, #fafafa);
    flex-shrink: 0;
}
#schedule-add-btn {
    width: 100%;
    padding: 12px;
    border: none;
    background: linear-gradient(135deg, var(--accent-color, #e0698a), color-mix(in srgb, var(--accent-color, #e0698a) 85%, #000));
    color: #fff;
    border-radius: 12px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    transition: all 0.2s;
    box-shadow: 0 4px 12px rgba(var(--accent-color-rgb, 224,105,138), 0.3);
}
#schedule-add-btn:hover {
    filter: brightness(1.08);
    transform: translateY(-1px);
}
#schedule-add-btn:active {
    transform: translateY(0);
}

/* 添加/编辑日程表单 */
.schedule-form-overlay {
    position: absolute;
    inset: 0;
    background: rgba(0,0,0,0.5);
    display: none;
    align-items: center;
    justify-content: center;
    backdrop-filter: blur(5px);
}
.schedule-form-overlay.visible {
    display: flex;
}
.schedule-form {
    width: 90%;
    max-width: 380px;
    background: var(--primary-bg, #fff);
    border-radius: 18px;
    padding: 24px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
}
.schedule-form-title {
    font-size: 18px;
    font-weight: 700;
    margin-bottom: 20px;
    color: var(--text-primary, #222);
}
.schedule-form-group {
    margin-bottom: 18px;
}
.schedule-form-label {
    display: block;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary, #333);
    margin-bottom: 8px;
}
.schedule-form-input {
    width: 100%;
    padding: 14px 16px;
    border: 2px solid var(--border-color, #ddd);
    border-radius: 12px;
    font-size: 15px;
    background: var(--secondary-bg, #fafafa);
    color: var(--text-primary, #222);
    box-sizing: border-box;
    transition: all 0.2s;
}
.schedule-form-input:focus {
    outline: none;
    border-color: var(--accent-color, #e0698a);
    background: var(--primary-bg, #fff);
    box-shadow: 0 0 0 4px rgba(var(--accent-color-rgb, 224,105,138), 0.15);
}
.schedule-form-textarea {
    min-height: 100px;
    resize: vertical;
    line-height: 1.5;
}
.schedule-form-buttons {
    display: flex;
    gap: 12px;
    margin-top: 24px;
}
.schedule-form-btn {
    flex: 1;
    padding: 14px;
    border: none;
    border-radius: 12px;
    font-size: 15px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.2s;
}
.schedule-form-btn.cancel {
    background: var(--secondary-bg, #f0f0f0);
    color: var(--text-primary, #444);
}
.schedule-form-btn.cancel:hover {
    background: var(--border-color, #ddd);
}
.schedule-form-btn.submit {
    background: var(--accent-color, #e0698a);
    color: #fff;
    box-shadow: 0 4px 12px rgba(var(--accent-color-rgb, 224,105,138), 0.3);
}
.schedule-form-btn.submit:hover {
    filter: brightness(1.1);
    transform: translateY(-1px);
}
.schedule-form-btn:active {
    transform: translateY(0);
}

/* Modal styles */
#schedule-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 18px 20px;
    border-bottom: 1px solid var(--border-color, #eee);
}
#schedule-modal-title {
    font-size: 18px;
    font-weight: 700;
    color: var(--text-primary, #222);
}
#schedule-modal-close {
    width: 30px;
    height: 30px;
    border: none;
    background: var(--secondary-bg, #f5f5f5);
    border-radius: 50%;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-secondary, #666);
    font-size: 14px;
    transition: all 0.2s;
}
#schedule-modal-close:hover {
    background: var(--accent-color, #e0698a);
    color: #fff;
}
#schedule-modal-body {
    padding: 20px;
}
#schedule-modal-actions {
    display: flex;
    gap: 12px;
    padding: 16px 20px;
    border-top: 1px solid var(--border-color, #eee);
    background: var(--secondary-bg, #fafafa);
}
.schedule-modal-btn {
    flex: 1;
    padding: 12px;
    border: none;
    border-radius: 10px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
}
.schedule-modal-btn.cancel {
    background: var(--secondary-bg, #f0f0f0);
    color: var(--text-primary, #444);
}
.schedule-modal-btn.cancel:hover {
    background: var(--border-color, #ddd);
}
.schedule-modal-btn.save {
    background: var(--accent-color, #e0698a);
    color: #fff;
    box-shadow: 0 4px 12px rgba(var(--accent-color-rgb, 224,105,138), 0.3);
}
.schedule-modal-btn.save:hover {
    filter: brightness(1.1);
}
`;
    document.head.appendChild(style);
}

    // Inject HTML structure
    function injectHTML() {
        if (document.getElementById('schedule-feature-root')) return;
        const root = document.createElement('div');
        root.id = 'schedule-feature-root';
        root.innerHTML = `
<div id="schedule-panel">
    <div id="schedule-header">
        <div id="schedule-title"><i class="fas fa-calendar-alt"></i>日程</div>
        <button id="schedule-close-btn"><i class="fas fa-times"></i></button>
    </div>
    <div id="schedule-body">
        <div id="schedule-list"></div>
        <div id="schedule-empty" style="display:none;">
            <i class="fas fa-calendar-check"></i>
            <div>暂无日程</div>
            <div style="font-size:12px;margin-top:4px;">点击下方按钮添加新日程</div>
        </div>
    </div>
    <div id="schedule-footer">
        <button id="schedule-add-btn"><i class="fas fa-plus"></i>添加日程</button>
    </div>
</div>

<div id="schedule-modal-overlay">
    <div id="schedule-modal">
        <div id="schedule-modal-header">
            <span id="schedule-modal-title">添加日程</span>
            <button id="schedule-modal-close"><i class="fas fa-times"></i></button>
        </div>
        <div id="schedule-modal-body">
            <div class="schedule-form-group">
                <label class="schedule-form-label">标题</label>
                <input type="text" class="schedule-form-input" id="schedule-input-title" placeholder="输入日程标题">
            </div>
            <div class="schedule-form-group">
                <label class="schedule-form-label">时间</label>
                <input type="datetime-local" class="schedule-form-input" id="schedule-input-datetime">
            </div>
            <div class="schedule-form-group">
                <label class="schedule-form-label">描述（可选）</label>
                <textarea class="schedule-form-input" id="schedule-input-desc" placeholder="添加描述..."></textarea>
            </div>
        </div>
        <div id="schedule-modal-actions">
            <button class="schedule-modal-btn cancel" id="schedule-modal-cancel">取消</button>
            <button class="schedule-modal-btn save" id="schedule-modal-save">保存</button>
        </div>
    </div>
</div>
        `;
        document.body.appendChild(root);
    }

    // Render schedule list
    function renderScheduleList() {
        const list = document.getElementById('schedule-list');
        const empty = document.getElementById('schedule-empty');
        if (!list || !empty) return;

        const schedules = getAllSchedules();
        
        if (schedules.length === 0) {
            list.innerHTML = '';
            empty.style.display = 'block';
            return;
        }
        
        empty.style.display = 'none';
        list.innerHTML = schedules.map(s => `
            <div class="schedule-item ${s.completed ? 'completed' : ''}" data-id="${s.id}">
                <div class="schedule-item-checkbox ${s.completed ? 'checked' : ''}" data-action="toggle">
                    ${s.completed ? '<i class="fas fa-check"></i>' : ''}
                </div>
                <div class="schedule-item-content" data-action="edit">
                    <div class="schedule-item-title">${escapeHtml(s.title)}</div>
                    <div class="schedule-item-time">
                        <i class="fas fa-clock"></i>
                        ${formatDate(s.datetime)}
                    </div>
                </div>
                <div class="schedule-item-actions">
                    <button class="schedule-action-btn" data-action="edit" title="编辑">
                        <i class="fas fa-pen"></i>
                    </button>
                    <button class="schedule-action-btn delete" data-action="delete" title="删除">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `).join('');
    }

    // Escape HTML
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Open schedule panel
    function openPanel() {
        // 确保 HTML 已注入
        const root = document.getElementById('schedule-feature-root');
        if (!root) {
            injectHTML();
            bindEvents();
            initDrag();
        }
        
        if (!S.enabled) {
            console.log('[Schedule] Feature is disabled');
            return;
        }
        
        const panel = document.getElementById('schedule-panel');
        if (!panel) {
            console.error('[Schedule] Panel element not found');
            return;
        }
        
        positionPanel();
        panel.classList.add('visible');
        S.panelOpen = true;
        renderScheduleList();
        console.log('[Schedule] Panel opened successfully');
    }

    // Close schedule panel
    function closePanel() {
        const panel = document.getElementById('schedule-panel');
        if (panel) panel.classList.remove('visible');
        S.panelOpen = false;
    }

    // Position panel
    function positionPanel() {
        const panel = document.getElementById('schedule-panel');
        if (!panel) return;
        
        if (S.pos) {
            panel.style.left = clamp(S.pos.x, 0, window.innerWidth - 340) + 'px';
            panel.style.top = clamp(S.pos.y, 0, window.innerHeight - 400) + 'px';
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
        } else {
            panel.style.right = '20px';
            panel.style.top = '80px';
            panel.style.left = 'auto';
            panel.style.bottom = 'auto';
        }
    }

    // Open modal for add/edit
    function openModal(schedule = null) {
        const overlay = document.getElementById('schedule-modal-overlay');
        const title = document.getElementById('schedule-modal-title');
        const inputTitle = document.getElementById('schedule-input-title');
        const inputDatetime = document.getElementById('schedule-input-datetime');
        const inputDesc = document.getElementById('schedule-input-desc');
        
        if (!overlay || !inputTitle || !inputDatetime || !inputDesc) return;
        
        if (schedule) {
            S.editingId = schedule.id;
            title.textContent = '编辑日程';
            inputTitle.value = schedule.title;
            inputDatetime.value = new Date(schedule.datetime).toISOString().slice(0, 16);
            inputDesc.value = schedule.description || '';
        } else {
            S.editingId = null;
            title.textContent = '添加日程';
            inputTitle.value = '';
            // Default to tomorrow at 9:00
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setHours(9, 0, 0, 0);
            inputDatetime.value = tomorrow.toISOString().slice(0, 16);
            inputDesc.value = '';
        }
        
        overlay.classList.add('visible');
        setTimeout(() => inputTitle.focus(), 100);
    }

    // Close modal
    function closeModal() {
        const overlay = document.getElementById('schedule-modal-overlay');
        if (overlay) overlay.classList.remove('visible');
        S.editingId = null;
    }

    // Save from modal
    function saveFromModal() {
        const inputTitle = document.getElementById('schedule-input-title');
        const inputDatetime = document.getElementById('schedule-input-datetime');
        const inputDesc = document.getElementById('schedule-input-desc');
        
        if (!inputTitle || !inputDatetime) return;
        
        const title = inputTitle.value.trim();
        if (!title) {
            inputTitle.focus();
            return;
        }
        
        const datetime = new Date(inputDatetime.value).getTime();
        const description = inputDesc.value.trim();
        
        if (S.editingId) {
            updateSchedule(S.editingId, { title, datetime, description });
        } else {
            addSchedule({ title, datetime, description });
        }
        
        closeModal();
        if (typeof showNotification === 'function') {
            showNotification(S.editingId ? '日程已更新' : '日程已添加', 'success', 2000);
        }
    }

    // Initialize drag
    function initDrag() {
        const header = document.getElementById('schedule-header');
        const panel = document.getElementById('schedule-panel');
        if (!header || !panel) return;
        
        let on = false;
        header.addEventListener('pointerdown', e => {
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            if (e.target.closest('#schedule-close-btn')) return;
            e.preventDefault();
            const r = panel.getBoundingClientRect();
            S.dragOff = { x: e.clientX - r.left, y: e.clientY - r.top };
            on = true;
            try { header.setPointerCapture(e.pointerId); } catch(_) {}
        });
        
        header.addEventListener('pointermove', e => {
            if (!on || !S.dragOff) return;
            e.preventDefault();
            panel.style.left = clamp(e.clientX - S.dragOff.x, 0, window.innerWidth - panel.offsetWidth) + 'px';
            panel.style.top = clamp(e.clientY - S.dragOff.y, 0, window.innerHeight - panel.offsetHeight) + 'px';
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
        });
        
        const stop = e => {
            if (!on) return;
            on = false;
            const r = panel.getBoundingClientRect();
            S.pos = { x: r.left, y: r.top };
            localStorage.setItem(KEY_PANEL_POS, JSON.stringify(S.pos));
            try { header.releasePointerCapture(e.pointerId); } catch(_) {}
        };
        
        header.addEventListener('pointerup', stop);
        header.addEventListener('pointercancel', stop);
    }

    // Bind events
    function bindEvents() {
        // 防止重复绑定
        if (S.eventsBound) return;
        S.eventsBound = true;
        
        // Close button
        document.getElementById('schedule-close-btn')?.addEventListener('click', closePanel);
        
        // Add button
        document.getElementById('schedule-add-btn')?.addEventListener('click', () => openModal());
        
        // Modal events
        document.getElementById('schedule-modal-close')?.addEventListener('click', closeModal);
        document.getElementById('schedule-modal-cancel')?.addEventListener('click', closeModal);
        document.getElementById('schedule-modal-save')?.addEventListener('click', saveFromModal);
        
        // Close modal on overlay click
        document.getElementById('schedule-modal-overlay')?.addEventListener('click', e => {
            if (e.target.id === 'schedule-modal-overlay') closeModal();
        });
        
        // Handle Enter key in modal
        document.getElementById('schedule-input-title')?.addEventListener('keydown', e => {
            if (e.key === 'Enter') saveFromModal();
        });
        
        // Schedule list item actions
        document.getElementById('schedule-list')?.addEventListener('click', e => {
            const item = e.target.closest('.schedule-item');
            if (!item) return;
            
            const id = item.dataset.id;
            const action = e.target.closest('[data-action]')?.dataset.action;
            
            if (action === 'toggle') {
                const schedule = getSchedule(id);
                if (schedule) {
                    updateSchedule(id, { completed: !schedule.completed });
                }
            } else if (action === 'edit') {
                const schedule = getSchedule(id);
                if (schedule) openModal(schedule);
            } else if (action === 'delete') {
                if (confirm('确定要删除这个日程吗？')) {
                    deleteSchedule(id);
                    if (typeof showNotification === 'function') {
                        showNotification('日程已删除', 'info', 2000);
                    }
                }
            }
        });
        
        // Close panel on click outside
        document.addEventListener('click', e => {
            if (S.panelOpen && 
                !e.target.closest('#schedule-panel') && 
                !e.target.closest('#schedule-toolbar-btn') &&
                !e.target.closest('#schedule-btn-extra')) { // 支持从折叠面板按钮打开
                closePanel();
            }
        });
    }

    // Inject toolbar button - removed (now using collapsed panel button)
    function injectToolbarBtn() {
        // No longer injecting toolbar button - schedule is accessed from collapsed panel
        return;
    }

    // Update button visibility
    function updateBtnVisibility() {
        const btn = document.getElementById('schedule-toolbar-btn');
        if (btn) btn.style.display = S.enabled ? '' : 'none';
    }

    // Toggle enabled state
    function setEnabled(enabled) {
        S.enabled = enabled;
        localStorage.setItem(KEY_ENABLED, String(enabled));
        updateBtnVisibility();
        if (!enabled && S.panelOpen) closePanel();
    }

    // Get enabled state
    function isEnabled() {
        return S.enabled;
    }

    // Initialize
    function init() {
        injectCSS();
        injectHTML();
        bindEvents();
        initDrag();
        
        // Watch for toolbar anchor
        const observer = new MutationObserver(() => {
            injectToolbarBtn();
        });
        observer.observe(document.body, { childList: true, subtree: true });
        
        // Try to inject immediately
        injectToolbarBtn();
    }

    // Public API
    window.scheduleFeature = {
        init,
        open: openPanel,
        close: closePanel,
        add: addSchedule,
        update: updateSchedule,
        delete: deleteSchedule,
        get: getSchedule,
        getAll: getAllSchedules,
        setEnabled,
        isEnabled
    };

    // Auto-init when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
