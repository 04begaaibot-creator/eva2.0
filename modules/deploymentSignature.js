const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_FILES = ['package.json', 'package-lock.json', 'server.js', 'v21.html'];
const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

function listFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => compareText(left.name, right.name))
    .flatMap((entry) => {
      const filePath = path.join(directory, entry.name);
      return entry.isDirectory() ? listFiles(filePath) : [filePath];
    });
}

function createDeploymentSignature(rootDirectory = path.join(__dirname, '..')) {
  const moduleDirectory = path.join(rootDirectory, 'modules');
  const files = [
    ...ROOT_FILES.map((file) => path.join(rootDirectory, file)),
    ...listFiles(moduleDirectory),
  ].map((file) => ({
    file,
    relativePath: path.relative(rootDirectory, file).split(path.sep).join('/'),
  })).sort((left, right) => compareText(left.relativePath, right.relativePath));
  const hash = crypto.createHash('sha256');

  for (const { file, relativePath } of files) {
    hash.update(relativePath);
    hash.update('\0');
    hash.update(fs.readFileSync(file));
    hash.update('\0');
  }

  return `sha256-${hash.digest('hex').slice(0, 16)}`;
}

module.exports = { createDeploymentSignature };
