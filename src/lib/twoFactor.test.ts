import { describe, expect, it } from 'vitest';
import { enrollmentSecret, factorError } from './twoFactor';
import { t } from './i18n';

describe('身份验证器手工设置', () => {
  it('重放拒绝明确提示等待下一轮验证码，不引导用户重复提交同一码', () => {
    expect(factorError({ code: 'TOTP_ALREADY_USED' })).toBe(
      t(
        'This code was already used. Wait for the next code in your authenticator, then try again.'
      )
    );
  });
  it('只提取 TOTP base32 密钥，保留前导字母并忽略标签与参数', () => {
    expect(
      enrollmentSecret(
        'otpauth://totp/CloudForge%3Atest?secret=ABCDE234567&issuer=CloudForge&digits=6'
      )
    ).toBe('ABCDE234567');
  });

  it.each([
    '',
    'not a URI',
    'https://external.invalid/qr?secret=ABCDE234567',
    'otpauth://hotp/test?secret=ABCDE234567',
    'otpauth://totp/test',
    'otpauth://totp/test?secret=',
    'otpauth://totp/test?secret=script%3Aalert(1)',
    'otpauth://totp/test?secret=ABC%20DEF',
  ])('拒绝不属于 TOTP 的或无效秘密：%s', (uri) => {
    expect(enrollmentSecret(uri)).toBeNull();
  });
});
