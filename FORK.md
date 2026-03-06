# Termly-cli Fork Notes

This fork of `termly-cli` introduces several enhancements to support advanced multi-agent workflows and improved terminal session management.

## Main Changes

### 1. Multi-Agent Batch Support
Added a new `batch` command that allows starting multiple AI agents simultaneously using a single pairing code.
- **Command**: `termly batch <tool[:label]> [tool[:label]...]`
- **Example**: `termly batch klam:frontend klam:backend pi:research`
- **How it works**: It generates one pairing code and registers all requested tools with the backend. When the user pairs in the browser, all agents are connected at once.

### 2. Batch Registration Protocol
- Implemented a new batch registration endpoint `/api/pairing/batch` in `lib/commands/batch.js`.
- Includes a fallback mechanism to sequential registration if the backend does not yet support the batch endpoint.

### 3. Dynamic Session ID Support
- Updated `WebSocketManager` and `PTYManager` to handle dynamic session ID reassignment from the backend.
- This ensures that if the backend assigns a canonical session ID during pairing, the CLI correctly updates its local tracking and PTY management.

### 4. PTY & Session Management Refactoring
- Improved `PTYManager` stability for concurrent sessions.
- Enhanced `CircularBuffer` handling to manage larger terminal outputs (increased to 1MB).
- Better cleanup logic for batch sessions on `SIGINT` and `SIGTERM`.

### 5. CLI Improvements
- Added `batch` command to `bin/cli.js`.
- Updated `list`, `status`, `stop` commands to better handle and display multiple active sessions.
- Improved QR code UI for batch sessions.

## Project Structure Changes
- **New File**: `lib/commands/batch.js` - Core logic for multi-agent orchestration.
- **Modified**: `lib/session/pty-manager.js`, `lib/network/websocket.js` - Refactored for better concurrency and dynamic ID support.
- **Modified**: `lib/ai-tools/registry.js` - Added helper for tool lookups by key.
