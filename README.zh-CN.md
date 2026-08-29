<p align="center">
  <a href="https://www.waveterm.dev">
    <picture>
        <source media="(prefers-color-scheme: dark)" srcset="./assets/wave-dark.png">
        <source media="(prefers-color-scheme: light)" srcset="./assets/wave-light.png">
        <img alt="Wave Terminal Logo" src="./assets/wave-light.png" width="240">
    </picture>
  </a>
  <br/>
</p>

# Wave Terminal

<div align="center">

[English](README.md) | [简体中文](README.zh-CN.md) | [한국어](README.ko.md) | [繁體中文](README.zh-TW.md)

</div>

[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2Fwavetermdev%2Fwaveterm.svg?type=shield)](https://app.fossa.com/projects/git%2Bgithub.com%2Fwavetermdev%2Fwaveterm?ref=badge_shield)

Wave Terminal 是一款开源、集成 AI 的终端应用，支持 macOS、Linux 和 Windows。它兼容多种 AI 模型：你可以使用自己的 OpenAI、Claude 或 Gemini API 密钥，也可以通过 Ollama、LM Studio 等工具运行本地模型，无需注册账号。

Wave 还支持可持久化的 SSH 会话，即使网络中断或 Wave 重启，会话也能自动恢复。你可以直接使用内置图形化编辑器编辑远程文件，并在终端中预览文件，而无需切换到其他应用。

![Wave Terminal 截图](./assets/wave-screenshot.webp)

## 主要功能

- **Wave AI**：理解上下文的终端助手，可以读取终端输出、分析组件并执行文件操作
- **持久化 SSH 会话**：网络中断、切换网络或重启 Wave 后，远程终端会话仍可自动恢复
- **灵活的拖放界面**：自由排列终端、编辑器、网页、文件预览和 AI 助手等区块
- **内置代码编辑器**：直接编辑本地或远程文件，支持语法高亮和现代编辑功能
- **丰富的文件预览**：支持 Markdown、图片、视频、PDF、CSV 和目录等内容
- **区块全屏显示**：一键放大终端、编辑器或预览区块，完成后立即返回多区块布局
- **AI 聊天组件**：支持 OpenAI、Claude、Azure、Perplexity、Ollama 等多种模型
- **命令区块**：隔离并监控单条命令及其输出
- **一键远程连接**：完整访问远程终端和文件系统
- **安全的密钥存储**：使用操作系统原生安全存储保存 API 密钥和凭据
- **丰富的个性化设置**：支持标签页主题、终端样式和背景图片
- **强大的 `wsh` 命令系统**：通过命令行管理工作区，并在终端会话之间共享数据
- **连接文件管理**：使用 `wsh file` 在本地和远程 SSH 主机之间复制、同步文件

## Wave AI

Wave AI 是理解终端上下文的助手，可以结合你的工作区帮助定位问题：

- **终端上下文**：读取终端输出和滚动缓冲区，用于调试和分析
- **文件操作**：读取、写入和编辑文件，并提供自动备份和用户确认
- **命令行集成**：使用 `wsh ai` 将终端输出传递给 AI，或直接附加文件
- **自带密钥（BYOK）**：支持 OpenAI、Claude、Gemini、Azure 等服务商
- **本地模型**：通过 Ollama、LM Studio 和其他兼容 OpenAI API 的服务运行本地模型
- **免费 Beta**：产品完善期间提供免费的 AI 使用额度
- **即将推出**：需要用户确认的命令执行能力

详细信息请参阅 [Wave AI 文档](https://docs.waveterm.dev/waveai) 和 [Wave AI 模式文档](https://docs.waveterm.dev/waveai-modes)。

Wave 的应用界面默认使用简体中文。你可以在 **设置 → 常规 → 界面语言** 中切换为 English，或选择跟随系统语言。界面语言设置不会翻译终端输出、文件内容、命令或 AI 回答。

## 安装

Wave Terminal 支持 macOS、Linux 和 Windows。

各平台的安装说明请参阅[入门文档](https://docs.waveterm.dev/gettingstarted)。你也可以直接从[官方下载页面](https://www.waveterm.dev/download)下载安装包。

### 最低系统要求

Wave Terminal 支持以下平台：

- macOS 11 或更高版本（arm64、x64）
- Windows 10 1809 或更高版本（x64）
- 基于 glibc-2.28 或更高版本的 Linux，例如 Debian 10、RHEL 8、Ubuntu 20.04（arm64、x64）

WSH 辅助程序支持以下平台：

- macOS 11 或更高版本（arm64、x64）
- Windows 10 或更高版本（x64）
- Linux Kernel 2.6.32 或更高版本（x64），Linux Kernel 3.1 或更高版本（arm64）

## 路线图

Wave 会持续改进，项目路线图会随着版本更新。请查看[路线图](./ROADMAP.md)。

欢迎通过 [Discord](https://discord.gg/XfvZ334gwU) 参与讨论，或提交[功能请求](https://github.com/wavetermdev/waveterm/issues/new/choose)。

## 相关链接

- 官网 — https://www.waveterm.dev
- 下载 — https://www.waveterm.dev/download
- 文档 — https://docs.waveterm.dev
- X — https://x.com/wavetermdev
- Discord 社区 — https://discord.gg/XfvZ334gwU

## 从源码构建

请参阅[构建 Wave Terminal](BUILD.md)。

## 参与贡献

Wave 使用 GitHub Issues 跟踪问题。

更多信息请参阅[贡献指南](CONTRIBUTING.md)，其中包括：

- [贡献方式](CONTRIBUTING.md#contributing-to-wave-terminal)
- [开始贡献前须知](CONTRIBUTING.md#before-you-start)

### 赞助 Wave ❤️

如果 Wave Terminal 对你或你的团队有帮助，欢迎赞助项目开发。赞助可以支持项目的持续开发和维护。

- https://github.com/sponsors/wavetermdev

## 许可证

Wave Terminal 使用 Apache-2.0 许可证。依赖项信息请参阅[致谢](./ACKNOWLEDGEMENTS.md)。
