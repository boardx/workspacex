# 参与贡献

感谢你愿意贡献。这份文件只讲**外部贡献者**需要知道的两件事：怎么签署、怎么跑检查。
仓库内部的开发流程（issue → 分支 → 验证 → PR）见 [`AGENTS.md`](AGENTS.md)；安全问题请走
[`SECURITY.md`](SECURITY.md)，**不要**公开提 issue。

## 许可证

开源部分以 **Apache-2.0** 发布（决策 D1，2026-09-24）。开源包各自目录里的 `LICENSE`
是许可证正文。并非仓库里的每个目录都开源——归属表见 `.harness/scripts/lib/ownership.mjs`，
`pnpm run lint:package-license` 会逐个核对。

## 签署：Developer Certificate of Origin（DCO）

我们用 DCO，不用 CLA（决策 D20）。你**不需要签任何文件**，只需要在每个 commit 里声明：
这份贡献是你有权提交的。做法是提交时加 `-s`：

```bash
git commit -s -m "你的提交说明"
```

它会在提交说明末尾加一行（姓名与邮箱取自你的 git 配置，**邮箱须与提交作者一致**）：

```
Signed-off-by: 你的名字 <you@example.com>
```

忘了签？补签已有的提交：

```bash
git rebase --signoff origin/main   # 给本分支上的所有提交补签
git push --force-with-lease
```

这一行表示你同意下面这段声明（DCO 1.1 原文，未改动）：

```
Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same open source license (unless I am
    permitted to submit under a different license), as indicated
    in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.
```

**检查范围**：来自 fork 的 PR 由 `.github/workflows/dco.yml` 逐个 commit 检查
（`.harness/scripts/check-dco.mjs`），merge commit 除外。

## 提交前跑什么

改了哪个包，就跑那个包的检查；harness 的门控统一用：

```bash
pnpm run verify:harness
```

