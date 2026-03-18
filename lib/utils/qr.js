const qrcode = require('qrcode-terminal');
const chalk = require('chalk');

// Generate QR code data
function generateQRData(pairingCode, serverUrl, aiTool, projectName, label = null) {
  const data = {
    type: 'termly-pairing',
    code: pairingCode,
    serverUrl,
    aiTool,
    projectName
  };

  // Only include label if it exists to prevent breaking mobile app parsing
  if (label) {
    data.label = label;
  }

  return JSON.stringify(data);
}

// Display QR code with pairing information
function displayPairingUI(pairingCode, serverUrl, aiToolKey, aiToolDisplayName, aiToolVersion, projectName, computerName, label = null) {
  const qrData = generateQRData(pairingCode, serverUrl, aiToolKey, projectName, label);

  console.log('\n' + chalk.bold.cyan('┌──────────────────────────────────────────────────┐'));
  console.log(chalk.bold.cyan('│ 🚀 Termly CLI                                    │'));
  console.log(chalk.bold.cyan('│                                                  │'));
  console.log(chalk.cyan(`│ Computer: ${computerName.padEnd(30)}         │`));
  console.log(chalk.cyan(`│ AI Tool: ${(aiToolDisplayName + ' ' + aiToolVersion).padEnd(31)}         │`));
  if (label) {
    console.log(chalk.cyan(`│ Label:   ${label.padEnd(31)}         │`));
  }
  console.log(chalk.cyan(`│ Project: ${projectName.padEnd(31)}         │`));
  console.log(chalk.bold.cyan('│                                                  │'));
  console.log(chalk.bold.cyan('│ To connect your mobile app:                      │'));
  console.log(chalk.bold.cyan('│                                                  │'));

  // Generate QR code to string
  const qrLines = [];
  qrcode.generate(qrData, { small: true }, (qrString) => {
    const lines = qrString.split('\n');
    lines.forEach(line => {
      if (line.trim()) {
        qrLines.push(`│  ${line.padEnd(38)}│`);
      }
    });
  });

  // Since qrcode-terminal uses callback, we need to display synchronously
  // Using small:true for compact QR code
  console.log(chalk.bold.cyan('│ ╔═════════════════════════════════════════════╗  │'));

  // Display QR code inline (simplified version)
  const qrOutput = [];
  qrcode.generate(qrData, { small: true }, (code) => {
    code.split('\n').forEach(line => {
      if (line.trim()) {
        console.log(chalk.bold.cyan('│ ║ ') + chalk.white(line) + chalk.bold.cyan(' '.repeat(Math.max(0, 34 - line.length)) + ' ║  │'));
      }
    });
  });

  console.log(chalk.bold.cyan('│ ╚═════════════════════════════════════════════╝  │'));
  console.log(chalk.bold.cyan('│                                                  │'));
  console.log(chalk.bold.cyan('│ Or enter this code in your app:                  │'));
  console.log(chalk.bold.cyan('│                                                  │'));
  console.log(chalk.bold.cyan('│      ╔═════════════════╗                         │'));
  const formattedCode = `${pairingCode.substring(0, 3).split('').join(' ')} - ${pairingCode.substring(3).split('').join(' ')}`;
  console.log(chalk.bold.cyan(`│      ║  ${chalk.bold.yellow(formattedCode)}  ║                         │`));
  console.log(chalk.bold.cyan('│      ╚═════════════════╝                         │'));
  console.log(chalk.bold.cyan('│                                                  │'));
  console.log(chalk.yellow('│ Waiting for connection...                        │'));
  console.log(chalk.gray('│ (Code expires in 5 minutes)                      │'));
  console.log(chalk.bold.cyan('└──────────────────────────────────────────────────┘'));
  console.log('');
}

module.exports = {
  generateQRData,
  displayPairingUI
};
