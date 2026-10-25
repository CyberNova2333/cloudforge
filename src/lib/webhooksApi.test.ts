import { describe, expect, it } from 'vitest';
import { webhookInput, type WebhookDraft } from './webhooksApi';

const draft: WebhookDraft = {
  url: ' https://receiver.example/hooks ',
  events: ['push', 'status'],
  active: false,
  secretAction: 'keep',
  secret: '',
};

describe('Webhook 表单的只写密钥', () => {
  it('普通编辑不回传或清空已经保存的密钥', () => {
    const result = webhookInput({ ...draft, secret: 'discarded draft' });
    expect(result).toEqual({
      url: 'https://receiver.example/hooks',
      events: ['push', 'status'],
      active: false,
    });
    expect(Object.prototype.hasOwnProperty.call(result, 'secret')).toBe(false);
  });

  it('只有明确移除才发送 null；替换时完整保留密钥中的空白', () => {
    expect(
      webhookInput({ ...draft, secretAction: 'remove' }).secret
    ).toBeNull();
    expect(
      webhookInput({
        ...draft,
        secretAction: 'replace',
        secret: '  exact secret  ',
      }).secret
    ).toBe('  exact secret  ');
  });

  it('全部事件发送单个通配符，自选事件去重', () => {
    expect(
      webhookInput({ ...draft, events: ['push', '*', 'status'] }).events
    ).toEqual(['*']);
    expect(
      webhookInput({ ...draft, events: ['push', 'push', 'status'] }).events
    ).toEqual(['push', 'status']);
  });
});
