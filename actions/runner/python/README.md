<!-- Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt). -->

# Runner 的 Python 包管理工具

`sources.json` 固定 PyPI wheel、上游版本、来源及 SHA256。`rebuild-pip.py` 在离线环境中将 pip 的 urllib3 更新为指定版本，保留其余 vendored 库。产物版本为 `26.2.2+cloudforge.1`，以区分官方 pip wheel。

脚本使用 Python 标准库和 `git apply`：先验证输入和补丁的 SHA256，再保留 pip 的 urllib3 补丁与命名空间变换，更新包版本、`vendor.txt`、CycloneDX 组件及引用，最后重建 wheel 的 `RECORD`。输出内保留两处 urllib3 许可证、vendoring 的 MIT 许可、来源声明和原始补丁；其他组件的声明保持原样。ZIP 条目按路径排序、固定时间和权限。

三个 `upstream-patches/` 文件原样取自 [pip 26.2.2 的 vendoring 补丁](https://github.com/pypa/pip/tree/26.2.2/tools/vendoring/patches)。导入变换依据 [vendoring 1.4.0](https://github.com/pradyunsg/vendoring/blob/1.4.0/src/vendoring/tasks/vendor.py)，许可证见 `vendoring-LICENSE`。这些处理遵循 [pip vendoring 约定](https://pip.pypa.io/en/stable/development/vendoring-policy/)。

将已下载的两个 wheel 放到输入目录后执行：

```sh
python3 rebuild-pip.py --inputs /tmp/python-wheels --output /tmp/python-wheels
```

镜像构建通过官方 pip wheel 引导安装定制 wheel。不要仅修改元数据，也不要删除仍随 pip 分发的组件记录。更新版本时同步锁定来源和补丁，并重新运行 runner 的离线功能 smoke；这不等于云容器端到端验证。
