-- devapp 实测缺陷（2026-08-11，人类在 devapp.boardx.us 亲手撞到）：
-- 首位管理员 bootstrap 建出的组织 seat_quota=0，管理员发第一个邀请就撞
-- 「组织成员配额已用尽」——一个刚创建的组织连一个人都邀请不了，是产品缺陷。
--
-- 原默认 0 是 20260731085758_f11 的**有意**取向（O-29 ⑤：「组织未分配额度」是缺省
-- 状态，平台运营方线下分配）。但 O-29 只裁决了「配额用尽时硬阻断」（⑤），从未裁决
-- 「新组织的初始额度是 0」；而「线下分配」在本产品里**没有任何产品内或运维脚本的
-- 分配路径**，缺省 0 等于把每个新组织都锁死在单人状态。经 coord-agent-auth 裁定
-- 改为默认 50。
--
-- I-9（domain.md：额度为 0 时 InviteOrgMember 一律失败且不落行）**不变**——它说的是
-- 「0 ⇒ 阻断」这条判定，不是「新组织从 0 开始」。反证见
-- tests/auth/quota-exhausted-hard-block.test.ts（显式置 0，仍然全绿）与
-- tests/auth/new-org-default-quota.test.ts（新组织靠列默认值就能发出第一个邀请）。
--
-- Replayable：SET DEFAULT 幂等；UPDATE 的 WHERE 收窄到 seat_quota = 0 的行，重放安全。

/* ① 新组织的列默认值：0 → 50。所有建组织路径（bootstrapFirstUser / auth/register 的
     redeemAndCreateOrg / joinExistingUserToNewOrg / seed-dev-account）都不显式写
     seat_quota，全部由这个默认值接管——单一事实源，不在应用代码里出现第二份 50。 */
ALTER TABLE organizations ALTER COLUMN seat_quota SET DEFAULT 50;

/* ② 存量回填：只动 kind='organization' 且 seat_quota=0 的行。
     - 0 是「从未被分配过」的旧默认态；本产品没有自服务调额端点，任何非 0 值都只可能
       是运维手动 UPDATE 的结果，不碰。
     - personal-local 组织（注册即有的个人组织）不参与邀请，保持 0：I-9 的硬阻断在
       那里恰好是「个人组织不能邀人」这条正确语义。 */
UPDATE organizations SET seat_quota = 50 WHERE seat_quota = 0 AND kind = 'organization';
