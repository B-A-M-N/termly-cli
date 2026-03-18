const path = require('path');
const chalk = require('chalk');
const axios = require('axios').default || require('axios');
const crypto = require('crypto');
const { validateDirectory } = require('../utils/validation');
const { displayPairingUI } = require('../utils/qr');
const logger = require('../utils/logger');
const { selectAITool } = require('../ai-tools/selector');
const { getServerUrl, getApiUrl, getEnvironmentName } = require('../config/environment');
const { getSessionByDirectory, addSession, updateSession } = require('../session/registry');
const { createSession, SessionState } = require('../session/state');
const PTYManager = require('../session/pty-manager');
const CircularBuffer = require('../session/buffer');
const WebSocketManager = require('../network/websocket');
const { generateDHKeyPair, computeSharedSecret, deriveAESKey, generateFingerprint } = require('../crypto/dh');
const { checkVersion } = require('../utils/version-checker');

// Generate pairing code (6 characters, uppercase alphanumeric, no dashes)
function generatePairingCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';

  for (let i = 0; i < 6; i++) {
    const randomIndex = crypto.randomInt(0, chars.length);
    code += chars[randomIndex];
  }

  return code;
}

// Register pairing code with server
async function registerPairingCode(apiUrl, pairingCode, publicKey, projectName, workingDir, computerName, aiTool, aiToolVersion, label = null) {
  const url = apiUrl + '/api/pairing';

  const data = {
    code: pairingCode,
    publicKey,
    projectName,
    workingDir,
    computerName,
    aiTool,
    aiToolVersion
  };

  // Only include label if it exists to prevent potential issues with older backends
  if (label) {
    data.label = label;
  }

  logger.debug(`Registering pairing code: ${pairingCode} (label: ${label || 'none'})`);

  try {
    const response = await axios.post(url, data, {
      headers: {
        'Content-Type': 'application/json',
        'X-API-Type': 'cli'
      }
    });

    logger.debug(`Pairing code registered successfully`);
    return response.data;
  } catch (err) {
    logger.error(`Failed to register pairing code: ${err.message}`);

    // Log validation details if available
    if (err.response?.data?.details) {
      logger.error('Validation errors:');
      err.response.data.details.forEach(detail => {
        logger.error(`  - ${detail.field}: ${detail.message}`);
      });
    }

    throw err;
  }
}

async function startCommand(directory, options) {
  try {
    // Step 1: Check CLI version
    await checkVersion();

    // Step 2: Determine working directory
    const workingDir = path.resolve(directory || process.cwd());
    const validation = validateDirectory(workingDir);

    if (!validation.valid) {
      logger.error(validation.error);
      process.exit(1);
    }

    const projectName = path.basename(workingDir);
    logger.debug(`Working directory: ${workingDir}`);
    logger.debug(`Project name: ${projectName}`);

    // Step 4: Select AI tool
    const selectedTool = await selectAITool(options);

    if (!selectedTool) {
      logger.error('No AI tool selected');
      process.exit(1);
    }

    // Step 3: Check for existing session in directory
    // If --label is provided, only check for session with same label
    // Otherwise check for session with same tool
    const sessionCheckOptions = { 
      label: options.label || null,
      toolKey: options.label ? null : selectedTool.key
    };
    const existingSession = getSessionByDirectory(workingDir, sessionCheckOptions);

    if (existingSession && !options.multi) {
      console.error(chalk.red('❌ Session already running in this directory with same identifier!'));
      console.error(chalk.gray(`   Session ID: ${existingSession.sessionId}`));
      if (existingSession.label) {
        console.error(chalk.gray(`   Label: ${existingSession.label}`));
      }
      console.error(chalk.gray(`   AI Tool: ${existingSession.aiToolDisplayName}`));
      console.error('');
      console.log(chalk.yellow('Tip: Use unique labels to run multiple agents in the same directory:'));
      console.log(chalk.cyan(`     termly start --label agent-1`));
      console.log(chalk.cyan(`     termly start --label agent-2`));
      console.log('');
      process.exit(1);
    }

    // Step 5: Generate pairing code and DH keypair
    const pairingCode = generatePairingCode();
    const { dh, publicKey, privateKey } = generateDHKeyPair();

    logger.debug(`Pairing code generated: ${pairingCode}`);
    logger.debug(`Public key generated: ${publicKey.substring(0, 20)}...`);

    // Step 6: Get server URL from environment
    const serverUrl = getServerUrl();
    const apiUrl = getApiUrl();
    const envName = getEnvironmentName();

    logger.info(`Environment: ${envName}`);
    logger.debug(`Server URL: ${serverUrl}`);
    logger.debug(`API URL: ${apiUrl}`);

    // Step 7: Register pairing code (simulated for now)
    await registerPairingCode(
      apiUrl,
      pairingCode,
      publicKey,
      projectName,
      workingDir,
      require('os').hostname(),
      selectedTool.key,
      selectedTool.version,
      options.label
    );

    // Step 8: Display QR code and pairing info
    displayPairingUI(
      pairingCode,
      serverUrl,
      selectedTool.key, // QR code tool identifier
      selectedTool.displayName, // UI display name
      selectedTool.version,
      projectName,
      require('os').hostname(),
      options.label
    );

    // Step 9: Create session
    const session = createSession(
      projectName,
      workingDir,
      selectedTool.key,
      selectedTool.displayName,
      selectedTool.version,
      serverUrl,
      options.label
    );

    const sessionState = new SessionState(session);
    sessionState.setPairingCode(pairingCode);
    sessionState.setDH(dh);

    // Register session
    addSession(session);

    // Cleanup on exit
    const cleanup = () => {
      logger.info('Shutting down...');
      updateSession(session.sessionId, { status: 'stopped' });

      if (ptyManager) {
        logger.success('Closing PTY');
        ptyManager.kill();
      }

      if (wsManager) {
        logger.success('Closing WebSocket');
        wsManager.close();
      }

      logger.success('Cleaning up');
      logger.log('');
      logger.log('Goodbye!');

      process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    // Step 10: Create circular buffer (1MB size for richer history on mobile)
    const buffer = new CircularBuffer(1000000);

    // Step 11: Create WebSocket manager
    const wsManager = new WebSocketManager(serverUrl, session.sessionId, buffer);

    // Step 12: Create PTY manager
    const ptyManager = new PTYManager(selectedTool, workingDir, buffer);

    // Step 13: Connect PTY manager to WebSocket manager (for pausing output during reconnection)
    wsManager.setPTYManager(ptyManager);

    // Handle pairing complete
    wsManager.onPaired((theirPublicKey, backendSessionId) => {
      logger.debug('Pairing complete, computing shared secret');

      // Update session ID from backend
      if (backendSessionId && backendSessionId !== session.sessionId) {
        logger.debug(`Updating session ID: ${session.sessionId} -> ${backendSessionId}`);
        const oldSessionId = session.sessionId;
        session.sessionId = backendSessionId;

        // Update in registry
        updateSession(oldSessionId, { sessionId: backendSessionId });
      }

      // Compute shared secret and derive AES key
      const sharedSecret = computeSharedSecret(dh, theirPublicKey);
      const aesKey = deriveAESKey(sharedSecret);

      wsManager.setEncryptionKey(aesKey);
      sessionState.setEncryptionKey(aesKey);

      // Display encryption info
      const fingerprint = generateFingerprint(publicKey);

      // Save fingerprint to session
      updateSession(session.sessionId, { fingerprint });

      console.log('');
      logger.success('Connected!');
      console.log(chalk.green('🔒 End-to-End Encryption: ENABLED'));
      console.log(chalk.gray(`   Algorithm: AES-256-GCM + DH-2048`));
      console.log(chalk.gray(`   Fingerprint: ${fingerprint}`));
      console.log('');
      console.log(chalk.cyan(`Session ID: ${session.sessionId}`));
      console.log(chalk.cyan(`Computer: ${session.computerName}`));
      console.log(chalk.cyan(`Project: ${projectName}`));
      console.log(chalk.cyan(`AI Tool: ${selectedTool.displayName} v${selectedTool.version}`));
      console.log(chalk.cyan(`Directory: ${workingDir}`));
      console.log('');
      console.log(chalk.bold(`Starting ${selectedTool.displayName}...`));
      console.log('');

      // Start PTY session
      const aiArgs = options.aiArgs ? options.aiArgs.split(' ') : [];

      // Handle session continuation (Issue #12)
      if (options.continue) {
        if (selectedTool.key === 'claude-code') {
          if (!aiArgs.includes('--continue')) {
            aiArgs.push('--continue');
            logger.info('Enabling session continuation (--continue)');
          }
        } else {
          logger.warn(`Session continuation (--continue) is not explicitly supported for ${selectedTool.displayName}, but will be passed as an argument.`);
          if (!aiArgs.includes('--continue')) {
            aiArgs.push('--continue');
          }
        }
      }

      ptyManager.start(aiArgs);
    });

    // Handle PTY output
    ptyManager.onData((data) => {
      wsManager.sendOutput(data);
    });

    // Handle PTY exit
    ptyManager.onExit((exitCode) => {
      console.log('');
      console.log(chalk.yellow(`${selectedTool.displayName} exited with code ${exitCode.exitCode}`));
      logger.success('Session ended');
      console.log('');
      console.log(`Run ${chalk.cyan('termly start')} to create a new session.`);

      updateSession(session.sessionId, { status: 'stopped' });

      process.exit(exitCode.exitCode || 0);
    });

    // Handle mobile input
    wsManager.onInput((data) => {
      ptyManager.write(data);
    });

    // Handle resize
    wsManager.onResize((cols, rows) => {
      ptyManager.resize(cols, rows);
    });

    // Handle restore resize (after mobile disconnect)
    wsManager.onRestoreResize(() => {
      ptyManager.restoreLocalSize();
    });

    // Handle mobile connected
    wsManager.onMobileConnected(() => {
      updateSession(session.sessionId, { mobileConnected: true });

      // Update PTY manager state
      ptyManager.setMobileConnected(true);

      // If demo mode, send special command to trigger screen redraw
      if (selectedTool.key === 'demo') {
        ptyManager.write('__MOBILE_CONNECTED__\n');
      }
    });

    // Handle mobile disconnected
    wsManager.onMobileDisconnected(() => {
      updateSession(session.sessionId, { mobileConnected: false });

      // Update PTY manager state
      ptyManager.setMobileConnected(false);
    });

    // Connect to WebSocket
    try {
      logger.info('Connecting to server...');
      await wsManager.connect(pairingCode);
    } catch (err) {
      logger.error(`Failed to connect to server: ${err.message}`);
      updateSession(session.sessionId, { status: 'failed' });
      process.exit(1);
    }

  } catch (err) {
    logger.error(`Unexpected error: ${err.message}`);
    if (options.debug) {
      console.error(err);
    }
    process.exit(1);
  }
}

module.exports = startCommand;
