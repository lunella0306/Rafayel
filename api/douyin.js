/**
 * 抖音视频解析 API
 * 支持解析分享链接
 * 返回：作者头像、作者名字、视频标题、视频封面、视频链接
 */

const fetch = require('node-fetch');

module.exports = async (req, res) => {
  // 处理 CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { url } = req.query;

    if (!url) {
      return res.status(400).json({ 
        success: false, 
        error: '请提供抖音链接' 
      });
    }

    // 检查是否是抖音链接
    if (!url.includes('douyin.com') && !url.includes('v.douyin.com')) {
      return res.status(400).json({ 
        success: false, 
        error: '请提供正确的抖音链接' 
      });
    }

    console.log('正在解析抖音:', url);

    // 解析短链接
    let finalUrl = url;
    if (url.includes('v.douyin.com')) {
      finalUrl = await resolveShortUrl(url);
      console.log('短链接解析结果:', finalUrl);
    }

    // 获取视频数据
    const videoData = await fetchVideoData(finalUrl);

    res.json({
      success: true,
      data: videoData
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
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15'
      }
    });
    return response.url || shortUrl;
  } catch (error) {
    return shortUrl;
  }
}

/**
 * 获取视频数据
 */
async function fetchVideoData(videoUrl) {
  // 提取视频 ID
  const videoIdMatch = videoUrl.match(/\/video\/(\d+)/);
  const videoId = videoIdMatch ? videoIdMatch[1] : null;

  if (!videoId) {
    throw new Error('无法从链接中提取视频ID');
  }

  // 尝试获取页面数据
  const response = await fetch(`https://www.douyin.com/video/${videoId}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
      'Accept': 'text/html,application/xhtml+xml'
    }
  });

  const html = await response.text();

  // 尝试从页面提取数据
  const titleMatch = html.match(/<title>([^<]+)<\/title>/);
  const descMatch = html.match(/<meta\s+name="description"\s+content="([^"]+)"/);

  return {
    videoId: videoId,
    author: {
      name: '请手动查看',
      avatar: ''
    },
    title: titleMatch ? titleMatch[1].replace(' - 抖音', '') : '',
    description: descMatch ? descMatch[1] : '',
    cover: '',
    videoUrl: videoUrl,
    note: '抖音解析需要更复杂的实现，目前仅返回基础信息'
  };
}
