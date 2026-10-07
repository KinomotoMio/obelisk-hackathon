import { showNetwork } from '/site/site.js';
void showNetwork();
for (const button of document.querySelectorAll('[data-copy]')) {
  button.addEventListener('click', async () => {
    const source = document.getElementById(button.dataset.copy);
    const status = document.getElementById('copy-status');
    try {
      await navigator.clipboard.writeText(source.textContent);
      status.textContent = '已复制。粘贴给你的 coding agent，即可开始安装。';
    } catch {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(source);
      selection.removeAllRanges();
      selection.addRange(range);
      status.textContent = '浏览器未允许自动复制，已选中文字，请按 ⌘C 或 Ctrl+C 复制。';
    }
  });
}
