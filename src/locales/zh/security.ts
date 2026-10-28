/** Account security and the password sign-in factor challenge. */
export const security: Record<string, string> = {
  'Current sign-in': '当前登录',
  'Password and second factor': '已验证密码与第二因子',
  'Password verified': '已验证密码',
  'Email verified': '已验证邮箱',
  'Email verification': '邮箱验证',
  'Administrator impersonation': '管理员模拟登录',
  'No verification record': '暂无验证记录',
  'Incomplete verification record': '验证记录不完整',
  'Refresh sign-in details': '刷新登录信息',
  'These details show what this browser actually verified. Refreshing a session does not repeat verification.':
    '这里显示当前浏览器实际完成的验证。会话续期不会重新验证身份。',
  'Loading sign-in details…': '正在加载登录信息…',
  'Sign-in details could not be loaded. Refresh to try again.':
    '无法加载登录信息，请刷新重试。',
  'This sign-in has no complete primary verification record. Signing in again will record one.':
    '本次登录缺少完整的主要身份验证记录。重新登录后会记录。',
  'Primary verification': '主要身份验证',
  'Second-factor verification': '第二因子验证',
  'Account security': '账户安全',
  'Two-factor authentication': '双因素认证',
  'Verify your sign-in': '验证登录',
  'Enter a code to finish signing in. This browser will be challenged on every password sign-in.':
    '输入验证码以完成登录。每次使用密码登录此浏览器时，都需要再次验证。',
  'Recovery code': '恢复码',
  'Authenticator code': '身份验证器验证码',
  'Each recovery code works once. Enter an unused code you saved.':
    '每个恢复码只能使用一次。请输入已保存且尚未使用的恢复码。',
  'Enter the six-digit code from your authenticator app.':
    '请输入身份验证器应用中的六位验证码。',
  'Use an authenticator code': '使用身份验证器验证码',
  'Use a recovery code': '使用恢复码',
  'Verifying…': '正在验证…',
  'Verify and sign in': '验证并登录',
  'Use another account': '使用其他账户',
  'Too many attempts. Wait a moment before trying again.':
    '尝试次数过多，请稍后重试。',
  'This code was already used. Wait for the next code in your authenticator, then try again.':
    '此验证码已使用，请等待身份验证器生成下一个验证码后重试。',
  'Verification failed or expired. Check your password and code, then try again.':
    '验证失败或已过期。请检查密码和验证码后重试。',
  'The request failed. Check your connection and try again.':
    '请求失败，请检查网络连接后重试。',
  'Setup could not be displayed. Start again to create a new authenticator key.':
    '无法显示设置信息。请重新开始，创建新的身份验证器密钥。',
  'Two-factor authentication is now disabled.': '双因素认证已关闭。',
  'Two-factor authentication is enabled. Other browser sessions have been signed out. Save your recovery codes now.':
    '双因素认证已开启，其他浏览器会话已退出登录。请立即保存恢复码。',
  'Protect password sign-ins with an authenticator app and keep recovery codes somewhere safe.':
    '使用身份验证器应用保护密码登录，并妥善保存恢复码。',
  'Not enabled': '未开启',
  'An authenticator app generates a six-digit code. After entering your password, you will also enter this code or a single-use recovery code.':
    '身份验证器应用会生成六位验证码。输入密码后，还需要输入该验证码或一次性恢复码。',
  'Existing personal access tokens, deployment tokens and MCP connections remain active. Review them separately if your account may be compromised.':
    '已有个人访问令牌、部署令牌和 MCP 连接仍然有效。如果账户可能已被盗用，请分别检查并撤销这些凭据。',
  'Regenerate recovery codes': '重新生成恢复码',
  'Disable two-factor authentication': '关闭双因素认证',
  'Set up authenticator app': '设置身份验证器应用',
  'All previous recovery codes stop working immediately when new ones are generated.':
    '生成新恢复码后，所有旧恢复码立即失效。',
  'Your next password sign-in will no longer require an authenticator or recovery code.':
    '下次使用密码登录时，将不再需要身份验证器验证码或恢复码。',
  'Current password': '当前密码',
  'This recovery code is consumed when verified, even if the next step fails. Use another code when retrying.':
    '恢复码验证后即被消耗，即使下一步失败也无法再次使用。重试时请使用另一个恢复码。',
  'Continue setup': '继续设置',
  'Generate new codes': '生成新恢复码',
  'Confirm disable': '确认关闭',
  'Add CloudForge to your authenticator': '将 CloudForge 添加到身份验证器',
  'Setup is not complete until you verify a code below. Do not share this secret key.':
    '在下方验证成功后，设置才会完成。请勿向他人透露此密钥。',
  'Choose manual setup in your authenticator app. Use your account email as the name, enter this key, and select time-based codes (TOTP), six digits and a 30-second interval.':
    '在身份验证器应用中选择手动添加，以账户邮箱命名，输入此密钥，并选择基于时间的验证码（TOTP）、六位数字和 30 秒间隔。',
  'Secret key': '密钥',
  'Verify and enable': '验证并开启',
  'Cancel setup': '取消设置',
  'Save your recovery codes': '保存恢复码',
  'These codes are shown once. Store them safely outside this browser. Each code can replace one authenticator code if you lose your device.':
    '这些恢复码仅显示一次。请将其妥善保存在浏览器之外。设备丢失时，每个恢复码可替代一次身份验证器验证码。',
  'I have saved these recovery codes in a safe place.':
    '我已将这些恢复码保存在安全位置。',
  'Done, hide codes': '完成并隐藏恢复码',
  'A password reset does not remove two-factor authentication. Keep a recovery code so you can sign in if your authenticator is lost.':
    '重置密码不会解除双因素认证。请保存恢复码，以便身份验证器丢失时仍能登录。',
};
