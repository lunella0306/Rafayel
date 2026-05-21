/**
 * 小红书解析功能模块
 * 支持解析小红书分享链接，生成卡片发送到聊天
 */
(function() {
    'use strict';

    // API接口
    const XHS_API_URL = 'https://api.bugpk.com/api/xhsjx';

    // 当前解析的数据
    let currentXhsData = null;

    // CSS样式
    const XHS_STYLES = `
/* 小红书分享卡片样式 */
.xhs-share-card {
    max-width: 280px;
    background: var(--secondary-bg);
    border-radius: 16px;
    overflow: hidden;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
    border: 1px solid var(--border-color);
    font-family: var(--font-family);
}

/* 博主信息头部 */
.xhs-card-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 12px 10px;
}

.xhs-card-avatar {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    overflow: hidden;
    flex-shrink: 0;
    background: linear-gradient(135deg, #ff6b6b, #ff8e53);
    display: flex;
    align-items: center;
    justify-content: center;
}

.xhs-card-avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.xhs-card-avatar i {
    font-size: 20px;
    color: #fff;
}

.xhs-card-author-info {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
}

.xhs-card-author-name {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
}

.xhs-card-badge {
    font-size: 10px;
    padding: 2px 8px;
    background: linear-gradient(135deg, #ff6b6b, #ff8e53);
    color: #fff;
    border-radius: 10px;
    font-weight: 500;
}

/* 媒体区域 */
.xhs-card-media {
    position: relative;
    background: var(--primary-bg);
}

/* 单张图片 */
.xhs-card-single {
    position: relative;
    cursor: pointer;
}

.xhs-card-single img {
    width: 100%;
    max-height: 280px;
    object-fit: cover;
    display: block;
}

.xhs-card-image-badge {
    position: absolute;
    bottom: 8px;
    right: 8px;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(4px);
    color: #fff;
    padding: 4px 10px;
    border-radius: 20px;
    font-size: 11px;
    display: flex;
    align-items: center;
    gap: 4px;
}

/* 图片轮播 */
.xhs-card-slider {
    position: relative;
    overflow: hidden;
}

.xhs-card-slider-container {
    display: flex;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    scrollbar-width: none;
    -ms-overflow-style: none;
    cursor: grab;
}

.xhs-card-slider-container::-webkit-scrollbar {
    display: none;
}

.xhs-card-slide-item {
    flex: 0 0 100%;
    scroll-snap-align: start;
    cursor: pointer;
}

.xhs-card-slide-item img {
    width: 100%;
    aspect-ratio: 1 / 1;
    object-fit: cover;
    display: block;
}

.xhs-card-slider-indicator {
    position: absolute;
    bottom: 8px;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 12px;
}

.xhs-card-image-count {
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(4px);
    color: #fff;
    padding: 4px 10px;
    border-radius: 20px;
    font-size: 11px;
}

.xhs-card-slider-dots {
    display: flex;
    gap: 4px;
}

.xhs-card-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.5);
    transition: all 0.2s;
}

.xhs-card-dot.active {
    width: 16px;
    border-radius: 10px;
    background: #fff;
}

/* 视频 */
.xhs-card-video {
    position: relative;
}

.xhs-card-video video {
    width: 100%;
    max-height: 280px;
    display: block;
    background: #000;
}

.xhs-card-video-badge {
    position: absolute;
    bottom: 8px;
    right: 8px;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(4px);
    color: #fff;
    padding: 4px 10px;
    border-radius: 20px;
    font-size: 11px;
    pointer-events: none;
}

/* 标题 */
.xhs-card-title {
    padding: 12px 12px 6px;
    font-size: 15px;
    font-weight: 700;
    line-height: 1.4;
    color: var(--text-primary);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
}

/* 描述内容 */
.xhs-card-desc {
    padding: 4px 12px 10px;
    font-size: 13px;
    line-height: 1.6;
    color: var(--text-secondary);
    word-break: break-word;
    max-height: none;
    overflow: visible;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
}

/* 底部互动数据 */
.xhs-card-stats {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 8px 12px;
    border-top: 1px solid var(--border-color);
}

.xhs-card-stat-item {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: var(--text-secondary);
}

.xhs-card-stat-item i {
    font-size: 11px;
}

/* 底部来源 */
.xhs-card-footer {
    padding: 8px 12px 10px;
    border-top: 1px solid var(--border-color);
}

.xhs-card-source {
    font-size: 11px;
    color: var(--text-secondary);
    opacity: 0.7;
}

/* 预览区域的发送按钮 */
.xhs-send-btn {
    width: 100%;
    padding: 12px;
    margin-top: 12px;
    background: linear-gradient(135deg, #ff6b6b, #ff8e53);
    color: #fff;
    border: none;
    border-radius: 12px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
}

.xhs-send-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(255, 107, 107, 0.4);
}

.xhs-send-btn:active {
    transform: translateY(0);
}

/* 深色模式适配 */
html[data-theme="dark"] .xhs-share-card {
    background: var(--secondary-bg);
    border-color: var(--border-color);
}
`;

    // 注入CSS样式
    function injectStyles() {
        if (document.getElementById('xhs-parser-styles')) return;
        const styleEl = document.createElement('style');
        styleEl.id = 'xhs-parser-styles';
        styleEl.textContent = XHS_STYLES;
        document.head.appendChild(styleEl);
    }

    // 解析小红书链接
    async function parseXhsLink(url) {
        // 清理URL
        url = url.trim();
        
        // 验证链接格式
        if (!url.includes('xhslink.com') && !url.includes('xiaohongshu.com')) {
            throw new Error('请输入有效的小红书链接');
        }

        try {
            const response = await fetch(`${XHS_API_URL}?url=${encodeURIComponent(url)}`);
            const data = await response.json();

            if (data.code === 200 || data.code === 1 || data.data) {
                // 标准化数据格式
                return {
                    title: data.data?.title || data.title || '小红书笔记',
                    desc: data.data?.desc || data.desc || '',
                    author: {
                        name: data.data?.author?.name || data.author || data.data?.nickname || '小红书用户',
                        avatar: data.data?.author?.avatar || data.avatar || data.data?.avatar_url || ''
                    },
                    media: data.data?.images || data.images || data.data?.image_list || [],
                    video: data.data?.video || data.video || null,
                    likes: data.data?.likes || data.likes || data.data?.like_count || 0,
                    comments: data.data?.comments || data.comments || data.data?.comment_count || 0,
                    collects: data.data?.collects || data.collects || data.data?.collect_count || 0,
                    time: data.data?.time || data.time || '',
                    raw: data
                };
            } else {
                throw new Error(data.msg || data.message || '解析失败');
            }
        } catch (error) {
            console.error('小红书解析错误:', error);
            throw error;
        }
    }

    // 渲染解析结果
    function renderXhsResult(data) {
        const resultContent = document.getElementById('xhs-result-content');
        if (!resultContent) return;

        // 作者信息HTML
        const authorHtml = `
            <div style="display:flex;align-items:center;gap:10px;padding:12px;background:var(--primary-bg);border-radius:12px;margin-bottom:10px;">
                <div style="width:40px;height:40px;border-radius:50%;overflow:hidden;background:linear-gradient(135deg, #ff6b6b, #ff8e53);display:flex;align-items:center;justify-content:center;">
                    ${data.author.avatar 
                        ? `<img src="${data.author.avatar}" style="width:100%;height:100%;object-fit:cover;">` 
                        : `<i class="fas fa-user" style="color:#fff;font-size:16px;"></i>`}
                </div>
                <div>
                    <div style="font-size:14px;font-weight:600;color:var(--text-primary);">${data.author.name}</div>
                    <div style="font-size:11px;color:var(--text-secondary);">小红书博主</div>
                </div>
            </div>
        `;

        // 媒体内容HTML
        let mediaHtml = '';
        if (data.video) {
            // 视频
            mediaHtml = `
                <div style="position:relative;border-radius:12px;overflow:hidden;background:#000;">
                    <video src="${data.video}" controls style="width:100%;max-height:200px;display:block;"></video>
                    <div style="position:absolute;bottom:8px;right:8px;background:rgba(0,0,0,0.5);backdrop-filter:blur(4px);color:#fff;padding:4px 10px;border-radius:20px;font-size:11px;">
                        <i class="fas fa-video" style="margin-right:4px;"></i>视频
                    </div>
                </div>
            `;
        } else if (data.media && data.media.length > 0) {
            // 图片
            const firstImage = data.media[0];
            mediaHtml = `
                <div style="position:relative;border-radius:12px;overflow:hidden;">
                    <img src="${typeof firstImage === 'string' ? firstImage : firstImage.url || firstImage}" style="width:100%;max-height:200px;object-fit:cover;display:block;">
                    ${data.media.length > 1 ? `<div style="position:absolute;bottom:8px;right:8px;background:rgba(0,0,0,0.5);backdrop-filter:blur(4px);color:#fff;padding:4px 10px;border-radius:20px;font-size:11px;"><i class="fas fa-images" style="margin-right:4px;"></i>${data.media.length}张</div>` : ''}
                </div>
            `;
        }

        // 标题和描述
        const contentHtml = `
            <div style="padding:10px 0;">
                <div style="font-size:15px;font-weight:600;color:var(--text-primary);line-height:1.4;margin-bottom:6px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">
                    ${data.title}
                </div>
                ${data.desc ? `<div style="font-size:13px;color:var(--text-secondary);line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${data.desc}</div>` : ''}
            </div>
        `;

        // 互动数据
        const statsHtml = `
            <div style="display:flex;align-items:center;gap:16px;padding:8px 0;border-top:1px solid var(--border-color);">
                <span style="font-size:12px;color:var(--text-secondary);"><i class="fas fa-heart" style="margin-right:4px;color:#ff6b6b;"></i>${formatNumber(data.likes)}</span>
                <span style="font-size:12px;color:var(--text-secondary);"><i class="fas fa-comment" style="margin-right:4px;"></i>${formatNumber(data.comments)}</span>
                <span style="font-size:12px;color:var(--text-secondary);"><i class="fas fa-star" style="margin-right:4px;color:#ffc107;"></i>${formatNumber(data.collects)}</span>
            </div>
        `;

        resultContent.innerHTML = authorHtml + mediaHtml + contentHtml + statsHtml + `
            <button class="xhs-send-btn" onclick="window.xhsParser.sendToChat()">
                <i class="fas fa-paper-plane"></i>
                发送到聊天
            </button>
        `;

        document.getElementById('xhs-result-container').style.display = 'block';
    }

    // 格式化数字
    function formatNumber(num) {
        if (!num) return '0';
        num = parseInt(num);
        if (num >= 10000) {
            return (num / 10000).toFixed(1) + 'w';
        } else if (num >= 1000) {
            return (num / 1000).toFixed(1) + 'k';
        }
        return num.toString();
    }

    // 构建卡片HTML
    function buildXhsCardHtml(data) {
        // 媒体内容
        let mediaHtml = '';
        if (data.video) {
            mediaHtml = `
                <div class="xhs-card-video">
                    <video src="${data.video}" controls style="width:100%;max-height:280px;"></video>
                    <div class="xhs-card-video-badge"><i class="fas fa-video"></i> 视频</div>
                </div>
            `;
        } else if (data.media && data.media.length > 0) {
            const firstImage = data.media[0];
            const imageUrl = typeof firstImage === 'string' ? firstImage : firstImage.url || firstImage;
            
            if (data.media.length === 1) {
                mediaHtml = `
                    <div class="xhs-card-single">
                        <img src="${imageUrl}" alt="">
                    </div>
                `;
            } else {
                mediaHtml = `
                    <div class="xhs-card-slider">
                        <div class="xhs-card-slider-container">
                            ${data.media.map((img, idx) => {
                                const url = typeof img === 'string' ? img : img.url || img;
                                return `<div class="xhs-card-slide-item"><img src="${url}" alt=""></div>`;
                            }).join('')}
                        </div>
                        <div class="xhs-card-slider-indicator">
                            <div class="xhs-card-image-count"><i class="fas fa-images"></i> 1/${data.media.length}</div>
                            <div class="xhs-card-slider-dots">
                                ${data.media.map((_, idx) => `<div class="xhs-card-dot ${idx === 0 ? 'active' : ''}"></div>`).join('')}
                            </div>
                        </div>
                    </div>
                `;
            }
        }

        return `
            <div class="xhs-share-card">
                <div class="xhs-card-header">
                    <div class="xhs-card-avatar">
                        ${data.author.avatar 
                            ? `<img src="${data.author.avatar}" alt="">` 
                            : `<i class="fas fa-user"></i>`}
                    </div>
                    <div class="xhs-card-author-info">
                        <span class="xhs-card-author-name">${data.author.name}</span>
                        <span class="xhs-card-badge">小红书</span>
                    </div>
                </div>
                ${mediaHtml}
                <div class="xhs-card-title">${data.title}</div>
                ${data.desc ? `<div class="xhs-card-desc">${data.desc}</div>` : ''}
                <div class="xhs-card-stats">
                    <span class="xhs-card-stat-item"><i class="fas fa-heart"></i> ${formatNumber(data.likes)}</span>
                    <span class="xhs-card-stat-item"><i class="fas fa-comment"></i> ${formatNumber(data.comments)}</span>
                    <span class="xhs-card-stat-item"><i class="fas fa-star"></i> ${formatNumber(data.collects)}</span>
                </div>
                <div class="xhs-card-footer">
                    <span class="xhs-card-source">来自 小红书</span>
                </div>
            </div>
        `;
    }

    // 发送到聊天
    function sendToChat() {
        if (!currentXhsData) return;

        const cardHtml = buildXhsCardHtml(currentXhsData);

        // 调用添加消息函数
        if (typeof window.addMessage === 'function') {
            window.addMessage({
                id: Date.now(),
                sender: 'user',
                text: cardHtml,
                timestamp: new Date(),
                status: 'sent',
                type: 'normal',
                isHtml: true,
                xhsCard: true
            });
        } else if (typeof window._addMessage === 'function') {
            window._addMessage({
                id: Date.now(),
                sender: 'user',
                text: cardHtml,
                timestamp: new Date(),
                status: 'sent',
                type: 'normal',
                isHtml: true,
                xhsCard: true
            });
        } else {
            // 尝试直接添加到聊天容器
            const chatContainer = document.getElementById('chat-container');
            if (chatContainer) {
                const msgDiv = document.createElement('div');
                msgDiv.className = 'message-wrapper sent';
                msgDiv.innerHTML = `
                    <div class="message-content-wrapper">
                        <div class="message message-sent" style="background:transparent;padding:0;box-shadow:none;">
                            ${cardHtml}
                        </div>
                    </div>
                `;
                chatContainer.appendChild(msgDiv);
                chatContainer.scrollTop = chatContainer.scrollHeight;
            }
        }

        // 播放发送音效
        if (typeof window.playSound === 'function') {
            window.playSound('send');
        }

        // 关闭模态框
        close();

        // 显示通知
        if (typeof window.showNotification === 'function') {
            window.showNotification('已发送到聊天', 'success', 2000);
        }
    }

    // 打开模态框
    function open() {
        const modal = document.getElementById('xhs-parser-modal');
        const input = document.getElementById('xhs-link-input');
        const resultContainer = document.getElementById('xhs-result-container');
        const loading = document.getElementById('xhs-loading');
        
        // 重置状态
        currentXhsData = null;
        if (resultContainer) resultContainer.style.display = 'none';
        if (loading) loading.style.display = 'none';
        
        // 使用项目的 showModal 函数（如果存在）
        if (modal) {
            if (typeof window.showModal === 'function') {
                window.showModal(modal, input);
            } else {
                modal.classList.add('active');
                modal.style.display = 'flex';
            }
        }
        
        if (input) {
            input.value = '';
            setTimeout(() => input.focus(), 100);
        }
    }

    // 关闭模态框
    function close() {
        const modal = document.getElementById('xhs-parser-modal');
        if (modal) {
            if (typeof window.hideModal === 'function') {
                window.hideModal(modal);
            } else {
                modal.classList.remove('active');
                modal.style.display = 'none';
            }
        }
        currentXhsData = null;
    }

    // 执行解析
    async function doParse() {
        const input = document.getElementById('xhs-link-input');
        const loading = document.getElementById('xhs-loading');
        const resultContent = document.getElementById('xhs-result-content');
        const resultContainer = document.getElementById('xhs-result-container');

        const url = input?.value?.trim();

        if (!url) {
            if (typeof window.showNotification === 'function') {
                window.showNotification('请输入小红书分享链接', 'warning');
            }
            return;
        }

        // 验证链接格式
        if (!url.includes('xhslink.com') && !url.includes('xiaohongshu.com')) {
            if (typeof window.showNotification === 'function') {
                window.showNotification('请输入有效的小红书链接', 'warning');
            }
            return;
        }

        // 显示加载状态
        if (resultContainer) resultContainer.style.display = 'block';
        if (loading) loading.style.display = 'block';
        if (resultContent) resultContent.innerHTML = '';

        try {
            const data = await parseXhsLink(url);
            currentXhsData = data;
            
            if (loading) loading.style.display = 'none';
            renderXhsResult(data);
        } catch (error) {
            if (loading) loading.style.display = 'none';
            if (resultContent) {
                resultContent.innerHTML = `
                    <div style="text-align:center;padding:20px;color:var(--text-secondary);">
                        <i class="fas fa-exclamation-circle" style="font-size:32px;margin-bottom:10px;opacity:0.5;"></i>
                        <div>解析失败</div>
                        <div style="font-size:12px;margin-top:4px;">${error.message || '请检查链接是否正确'}</div>
                    </div>
                `;
            }
        }
    }

    // 初始化事件绑定
    function initEvents() {
        // 解析按钮
        const parseBtn = document.getElementById('xhs-parse-btn');
        if (parseBtn) {
            parseBtn.addEventListener('click', doParse);
        }

        // 取消按钮
        const cancelBtn = document.getElementById('xhs-cancel-btn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', close);
        }

        // 点击模态框外部关闭
        const modal = document.getElementById('xhs-parser-modal');
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    close();
                }
            });
        }

        // 输入框回车解析
        const input = document.getElementById('xhs-link-input');
        if (input) {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    doParse();
                }
            });
        }
    }

    // 页面加载完成后初始化
    function init() {
        injectStyles();
        initEvents();
    }

    // 等待DOM加载完成
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // 暴露到全局
    window.xhsParser = {
        open: open,
        close: close,
        parse: parseXhsLink,
        sendToChat: sendToChat
    };

})();
