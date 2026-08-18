#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const supportedSkills = new Set(['code-security', 'threat-modeling', 'agent-skill-security']);
const arguments = process.argv.slice(2);
const skillName = arguments.find((value) => !value.startsWith('-'));
const baseURLIndex = arguments.indexOf('--base-url');
const baseURL = baseURLIndex >= 0 ? arguments[baseURLIndex + 1] : '';

if (!supportedSkills.has(skillName) || !baseURL) {
  console.error('Usage: secscan-skill <skill-name> --base-url <platform-url>');
  process.exit(2);
}

const destinationRoot = process.env.SKILLS_HOME || path.join(os.homedir(), '.agents', 'skills');
const destination = path.join(destinationRoot, skillName);

async function install() {
  const response = await fetch(`${baseURL.replace(/\/$/, '')}/api/v1/skills/${skillName}/bundle`);
  if (!response.ok) throw new Error(`Skill download failed (HTTP ${response.status})`);
  const bundle = await response.json();
  fs.rmSync(destination, { recursive: true, force: true });
  for (const file of bundle.files) {
    const relativePath = path.normalize(file.path);
    if (path.isAbsolute(relativePath) || relativePath.startsWith('..')) throw new Error('Invalid skill asset path');
    const target = path.join(destination, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, Buffer.from(file.content, 'base64'));
  }
  console.log(`Installed ${skillName} to ${destination}`);
}

install().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});