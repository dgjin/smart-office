import puppeteer from 'puppeteer';

async function testMonitorPage() {
  console.log('开始测试监控页面...');
  
  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
    // 启用控制台日志
    page.on('console', msg => {
      console.log('浏览器控制台:', msg.text());
    });
    
    // 导航到监控页面
    await page.goto('http://localhost:3002/monitor.html', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    
    // 等待一段时间，让页面完全加载
    await page.waitForTimeout(10000);
    
    // 获取页面标题
    const title = await page.title();
    console.log('页面标题:', title);
    
    // 获取页面内容
    const content = await page.content();
    console.log('页面内容长度:', content.length);
    
    // 截取页面截图
    await page.screenshot({ path: 'monitor-screenshot.png' });
    console.log('页面截图已保存为 monitor-screenshot.png');
    
    // 关闭浏览器
    await browser.close();
    
    console.log('测试完成');
  } catch (error) {
    console.error('测试失败:', error);
  }
}

testMonitorPage();
