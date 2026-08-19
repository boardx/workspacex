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
# ⚠ 装成**扁平真实目录树**（npm 的默认布局，每个包都是真目录、不是软链）。
#   这不是风格选择：Node 权限模型不递归解析软链，pnpm 那种二层软链布局下
#   即使把链条上每段真实路径全部授权也依然被拒（#1583 实测）。
#   src/execute-script.ts 的 moduleReadRoots 头注有完整推理。
WORKDIR /opt/sandbox
COPY package.json ./
RUN npm install --omit=dev --no-package-lock \
 && npm cache clean --force \
 # 自检：预装真的成功了才让镜像构建通过，而不是等运行时才发现 MODULE_NOT_FOUND。
 && node -e "require.resolve('pptxgenjs'); console.log('pptxgenjs preinstalled OK')"

COPY --from=build /build/dist ./dist

# 非 root（node 镜像自带 uid/gid 1000 的 `node` 用户）。
# 应用目录保持 root 所有、对 node 只读 —— 服务不需要写自己的代码目录。
USER node

# 执行产物写在 tmpfs 上。os.tmpdir() 默认就是 /tmp，与 compose 里的 tmpfs 挂载点对齐。
ENV SKILL_SANDBOX_MODULES_DIR=/opt/sandbox/node_modules \
    SKILL_SANDBOX_PORT=8790 \
    TMPDIR=/tmp

EXPOSE 8790

# ⚠ 部署时必须把端口绑回环（`127.0.0.1:<port>:8790`）：本服务与
# deep-agent-service 同一条纪律 —— 自己没有鉴权，只允许 apps/api 从内部调用。
CMD ["node", "dist/main.js"]
