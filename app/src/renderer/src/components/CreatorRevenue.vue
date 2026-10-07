<script setup>
import { ref, onMounted } from 'vue';
import PromptCopyButton from './PromptCopyButton.vue';
const result = ref(null);
const loading = ref(false);
async function refresh() {
  loading.value = true;
  try { result.value = await window.obelisk.skillsCreatorMarket(); }
  catch { result.value = { ok: false, message: '暂时连不上收入服务，请稍后刷新。' }; }
  finally { loading.value = false; }
}
onMounted(refresh);
const publishPrompt = asset => ({ skill: 'obelisk-skill-assets', text: `帮我为自己发布的 Skill #${asset.skillId} 设置上架方式。我想先看看免费、按次取用和版本买断的区别，以及许可、上游份额和平台费用，再决定如何发布。` });
</script>

<template>
  <section class="creator-revenue" data-section="creator-revenue">
    <div class="creator-head">
      <div><h2>我的发布与回报</h2><p>你分享的知识，正在怎样帮助别人。</p></div>
      <button class="creator-refresh" :disabled="loading" @click="refresh">{{ loading ? '读取中…' : '刷新收入' }}</button>
    </div>
    <p v-if="!result" class="creator-muted">正在核对当前钱包的链上记录…</p>
    <p v-else-if="!result.ok" class="creator-muted">{{ result.message }}</p>
    <template v-else>
      <div class="creator-total"><strong>{{ result.total }} <small>BOT</small></strong><span>我的累计到账 · {{ result.count }} 笔结算</span></div>
      <p class="creator-muted">{{ result.network }}<template v-if="result.testnet"> · 测试币演示，不代表实际营收</template> · 平台费用 {{ result.platformPercent }}%</p>
      <div class="creator-assets">
        <article v-for="asset in result.assets" :key="asset.skillId">
          <div><b>{{ asset.name }}</b><p>#{{ asset.skillId }} · {{ asset.offer ? `${asset.offer.price} BOT · ${asset.offer.mode} · ${asset.offer.license}` : '尚未上架' }}</p>
            <p v-if="asset.offer">后续衍生作品留给这一层的份额：{{ asset.royaltyPercent }}%</p></div>
          <PromptCopyButton label="配置上架" :prompt="publishPrompt(asset)" />
        </article>
        <p v-if="!result.assets.length" class="creator-muted">这个钱包还没有发布 Skill。先从一次真实的工作中，留下你愿意分享的方法。</p>
      </div>
      <h3>逐笔到账</h3>
      <table v-if="result.rows.length"><thead><tr><th>结算</th><th>直接销售</th><th>衍生分成</th><th>我的到账</th></tr></thead>
        <tbody><tr v-for="row in result.rows" :key="row.receiptId"><td><a v-if="row.transactionUrl" :href="row.transactionUrl" target="_blank" rel="noopener noreferrer">#{{ row.receiptId }} ↗</a><span v-else>#{{ row.receiptId }}</span><p>{{ row.date ? new Date(row.date).toLocaleString() : '—' }}</p></td><td>{{ row.direct }} BOT</td><td>{{ row.derived }} BOT</td><td>{{ row.income }} BOT</td></tr></tbody>
      </table>
      <p v-else class="creator-muted">还没有结算。发生购买后，属于你的直接收入和上游分成会出现在这里。</p>
      <p class="creator-muted">只统计当前钱包的到账。<template v-if="result.truncated">这里显示最近一页记录。</template>
        <a v-if="result.contractUrl" :href="result.contractUrl" target="_blank" rel="noopener noreferrer">核对链上结算 ↗</a></p>
    </template>
  </section>
</template>

<style scoped>
.creator-revenue { border: 1px solid var(--hairline-strong); border-radius: 12px; padding: 24px; margin: 16px 0 28px; }
.creator-head, .creator-assets article { display: flex; align-items: center; justify-content: space-between; gap: 20px; }
.creator-refresh { border: 1px solid var(--hairline-strong); border-radius: 6px; padding: 8px 12px; color: inherit; background: transparent; cursor: pointer; }
h2 { font-size: var(--text-lg); margin: 0 0 6px; } h3 { font-size: var(--text-sm); margin-top: 24px; }
p, span, td, th { font-size: var(--text-sm); } p { margin: 6px 0; } .creator-muted, .creator-head p, .creator-assets p { color: var(--muted); }
.creator-total { display: flex; flex-direction: column; gap: 8px; margin: 24px 0 12px; }
.creator-total strong { font-size: var(--text-xl); } .creator-total small { font-size: var(--text-sm); }
.creator-assets article { border-top: 1px solid var(--hairline-strong); padding: 16px 0; }
table { width: 100%; border-collapse: collapse; text-align: left; } td, th { padding: 10px 8px; border-bottom: 1px solid var(--hairline-strong); }
</style>
