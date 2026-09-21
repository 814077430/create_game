const https = require('https');
const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

// Check if npm exists
try {
  execSync('which npm', { stdio: 'pipe' });
  console.log('npm already installed');
  process.exit(0);
} catch(e) {}

// Download npm tarball
console.log('Downloading npm...');
const url = 'https://registry.npmjs.org/npm/-/npm-10.8.1.tgz';

https.get(url, (res) => {
  if (res.statusCode === 302 || res.statusCode === 301) {
    https.get(res.headers.location, handleResponse).on('error', handleError);
  } else {
    handleResponse(res);
  }
}).on('error', handleError);

function handleError(e) {
  console.error('Download failed:', e.message);
  process.exit(1);
}

function handleResponse(res) {
  const chunks = [];
  res.on('data', c => chunks.push(c));
  res.on('end', () => {
    const tgzPath = '/tmp/npm.tgz';
    fs.writeFileSync(tgzPath, Buffer.concat(chunks));
    console.log('Downloaded, extracting...');
    
    const npmDir = '/home/create_game/node_modules/.npm-global';
    fs.mkdirSync(npmDir, { recursive: true });
    execSync(`tar -xzf ${tgzPath} -C ${npmDir}`, { stdio: 'inherit' });
    
    // Use the extracted npm cli
    const npmCli = path.join(npmDir, 'package/bin/npm-cli.js');
    if (fs.existsSync(npmCli)) {
      console.log('npm extracted at:', npmCli);
      // Install deps using node + npm-cli.js
      console.log('Installing dependencies...');
      execSync(`node ${npmCli} install`, { 
        cwd: '/home/create_game',
        stdio: 'inherit',
        env: { ...process.env, HOME: '/home/create_game' }
      });
      console.log('Done!');
    } else {
      console.error('npm-cli.js not found after extraction');
      process.exit(1);
    }
  });
}
