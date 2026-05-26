#!/usr/bin/env node

const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const http = require('http');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.TERMLY_LOCAL_PORT || 3001;
const HEARTBEAT_INTERVAL = 30000;

const app = express();
app.use(express.json({ limit: '1mb' }));

// --- Session registry ---
// Map<sessionCode, Session>
// Map<sessionId, Session>
const sessionsByCode = new Map();
const sessionsById = new Map();

class Session {
  constructor({ code, apiKey, projectName, workingDir, computerName, aiTool, aiToolVersion, label }) {
    this.sessionId = uuidv4();
    this.code = code;
    this.apiKey = apiKey;
    this.projectName = projectName;
    this.workingDir = workingDir;
    this.computerName = computerName;
    this.aiTool = aiTool;
    this.aiToolVersion = aiToolVersion;
    this.label = label || null;
    this.cliPublicKey = null;
    this.mobilePublicKey = null;
    this.cliWs = null;
    this.mobileWs = null;
    this.paired = false;
    this.lastMobileSeq = 0;
    this.createdAt = new Date().toISOString();
    this.tools = []; // for batch mode
  }
}

// --- REST API ---

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', termlyLocal: true, sessions: sessionsByCode.size });
});

// Version check — always return success for local
app.get('/api/cli/version', (req, res) => {
  const { currentVersion } = req.query;
  res.json({
    currentVersion: currentVersion || '0.0.0',
    minVersion: '0.0.0',
    updateCommand: '',
    isLatest: true,
    local: true
  });
});

// Register pairing code (CLI → server)
app.post('/api/pairing', (req, res) => {
  const { code, publicKey, projectName, workingDir, computerName, aiTool, aiToolVersion, label } = req.body;

  if (!code || !publicKey) {
    return res.status(400).json({ error: 'Missing required fields', details: [{ field: !code ? 'code' : 'publicKey', message: 'Required' }] });
  }

  if (sessionsByCode.has(code)) {
    return res.status(409).json({ error: 'Pairing code already registered' });
  }

  const session = new Session({
    code, apiKey: publicKey, projectName, workingDir, computerName, aiTool, aiToolVersion, label
  });
  session.cliPublicKey = publicKey;

  sessionsByCode.set(code, session);
  sessionsById.set(session.sessionId, session);

  console.log(`[pairing] Registered code=${code} sessionId=${session.sessionId} aiTool=${aiTool || 'unknown'} project=${projectName || '.'}`);

  res.json({
    success: true,
    sessionId: session.sessionId,
    message: 'Pairing code registered. Waiting for mobile connection.'
  });
});

// Batch pairing (fork feature)
app.post('/api/pairing/batch', (req, res) => {
  const { code, publicKey, projectName, workingDir, computerName, tools } = req.body;

  if (!code || !publicKey) {
    return res.status(400).json({ error: 'Missing required fields', details: [{ field: !code ? 'code' : 'publicKey', message: 'Required' }] });
  }

  if (sessionsByCode.has(code)) {
    return res.status(409).json({ error: 'Pairing code already registered' });
  }

  const primaryTool = tools && tools.length > 0 ? tools[0] : {};
  const session = new Session({
    code, apiKey: publicKey, projectName, workingDir, computerName,
    aiTool: primaryTool.aiTool || 'unknown',
    aiToolVersion: primaryTool.aiToolVersion || '0.0.0'
  });
  session.cliPublicKey = publicKey;
  session.tools = tools || [];

  sessionsByCode.set(code, session);
  sessionsById.set(session.sessionId, session);

  console.log(`[pairing] Batch registered code=${code} sessionId=${session.sessionId} tools=${session.tools.length}`);

  res.json({
    success: true,
    sessionId: session.sessionId,
    message: `Registered ${session.tools.length} tools. Waiting for mobile connection.`
  });
});

// --- WebSocket Server ---

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws/agent' });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const code = url.searchParams.get('code');
  const sessionId = url.searchParams.get('sessionId');

  if (!code && !sessionId) {
    ws.close(4001, 'Missing code or sessionId');
    return;
  }

  // Resolve session
  let session = null;
  if (code) {
    session = sessionsByCode.get(code);
    if (session) {
      console.log(`[ws] CLI connected: code=${code} sessionId=${session.sessionId}`);
      session.cliWs = ws;
    }
  } else if (sessionId) {
    session = sessionsById.get(sessionId);
    if (session) {
      console.log(`[ws] Client connected via sessionId=${sessionId}`);
      // Could be CLI reconnect or mobile — check below
    }
  }

  if (!session) {
    ws.close(4004, 'Session not found');
    return;
  }

  // Assign a peer ID to this connection
  const peerId = uuidv4().slice(0, 8);

  // If this session has no CLI yet, and this connection used a `code` param,
  // treat it as the CLI. Otherwise, defer classification until first message.
  if (code && !sessionId && !session.cliWs) {
    session.cliWs = ws;
    ws._isCli = true;
    ws._peerId = peerId;
    console.log(`[ws] CLI connected: code=${code} sessionId=${session.sessionId} peer=${peerId}`);
  } else {
    // Defer — could be CLI reconnect or mobile. Set as pending.
    ws._isCli = null; // unknown until first message
    ws._peerId = peerId;
    ws._deferredSessionId = session.sessionId;
    console.log(`[ws] Peer connected: sessionId=${session.sessionId} peer=${peerId} (deferred)`);

    // Track deferred connection on session
    if (!session._deferred) session._deferred = [];
    session._deferred.push(ws);
  }

  // --- Message handling ---
  ws.on('message', (rawData) => {
    try {
      const msg = JSON.parse(rawData.toString());
      handleMessage(session, ws, msg);
    } catch (e) {
      // Could be binary — just relay it
    }
  });

  ws.on('close', () => {
    handleDisconnect(session, ws);
  });

  ws.on('error', (err) => {
    console.error(`[ws] Error on session ${session.sessionId}:`, err.message);
  });

  // Heartbeat ping (only to CLI)
  if (ws === session.cliWs) {
    startHeartbeat(session);
  }
});

function handleMessage(session, ws, msg) {
  // --- Deferred connection classification ---
  // If this connection hasn't been classified yet (ws._isCli === null),
  // classify it based on the first message's content.
  if (ws._isCli === null) {
    ws._isCli = false; // assume mobile unless proven otherwise
    if (msg.type === 'output' || msg.type === 'sync_complete' || msg.type === 'pong') {
      // These are CLI-only message types
      ws._isCli = true;
    }
    // If it's a CLI, set cliWs; if mobile, set mobileWs
    if (ws._isCli) {
      session.cliWs = ws;
      console.log(`[ws] Deferred peer classified as CLI: peer=${ws._peerId}`);
    } else {
      session.mobileWs = ws;
      console.log(`[ws] Mobile connected: peer=${ws._peerId} sessionId=${session.sessionId}`);
      // Notify CLI that mobile is connected
      if (session.cliWs && session.cliWs.readyState === WebSocket.OPEN) {
        session.cliWs.send(JSON.stringify({
          type: 'client_connected',
          timestamp: new Date().toISOString()
        }));
      }
    }
    // Remove from deferred list
    if (session._deferred) {
      session._deferred = session._deferred.filter(d => d !== ws);
    }
  }

  switch (msg.type) {
    case 'pong':
      // CLI responding to our ping — connection alive
      session._lastPong = Date.now();
      break;

    case 'output':
      // CLI → Mobile (encrypted terminal output)
      // Forward to mobile if connected
      if (session.mobileWs && session.mobileWs.readyState === WebSocket.OPEN) {
        session.mobileWs.send(JSON.stringify(msg));
        // Track last seq mobile received
        if (msg.seq && msg.seq > session.lastMobileSeq) {
          session.lastMobileSeq = msg.seq;
        }
      }
      break;

    case 'input':
      // Mobile → CLI (encrypted user input)
      if (session.cliWs && session.cliWs.readyState === WebSocket.OPEN) {
        session.cliWs.send(JSON.stringify(msg));
      }
      break;

    case 'resize':
      // Mobile → CLI (terminal resize)
      if (session.cliWs && session.cliWs.readyState === WebSocket.OPEN) {
        session.cliWs.send(JSON.stringify(msg));
      }
      break;

    case 'sync_complete':
      // CLI → Mobile (catchup done)
      if (session.mobileWs && session.mobileWs.readyState === WebSocket.OPEN) {
        session.mobileWs.send(JSON.stringify(msg));
      }
      break;

    case 'mobile_pairing':
      // Mobile → Server → CLI (DH public key from mobile)
      session.mobilePublicKey = msg.publicKey;
      session.paired = true;
      console.log(`[pairing] Mobile paired with session ${session.sessionId}`);

      // Forward to CLI as pairing_complete with session info
      if (session.cliWs && session.cliWs.readyState === WebSocket.OPEN) {
        session.cliWs.send(JSON.stringify({
          type: 'pairing_complete',
          sessionId: session.sessionId,
          mobilePublicKey: msg.publicKey,
          timestamp: new Date().toISOString()
        }));
      }

      // Also notify mobile
      if (session.mobileWs && session.mobileWs.readyState === WebSocket.OPEN) {
        session.mobileWs.send(JSON.stringify({
          type: 'pairing_ack',
          sessionId: session.sessionId,
          publicKey: session.cliPublicKey, // CLI's public key for mobile to compute shared secret
          timestamp: new Date().toISOString()
        }));
      }
      break;

    case 'catchup_request':
      // Mobile → Server → CLI (requesting missed messages)
      if (session.cliWs && session.cliWs.readyState === WebSocket.OPEN) {
        session.cliWs.send(JSON.stringify({
          type: 'catchup_request',
          lastSeq: msg.lastSeq || 0,
          timestamp: new Date().toISOString()
        }));
      }
      break;

    default:
      // Unknown message type — relay it blindly (future-proofing)
      const target = ws._isCli ? session.mobileWs : session.cliWs;
      if (target && target.readyState === WebSocket.OPEN) {
        target.send(JSON.stringify(msg));
      }
      break;
  }
}

function handleDisconnect(session, ws) {
  // Remove from deferred list if still there
  if (session._deferred) {
    session._deferred = session._deferred.filter(d => d !== ws);
  }

  if (ws._isCli === true || ws === session.cliWs) {
    console.log(`[ws] CLI disconnected: sessionId=${session.sessionId}`);
    session.cliWs = null;

    // Notify mobile that CLI disconnected
    if (session.mobileWs && session.mobileWs.readyState === WebSocket.OPEN) {
      session.mobileWs.send(JSON.stringify({
        type: 'cli_disconnected',
        timestamp: new Date().toISOString()
      }));
    }
  } else if (ws._isCli === false || ws === session.mobileWs) {
    console.log(`[ws] Mobile disconnected: sessionId=${session.sessionId}`);
    session.mobileWs = null;

    // Notify CLI that mobile disconnected
    if (session.cliWs && session.cliWs.readyState === WebSocket.OPEN) {
      session.cliWs.send(JSON.stringify({
        type: 'client_disconnected',
        timestamp: new Date().toISOString()
      }));
    }
  }

  // Cleanup session if all sides disconnected
  if (!session.cliWs && !session.mobileWs) {
    setTimeout(() => {
      if (!session.cliWs && !session.mobileWs) {
        sessionsByCode.delete(session.code);
        sessionsById.delete(session.sessionId);
        console.log(`[cleanup] Session ${session.sessionId} removed`);
      }
    }, 5 * 60 * 1000);
  }
}

// --- Heartbeat ---
function startHeartbeat(session) {
  if (session._heartbeatTimer) return;

  session._heartbeatTimer = setInterval(() => {
    if (!session.cliWs || session.cliWs.readyState !== WebSocket.OPEN) {
      clearInterval(session._heartbeatTimer);
      session._heartbeatTimer = null;
      return;
    }

    const lastPong = session._lastPong || 0;
    if (Date.now() - lastPong > HEARTBEAT_INTERVAL * 3) {
      console.log(`[heartbeat] CLI timed out on session ${session.sessionId}`);
      session.cliWs.close(4008, 'Heartbeat timeout');
      return;
    }

    session.cliWs.send(JSON.stringify({ type: 'ping' }));
  }, HEARTBEAT_INTERVAL);
}

// --- Start ---
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[termly-local] Server running on ws://0.0.0.0:${PORT}`);
  console.log(`[termly-local] Health: http://localhost:${PORT}/api/health`);
  console.log(`[termly-local] QR serverUrl: ws://<your-ip>:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[termly-local] Shutting down...');
  wss.close();
  server.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  wss.close();
  server.close();
  process.exit(0);
});
