// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { maskText, redactText, scanText } from '../packages/core/src/privacy-scan.ts';

// Built at runtime so no scanner ever flags this file as holding a secret.
const fake = {
  anthropic: `sk-ant-api03-${'Q7'.repeat(20)}`,
  github: `ghp_${'a1B2'.repeat(9)}`,
  aws: `AKIA${'Z9'.repeat(8)}`,
  jwt: `eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.${'s1'.repeat(8)}`,
  hexKey: `0x${'4f'.repeat(32)}`,
};

const types = (text, hints) => scanText(text, hints).map((match) => match.type);

test('隐私体检按常见格式检出密钥、令牌、密码、本地路径与用户名、邮箱、电话', () => {
  assert.deepEqual(types(`export ANTHROPIC_API_KEY=${fake.anthropic}`), ['api_key']);
  assert.deepEqual(types(`remote: https://x:${fake.github}@github.com/o/r`), ['connection_string']);
  assert.deepEqual(types(`token ${fake.github}`), ['api_key']);
  assert.deepEqual(types(`aws_access_key_id = ${fake.aws}`), ['api_key']);
  assert.deepEqual(types(`Authorization: Bearer ${fake.jwt}`), ['access_token']);
  assert.deepEqual(types(`RELAYER_PRIVATE_KEY=${fake.hexKey}`), ['private_key']);
  assert.deepEqual(types('-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----'), ['private_key']);
  assert.deepEqual(types('password: "hunter2!xyz"'), ['password']);
  assert.deepEqual(types('DATABASE_URL=postgres://admin:s3cr3tPass@db.internal:5432/app'), ['connection_string']);
  assert.deepEqual(types('cd /Users/alice/pay && ls /home/bob && dir C:\\Users\\carol\\pay'), ['local_path', 'local_path', 'local_path']);
  assert.deepEqual(types('~/.claude/projects/-Users-alice-pay', { username: 'alice' }), ['local_path']);
  assert.deepEqual(types('mail zhou.li@acme-pay.cn'), ['email']);
  assert.deepEqual(types('电话13812345678，或 +1 415-555-0132'), ['phone', 'phone']);
});

test('code, placeholders, hashes, and tool addresses are not reported as secrets', () => {
  for (const text of [
    'const token = getToken();',
    'const password = process.env.DB_PASSWORD',
    'apiKey: config.apiKey',
    'secret = "<your secret>"',
    'password=********',
    `tx ${fake.hexKey} confirmed in block 25941323`,
    'Co-Authored-By: Claude <noreply@anthropic.com>',
    'git clone git@github.com:org/repo.git',
    'ts 1759872000000, tz +0800, version 1.2.3',
    'see /Users/Shared/notes',
  ]) {
    assert.deepEqual(types(text), [], text);
  }
});

test('redaction replaces only the chosen spans and keeps the rest readable', () => {
  const text = `cd /Users/alice/pay; export KEY=${fake.anthropic}; mail zhou.li@acme-pay.cn`;
  const matches = scanText(text);
  assert.deepEqual(matches.map((m) => m.type), ['local_path', 'api_key', 'email']);
  assert.equal(
    redactText(text, matches, (m) => m.type !== 'email'),
    'cd ~/pay; export KEY=[redacted: API key]; mail zhou.li@acme-pay.cn',
  );
  const masked = maskText(text);
  assert.ok(!masked.includes(fake.anthropic) && !masked.includes('alice') && !masked.includes('zhou.li'));
});
