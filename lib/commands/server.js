const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const logger = require('../utils/logger');

const DEFAULT_SERVER_DIR = path.resolve(__dirname, '../../termly-local-server');

function findServerDir() {
  // Check default location first
  if (fs.existsSync(path.join(DEFAULT_SERVER_DIR, 'server.js'))) {
    return DEFAULT_SERVER_DIR;
  }
  // Check relative to termly-cli
  const alt = path.resolve(__dirname, '../../../termly-local-server');
  if (fs.existsSync(path.join(alt, 'server.js'))) {
    return alt;
  }
  return null;
}

function getLanIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

async function serverCommand(action = 'start') {
  const serverDir = findServerDir();

  if (!serverDir) {
    console.error('termly-local-server not found.');
    console.error('Expected at: ' + DEFAULT_SERVER_DIR);
    console.error('Clone it: git clone https://github.com/termly-dev/termly-cli termly-local-server');
    process.exit(1);
  }

  const port = process.env.TERMLY_LOCAL_PORT || 3001;
  const lanIp = getLanIp();

  switch (action) {
    case 'start': {
      // Check if server is already running
      try {
        execSync(`lsof -i :${port} -t 2>/dev/null`, { stdio: 'pipe' });
        console.log(`Server already running on port ${port}`);
      } catch {
        // Port is free, start the server
        console.log(`Starting Termly local server on port ${port}...`);
        const serverProcess = spawn('node', ['server.js'], {
          cwd: serverDir,
          env: { ...process.env, TERMLY_LOCAL_PORT: String(port) },
          detached: true,
          stdio: 'ignore'
        });
        serverProcess.unref();

        // Wait for server to be ready
        let ready = false;
        for (let i = 0; i < 20; i++) {
          await new Promise(r => setTimeout(r, 250));
          try {
            execSync(`curl -s http://localhost:${port}/api/health > /dev/null 2>&1`, { stdio: 'pipe' });
            ready = true;
            break;
          } catch {
            // not ready yet
          }
        }

        if (!ready) {
          console.error('Server failed to start within 5 seconds.');
          process.exit(1);
        }
      }

      process.env.TERMLY_ENV = 'local';
      console.log('');
      console.log('========================================');
      console.log('  Termly Local Server running!');
      console.log('========================================');
      console.log('');
      console.log(`  Local:   http://localhost:${port}`);
      console.log(`  Network: http://${lanIp}:${port}`);
      console.log('  Run: termly start');
      console.log('========================================');
      console.log('');
      break;
    }

    case 'stop': {
      try {
        const pids = execSync(`lsof -i :${port} -t 2>/dev/null`, { encoding: 'utf8' }).trim();
        if (pids) {
          pids.split('\n').forEach(pid => {
            try { process.kill(parseInt(pid)); } catch {}
          });
          console.log(`Stopped server on port ${port}`);
        } else {
          console.log(`No server running on port ${port}`);
        }
      } catch {
        console.log(`No server running on port ${port}`);
      }
      break;
    }

    case 'status': {
      try {
        execSync(`lsof -i :${port} -t 2>/dev/null`, { stdio: 'pipe' });
        console.log(`Server running on port ${port}`);
        console.log(`  Local:   http://localhost:${port}`);
        console.log(`  Network: http://${lanIp}:${port}`);
      } catch {
        console.log(`Server not running on port ${port}`);
        console.log(`Start it: termly-server start`);
      }
      break;
    }

    case 'launch': {
      // Start server + termly start in one command
      try {
        execSync(`lsof -i :${port} -t 2>/dev/null`, { stdio: 'pipe' });
        console.log(`Server already running on port ${port}`);
      } catch {
        console.log(`Starting Termly local server on port ${port}...`);
        const serverProcess = spawn('node', ['server.js'], {
          cwd: serverDir,
          env: { ...process.env, TERMLY_LOCAL_PORT: String(port) },
          detached: true,
          stdio: 'ignore'
        });
        serverProcess.unref();

        let ready = false;
        for (let i = 0; i < 20; i++) {
          await new Promise(r => setTimeout(r, 250));
          try {
            execSync(`curl -s http://localhost:${port}/api/health > /dev/null 2>&1`, { stdio: 'pipe' });
            ready = true;
            break;
          } catch {}
        }
        if (!ready) {
          console.error('Server failed to start.');
          process.exit(1);
        }
        console.log('Server ready!');
      }

      console.log('');
      console.log('========================================');
      console.log('  Termly Local Server running!');
      console.log('========================================');
      console.log('');
      console.log(`  Local:   http://localhost:${port}`);
      console.log(`  Network: http://${lanIp}:${port}`);
      console.log('========================================');
      console.log('');
      console.log('Starting Termly CLI in local mode...');
      console.log('');

      // Launch termly start with TERMLY_ENV=local
      process.env.TERMLY_ENV = 'local';
      const termlyStart = require('./start');
      await termlyStart(process.cwd(), {});
      break;
    }

    default:
      console.error(`Unknown action: ${action}`);
      console.error('Usage: termly server [start|stop|status|launch]');
      process.exit(1);
  }
}

module.exports = serverCommand;
