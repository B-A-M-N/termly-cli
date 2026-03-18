const { spawn } = require('child_process');

// AI Tools Registry
const AI_TOOLS = {
  'claude-code': {
    key: 'claude-code',
    command: 'claude',
    args: [],
    displayName: 'Claude Code',
    description: 'Anthropic\'s AI coding assistant',
    website: 'https://docs.claude.com',
    checkInstalled: async () => await commandExists('claude')
  },
  'aider': {
    key: 'aider',
    command: 'aider',
    args: [],
    displayName: 'Aider',
    description: 'AI pair programming in your terminal',
    website: 'https://aider.chat',
    checkInstalled: async () => await commandExists('aider')
  },
  'codex': {
    key: 'codex',
    command: 'codex',
    args: [],
    displayName: 'OpenAI Codex CLI',
    description: 'Official OpenAI Codex CLI (launched April 2025)',
    website: 'https://openai.com/codex',
    checkInstalled: async () => await commandExists('codex')
  },
  'github-copilot': {
    key: 'github-copilot',
    command: 'copilot',
    args: [],
    displayName: 'GitHub Copilot CLI',
    description: 'GitHub\'s command line AI',
    website: 'https://github.com/features/copilot',
    checkInstalled: async () => await commandExists('copilot')
  },
  'cody': {
    key: 'cody',
    command: 'cody',
    args: ['chat'],
    displayName: 'Cody CLI',
    description: 'Sourcegraph\'s AI assistant (Beta)',
    website: 'https://sourcegraph.com/cody',
    checkInstalled: async () => await commandExists('cody')
  },
  'gemini': {
    key: 'gemini',
    command: 'gemini',
    args: [],
    displayName: 'Google Gemini CLI',
    description: 'Official Google Gemini CLI with 1M token context',
    website: 'https://developers.google.com/gemini-code-assist',
    checkInstalled: async () => await commandExists('gemini')
  },
  'continue': {
    key: 'continue',
    command: 'cn',
    args: [],
    displayName: 'Continue CLI',
    description: 'Open-source modular AI coding assistant',
    website: 'https://continue.dev',
    checkInstalled: async () => await commandExists('cn')
  },
  'cursor': {
    key: 'cursor',
    command: 'cursor-agent',
    args: [],
    displayName: 'Cursor Agent CLI',
    description: 'Cursor\'s AI coding assistant CLI (Beta)',
    website: 'https://cursor.com/blog/cli',
    checkInstalled: async () => await commandExists('cursor-agent')
  },
  'chatgpt': {
    key: 'chatgpt',
    command: 'chatgpt',
    args: [],
    displayName: 'ChatGPT CLI',
    description: 'ChatGPT in your terminal (Go implementation)',
    website: 'https://github.com/j178/chatgpt',
    checkInstalled: async () => await commandExists('chatgpt')
  },
  'sgpt': {
    key: 'sgpt',
    command: 'sgpt',
    args: ['--repl', 'temp'],
    displayName: 'ShellGPT',
    description: 'ChatGPT-powered shell assistant with REPL mode',
    website: 'https://github.com/TheR1D/shell_gpt',
    checkInstalled: async () => await commandExists('sgpt')
  },
  'mentat': {
    key: 'mentat',
    command: 'mentat',
    args: [],
    displayName: 'Mentat',
    description: 'AI coding assistant with Git integration',
    website: 'https://www.mentat.ai',
    checkInstalled: async () => await commandExists('mentat')
  },
  'grok': {
    key: 'grok',
    command: 'grok',
    args: [],
    displayName: 'Grok CLI',
    description: 'xAI\'s Grok AI assistant (by Elon Musk)',
    website: 'https://grok.x.ai',
    checkInstalled: async () => await commandExists('grok')
  },
  'ollama': {
    key: 'ollama',
    command: 'ollama',
    args: ['run', 'codellama'],
    displayName: 'Ollama',
    description: 'Run LLMs locally (CodeLlama, Llama, etc)',
    website: 'https://ollama.ai',
    checkInstalled: async () => await commandExists('ollama')
  },
  'openhands': {
    key: 'openhands',
    command: 'openhands',
    args: [],
    displayName: 'OpenHands',
    description: 'Open-source AI software engineer (formerly OpenDevin)',
    website: 'https://github.com/All-Hands-AI/OpenHands',
    checkInstalled: async () => await commandExists('openhands')
  },
  'opencode': {
    key: 'opencode',
    command: 'opencode',
    args: [],
    displayName: 'OpenCode',
    description: 'Open-source AI coding agent with LSP integration and 75+ LLM providers',
    website: 'https://opencode.ai',
    checkInstalled: async () => await commandExists('opencode')
  },
  'blackbox': {
    key: 'blackbox',
    command: 'blackboxai',
    args: [],
    displayName: 'Blackbox AI',
    description: 'AI coding assistant with debugging & file editing',
    website: 'https://blackbox.ai',
    checkInstalled: async () => await commandExists('blackboxai')
  },
  'amazon-q': {
    key: 'amazon-q',
    command: 'q',
    args: [],
    displayName: 'Amazon Q Developer',
    description: 'AWS\'s AI coding companion with free tier',
    website: 'https://aws.amazon.com/q/developer',
    checkInstalled: async () => await commandExists('q')
  },
  'pi': {
    key: 'pi',
    command: 'pi',
    args: [],
    displayName: 'Pi Coding Agent',
    description: 'Minimal AI coding agent with extensions, skills, and 15+ LLM providers',
    website: 'https://shittycodingagent.ai',
    checkInstalled: async () => await commandExists('pi')
  },
  'kilo': {
    key: 'kilo',
    command: 'kilo',
    args: [],
    displayName: 'Kilo Code CLI',
    description: 'Agentic engineering CLI with 500+ models and parallel mode',
    website: 'https://kilo.ai',
    checkInstalled: async () => await commandExists('kilo')
  },
  'kimi': {
    key: 'kimi',
    command: 'kimi',
    args: [],
    displayName: 'Kimi Code',
    description: 'Moonshot AI\'s autonomous coding agent',
    website: 'https://github.com/MoonshotAI/kimi-cli',
    checkInstalled: async () => await commandExists('kimi')
  },
  'zai': {
    key: 'zai',
    command: 'zai',
    args: [],
    displayName: 'ZAI CLI',
    description: 'Zhipu AI\'s conversational agent for GLM models',
    website: 'https://z.ai',
    checkInstalled: async () => await commandExists('zai')
  },
  'interpreter': {
    key: 'interpreter',
    command: 'interpreter',
    args: [],
    displayName: 'Open Interpreter',
    description: 'Natural language interface for your computer',
    website: 'https://openinterpreter.com',
    checkInstalled: async () => await commandExists('interpreter')
  },
  'fabric': {
    key: 'fabric',
    command: 'fabric',
    args: [],
    displayName: 'Fabric',
    description: 'Augmenting humans using AI patterns',
    website: 'https://github.com/danielmiessler/fabric',
    checkInstalled: async () => await commandExists('fabric')
  },
  'plandex': {
    key: 'plandex',
    command: 'plandex',
    args: [],
    displayName: 'Plandex',
    description: 'AI coding agent for complex, multi-stage tasks',
    website: 'https://plandex.ai',
    checkInstalled: async () => await commandExists('plandex')
  },
  'shor': {
    key: 'shor',
    command: 'shor',
    args: [],
    displayName: 'ShellOracle',
    description: 'Intelligent shell command generation',
    website: 'https://github.com/djcopley/ShellOracle',
    checkInstalled: async () => await commandExists('shor')
  },
  'gptme': {
    key: 'gptme',
    command: 'gptme',
    args: [],
    displayName: 'gptme',
    description: 'Personal AI assistant in your terminal',
    website: 'https://gptme.org',
    checkInstalled: async () => await commandExists('gptme')
  },
  'mods': {
    key: 'mods',
    command: 'mods',
    args: [],
    displayName: 'Mods',
    description: 'AI for the command line (by Charm)',
    website: 'https://github.com/charmbracelet/mods',
    checkInstalled: async () => await commandExists('mods')
  },
  'qodo': {
    key: 'qodo',
    command: 'qodo',
    args: [],
    displayName: 'Qodo CLI',
    description: 'Quality-focused AI code review and testing',
    website: 'https://www.qodo.ai',
    checkInstalled: async () => await commandExists('qodo')
  },
  'demo': {
    key: 'demo',
    command: 'node',
    args: [require('path').join(__dirname, 'demo', 'index.js')],
    displayName: 'Demo Mode',
    description: 'Interactive demo for testing (no AI installation required)',
    website: 'https://termly.dev',
    checkInstalled: async () => true // Always available
  }
};

// Check if command exists
async function commandExists(command) {
  return new Promise((resolve) => {
    const isWindows = process.platform === 'win32';
    const checkCommand = isWindows ? 'where' : 'which';
    const args = [command];

    const child = spawn(checkCommand, args);

    child.on('close', (code) => {
      resolve(code === 0);
    });

    child.on('error', () => {
      resolve(false);
    });
  });
}

// Get tool version
async function getToolVersion(tool) {
  const tryVersion = (args) => {
    return new Promise((resolve) => {
      const child = spawn(tool.command, args);
      let output = '';

      child.stdout.on('data', (data) => {
        output += data.toString();
      });

      child.stderr.on('data', (data) => {
        output += data.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve(parseVersion(output));
        } else {
          resolve(null);
        }
      });

      child.on('error', () => {
        resolve(null);
      });
    });
  };

  // Try --version first
  let version = await tryVersion(['--version']);
  if (version && version !== 'unknown') {
    return version;
  }

  // Try -v as fallback
  version = await tryVersion(['-v']);
  return version || 'unknown';
}

// Parse version from output
function parseVersion(output) {
  const versionMatch = output.match(/(\d+\.\d+\.\d+)/);
  if (versionMatch) {
    return versionMatch[1];
  }

  const simpleMatch = output.match(/(\d+\.\d+)/);
  if (simpleMatch) {
    return simpleMatch[1];
  }

  return 'unknown';
}

// Get tool by key
function getToolByKey(key) {
  // Normalize key
  const normalizedKey = key.toLowerCase().replace(/\s+/g, '-');

  // Try exact match
  if (AI_TOOLS[normalizedKey]) {
    return AI_TOOLS[normalizedKey];
  }

  // Try fuzzy match
  for (const [toolKey, tool] of Object.entries(AI_TOOLS)) {
    if (tool.displayName.toLowerCase() === key.toLowerCase()) {
      return tool;
    }
    if (tool.command === key) {
      return tool;
    }
  }

  return null;
}

// Get all tools
function getAllTools() {
  return Object.values(AI_TOOLS);
}

module.exports = {
  AI_TOOLS,
  commandExists,
  getToolVersion,
  parseVersion,
  getToolByKey,
  getAllTools
};
