/*
 * 迭代 17（#3773 后续）—— 原型的**强调色档位**。
 *
 * ## 为什么进项目行，而不是看的人的偏好
 *
 * 同 `theme` 那一列的理由（见 20260908150000）：它是**原型的属性**，不是"看的人后台开了
 * 哪个色"。同一份原型给谁看都该是设计者定的那个色，导出的 HTML 也跟随它。
 *
 * ## 为什么是 text + CHECK，而不是存 HSL 值
 *
 * 存的是**档位名**（blue / violet / …），实际色值在契约 `PROTOTYPE_ACCENTS` 里。
 * 存值等于把设计系统抄进数据库：以后调一档颜色要写数据迁移，而且历史行会各自停在
 * 当时的那个值上，同一个"blue"在不同项目里长得不一样。档位名则让调色只改一处代码。
 *
 * 默认 'neutral' 与这一列出现之前的行为逐字相同——老项目读出来不覆盖任何 token，
 * 屏上一个像素都不会因为这次迁移而变。
 */
ALTER TABLE design_projects
  ADD COLUMN IF NOT EXISTS accent text NOT NULL DEFAULT 'neutral'
  CHECK (accent IN ('neutral', 'blue', 'violet', 'teal', 'green', 'amber', 'rose', 'slate'));
