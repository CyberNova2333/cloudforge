<!-- Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt). -->

# Runner 的 Python 包管理工具

`sources.json` 固定官方 pip 26.3 wheel、来源及 SHA256。镜像直接安装经过校验的上游 wheel，保留其原始包版本、`vendor.txt`、CycloneDX SBOM、许可证及 `RECORD`。

pip 26.3 已包含 urllib3 2.8.0 和 msgpack 1.2.4，旧版下游重打包器及其补丁已退出构建。版本与上游更新依据见 [pip 发布记录](https://pip.pypa.io/en/stable/news/#v26-3) 和 [固定版本的 PyPI 元数据](https://pypi.org/pypi/pip/26.3/json)。

上游仍为兼容代码分发来自 setuptools 70.3.0 的 `pkg_resources`，相关组件记录保持原样。不要将其标成未实际安装的新版本，也不要删除元数据以消除扫描结果。运行时是否受影响，需要核对具体文件、平台和调用路径；保留原始扫描证据。

升级时同步 Dockerfile 的下载地址、校验值和安装版本，并检查 wheel 的全部 `RECORD` 项、内嵌组件和许可证。最终 runner 的离线 smoke 覆盖 pip 的安装及构建行为；这些本地验证不等于云容器端到端验收。
