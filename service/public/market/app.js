// The Skill market (#35): a public page served by the Obelisk online service
// under /market, reading only the service's public API on the same origin.
//
//   /market                 minted Skills with real usage        list.js
//   /market/skills/:id      one Skill: usage, scenes, lineage    detail.js
//   /market/stage-2         stage 2 preview, examples labeled    stage2.js

import { h, replace } from './dom.js';
import { showNetwork } from '/site/site.js';
import { renderList } from './list.js';
import { renderDetail } from './detail.js';
import { renderStage2 } from './stage2.js';
import { failure } from './ui.js';

const root = document.getElementById('app');

async function route() {
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const skill = /^\/market\/skills\/([1-9]\d{0,30})$/.exec(path);
  try {
    if (path === '/market') {
      document.title = 'Skill 市场 · Obelisk';
      await renderList(root);
    } else if (skill) {
      await renderDetail(root, skill[1]);
    } else if (path === '/market/stage-2') {
      document.title = '阶段 2 预览 · Obelisk Skill 市场';
      await renderStage2(root, new URLSearchParams(location.search));
    } else {
      replace(root, failure({ status: 404, message: '这个地址没有页面。' }), h('p', null, h('a', { href: '/market' }, '回到 Skill 市场')));
    }
  } catch (error) {
    replace(root, failure(error));
  }
}

showNetwork();
route();
