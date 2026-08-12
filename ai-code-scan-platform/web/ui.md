# 企业级 Web 管理平台 UI 设计规范提示词

请将整个 Web 管理平台设计为**成熟、克制、专业、可信赖的企业级后台管理系统风格**。

整体视觉可以参考 Gartner、国际咨询公司、大型上市集团、金融机构、云厂商和企业内部数字化管理平台的设计语言，但不要直接复制任何具体产品。

设计目标不是追求视觉冲击，而是强调：

* 专业
* 稳定
* 清晰
* 克制
* 高信息密度
* 易于长期使用
* 适合企业正式生产环境
* 适合管理层、技术人员、安全人员共同使用

---

## 一、整体设计方向

采用现代 Enterprise SaaS / Enterprise Admin Console 风格。

整体界面应给人一种：

> 冷静、理性、可靠、秩序感强、信息结构清晰。

避免互联网营销网站、AI 创业公司 Landing Page、Web3、赛博朋克、游戏后台等视觉风格。

不要为了体现“科技感”而大量使用：

* 霓虹色
* 渐变色
* 发光效果
* 半透明玻璃效果
* 大面积黑色背景
* 紫色 AI 风格
* 高饱和蓝色
* 巨型数字
* 超大标题
* 夸张插画
* 3D 图形
* 动态光效

科技感主要通过：

* 清晰的信息架构
* 精确的数据展示
* 规则化布局
* 专业图表
* 细致的状态设计
* 稳定的交互体验

体现。

---

# 二、配色原则

整体采用：

**浅灰 + 白色 + 深灰蓝 + 低饱和蓝色**

作为主要视觉体系。

推荐视觉基调：

背景：

* 页面背景：#F5F6F8 / #F7F8FA
* 内容区域：#FFFFFF
* 次级区域：#F9FAFB

主文字：

* 一级文字：#1F2937
* 二级文字：#4B5563
* 辅助文字：#6B7280
* 禁用文字：#9CA3AF

边框：

* #E5E7EB
* #E8EAED

主品牌色：

优先选择低饱和、偏深的蓝色，例如：

* #315B7D
* #365F7D
* #3B6482
* #426B89

主色不要过亮，不使用高饱和 Electric Blue。

按钮 Hover 可以略微加深。

---

## 状态色

状态颜色同样保持克制。

成功：

* 深绿色
* 例如 #3F7D5A

警告：

* 棕黄色 / Amber
* 例如 #A87524

危险：

* 暗红色
* 例如 #B45151

信息：

* 灰蓝色
* 例如 #52799A

不要使用：

* 荧光绿
* 鲜红
* 高饱和橙色
* 紫红渐变

状态颜色主要用于：

* Tag
* Badge
* 小图标
* 状态点
* 边框

避免整块背景使用高饱和状态色。

---

# 三、整体页面布局

采用标准企业后台布局：

左侧 Sidebar

*

顶部 Header

*

主内容 Content

结构。

Sidebar 宽度保持合理，约 220–250px。

顶部 Header 高度约 56–64px。

页面内容区域设置合理最大宽度，并保证充分留白。

不要做过度复杂的多栏布局。

---

# 四、Sidebar 设计

Sidebar 应简洁、稳定。

可以采用：

白色 / 极浅灰色 Sidebar

或者

低饱和深蓝灰 Sidebar。

推荐优先使用：

浅色 Sidebar。

导航层级最多控制在 2–3 层。

一级菜单：

图标 + 文本。

例如：

Dashboard

项目管理

扫描任务

漏洞管理

报告中心

模型管理

Credit 管理

通知配置

成员管理

系统设置

菜单选中状态不要使用巨大色块。

推荐：

浅蓝灰背景

*

左侧 2–3px 主色指示条

或者

低饱和蓝灰色文字高亮。

图标采用：

简单 Outline Icon。

不要使用彩色图标。

---

# 五、Dashboard 设计

Dashboard 不要设计成数据大屏。

不要：

* 大面积深色背景
* 超大 KPI 数字
* 五颜六色的数据卡片
* 大量环形图
* 复杂视觉装饰

应该设计为标准企业经营 / 运营 Dashboard。

推荐布局：

第一行：

4 个核心指标卡片。

例如：

总扫描任务

扫描代码量

发现漏洞数

剩余 Credit

卡片背景统一白色。

数字使用：

24–32px。

不要使用 50px 以上超大数字。

可以增加：

同比 / 环比

趋势箭头

辅助说明。

第二行：

趋势图

*

扫描类型分布。

第三行：

最近扫描任务

或者

风险项目排名。

Dashboard 信息组织参考：

咨询公司数据报告

*

企业 BI Dashboard

*

SaaS 管理后台。

---

# 六、卡片 Card

所有 Card 保持统一。

建议：

白色背景

1px 浅灰边框

4–8px 圆角

非常轻微 Shadow

或者完全无 Shadow。

不要使用：

16px / 24px 超大圆角。

不要所有元素都设计成悬浮卡片。

企业后台应该保持：

平面化

结构化

层级清晰。

---

# 七、表格 Table

表格是平台最重要的组件之一。

设计重点：

高信息密度

清晰

方便扫描信息。

表头：

浅灰背景

文字 13–14px

中等字重。

表格行高：

44–52px。

支持：

排序

筛选

搜索

分页

列配置

批量操作。

状态使用小型 Badge。

操作栏推荐：

查看

编辑

更多

避免每一行放大量按钮。

如果操作较多：

使用：

···

More Menu。

---

# 八、表单 Form

表单应采用标准企业软件风格。

Label 放置于输入框上方。

Input 高度：

36–40px。

不要使用过高输入框。

表单内容按照业务逻辑分组。

复杂表单使用：

Section

Divider

Card

进行分组。

例如：

基本信息

扫描配置

模型配置

通知配置

费用配置

高级选项。

高级配置默认折叠。

避免一次展示几十个输入项。

---

# 九、按钮 Button

按钮分级必须明确。

Primary：

低饱和蓝色背景。

Secondary：

白色背景 + 灰色边框。

Danger：

白底红字

或者暗红背景。

避免一个页面出现多个 Primary Button。

一个页面通常只有一个核心操作：

例如：

创建扫描任务

创建项目

保存配置。

其他操作使用 Secondary。

---

# 十、字体与文字

整体字体采用：

Inter

Roboto

Arial

PingFang SC

Microsoft YaHei

等现代无衬线字体。

中文后台建议：

PingFang SC

*

Inter。

字号体系：

页面标题：20–24px

模块标题：16–18px

正文：14px

辅助信息：12–13px

表格：13–14px

不要使用：

32px+

巨大标题。

页面顶部标题应该非常克制。

例如：

扫描任务

查看和管理所有代码扫描任务。

而不是：

Welcome Back!

Start Your AI Security Journey.

平台属于企业管理软件，不是营销网站。

---

# 十一、图标

图标风格：

Outline

单色

线条简洁。

推荐类似：

Lucide

Feather

Heroicons

Material Symbols Rounded。

不要使用：

emoji

彩色 Icon

3D Icon

复杂 Illustration。

---

# 十二、数据可视化

图表设计参考：

Gartner 报告

咨询公司研究报告

企业 BI 工具。

配色控制在：

3–5 种颜色以内。

推荐：

深蓝

灰蓝

浅蓝

灰色

少量状态色。

避免 Rainbow Chart。

图表背景保持白色。

Grid Line 使用浅灰。

Tooltip 简洁。

图表应该帮助用户理解数据，而不是成为视觉装饰。

---

# 十三、风险等级设计

例如：

Critical

High

Medium

Low

Info

不要直接用大面积：

红

橙

黄

绿

蓝

填满整块区域。

推荐使用：

小 Badge

左侧色条

状态圆点。

例如：

● Critical

● High

● Medium

颜色只作为辅助信息，不作为主要视觉元素。

---

# 十四、Modal / Drawer

简单操作使用 Modal。

复杂详情优先使用：

Right Drawer。

例如：

扫描任务详情

漏洞详情

用户详情

Credit 消耗详情。

Drawer 可以保留用户当前页面上下文。

复杂详情页面则进入独立 Detail Page。

---

# 十五、详情页面

详情页推荐结构：

页面标题

状态

核心操作按钮

↓

概要信息

↓

Tabs

例如扫描任务：

Overview

Findings

Logs

Report

Configuration

Activity

避免所有内容堆积在一个页面。

---

# 十六、状态与反馈

必须完整设计以下状态：

Loading

Empty

Error

Success

Disabled

Processing

Queued

Running

Completed

Failed

Cancelled

不要只有正常状态页面。

例如任务执行：

Queued

Running

Completed

Failed

应该具有非常清晰的状态识别。

---

# 十七、交互动效

动画必须非常轻。

推荐：

150–200ms。

只用于：

Hover

Dropdown

Drawer

Modal

Tabs。

不要设计：

页面飞入

复杂 transition

炫酷 loading

粒子动画。

---

# 十八、页面密度

整体采用：

Medium Density。

不能过于宽松，也不能像数据库管理器一样拥挤。

企业后台重点是：

一屏看到更多有效信息。

页面左右 Padding 推荐：

24–32px。

模块间距：

16–24px。

---

# 十九、企业软件视觉原则

整个系统始终遵循：

Clarity > Decoration

Consistency > Creativity

Information > Visual Impact

Usability > Animation

Professional > Trendy

长期使用体验 > 第一眼视觉冲击。

---

# 二十、避免以下常见 AI 生成 UI 风格

尤其不要生成目前 AI Coding Agent 非常常见的模板化页面：

❌ 紫色渐变背景

❌ 蓝紫色发光按钮

❌ AI 星星 Icon

❌ 巨型圆角 Card

❌ 每张 Card 不同颜色

❌ 赛博朋克 Dashboard

❌ 深色科技大屏

❌ Glassmorphism

❌ Neon Glow

❌ 复杂渐变

❌ 超大 Hero Banner

❌ Floating Elements

❌ 大量装饰性图形

❌ Landing Page 风格后台

❌ Apple 官网风格

❌ Web3 风格

❌ 游戏 Dashboard 风格

---

# 二十一、参考视觉方向

设计风格可以理解为：

Gartner Research Portal

*

McKinsey / Deloitte / PwC 企业数字化系统

*

大型上市集团内部管理平台

*

AWS / Azure / Google Cloud Enterprise Console

*

成熟 B2B SaaS 后台。

不是完全复制，而是参考其：

信息层级

专业程度

视觉克制程度

企业软件感。

---

# 二十二、最终视觉关键词

Enterprise

Professional

Calm

Neutral

Minimal

Structured

Data-driven

Information-dense

Low Saturation

Corporate

Consulting Style

Security Platform

Enterprise SaaS

Management Console

---

最终生成的所有页面都必须保持统一设计系统。

不要每个页面使用不同视觉风格。

所有：

颜色

边框

圆角

字体

按钮

Table

Form

Tag

Modal

Drawer

Spacing

必须遵循统一 Design System。

整个产品最终应该看起来像一套已经在大型企业内部运行多年、经过成熟迭代的正式生产系统，而不是一个刚生成出来的 AI Demo。
