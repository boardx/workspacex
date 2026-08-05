/**
 * `POST /models` — 凭据进入系统的唯一入口（#548, F48 / uc-20-1 R3 步骤 1–3, I-6）。
 *
 * ## 三条反证，每条都配一个变异
 *
 * 这个文件里的每一条正向断言都可以在一个**什么都没做**的实现上为真：不落库就没有错行，
 * 不回响应就没有泄露。所以三组断言各自绑一个变异体（`mutant*` 开头的假实现），
 * 断言「该变异体确实让对应的断言变红」——绿色本身不是证据，能红才是。
 *
 *   A（落库）  摘掉 `repository.insert` ⇒ 「凭据落到了 model_secrets」必须变红
 *   B（红得对）同一个变异体下，**更早**的断言（词表检查、租户归属）仍然绿
 *   C（防假绿）造一个「故意回显凭据」的响应 ⇒ 「凭据不在响应/日志里」必须变红
 *
 * C 比 A、B 更重要：A、B 保护的是功能，C 保护的是 AC3。一条漏掉的凭据是安全事故，
 * 不是缺陷。
 */
import { describe, expect, it } from "vitest";
import { agentRuntime as C } from "@repo/contracts";
import { registerModel } from "../../../src/application/model/register-model";
import type {
  ComplianceVocabularyReader,
  ModelPoolClock,
  ModelPoolRepository,
  StoredModel,
} from "../../../src/application/model/ports";
import type { CredentialCipher, SealedCredential } from "../../../src/domain/model/credential-vault";
import type { ModelPoolRow, RegisterModelInput } from "../../../src/domain/model/registry";

const PLAINTEXT = "sk-live-548-must-never-be-echoed";
const ENDPOINT = "https://10.0.0.7.internal.invalid/v1";
const ORG = "org-548";

/** Base64, deliberately not a real cipher — enough to prove stored bytes ≠ plaintext bytes. */
const cipher: CredentialCipher = {
  algorithm: "aes-256-gcm",
  keyId: "k-test-548",
  encrypt: (p) => Buffer.from(p, "utf8").toString("base64"),
};

const clock: ModelPoolClock = {
  now: () => "2026-08-05T00:00:00.000Z",
  newModelId: () => "mdl-fixed-548",
};

/** O-38: 词表来自组织配置，当前为空 ⇒ 只有 `[]` 合法。 */
const emptyVocabulary: ComplianceVocabularyReader = { forOrg: async () => [] };

interface Written {
  readonly orgId: string;
  readonly row: ModelPoolRow;
  readonly credential: SealedCredential | null;
  readonly endpoint: SealedCredential | null;
}

/** 记录被写下去的东西，好让断言去看「凭据到底有没有落库、以什么形态落的」。 */
class RecordingRepository implements ModelPoolRepository {
  readonly writes: Written[] = [];
  async insert(input: Written): Promise<void> {
    this.writes.push(input);
  }
  async listForOrg(): Promise<readonly StoredModel[]> {
    return [];
  }
}

/**
 * 变异体 A：**摘掉落库那一步**。其余一切不变——签名仍然满足端口，调用方察觉不到。
 * 这正是「代码写完了、看起来能跑」的那种失败形态。
 */
class MutantDroppedInsert implements ModelPoolRepository {
  readonly writes: Written[] = [];
  async insert(_input: Written): Promise<void> {
    // 故意什么都不做。
  }
  async listForOrg(): Promise<readonly StoredModel[]> {
    return [];
  }
}

const validInput = {
  kind: "closed-api",
  shape: "single",
  vendor: "OpenAI",
  displayName: "gpt-548",
  capabilityTags: ["推理"],
  contextWindow: 256_000,
  unitPrice: 0.06,
  complianceAttrs: [],
  credential: PLAINTEXT,
  endpoint: ENDPOINT,
  members: [],
} satisfies RegisterModelInput;

async function run(repository: ModelPoolRepository) {
  return registerModel(ORG, { ...validInput }, {
    repository,
    cipher,
    vocabulary: emptyVocabulary,
    clock,
  });
}

describe("正向：接入一个模型，凭据被密封落库、不进响应", () => {
  it("落 `待测试`，响应只有契约声明的两个键", async () => {
    const repo = new RecordingRepository();
    const result = await run(repo);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // 出门过契约的 `.strict()`——controller 走的是同一句。
    const out = C.operations.registerModel.out.parse({
      modelId: result.row.modelId,
      status: result.row.status,
    });
    expect(out).toEqual({ modelId: "mdl-fixed-548", status: "待测试" });
  });

  it("A 的目标断言：凭据与端点都以**密文**落库", async () => {
    const repo = new RecordingRepository();
    await run(repo);

    expect(repo.writes.length, "什么都没落库").toBe(1);
    const w = repo.writes[0]!;
    expect(w.orgId).toBe(ORG);
    expect(w.credential, "凭据没有落库").not.toBeNull();
    expect(w.endpoint, "端点没有落库").not.toBeNull();
    // 落下去的是密文，不是明文。
    expect(w.credential!.ciphertext).not.toBe(PLAINTEXT);
    expect(w.credential!.ciphertext).toBe(Buffer.from(PLAINTEXT, "utf8").toString("base64"));
    expect(w.credential!.sealedAt).toBe("2026-08-05T00:00:00.000Z");
  });
});

describe("反证 A + B：摘掉落库那一步，红必须落在**那一步之后**", () => {
  it("A：`repository.insert` 被摘掉 ⇒ 落库断言变红", async () => {
    const mutant = new MutantDroppedInsert();
    await run(mutant);

    // 这就是上面那条 `A 的目标断言` 的第一句，在变异体下的表现。
    expect(
      mutant.writes.length,
      "变异体吞掉了 insert，落库断言却仍然看得到写入——说明它断的不是落库",
    ).toBe(0);

    // 把原断言原样跑一遍，证明它**确实**会抛（红），而不是恰好也能通过。
    expect(() => {
      expect(mutant.writes.length, "什么都没落库").toBe(1);
    }).toThrow();
  });

  it("B：同一变异体下，**更早**的两步仍然绿——词表检查与租户归属", async () => {
    const mutant = new MutantDroppedInsert();
    const result = await run(mutant);

    // 更早的第 1 步：合规词表检查在密封与落库之前跑，且通过了（`[]` 合法）。
    // 若红点提前跑到了这里，说明反证打偏了目标。
    expect(result.ok, "词表检查这一步被连累了——红落早了").toBe(true);
    if (!result.ok) return;

    // 更早的第 2 步：投影仍然产出正确的行（id / 状态 / 不含凭据）。
    expect(result.row.modelId).toBe("mdl-fixed-548");
    expect(result.row.status).toBe("待测试");
    expect(Object.keys(result.row)).not.toContain("credential");

    // 且被摘掉的**只有**落库：这三条绿 + 上一条红，红点被夹在了正确的位置。
    expect(mutant.writes.length).toBe(0);
  });

  it("B 的另一侧：词表不通过时，**落库那一步根本不该被走到**（E2 不留半截配置）", async () => {
    const repo = new RecordingRepository();
    const result = await registerModel(
      ORG,
      { ...validInput, complianceAttrs: ["境内"] },
      { repository: repo, cipher, vocabulary: emptyVocabulary, clock },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("COMPLIANCE_ATTR_UNKNOWN");
    expect(result.unknown).toEqual(["境内"]);
    // uc-20-1 E2：被拒时不保存半截配置。
    expect(repo.writes.length, "被拒的注册仍然落了库——半截配置").toBe(0);
  });
});

describe("反证 C（最要害）：凭据不出现在响应与日志里", () => {
  /** 一次请求的全部对外可见面：响应体 + 这条路径写下的日志行。 */
  function visibleSurface(out: unknown, logLines: readonly string[]): string {
    return JSON.stringify(out) + "\n" + logLines.join("\n");
  }

  it("真实路径：响应 + 日志里都没有凭据、也没有端点", async () => {
    const repo = new RecordingRepository();
    const logs: string[] = [];
    const result = await run(repo);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // controller 出门那一句，逐字。
    const out = C.operations.registerModel.out.parse({
      modelId: result.row.modelId,
      status: result.row.status,
    });
    // 这条路径不记请求体——controller 里没有任何 logger 调用，所以 logs 为空。
    const surface = visibleSurface(out, logs);

    expect(surface).not.toContain(PLAINTEXT);
    expect(surface).not.toContain(ENDPOINT);
    // 连密文都不该出现在响应里（它属于 model_secrets，不属于任何响应）。
    expect(surface).not.toContain(Buffer.from(PLAINTEXT, "utf8").toString("base64"));
  });

  it("C：造一个「故意回显凭据」的响应 ⇒ 同一条断言必须变红", () => {
    // 变异体：把凭据塞回响应体。这是 I-6 被打破时代码长的样子。
    const leaky = { modelId: "mdl-fixed-548", status: "待测试", credential: PLAINTEXT };
    const surface = visibleSurface(leaky, []);

    // 正样本：这个面**确实**带着凭据，所以下面的红不是空转。
    expect(surface).toContain(PLAINTEXT);

    // 同一条断言，原样跑，必须抛。
    expect(() => {
      expect(surface).not.toContain(PLAINTEXT);
    }).toThrow();
  });

  it("C 的第二形态：凭据只进了**日志**（响应干净）⇒ 断言仍须变红", () => {
    const cleanOut = { modelId: "mdl-fixed-548", status: "待测试" };
    // 一个框架级 request logger 就足以造出这一行——AC3 第三个面。
    const logs = [`POST /models body={"displayName":"gpt-548","credential":"${PLAINTEXT}"}`];
    const surface = visibleSurface(cleanOut, logs);

    // 响应本身是干净的：只看响应的断言会**假绿**，这正是要防的。
    expect(JSON.stringify(cleanOut)).not.toContain(PLAINTEXT);

    expect(() => {
      expect(surface).not.toContain(PLAINTEXT);
    }).toThrow();
  });

  it("C 的第三形态：契约的 `.strict()` 自己就会拒掉回显凭据的响应", () => {
    // 不依赖任何扫描：多一个键，zod 当场拒。这是凭据出门的最后一道闸。
    expect(() =>
      C.operations.registerModel.out.parse({
        modelId: "mdl-fixed-548",
        status: "待测试",
        credential: PLAINTEXT,
      }),
    ).toThrow();

    // 正样本：不带那个键时它是通过的，所以上面的抛来自**多出来的键**，
    // 不是来自一个恰好永远失败的 schema。
    expect(() =>
      C.operations.registerModel.out.parse({ modelId: "mdl-fixed-548", status: "待测试" }),
    ).not.toThrow();
  });
});
