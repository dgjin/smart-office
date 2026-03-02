// 密码哈希生成脚本
// 使用方法: node scripts/hash-password.js 123456

async function hashPassword(password) {
  // 方法1: 使用 SHA-256 (简单，但不适合生产环境)
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

// 方法2: 简单的 Base64 (如果后端使用 Base64 编码)
function base64Encode(password) {
  return Buffer.from(password).toString('base64');
}

// 方法3: 带盐的简单哈希 (如果后端使用)
async function hashWithSalt(password, salt = 'smartoffice') {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + salt);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// 主函数
async function main() {
  const password = process.argv[2] || '123456';
  
  console.log('====================================');
  console.log(`原密码: ${password}`);
  console.log('====================================\n');
  
  // SHA-256
  const sha256 = await hashPassword(password);
  console.log('SHA-256 哈希:');
  console.log(sha256);
  console.log(`SQL: UPDATE smartoffice_users SET password = '${sha256}' WHERE email = 'xxx';\n`);
  
  // Base64
  const base64 = base64Encode(password);
  console.log('Base64 编码:');
  console.log(base64);
  console.log(`SQL: UPDATE smartoffice_users SET password = '${base64}' WHERE email = 'xxx';\n`);
  
  // 带盐的 SHA-256
  const withSalt = await hashWithSalt(password);
  console.log('带盐 SHA-256 (salt=smartoffice):');
  console.log(withSalt);
  console.log(`SQL: UPDATE smartoffice_users SET password = '${withSalt}' WHERE email = 'xxx';\n`);
  
  console.log('====================================');
  console.log('请根据你的后端加密方式选择对应的密码');
  console.log('====================================');
}

main();
