import { describe, expect, it } from "vitest";
import { dataDirAdvice, dataDirAdviceBody } from "../src/data-dir-advice";

describe("打开数据目录前的那句话", () => {
  const a = dataDirAdvice();

  it("说清机制：不同时刻的文件拼在一起", () => {
    expect(a.why).toContain("不同时刻");
  });

  it("说清后果：那个状态从来没存在过，所以打不开", () => {
    expect(a.why).toContain("从来没有真实存在过");
    expect(a.why).toContain("打不开");
  });

  it("说这是实测过的，不是我们的猜测", () => {
    expect(a.why).toContain("实测");
  });

  it("指向安全的那条路", () => {
    expect(a.saferPath).toContain("备份我的数据");
  });

  it("说明那条路凭什么安全——一致快照 + 写完核对", () => {
    expect(a.saferPath).toContain("一致快照");
    expect(a.saferPath).toContain("核对");
  });

  it("安全的那条是默认动作，排在前面", () => {
    expect(a.actions[0]).toContain("备份");
    expect(a.actions[1]).toMatch(/仍然/);
  });

  it("不出现技术词——用户不认得 PGlite、abort、WAL", () => {
    expect(`${a.title}${dataDirAdviceBody(a)}`).not.toMatch(/PGlite|abort|WAL|inconsistent|exit code/i);
  });

  it("不夸大：没有说「数据会损坏」——坏的是那份拷贝，不是原始数据", () => {
    expect(dataDirAdviceBody(a)).not.toMatch(/数据会损坏|会丢失数据|损坏你的数据/);
  });

  it("正文只有一处拼接，外壳不自己再拼一份", () => {
    expect(dataDirAdviceBody(a)).toContain(a.why);
    expect(dataDirAdviceBody(a)).toContain(a.saferPath);
  });
});
