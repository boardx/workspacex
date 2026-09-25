# Board 基础画布与视觉编辑体验 PRD V0.1

**产品模块：** Board / Visual Workspace
**版本：** V0.1
**定位：** 面向个人与团队的无限画布，用最低操作成本完成“想法 → 组织 → 连接 → 结构化 → 协作 → AI 处理”。

---

# 1. 产品目标

Board 的基础体验应达到：

> **打开 Board 后，用户不需要学习工具，就可以像在桌面上摆便利贴一样开始思考。**

Board 不应只是一个绘图工具，而应成为 WorkspaceX 中人与人、人与 AI 共同工作的**视觉工作空间**。

基础编辑体验参考 Mural 的低摩擦交互，但 Board 的长期区别在于：

1. 每个对象都不仅是图形，也是未来可被 AI 理解和操作的数据对象。
2. Board 上的空间关系本身具有语义。
3. Panel、Tile、Sticky、Shape、Arrow 可以形成结构化 Context。
4. AI 可以读取、生成、重新排版、聚类和修改 Board。
5. Board 是 Human + Agent 的共享工作表面，而不仅是 Canvas。

---

# 2. 核心设计原则

## 2.1 Create first, configure later

用户首先“放东西”，而不是先配置。

例如：

- 双击空白区域 → Sticky
- 输入文字 → 自动适应尺寸
- 拖入图片 → 直接显示
- 从对象拖出连接点 → 自动生成 Arrow
- 框选多个对象 → 自动出现排版工具

不要要求用户先选择大量参数。

---

## 2.2 Direct Manipulation

尽可能直接操作对象：

**单击 = 选择**
**双击 = 编辑**
**拖动 = 移动**
**拖边框 = Resize**
**拖连接点 = Connect**
**拖空白区域 = Pan / Select**

避免频繁打开复杂属性窗口。

---

# 3. Board 基础结构

Board 可以理解为：

```text
Board
│
├── Canvas
│
├── Panel
│   ├── Sticky
│   ├── Text
│   ├── Tile
│   ├── Shape
│   ├── Image
│   ├── Drawing
│   └── Nested content
│
├── Arrow / Connector
│
└── Collaboration Layer
    ├── Cursor
    ├── Selection
    ├── Comment
    ├── Presence
    └── AI Agent
```

其中：

**Canvas = 空间**

**Panel = 区域 / 容器**

**Object = 内容**

**Arrow = 关系**

**Layout = 组织方式**

---

# 4. Canvas 无限画布

## 4.1 基础能力

Canvas 支持：

- Infinite Canvas
- Mouse / Trackpad
- Pan
- Zoom
- Fit selection
- Fit Board
- Mini Map
- Grid
- Snap
- Guidelines
- Multi-selection
- Copy / Paste
- Undo / Redo

Zoom 建议范围：

**5%–800%**

---

# 5. 左侧工具栏

默认工具栏：

```text
Select
Hand

Sticky
Text
Tile

Panel
Shape
Arrow

Draw
Image

More +
```

原则：

高频功能永远在一级菜单。

低频功能进入 `More`。

---

# 6. Sticky / 便利贴

Sticky 是 Board 最重要的基础思考对象。

Mural 当前支持双击 Canvas 快速生成便利贴，并可以使用 Tab 快速继续添加便利贴；这种“连续输入”应成为 Board 的核心体验。

## 6.1 创建

支持四种方式。

### A. 双击 Canvas

```text
Double Click
↓
Create Sticky
↓
Cursor directly inside
↓
Start typing
```

这是默认最快路径。

### B. 工具栏

点击 Sticky：

```text
Sticky
├── Square
├── Rectangle
└── Circle
```

然后点击 Canvas 创建。

### C. 拖放

从 Toolbar 将 Sticky 拖入 Canvas。

### D. 快捷键

建议：

**N = Sticky Note**

---

# 7. Sticky 连续创建

用户正在编辑一个 Sticky 时：

按：

**Tab**

创建下一个 Sticky。

系统根据当前排列方向智能判断：

```text
Sticky 1 → Sticky 2 → Sticky 3
```

默认间距：

24px。

如果附近已经形成纵向排列：

```text
Sticky 1
↓
Sticky 2
↓
Sticky 3
```

则继续纵向生成。

这是一个非常重要的低摩擦 Brainstorming 能力。

---

# 8. Sticky 属性

选择 Sticky 后出现 Floating Toolbar。

包括：

```text
Color
Text Style
Font Size
Alignment
Tag
Link
Comment
Duplicate
AI
...
```

颜色建议默认提供：

- Yellow
- Pink
- Blue
- Green
- Purple
- Orange
- Gray
- White

并支持：

Custom Color。

---

# 9. Sticky Resize

默认 Sticky 保持相对规则的比例。

Resize 时支持：

### Normal Resize

拖动四角：

保持比例。

### Free Resize

按住：

Shift / Modifier

允许自由改变长宽比。

### Auto Height

文字过多：

Sticky 自动增加高度。

也允许：

```text
Fixed Size
Auto Size
```

两种模式。

---

# 10. Text

Text 用于：

- 标题
- 描述
- 注释
- 大段文字
- Board 说明

创建方式：

**T**

或者：

Toolbar → Text。

点击 Canvas 后直接输入。

---

# 11. Text 类型

快速 Style：

```text
Title
Heading
Subheading
Body
Caption
```

用户仍然可以手动设置：

- Font
- Font Size
- Bold
- Italic
- Underline
- Color
- Alignment
- Line Height
- List
- Link

---

# 12. Tile

Tile 是 Board 区别于传统白板的重要对象。

Sticky 用于：

> Idea

Tile 用于：

> Information / Artifact / Work Unit

Tile 是一种结构化 Card。

例如：

```text
┌────────────────────┐
│ Customer Interview │
│                    │
│ Grace Chen         │
│ Sep 23             │
│                    │
│ User Research      │
└────────────────────┘
```

---

# 13. Tile 基础结构

Tile 数据模型：

```text
Tile
├── Type
├── Title
├── Description
├── Icon
├── Cover
├── Metadata
├── Tags
├── Link
├── Status
└── Actions
```

未来 Tile 可以扩展成为：

- Document Tile
- Web Tile
- Task Tile
- Agent Tile
- File Tile
- Data Tile
- Person Tile
- Project Tile
- Prompt Tile
- AI Result Tile

因此建议底层从第一版就把 Tile 做成：

**Structured Object**

而不是纯视觉 Rectangle。

---

# 14. Panel

Panel 是一组内容的空间容器。

概念类似：

Frame + Area + Section。

Mural 的 Area 已经区分 Freeform 和 Grid，其中 Grid Area 会对对象进行自动吸附并随着内容增减调整区域大小。Board 可以借鉴这一思路，但把 Panel 做成更核心的结构对象。

Panel：

```text
┌──────────────────────────────────┐
│ Customer Journey                 │
│                                  │
│  Sticky   Sticky   Sticky        │
│                                  │
│  Tile     Tile     Tile          │
│                                  │
└──────────────────────────────────┘
```

---

# 15. Panel Mode

Panel 提供三种模式。

### Freeform

Panel 内对象自由排列。

适合：

- Brainstorm
- Mapping
- Workshop

### Grid

自动排列：

```text
□ □ □
□ □ □
□ □ □
```

适合：

- Sticky clustering
- Card wall
- Research findings

### Flow

按照方向自动排列：

```text
A → B → C → D
```

或：

```text
A
↓
B
↓
C
```

适合：

- Workflow
- Journey
- Process

---

# 16. Panel 智能容器行为

对象拖入 Panel：

Panel 高亮。

释放：

```text
Object.parentId = panelId
```

随后：

- Panel 移动 → 内容一起移动
- Panel Resize → 内容不强制缩放
- 删除 Panel → 询问是否保留内容
- Copy Panel → Copy 所有子对象

Panel 自动扩展：

当内容超出边界：

```text
Auto Expand
```

用户也可以关闭：

```text
Clip Content
```

---

# 17. Shape

第一阶段支持：

```text
Rectangle
Rounded Rectangle
Circle
Ellipse
Diamond
Triangle
Hexagon
Cloud
Database
Document
```

以及：

Flowchart 常见 Shapes。

---

# 18. Shape 属性

Floating Toolbar：

```text
Fill
Border Color
Border Width
Border Style
Opacity
Radius
Text
Text Color
Arrow
AI
```

双击 Shape：

直接输入文字。

Shape 内文字默认：

水平 + 垂直居中。

---

# 19. Arrow / Connector

Connector 不应该只是 Line。

它表达：

> Object A 与 Object B 的关系。

Mural 的 Connector 可以吸附到对象边缘，并在对象移动时保持连接；Board 应将这个行为作为最低标准。

---

# 20. Arrow 创建

方式一：

Toolbar → Arrow。

方式二：

鼠标 Hover Object：

显示四个 Connection Handle：

```text
       ○
       │
○ ─── Object ─── ○
       │
       ○
```

拖动：

```text
Object A
   ○──────→ Object B
```

自动吸附。

---

# 21. Connector 类型

支持：

```text
Straight
Elbow
Curve
```

Arrow Tip：

```text
None
→
●
◇
```

Line：

```text
Solid
Dashed
Dotted
```

---

# 22. Connector Attachment

连接到对象后：

移动 Object：

Connector 自动更新。

```text
A ─────→ B
```

移动 B：

```text
A
 \
  \
   → B
```

连接关系不能丢失。

---

# 23. Connector Label

双击 Connector：

创建 Label：

```text
User
  │
  │ needs
  ▼
Product
```

未来关系可以直接转为 Knowledge Graph Edge：

```text
User
-[needs]->
Product
```

---

# 24. Draw

提供自由绘制：

```text
Pen
Marker
Highlighter
Eraser
```

属性：

- Color
- Width
- Opacity

支持 Apple Pencil / Stylus Pressure。

---

# 25. Drawing Object

一次连续笔画：

一个 Stroke。

多个 Stroke 可以：

- Select
- Move
- Resize
- Group
- Delete

不应该把 Draw 直接变成 Background Bitmap。

必须保持 Vector。

推荐存储：

```text
points[]
pressure[]
color
width
```

---

# 26. Image

支持：

### Upload

```text
Toolbar → Image
```

支持：

- JPG
- PNG
- WEBP
- GIF
- SVG

### Drag & Drop

文件直接拖入 Board。

### Paste

Cmd/Ctrl + V。

### Clipboard Image

截图之后：

Cmd/Ctrl + V。

立即生成 Image Object。

---

# 27. Image Editing

第一阶段：

```text
Resize
Crop
Rotate
Opacity
Border
Corner Radius
Replace
Download
```

后续：

```text
Remove Background
OCR
AI Describe
AI Edit
Generate Variant
```

---

# 28. Selection

这是决定 Board 是否“顺手”的核心。

单击：

选择一个 Object。

Shift + Click：

增加 / 删除 Selection。

拖 Canvas：

Marquee Selection。

---

# 29. Multi Selection Toolbar

框选两个以上对象后：

显示：

```text
Align
Distribute
Layout
Group
Lock
Color
Duplicate
Delete
AI
```

---

# 30. Visual Layout

这是 V0.1 的重要能力。

Mural 已提供将 Sticky 自动整理成 grid/table 的能力，Board 应进一步把它统一成 Layout Engine。

选中多个对象：

点击：

**Layout**

出现：

```text
Grid
Row
Column
Cluster
Mind Map
Flow
Timeline
```

---

# 31. Grid Layout

例如选择 12 个 Sticky：

Before：

```text
 □
       □
   □
             □
 □
        □
```

点击：

**Grid**

After：

```text
□ □ □ □
□ □ □ □
□ □ □ □
```

参数：

```text
Columns
Horizontal Gap
Vertical Gap
```

---

# 32. Row / Column

Row：

```text
□ □ □ □ □
```

Column：

```text
□
□
□
□
□
```

自动保持对象尺寸。

---

# 33. Align

支持：

```text
Align Left
Align Center
Align Right

Align Top
Align Middle
Align Bottom
```

当移动一个 Object 时显示 Smart Guide。

例如：

```text
    │
[A] │ [B]
    │
```

并显示间距提示：

```text
24
```

---

# 34. Distribute

多个对象：

```text
Distribute Horizontally
Distribute Vertically
```

还应支持：

**Tidy Up**

自动：

- Align
- Equal spacing
- Preserve order

这是非常高频的操作。

---

# 35. Smart Layout

区别于传统白板，可进一步提供：

**Smart Layout**

用户框选内容：

```text
15 Sticky
3 Images
2 Tiles
```

点击：

**Organize**

Board 根据内容类型自动建议：

```text
Cards
Cluster
Grid
Journey
Mind Map
Timeline
```

这将成为后续 AI Layout 的入口。

---

# 36. AI Organize

后续 P1：

用户选中 30 张 Sticky：

```text
AI → Organize
```

Agent：

1. 读取文字
2. 判断主题
3. Cluster
4. 给 Cluster 命名
5. 创建 Panel
6. 自动排版

例如：

```text
              Customer Problems

 Onboarding        Performance       Pricing
 ─────────         ─────────         ───────

 Sticky            Sticky            Sticky
 Sticky            Sticky            Sticky
 Sticky            Sticky
```

这里 AI 改变的不只是位置，也是在建立 Board 的语义结构。

---

# 37. Contextual Toolbar

不要让用户频繁寻找右侧属性面板。

Selection 后：

在对象附近显示 Floating Toolbar。

例如 Sticky：

```text
Color | Text | Tag | Link | Comment | AI | •••
```

Shape：

```text
Fill | Border | Text | Connect | AI | •••
```

Image：

```text
Crop | Replace | Border | AI | •••
```

---

# 38. Property Panel

复杂设置才进入右侧 Panel。

右侧：

```text
Properties

Position
X
Y
W
H

Appearance
Fill
Border
Opacity

Text

Layout

Metadata
```

原则：

**Floating Toolbar = 高频**

**Property Panel = 精确控制**

---

# 39. Drag & Drop

Board 应尽可能支持 Drag & Drop。

包括：

```text
File → Board
Image → Board
URL → Board
Tile → Panel
Sticky → Panel
Panel → Panel
```

URL 拖入：

自动生成 Web Tile。

---

# 40. Object Quick Duplicate

选择对象后：

Alt/Option + Drag：

Duplicate。

Cmd/Ctrl + D：

Duplicate。

复制时默认：

偏移 24px。

---

# 41. Keyboard Shortcut

第一版建议至少支持：

| 操作 | Shortcut |
|---|---|
| Select | V |
| Hand | H / Space |
| Sticky | N |
| Text | T |
| Shape | S |
| Connector | C |
| Draw | P |
| Image | I |
| Duplicate | Cmd/Ctrl + D |
| Group | Cmd/Ctrl + G |
| Undo | Cmd/Ctrl + Z |
| Redo | Cmd/Ctrl + Shift + Z |
| Copy | Cmd/Ctrl + C |
| Paste | Cmd/Ctrl + V |
| Delete | Delete |
| Select All | Cmd/Ctrl + A |
| Zoom In | + |
| Zoom Out | - |
| Fit | 1 |

快捷键提示应该显示在 Tooltip 中。

---

# 42. Layer

Board 对象拥有：

```text
zIndex
```

操作：

```text
Bring Forward
Bring to Front
Send Backward
Send to Back
```

---

# 43. Lock

对象：

```text
Lock
Unlock
```

锁定后：

不可 Move / Resize / Edit。

Panel 特别需要 Lock：

用于 Workshop Template。

---

# 44. Group

多个对象：

```text
Group
Ungroup
```

Group 与 Panel 不同：

**Group = 编辑关系**

**Panel = 语义和空间容器**

必须在底层数据模型中明确区分。

---

# 45. Comment

任何对象都可以添加 Comment。

显示 Comment Bubble。

支持：

```text
Comment
Reply
Mention
Resolve
```

Comment 与对象绑定：

Object 移动，Comment 跟随。

---

# 46. 多人协作

实时显示：

```text
Cursor
Avatar
Selection
Object editing state
```

例如：

```text
┌───────────────┐
│ Sticky        │ ← Grace
└───────────────┘
```

正在被其他人编辑：

显示 Contributor Color Border。

---

# 47. Undo / Redo

所有 Board Operation 应支持 Undo。

包括：

```text
Create
Delete
Move
Resize
Text edit
Style
Group
Layout
Connect
Upload
AI Operation
```

尤其：

AI Layout 必须一次 Undo 可以整体撤销。

---

# 48. Paste Intelligence

复制一组文本：

```text
Research
Design
Prototype
Test
Launch
```

Paste 到 Board 时：

弹出轻量选项：

```text
Paste as Text
Create 5 Stickies
Create List
```

默认推荐：

**Create 5 Stickies**

这是非常重要的效率能力。

---

# 49. Bulk Sticky Creation

支持：

```text
Shift + N
```

打开：

```text
Create Multiple Stickies

[........................]
[........................]
[........................]

One line = one sticky
```

Paste：

100 行文字。

生成：

100 Sticky。

---

# 50. Object Data Model

建议所有对象采用统一基础接口：

```typescript
BoardObject {
  id
  boardId

  type

  x
  y
  width
  height
  rotation

  zIndex

  parentId

  locked
  hidden

  style

  content

  metadata

  createdBy
  createdAt
  updatedBy
  updatedAt
}
```

具体类型：

```text
sticky
text
tile
panel
shape
connector
drawing
image
```

---

# 51. Connector 独立模型

Connector：

```typescript
Connector {
  id

  fromObjectId
  fromAnchor

  toObjectId
  toAnchor

  type

  startStyle
  endStyle

  label

  semanticRelation
}
```

务必保留：

```text
semanticRelation
```

为未来 Knowledge Graph / Agent Context 做准备。

---

# 52. Board Event Model

所有操作同时产生 Event：

```text
ObjectCreated
ObjectMoved
ObjectResized
ObjectUpdated
ObjectDeleted

ObjectsGrouped
ObjectsArranged

ConnectorCreated

PanelCreated

AIOrganized
```

这对：

- Collaboration
- Undo
- Version
- Audit
- Agent
- Replay

都会非常重要。

---

# 53. Board + AI 的基础设计原则

第一版做 Board 时就应该保证：

Agent 可以调用与用户相同的一套 Operation。

例如：

```text
createSticky()
createTile()
createPanel()

moveObject()
resizeObject()

connectObjects()

groupObjects()

arrangeObjects()

updateText()

updateStyle()
```

即：

> **AI 不应该“画一张白板图片”，而应该真正操作 Board Objects。**

这样未来用户可以说：

> “把这些便利贴按照主题整理一下。”

Agent 实际执行：

```text
Read
→ Cluster
→ Create Panel
→ Move Objects
→ Arrange
→ Label
```

---

# 54. MVP Priority

## P0 — 必须完成

### Canvas

- Infinite Canvas
- Pan
- Zoom
- Selection
- Multi Selection
- Smart Guide

### Objects

- Sticky
- Text
- Tile
- Panel
- Shape
- Arrow
- Draw
- Image

### Editing

- Move
- Resize
- Rotate
- Copy
- Paste
- Duplicate
- Delete
- Undo / Redo

### Layout

- Align
- Distribute
- Grid
- Row
- Column
- Tidy Up

### Structure

- Group
- Panel
- Lock
- Layer

---

# 55. P1

增加：

- Comment
- Tag
- Reaction
- Mini Map
- Bulk Sticky
- Link Preview
- Web Tile
- Table
- Icon
- Template
- AI Organize
- AI Generate

---

# 56. P2

增加：

```text
Diagram
Mind Map
Kanban
Timeline
Journey Map

Database View

Agent Tile

Live Data Tile

Embedded App

Presentation Mode
```

---

# 57. 核心体验指标

Board 基础体验不要只看功能是否存在。

需要测量：

### TTFI — Time to First Idea

用户进入空白 Board 到创建第一个 Sticky：

**目标 < 5 秒**

---

### Continuous Ideation

创建第一张 Sticky 后连续创建 10 张：

**目标 < 30 秒**

---

### Organization

20 张散乱 Sticky → 整齐 Grid：

**≤ 2 次操作**

---

### Connection

两个 Object 建立 Arrow：

**≤ 2 次操作**

---

### Image

截图 → Board：

**1 次 Paste**

---

### AI Organization

30 Sticky → 主题聚类：

**≤ 2 次操作**

---

# 58. 最重要的 User Journey

典型用户进入 Board：

```text
Open Board
     ↓
Double Click
     ↓
Sticky
     ↓
Type Idea
     ↓
TAB
     ↓
More Stickies
     ↓
Select
     ↓
Organize
     ↓
Panel
     ↓
Connect
     ↓
Add Image / Tile
     ↓
AI Organize
     ↓
Structured Visual Knowledge
```

这就是整个 Board 基础体验的主干。

---

# 59. 最重要的产品判断

Board 不应该被设计成：

> “Fabric.js 上面放很多 Shape。”

而应该从产品模型上定义为：

> **A spatial object system for humans and AI.**

每个对象都有三个维度：

```text
Visual
+
Structural
+
Semantic
```

例如一张 Sticky：

```text
Visual
黄色便利贴

Structural
属于 Customer Problems Panel

Semantic
“用户不知道如何开始使用产品”
```

再例如 Arrow：

```text
Visual
A → B

Structural
连接两个 Object

Semantic
depends_on / causes / generates / belongs_to
```

这会让 Board 从 Mural/Miro 类型的传统白板进一步变成 WorkspaceX 的 **Human–AI Shared Workspace**。

---

# 60. V0.1 验收标准

第一版完成后，应可以无障碍完成以下测试：

### Test 01 — Brainstorm

用户：

1. 打开空白 Board
2. 双击
3. 输入想法
4. 连续 Tab
5. 创建 20 张便利贴

不需要打开任何菜单。

---

### Test 02 — Organize

用户框选 20 张便利贴：

```text
Layout → Grid
```

一键完成整齐排列。

---

### Test 03 — Panel

用户创建 Panel：

将 10 个对象拖入。

拖动 Panel：

所有内容一起移动。

---

### Test 04 — Diagram

创建：

```text
Shape A → Shape B → Shape C
```

移动任何 Shape：

Arrow 自动保持连接。

---

### Test 05 — Visual Research

用户：

```text
Paste Screenshot
+
Sticky
+
Text
+
Arrow
+
Tile
```

5 种内容可以自然混合排版。

---

### Test 06 — AI Ready

Agent 能通过 Board API：

```text
Create
Read
Update
Move
Arrange
Connect
Delete
```

任意 Board Object。

因此，从 V0.1 开始，Board 就不是一个与 AI 分离的 Canvas，而是一个真正可以被 Human 和 Agent 共同操作的空间。

这份可以直接作为 **Board 基础能力 V0.1 PRD**。我建议下一步再单独拆成两份工程文档：**① Board Object/Canvas 数据模型与 API Specification；② 逐工具 UX Interaction Specification**，特别把 Sticky、Panel、Tile、Connector 和 Visual Layout 的鼠标状态、Hover、Selection、Drag、Snap、快捷键逐状态定义清楚。
