const path = require('path');
const chalk = require('chalk');
const axios = require('axios').default || require('axios');
const crypto = require('crypto');
const { validateDirectory } = require('../utils/validation');
const { displayPairingUI } = require('../utils/qr');
const logger = require('../utils/logger');
const { getToolByKey } = require('../ai-tools/registry');
const { getServerUrl, getApiUrl, getEnvironmentName } = require('../config/environment');
const { addSession, updateSession } = require('../session/registry');
const { createSession, SessionState } = require('../session/state');
const PTYManager = require('../session/pty-manager');
const CircularBuffer = require('../session/buffer');
const WebSocketManager = require('../network/websocket');
const { generateDHKeyPair, computeSharedSecret, deriveAESKey, generateFingerprint } = require('../crypto/dh');
const { checkVersion } = require('../utils/version-checker');

// Generate pairing code
function generatePairingCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    const randomIndex = crypto.randomInt(0, chars.length);
    code += chars[randomIndex];
  }
  return code;
}

// Register multiple tools for a single pairing code
async function registerBatchPairing(apiUrl, pairingCode, publicKey, projectName, workingDir, computerName, toolConfigs) {
  const url = apiUrl + '/api/pairing/batch';
  
  const data = {
    code: pairingCode,
    publicKey,
    projectName,
    workingDir,
    computerName,
    tools: toolConfigs.map(t => ({
      aiTool: t.tool.key,
      aiToolVersion: t.tool.version || 'unknown',
      label: t.label
    }))
  };

  logger.debug(`Registering batch pairing code: ${pairingCode} with ${toolConfigs.length} tools`);

  try {
    const response = await axios.post(url, data, {
      headers: {
        'Content-Type': 'application/json',
        'X-API-Type': 'cli'
      }
    });
    return response.data;
  } catch (err) {
    // If batch endpoint doesn't exist, fallback to sequential registration
    if (err.response?.status === 404) {
      logger.warn('Batch registration endpoint not found, falling back to sequential registration');
      for (const t of toolConfigs) {
        await axios.post(apiUrl + '/api/pairing', {
          code: pairingCode,
          publicKey,
          projectName,
          workingDir,
          computerName,
          aiTool: t.tool.key,
          aiToolVersion: t.tool.version || 'unknown',
          label: t.label
        }, {
          headers: { 'Content-Type': 'application/json', 'X-API-Type': 'cli' }
        });
      }
      return { success: true };
    }
    throw err;
  }
}

async function batchCommand(toolSpecs, options) {
  try {
    await checkVersion();

    const workingDir = path.resolve(process.cwd());
    const validation = validateDirectory(workingDir);
    if (!validation.valid) {
      logger.error(validation.error);
      process.exit(1);
    }

    const projectName = path.basename(workingDir);
    
    // Parse tool specs: "tool:label" or just "tool"
    const toolConfigs = toolSpecs.map(spec => {
      const [toolKey, label] = spec.split(':');
      const tool = getToolByKey(toolKey);
      if (!tool) {
        logger.error(`Unknown AI tool: ${toolKey}`);
        process.exit(1);
      }
      return { tool, label: label || toolKey };
    });

    if (toolConfigs.length === 0) {
      logger.error('No tools specified for batch');
      process.exit(1);
    }

    const pairingCode = generatePairingCode();
    const { dh, publicKey } = generateDHKeyPair();
    const serverUrl = getServerUrl();
    const apiUrl = getApiUrl();

    logger.info(`Starting batch session with ${toolConfigs.length} agents...`);

    // Register batch
    await registerBatchPairing(
      apiUrl,
      pairingCode,
      publicKey,
      projectName,
      workingDir,
      require('os').hostname(),
      toolConfigs
    );

    displayPairingUI(
      pairingCode,
      serverUrl,
      `Batch (${toolConfigs.length} agents)`,
      'v1.0',
      projectName,
      require('os').hostname()
    );

    const sessions = [];
    const ptyManagers = new Map();
    const wsManagers = new Map();

    // Setup each session
    for (const config of toolConfigs) {
      const session = createSession(
        projectName,
        workingDir,
        config.tool.key,
        config.tool.displayName,
        config.tool.version,
        serverUrl,
        config.label
      );
      
      const buffer = new CircularBuffer(1000000);
      const wsManager = new WebSocketManager(serverUrl, session.sessionId, buffer);
      const ptyManager = new PTYManager(config.tool, workingDir, buffer);
      
      wsManager.setPTYManager(ptyManager);
      sessions.push({ session, wsManager, ptyManager, config, dh, publicKey });
      
      ptyManagers.set(session.sessionId, ptyManager);
      wsManagers.set(session.sessionId, wsManager);
      
      addSession(session);
    }

    const cleanup = () => {
      logger.info('Shutting down batch sessions...');
      for (const { session, ptyManager, wsManager } of sessions) {
        updateSession(session.sessionId, { status: 'stopped' });
        if (ptyManager) ptyManager.kill();
        if (wsManager) wsManager.close();
      }
      process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    // Start all WebSocket connections (they all use the same pairing code)
    for (const { wsManager, session, dh, publicKey, ptyManager, config } of sessions) {
      wsManager.onPaired((theirPublicKey, backendSessionId) => {
        // Update session ID if backend assigned a new one
        if (backendSessionId && backendSessionId !== session.sessionId) {
          const oldId = session.sessionId;
          session.sessionId = backendSessionId;
          updateSession(oldId, { sessionId: backendSessionId });
          
          // Update maps
          ptyManagers.delete(oldId);
          ptyManagers.set(backendSessionId, ptyManager);
          wsManagers.delete(oldId);
          wsManagers.set(backendSessionId, wsManager);
        }

        const sharedSecret = computeSharedSecret(dh, theirPublicKey);
        const aesKey = deriveAESKey(sharedSecret);
        wsManager.setEncryptionKey(aesKey);
        
        const fingerprint = generateFingerprint(publicKey);
        updateSession(session.sessionId, { fingerprint });

        logger.success(`Agent [${config.label}] connected!`);
        ptyManager.start(options.aiArgs ? options.aiArgs.split(' ') : []);
      });

      ptyManager.onData((data) => wsManager.sendOutput(data));
      wsManager.onInput((data) => ptyManager.write(data));
      wsManager.onResize((cols, rows) => ptyManager.resize(cols, rows));
      
      await wsManager.connect(pairingCode);
    }

  } catch (err) {
    logger.error(`Batch error: ${err.message}`);
    process.exit(1);
  }
}

module.exports = batchCommand;
