# apps/skill-sandbox —— 试跑接真执行的沙箱服务（design delta `skill-sandbox-execution`，F962 / #1583）
#
# ⚠⚠ 这个镜像本身**不构成**安全边界的全部。contract §4 的隔离是**两层**：
#
#   L1 容器：network: none / 只读 rootfs / 非 root / tmpfs workdir / mem·cpu·pids 上限
#   L2 进程：node --experimental-permission（见 src/execute-script.ts）
#
# 本文件负责 L1 里"镜像能提供的那部分"（非 root、干净的只读文件布局）。
# **`network: none`、只读 rootfs、tmpfs、资源上限是 `run`/compose 侧的参数，
# 不是镜像属性** —— 见 docker-compose.sandbox.yml。光有这个 Dockerfile 而用
# `docker run` 裸跑，网络是**通的**，V2-b 会红，那是正确的红。
#
# ⚠ 唯一能挡住网络的是 `network: none`。Node 权限模型没有网络维度（#1575 ⑤、
#   #1583 复现：开满权限限制的进程里 fetch() 照样 200）。任何"为了让测试变绿"
#   而放开网络的改动都是把门控调成不会红，verification.md V2-CP 就是抓这个的。

# ---------- 构建阶段：编译 TS，不进运行镜像 ----------
FROM node:22-slim AS build
WORKDIR /build
COPY package.json ./
COPY src ./src
# ⚠ 刻意**不**拷 tsconfig.json：仓库里那份 `extends` 的是 monorepo 根配置，
#   镜像里没有它，用它编译会 `error TS5083: Cannot read file '/tsconfig.json'`。
#   为了编译一个三文件的服务把整个 monorepo 拷进镜像不值得，所以这里全部用
#   命令行旗标表达，与 apps/skill-sandbox/tsconfig.json 的对应项保持一致。
RUN npm install --no-save typescript@5 @types/node \
 && npx tsc src/*.ts \
      --types node --module NodeNext --moduleResolution NodeNext \
      --target ES2022 --strict --skipLibCheck \
      --outDir dist

# ---------- 运行阶段 ----------
FROM node:22-slim

# pptxgenjs **预装**进镜像。skill 原文写着「preinstalled — do not run `npm install`
# first」；而且 `network: none` 下容器根本出不了网，装不了包 —— 两件事自洽
# （contract §4 末尾）。⚠ 别把它改成运行时安装：那会同时违反 skill 原文与网络边界。
#
# F979（design-delta skill-office-docs-node-runtime）—— 同一条纪律扩到三个新库：
# docx（Word 从零创建）、exceljs（Excel 从零创建）、pdf-lib（PDF 从零创建）。三者均为
# 独立 MIT 许可的开源 Node 库，不是 Anthropic 官方或任何 fork skill 的代码/提示词——
# 完整授权结论见该 delta contract.md §0。同样预装进镜像、同样不允许运行时安装。
#
# ⚠ 装成**扁平真实目录树**（npm 的默认布局，每个包都是真目录、不是软链）。
#   这不是风格选择：Node 权限模型不递归解析软链，pnpm 那种二层软链布局下
#   即使把链条上每段真实路径全部授权也依然被拒（#1583 实测）。
#   src/execute-script.ts 的 moduleReadRoots 头注有完整推理。
WORKDIR /opt/sandbox
COPY package.json ./
RUN npm install --omit=dev --no-package-lock \
 && npm cache clean --force \
 # 自检：预装真的成功了才让镜像构建通过，而不是等运行时才发现 MODULE_NOT_FOUND。
 && node -e "require.resolve('pptxgenjs'); console.log('pptxgenjs preinstalled OK')" \
 && node -e "require.resolve('docx'); console.log('docx preinstalled OK')" \
 && node -e "require.resolve('exceljs'); console.log('exceljs preinstalled OK')" \
 && node -e "require.resolve('pdf-lib'); console.log('pdf-lib preinstalled OK')" \
 && node -e "require.resolve('@pdf-lib/fontkit'); console.log('@pdf-lib/fontkit preinstalled OK')"

# ---------- 中文（CJK）字体：PDF 里画中文的唯一办法 ----------
#
# pdf-lib 的 StandardFonts 是 PDF 标准 14 字体，编码是 WinAnsi —— 只有拉丁字符。
# 用它 drawText('中文') 不是"画得难看"，是直接抛错。要画中文只有一条路：嵌入一份
# 真的带中文字形的字体（`@pdf-lib/fontkit` + `embedFont(bytes)`）。
#
# ⚠ 字体必须**预装进镜像**，理由与 npm 包完全相同：容器 `network: none`，运行时下不动
#   任何东西。脚本里写 fetch 字体只会失败一次再报错。
#
# ## 为什么是"构建期裁字体 + 运行期整份嵌入"，而不是运行期 subset:true
#
# 2026-09-06 实测（三种字体，逐个渲染确认，不是从文档推的）：
#   · DroidSansFallback + subset:true → 内嵌字体损坏（把 FontFile2 掏出来重新解析，
#     用到的字形 getGlyph 抛 "Trying to access beyond buffer length"），渲染是方框；
#     而且这份字体**根本没有拉丁字形**（'m'/'A'/'1'/'%' 的 glyphId 全是 0），
#     任何带数字或英文的中文文档都会画出方框。
#   · Noto Sans CJK SC（CFF）+ subset:true → 渲染成 `! " # $%&…` 的乱码。
#   · 同一份 Noto，改成**不子集化**整份嵌入 → 中文/数字/拉丁/全角标点全部正确。
# ⇒ pdf-lib 的**运行期子集器**在 TrueType 与 CFF 两条路上都不可靠，这不是选型问题。
#   子集化因此挪到**构建期**用 fontTools 做一次（确定性、可验证），运行期整份嵌入。
#
# ⚠ 别"顺手"把 SKILL.md 或测试里的 `subset: true` 加回来：它产出的 PDF **打开是方框**，
#   而"每个字形编号 != 0"这类判据抓不到（子集化会把字形重编号成 1,2,3…）。
#   tests/produces-real-cjk-pdf.test.ts 有一条反证专门锁这件事。
#
# ## 字符集取到 U+4E00–U+9FFF 全部（不是 GB2312）
#
# 实测裁出来的体积：GB2312(6763 字) 1.4MB / CJK 统一表意文字全区 4.9MB / 再加扩展 A 6.6MB。
# 取中间那档：GB2312 漏掉的生僻字（人名里的淼、喆…）会**静默变方框**——那正是本次要修的病，
# 省 3.5MB 不值得把它留着。纯英文文档不该背这 4.9MB，SKILL.md 因此要求：正文全是拉丁字符
# 时用内置 StandardFonts（0 字节），出现任何非拉丁字符才用这份嵌入字体。
RUN apt-get update \
 && apt-get install -y --no-install-recommends fonts-noto-cjk fonttools python3 \
 && mkdir -p /usr/share/fonts/workspacex \
 && python3 -c "from fontTools.ttLib import TTCollection; ttc = TTCollection('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', lazy=True); name = lambda x: (x['name'].getDebugName(6) or '').lower(); f = next(x for x in ttc.fonts if 'sc-' in name(x) and 'mono' not in name(x)); f.save('/tmp/noto-sc-full.otf'); print('extracted', f['name'].getDebugName(6))" \
 && python3 -c "chars = [chr(c) for c in range(0x20, 0x7F)] + list('　，。、；：？！“”‘’（）《》【】…—～·¥％℃×÷±°§№') + [chr(c) for c in range(0x4E00, 0xA000)]; open('/tmp/charset.txt', 'w', encoding='utf-8').write(''.join(dict.fromkeys(chars))); print('charset', len(set(chars)))" \
 && pyftsubset /tmp/noto-sc-full.otf --text-file=/tmp/charset.txt \
      --output-file=/usr/share/fonts/workspacex/NotoSansSC-Common.otf \
      --layout-features='' --no-hinting --desubroutinize --drop-tables+=DSIG \
 && rm -f /tmp/noto-sc-full.otf /tmp/charset.txt \
 && apt-get purge -y fonts-noto-cjk fonttools \
 && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/* \
 && node -e "const fontkit = require('/opt/sandbox/node_modules/@pdf-lib/fontkit'); const fs = require('fs'); const path = '/usr/share/fonts/workspacex/NotoSansSC-Common.otf'; const bytes = fs.readFileSync(path); const font = fontkit.create(bytes); if (font.fonts) throw new Error('font is a collection; pdf-lib embedFont will reject it'); const sample = '季度经营回顾 2026 Q3 mixed English 18% （中英文）淼喆'; const missing = [...new Set(sample)].filter((ch) => ch !== ' ' && (font.glyphsForString(ch)[0] || {}).id === 0); if (missing.length) throw new Error('font is missing glyphs for: ' + missing.join('')); console.log('CJK font OK', (bytes.length / 1048576).toFixed(1) + 'MB', font.postscriptName)"

COPY --from=build /build/dist ./dist

# 非 root（node 镜像自带 uid/gid 1000 的 `node` 用户）。
# 应用目录保持 root 所有、对 node 只读 —— 服务不需要写自己的代码目录。
USER node

# 执行产物写在 tmpfs 上。os.tmpdir() 默认就是 /tmp，与 compose 里的 tmpfs 挂载点对齐。
ENV SKILL_SANDBOX_MODULES_DIR=/opt/sandbox/node_modules \
    SKILL_SANDBOX_CJK_FONT=/usr/share/fonts/workspacex/NotoSansSC-Common.otf \
    SKILL_SANDBOX_PORT=8790 \
    TMPDIR=/tmp

EXPOSE 8790

# ⚠ 部署时必须把端口绑回环（`127.0.0.1:<port>:8790`）：本服务与
# deep-agent-service 同一条纪律 —— 自己没有鉴权，只允许 apps/api 从内部调用。
CMD ["node", "dist/main.js"]
