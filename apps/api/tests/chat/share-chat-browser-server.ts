import { readFileSync } from "node:fs";
import { hash } from "bcryptjs";
import { ensureDatabase, migrateOnce, resetOrgs, seedOrg, addOrgMember, addCredential, asOwner, asApp } from "../support/db";
import { addChatThread, addChatMessage } from "../support/chat-db";
import { createApp } from "../../src/main";
import { OBJECT_STORE, type ObjectStore } from "../../src/application/artifact/ports";

const orgId = "org-chat-share-browser", userId = "u-chat-share-browser";
const threadId = "t-chat-share-browser";
const email = "chat-share-browser@example.test", password = "ShareBrowser5655!";
ensureDatabase(); await migrateOnce(); await resetOrgs([orgId]);
await asOwner(c => c.query("DELETE FROM credentials WHERE user_id=$1", [userId]));
await seedOrg({ orgId, projectId: "p-chat-share-browser" });
await addOrgMember(orgId, userId, "consultant", null);
await addCredential(userId, email, "分享验收用户");
const passwordHash = await hash(password, 12);
await asOwner(c => c.query("UPDATE credentials SET password_hash=$1 WHERE user_id=$2", [passwordHash, userId]));
await addChatThread({ orgId, id: threadId, createdBy: userId, projectId: null, visibilityScope: "private", title: "与朋友分享的对话" });
await addChatMessage({ orgId, id: "m-share-browser-q", threadId, authorId: userId, body: "帮我解释一下这个计划，朋友无需账号也能看。" });
await addChatMessage({ orgId, id: "m-share-browser-a", threadId, authorId: "assistant", authorKind: "agent",
  body: "这是 **公开分享** 的阅读页。\n\n| 步骤 | 状态 |\n|---|---|\n| 分享 | 已准备 |\n\n```typescript\nconst message = 'hello friend';\nconsole.log(message);\n```\n\n<script>window.shareXss=true</script>\n\n[不安全链接](javascript:alert(1))" });
const app = await createApp();
const image = readFileSync(new URL("../../../web/public/apple-icon.png", import.meta.url));
const key = "share-browser/logo";
try { await app.get<ObjectStore>(OBJECT_STORE).putOnce(key, image, "image/png"); } catch (e) {
  const existing = await app.get<ObjectStore>(OBJECT_STORE).get(key);
  if (!existing || !Buffer.from(existing).equals(image)) throw e;
}
await asApp(orgId, c => c.query(`INSERT INTO chat_message_attachments
  (id,org_id,thread_id,message_id,filename,mime,bytes,storage_ref,uploaded_by)
  VALUES ('att-share-browser',$1,$2,'m-share-browser-q','图片.png','image/png',$3,$4,$5)`,
  [orgId, threadId, image.length, key, userId]));
await app.listen(Number(process.env.WORKSPACEX_API_PORT), "127.0.0.1");
console.log("chat-share browser API ready");
const stop = async () => {
  await app.close(); await resetOrgs([orgId]);
  await asOwner(c => c.query("DELETE FROM credentials WHERE user_id=$1", [userId]));
  process.exit(0);
};
process.once("SIGTERM", () => void stop()); process.once("SIGINT", () => void stop());
