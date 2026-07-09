# 09 Artifact & Asset System 产物与资产系统

## 1. 核心职责

管理真实产物和资产，让交付物成为可追溯、可下载、可验证的事实对象。

## 2. 核心对象

```text
Artifact
ArtifactVersion
AssetFile
ArtifactMetadata
SourceReference
QualityStatus
DownloadLink
DeliveryPackage
```

## 3. 设计要点

- Artifact 是事实，不是聊天消息附件。
- 真实文件必须记录 bytes、hash、格式、生成来源和质量状态。
- 文本草稿、设计稿、真实文件、最终包应区分类型。
- 下载入口只能指向真实存在且通过基础校验的文件。

## 4. 参考机制

- 内容管理系统的 asset/version 模型。
- 构建产物 metadata。
- 数据血缘 lineage。

## 5. 适配问题

- 业务最终交付物有哪些格式？
- 哪些产物只是草稿，哪些是真实文件？
- 产物之间如何引用和继承？
