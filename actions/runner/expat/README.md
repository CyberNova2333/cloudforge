# Runner 的 Expat 构建

Debian trixie 的系统 Python 和 `git-http-push` 使用 `libexpat1`。这里将 Debian 发布的 Expat 源码和打包文件固定在 `sources.json`，在 trixie 内构建带 `+cloudforge1` 后缀的 Debian 包。构建不引入其他发行版的二进制包；运行镜像通过 `dpkg -i` 安装，保留包管理元数据、Debian changelog、上游与打包许可。

这是临时维护的源码重建路径。更新时先核对 [Debian 状态](https://security-tracker.debian.org/tracker/source-package/expat) 和 [上游发布](https://github.com/libexpat/libexpat/releases)，重新取得固定源文件的 SHA256，再构建与扫描完整 runner。当 trixie 提供等效或更新的安全版本时，应评估回到发行版包，避免长期维护重复产物。包号和真实库版本分别校验，不能只提高包版本或隐藏扫描元数据。

## 构建契约

构建阶段使用与 runner 相同发行版、目标架构的基础镜像。APT 只配置 trixie 与 trixie-security，所需直接依赖为 `build-essential debhelper-compat docbook-to-man docbook2x ca-certificates curl xz-utils python3 libexpat1`。APT 网络下载应保留有限重试。构建脚本自身不添加源、不安装 sid 二进制。

将本目录复制到构建阶段，运行 `sh /path/to/expat/build.sh`。脚本下载并校验 DSC、上游源码和 Debian 打包文件，然后运行 `dpkg-buildpackage`。SHA256 来自经 HTTPS 读取的 Debian DSC，并在锁文件内独立固定；本路径不宣称额外验证了上传者的 OpenPGP 签名。

产物为 `/out/libexpat1.deb`、`/out/libexpat1-dev.deb` 与 `/out/provenance/`。最终镜像先完成常规 APT 更新，再 `dpkg -i /tmp/libexpat1.deb /tmp/libexpat1-dev.deb`，移除临时安装文件，并保留 provenance 目录（建议 `/usr/local/share/cloudforge/expat/`）。开发包精确依赖同版本运行库，必须配套安装；否则后续工作流安装 `libexpat1-dev` 时会遇到发行版开发包与定制运行库版本冲突。两包分别检查版本、架构并保留 control 与 SHA256。只复制这些产物；文档构建工具和编译工作目录留在构建阶段。

## 验证范围

构建会执行普通字符构型的上游测试，检查两个共享库的 SONAME 与旧导出符号，安装生成的包，再验证 Python 的实际 Expat 版本及 XML 解析。Debian 的 UTF-16 库使用 `unsigned short`；上游测试框架明确不支持这一构型，因此单独的 `utf16-smoke.c` 对实际安装的 `libexpatw.so.1` 验证字符宽度、版本和非 ASCII 元素回调。该验证不等同于完整 UTF-16 上游测试套件。

最终 runner 仍需执行镜像功能 smoke 和重新扫描。当前实际验证范围是 Cloudflare runner 使用的 Linux amd64；源码可按本机目标架构构建不表示其他平台已验收。
