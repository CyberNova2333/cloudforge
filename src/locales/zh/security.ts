// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
/** Account security and the password sign-in factor challenge. */
export const security: Record<string, string> = {
  'Provider status': '提供方状态',
  'Published and active': '已发布并启用',
  'Retired for all deployments': '已对所有部署停用',
  'The published identity provider has been retired.':
    '已发布的身份提供方已停用。',
  'This deployment has an invalid identity provider configuration. You can still retire the published provider below.':
    '本次部署的身份提供方配置无效。仍可在下方停用已发布的提供方。',
  'Linking is retired. Reactivation requires publishing a higher configuration version.':
    '身份绑定已停用。重新启用需部署并发布更高的配置版本。',
  'Clearing deployment variables does not retire the published provider. Retire it here to reject earlier configurations and pending identity actions.':
    '清空部署变量不会停用已发布的提供方。请在此发布停用，以拒绝旧配置和进行中的身份操作。',
  'Preview provider retirement': '预览提供方停用',
  'Provider retirement preview': '提供方停用预览',
  'Retirement stops identity linking for this provider across deployments and invalidates pending identity actions. Existing identity ownership records remain. Reactivation requires a higher configuration version.':
    '停用会阻止各部署继续使用此提供方绑定身份，并使进行中的身份操作失效。现有身份归属记录保留，重新启用需要更高的配置版本。',
  'I understand the impact and want to retire this published identity provider.':
    '我已了解影响，确认停用此已发布的身份提供方。',
  'Confirm provider retirement': '确认停用提供方',
  'Retiring…': '正在停用…',
  'External identities': '外部身份',
  'External identity provider': '外部身份提供方',
  'Identity issuer': '身份签发者',
  'Identity subject': '身份主体',
  'External email': '外部邮箱',
  'External display name': '外部显示名称',
  'Not supplied': '未提供',
  'Identity provider': '身份提供方',
  'Local account': '本地账户',
  'Local administrator': '本地管理员',
  'Provider identifier': '提供方标识',
  'OIDC client identifier': 'OIDC 客户端标识',
  'Configuration version': '配置版本',
  'OIDC callback URL': 'OIDC 回调地址',
  'Deployed provider': '已部署的提供方',
  'Published provider': '已发布的提供方',
  'Link an external identity to this local account. Single sign-on remains unavailable; keep using your password and configured factors.':
    '将外部身份绑定到当前本地账户。单点登录仍不可用，请继续使用密码和已配置的因子。',
  'No external identity provider is configured.': '尚未配置外部身份提供方。',
  'The deployed identity provider has not been published by an administrator. Linking is unavailable.':
    '已部署的身份提供方尚未由管理员发布，目前无法绑定。',
  'Preview identity linking': '预览身份绑定',
  'Identity linking preview': '身份绑定预览',
  'Continue to this provider to prove ownership, then review the returned identity before linking. Returning from the provider does not link it automatically.':
    '前往此提供方验证身份归属，返回后核对身份并确认绑定。从提供方返回不会自动绑定。',
  'I want to link an identity from this provider to this local account.':
    '我希望将此提供方的身份绑定到当前本地账户。',
  'Continue to identity provider': '前往身份提供方',
  'Continuing…': '正在继续…',
  'Returned external identity': '返回的外部身份',
  'Review the immutable issuer and subject. Email and display name are profile text and do not select a local account.':
    '请核对不可变的签发者和身份主体。邮箱和显示名称仅为资料文本，不用于选择本地账户。',
  'I confirm that this external identity belongs to me and should be linked to this local account.':
    '我确认此外部身份属于我，并将其绑定到当前本地账户。',
  'Confirm identity linking': '确认身份绑定',
  'Linking…': '正在绑定…',
  'Cancel identity linking': '取消身份绑定',
  'Cancelling…': '正在取消…',
  'External identity linked. This did not enable single sign-on.':
    '外部身份已绑定，单点登录仍未开启。',
  'Identity linking cancelled.': '身份绑定已取消。',
  'External identity revoked.': '外部身份已撤销。',
  'This identity action is already confirmed. Check the linked identities below.':
    '此身份操作已经确认，请查看下方的已绑定身份。',
  'Identity verification is still pending. Refresh its status before continuing.':
    '身份验证尚未完成，请刷新实际状态后继续。',
  'This identity action cannot be confirmed. Start again if you still want to link an identity.':
    '此身份操作无法确认。如仍需绑定，请重新开始。',
  'Refresh identity status': '刷新身份状态',
  'Linked identities': '已绑定身份',
  'Linked external identity': '已绑定的外部身份',
  'No external identities are linked.': '尚未绑定外部身份。',
  'Revoke the existing identity from this provider before linking another.':
    '绑定此提供方的另一个身份前，请先撤销现有绑定。',
  'Revoke identity': '撤销身份',
  'Confirm identity revocation': '确认撤销身份',
  'Revoking…': '撤销中…',
  'Revocation removes this active link. It does not change your password, factors, or existing machine credentials, and does not transfer the identity to another member.':
    '撤销会移除当前有效绑定，不更改密码、因子或现有机器凭据，也不会将身份转移给其他成员。',
  'Publish the provider supplied by this deployment before members can link identities. Publishing does not enable single sign-on.':
    '管理员需先发布本次部署提供的配置，成员才能绑定身份。发布配置不会开启单点登录。',
  'The client secret is managed only in deployment secrets. This page never reads, displays, or edits it.':
    '客户端密钥只通过部署密钥管理，本页面不读取、显示或编辑密钥。',
  'Identity provider configuration published.': '身份提供方配置已发布。',
  'This deployment matches the published provider configuration.':
    '本次部署与已发布的提供方配置一致。',
  'This deployment is not the published provider configuration. Member linking is unavailable.':
    '本次部署与已发布的提供方配置不一致，成员暂时无法绑定。',
  'Preview provider publication': '预览提供方发布',
  'Provider publication preview': '提供方发布预览',
  'Publishing replaces the active provider generation. In-flight identity actions from older configurations will stop working. Linked identities remain owned by their original members.':
    '发布会推进有效提供方的配置代数，使用旧配置的进行中身份操作将失效。已绑定身份仍归原成员所有。',
  'I checked the deployed issuer, client identifier and callback URL and want to publish this configuration.':
    '我已核对部署中的签发者、客户端标识和回调地址，确认发布此配置。',
  'Confirm provider publication': '确认发布提供方',
  'Publishing…': '正在发布…',
  'The identity provider returned an invalid authorization address.':
    '身份提供方返回的授权地址无效。',
  'The identity preview expired or the provider changed. Preview again.':
    '身份预览已过期或提供方配置已变化，请重新预览。',
  'The identity action changed. Refresh its status.':
    '身份操作已变化，请刷新其实际状态。',
  'Authentication policy': '认证策略',
  'the authentication policy': '认证策略',
  'Two-factor authentication is required for every member.':
    '所有成员都必须使用双因素认证。',
  'Members currently choose whether to enable two-factor authentication.':
    '当前由成员自行选择是否启用双因素认证。',
  'Changing this policy requires a recent password and second-factor verification. Preview the impact before confirming.':
    '修改此策略需要最近完成的密码与第二因子验证。请先预览影响，再确认修改。',
  'Authentication policy updated.': '认证策略已更新。',
  'Require two-factor authentication for all members':
    '要求所有成员启用双因素认证',
  'Preparing preview…': '正在准备预览…',
  'Preview policy change': '预览策略变更',
  'Policy change preview': '策略变更预览',
  'Members needing enrollment': '需要绑定验证器的成员',
  'Other browser sessions requiring verification':
    '需要重新验证的其他浏览器会话',
  'OAuth connections to disconnect': '将断开的 OAuth 连接',
  'Existing personal access tokens kept active': '继续有效的现有个人访问令牌',
  'Existing deployment tokens kept active': '继续有效的现有部署令牌',
  'Every policy change disconnects existing OAuth applications. Members must connect them again. Existing personal access tokens and deployment tokens keep their current permissions and expiry.':
    '每次策略变更都会断开现有 OAuth 应用，成员需要重新连接。现有个人访问令牌和部署令牌保留原有权限与有效期。',
  'Keep authenticator recovery codes outside this browser. If the last administrator loses all factors, an operator with Cloudflare management access must use the independent cloudforge reset-mfa command with an explicit target and audited reason.':
    '请在浏览器之外保存验证器恢复码。如果最后一位管理员失去所有因子，需要拥有 Cloudflare 管理权限的运维人员使用独立的 cloudforge reset-mfa 命令，明确恢复目标并留下审计原因。',
  'This preview is temporary. Changes to the policy, your sign-in or the affected accounts may require another preview.':
    '此预览有有效期。策略、登录状态或受影响账户变化后，可能需要重新预览。',
  'I understand the impact and have an independent recovery path for the last administrator.':
    '我已了解变更影响，并为最后一位管理员准备了独立恢复方式。',
  'Applying…': '正在应用…',
  'Confirm policy change': '确认策略变更',
  'Your administrator requires two-factor authentication. It cannot be disabled while this policy is active.':
    '管理员要求使用双因素认证。策略生效期间无法关闭。',
  'Continue to verification': '继续验证身份',
  'Two-factor authentication required': '需要双因素认证',
  'Verify your sign-in policy': '核对登录策略',
  'This preview expired or the policy changed. Preview again.':
    '预览已过期或策略已变化，请重新预览。',
  'The signed-in session changed. Reload and try again.':
    '登录会话已变化，请刷新后重试。',
  'Verify your identity': '验证身份',
  'Verify and continue': '验证并继续',
  'Stop impersonating before changing security settings.':
    '请先退出模拟登录，再更改安全设置。',
  'Your sign-in changed. Close this prompt and try again.':
    '登录身份已变更，请关闭此窗口后重试。',
  'Confirm your current password before continuing. If you use two-factor authentication, enter a fresh code too.':
    '继续操作前，请确认当前密码。如已开启双因素认证，还需输入新的验证码。',
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
