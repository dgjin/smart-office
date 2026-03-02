// 密码诊断脚本
// 运行: node scripts/check_password.cjs

const crypto = require('crypto');

// 常见加密方式测试
function testEncrypt(password) {
  console.log('====================================');
  console.log(`测试密码: "${password}"`);
  console.log('====================================\n');
  
  // 1. MD5
  const md5 = crypto.createHash('md5').update(password).digest('hex');
  console.log('MD5:', md5);
  
  // 2. SHA-1
  const sha1 = crypto.createHash('sha1').update(password).digest('hex');
  console.log('SHA-1:', sha1);
  
  // 3. SHA-256
  const sha256 = crypto.createHash('sha256').update(password).digest('hex');
  console.log('SHA-256:', sha256);
  
  // 4. SHA-512
  const sha512 = crypto.createHash('sha512').update(password).digest('hex');
  console.log('SHA-512:', sha512);
  
  // 5. Base64
  const base64 = Buffer.from(password).toString('base64');
  console.log('Base64:', base64);
  
  // 6. MD5 + 盐 (salt=smartoffice)
  const md5Salt = crypto.createHash('md5').update(password + 'smartoffice').digest('hex');
  console.log('MD5+salt(smartoffice):', md5Salt);
  
  // 7. SHA-256 + 盐 (salt=smartoffice)
  const sha256Salt = crypto.createHash('sha256').update(password + 'smartoffice').digest('hex');
  console.log('SHA-256+salt(smartoffice):', sha256Salt);
  
  // 8. bcrypt 格式 (通常以 $2a$, $2b$, $2y$ 开头)
  console.log('\nbcrypt 格式示例:');
  console.log('$2a$10$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
  
  console.log('\n====================================');
  console.log('请对比数据库中的密码值，看匹配哪种格式');
  console.log('====================================');
}

// 如果有数据库中的密码值，可以传进来对比
function compareWithDB(dbPassword) {
  if (!dbPassword) return;
  
  console.log('\n\n====================================');
  console.log(`数据库密码: "${dbPassword}"`);
  console.log('====================================\n');
  
  // 检查格式
  if (dbPassword.length === 32) {
    console.log('可能是 MD5');
  } else if (dbPassword.length === 40) {
    console.log('可能是 SHA-1');
  } else if (dbPassword.length === 64) {
    console.log('可能是 SHA-256');
  } else if (dbPassword.length === 128) {
    console.log('可能是 SHA-512');
  } else if (dbPassword.startsWith('$2a$') || dbPassword.startsWith('$2b$') || dbPassword.startsWith('$2y$')) {
    console.log('是 bcrypt 格式');
  } else if (/^[A-Za-z0-9+/=]+$/.test(dbPassword)) {
    console.log('可能是 Base64');
  }
}

// 主函数
const password = process.argv[2] || '123456';
const dbPassword = process.argv[3];

testEncrypt(password);
compareWithDB(dbPassword);

console.log('\n\n使用方法:');
console.log('node scripts/check_password.cjs "你的密码" "数据库中的密码(可选)"');
