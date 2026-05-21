/**
 * 小红书笔记解析 API
 * 支持解析短链接和标准链接
 * 返回：作者头像、作者名字、笔记文案、笔记图片
 */

const fetch = require('node-fetch');

// 允许的域名
const ALLOWED_ORIGINS = [
  'https://celadon-truffle-a73683.netlify.app',
  'http://localhost:3000',
  'http://127.0.0.1:5500'
];

module.exports = async (req, res) => {
  // 处理 CORS
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // 处理预检请求
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { url } = req.query;

    if (!url) {
      return res.status(400).json({ 
        success: false, 
        error: '请提供小红书链接' 
      });
    }

    // 检查是否是小红书链接
    if (!url.includes('xiaohongshu.com') && !url.includes('xhslink.com')) {
      return res.status(400).json({ 
        success: false, 
        error: '请提供正确的小红书链接' 
      });
    }

    console.log('正在解析:', url);

    // 第一步：解析短链接
    let finalUrl = url;
    if (url.includes('xhslink.com')) {
      finalUrl = await resolveShortUrl(url);
      console.log('短链接解析结果:', finalUrl);
    }

    // 第二步：获取笔记内容
    const noteData = await fetchNoteData(finalUrl);

    // 第三步：返回结果
    res.json({
      success: true,
      data: noteData
    });

  } catch (error) {
    console.error('解析错误:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || '解析失败，请稍后重试' 
    });
  }
};

/**
 * 解析短链接
 */
async function resolveShortUrl(shortUrl) {
  try {
    const response = await fetch(shortUrl, {
      method: 'HEAD',
      redirect: 'follow',
      follow: 10,
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'
      }
    });

    return response.url || shortUrl;
  } catch (error) {
    console.log('短链接解析失败，使用原始链接');
    return shortUrl;
  }
}

/**
 * 获取笔记数据
 */
async function fetchNoteData(noteUrl) {
  // 提取笔记 ID
  const noteIdMatch = noteUrl.match(/\/explore\/([a-zA-Z0-9]+)/);
  const noteId = noteIdMatch ? noteIdMatch[1] : null;

  if (!noteId) {
    throw new Error('无法从链接中提取笔记ID');
  }

  console.log('笔记ID:', noteId);

  // 使用移动端页面获取数据
  const mobileUrl = `https://www.xiaohongshu.com/explore/${noteId}?xsec_token=ABCD&xsec_source=pc_search`;

  const response = await fetch(mobileUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'Cache-Control': 'no-cache'
    }
  });

  const html = await response.text();

  // 从页面中提取 __INITIAL_STATE__ 数据
  const stateMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*({.+?})\s*<\/script>/);
  
  if (stateMatch) {
    try {
      const stateData = JSON.parse(stateMatch[1]);
      const noteDetail = stateData?.note?.noteDetailMap?.[noteId]?.note;
      
      if (noteDetail) {
        return {
          noteId: noteId,
          author: {
            name: noteDetail.user?.nickname || '未知作者',
            avatar: noteDetail.user?.image || '',
            userId: noteDetail.user?.userId || ''
          },
          title: noteDetail.title || '',
          description: noteDetail.desc || '',
          images: (noteDetail.imageList || []).map(img => ({
            url: img.urlDefault || img.url,
            width: img.width,
            height: img.height
          })),
          likes: noteDetail.interactInfo?.likedCount || 0,
          collects: noteDetail.interactInfo?.collectedCount || 0,
          comments: noteDetail.interactInfo?.commentCount || 0
        };
      }
    } catch (e) {
      console.log('JSON解析失败，尝试其他方式');
    }
  }

  // 备用方案：使用正则提取基础信息
  const titleMatch = html.match(/<title>([^<]+)<\/title>/);
  const descMatch = html.match(/<meta\s+name="description"\s+content="([^"]+)"/);
  const imageMatches = html.match(/https?:\/\/sns-webpic-qc\.xhscdn\.com\/[^\s"]+/g);

  return {
    noteId: noteId,
    author: {
      name: '请手动查看',
      avatar: ''
    },
    title: titleMatch ? titleMatch[1].replace(' - 小红书', '') : '',
    description: descMatch ? descMatch[1] : '',
    images: imageMatches ? imageMatches.slice(0, 9).map(url => ({ url })) : [],
    rawHtml: html.substring(0, 2000) // 返回部分 HTML 用于调试
  };
}
