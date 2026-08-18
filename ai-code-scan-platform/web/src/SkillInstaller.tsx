import { useEffect, useState } from 'react';
import { Bot, Check, Code2, Copy, Download, KeyRound, LoaderCircle, Network } from 'lucide-react';
import { loadDistributionSkills, loadMyAPIKey, type DistributionSkill } from './api';

const icons = {
  'code-security': Code2,
  'threat-modeling': Network,
  'agent-skill-security': Bot,
} as const;

async function writeText(content: string) {
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(content);
      return;
    } catch {
      // Fall through for browsers that expose the API but deny permission.
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = content;
  textarea.readOnly = true;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('无法写入剪贴板');
}

export function SkillInstaller() {
  const [skills, setSkills] = useState<DistributionSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const [apiKey, setAPIKey] = useState('');
  const [keyLoading, setKeyLoading] = useState(true);
  const [keyError, setKeyError] = useState('');
  const [copyFeedback, setCopyFeedback] = useState('');

  useEffect(() => {
    let active = true;
    loadDistributionSkills()
      .then((items) => { if (active) setSkills(items); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (active) setLoading(false); });
    loadMyAPIKey()
      .then((status) => { if (active) setAPIKey(status.apiKey ?? ''); })
      .catch((reason) => { if (active) setKeyError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (active) setKeyLoading(false); });
    return () => { active = false; };
  }, []);

  async function copyText(key: string, content: string) {
    try {
      await writeText(content);
      setCopied(key);
      setCopyFeedback(key.startsWith('env:') ? '配置已复制，可直接粘贴到终端。' : '已复制。');
      window.setTimeout(() => {
        setCopied('');
        setCopyFeedback('');
      }, 1800);
    } catch {
      setCopied('');
      setCopyFeedback('复制失败，请手动选中命令复制。');
    }
  }

  const platformURL = window.location.origin;
  const shellConfiguration = `export SECURITY_PLATFORM_URL="${platformURL}"\nexport SECURITY_PLATFORM_API_KEY="${apiKey}"`;
  const powershellConfiguration = `$env:SECURITY_PLATFORM_URL="${platformURL}"\n$env:SECURITY_PLATFORM_API_KEY="${apiKey}"`;

  return <div className="skill-installer-page">
    <header className="skill-installer-header">
      <div><span className="eyebrow">AGENT SKILLS</span><h1>安装安全 Skill</h1><p>把安装提示词发给 Agent，或使用 npx 手动安装。</p></div>
      <div className="skill-secret-note"><KeyRound size={18} /><span><strong>API Key 来自个人中心</strong><small>下方命令已自动填入当前 API Key；请勿将命令分享给其他人。</small></span></div>
    </header>
    <section className="skill-environment" aria-labelledby="skill-environment-title">
      <div className="skill-environment-heading"><div><h2 id="skill-environment-title">配置运行环境</h2><p>复制适合当前终端的命令并粘贴执行，再从同一终端启动 Agent。命令已填入真实 API Key。</p></div></div>
      {keyLoading && <div className="skill-environment-state"><LoaderCircle className="spin" size={18} />正在读取 API Key</div>}
      {!keyLoading && (keyError || !apiKey) && <div className="skill-environment-state warning"><KeyRound size={18} /><span>{keyError ? '暂时无法读取 API Key。' : '尚未生成 API Key。'} 请先在页面右上角的个人中心生成。</span></div>}
      {!keyLoading && apiKey && <div className="skill-environment-options">
        <div className="skill-environment-option"><span>macOS / Linux</span><div className="skill-env-command"><code>{shellConfiguration}</code><button type="button" title="复制 macOS / Linux 配置" aria-label="复制 macOS / Linux 环境变量配置" onClick={() => void copyText('env:shell', shellConfiguration)}>{copied === 'env:shell' ? <Check size={17} /> : <Copy size={17} />}</button></div></div>
        <div className="skill-environment-option"><span>Windows PowerShell</span><div className="skill-env-command"><code>{powershellConfiguration}</code><button type="button" title="复制 PowerShell 配置" aria-label="复制 PowerShell 环境变量配置" onClick={() => void copyText('env:powershell', powershellConfiguration)}>{copied === 'env:powershell' ? <Check size={17} /> : <Copy size={17} />}</button></div></div>
      </div>}
      <div className="skill-copy-feedback" role="status" aria-live="polite">{copyFeedback}</div>
    </section>
    {loading && <div className="skill-installer-state"><LoaderCircle className="spin" size={24} />正在读取可安装 Skill</div>}
    {error && <div className="skill-installer-state error">加载失败：{error}</div>}
    {!loading && !error && <section className="skill-install-grid">{skills.map((skill) => {
      const Icon = icons[skill.name as keyof typeof icons] ?? Bot;
      const promptKey = `${skill.name}:prompt`;
      const commandKey = `${skill.name}:command`;
      return <article className="skill-install-card" key={skill.name}>
        <div className="skill-install-title"><span><Icon size={21} /></span><div><h2>{skill.title}</h2><code>{skill.name}</code></div></div>
        <p>{skill.description}</p>
        <div className="skill-install-options">
          <div className="skill-install-option"><span>安装提示词</span><div className="skill-command"><code>{skill.installPrompt}</code><button type="button" title="复制安装提示词" aria-label={`复制 ${skill.title} 安装提示词`} onClick={() => void copyText(promptKey, skill.installPrompt)}>{copied === promptKey ? <Check size={17} /> : <Copy size={17} />}</button></div></div>
          <div className="skill-install-option"><span>npx 安装</span><div className="skill-command secondary"><code>{skill.installCommand}</code><button type="button" title="复制 npx 命令" aria-label={`复制 ${skill.title} npx 命令`} onClick={() => void copyText(commandKey, skill.installCommand)}>{copied === commandKey ? <Check size={17} /> : <Copy size={17} />}</button></div></div>
        </div>
        <footer><span>专用 API <code>{skill.apiPath}</code></span><a className="secondary-button" href={skill.downloadUrl}><Download size={15} />下载 ZIP</a></footer>
      </article>;
    })}</section>}
  </div>;
}